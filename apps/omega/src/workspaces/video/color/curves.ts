// Curve helpers for the curves editor. Interpolation is the renderer's
// monotone cubic (Fritsch–Carlson), so a curve never overshoots between its
// points and the editor draws exactly what the renderer applies. Pure; unit-tested.
import { monotoneCurve } from '../../../engine/color/curves';
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

/**
 * A compiled curve, evaluated exactly like the renderer bakes it
 * (engine/color/curves.ts: monotone cubic, implied endpoints).
 */
export function compileCurve(points: readonly CurvePoint[]): (x: number) => number {
  if (!points.length) return (x) => clamp01(x);
  return monotoneCurve(points as CurvePoint[]);
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
