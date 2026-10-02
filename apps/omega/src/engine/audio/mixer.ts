// Source resolution (decoded assets, rendered nested sequences) and the
// offline mixdown. renderMix builds the SAME graph as playback (graph.ts) in
// OfflineAudioContexts.
//
// Long ranges are rendered in 60 s segments. Each segment after the first
// starts 1 s early (pre-roll) so filters, compressors and the limiter are
// warmed up exactly as in a continuous render, and the pre-roll is discarded;
// sources are placed by the same sample-exact timeline→source mapping in every
// segment, so the stitched result is continuous. The master limiter's
// lookahead delay is compensated. Ranges up to 90 s render in one pass.

import type { Project, Sequence } from '../../state/types';
import { sequenceDuration } from '../../state/types';
import { findRange, isCached, pin, PRIORITY_EXPORT, putRendered, reversedOf, unpin, ensureRange, type DecodedRange } from './cache';
import { createMaster, createTrackBus, scheduleClip, type SourceBuffer, type TimeMap } from './graph';
import { limiterLatencyFrames } from './limiterCore';
import { clipsInRange, planMix, type ClipPlan } from './plan';

export const MAX_NEST_DEPTH = 8;
const SEGMENT_SECONDS = 60;
const SINGLE_PASS_MAX = 90;
const PREROLL = 1;

export interface ResolvedSource {
  entry: DecodedRange;
  src: SourceBuffer;
}

function toSource(entry: DecodedRange, reverse: boolean): SourceBuffer {
  return reverse
    ? { buffer: reversedOf(entry), start: entry.start, end: entry.end, reversed: true }
    : { buffer: entry.buffer, start: entry.start, end: entry.end, reversed: false };
}

// Nested sequences are rendered once per (sequence object, rate): any edit
// inside the nest produces a new object, so the cache never goes stale.
interface NestedRender {
  promise: Promise<DecodedRange | null>;
  /** undefined while rendering */
  value: DecodedRange | null | undefined;
}
const nested = new WeakMap<Sequence, Map<number, NestedRender>>();

function nestedNow(seq: Sequence, sr: number): DecodedRange | null {
  const e = nested.get(seq)?.get(sr)?.value ?? null;
  return e && isCached(e) ? e : null;
}

function nestedEntry(project: Project, seq: Sequence, sr: number, depth: number): Promise<DecodedRange | null> {
  let bySr = nested.get(seq);
  if (!bySr) nested.set(seq, (bySr = new Map()));
  const have = nestedNow(seq, sr);
  if (have) return Promise.resolve(have);
  const existing = bySr.get(sr);
  if (existing && existing.value === undefined) return existing.promise; // still rendering
  const rec: NestedRender = { value: undefined, promise: Promise.resolve(null) };
  rec.promise = (async () => {
    const dur = sequenceDuration(seq);
    let e: DecodedRange | null = null;
    if (dur > 0) {
      try {
        const buf = await renderMixInternal(project, seq.id, 0, dur, { sampleRate: sr, depth });
        e = putRendered(`seq:${seq.id}`, buf);
      } catch (err) {
        console.warn('Nested sequence mixdown failed', err);
      }
    }
    rec.value = e;
    return e;
  })();
  bySr.set(sr, rec);
  return rec.promise;
}

/** A source that is already decoded/rendered, without waiting. */
export function sourceNow(project: Project, cp: ClipPlan, sr: number): ResolvedSource | null {
  let e: DecodedRange | null = null;
  if (cp.source.kind === 'asset') e = findRange(cp.source.id, sr, cp.src0, cp.src1);
  else {
    const seq = project.sequences.find((s) => s.id === cp.source.id);
    e = seq ? nestedNow(seq, sr) : null;
  }
  return e ? { entry: e, src: toSource(e, cp.reverse) } : null;
}

/** Decodes (or renders) a clip's source. Resolves to null for silent/broken media. */
export async function resolveSource(project: Project, cp: ClipPlan, sr: number, priority: number, depth = 0): Promise<ResolvedSource | null> {
  let e: DecodedRange | null = null;
  if (cp.source.kind === 'asset') {
    const asset = project.assets.find((a) => a.id === cp.source.id);
    if (!asset) return null;
    e = await ensureRange(asset, sr, cp.src0, cp.src1, priority);
  } else {
    if (depth >= MAX_NEST_DEPTH) return null;
    const seq = project.sequences.find((s) => s.id === cp.source.id);
    if (!seq) return null;
    e = await nestedEntry(project, seq, sr, depth + 1);
  }
  return e ? { entry: e, src: toSource(e, cp.reverse) } : null;
}

export interface RenderOptions {
  sampleRate?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  depth?: number;
}

function abortError() {
  return new DOMException('The mixdown was cancelled', 'AbortError');
}

/**
 * Streams the mixdown of [start, end) as consecutive stereo AudioBuffers
 * (≤ 60 s each), for exports that should not hold a whole program in memory.
 */
export async function* renderMixStream(project: Project, sequenceId: string, start: number, end: number, opts: RenderOptions = {}): AsyncGenerator<AudioBuffer> {
  const seq = project.sequences.find((s) => s.id === sequenceId);
  const sr = opts.sampleRate ?? seq?.sampleRate ?? project.settings.sampleRate ?? 48000;
  const total = Math.max(1, Math.ceil((end - start) * sr));
  if (!seq) {
    yield new AudioBuffer({ numberOfChannels: 2, length: total, sampleRate: sr });
    return;
  }
  const depth = opts.depth ?? 0;
  const plan = planMix(project, seq);
  const clips = clipsInRange(plan, start - PREROLL, end + 1);
  const report = (f: number) => opts.onProgress?.(Math.max(0, Math.min(1, f)));

  // 1. decode / render every source the range needs
  const sources = new Map<string, ResolvedSource>();
  let done = 0;
  await Promise.all(
    clips.map(async (cp) => {
      const r = await resolveSource(project, cp, sr, PRIORITY_EXPORT, depth);
      if (r) {
        sources.set(cp.id, r);
        pin(r.entry);
      }
      report((0.15 * ++done) / Math.max(1, clips.length));
    }),
  );
  try {
    if (opts.signal?.aborted) throw abortError();
    const segFrames = total <= SINGLE_PASS_MAX * sr ? total : SEGMENT_SECONDS * sr;
    const segments = Math.ceil(total / segFrames);
    const latExpected = seq.master.limiter ? limiterLatencyFrames(sr) : 0;
    for (let k = 0; k < segments; k++) {
      if (opts.signal?.aborted) throw abortError();
      const f0 = k * segFrames;
      const frames = Math.min(segFrames, total - f0);
      const segStart = start + f0 / sr;
      const preFrames = Math.max(0, Math.min(Math.round(PREROLL * sr), Math.floor(segStart * sr)));
      const tl0 = segStart - preFrames / sr;
      const length = preFrames + frames + latExpected;
      const ctx = new OfflineAudioContext(2, length, sr);
      const master = await createMaster(ctx, seq.master, { meters: false, alwaysLimiter: false });
      const lat = master.latencyFrames;
      const buses = new Map(plan.tracks.filter((t) => t.audible).map((t) => [t.id, createTrackBus(ctx, t, master.input, false)]));
      const map: TimeMap = { tl0, ctx0: 0 };
      const segEnd = tl0 + length / sr;
      for (const cp of clips) {
        if (cp.t1 <= tl0 || cp.t0 >= segEnd) continue;
        const bus = buses.get(cp.trackId);
        const src = sources.get(cp.id);
        if (!bus || !src) continue;
        scheduleClip(ctx, cp, src.src, bus.input, map, tl0, segEnd);
      }
      // progress inside long segments
      const base = 0.15 + (0.85 * k) / segments;
      const span = 0.85 / segments;
      const step = 10 * sr;
      for (let f = step; f < length - 256; f += step) {
        const frac = f / length;
        ctx.suspend(f / sr).then(
          () => {
            report(base + span * frac);
            void ctx.resume();
          },
          () => {},
        );
      }
      const rendered = await ctx.startRendering();
      master.dispose();
      const out = new AudioBuffer({ numberOfChannels: 2, length: frames, sampleRate: sr });
      for (let c = 0; c < 2; c++) out.copyToChannel(rendered.getChannelData(c).subarray(preFrames + lat, preFrames + lat + frames), c);
      report(base + span);
      yield out;
    }
  } finally {
    for (const r of sources.values()) unpin(r.entry);
  }
}

export async function renderMixInternal(project: Project, sequenceId: string, start: number, end: number, opts: RenderOptions = {}): Promise<AudioBuffer> {
  const seq = project.sequences.find((s) => s.id === sequenceId);
  const sr = opts.sampleRate ?? seq?.sampleRate ?? project.settings.sampleRate ?? 48000;
  const total = Math.max(1, Math.ceil((end - start) * sr));
  const out = new AudioBuffer({ numberOfChannels: 2, length: total, sampleRate: sr });
  let o = 0;
  for await (const part of renderMixStream(project, sequenceId, start, end, { ...opts, sampleRate: sr })) {
    for (let c = 0; c < 2; c++) out.copyToChannel(part.getChannelData(c).subarray(0, Math.min(part.length, total - o)), c, o);
    o += part.length;
  }
  return out;
}
