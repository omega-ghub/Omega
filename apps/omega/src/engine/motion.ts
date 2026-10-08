// Procedural motion: physical eases, deterministic noise and param modifiers.
//
// Everything here is PURE and DETERMINISTIC: the same inputs always give the
// same output, so the viewer, scrubbing and export agree frame for frame. No
// Math.random, no Date, no hidden state. See ADR-0005.
//
// This file must not import engine/keyframes.ts (keyframes.ts imports it).

import type { Clip, Ease, EaseParams, Keyframe, LoopModifier, Modifier, WiggleModifier } from '../state/types';

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

// ---------------------------------------------------------------------------
// Physical eases
// ---------------------------------------------------------------------------

export const PHYSICAL_EASES = ['back', 'elastic', 'bounce', 'spring'] as const;
export type PhysicalEase = (typeof PHYSICAL_EASES)[number];

export function isPhysicalEase(e: Ease): e is PhysicalEase {
  return e === 'back' || e === 'elastic' || e === 'bounce' || e === 'spring';
}

export const EASE_DEFAULTS = { overshoot: 1.70158, period: 0.3, bounce: 0.5 } as const;

/** Ends 10% past the target, then settles (Penner "easeOutBack"). */
function backOut(p: number, s: number): number {
  const q = p - 1;
  return 1 + (s + 1) * q * q * q + s * q * q;
}

/** Rubber-band wobble that decays to the target (Penner "easeOutElastic"). */
function elasticOut(p: number, period: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const c4 = (2 * Math.PI) / (Math.max(0.05, period) * 10);
  return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * c4) + 1;
}

/** Ball-drop bounces (Penner "easeOutBounce"). */
function bounceOut(p: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (p < 1 / d1) return n1 * p * p;
  if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75;
  if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375;
  return n1 * (p -= 2.625 / d1) * p + 0.984375;
}

/**
 * Damped-spring step response over p ∈ [0,1]. `bounce` 0..1 maps to a damping
 * ratio of 1 … 0.15. The decay is scaled so the envelope is 0.2% at p = 1, and
 * the last 8% eases the remainder out, so the curve lands exactly on 1.
 */
function springOut(p: number, bounce: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const z = 1 - 0.85 * clamp(bounce, 0, 1);
  let v: number;
  if (z >= 0.999) {
    const w = 9.5; // critically damped: (1 + wp) e^(−wp) < 0.2% at p = 1
    v = 1 - (1 + w * p) * Math.exp(-w * p);
  } else {
    const w = Math.log(500) / z;
    const wd = w * Math.sqrt(1 - z * z);
    v = 1 - Math.exp(-z * w * p) * (Math.cos(wd * p) + ((z * w) / wd) * Math.sin(wd * p));
  }
  const k = clamp((p - 0.92) / 0.08, 0, 1);
  return v + (1 - v) * (k * k * (3 - 2 * k));
}

/**
 * Progress (0 → 1, may leave [0,1] mid-way) of a physical ease at segment
 * position p. `dir` mirrors the curve for "in" (physical start) and "inOut".
 */
export function physicalEase(kind: PhysicalEase, p: number, ezp?: EaseParams): number {
  const out = (x: number): number => {
    switch (kind) {
      case 'back':
        return backOut(x, ezp?.overshoot ?? EASE_DEFAULTS.overshoot);
      case 'elastic':
        return elasticOut(x, ezp?.period ?? EASE_DEFAULTS.period);
      case 'bounce':
        return bounceOut(clamp(x, 0, 1));
      case 'spring':
        return springOut(x, ezp?.bounce ?? EASE_DEFAULTS.bounce);
    }
  };
  const dir = ezp?.dir ?? 'out';
  if (dir === 'out') return out(p);
  if (dir === 'in') return 1 - out(1 - p);
  return p < 0.5 ? (1 - out(1 - 2 * p)) / 2 : (1 + out(2 * p - 1)) / 2;
}

// ---------------------------------------------------------------------------
// Deterministic noise
// ---------------------------------------------------------------------------

/** Integer hash → [−1, 1]. Same (i, seed) always gives the same value. */
function hash(i: number, seed: number): number {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295 * 2 - 1;
}

/** Smooth 1-D value noise in [−1, 1] (quintic interpolation, continuous first and second derivative). */
export function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const a = hash(i, seed);
  const b = hash(i + 1, seed);
  return a + (b - a) * u;
}

/** Fractal noise: `octaves` layers, each twice as fast and half as strong. Result stays within [−1, 1]. */
export function fbm(x: number, seed: number, octaves: number): number {
  const n = clamp(Math.round(octaves), 1, 6);
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let o = 0; o < n; o++) {
    sum += amp * noise1(x * freq, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

/** Paths that cannot carry modifiers: speed ramps feed source-time integration. */
export function modifiersAllowed(path: string): boolean {
  return !path.startsWith('time.');
}

/** Value a wiggle adds at clip-local time `local`. */
export function wiggleOffset(m: WiggleModifier, local: number): number {
  const t = local - m.origin;
  let fade = 1;
  if (m.fadeIn > 0) {
    const k = clamp(t / m.fadeIn, 0, 1);
    fade = k * k * (3 - 2 * k);
  }
  return m.amp * fade * fbm(t * m.freq, m.seed, m.octaves);
}

/**
 * Maps clip-local time onto the keyframed span for a loop. Returns the time to
 * evaluate the keyframes at, plus a value to add ('offset' keeps climbing by
 * the keyframe delta each cycle). Before the last keyframe nothing changes.
 */
export function loopMap(kfs: Keyframe[], t: number, mode: LoopModifier['mode']): { t: number; add: number } {
  if (kfs.length < 2) return { t, add: 0 };
  const first = kfs[0];
  const last = kfs[kfs.length - 1];
  const span = last.t - first.t;
  if (!(span > 1e-9) || t <= last.t) return { t, add: 0 };
  const x = t - first.t;
  if (mode === 'pingpong') {
    const m = x % (2 * span);
    return { t: first.t + (m <= span ? m : 2 * span - m), add: 0 };
  }
  const cycles = Math.floor(x / span);
  const tt = first.t + (x - cycles * span);
  return { t: tt, add: mode === 'offset' ? cycles * (last.v - first.v) : 0 };
}

let uidCounter = 0;
/** Short id for a new modifier (unique within the session; stored ids are never regenerated). */
export function modifierId(): string {
  uidCounter += 1;
  return `m${Date.now().toString(36)}${uidCounter.toString(36)}`;
}

/** A modifier with sensible creator-friendly defaults. */
export function defaultModifier(type: Modifier['type'], id: string = modifierId()): Modifier {
  switch (type) {
    case 'wiggle':
      return { id, enabled: true, type, freq: 2, amp: 10, octaves: 2, seed: 1, origin: 0, fadeIn: 0 };
    case 'loop':
      return { id, enabled: true, type, mode: 'cycle' };
    case 'follow':
      return { id, enabled: true, type, source: 'transform.x', scale: 1, offset: 0, delay: 0 };
  }
}

/** Moves time-anchored modifier settings when a head trim/split shifts the clip's local time by `dt` seconds. */
export function shiftModifiers(c: Clip, dt: number): void {
  if (!c.modifiers || !dt) return;
  for (const list of Object.values(c.modifiers)) for (const m of list) if (m.type === 'wiggle') m.origin += dt;
}

/** Scales time-based modifier settings when the clip's time is stretched by `r` (rate stretch / speed change). */
export function scaleModifiers(c: Clip, r: number): void {
  if (!c.modifiers || r === 1 || !(r > 0)) return;
  for (const list of Object.values(c.modifiers)) {
    for (const m of list) {
      if (m.type === 'wiggle') {
        m.freq /= r;
        m.origin *= r;
        m.fadeIn *= r;
      } else if (m.type === 'follow') m.delay *= r;
    }
  }
}

/** Removes the modifiers (and the map entry) of paths starting with `prefix`, e.g. when an effect is deleted. */
export function dropModifiers(c: Clip, prefix: string): void {
  if (!c.modifiers) return;
  for (const path of Object.keys(c.modifiers)) if (path.startsWith(prefix)) delete c.modifiers[path];
  if (!Object.keys(c.modifiers).length) delete c.modifiers;
}

/** Shape-validates modifiers from an untrusted file; drops anything malformed and clamps numbers to sane ranges. */
export function sanitizeModifiers(raw: unknown): Clip['modifiers'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
  const out: NonNullable<Clip['modifiers']> = {};
  for (const [path, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list) || !modifiersAllowed(path)) continue;
    const clean: Modifier[] = [];
    for (const r of list.slice(0, 16)) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const id = typeof o.id === 'string' && o.id ? o.id : modifierId();
      const enabled = o.enabled !== false;
      if (o.type === 'wiggle') {
        clean.push({ id, enabled, type: 'wiggle', freq: num(o.freq, 2, 0.01, 100), amp: num(o.amp, 10, -1e6, 1e6), octaves: Math.round(num(o.octaves, 2, 1, 6)), seed: Math.round(num(o.seed, 1, 0, 1e6)), origin: num(o.origin, 0, -1e6, 1e6), fadeIn: num(o.fadeIn, 0, 0, 3600) });
      } else if (o.type === 'loop') {
        clean.push({ id, enabled, type: 'loop', mode: o.mode === 'pingpong' || o.mode === 'offset' ? o.mode : 'cycle' });
      } else if (o.type === 'follow' && typeof o.source === 'string') {
        clean.push({ id, enabled, type: 'follow', source: o.source, scale: num(o.scale, 1, -1e4, 1e4), offset: num(o.offset, 0, -1e6, 1e6), delay: num(o.delay, 0, 0, 3600) });
      }
    }
    if (clean.length) out[path] = clean;
  }
  return Object.keys(out).length ? out : undefined;
}
