// Adaptive ruler ticks: whole frames when zoomed in, then seconds, then
// minutes. Ticks are placed on whole frame numbers so they line up with the
// timecode labels exactly, including at 23.976 / 29.97 / 59.94.

import { exactRate, formatTimecode, fromFrames, toFrames } from '../../../engine/time';

export interface RulerTicks {
  /** Major ticks with labels. */
  major: { t: number; label: string }[];
  /** Minor tick times. */
  minor: number[];
  /** Major step in frames. */
  stepFrames: number;
  /** Minor step in frames. */
  minorFrames: number;
  /** True when individual frames are wide enough to draw as frame cells. */
  frameCells: boolean;
}

/** Candidate major steps, in frames, for a nominal frame rate. */
export function stepCandidates(nominal: number): number[] {
  const frameSteps = [1, 2, 5, 10].filter((n) => n < nominal);
  if (nominal % 2 === 0 || nominal > 10) frameSteps.push(Math.round(nominal / 2));
  const seconds = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 18000, 36000];
  const out = [...new Set([...frameSteps, ...seconds.map((s) => s * nominal)])];
  return out.sort((a, b) => a - b);
}

/**
 * @param zoom pixels per second
 * @param t0,t1 visible time range (seconds)
 * @param minMajorPx minimum distance between labelled ticks
 */
export function rulerTicks(zoom: number, fps: number, t0: number, t1: number, opts: { dropFrame?: boolean; startTimecode?: number; minMajorPx?: number } = {}): RulerTicks {
  const rate = exactRate(fps);
  const nominal = Math.round(rate);
  const pxPerFrame = zoom / rate;
  const minMajor = opts.minMajorPx ?? 96;
  const cands = stepCandidates(nominal);
  const stepFrames = cands.find((n) => n * pxPerFrame >= minMajor) ?? cands[cands.length - 1];
  // Minor step: the largest candidate that divides the major and is >= 6px apart.
  let minorFrames = stepFrames;
  for (let i = cands.length - 1; i >= 0; i--) {
    const c = cands[i];
    if (c >= stepFrames) continue;
    if (stepFrames % c !== 0) continue;
    if (c * pxPerFrame < 6) break;
    minorFrames = c;
    // prefer ~5–10 subdivisions
    if (stepFrames / c >= 4) break;
  }
  const f0 = Math.max(0, Math.floor(toFrames(Math.max(0, t0), fps) / minorFrames) * minorFrames);
  const f1 = toFrames(Math.max(0, t1), fps) + minorFrames;
  const major: RulerTicks['major'] = [];
  const minor: number[] = [];
  // Hard cap: never more than ~4000 tick marks per draw.
  const count = (f1 - f0) / minorFrames;
  if (count > 4000) return { major, minor, stepFrames, minorFrames, frameCells: false };
  for (let f = f0; f <= f1; f += minorFrames) {
    const t = fromFrames(f, fps);
    if (f % stepFrames === 0) major.push({ t, label: formatTimecode(t, fps, opts.dropFrame ?? false, opts.startTimecode ?? 0) });
    else minor.push(t);
  }
  return { major, minor, stepFrames, minorFrames, frameCells: pxPerFrame >= 14 };
}

/** Compact signed duration for drag readouts: "+1:12" / "-00:00:02:03" style. */
export function formatDelta(seconds: number, fps: number): string {
  const frames = toFrames(Math.abs(seconds), fps);
  const sign = seconds < -1e-9 ? '-' : '+';
  const nominal = Math.round(exactRate(fps));
  if (frames < nominal) return `${sign}${frames}f`;
  const ff = frames % nominal;
  const totalS = Math.floor(frames / nominal);
  const ss = totalS % 60;
  const mm = Math.floor(totalS / 60) % 60;
  const hh = Math.floor(totalS / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  const body = hh > 0 ? `${hh}:${p(mm)}:${p(ss)}:${p(ff)}` : mm > 0 ? `${mm}:${p(ss)}:${p(ff)}` : `${ss}:${p(ff)}`;
  return `${sign}${body}`;
}

/** Frame count of a duration (for readouts). */
export function framesOf(seconds: number, fps: number): number {
  return toFrames(seconds, fps);
}
