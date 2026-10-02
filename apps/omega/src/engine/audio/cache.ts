// Decoded-audio cache. Assets are decoded with Mediabunny (UrlSource over the
// omega-media:// protocol + AudioSampleSink) in a pool of dedicated workers
// (falling back to the main thread when workers are unavailable), down-mixed to at most stereo,
// resampled to the sequence rate with an OfflineAudioContext, and kept in an
// LRU with a memory cap. Long assets are decoded per needed range instead of
// whole; reversed copies are made on demand for reversed clips. Waveform peaks
// are computed during full decodes. Never throws on bad media: failures
// resolve to null and are remembered.

import type { MediaAsset } from '../../state/types';
import { decodeAudio, type DecodeRequest, type DecodeResult } from './decodeCore';
import type { Peaks } from './peaks';

/** Bytes of float audio kept in memory before least-recently-used ranges are dropped. */
export const MEMORY_CAP = 1.5 * 1024 ** 3;
/** Assets up to this long are decoded whole (and get waveform peaks in the same pass). */
export const FULL_DECODE_MAX = 30 * 60;
/** Extra source seconds decoded around a requested range of a long asset. */
const RANGE_MARGIN = 20;
const MAX_CONCURRENT = 2;

export interface DecodedRange {
  key: string; // assetId (or 'seq:<id>' for rendered nested sequences)
  sampleRate: number;
  /** Source seconds at frame 0. */
  start: number;
  /** Source seconds at the last frame. */
  end: number;
  buffer: AudioBuffer;
  reversed: AudioBuffer | null;
  full: boolean;
  bytes: number;
  lastUsed: number;
  pins: number;
}

type Job = { run: () => Promise<void>; priority: number };

const entries: DecodedRange[] = [];
const inflight = new Map<string, Promise<DecodedRange | null>>();
const failed = new Map<string, string>(); // assetId → reason
const peakStore = new Map<string, Peaks[]>();
const peakListeners = new Set<(assetId: string) => void>();
const queue: Job[] = [];
let running = 0;

function bytesOf(b: AudioBuffer | null): number {
  return b ? b.length * b.numberOfChannels * 4 : 0;
}

export function cacheBytes(): number {
  return entries.reduce((s, e) => s + e.bytes, 0);
}

function touch(e: DecodedRange) {
  e.lastUsed = performance.now();
}

function evict(extra = 0) {
  let total = cacheBytes() + extra;
  if (total <= MEMORY_CAP) return;
  const order = [...entries].sort((a, b) => a.lastUsed - b.lastUsed);
  for (const e of order) {
    if (total <= MEMORY_CAP) break;
    if (e.pins > 0) continue;
    // A full entry being dropped keeps its peaks (they are tiny).
    entries.splice(entries.indexOf(e), 1);
    total -= e.bytes;
  }
}

function add(e: DecodedRange) {
  evict(e.bytes);
  // A new full decode supersedes partial ranges of the same asset/rate.
  if (e.full) {
    for (let i = entries.length - 1; i >= 0; i--) {
      const o = entries[i];
      if (o.key === e.key && o.sampleRate === e.sampleRate && o.pins === 0) entries.splice(i, 1);
    }
  }
  entries.push(e);
}

/** A cached range covering source [s0, s1] at this rate, or null. */
export function findRange(key: string, sampleRate: number, s0: number, s1: number): DecodedRange | null {
  let best: DecodedRange | null = null;
  for (const e of entries) {
    if (e.key !== key || e.sampleRate !== sampleRate) continue;
    const covers = e.start <= s0 + 1e-3 && (e.full || e.end >= s1 - 1e-3);
    if (covers && (!best || e.full)) best = e;
  }
  if (best) touch(best);
  return best;
}

/** Still held by the cache (not evicted)? */
export function isCached(e: DecodedRange): boolean {
  return entries.includes(e);
}

export function pin(e: DecodedRange) {
  e.pins++;
}
export function unpin(e: DecodedRange) {
  e.pins = Math.max(0, e.pins - 1);
}

/** Reversed copy of a decoded range (cached on the entry). */
export function reversedOf(e: DecodedRange): AudioBuffer {
  if (e.reversed) return e.reversed;
  const src = e.buffer;
  const rev = new AudioBuffer({ length: src.length, numberOfChannels: src.numberOfChannels, sampleRate: src.sampleRate });
  for (let c = 0; c < src.numberOfChannels; c++) {
    const a = src.getChannelData(c);
    const b = rev.getChannelData(c);
    for (let i = 0, n = a.length; i < n; i++) b[i] = a[n - 1 - i];
  }
  evict(bytesOf(rev));
  e.reversed = rev;
  e.bytes += bytesOf(rev);
  return rev;
}

/** Registers an externally rendered buffer (nested-sequence mixdowns). */
export function putRendered(key: string, buffer: AudioBuffer): DecodedRange {
  const e: DecodedRange = {
    key,
    sampleRate: buffer.sampleRate,
    start: 0,
    end: buffer.duration,
    buffer,
    reversed: null,
    full: true,
    bytes: bytesOf(buffer),
    lastUsed: performance.now(),
    pins: 0,
  };
  add(e);
  return e;
}

export function failureOf(assetId: string): string | null {
  return failed.get(assetId) ?? null;
}

// ---------------------------------------------------------------------------
// Peaks
// ---------------------------------------------------------------------------

export function peaksOf(assetId: string): Peaks[] | null {
  return peakStore.get(assetId) ?? null;
}

export function onPeaksReady(cb: (assetId: string) => void): () => void {
  peakListeners.add(cb);
  return () => peakListeners.delete(cb);
}

function setPeaks(assetId: string, levels: Peaks[]) {
  peakStore.set(assetId, levels);
  for (const l of peakListeners) {
    try {
      l(assetId);
    } catch (err) {
      console.warn('peaks listener failed', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Job queue (playback requests jump ahead of waveform requests)
// ---------------------------------------------------------------------------

function enqueue<T>(priority: number, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job: Job = {
      priority,
      run: () => fn().then(resolve, reject),
    };
    const i = queue.findIndex((j) => j.priority < priority);
    if (i < 0) queue.push(job);
    else queue.splice(i, 0, job);
    pump();
  });
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift()!;
    running++;
    void job.run().finally(() => {
      running--;
      pump();
    });
  }
}

export const PRIORITY_PLAYBACK = 2;
export const PRIORITY_EXPORT = 1;
export const PRIORITY_PEAKS = 0;

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/**
 * Ensures the asset's audio covering source [s0, s1] is decoded at `sampleRate`.
 * Short assets are decoded whole (computing peaks on the way).
 */
export function ensureRange(asset: MediaAsset, sampleRate: number, s0: number, s1: number, priority = PRIORITY_PLAYBACK): Promise<DecodedRange | null> {
  const hit = findRange(asset.id, sampleRate, s0, s1);
  if (hit) return Promise.resolve(hit);
  if (failed.has(asset.id)) return Promise.resolve(null);
  const full = !(asset.duration > FULL_DECODE_MAX) || s1 - s0 > asset.duration * 0.5;
  const from = full ? 0 : Math.max(0, s0 - RANGE_MARGIN);
  const to = full ? Infinity : s1 + RANGE_MARGIN;
  const key = `${asset.id}@${sampleRate}:${full ? 'full' : `${Math.floor(from)}-${Math.ceil(to)}`}`;
  // Reuse an in-flight decode that will cover this range.
  for (const [k, p] of inflight) {
    if (!k.startsWith(`${asset.id}@${sampleRate}:`)) continue;
    const part = k.split(':')[1];
    if (part === 'full') return p;
    const [a, b] = part.split('-').map(Number);
    if (a <= s0 && b >= s1) return p;
  }
  const p = enqueue(priority, async () => {
    const again = findRange(asset.id, sampleRate, s0, s1);
    if (again) return again;
    return decode(asset, sampleRate, from, to, full);
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Decodes the whole asset (computing peaks) unless peaks already exist. */
export function ensurePeaks(asset: MediaAsset, sampleRate: number): Promise<Peaks[] | null> {
  const have = peakStore.get(asset.id);
  if (have) return Promise.resolve(have);
  if (failed.has(asset.id)) return Promise.resolve(null);
  const retain = !(asset.duration > FULL_DECODE_MAX);
  // A retained full decode doubles as the playback decode, so register it under that key too.
  const key = retain ? `${asset.id}@${sampleRate}:full` : `${asset.id}@peaks`;
  const existing = inflight.get(`${asset.id}@peaks`) ?? inflight.get(`${asset.id}@${sampleRate}:full`);
  if (existing) return existing.then(() => peakStore.get(asset.id) ?? null);
  const p = enqueue(PRIORITY_PEAKS, async () => {
    const hit = findRange(asset.id, sampleRate, 0, 0);
    if (peakStore.has(asset.id) && (!retain || hit?.full)) return hit;
    return decode(asset, sampleRate, 0, Infinity, true, retain);
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p.then(() => peakStore.get(asset.id) ?? null);
}

// ---------------------------------------------------------------------------
// Worker pool
// ---------------------------------------------------------------------------

interface PoolWorker {
  w: Worker;
  busy: boolean;
}

let pool: PoolWorker[] | null = null;
let workersBroken = false;
let jobSeq = 0;

function makeWorker(): Worker | null {
  try {
    return new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module', name: 'omega-audio-decode' });
  } catch {
    return null;
  }
}

/** Decodes in a worker; rejects when the worker itself cannot run (not on bad media). */
function decodeInWorker(req: DecodeRequest): Promise<DecodeResult> {
  if (workersBroken || typeof Worker === 'undefined') return Promise.reject(new Error('no workers'));
  pool ??= [];
  let slot = pool.find((p) => !p.busy);
  if (!slot && pool.length < MAX_CONCURRENT) {
    const w = makeWorker();
    if (!w) {
      workersBroken = true;
      return Promise.reject(new Error('worker creation failed'));
    }
    slot = { w, busy: false };
    pool.push(slot);
  }
  if (!slot) return Promise.reject(new Error('pool exhausted'));
  const s = slot;
  s.busy = true;
  const id = ++jobSeq;
  return new Promise<DecodeResult>((resolve, reject) => {
    const done = () => {
      s.busy = false;
      s.w.removeEventListener('message', onMsg);
      s.w.removeEventListener('error', onErr);
    };
    const onMsg = (e: MessageEvent<{ id: number; res: DecodeResult }>) => {
      if (e.data?.id !== id) return;
      done();
      resolve(e.data.res);
    };
    const onErr = (e: Event) => {
      done();
      e.preventDefault?.();
      // The worker script failed to load or crashed: stop using workers.
      workersBroken = true;
      pool = (pool ?? []).filter((p) => p !== s);
      s.w.terminate();
      reject(new Error('decode worker failed'));
    };
    s.w.addEventListener('message', onMsg);
    s.w.addEventListener('error', onErr);
    s.w.postMessage({ id, req });
  });
}

async function runDecode(req: DecodeRequest): Promise<DecodeResult> {
  try {
    const res = await decodeInWorker(req);
    if (res.ok || res.noAudio) return res;
    // Network/codec support can differ in workers: retry on the main thread once.
  } catch {
    /* fall back below */
  }
  return decodeAudio(req, { yieldEveryMs: 12 });
}

async function decode(asset: MediaAsset, targetRate: number, from: number, to: number, full: boolean, retain = true): Promise<DecodedRange | null> {
  const url = window.omega.media.urlFor(asset.path);
  try {
    const res = await runDecode({ url, from, to, peaks: full, retain, durationHint: asset.duration || 0 });
    if (!res.ok) {
      console.warn(`Audio decode failed for ${asset.name}: ${res.error}`);
      failed.set(asset.id, res.error ?? 'decode failed');
      return null;
    }
    if (res.peaks) setPeaks(asset.id, res.peaks);
    if (!retain) return null;
    let buffer = new AudioBuffer({ length: res.length, numberOfChannels: res.channels.length, sampleRate: res.sampleRate });
    res.channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    res.channels.length = 0;
    if (res.sampleRate !== targetRate) buffer = await resample(buffer, targetRate);
    const e: DecodedRange = {
      key: asset.id,
      sampleRate: targetRate,
      start: res.start,
      end: res.start + buffer.duration,
      buffer,
      reversed: null,
      full,
      bytes: bytesOf(buffer),
      lastUsed: performance.now(),
      pins: 0,
    };
    add(e);
    return e;
  } catch (err) {
    console.warn(`Audio decode failed for ${asset.name}`, err);
    failed.set(asset.id, (err as Error)?.message ?? 'decode failed');
    return null;
  }
}

/** High-quality sample-rate conversion through an OfflineAudioContext. */
export async function resample(buffer: AudioBuffer, rate: number): Promise<AudioBuffer> {
  if (buffer.sampleRate === rate) return buffer;
  const length = Math.max(1, Math.round((buffer.length * rate) / buffer.sampleRate));
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, length, rate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

/** Forget failures (e.g. after relinking media). */
export function clearFailures(assetId?: string) {
  if (assetId) failed.delete(assetId);
  else failed.clear();
}
