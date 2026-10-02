// Playback timing helpers: the master clock, shuttle speeds, loop/stop
// ranges, edit-point navigation, in/out conventions and playback resolution.
// Pure (no DOM), so it is unit-tested. OWNED BY THE VIEWER PACKAGE.
//
// In/out convention used by the viewer (marking) and expected elsewhere:
// seq.inPoint / seq.outPoint (and asset.markIn / markOut) are times on the
// frame grid and describe the half-open range [in, out). Marking out "at" the
// playhead includes the frame under it, so out = playhead + 1 frame. Displays
// show the out frame inclusively (out − 1 frame), the way Premiere does.

import type { Sequence } from '../../state/types';
import { sequenceDuration } from '../../state/types';
import { EPS, fromFrames, snapToFrame, toFrames } from '../time';

// ---------------------------------------------------------------------------
// Master clock
// ---------------------------------------------------------------------------

/**
 * Timeline time while playing. Follows the audio engine's clock when one is
 * attached (sample-accurate A/V sync), otherwise wall time × rate. While the
 * audio is starting up the clock holds at the start time, and for forward
 * playback it never runs backwards when switching to the audio clock.
 */
export class MasterClock {
  private anchorWall = 0;
  private anchorTime = 0;
  private rateValue = 0;
  private audio: (() => number) | null = null;
  private holding = false;
  private last = 0;
  private audioWall = 0;
  private audioFrom = 0;
  /** Set when the audio clock disagreed with wall time and was dropped. */
  rejectedAudio: string | null = null;

  constructor(private readonly now: () => number) {}

  get rate(): number {
    return this.rateValue;
  }

  get usingAudio(): boolean {
    return this.audio !== null;
  }

  get isHolding(): boolean {
    return this.holding;
  }

  /** Runs on wall time from `t` at `rate` (timeline seconds per second). */
  startWall(t: number, rate: number): void {
    this.anchorWall = this.now();
    this.anchorTime = t;
    this.rateValue = rate;
    this.audio = null;
    this.holding = false;
    this.last = t;
  }

  /** Holds at `t` until attachAudio() supplies the audio clock (or fallbackToWall()). */
  startHeld(t: number): void {
    this.startWall(t, 1);
    this.holding = true;
  }

  attachAudio(audioTime: () => number): void {
    this.audio = audioTime;
    this.audioFrom = this.holding ? this.anchorTime : this.time();
    this.audioWall = this.now();
    this.holding = false;
  }

  /** Audio failed or is late: continue on wall time from wherever the clock is. */
  fallbackToWall(): void {
    const t = this.time();
    this.startWall(t, this.rateValue || 1);
  }

  stop(): number {
    const t = this.time();
    this.rateValue = 0;
    this.audio = null;
    this.holding = false;
    return t;
  }

  time(): number {
    let t: number;
    if (this.holding) t = this.anchorTime;
    else if (this.audio) {
      t = this.audio();
      if (!Number.isFinite(t)) t = this.last;
      // A sound card clock and wall time agree to well under a second; when the
      // audio clock runs ahead or stalls far behind, it is broken (no device,
      // virtual output): keep going on wall time instead.
      const wall = this.audioFrom + ((this.now() - this.audioWall) / 1000) * this.rateValue;
      if (t > wall + 0.35 || t < wall - 1.5) {
        this.rejectedAudio = `audio clock ${t.toFixed(3)}s vs wall ${wall.toFixed(3)}s`;
        this.audio = null;
        this.anchorTime = Math.max(this.last, Math.min(wall, this.last + 0.1));
        this.anchorWall = this.now();
        t = this.anchorTime;
      } else if (this.rateValue > 0 && t < this.last && this.last - t < 0.25) {
        // never step backwards when the audio clock takes over (it may start a hair late)
        t = this.last;
      }
    } else t = this.anchorTime + ((this.now() - this.anchorWall) / 1000) * this.rateValue;
    this.last = t;
    return t;
  }
}

// ---------------------------------------------------------------------------
// Shuttle (J / K / L)
// ---------------------------------------------------------------------------

export const SHUTTLE_SPEEDS = [1, 2, 4, 8];

/** Multi-tap J/L: pressing the same direction again doubles the speed (1×, 2×, 4×, 8×). */
export function nextShuttleRate(current: number, dir: 1 | -1): number {
  if (current === 0 || Math.sign(current) !== dir) return dir;
  const abs = Math.abs(current);
  const next = SHUTTLE_SPEEDS.find((s) => s > abs + EPS) ?? SHUTTLE_SPEEDS[SHUTTLE_SPEEDS.length - 1];
  return next * dir;
}

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

export interface PlayRange {
  start: number;
  end: number;
}

/** The loop range: in/out when set (either may be open), else the whole sequence. */
export function loopRange(seq: Pick<Sequence, 'inPoint' | 'outPoint'>, duration: number): PlayRange {
  const start = seq.inPoint !== null && seq.inPoint < duration - EPS ? Math.max(0, seq.inPoint) : 0;
  const end = seq.outPoint !== null && seq.outPoint > start + EPS ? Math.min(seq.outPoint, duration) : duration;
  return { start, end: Math.max(start, end) };
}

export type AdvanceResult = { t: number; event: 'none' | 'wrapped' | 'ended' };

/**
 * Applies the stop/loop rules to a clock time. Forward: past `range.end` it
 * wraps to the start (loop) or ends. Reverse: before `range.start` it wraps to
 * the end (loop) or ends. When it ends, t is clamped to the boundary.
 */
export function applyRange(t: number, rate: number, range: PlayRange, loop: boolean, fps: number): AdvanceResult {
  const len = range.end - range.start;
  const frame = fromFrames(1, fps);
  if (rate > 0 && t >= range.end - EPS) {
    if (loop && len > frame) return { t: range.start + ((t - range.start) % len), event: 'wrapped' };
    return { t: range.end, event: 'ended' };
  }
  if (rate < 0 && t <= range.start + EPS) {
    if (loop && len > frame) return { t: range.end - frame - ((range.start - t) % len), event: 'wrapped' };
    return { t: range.start, event: 'ended' };
  }
  return { t, event: 'none' };
}

/** Where play should start: at (or past) the end it restarts from the range start. */
export function playStartTime(t: number, range: PlayRange, fps: number, rate: number): number {
  const frame = fromFrames(1, fps);
  if (rate > 0) {
    if (t >= range.end - frame - EPS || t < range.start - EPS) return range.start;
    return t;
  }
  if (t <= range.start + EPS || t > range.end + EPS) return Math.max(range.start, range.end - frame);
  return t;
}

/** The frame shown after playback stops at the end of a range (the last frame, not black). */
export function lastFrameOf(range: PlayRange, fps: number): number {
  return Math.max(range.start, snapToFrame(range.end - fromFrames(1, fps), fps));
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

/** Out point when marking out with the playhead on frame `t` (includes that frame). */
export function markOutAt(t: number, fps: number, max: number): number {
  return Math.min(Math.max(max, fromFrames(1, fps)), snapToFrame(t, fps) + fromFrames(1, fps));
}

/** The last frame inside [in, out) — what "go to out" lands on and what the out readout shows. */
export function outFrame(out: number, fps: number): number {
  return Math.max(0, snapToFrame(out - fromFrames(1, fps), fps));
}

// ---------------------------------------------------------------------------
// Edit points (up / down navigation)
// ---------------------------------------------------------------------------

/** Clip edges on the sequence's video and audio tracks, plus 0 and the end. Sorted, unique on the frame grid. */
export function sequenceEditPoints(seq: Sequence): number[] {
  const frames = new Set<number>([0, toFrames(sequenceDuration(seq), seq.fps)]);
  for (const tr of seq.tracks) {
    if (tr.kind === 'caption') continue;
    for (const c of tr.clips) {
      frames.add(toFrames(c.start, seq.fps));
      frames.add(toFrames(c.start + c.duration, seq.fps));
    }
  }
  return [...frames].sort((a, b) => a - b).map((f) => fromFrames(f, seq.fps));
}

export function nextEditPoint(points: number[], t: number, fps: number): number | null {
  const f = toFrames(t, fps);
  for (const p of points) if (toFrames(p, fps) > f) return p;
  return null;
}

export function prevEditPoint(points: number[], t: number, fps: number): number | null {
  const f = toFrames(t, fps);
  for (let i = points.length - 1; i >= 0; i--) if (toFrames(points[i], fps) < f) return points[i];
  return null;
}

// ---------------------------------------------------------------------------
// Playback resolution
// ---------------------------------------------------------------------------

export type PlaybackScale = 'auto' | 1 | 0.5 | 0.25;
export const FIXED_SCALES = [1, 0.5, 0.25] as const;

/**
 * Render size for a frame of base size (W×H) shown in a box of `display`
 * device pixels at a playback scale: never more pixels than the sequence ×
 * scale, and never more than are visible on screen. Keeps the aspect ratio.
 */
export function renderSize(baseW: number, baseH: number, displayW: number, displayH: number, scale: number): { w: number; h: number } {
  if (!(baseW > 0) || !(baseH > 0)) return { w: 1, h: 1 };
  const shown = displayW > 0 && displayH > 0 ? Math.max(displayW / baseW, displayH / baseH) : 1;
  const k = Math.max(1 / Math.max(baseW, baseH), Math.min(scale, shown));
  return { w: Math.max(1, Math.round(baseW * k)), h: Math.max(1, Math.round(baseH * k)) };
}

/**
 * Auto playback resolution: steps down (1 → ½ → ¼) when frames take too long
 * or drop, and back up after a stretch of comfortable frames. Paused frames
 * are always rendered at full quality.
 */
export class AutoScaler {
  scale: 1 | 0.5 | 0.25 = 1;
  private slow = 0;
  private fast = 0;
  private cooldownUntil = 0;

  reset(): void {
    this.slow = 0;
    this.fast = 0;
  }

  /**
   * Feed one rendered frame: its CPU cost (ms), whether frames were dropped
   * before it, the frame budget (ms) and the current time (ms).
   */
  sample(costMs: number, dropped: boolean, budgetMs: number, nowMs: number): 1 | 0.5 | 0.25 {
    const heavy = dropped || costMs > budgetMs * 0.7;
    const light = !dropped && costMs < budgetMs * 0.25;
    this.slow = heavy ? this.slow + 1 : Math.max(0, this.slow - 1);
    this.fast = light ? this.fast + 1 : 0;
    if (nowMs < this.cooldownUntil) return this.scale;
    const i = FIXED_SCALES.indexOf(this.scale);
    if (this.slow >= 6 && i < FIXED_SCALES.length - 1) {
      this.scale = FIXED_SCALES[i + 1];
      this.slow = 0;
      this.fast = 0;
      this.cooldownUntil = nowMs + 1500;
    } else if (this.fast >= 90 && i > 0) {
      this.scale = FIXED_SCALES[i - 1];
      this.fast = 0;
      this.cooldownUntil = nowMs + 3000;
    }
    return this.scale;
  }
}

/** Label for a playback scale, e.g. 'Full', '1/2'. */
export function scaleLabel(s: number): string {
  return s >= 1 ? 'Full' : s >= 0.5 ? '1/2' : '1/4';
}

/** Sliding-window frames-per-second meter. */
export class FpsMeter {
  private stamps: number[] = [];

  tick(nowMs: number): void {
    this.stamps.push(nowMs);
    while (this.stamps.length && nowMs - this.stamps[0] > 1000) this.stamps.shift();
  }

  fps(nowMs: number): number {
    while (this.stamps.length && nowMs - this.stamps[0] > 1000) this.stamps.shift();
    if (this.stamps.length < 2) return 0;
    const span = (this.stamps[this.stamps.length - 1] - this.stamps[0]) / 1000;
    return span > 0 ? (this.stamps.length - 1) / span : 0;
  }

  reset(): void {
    this.stamps = [];
  }
}

/** Frames dropped between two rendered sequence frames at normal speed. */
export function droppedBetween(prevFrame: number | null, frame: number, rate: number): number {
  if (prevFrame === null || rate !== 1) return 0;
  return Math.max(0, frame - prevFrame - 1);
}
