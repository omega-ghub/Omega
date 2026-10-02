// Grade math shared by the GPU grade pass and its CPU reference.
// OWNED BY THE RENDERER PACKAGE.
//
// Pipeline (all on unpremultiplied color, scene-linear Rec.709 in and out):
//   1. linear:  exposure (×2^stops), then white balance (Bradford CAT, below)
//   2. log:     grading log space (ACEScct offset so 18% grey = 0.435):
//               contrast around pivot → highlights/shadows → lift/gamma/gain/
//               offset (normalized between log black and log white) →
//               saturation → vibrance
//   3. curves:  master then R/G/B, monotone cubic, in the Rec.709-encoded domain
//   4. qualifier (HSL key in the Rec.709-encoded domain; adjustments in linear)
//   5. LUT:     linear → BT.709 OETF → LUT (tetrahedral) → mix(intensity) → inverse
//
// Temperature/tint: the scene white the sliders describe (CCT moved along the
// Planckian locus in mireds, tint as a Duv offset) is adapted to D65 with the
// Bradford transform, so temperature behaves like changing the camera's white
// balance rather than tinting the picture. 0/0 is exactly the identity.

import type { ColorGrade, Qualifier, RGBY } from '../../state/types';
import { applyLut, type ParsedLut } from './lut';
import { monotoneCurve } from './curves';
import {
  apply3,
  bt709InvOetf,
  bt709Oetf,
  gradeLogDecode,
  gradeLogEncode,
  inv3,
  mul3,
  REC709_FROM_XYZ,
  XYZ_FROM_709,
  type Mat3,
  type Vec3,
} from './transforms';

export const LUMA709: Vec3 = [0.2126, 0.7152, 0.0722];

// ---------------------------------------------------------------------------
// White balance
// ---------------------------------------------------------------------------

/** Planckian locus in CIE 1960 uv (Krystek 1985), valid ~1000 K – 15000 K. */
export function planckUv(T: number): [number, number] {
  const u = (0.860117757 + 1.54118254e-4 * T + 1.28641212e-7 * T * T) / (1 + 8.42420235e-4 * T + 7.08145163e-7 * T * T);
  const v = (0.317398726 + 4.22806245e-5 * T + 4.20481691e-8 * T * T) / (1 - 2.89741816e-5 * T + 1.61456053e-7 * T * T);
  return [u, v];
}

const D65_XY: [number, number] = [0.3127, 0.329];
const xyToUv = (x: number, y: number): [number, number] => {
  const d = -2 * x + 12 * y + 3;
  return [(4 * x) / d, (6 * y) / d];
};
const uvToXy = (u: number, v: number): [number, number] => {
  const d = 2 * u - 8 * v + 4;
  return [(3 * u) / d, (2 * v) / d];
};
const xyToXYZ = (x: number, y: number): Vec3 => [x / y, 1, (1 - x - y) / y];

const BRADFORD: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
const BRADFORD_INV = inv3(BRADFORD);

export const WB = {
  /** Mireds per temperature unit (±100 → about 4000 K … 15600 K source white). */
  miredPerUnit: 0.9,
  /** Duv per tint unit (±100 → ±0.02). */
  duvPerUnit: 0.0002,
  refCct: 6504,
} as const;

/** Bradford chromatic adaptation from white `src` (XYZ) to `dst` (XYZ). */
export function bradford(src: Vec3, dst: Vec3): Mat3 {
  const s = apply3(BRADFORD, src);
  const d = apply3(BRADFORD, dst);
  const D: Mat3 = [d[0] / s[0], 0, 0, 0, d[1] / s[1], 0, 0, 0, d[2] / s[2]];
  return mul3(BRADFORD_INV, mul3(D, BRADFORD));
}

/**
 * Linear Rec.709 white-balance matrix for the grade's temperature/tint
 * (−100..100). Positive temperature warms, positive tint pushes magenta.
 */
export function whiteBalanceMatrix(temperature: number, tint: number): Mat3 {
  if (!temperature && !tint) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const refMired = 1e6 / WB.refCct;
  const T = 1e6 / Math.min(Math.max(refMired - temperature * WB.miredPerUnit, 40), 600);
  const [u0, v0] = planckUv(WB.refCct);
  const [u1, v1] = planckUv(T);
  // Unit normal to the locus at T, pointing to +Duv (green side).
  const [ua, va] = planckUv(T * 0.999);
  const [ub, vb] = planckUv(T * 1.001);
  const du = ub - ua;
  const dv = vb - va;
  const len = Math.hypot(du, dv) || 1;
  const nU = dv / len;
  const nV = -du / len;
  // Ensure the normal points toward higher v (green).
  const sgn = nV >= 0 ? 1 : -1;
  const duv = tint * WB.duvPerUnit;
  const [uw, vw] = xyToUv(D65_XY[0], D65_XY[1]);
  const us = uw + (u1 - u0) + sgn * nU * duv;
  const vs = vw + (v1 - v0) + sgn * nV * duv;
  const [xs, ys] = uvToXy(us, vs);
  const cat = bradford(xyToXYZ(xs, ys), xyToXYZ(D65_XY[0], D65_XY[1]));
  return mul3(REC709_FROM_XYZ, mul3(cat, XYZ_FROM_709));
}

// ---------------------------------------------------------------------------
// Wheels and log-stage parameters
// ---------------------------------------------------------------------------

export const LOG_BLACK = gradeLogEncode(0);
export const LOG_WHITE = gradeLogEncode(1);

/** Mapping of the −1..1 wheel deltas to the operators. */
export const WHEEL = { lift: 0.25, gammaStops: 0.75, gainStops: 0.5, offset: 0.25 } as const;
/** Highlights/shadows: log-space shift at ±1 (0.12 ≈ 2.1 stops). */
export const TONE_RANGE = 0.12;

export interface LogStage {
  contrast: number;
  pivot: number;
  saturation: number;
  vibrance: number;
  highlights: number;
  shadows: number;
  lift: Vec3;
  gammaExp: Vec3;
  gain: Vec3;
  offset: Vec3;
}

const per = (w: RGBY): Vec3 => [w.y + w.r, w.y + w.g, w.y + w.b];

export function logStage(g: ColorGrade): LogStage {
  const L = per(g.lift);
  const Ga = per(g.gamma);
  const Gn = per(g.gain);
  const O = per(g.offset);
  return {
    contrast: g.contrast,
    pivot: g.pivot,
    saturation: g.saturation,
    vibrance: g.vibrance,
    highlights: g.highlights,
    shadows: g.shadows,
    lift: L.map((v) => v * WHEEL.lift) as Vec3,
    gammaExp: Ga.map((v) => Math.pow(2, -v * WHEEL.gammaStops)) as Vec3,
    gain: Gn.map((v) => Math.pow(2, v * WHEEL.gainStops)) as Vec3,
    offset: O.map((v) => v * WHEEL.offset) as Vec3,
  };
}

export function logStageIsIdentity(g: ColorGrade): boolean {
  const z = (w: RGBY) => !w.r && !w.g && !w.b && !w.y;
  return g.contrast === 1 && g.saturation === 1 && !g.vibrance && !g.highlights && !g.shadows && z(g.lift) && z(g.gamma) && z(g.gain) && z(g.offset);
}

/** True when the grade changes nothing (the renderer skips the pass). Input transforms are separate. */
export function gradeIsNeutral(g: ColorGrade, lutLoaded = true): boolean {
  if (!g.enabled) return true;
  return (
    !g.exposure &&
    !g.temperature &&
    !g.tint &&
    logStageIsIdentity(g) &&
    !g.curves.master.length &&
    !g.curves.r.length &&
    !g.curves.g.length &&
    !g.curves.b.length &&
    !g.qualifier.enabled &&
    !(g.lut.id && g.lut.intensity !== 0 && lutLoaded)
  );
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The log stage on one log-encoded pixel (CPU twin of the shader). */
export function applyLogStage(p: LogStage, x: Vec3): Vec3 {
  let c = x.map((v) => (v - p.pivot) * p.contrast + p.pivot) as Vec3;
  let y = dot(LUMA709, c);
  const wh = smoothstep(p.pivot - 0.02, p.pivot + 0.12, y);
  const ws = smoothstep(LOG_BLACK - 0.02, LOG_BLACK + 0.06, y) * (1 - smoothstep(p.pivot - 0.18, p.pivot + 0.03, y));
  const shift = (p.highlights * wh + p.shadows * ws) * TONE_RANGE;
  c = c.map((v) => v + shift) as Vec3;
  const span = LOG_WHITE - LOG_BLACK;
  c = c.map((v, i) => {
    let n = (v - LOG_BLACK) / span;
    n = n + p.lift[i] * (1 - n);
    n = Math.sign(n) * Math.pow(Math.abs(n), p.gammaExp[i]);
    n = n * p.gain[i];
    n = n + p.offset[i];
    return LOG_BLACK + n * span;
  }) as Vec3;
  y = dot(LUMA709, c);
  c = c.map((v) => y + (v - y) * p.saturation) as Vec3;
  const chroma = Math.max(...c) - Math.min(...c);
  const f = 1 + p.vibrance * (1 - smoothstep(0, 0.2, chroma));
  return c.map((v) => y + (v - y) * f) as Vec3;
}

// ---------------------------------------------------------------------------
// Qualifier
// ---------------------------------------------------------------------------

/** HSV of display-referred RGB (hue 0..1). Same algorithm as GLSL_PRELUDE's rgb2hsv. */
export function rgb2hsv(c: Vec3): Vec3 {
  const mx = Math.max(...c);
  const mn = Math.min(...c);
  const d = mx - mn;
  let h = 0;
  if (d > 1e-10) {
    if (mx === c[0]) h = ((c[1] - c[2]) / d) % 6;
    else if (mx === c[1]) h = (c[2] - c[0]) / d + 2;
    else h = (c[0] - c[1]) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, mx > 1e-10 ? d / mx : 0, mx];
}

/** Soft HSL key (0..1) of a display-referred (Rec.709-encoded) pixel. */
export function qualifierKey(q: Qualifier, enc: Vec3): number {
  const e = enc.map((v) => Math.min(Math.max(v, 0), 1)) as Vec3;
  const hsv = rgb2hsv(e);
  const hue = hsv[0] * 360;
  const sat = hsv[1];
  const lum = dot(LUMA709, e);
  const soft = Math.max(q.softness, 0);
  let kh = 1;
  if (q.hueWidth < 360) {
    const dh = Math.abs((((hue - q.hueCenter + 540) % 360) + 360) % 360 - 180);
    const half = Math.max(q.hueWidth, 0) / 2;
    const sH = Math.max(soft * 60, 0.5);
    kh = 1 - smoothstep(half, half + sH, dh);
  }
  const sS = Math.max(soft * 0.2, 0.002);
  const band = (lo: number, hi: number, x: number) => smoothstep(lo - sS, lo, x) * (1 - smoothstep(hi, hi + sS, x));
  const k = kh * band(q.satLow, q.satHigh, sat) * band(q.lumLow, q.lumHigh, lum);
  return q.invert ? 1 - k : k;
}

/** Hue rotation around the neutral axis (Rodrigues), degrees; positive moves red → yellow → green. */
export function hueRotationMatrix(deg: number): Mat3 {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const k = 1 / Math.sqrt(3);
  const oc = 1 - c;
  // R = cI + s[k]x + (1-c) k kᵀ, with k = (1,1,1)/√3
  const a = c + oc / 3;
  const b = oc / 3 - s * k;
  const d = oc / 3 + s * k;
  return [a, b, d, d, a, b, b, d, a];
}

// ---------------------------------------------------------------------------
// CPU reference of the whole grade pass (tests, pickers, LUT baking)
// ---------------------------------------------------------------------------

export function gradePixel(g: ColorGrade, lin: Vec3, lut: ParsedLut | null = null): Vec3 {
  if (!g.enabled) return lin;
  let c = lin.map((v) => v * Math.pow(2, g.exposure)) as Vec3;
  if (g.temperature || g.tint) c = apply3(whiteBalanceMatrix(g.temperature, g.tint), c);
  if (!logStageIsIdentity(g)) {
    const x = c.map(gradeLogEncode) as Vec3;
    c = applyLogStage(logStage(g), x).map(gradeLogDecode) as Vec3;
  }
  const cv = g.curves;
  if (cv.master.length || cv.r.length || cv.g.length || cv.b.length) {
    const M = monotoneCurve(cv.master);
    const ch = [monotoneCurve(cv.r), monotoneCurve(cv.g), monotoneCurve(cv.b)];
    c = c.map((v, i) => {
      const e = bt709Oetf(v);
      const ap = (x: number) => (x > 1 ? ch[i](M(1)) + (x - 1) : x < 0 ? ch[i](M(0)) + x : ch[i](M(x)));
      return bt709InvOetf(ap(e));
    }) as Vec3;
  }
  if (g.qualifier.enabled) {
    const q = g.qualifier;
    const key = qualifierKey(q, c.map(bt709Oetf) as Vec3);
    let a = c.map((v) => v * Math.pow(2, q.exposure)) as Vec3;
    const y = dot(LUMA709, a);
    a = a.map((v) => y + (v - y) * q.saturation) as Vec3;
    if (q.hueShift) a = apply3(hueRotationMatrix(q.hueShift), a);
    c = c.map((v, i) => v + (a[i] - v) * key) as Vec3;
  }
  if (lut && g.lut.id && g.lut.intensity) {
    const e = c.map(bt709Oetf) as Vec3;
    const l = applyLut(lut, e);
    c = e.map((v, i) => bt709InvOetf(v + (l[i] - v) * g.lut.intensity)) as Vec3;
  }
  return c;
}
