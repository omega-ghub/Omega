// Live scope feed: listens to the program viewer's frame-rendered events,
// reads back a small copy of the frame (readPixels at 480 px), and runs the
// scope analysis off the main thread at most ~18 times a second. Every panel
// that needs scope data (the Scopes panel, the curve editor's histogram)
// subscribes here, so a frame is read and analyzed once for all of them.
// OWNED BY THE COLOR PACKAGE.
import { getProgramRenderer, onFrameRendered } from '../playback/viewerBus';
import type { PixelReadback } from '../gpu/Renderer';
import { ScopeEngine } from './client';
import type { ScopeRequest, ScopeResult } from './scopes';

export const READBACK_WIDTH = 480;
/** Minimum time between two analyses (≈18 fps). */
const MIN_INTERVAL_MS = 55;

export interface ScopeFeedFrame {
  /** null when there is no program viewer (or it has not drawn yet). */
  result: ScopeResult | null;
  /** Wall-clock time of the analysis. */
  at: number;
  /** Analyses per second over the last second. */
  fps: number;
}

type Listener = { req: ScopeRequest; cb: (f: ScopeFeedFrame) => void };

const listeners = new Set<Listener>();
let engine: ScopeEngine | null = null;
let unsubscribeFrames: (() => void) | null = null;
let busy = false;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastRun = 0;
let last: ScopeFeedFrame = { result: null, at: 0, fps: 0 };
const runTimes: number[] = [];

function mergedRequest(): ScopeRequest {
  const req: ScopeRequest = {};
  for (const { req: r } of listeners) {
    req.waveform ||= r.waveform;
    req.parade ||= r.parade;
    req.vectorscope ||= r.vectorscope;
    req.histogram ||= r.histogram;
    req.legality ||= r.legality;
    if (r.rows) req.rows = Math.max(req.rows ?? 0, r.rows);
    if (r.vectorSize) req.vectorSize = Math.max(req.vectorSize ?? 0, r.vectorSize);
    if (r.vectorZoom) req.vectorZoom = r.vectorZoom;
    if (r.gain) req.gain = r.gain;
  }
  return req;
}

/** Reads the current program frame (display-referred RGBA8), or null. */
export function readProgramFrame(maxWidth = READBACK_WIDTH): PixelReadback | null {
  const r = getProgramRenderer();
  if (!r) return null;
  try {
    const px = r.readPixels(maxWidth);
    if (!px || !px.width || !px.height || px.data.length < px.width * px.height * 4) return null;
    // copy: the renderer may reuse its readback buffer
    return { width: px.width, height: px.height, data: new Uint8ClampedArray(px.data.subarray(0, px.width * px.height * 4)) };
  } catch {
    return null;
  }
}

function publish(f: ScopeFeedFrame) {
  last = f;
  for (const l of listeners) l.cb(f);
}

async function run() {
  timer = null;
  if (!listeners.size) return;
  busy = true;
  dirty = false;
  lastRun = performance.now();
  try {
    const frame = readProgramFrame();
    if (!frame) {
      publish({ result: null, at: Date.now(), fps: 0 });
      return;
    }
    engine ??= new ScopeEngine();
    const result = await engine.compute(frame, mergedRequest());
    const now = performance.now();
    runTimes.push(now);
    while (runTimes.length && now - runTimes[0] > 1000) runTimes.shift();
    publish({ result, at: Date.now(), fps: runTimes.length });
  } catch {
    /* a failed analysis just skips this frame */
  } finally {
    busy = false;
    if (dirty) schedule();
  }
}

/** Requests an analysis of the current frame (throttled; the latest frame always wins). */
export function schedule() {
  if (!listeners.size) return;
  if (busy) {
    dirty = true;
    return;
  }
  if (timer) return;
  const wait = Math.max(0, MIN_INTERVAL_MS - (performance.now() - lastRun));
  timer = setTimeout(() => void run(), wait);
}

/**
 * Subscribes to live scope data. `req` says which scopes this subscriber
 * needs; the feed computes the union. Returns an unsubscribe function.
 */
export function subscribeScopes(req: ScopeRequest, cb: (f: ScopeFeedFrame) => void): () => void {
  const l: Listener = { req, cb };
  listeners.add(l);
  if (!unsubscribeFrames) unsubscribeFrames = onFrameRendered(schedule);
  if (last.result) cb(last);
  schedule();
  return () => {
    listeners.delete(l);
    if (!listeners.size) {
      unsubscribeFrames?.();
      unsubscribeFrames = null;
      if (timer) clearTimeout(timer);
      timer = null;
      engine?.dispose();
      engine = null;
    }
  };
}

/** Updates a subscriber's needs (e.g. a different scope was chosen) and refreshes. */
export function updateScopeRequest(cb: (f: ScopeFeedFrame) => void, req: ScopeRequest) {
  for (const l of listeners) if (l.cb === cb) l.req = req;
  schedule();
}

/** The most recent analysis, if any. */
export function lastScopeFrame(): ScopeFeedFrame {
  return last;
}
