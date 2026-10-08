// Keyframe evaluation and param paths.
//
// Every animatable value of a clip is addressed by a dotted PARAM PATH:
//   transform.x | .y | .scale | .scaleX | .scaleY | .rotation | .anchorX | .anchorY | .opacity
//   crop.left | .top | .right | .bottom | .feather
//   masks.<maskId>.x | .y | .width | .height | .rotation | .roundness | .feather | .expansion | .opacity
//   effects.<effectId>.<paramKey>
//   grade.exposure | .temperature | .tint | .contrast | .pivot | .saturation | .vibrance | .highlights | .shadows
//   grade.lift.r|g|b|y  grade.gamma.*  grade.gain.*  grade.offset.*  grade.lut.intensity
//   audio.gain | audio.pan
//   time.speed              (speed ramps; static value is clip.speed)
//   text.size | text.letterSpacing | text.lineHeight
//   shape.width | shape.height | shape.radius
// The static value lives at that path in the clip; keyframes (clip.keyframes[path])
// override it when present. Keyframe times are seconds from the clip start.

import type { Clip, Ease, EaseParams, Keyframe } from '../state/types';
import { isPhysicalEase, loopMap, modifiersAllowed, physicalEase, shiftModifiers, wiggleOffset } from './motion';

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

const BEZ: Record<'easeIn' | 'easeOut' | 'easeInOut', [number, number, number, number]> = {
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
};

/** Solves a CSS-style cubic-bezier timing curve: returns y for x in [0,1]. */
export function cubicBezier(x: number, x1: number, y1: number, x2: number, y2: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  // Newton–Raphson, then bisection fallback
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = sampleX(t) - x;
    if (Math.abs(err) < 1e-6) return sampleY(t);
    const d = slopeX(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 32; i++) {
    const v = sampleX(t);
    if (Math.abs(v - x) < 1e-6) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return sampleY(t);
}

export function applyEase(ease: Ease, p: number, bez?: [number, number, number, number], ezp?: EaseParams): number {
  if (ease === 'hold') return 0;
  if (ease === 'linear') return p;
  if (isPhysicalEase(ease)) return physicalEase(ease, p, ezp);
  const c = ease === 'bezier' ? (bez ?? [0.25, 0.1, 0.25, 1]) : BEZ[ease];
  return cubicBezier(p, c[0], c[1], c[2], c[3]);
}

/** Value of a keyframe track at clip-local time t (clamped at both ends). */
export function evaluate(kfs: Keyframe[], t: number): number {
  if (kfs.length === 0) return 0;
  if (t <= kfs[0].t) return kfs[0].v;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.v;
  // binary search for the segment
  let lo = 0;
  let hi = kfs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kfs[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = kfs[lo];
  const b = kfs[hi];
  const span = b.t - a.t;
  if (span <= 0) return b.v;
  const p = applyEase(a.ease, (t - a.t) / span, a.bez, a.ezp);
  return a.v + (b.v - a.v) * p;
}

// ---------------------------------------------------------------------------
// Param paths
// ---------------------------------------------------------------------------

/** Reads the static (non-animated) value at a param path. */
export function getStatic(clip: Clip, path: string): unknown {
  const parts = path.split('.');
  if (parts[0] === 'time' && parts[1] === 'speed') return clip.speed;
  if (parts[0] === 'masks') return clip.masks.find((m) => m.id === parts[1])?.[parts[2] as keyof (typeof clip.masks)[number]];
  if (parts[0] === 'effects') return clip.effects.find((e) => e.id === parts[1])?.params[parts[2]];
  let obj: unknown = clip;
  for (const key of parts) {
    if (obj === null || typeof obj !== 'object') return undefined;
    obj = (obj as Record<string, unknown>)[key];
  }
  return obj;
}

/** Writes the static value at a param path (call on an immer draft). */
export function setStatic(clip: Clip, path: string, value: unknown): void {
  const parts = path.split('.');
  if (parts[0] === 'time' && parts[1] === 'speed') {
    clip.speed = Number(value);
    return;
  }
  if (parts[0] === 'masks') {
    const m = clip.masks.find((x) => x.id === parts[1]) as unknown as Record<string, unknown> | undefined;
    if (m) m[parts[2]] = value;
    return;
  }
  if (parts[0] === 'effects') {
    const e = clip.effects.find((x) => x.id === parts[1]);
    if (e) e.params[parts[2]] = value as number | boolean | string;
    return;
  }
  let obj = clip as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = obj[parts[i]];
    if (next === null || typeof next !== 'object') return;
    obj = next as Record<string, unknown>;
  }
  obj[parts[parts.length - 1]] = value;
}

function staticNumber(clip: Clip, path: string): number {
  const v = getStatic(clip, path);
  return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0;
}

/** How deep a chain of 'follow' modifiers may go before it stops (guards against cycles). */
const MAX_FOLLOW_DEPTH = 4;

/**
 * Numeric value of a param at clip-local time (keyframes win over the static
 * value). Modifiers (clip.modifiers[path]) layer procedural motion on top, in a
 * fixed order: loop → keyframes → follow → wiggle. Params without modifiers
 * take the fast path.
 */
export function paramAt(clip: Clip, path: string, local: number, depth = 0): number {
  const kfs = clip.keyframes[path];
  const mods = clip.modifiers?.[path];
  if (mods === undefined || mods.length === 0 || !modifiersAllowed(path)) {
    return kfs && kfs.length ? evaluate(kfs, local) : staticNumber(clip, path);
  }
  let t = local;
  let add = 0;
  const loop = mods.find((m) => m.enabled && m.type === 'loop');
  if (loop && loop.type === 'loop' && kfs && kfs.length >= 2) {
    const r = loopMap(kfs, local, loop.mode);
    t = r.t;
    add = r.add;
  }
  let v = (kfs && kfs.length ? evaluate(kfs, t) : staticNumber(clip, path)) + add;
  for (const m of mods) {
    if (!m.enabled) continue;
    if (m.type === 'follow') {
      if (depth < MAX_FOLLOW_DEPTH && m.source !== path) v += m.scale * paramAt(clip, m.source, local - m.delay, depth + 1) + m.offset;
    } else if (m.type === 'wiggle') v += wiggleOffset(m, local);
  }
  return v;
}

/** True when the param has at least one enabled modifier. */
export function hasModifiers(clip: Clip, path: string): boolean {
  return !!clip.modifiers?.[path]?.some((m) => m.enabled);
}

export function isAnimated(clip: Clip, path: string): boolean {
  return !!clip.keyframes[path]?.length;
}

/** Tolerance when deciding whether a time hits an existing keyframe (half a frame at 60 fps). */
export const KEY_TOLERANCE = 1 / 120;

/**
 * Adds or updates a keyframe at clip-local time t. If the param was not
 * animated yet, the static value is first captured as a keyframe there too
 * (so turning on animation never changes the current look).
 */
export function setKeyframe(clip: Clip, path: string, t: number, v: number, ease: Ease = 'linear'): void {
  const list = (clip.keyframes[path] ??= []);
  const hit = list.find((k) => Math.abs(k.t - t) <= KEY_TOLERANCE);
  if (hit) {
    hit.v = v;
    return;
  }
  list.push({ t, v, ease });
  list.sort((a, b) => a.t - b.t);
}

export function removeKeyframeAt(clip: Clip, path: string, t: number): void {
  const list = clip.keyframes[path];
  if (!list) return;
  const i = list.findIndex((k) => Math.abs(k.t - t) <= KEY_TOLERANCE);
  if (i >= 0) list.splice(i, 1);
  if (!list.length) delete clip.keyframes[path];
}

/** Turns animation off for a param, keeping the value at time t as the new static value. */
export function clearKeyframes(clip: Clip, path: string, keepValueAt: number): void {
  const list = clip.keyframes[path];
  if (!list) return;
  const v = evaluate(list, keepValueAt);
  delete clip.keyframes[path];
  setStatic(clip, path, v);
}

/** Sets a param "the way an editor expects": keyframe if animated, else the static value. */
export function setParam(clip: Clip, path: string, local: number, v: number): void {
  if (isAnimated(clip, path)) setKeyframe(clip, path, local, v);
  else setStatic(clip, path, v);
}

/** Keyframe times of every animated param (for timeline dots and next/prev navigation). */
export function allKeyTimes(clip: Clip): number[] {
  const set = new Set<number>();
  for (const list of Object.values(clip.keyframes)) for (const k of list) set.add(k.t);
  return [...set].sort((a, b) => a - b);
}

/** Shift all keyframes (used by trims at the clip head so animation stays put on the timeline). */
export function shiftKeyframes(clip: Clip, delta: number): void {
  for (const list of Object.values(clip.keyframes)) for (const k of list) k.t += delta;
  shiftModifiers(clip, delta);
}
