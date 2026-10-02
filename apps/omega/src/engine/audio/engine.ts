// Audio engine. OWNED BY THE AUDIO PACKAGE.
// Public API used by the viewer (playback clock), the timeline (waveforms),
// the mixer (meters) and export (offline mixdown).
//
// Realtime playback builds a Web Audio graph from a MixPlan (plan.ts) with the
// shared builder (graph.ts) in an AudioContext running at the sequence rate.
// Clips are scheduled sample-accurately in a sliding window ahead of the
// playhead; sources that are still decoding join late (with a 4 ms fade-in).
// The same builder renders the offline mixdown, so export sounds exactly like
// playback.

import { useEditor } from '../../state/store';
import type { Project, Sequence } from '../../state/types';
import { activeSequence } from '../../state/types';
import { ensurePeaks, failureOf, onPeaksReady, peaksOf, pin, PRIORITY_PLAYBACK, unpin, type DecodedRange } from './cache';
import { createMaster, createTrackBus, detectCompressorMakeup, scheduleClip, SILENT_METER, type MasterBus, type Meter, type ScheduledClip, type TimeMap, type TrackBus } from './graph';
import { analyzeLoudness as analyze, type AudioBufferLike, type LoudnessResult } from './loudness';
import { renderMixInternal, resolveSource, sourceNow } from './mixer';
import { clipsInRange, planMix, type MixPlan } from './plan';
import { pickLevel, type Peaks } from './peaks';

export type { Meter } from './graph';
export type { Peaks } from './peaks';
export type { LoudnessResult, AudioBufferLike, NormalizationPlan } from './loudness';
export { analyzeLoudnessAsync, applyGainWithLimiter, normalizeGain, planNormalization, LoudnessMeter } from './loudness';
export { computeDucking, clipPeakDb } from './analysis';
export type { DuckingOptions, DuckResult } from './ducking';
export { renderMixStream } from './mixer';
export { cacheBytes, MEMORY_CAP } from './cache';

/** Seconds between "play" and the first scheduled sample (scheduling headroom). */
const LEAD = 0.06;
/** Earliest a late-joining source may start, ahead of the context clock. */
const SAFETY = 0.03;
/** How far ahead clips are scheduled. */
const HORIZON = 6;
/** How far ahead sources are decoded. */
const PREFETCH = 30;
const TICK_MS = 100;

interface Session {
  plan: MixPlan;
  sampleRate: number;
  map: TimeMap;
  buses: Map<string, TrackBus>;
  scheduled: Map<string, { sc: ScheduledClip; entry: DecodedRange; ended: boolean }>;
  requested: Set<string>;
  timer: ReturnType<typeof setInterval> | null;
}

type ClockMode = 'pending' | 'audio' | 'perf';

const silent = (): Meter => ({ ...SILENT_METER });

export class AudioEngine {
  private static instance: AudioEngine | null = null;
  static get(): AudioEngine {
    return (this.instance ??= new AudioEngine());
  }

  playing = false;
  /** Playback rate of the current play() (≠ 1 plays silently). */
  rate = 1;

  private ctx: AudioContext | null = null;
  private master: MasterBus | null = null;
  private ctxReady: Promise<AudioContext> | null = null;
  private project: Project | null = null;
  private sequenceId: string | null = null;
  private storeUnsub: (() => void) | null = null;
  private session: Session | null = null;
  private token = 0;
  private gestureHooked = false;

  private mode: ClockMode = 'pending';
  private tl0 = 0;
  private ctx0 = 0;
  private perf0 = 0;
  private last = 0;
  private frozen = 0;
  private lastCtxTime = -1;
  private lastCtxPerf = 0;

  private scrubClips: ScheduledClip[] = [];
  private scrubBuses: TrackBus[] = [];
  private lastScrub = 0;
  private planCache: { project: Project; seq: Sequence; plan: MixPlan } | null = null;

  // ---------------------------------------------------------------------------
  // Document
  // ---------------------------------------------------------------------------

  /** The engine re-reads the document on every play; call when it changes while playing. */
  setProject(project: Project, sequenceId: string): void {
    this.project = project;
    this.sequenceId = sequenceId;
    const s = this.session;
    const ctx = this.ctx;
    if (!s || !ctx || !this.playing) return;
    const seq = project.sequences.find((q) => q.id === sequenceId);
    if (!seq) return;
    if ((seq.sampleRate || 48000) !== s.sampleRate) {
      // a format change cannot be applied live
      void this.play(this.currentTime(), this.rate);
      return;
    }
    const plan = this.planFor(project, seq);
    const now = ctx.currentTime;
    this.master?.update(seq.master, now);
    for (const tp of plan.tracks) {
      let bus = s.buses.get(tp.id);
      if (!bus && this.master) {
        bus = createTrackBus(ctx, tp, this.master.input, true);
        s.buses.set(tp.id, bus);
      }
      bus?.update(tp, now);
    }
    const byId = new Map(plan.clips.map((c) => [c.id, c]));
    for (const [id, rec] of s.scheduled) {
      const cp = byId.get(id);
      if (!cp || cp.sig !== rec.sc.sig || cp.trackId !== rec.sc.trackId) {
        rec.sc.stop(now);
        if (!rec.ended) unpin(rec.entry);
        s.scheduled.delete(id);
        continue;
      }
      if (!rec.ended) rec.sc.update(cp, now);
    }
    s.plan = plan;
    this.tick();
  }

  private planFor(project: Project, seq: Sequence): MixPlan {
    const c = this.planCache;
    if (c && c.project === project && c.seq === seq) return c.plan;
    const plan = planMix(project, seq);
    this.planCache = { project, seq, plan };
    return plan;
  }

  /** Follow the editor store when the caller does not push documents itself. */
  private attachStore() {
    if (this.storeUnsub) return;
    this.storeUnsub = useEditor.subscribe((state, prev) => {
      const p = state.project;
      if (!p || p === prev.project) return;
      if (this.project && this.project !== prev.project) return; // someone else drives setProject
      const id = this.sequenceId && p.sequences.some((s) => s.id === this.sequenceId) ? this.sequenceId : p.activeSequenceId;
      this.setProject(p, id);
    });
  }

  private current(): { project: Project; seq: Sequence } | null {
    const project = this.project ?? useEditor.getState().project;
    if (!project) return null;
    if (!this.project) {
      this.project = project;
      this.sequenceId = project.activeSequenceId;
    }
    const seq = project.sequences.find((s) => s.id === this.sequenceId) ?? activeSequence(project);
    return seq ? { project, seq } : null;
  }

  // ---------------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------------

  /** The realtime AudioContext (created at the sequence rate on first use). */
  async context(sampleRate?: number): Promise<AudioContext> {
    const want = sampleRate ?? this.current()?.seq.sampleRate ?? 48000;
    if (this.ctx && this.ctx.state !== 'closed' && this.ctx.sampleRate === want && this.master) {
      await this.resume();
      return this.ctx;
    }
    if (this.ctxReady) {
      const c = await this.ctxReady;
      if (c.sampleRate === want && c.state !== 'closed') {
        await this.resume();
        return c;
      }
    }
    this.ctxReady = (async () => {
      if (this.ctx) {
        this.master?.dispose();
        this.master = null;
        void this.ctx.close().catch(() => {});
      }
      let ctx: AudioContext;
      try {
        ctx = new AudioContext({ sampleRate: want, latencyHint: 'interactive' });
      } catch {
        ctx = new AudioContext({ latencyHint: 'interactive' });
      }
      this.ctx = ctx;
      const seq = this.current()?.seq;
      this.master = await createMaster(ctx, seq?.master ?? { gain: 0, limiter: true, ceiling: -1 }, { meters: true, alwaysLimiter: true });
      void detectCompressorMakeup();
      this.hookGestures();
      return ctx;
    })();
    const ctx = await this.ctxReady;
    await this.resume();
    return ctx;
  }

  /** Resume a suspended context (autoplay policy); never blocks for long. */
  async resume(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
  }

  private hookGestures() {
    if (this.gestureHooked || typeof window === 'undefined') return;
    this.gestureHooked = true;
    const wake = () => void this.resume();
    window.addEventListener('pointerdown', wake, { capture: true });
    window.addEventListener('keydown', wake, { capture: true });
  }

  /** Seconds between scheduling a sample and hearing it (output + limiter lookahead). */
  outputLatency(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    return (ctx.outputLatency || ctx.baseLatency || 0) + (this.master?.latency ?? 0);
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  /** Starts audio at timeline time `from`; resolves once sound is scheduled. */
  async play(from: number, rate = 1): Promise<void> {
    this.teardown();
    const token = ++this.token;
    this.playing = true;
    this.rate = rate;
    this.tl0 = from;
    this.last = from;
    this.frozen = from;
    this.mode = 'pending';
    this.attachStore();
    const cur = this.current();
    if (!cur || rate !== 1) {
      this.startPerfClock(from);
      return;
    }
    let ctx: AudioContext;
    try {
      ctx = await this.context(cur.seq.sampleRate || 48000);
    } catch (err) {
      console.warn('Audio output unavailable; playing silently', err);
      if (token === this.token) this.startPerfClock(from);
      return;
    }
    if (token !== this.token) return;
    const { project, seq } = this.current() ?? cur;
    const plan = this.planFor(project, seq);
    const sr = ctx.sampleRate;
    this.master?.update(seq.master, ctx.currentTime);

    // Give sources under the playhead a moment to decode so playback starts complete.
    const first = clipsInRange(plan, from, from + 1.5).filter((cp) => !sourceNow(project, cp, sr));
    if (first.length) {
      await Promise.race([Promise.all(first.map((cp) => resolveSource(project, cp, sr, PRIORITY_PLAYBACK))), new Promise((r) => setTimeout(r, 400))]);
      if (token !== this.token) return;
    }

    const ctx0 = ctx.currentTime + LEAD;
    const s: Session = {
      plan,
      sampleRate: sr,
      map: { tl0: from, ctx0 },
      buses: new Map(),
      scheduled: new Map(),
      requested: new Set(),
      timer: null,
    };
    for (const tp of plan.tracks) if (this.master) s.buses.set(tp.id, createTrackBus(ctx, tp, this.master.input, true));
    this.session = s;
    if (ctx.state === 'running') {
      this.mode = 'audio';
      this.ctx0 = ctx0;
      this.lastCtxTime = ctx.currentTime;
      this.lastCtxPerf = performance.now();
    } else this.startPerfClock(from);
    this.tick();
    s.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private startPerfClock(from: number) {
    this.mode = 'perf';
    this.tl0 = from;
    this.perf0 = performance.now();
  }

  stop(): void {
    if (this.playing) this.frozen = this.currentTime();
    this.playing = false;
    this.token++;
    this.teardown();
  }

  private teardown() {
    const s = this.session;
    this.session = null;
    if (!s) return;
    if (s.timer) clearInterval(s.timer);
    const now = this.ctx?.currentTime ?? 0;
    for (const rec of s.scheduled.values()) {
      rec.sc.stop(now);
      if (!rec.ended) unpin(rec.entry);
    }
    // let the 8 ms stop fades finish before disconnecting the buses
    setTimeout(() => {
      for (const b of s.buses.values()) b.dispose();
    }, 60);
  }

  /** Schedules everything that starts within the horizon; requests decodes ahead of it. */
  private tick() {
    const s = this.session;
    const ctx = this.ctx;
    if (!s || !ctx || this.session !== s) return;
    const cur = this.current();
    if (!cur) return;
    const earliest = s.map.tl0 + (ctx.currentTime + SAFETY - s.map.ctx0);
    const horizon = earliest + HORIZON;
    const audible = new Set(s.plan.tracks.filter((t) => t.audible).map((t) => t.id));
    for (const cp of s.plan.clips) {
      if (cp.t0 > earliest + PREFETCH) break;
      if (s.scheduled.has(cp.id) || !audible.has(cp.trackId) || cp.t1 <= earliest) continue;
      const res = sourceNow(cur.project, cp, s.sampleRate);
      if (!res) {
        if (!s.requested.has(cp.id)) {
          s.requested.add(cp.id);
          void resolveSource(cur.project, cp, s.sampleRate, PRIORITY_PLAYBACK).then((r) => {
            if (r) s.requested.delete(cp.id);
            if (this.session === s) this.tick();
          });
        }
        continue;
      }
      if (cp.t0 > horizon) continue;
      const bus = s.buses.get(cp.trackId);
      if (!bus) continue;
      const from = Math.max(cp.t0, earliest);
      const sc = scheduleClip(ctx, cp, res.src, bus.input, s.map, from, Infinity, { guardIn: from > cp.t0 + 1e-4 ? 0.004 : 0 });
      if (!sc) continue;
      pin(res.entry);
      const rec = { sc, entry: res.entry, ended: false };
      s.scheduled.set(cp.id, rec);
      sc.onEnded(() => {
        if (!rec.ended) {
          rec.ended = true;
          unpin(rec.entry);
        }
      });
    }
  }

  /** Current timeline time according to the audio clock (only meaningful while playing). */
  currentTime(): number {
    if (!this.playing) return this.frozen;
    let t: number;
    if (this.mode === 'pending') t = this.tl0;
    else if (this.mode === 'audio' && this.ctx) {
      const ctx = this.ctx;
      const nowPerf = performance.now();
      const ct = ctx.currentTime;
      if (ct !== this.lastCtxTime) {
        this.lastCtxTime = ct;
        this.lastCtxPerf = nowPerf;
      }
      const stalled = nowPerf - this.lastCtxPerf > 250;
      if (ctx.state !== 'running' || stalled) {
        // No audio output (device lost, suspended): keep time with the system clock.
        this.mode = 'perf';
        this.tl0 = this.last;
        this.perf0 = nowPerf;
        t = this.last;
      } else {
        t = this.tl0 + (this.audibleContextTime(ctx, nowPerf) - this.ctx0);
        if (t < this.tl0) t = this.tl0;
      }
    } else t = this.tl0 + ((performance.now() - this.perf0) / 1000) * this.rate;
    if (this.rate > 0 ? t < this.last : t > this.last) t = this.last;
    this.last = t;
    return t;
  }

  /** Context time of the sample reaching the speakers right now. */
  private audibleContextTime(ctx: AudioContext, nowPerf: number): number {
    const lim = this.master?.latency ?? 0;
    try {
      const ts = ctx.getOutputTimestamp?.();
      if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.contextTime > 0 && ts.performanceTime > 0) {
        return ts.contextTime + (nowPerf - ts.performanceTime) / 1000 - lim;
      }
    } catch {
      /* fall through */
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) - lim;
  }

  /** Plays a ~60 ms snippet at timeline time t (audio scrubbing while paused). */
  scrub(t: number): void {
    if (this.playing) return;
    const now = performance.now();
    if (now - this.lastScrub < 30) return;
    this.lastScrub = now;
    void this.scrubAsync(t).catch(() => {});
  }

  private async scrubAsync(t: number) {
    const cur = this.current();
    if (!cur) return;
    const ctx = await this.context(cur.seq.sampleRate || 48000);
    if (this.playing || !this.master) return;
    const plan = this.planFor(cur.project, cur.seq);
    const now = ctx.currentTime;
    for (const c of this.scrubClips) c.stop(now);
    const oldBuses = this.scrubBuses;
    setTimeout(() => oldBuses.forEach((b) => b.dispose()), 80);
    this.scrubClips = [];
    this.scrubBuses = [];
    const dur = 0.06;
    const map: TimeMap = { tl0: t, ctx0: now + 0.01 };
    const buses = new Map<string, TrackBus>();
    this.master.update(cur.seq.master, now);
    for (const cp of clipsInRange(plan, t, t + dur)) {
      const res = sourceNow(cur.project, cp, ctx.sampleRate);
      if (!res) {
        void resolveSource(cur.project, cp, ctx.sampleRate, PRIORITY_PLAYBACK);
        continue;
      }
      let bus = buses.get(cp.trackId);
      if (!bus) {
        const tp = plan.tracks.find((x) => x.id === cp.trackId)!;
        bus = createTrackBus(ctx, tp, this.master.input, false);
        buses.set(cp.trackId, bus);
        this.scrubBuses.push(bus);
      }
      const sc = scheduleClip(ctx, cp, res.src, bus.input, map, t, t + dur, { guardIn: 0.003, guardOut: 0.008 });
      if (sc) this.scrubClips.push(sc);
    }
  }

  // ---------------------------------------------------------------------------
  // Meters
  // ---------------------------------------------------------------------------

  meters(): { master: Meter; tracks: Record<string, Meter> } {
    const tracks: Record<string, Meter> = {};
    const s = this.session;
    if (!s || !this.playing) return { master: silent(), tracks };
    for (const [id, bus] of s.buses) tracks[id] = bus.meter?.read() ?? silent();
    return { master: this.master?.meter?.read() ?? silent(), tracks };
  }

  /** Master limiter gain reduction right now (dB, ≥ 0). */
  limiterReduction(): number {
    if (!this.playing || !this.master?.meter || !this.master.preMeter) return 0;
    const pre = this.master.preMeter.read();
    const post = this.master.meter.read();
    const a = Math.max(pre.peakL, pre.peakR);
    const b = Math.max(post.peakL, post.peakR);
    return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, a - b) : 0;
  }
}

// ---------------------------------------------------------------------------
// Waveform peaks
// ---------------------------------------------------------------------------

/** Waveform peaks for an asset (finest level, 256 samples per bucket), or null if not computed yet (call requestPeaks). */
export function getPeaks(assetId: string): Peaks | null {
  return peaksOf(assetId)?.[0] ?? null;
}

/** The coarsest peak level that still has at least one bucket per pixel (256 / 2048 / 16384 samples per bucket). */
export function getPeaksLevel(assetId: string, samplesPerPixel: number): Peaks | null {
  const levels = peaksOf(assetId);
  return levels ? pickLevel(levels, samplesPerPixel) : null;
}

/** All peak levels, finest first. */
export function getPeakLevels(assetId: string): Peaks[] | null {
  return peaksOf(assetId);
}

/** Decodes the asset's audio (cached) and computes peaks. Resolves when ready. */
export async function requestPeaks(project: Project, assetId: string): Promise<Peaks | null> {
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset || asset.offline || !asset.hasAudio) return null;
  const have = peaksOf(assetId);
  if (have) return have[0];
  const seq = project.sequences.find((s) => s.id === project.activeSequenceId) ?? project.sequences[0];
  const sr = seq?.sampleRate ?? project.settings.sampleRate ?? 48000;
  try {
    const levels = await ensurePeaks(asset, sr);
    return levels?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Subscribe to "peaks ready" notifications (timeline redraws). */
export function onPeaks(cb: (assetId: string) => void): () => void {
  return onPeaksReady(cb);
}

/** Why an asset has no audio (decode failure), or null. */
export function audioFailure(assetId: string): string | null {
  return failureOf(assetId);
}

// ---------------------------------------------------------------------------
// Offline mixdown & analysis
// ---------------------------------------------------------------------------

/**
 * Offline mixdown of [start, end) of a sequence, exactly as playback sounds
 * (same graph, master limiter included). Stereo at `sampleRate` (default: the
 * sequence rate). Long ranges render in 60 s segments with a 1 s warm-up
 * pre-roll each; see mixer.ts. Throws an AbortError when `signal` aborts.
 */
export async function renderMix(
  project: Project,
  sequenceId: string,
  start: number,
  end: number,
  sampleRate?: number,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<AudioBuffer> {
  return renderMixInternal(project, sequenceId, start, end, { sampleRate, onProgress, signal });
}

/** ITU-R BS.1770-4 / EBU R128 loudness measurement. */
export function analyzeLoudness(buffer: AudioBufferLike): LoudnessResult {
  return analyze(buffer);
}
