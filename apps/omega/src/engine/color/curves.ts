// Grade curves: monotone cubic interpolation (Fritsch–Carlson) through the
// user's control points, baked into a lookup table the renderer samples.
// OWNED BY THE RENDERER PACKAGE.

import type { CurvePoint, Curves } from '../../state/types';

/**
 * Builds y = f(x) through `points` (x and y in 0..1). Endpoints (0,0) and (1,1)
 * are implied when the points do not reach the edges. Monotone data gives a
 * monotone curve (no overshoot); local extrema get flat tangents.
 */
export function monotoneCurve(points: CurvePoint[]): (x: number) => number {
  const pts = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: Math.min(Math.max(p.x, 0), 1), y: Math.min(Math.max(p.y, 0), 1) }))
    .sort((a, b) => a.x - b.x);
  // Collapse duplicate x (the later point wins).
  const P: { x: number; y: number }[] = [];
  for (const p of pts) {
    if (P.length && Math.abs(P[P.length - 1].x - p.x) < 1e-6) P[P.length - 1] = p;
    else P.push(p);
  }
  if (!P.length || P[0].x > 1e-6) P.unshift({ x: 0, y: 0 });
  if (P[P.length - 1].x < 1 - 1e-6) P.push({ x: 1, y: 1 });
  const n = P.length;
  if (n === 1) return () => P[0].y;
  const xs = P.map((p) => p.x);
  const ys = P.map((p) => p.y);
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) {
      m[k] = 0;
      m[k + 1] = 0;
      continue;
    }
    const a = m[k] / d[k];
    const b = m[k + 1] / d[k];
    if (a < 0) m[k] = 0;
    if (b < 0) m[k + 1] = 0;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[k] = t * a * d[k];
      m[k + 1] = t * b * d[k];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const h = xs[hi] - xs[lo];
    const t = (x - xs[lo]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo] + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * m[hi];
    return Math.min(Math.max(y, 0), 1);
  };
}

export function curvesAreIdentity(c: Curves): boolean {
  return !c.master.length && !c.r.length && !c.g.length && !c.b.length;
}

/** Stable cache key for a set of curves. */
export function curvesKey(c: Curves): string {
  const k = (a: CurvePoint[]) => a.map((p) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`).join(';');
  return `${k(c.master)}|${k(c.r)}|${k(c.g)}|${k(c.b)}`;
}

/**
 * Bakes the curves into an RGBA float table of `size` entries over x = 0..1:
 * R/G/B = channel curve ∘ master curve; A = master alone.
 */
export function bakeCurves(c: Curves, size = 1024): Float32Array {
  const M = monotoneCurve(c.master);
  const R = monotoneCurve(c.r);
  const G = monotoneCurve(c.g);
  const B = monotoneCurve(c.b);
  const out = new Float32Array(size * 4);
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1);
    const m = M(x);
    out[i * 4] = R(m);
    out[i * 4 + 1] = G(m);
    out[i * 4 + 2] = B(m);
    out[i * 4 + 3] = m;
  }
  return out;
}

/** Applies baked curves to one encoded value (linear interpolation; identity slope outside 0..1), like the shader. */
export function sampleBaked(table: Float32Array, channel: 0 | 1 | 2, x: number): number {
  const size = table.length / 4;
  if (x > 1) return table[(size - 1) * 4 + channel] + (x - 1);
  if (x < 0) return table[channel] + x;
  const f = x * (size - 1);
  const i = Math.min(Math.floor(f), size - 2);
  const t = f - i;
  return table[i * 4 + channel] * (1 - t) + table[(i + 1) * 4 + channel] * t;
}
