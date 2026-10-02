// Decoded-audio cache. Assets are decoded with Mediabunny (UrlSource over the
// omega-media:// protocol + AudioBufferSink), down-mixed to at most stereo,
// resampled to the sequence rate with an OfflineAudioContext, and kept in an
// LRU with a memory cap. Long assets are decoded per needed range instead of
// whole; reversed copies are made on demand for reversed clips. Waveform peaks
// are computed during full decodes. Never throws on bad media: failures
// resolve to null and are remembered.

import { ALL_FORMATS, AudioBufferSink, Input, UrlSource } from 'mediabunny';
import type { MediaAsset } from '../../state/types';
import { PeakBuilder, type Peaks } from './peaks';

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

async function yieldToUi() {
  await new Promise((r) => setTimeout(r, 0));
}

async function decode(asset: MediaAsset, targetRate: number, from: number, to: number, full: boolean, retain = true): Promise<DecodedRange | null> {
  const url = window.omega.media.urlFor(asset.path);
  let input: Input | null = null;
  try {
    input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track) {
      failed.set(asset.id, 'no audio track');
      return null;
    }
    if (!(await track.canDecode())) {
      failed.set(asset.id, 'audio codec cannot be decoded');
      return null;
    }
    const srcRate = await track.getSampleRate();
    let duration = asset.duration;
    try {
      duration = await input.computeDuration();
    } catch {
      /* keep the probed duration */
    }
    const known = duration > 0 ? duration : asset.duration > 0 ? asset.duration : Infinity;
    const end = Math.min(to, known + 0.25);
    const startT = Math.max(0, from);
    const span = Number.isFinite(end) ? end - startT : 60;
    const estimate = Math.max(1, Math.ceil(span * srcRate) + Math.ceil(srcRate * 0.05));
    const sink = new AudioBufferSink(track);
    const peaks = full ? new PeakBuilder(srcRate, estimate) : null;

    let chans: Float32Array<ArrayBuffer>[] = [];
    let cap = 0;
    let channels = 0;
    let writePos = -1; // frames relative to startT
    let maxWritten = 0;
    let lastYield = performance.now();
    const ensureCap = (need: number) => {
      if (!retain || need <= cap) return;
      const next = Math.max(need, Math.ceil(cap * 1.25));
      chans = chans.map((c) => {
        const n = new Float32Array(next);
        n.set(c);
        return n;
      });
      cap = next;
    };
    const mix = (b: AudioBuffer): Float32Array[] => {
      const n = b.numberOfChannels;
      if (n <= 2) return Array.from({ length: n }, (_, c) => b.getChannelData(c));
      // 5.1 → stereo (Web Audio "speakers" down-mix); other layouts keep the first two channels.
      const L = new Float32Array(b.getChannelData(0));
      const R = new Float32Array(b.getChannelData(1));
      if (n >= 6) {
        const C = b.getChannelData(2);
        const SL = b.getChannelData(4);
        const SR = b.getChannelData(5);
        for (let i = 0; i < L.length; i++) {
          L[i] += Math.SQRT1_2 * (C[i] + SL[i]);
          R[i] += Math.SQRT1_2 * (C[i] + SR[i]);
        }
      }
      return [L, R];
    };

    for await (const wb of sink.buffers(startT, end)) {
      const data = mix(wb.buffer);
      const n = wb.buffer.length;
      if (!channels) {
        channels = data.length;
        if (retain) {
          cap = estimate;
          chans = Array.from({ length: channels }, () => new Float32Array(cap));
        }
      }
      const pos = Math.round((wb.timestamp - startT) * srcRate);
      if (writePos < 0) {
        writePos = pos;
        if (peaks && pos > 0) peaks.pushSilence(pos);
      } else if (Math.abs(pos - writePos) > srcRate * 0.002) {
        // a gap (or overlap) in the stream: follow the timestamps
        if (peaks && pos > writePos) peaks.pushSilence(pos - writePos);
        writePos = pos;
      }
      const skip = writePos < 0 ? -writePos : 0;
      if (peaks && n > skip) peaks.push(data.length === channels ? data : data.slice(0, channels), skip, n - skip);
      if (retain && n > skip) {
        ensureCap(writePos + n);
        for (let c = 0; c < channels; c++) {
          const src = data[Math.min(c, data.length - 1)];
          chans[c].set(skip ? src.subarray(skip) : src, writePos + skip);
        }
      }
      writePos += n;
      maxWritten = Math.max(maxWritten, writePos);
      if (performance.now() - lastYield > 24) {
        await yieldToUi();
        lastYield = performance.now();
      }
    }

    if (peaks) setPeaks(asset.id, peaks.finish());
    if (!retain) return null;
    if (!channels) {
      failed.set(asset.id, 'no decodable audio');
      return null;
    }
    const length = Math.max(1, Math.min(cap, maxWritten));
    let buffer = new AudioBuffer({ length, numberOfChannels: channels, sampleRate: srcRate });
    for (let c = 0; c < channels; c++) buffer.copyToChannel(chans[c].subarray(0, length), c);
    chans = [];
    if (srcRate !== targetRate) buffer = await resample(buffer, targetRate);
    const e: DecodedRange = {
      key: asset.id,
      sampleRate: targetRate,
      start: startT,
      end: startT + buffer.duration,
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
  } finally {
    try {
      input?.dispose();
    } catch {
      /* ignore */
    }
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
