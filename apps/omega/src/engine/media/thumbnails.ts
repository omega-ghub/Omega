// Filmstrip thumbnails for the timeline and media browser. OWNED BY THE MEDIA PACKAGE.
//
// requestThumbnails() quantizes times to the asset's thumbnail step (see
// thumbnailStep: at least one frame, at most 2 s, about 240 per asset) and
// queues them. A small pool of background workers decodes ~96 px tall
// pictures with Mediabunny's CanvasSink (reading the proxy when one is
// ready), most recently requested first, in time order per asset so each
// batch is one forward decode pass. Results live in a memory-capped LRU of
// ImageBitmaps; onThumbnails() fires (batched, throttled) when new ones land.
// Images produce a single thumbnail. The cache owns the bitmaps: draw them,
// never close them.

import { CanvasSink, InputDisposedError, type Input, type UrlSource } from 'mediabunny';
import type { MediaAsset } from '../../state/types';
import { LruCache } from './lru';
import { fitWithin, slotTime, thumbSlot, thumbnailStep } from './mediaMath';
import { imageSize, loadImage, openInput, sourcePathFor } from './source';

export { thumbnailStep } from './mediaMath';

export const THUMB_HEIGHT = 96;
const BUDGET = 96 * 1024 * 1024;
const WORKERS = 2;
const MAX_BATCH = 12;
const MAX_QUEUE = 1500;
const MAX_SINKS = 4;
const NOTIFY_MS = 100;
const IMAGE_SLOT = -1;

interface AssetInfo {
  id: string;
  kind: MediaAsset['kind'];
  /** The original file: when it changes, cached pictures are stale. */
  origPath: string;
  /** The file decoded (the proxy when ready). */
  decodePath: string;
  duration: number;
  step: number;
  failedPath: string | null;
}

interface Job {
  assetId: string;
  slot: number;
  time: number;
  stamp: number;
}

interface SinkEntry {
  path: string;
  input: Input<UrlSource>;
  sink: CanvasSink;
  firstTs: number;
  used: number;
  /** Replaced while a batch was using it: dispose when that batch ends. */
  retired?: boolean;
}

const infos = new Map<string, AssetInfo>();
const cache = new LruCache<string, ImageBitmap>(BUDGET);
const queue = new Map<string, Job>();
const busy = new Set<string>();
const sinks = new Map<string, SinkEntry>();
const listeners = new Set<(assetId: string) => void>();
const pendingNotify = new Set<string>();
let stamp = 0;
let running = 0;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let lastNotify = 0;

const keyOf = (assetId: string, slot: number) => `${assetId}|${slot}`;

/** A cached thumbnail near `time` (within the cache's granularity), or null. */
export function getThumbnail(assetId: string, time: number): ImageBitmap | null {
  const info = infos.get(assetId);
  if (!info) return null;
  if (info.kind === 'image') return cache.get(keyOf(assetId, IMAGE_SLOT)) ?? null;
  const slot = thumbSlot(Math.max(0, time), info.step);
  const exact = cache.get(keyOf(assetId, slot));
  if (exact) return exact;
  // while the exact slot is decoding, a neighbour is better than a hole
  for (let d = 1; d <= 3; d++) {
    const near = cache.peek(keyOf(assetId, slot - d)) ?? cache.peek(keyOf(assetId, slot + d));
    if (near) return near;
  }
  return null;
}

/** Ensures thumbnails exist around these times (low priority, batched, cached). */
export function requestThumbnails(asset: MediaAsset, times: number[]): void {
  if (!asset || asset.offline) return;
  if (asset.kind !== 'image' && !asset.hasVideo) return;
  const info = ensureInfo(asset);
  if (info.failedPath === info.decodePath) return;
  const s = ++stamp;
  if (info.kind === 'image') {
    enqueue(info, IMAGE_SLOT, 0, s);
  } else {
    const seen = new Set<number>();
    for (const t of times) {
      if (!Number.isFinite(t)) continue;
      const slot = thumbSlot(Math.max(0, Math.min(t, info.duration)), info.step);
      if (seen.has(slot)) continue;
      seen.add(slot);
      enqueue(info, slot, slotTime(slot, info.step, info.duration), s);
    }
  }
  trimQueue();
  pump();
}

/** Notifies when new thumbnails for an asset are ready (redraw). */
export function onThumbnails(cb: (assetId: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Forgets everything about an asset (relink, replace footage, removal). */
export function invalidateThumbnails(assetId: string): void {
  cache.deleteWhere((k) => k.startsWith(`${assetId}|`));
  posters.deleteWhere((k) => k.startsWith(`${assetId}|`));
  for (const [k, j] of [...queue.entries()]) if (j.assetId === assetId) queue.delete(k);
  closeSink(assetId);
  infos.delete(assetId);
  notify(assetId);
}

/** Number of queued thumbnail jobs (diagnostics / tests). */
export function pendingThumbnails(): number {
  return queue.size + running;
}

// ---------------------------------------------------------------------------

function ensureInfo(asset: MediaAsset): AssetInfo {
  const decodePath = sourcePathFor(asset, true).path;
  let info = infos.get(asset.id);
  if (info && info.origPath !== asset.path) {
    invalidateThumbnails(asset.id);
    info = undefined;
  }
  if (!info) {
    info = {
      id: asset.id,
      kind: asset.kind,
      origPath: asset.path,
      decodePath,
      duration: Math.max(0, asset.duration),
      step: thumbnailStep(asset),
      failedPath: null,
    };
    infos.set(asset.id, info);
  } else if (info.decodePath !== decodePath) {
    // proxy became ready (or went away): same pictures, different file to decode
    info.decodePath = decodePath;
    info.failedPath = null;
    closeSink(asset.id);
  }
  return info;
}

function enqueue(info: AssetInfo, slot: number, time: number, s: number) {
  const key = keyOf(info.id, slot);
  if (cache.has(key)) return;
  const existing = queue.get(key);
  if (existing) {
    existing.stamp = s;
    // re-insert so iteration order follows recency as well
    queue.delete(key);
    queue.set(key, existing);
  } else queue.set(key, { assetId: info.id, slot, time, stamp: s });
}

function trimQueue() {
  if (queue.size <= MAX_QUEUE) return;
  const oldest = [...queue.entries()].sort((a, b) => a[1].stamp - b[1].stamp);
  for (let i = 0; i < oldest.length && queue.size > MAX_QUEUE; i++) queue.delete(oldest[i][0]);
}

function pump() {
  while (running < WORKERS) {
    let best: Job | null = null;
    for (const j of queue.values()) {
      if (busy.has(j.assetId)) continue;
      if (!best || j.stamp > best.stamp || (j.stamp === best.stamp && j.assetId === best.assetId && j.time < best.time)) best = j;
    }
    if (!best) return;
    const assetId = best.assetId;
    const batch = [...queue.values()]
      .filter((j) => j.assetId === assetId)
      .sort((a, b) => b.stamp - a.stamp || a.time - b.time)
      .slice(0, MAX_BATCH)
      .sort((a, b) => a.time - b.time);
    for (const j of batch) queue.delete(keyOf(j.assetId, j.slot));
    const info = infos.get(assetId);
    if (!info) continue;
    busy.add(assetId);
    running++;
    void runBatch(info, batch)
      .catch((err) => {
        // a sink retired mid-batch (proxy swap, relink) is not a broken file
        if (err instanceof InputDisposedError || infos.get(assetId) !== info) return;
        console.warn('[media] thumbnails failed for', info.origPath, err);
        info.failedPath = info.decodePath;
        for (const [k, j] of [...queue.entries()]) if (j.assetId === assetId) queue.delete(k);
        closeSink(assetId);
      })
      .finally(() => {
        busy.delete(assetId);
        running--;
        // yield to the UI between batches
        setTimeout(pump, 0);
      });
  }
}

async function runBatch(info: AssetInfo, jobs: Job[]) {
  if (info.kind === 'image') {
    const img = await loadImage(info.origPath);
    const nat = imageSize(img);
    const out = fitWithin(nat.width, nat.height, undefined, THUMB_HEIGHT * 2);
    const canvas = document.createElement('canvas');
    canvas.width = out.width;
    canvas.height = out.height;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, out.width, out.height);
    img.src = '';
    const bmp = await createImageBitmap(canvas);
    store(info, IMAGE_SLOT, bmp);
    return;
  }
  const entry = await sinkFor(info);
  const times = jobs.map((j) => Math.max(j.time, entry.firstTs));
  let i = 0;
  try {
    for await (const wc of entry.sink.canvasesAtTimestamps(times)) {
      const job = jobs[i++];
      if (!wc || !job) continue;
      if (infos.get(info.id) !== info || entry.retired) return; // invalidated meanwhile
      const bmp = await createImageBitmap(wc.canvas);
      store(info, job.slot, bmp);
    }
    entry.used = performance.now();
  } finally {
    if (entry.retired) entry.input.dispose();
  }
}

function store(info: AssetInfo, slot: number, bmp: ImageBitmap) {
  if (infos.get(info.id) !== info) return;
  cache.set(keyOf(info.id, slot), bmp, bmp.width * bmp.height * 4);
  notify(info.id);
}

async function sinkFor(info: AssetInfo): Promise<SinkEntry> {
  const existing = sinks.get(info.id);
  if (existing && existing.path === info.decodePath) {
    existing.used = performance.now();
    return existing;
  }
  closeSink(info.id);
  let input = openInput(info.decodePath, 8);
  let track = await input.getPrimaryVideoTrack().catch(() => null);
  if ((!track || !(await track.canDecode().catch(() => false))) && info.decodePath !== info.origPath) {
    // broken proxy: use the original
    input.dispose();
    info.decodePath = info.origPath;
    input = openInput(info.decodePath, 8);
    track = await input.getPrimaryVideoTrack().catch(() => null);
  }
  if (!track || !(await track.canDecode().catch(() => false))) {
    input.dispose();
    throw new Error('Video cannot be decoded');
  }
  const sink = new CanvasSink(track, { height: THUMB_HEIGHT, poolSize: 2 });
  const firstTs = await track.getFirstTimestamp().catch(() => 0);
  const entry: SinkEntry = { path: info.decodePath, input, sink, firstTs, used: performance.now() };
  sinks.set(info.id, entry);
  if (sinks.size > MAX_SINKS) {
    const idle = [...sinks.entries()].filter(([id]) => id !== info.id && !busy.has(id)).sort((a, b) => a[1].used - b[1].used)[0];
    if (idle) closeSink(idle[0]);
  }
  return entry;
}

function closeSink(assetId: string) {
  const e = sinks.get(assetId);
  if (!e) return;
  sinks.delete(assetId);
  // a running batch disposes it when it ends
  if (busy.has(assetId)) e.retired = true;
  else e.input.dispose();
}

function notify(assetId: string) {
  pendingNotify.add(assetId);
  if (notifyTimer) return;
  const wait = Math.max(0, NOTIFY_MS - (performance.now() - lastNotify));
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    lastNotify = performance.now();
    const ids = [...pendingNotify];
    pendingNotify.clear();
    for (const id of ids) {
      for (const l of [...listeners]) {
        try {
          l(id);
        } catch (err) {
          console.warn('[media] thumbnail listener failed', err);
        }
      }
    }
  }, wait);
}

// ---------------------------------------------------------------------------
// Posters: one sharper frame per asset for large browser cards. Decoded one
// at a time at a height bucket (multiples of 120 px), most recent first, and
// announced through onThumbnails like filmstrip thumbnails.
// ---------------------------------------------------------------------------

const POSTER_BUDGET = 64 * 1024 * 1024;
const POSTER_STEP = 120;
const posters = new LruCache<string, ImageBitmap>(POSTER_BUDGET);
const posterQueue = new Map<string, { asset: MediaAsset; time: number; height: number }>();
const posterFailed = new Set<string>();
let posterRunning = false;

const posterBucket = (h: number) => Math.min(1080, Math.max(POSTER_STEP, Math.ceil(h / POSTER_STEP) * POSTER_STEP));
const posterKey = (a: MediaAsset, time: number, bucket: number) => `${a.id}|${a.path}|${time.toFixed(3)}|${bucket}`;

/** A sharp poster at least `height` px tall (device pixels) if one is ready; never decodes. */
export function getPoster(asset: MediaAsset, time: number, height: number): ImageBitmap | null {
  const b = posterBucket(height);
  for (let k = b; k <= Math.max(b, 1080); k += POSTER_STEP) {
    const hit = posters.get(posterKey(asset, time, k));
    if (hit) return hit;
  }
  return null;
}

/** Queues a poster decode (deduplicated; the latest request runs first). */
export function requestPoster(asset: MediaAsset, time: number, height: number): void {
  if (!asset || asset.offline || (asset.kind !== 'image' && !asset.hasVideo)) return;
  const b = posterBucket(height);
  const key = posterKey(asset, time, b);
  if (posters.has(key) || posterFailed.has(key)) return;
  posterQueue.delete(key);
  posterQueue.set(key, { asset, time, height: b });
  if (posterQueue.size > 64) posterQueue.delete(posterQueue.keys().next().value as string);
  void pumpPosters();
}

async function pumpPosters() {
  if (posterRunning) return;
  posterRunning = true;
  try {
    while (posterQueue.size) {
      // newest first: what the user scrolled to most recently
      const key = [...posterQueue.keys()].pop()!;
      const job = posterQueue.get(key)!;
      posterQueue.delete(key);
      try {
        const bmp = await decodePoster(job.asset, job.time, job.height);
        if (bmp) {
          posters.set(key, bmp, bmp.width * bmp.height * 4);
          notify(job.asset.id);
        } else posterFailed.add(key);
      } catch (err) {
        posterFailed.add(key);
        console.warn('[media] poster failed', job.asset.name, err);
      }
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    posterRunning = false;
  }
}

async function decodePoster(asset: MediaAsset, time: number, height: number): Promise<ImageBitmap | null> {
  if (asset.kind === 'image') {
    const img = await loadImage(asset.path);
    const nat = imageSize(img);
    const out = fitWithin(nat.width, nat.height, undefined, height);
    const canvas = document.createElement('canvas');
    canvas.width = out.width;
    canvas.height = out.height;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, out.width, out.height);
    img.src = '';
    return createImageBitmap(canvas);
  }
  const src = sourcePathFor(asset, true);
  let input = openInput(src.path, 8);
  try {
    let track = await input.getPrimaryVideoTrack().catch(() => null);
    if ((!track || !(await track.canDecode().catch(() => false))) && src.proxy) {
      input.dispose();
      input = openInput(asset.path, 8);
      track = await input.getPrimaryVideoTrack().catch(() => null);
    }
    if (!track || !(await track.canDecode().catch(() => false))) return null;
    const dh = await track.getDisplayHeight();
    const sink = new CanvasSink(track, { height: Math.min(height, dh) });
    const first = await track.getFirstTimestamp().catch(() => 0);
    const wc = await sink.getCanvas(Math.max(time, first));
    return wc ? createImageBitmap(wc.canvas) : null;
  } finally {
    input.dispose();
  }
}
