// Time, frames and timecode. Timeline times are seconds (floats); editing
// snaps them to the sequence's frame grid with these helpers so a clip edge
// is always on a frame boundary, even at 23.976 or 59.94.

import type { Clip } from '../state/types';
import { evaluate } from './keyframes';

export const EPS = 1e-6;

export function frameDuration(fps: number): number {
  return 1 / fps;
}

/** Exact NTSC rates: 23.976 → 24000/1001 etc. */
export function exactRate(fps: number): number {
  if (Math.abs(fps - 23.976) < 0.01) return 24000 / 1001;
  if (Math.abs(fps - 29.97) < 0.01) return 30000 / 1001;
  if (Math.abs(fps - 47.952) < 0.01) return 48000 / 1001;
  if (Math.abs(fps - 59.94) < 0.01) return 60000 / 1001;
  if (Math.abs(fps - 119.88) < 0.01) return 120000 / 1001;
  return fps;
}

export function toFrames(seconds: number, fps: number): number {
  return Math.round(seconds * exactRate(fps) + EPS);
}

export function fromFrames(frames: number, fps: number): number {
  return frames / exactRate(fps);
}

export function snapToFrame(seconds: number, fps: number): number {
  return fromFrames(toFrames(seconds, fps), fps);
}

function pad(n: number, w = 2) {
  return String(Math.max(0, Math.floor(n))).padStart(w, '0');
}

/**
 * SMPTE timecode. Drop-frame (29.97 / 59.94) uses ';' before frames and
 * skips frame numbers 0–1 (or 0–3) every minute except each tenth minute.
 */
export function formatTimecode(seconds: number, fps: number, dropFrame = false, startTimecode = 0): string {
  const negative = seconds + startTimecode < -EPS;
  let totalFrames = toFrames(Math.abs(seconds + startTimecode), fps);
  const nominal = Math.round(exactRate(fps));
  let text: string;
  if (dropFrame && (nominal === 30 || nominal === 60)) {
    const drop = nominal === 30 ? 2 : 4;
    const per10 = nominal * 600 - drop * 9;
    const perMin = nominal * 60 - drop;
    const d = Math.floor(totalFrames / per10);
    const m = totalFrames % per10;
    totalFrames += drop * 9 * d + (m > drop ? drop * Math.floor((m - drop) / perMin) : 0);
    const ff = totalFrames % nominal;
    const ss = Math.floor(totalFrames / nominal) % 60;
    const mm = Math.floor(totalFrames / (nominal * 60)) % 60;
    const hh = Math.floor(totalFrames / (nominal * 3600));
    text = `${pad(hh)}:${pad(mm)}:${pad(ss)};${pad(ff)}`;
  } else {
    const ff = totalFrames % nominal;
    const s = Math.floor(totalFrames / nominal);
    text = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(ff)}`;
  }
  return negative ? `-${text}` : text;
}

/**
 * Parses what an editor types into a timecode field:
 *  "01:00:10:12", "1:10:12" (right-aligned), "10.12" / "10;12" separators,
 *  "+12" / "-1:00" (relative to `relativeTo`), "250" (frames when no separator).
 * Returns seconds on the timeline (startTimecode removed), or null.
 */
export function parseTimecode(input: string, fps: number, relativeTo = 0, startTimecode = 0, dropFrame = false): number | null {
  const s = input.trim();
  if (!s) return null;
  const rel = s[0] === '+' || s[0] === '-' ? s[0] : null;
  const body = rel ? s.slice(1) : s;
  if (!/^[\d:;.,]+$/.test(body)) return null;
  const parts = body.split(/[:;.,]/).map((p) => (p === '' ? 0 : Number(p)));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  const nominal = Math.round(exactRate(fps));
  let frames: number;
  if (parts.length === 1) {
    frames = parts[0];
  } else {
    while (parts.length < 4) parts.unshift(0);
    const [hh, mm, ss, ff] = parts.slice(-4);
    frames = ((hh * 60 + mm) * 60 + ss) * nominal + ff;
    if (dropFrame && (nominal === 30 || nominal === 60)) {
      const drop = nominal === 30 ? 2 : 4;
      const totalMinutes = hh * 60 + mm;
      frames -= drop * (totalMinutes - Math.floor(totalMinutes / 10));
    }
  }
  const seconds = fromFrames(frames, fps);
  if (rel === '+') return relativeTo + seconds;
  if (rel === '-') return relativeTo - seconds;
  return seconds - startTimecode;
}

// ---------------------------------------------------------------------------
// Source-time mapping (speed, reverse, ramps, freeze frames)
// ---------------------------------------------------------------------------

const RAMP_STEP = 1 / 480; // integration step for speed ramps (seconds)

/** Speed at a clip-local time (keyframed ramps override the constant speed). */
export function speedAt(clip: Clip, local: number): number {
  const kfs = clip.keyframes['time.speed'];
  return kfs && kfs.length ? evaluate(kfs, local) : clip.speed;
}

/** Source seconds consumed from the clip start up to clip-local time `local`. */
export function sourceElapsed(clip: Clip, local: number): number {
  const kfs = clip.keyframes['time.speed'];
  if (!kfs || !kfs.length) return Math.max(0, local) * clip.speed;
  let acc = 0;
  let t = 0;
  const end = Math.max(0, local);
  while (t < end) {
    const dt = Math.min(RAMP_STEP, end - t);
    // midpoint rule
    acc += evaluate(kfs, t + dt / 2) * dt;
    t += dt;
  }
  return Math.max(0, acc);
}

/** Total source seconds the clip spans. */
export function sourceSpan(clip: Clip): number {
  return sourceElapsed(clip, clip.duration);
}

/**
 * Source time (seconds into the media / nested sequence) shown at clip-local
 * time `local` (0 = first frame of the clip).
 */
export function sourceTimeAt(clip: Clip, local: number): number {
  if (clip.holdFrame !== null && clip.holdFrame !== undefined) return clip.holdFrame;
  const l = Math.max(0, Math.min(local, clip.duration));
  if (clip.reverse) return clip.inPoint + sourceSpan(clip) - sourceElapsed(clip, l);
  return clip.inPoint + sourceElapsed(clip, l);
}

/** Timeline duration needed to play `sourceSeconds` at constant `speed`. */
export function durationForSpeed(sourceSeconds: number, speed: number): number {
  return speed > 0 ? sourceSeconds / speed : sourceSeconds;
}

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration;
}

export function isActiveAt(clip: Clip, t: number): boolean {
  return clip.enabled && t >= clip.start - EPS && t < clip.start + clip.duration - EPS;
}
