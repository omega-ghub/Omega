// Curve math for the curves editor: monotone cubic interpolation
// (Fritsch–Carlson), so a curve never overshoots between its points (no
// ringing, no inverted tones from a gentle S). Pure; unit-tested.
import type { CurvePoint } from '../../../state/types';

/** Points sorted by x with the implied (0,0) / (1,1) endpoints added when absent. */
export function withEndpoints(points: readonly CurvePoint[]): CurvePoint[] {
  const pts = [...points].sort((a, b) => a.x - b.x).map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }));
  if (!pts.length || pts[0].x > 0) pts.unshift({ x: 0, y: 0 });
  if (pts[pts.length - 1].x < 1) pts.push({ x: 1, y: 1 });
  return pts;
}

/** True when the points describe the identity curve. */
export function isIdentityCurve(points: readonly CurvePoint[]): boolean {
  return withEndpoints(points).every((p) => Math.abs(p.x - p.y) < 1e-4);
}

/** Stored form: [] for identity, otherwise the sorted points including endpoints. */
export function normalizeCurve(points: readonly CurvePoint[]): CurvePoint[] {
  if (isIdentityCurve(points)) return [];
  return withEndpoints(points).map((p) => ({ x: round4(p.x), y: round4(p.y) }));
}

/** Fritsch–Carlson tangents for sorted points. */
export function monotoneTangents(xs: readonly number[], ys: readonly number[]): number[] {
  const n = xs.length;
  if (n < 2) return [0];
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    const h = xs[k + 1] - xs[k];
    d.push(h > 1e-9 ? (ys[k + 1] - ys[k]) / h : 0);
  }
  const m = new Array<number>(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] > 0 ? (d[k - 1] + d[k]) / 2 : 0;
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
  return m;
}

/** A compiled curve: evaluate many times without re-solving tangents. */
export function compileCurve(points: readonly CurvePoint[]): (x: number) => number {
  if (!points.length) return (x) => clamp01(x);
  const pts = withEndpoints(points);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const m = monotoneTangents(xs, ys);
  const n = pts.length;
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
    if (h <= 1e-9) return ys[hi];
    const t = (x - xs[lo]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const v = (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo] + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * m[hi];
    return clamp01(v);
  };
}

export function evalCurve(points: readonly CurvePoint[], x: number): number {
  return compileCurve(points)(x);
}

/** n samples of the curve over 0..1 (for drawing and CPU previews). */
export function sampleCurve(points: readonly CurvePoint[], n = 256): Float32Array {
  const f = compileCurve(points);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = f(i / (n - 1));
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
