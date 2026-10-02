// Color transforms: the single source of truth for every transfer curve and
// gamut matrix the renderer uses. OWNED BY THE RENDERER PACKAGE.
//
// Each curve exists twice: as a TypeScript reference (used by unit tests, LUT
// bakers, pickers and scopes) and as GLSL generated from the SAME constants
// (`GLSL_COLOR`), so the CPU and GPU can never drift apart.
//
// Working space: scene-linear light, Rec.709 / sRGB primaries, D65 white.
// 1.0 = diffuse white. HDR sources are normalized so that 100 nits = 1.0.
//
// Choices (documented in docs and the renderer report):
//  * 'rec709' input = inverse BT.709 OETF (scene-referred camera encoding).
//    The rec709 OUTPUT transform is the BT.709 OETF, so a Rec.709 source in a
//    Rec.709 sequence round-trips code values exactly (BT.1886 is the display's
//    job; the viewer, like every NLE, shows Rec.709 code values as-is).
//  * Camera log curves (S-Log3, LogC3, V-Log, F-Log) are defined by their
//    vendors on 10-bit code values / 1023. Chromium expands limited-range
//    Y'CbCr to full-range RGB when it decodes, so v (0..1 from the decoder) is
//    mapped back with cv = (64 + 876·v) / 1023 before the vendor formula
//    (`legalToFull`). Canon Log 3 is published in the IRE domain (0 = code 64,
//    1 = code 940), which is what the decoder already returns, and Canon's
//    linear is relative to 90% reflectance (x = L / 0.9).
//  * HLG: BT.2100 inverse OETF to scene light E, then the BT.2100 OOTF for a
//    1000-nit display (γ = 1.2, Y_S on Rec.2020 luminance), then / 100 nits.
//  * PQ: SMPTE ST 2084 EOTF to absolute nits, then / 100 nits.

export type Vec3 = [number, number, number];
/** Row-major 3×3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

// ---------------------------------------------------------------------------
// Small matrix helpers
// ---------------------------------------------------------------------------

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}

export function apply3(m: Mat3, v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

export function inv3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return [...IDENTITY3] as Mat3;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

/** Column-major Float32Array for gl.uniformMatrix3fv(loc, false, …). */
export function toGlMat3(m: Mat3): Float32Array {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

// ---------------------------------------------------------------------------
// Gamuts (CIE 1931 xy primaries, D65 white)
// ---------------------------------------------------------------------------

export interface Primaries {
  r: [number, number];
  g: [number, number];
  b: [number, number];
  w: [number, number];
}

const D65: [number, number] = [0.3127, 0.329];

export const GAMUTS = {
  rec709: { r: [0.64, 0.33], g: [0.3, 0.6], b: [0.15, 0.06], w: D65 },
  rec2020: { r: [0.708, 0.292], g: [0.17, 0.797], b: [0.131, 0.046], w: D65 },
  p3d65: { r: [0.68, 0.32], g: [0.265, 0.69], b: [0.15, 0.06], w: D65 },
  /** Sony S-Gamut3.Cine (Sony technical summary). */
  sgamut3cine: { r: [0.766, 0.275], g: [0.225, 0.8], b: [0.089, -0.087], w: D65 },
  /** ARRI Wide Gamut 3 (ALEXA, LogC3). */
  awg3: { r: [0.684, 0.313], g: [0.221, 0.848], b: [0.0861, -0.102], w: D65 },
  /** Panasonic V-Gamut. */
  vgamut: { r: [0.73, 0.28], g: [0.165, 0.84], b: [0.1, -0.03], w: D65 },
  /** Canon Cinema Gamut. */
  cinemagamut: { r: [0.74, 0.27], g: [0.17, 1.14], b: [0.08, -0.1], w: D65 },
  /** Fujifilm F-Gamut is defined as the ITU-R BT.2020 primaries. */
  fgamut: { r: [0.708, 0.292], g: [0.17, 0.797], b: [0.131, 0.046], w: D65 },
} satisfies Record<string, Primaries>;

export type GamutId = keyof typeof GAMUTS;

/** RGB → XYZ normalized primary matrix (SMPTE RP 177). */
export function rgbToXyz(p: Primaries): Mat3 {
  const xyz = (xy: [number, number]): Vec3 => [xy[0] / xy[1], 1, (1 - xy[0] - xy[1]) / xy[1]];
  const R = xyz(p.r);
  const G = xyz(p.g);
  const B = xyz(p.b);
  const W = xyz(p.w);
  const P: Mat3 = [R[0], G[0], B[0], R[1], G[1], B[1], R[2], G[2], B[2]];
  const S = apply3(inv3(P), W);
  return [P[0] * S[0], P[1] * S[1], P[2] * S[2], P[3] * S[0], P[4] * S[1], P[5] * S[2], P[6] * S[0], P[7] * S[1], P[8] * S[2]];
}

/** Linear RGB in gamut `from` → linear RGB in gamut `to` (same white, no adaptation needed). */
export function gamutMatrix(from: GamutId, to: GamutId): Mat3 {
  if (from === to) return [...IDENTITY3] as Mat3;
  return mul3(inv3(rgbToXyz(GAMUTS[to])), rgbToXyz(GAMUTS[from]));
}

export const XYZ_FROM_709 = rgbToXyz(GAMUTS.rec709);
export const REC709_FROM_XYZ = inv3(XYZ_FROM_709);

// ---------------------------------------------------------------------------
// Curves (scalar, TS reference). All are odd-extended (sign-preserving) where
// the published formula only covers x ≥ 0, so out-of-gamut negatives survive.
// ---------------------------------------------------------------------------

const odd = (f: (x: number) => number) => (x: number) => (x < 0 ? -f(-x) : f(x));

// --- BT.709 OETF (ITU-R BT.709-6) ---
export const BT709 = { a: 1.099, b: 0.099, cut: 0.018, slope: 4.5, power: 0.45, vcut: 0.081 } as const;
export const bt709Oetf = odd((L) => (L < BT709.cut ? BT709.slope * L : BT709.a * Math.pow(L, BT709.power) - BT709.b));
export const bt709InvOetf = odd((V) => (V < BT709.vcut ? V / BT709.slope : Math.pow((V + BT709.b) / BT709.a, 1 / BT709.power)));

// --- sRGB (IEC 61966-2-1) ---
export const SRGB = { a: 1.055, b: 0.055, cut: 0.0031308, slope: 12.92, gamma: 2.4, vcut: 0.04045 } as const;
export const srgbEncode = odd((L) => (L <= SRGB.cut ? SRGB.slope * L : SRGB.a * Math.pow(L, 1 / SRGB.gamma) - SRGB.b));
export const srgbDecode = odd((V) => (V <= SRGB.vcut ? V / SRGB.slope : Math.pow((V + SRGB.b) / SRGB.a, SRGB.gamma)));

// --- BT.1886 (reference only; display EOTF, γ 2.4, zero black) ---
export const bt1886Eotf = odd((V) => Math.pow(V, 2.4));
export const bt1886InvEotf = odd((L) => Math.pow(L, 1 / 2.4));

// --- Sony S-Log3 (code value / 1023 domain) ---
export const SLOG3 = { cut: 171.2102946929, black: 95, grey: 420, slope: 261.5, linCut: 0.01125 } as const;
export function slog3Decode(x: number): number {
  const cv = x * 1023;
  return cv >= SLOG3.cut ? Math.pow(10, (cv - SLOG3.grey) / SLOG3.slope) * (0.18 + 0.01) - 0.01 : ((cv - SLOG3.black) * SLOG3.linCut) / (SLOG3.cut - SLOG3.black);
}
export function slog3Encode(L: number): number {
  return L >= SLOG3.linCut
    ? (SLOG3.grey + Math.log10((L + 0.01) / (0.18 + 0.01)) * SLOG3.slope) / 1023
    : ((L * (SLOG3.cut - SLOG3.black)) / SLOG3.linCut + SLOG3.black) / 1023;
}

// --- ARRI LogC3, EI 800 (code value / 1023 domain) ---
export const LOGC3 = { cut: 0.010591, a: 5.555556, b: 0.052272, c: 0.24719, d: 0.385537, e: 5.367655, f: 0.092809 } as const;
export function logc3Encode(x: number): number {
  const p = LOGC3;
  return x > p.cut ? p.c * Math.log10(p.a * x + p.b) + p.d : p.e * x + p.f;
}
export function logc3Decode(t: number): number {
  const p = LOGC3;
  return t > p.e * p.cut + p.f ? (Math.pow(10, (t - p.d) / p.c) - p.b) / p.a : (t - p.f) / p.e;
}

// --- Panasonic V-Log (code value / 1023 domain) ---
export const VLOG = { cut1: 0.01, cut2: 0.181, b: 0.00873, c: 0.241514, d: 0.598206 } as const;
export function vlogEncode(L: number): number {
  return L < VLOG.cut1 ? 5.6 * L + 0.125 : VLOG.c * Math.log10(L + VLOG.b) + VLOG.d;
}
export function vlogDecode(V: number): number {
  return V < VLOG.cut2 ? (V - 0.125) / 5.6 : Math.pow(10, (V - VLOG.d) / VLOG.c) - VLOG.b;
}

// --- Canon Log 3 (IRE domain; linear relative to 90% white: L = 0.9·x) ---
export const CLOG3 = { c: 0.36726845, k: 14.98325, lin: 1.9754798, linOff: 0.12512219, hiOff: 0.12240537, loOff: 0.12783901, xcut: 0.014, ylo: 0.097465473, yhi: 0.15277891 } as const;
export function clog3Encode(L: number): number {
  const p = CLOG3;
  const x = L / 0.9;
  if (x < -p.xcut) return -p.c * Math.log10(-x * p.k + 1) + p.loOff;
  if (x <= p.xcut) return p.lin * x + p.linOff;
  return p.c * Math.log10(x * p.k + 1) + p.hiOff;
}
export function clog3Decode(y: number): number {
  const p = CLOG3;
  let x: number;
  if (y < p.ylo) x = -(Math.pow(10, (p.loOff - y) / p.c) - 1) / p.k;
  else if (y <= p.yhi) x = (y - p.linOff) / p.lin;
  else x = (Math.pow(10, (y - p.hiOff) / p.c) - 1) / p.k;
  return 0.9 * x;
}

// --- Fujifilm F-Log (code value / 1023 domain) ---
export const FLOG = { a: 0.555556, b: 0.009468, c: 0.344676, d: 0.790453, e: 8.735631, f: 0.092864, cut1: 0.00089, cut2: 0.100537775223865 } as const;
export function flogEncode(L: number): number {
  const p = FLOG;
  return L >= p.cut1 ? p.c * Math.log10(p.a * L + p.b) + p.d : p.e * L + p.f;
}
export function flogDecode(V: number): number {
  const p = FLOG;
  return V >= p.cut2 ? (Math.pow(10, (V - p.d) / p.c) - p.b) / p.a : (V - p.f) / p.e;
}

// --- HLG (ITU-R BT.2100) ---
export const HLG = { a: 0.17883277, b: 0.28466892, c: 0.55991073, peakNits: 1000, gamma: 1.2 } as const;
/** HLG inverse OETF: E' → scene-linear E (0..1). */
export function hlgInvOetf(Ep: number): number {
  const v = Math.max(0, Ep);
  return v <= 0.5 ? (v * v) / 3 : (Math.exp((v - HLG.c) / HLG.a) + HLG.b) / 12;
}
export function hlgOetf(E: number): number {
  const v = Math.max(0, E);
  return v <= 1 / 12 ? Math.sqrt(3 * v) : HLG.a * Math.log(12 * v - HLG.b) + HLG.c;
}
const LUMA_2020: Vec3 = [0.2627, 0.678, 0.0593];
/** HLG signal (Rec.2020 RGB) → display light, normalized 100 nits = 1.0 (still Rec.2020 primaries). */
export function hlgDecodeRgb(rgb: Vec3): Vec3 {
  const E: Vec3 = [hlgInvOetf(rgb[0]), hlgInvOetf(rgb[1]), hlgInvOetf(rgb[2])];
  const Ys = LUMA_2020[0] * E[0] + LUMA_2020[1] * E[1] + LUMA_2020[2] * E[2];
  const k = (HLG.peakNits / 100) * Math.pow(Math.max(Ys, 1e-12), HLG.gamma - 1);
  return [E[0] * k, E[1] * k, E[2] * k];
}
/** Inverse of hlgDecodeRgb (display light → HLG signal). */
export function hlgEncodeRgb(F: Vec3): Vec3 {
  const a = HLG.peakNits / 100;
  const Yd = LUMA_2020[0] * F[0] + LUMA_2020[1] * F[1] + LUMA_2020[2] * F[2];
  const Ys = Math.pow(Math.max(Yd, 0) / a, 1 / HLG.gamma);
  const k = Ys > 0 ? 1 / (a * Math.pow(Ys, HLG.gamma - 1)) : 0;
  return [hlgOetf(F[0] * k), hlgOetf(F[1] * k), hlgOetf(F[2] * k)];
}

// --- PQ (SMPTE ST 2084) ---
export const PQ = { m1: 2610 / 16384, m2: (2523 / 4096) * 128, c1: 3424 / 4096, c2: (2413 / 4096) * 32, c3: (2392 / 4096) * 32 } as const;
/** PQ signal → absolute luminance in nits. */
export function pqEotfNits(Ep: number): number {
  const p = Math.pow(Math.max(Ep, 0), 1 / PQ.m2);
  return 10000 * Math.pow(Math.max(p - PQ.c1, 0) / (PQ.c2 - PQ.c3 * p), 1 / PQ.m1);
}
export function pqInvEotfNits(nits: number): number {
  const y = Math.pow(Math.max(nits, 0) / 10000, PQ.m1);
  return Math.pow((PQ.c1 + PQ.c2 * y) / (1 + PQ.c3 * y), PQ.m2);
}
export const pqDecode = (Ep: number) => pqEotfNits(Ep) / 100;
export const pqEncode = (L: number) => pqInvEotfNits(L * 100);

// --- ACEScct (S-2016-001) and the grading log space ---
export const ACESCCT = { linCut: 0.0078125, a: 10.5402377416545, b: 0.0729055341958355, logCut: 0.155251141552511 } as const;
export function acescctEncode(lin: number): number {
  return lin <= ACESCCT.linCut ? ACESCCT.a * lin + ACESCCT.b : (Math.log2(lin) + 9.72) / 17.52;
}
export function acescctDecode(cct: number): number {
  if (cct <= ACESCCT.logCut) return (cct - ACESCCT.b) / ACESCCT.a;
  return Math.min(Math.pow(2, cct * 17.52 - 9.72), 65504);
}
/**
 * Grading log space: ACEScct offset so that 18% grey sits at 0.435, the
 * contrast-pivot convention used by ColorGrade.pivot (and DaVinci Resolve).
 */
export const GRADE_LOG_SHIFT = 0.435 - acescctEncode(0.18);
export const gradeLogEncode = (lin: number) => acescctEncode(lin) + GRADE_LOG_SHIFT;
export const gradeLogDecode = (g: number) => acescctDecode(g - GRADE_LOG_SHIFT);

// ---------------------------------------------------------------------------
// Input transforms
// ---------------------------------------------------------------------------

export type InputCurveId = 'linear' | 'rec709' | 'srgb' | 'slog3' | 'logc3' | 'vlog' | 'clog3' | 'flog' | 'hlg' | 'pq';

export interface InputTransformDef {
  id: InputCurveId;
  /** GLSL switch value. */
  code: number;
  /** Native gamut of the encoding (converted to Rec.709 after linearizing). */
  gamut: GamutId;
  /** Vendor formula expects full-range code values: decoder output is mapped back with cv = (64 + 876 v) / 1023. */
  legalRemap: boolean;
  decode: (v: number) => number;
  encode: (L: number) => number;
}

export const legalToFull = (v: number) => (64 + 876 * v) / 1023;
export const fullToLegal = (cv: number) => (cv * 1023 - 64) / 876;

export const INPUT_TRANSFORMS: Record<InputCurveId, InputTransformDef> = {
  linear: { id: 'linear', code: 0, gamut: 'rec709', legalRemap: false, decode: (v) => v, encode: (L) => L },
  rec709: { id: 'rec709', code: 1, gamut: 'rec709', legalRemap: false, decode: bt709InvOetf, encode: bt709Oetf },
  srgb: { id: 'srgb', code: 2, gamut: 'rec709', legalRemap: false, decode: srgbDecode, encode: srgbEncode },
  slog3: { id: 'slog3', code: 3, gamut: 'sgamut3cine', legalRemap: true, decode: slog3Decode, encode: slog3Encode },
  logc3: { id: 'logc3', code: 4, gamut: 'awg3', legalRemap: true, decode: logc3Decode, encode: logc3Encode },
  vlog: { id: 'vlog', code: 5, gamut: 'vgamut', legalRemap: true, decode: vlogDecode, encode: vlogEncode },
  clog3: { id: 'clog3', code: 6, gamut: 'cinemagamut', legalRemap: false, decode: clog3Decode, encode: clog3Encode },
  flog: { id: 'flog', code: 7, gamut: 'fgamut', legalRemap: true, decode: flogDecode, encode: flogEncode },
  // HLG/PQ are not per-channel separable in full (the HLG OOTF uses luminance);
  // these scalar versions are exact for neutral (grey) values.
  hlg: { id: 'hlg', code: 8, gamut: 'rec2020', legalRemap: false, decode: (v) => hlgDecodeRgb([v, v, v])[0], encode: (L) => hlgEncodeRgb([L, L, L])[0] },
  pq: { id: 'pq', code: 9, gamut: 'rec2020', legalRemap: false, decode: pqDecode, encode: pqEncode },
};

export function inputTransformDef(id: string): InputTransformDef {
  return INPUT_TRANSFORMS[(id in INPUT_TRANSFORMS ? id : 'rec709') as InputCurveId];
}

/** Matrix from the transform's native gamut to Rec.709 primaries. */
export function inputGamutMatrix(id: string): Mat3 {
  return gamutMatrix(inputTransformDef(id).gamut, 'rec709');
}

/**
 * Full input transform for one RGB pixel as the decoder returns it (0..1):
 * linearize (with the legal-range remap for vendor log curves), then convert
 * the native gamut to Rec.709. CPU twin of the GPU input pass.
 */
export function decodeInputRgb(id: string, rgb: Vec3): Vec3 {
  const d = inputTransformDef(id);
  let lin: Vec3;
  if (d.id === 'hlg') lin = hlgDecodeRgb(rgb);
  else {
    const f = (v: number) => d.decode(d.legalRemap ? legalToFull(v) : v);
    lin = [f(rgb[0]), f(rgb[1]), f(rgb[2])];
  }
  return d.gamut === 'rec709' ? lin : apply3(inputGamutMatrix(id), lin);
}

/** Inverse of decodeInputRgb (scene-linear Rec.709 → encoded signal). */
export function encodeInputRgb(id: string, lin709: Vec3): Vec3 {
  const d = inputTransformDef(id);
  const native = d.gamut === 'rec709' ? lin709 : apply3(gamutMatrix('rec709', d.gamut), lin709);
  if (d.id === 'hlg') return hlgEncodeRgb(native);
  const f = (L: number) => {
    const v = d.encode(L);
    return d.legalRemap ? fullToLegal(v) : v;
  };
  return [f(native[0]), f(native[1]), f(native[2])];
}

// ---------------------------------------------------------------------------
// Output (display) transforms
// ---------------------------------------------------------------------------

export type OutputSpace = 'rec709' | 'srgb' | 'p3' | 'rec2020-hlg' | 'rec2020-pq';

/** Output transform code for the GLSL switch. */
export const OUTPUT_CODE: Record<OutputSpace, number> = { rec709: 0, srgb: 1, p3: 2, 'rec2020-hlg': 3, 'rec2020-pq': 3 };

/** HDR → SDR preview tone curve: identity below the knee, extended-Reinhard roll-off reaching 1.0 at `peak`. */
export const TONEMAP = { knee: 0.75, peak: 10, pathToWhite: 0.6 } as const;

export function tonemapScalar(x: number, knee = TONEMAP.knee, peak = TONEMAP.peak): number {
  if (x <= knee) return x;
  const s = 1 - knee;
  const u = (x - knee) / s;
  const W = (peak - knee) / s;
  const g = (u * (1 + u / (W * W))) / (1 + u);
  return Math.min(knee + s * g, 1);
}

/**
 * Hue-preserving gamut clip: out-of-gamut colors (any channel < 0) are pulled
 * toward the achromatic axis (max channel) until they touch the gamut
 * boundary, instead of per-channel clipping that skews hue. In-gamut colors are
 * untouched, so graphics and Rec.709 sources round-trip exactly.
 */
export function gamutClip(c: Vec3): Vec3 {
  const ach = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  if (mn >= 0 || ach <= 0) return [Math.max(c[0], 0), Math.max(c[1], 0), Math.max(c[2], 0)];
  // scale chroma so that the minimum channel lands exactly at 0
  const k = ach / (ach - mn);
  return [ach - (ach - c[0]) * k, ach - (ach - c[1]) * k, ach - (ach - c[2]) * k];
}

/** HDR → SDR (Rec.709) tone map on max(RGB), ratio-preserving with a mild path to white. */
export function tonemapRgb(c: Vec3): Vec3 {
  const m = Math.max(c[0], c[1], c[2]);
  if (m <= TONEMAP.knee) return c;
  const t = tonemapScalar(m);
  const r = t / m;
  const mapped: Vec3 = [c[0] * r, c[1] * r, c[2] * r];
  const w = Math.pow(Math.min(Math.max((t - TONEMAP.knee) / (1 - TONEMAP.knee), 0), 1), 2) * TONEMAP.pathToWhite;
  return [mapped[0] + (t - mapped[0]) * w, mapped[1] + (t - mapped[1]) * w, mapped[2] + (t - mapped[2]) * w];
}

/** Scene-linear Rec.709 → display code values (0..1, before dithering). CPU twin of the output pass. */
export function outputEncodeRgb(space: OutputSpace, lin: Vec3): Vec3 {
  let c = lin;
  if (space === 'rec2020-hlg' || space === 'rec2020-pq') c = tonemapRgb(gamutClip(c));
  if (space === 'p3') c = apply3(gamutMatrix('rec709', 'p3d65'), c);
  c = gamutClip(c);
  const enc = space === 'srgb' || space === 'p3' ? srgbEncode : bt709Oetf;
  const cl = (v: number) => Math.min(Math.max(enc(v), 0), 1);
  return [cl(c[0]), cl(c[1]), cl(c[2])];
}

/**
 * Graphics (text, shapes, solids, gradients, captions, background, effect color
 * params) are authored as hex colors on an sRGB screen. They are decoded with
 * the inverse of the sequence's SDR display encoding, so a picked #808080
 * renders as exactly #808080 in every SDR sequence.
 */
export function graphicsDecode(space: OutputSpace | string, v: number): number {
  return space === 'srgb' || space === 'p3' ? srgbDecode(v) : bt709InvOetf(v);
}
export function graphicsCode(space: OutputSpace | string): number {
  return space === 'srgb' || space === 'p3' ? INPUT_TRANSFORMS.srgb.code : INPUT_TRANSFORMS.rec709.code;
}

/** Parses '#rgb', '#rgba', '#rrggbb' or '#rrggbbaa' (also rgb()/rgba() basics). Returns straight-alpha 0..1 values. */
export function parseHexColor(s: string | undefined | null): [number, number, number, number] | null {
  if (!s) return null;
  const t = s.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(t);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(t);
  if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, m[4] !== undefined ? Number(m[4]) : 1];
  return null;
}

/** Hex color → linear RGBA (straight alpha) using the sequence's graphics decode. */
export function graphicsColorLinear(space: OutputSpace | string, hex: string, fallback: [number, number, number, number] = [0, 0, 0, 1]): [number, number, number, number] {
  const c = parseHexColor(hex);
  if (!c) return fallback;
  return [graphicsDecode(space, c[0]), graphicsDecode(space, c[1]), graphicsDecode(space, c[2]), c[3]];
}

// ---------------------------------------------------------------------------
// GLSL twins (generated from the constants above)
// ---------------------------------------------------------------------------

/** Formats a number as a GLSL float literal with full precision. */
export function glf(v: number): string {
  if (!Number.isFinite(v)) return '0.0';
  const s = v.toPrecision(12);
  const t = /e/i.test(s) ? s : s.replace(/0+$/, '').replace(/\.$/, '');
  return t.includes('.') || /e/i.test(t) ? t : `${t}.0`;
}

const g = glf;

export const GLSL_COLOR = /* glsl */ `
// ---- transfer functions (generated from engine/color/transforms.ts) ----
float oddf(float x, float y) { return x < 0.0 ? -y : y; }
float bt709Oetf(float L) { float a = abs(L); return oddf(L, a < ${g(BT709.cut)} ? ${g(BT709.slope)} * a : ${g(BT709.a)} * pow(a, ${g(BT709.power)}) - ${g(BT709.b)}); }
float bt709InvOetf(float V) { float a = abs(V); return oddf(V, a < ${g(BT709.vcut)} ? a / ${g(BT709.slope)} : pow((a + ${g(BT709.b)}) / ${g(BT709.a)}, ${g(1 / BT709.power)})); }
float srgbEncode(float L) { float a = abs(L); return oddf(L, a <= ${g(SRGB.cut)} ? ${g(SRGB.slope)} * a : ${g(SRGB.a)} * pow(a, ${g(1 / SRGB.gamma)}) - ${g(SRGB.b)}); }
float srgbDecode(float V) { float a = abs(V); return oddf(V, a <= ${g(SRGB.vcut)} ? a / ${g(SRGB.slope)} : pow((a + ${g(SRGB.b)}) / ${g(SRGB.a)}, ${g(SRGB.gamma)})); }
vec3 bt709Oetf3(vec3 c) { return vec3(bt709Oetf(c.r), bt709Oetf(c.g), bt709Oetf(c.b)); }
vec3 bt709InvOetf3(vec3 c) { return vec3(bt709InvOetf(c.r), bt709InvOetf(c.g), bt709InvOetf(c.b)); }
vec3 srgbEncode3(vec3 c) { return vec3(srgbEncode(c.r), srgbEncode(c.g), srgbEncode(c.b)); }
vec3 srgbDecode3(vec3 c) { return vec3(srgbDecode(c.r), srgbDecode(c.g), srgbDecode(c.b)); }
float slog3Decode(float x) {
  float cv = x * 1023.0;
  return cv >= ${g(SLOG3.cut)} ? pow(10.0, (cv - ${g(SLOG3.grey)}) / ${g(SLOG3.slope)}) * 0.19 - 0.01 : (cv - ${g(SLOG3.black)}) * ${g(SLOG3.linCut / (SLOG3.cut - SLOG3.black))};
}
float logc3Decode(float t) {
  return t > ${g(LOGC3.e * LOGC3.cut + LOGC3.f)} ? (pow(10.0, (t - ${g(LOGC3.d)}) / ${g(LOGC3.c)}) - ${g(LOGC3.b)}) / ${g(LOGC3.a)} : (t - ${g(LOGC3.f)}) / ${g(LOGC3.e)};
}
float vlogDecode(float V) {
  return V < ${g(VLOG.cut2)} ? (V - 0.125) / 5.6 : pow(10.0, (V - ${g(VLOG.d)}) / ${g(VLOG.c)}) - ${g(VLOG.b)};
}
float clog3Decode(float y) {
  float x;
  if (y < ${g(CLOG3.ylo)}) x = -(pow(10.0, (${g(CLOG3.loOff)} - y) / ${g(CLOG3.c)}) - 1.0) / ${g(CLOG3.k)};
  else if (y <= ${g(CLOG3.yhi)}) x = (y - ${g(CLOG3.linOff)}) / ${g(CLOG3.lin)};
  else x = (pow(10.0, (y - ${g(CLOG3.hiOff)}) / ${g(CLOG3.c)}) - 1.0) / ${g(CLOG3.k)};
  return 0.9 * x;
}
float flogDecode(float V) {
  return V >= ${g(FLOG.cut2)} ? (pow(10.0, (V - ${g(FLOG.d)}) / ${g(FLOG.c)}) - ${g(FLOG.b)}) / ${g(FLOG.a)} : (V - ${g(FLOG.f)}) / ${g(FLOG.e)};
}
float hlgInvOetf(float v) {
  v = max(v, 0.0);
  return v <= 0.5 ? v * v / 3.0 : (exp((v - ${g(HLG.c)}) / ${g(HLG.a)}) + ${g(HLG.b)}) / 12.0;
}
vec3 hlgDecode3(vec3 c) {
  vec3 E = vec3(hlgInvOetf(c.r), hlgInvOetf(c.g), hlgInvOetf(c.b));
  float Ys = dot(E, vec3(${g(LUMA_2020[0])}, ${g(LUMA_2020[1])}, ${g(LUMA_2020[2])}));
  return E * (${g(HLG.peakNits / 100)} * pow(max(Ys, 1e-12), ${g(HLG.gamma - 1)}));
}
float pqDecode(float v) {
  float p = pow(max(v, 0.0), ${g(1 / PQ.m2)});
  return 100.0 * pow(max(p - ${g(PQ.c1)}, 0.0) / (${g(PQ.c2)} - ${g(PQ.c3)} * p), ${g(1 / PQ.m1)});
}
float legalToFull(float v) { return (64.0 + 876.0 * v) / 1023.0; }
// code: 0 linear, 1 rec709, 2 srgb, 3 slog3, 4 logc3, 5 vlog, 6 clog3, 7 flog, 8 hlg, 9 pq
vec3 decodeInput(int code, vec3 c) {
  if (code == 1) return bt709InvOetf3(c);
  if (code == 2) return srgbDecode3(c);
  if (code == 3) { c = vec3(legalToFull(c.r), legalToFull(c.g), legalToFull(c.b)); return vec3(slog3Decode(c.r), slog3Decode(c.g), slog3Decode(c.b)); }
  if (code == 4) { c = vec3(legalToFull(c.r), legalToFull(c.g), legalToFull(c.b)); return vec3(logc3Decode(c.r), logc3Decode(c.g), logc3Decode(c.b)); }
  if (code == 5) { c = vec3(legalToFull(c.r), legalToFull(c.g), legalToFull(c.b)); return vec3(vlogDecode(c.r), vlogDecode(c.g), vlogDecode(c.b)); }
  if (code == 6) return vec3(clog3Decode(c.r), clog3Decode(c.g), clog3Decode(c.b));
  if (code == 7) { c = vec3(legalToFull(c.r), legalToFull(c.g), legalToFull(c.b)); return vec3(flogDecode(c.r), flogDecode(c.g), flogDecode(c.b)); }
  if (code == 8) return hlgDecode3(c);
  if (code == 9) return vec3(pqDecode(c.r), pqDecode(c.g), pqDecode(c.b));
  return c;
}
// ---- grading log space (ACEScct + ${g(GRADE_LOG_SHIFT)}) ----
float gradeLogEnc(float x) { return (x <= ${g(ACESCCT.linCut)} ? ${g(ACESCCT.a)} * x + ${g(ACESCCT.b)} : (log2(x) + 9.72) / 17.52) + ${g(GRADE_LOG_SHIFT)}; }
float gradeLogDec(float y) { y -= ${g(GRADE_LOG_SHIFT)}; return y <= ${g(ACESCCT.logCut)} ? (y - ${g(ACESCCT.b)}) / ${g(ACESCCT.a)} : exp2(min(y, 1.4679964) * 17.52 - 9.72); }
vec3 gradeLogEnc3(vec3 c) { return vec3(gradeLogEnc(c.r), gradeLogEnc(c.g), gradeLogEnc(c.b)); }
vec3 gradeLogDec3(vec3 c) { return vec3(gradeLogDec(c.r), gradeLogDec(c.g), gradeLogDec(c.b)); }
// ---- output helpers ----
vec3 gamutClip(vec3 c) {
  float ach = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  if (mn >= 0.0 || ach <= 0.0) return max(c, vec3(0.0));
  float k = ach / (ach - mn);
  return vec3(ach) - (vec3(ach) - c) * k;
}
float tonemapScalar(float x) {
  const float knee = ${g(TONEMAP.knee)};
  const float s = ${g(1 - TONEMAP.knee)};
  const float W = ${g((TONEMAP.peak - TONEMAP.knee) / (1 - TONEMAP.knee))};
  if (x <= knee) return x;
  float u = (x - knee) / s;
  return min(knee + s * (u * (1.0 + u / (W * W)) / (1.0 + u)), 1.0);
}
vec3 tonemapRgb(vec3 c) {
  float m = max(c.r, max(c.g, c.b));
  if (m <= ${g(TONEMAP.knee)}) return c;
  float t = tonemapScalar(m);
  vec3 mapped = c * (t / m);
  float w = clamp((t - ${g(TONEMAP.knee)}) / ${g(1 - TONEMAP.knee)}, 0.0, 1.0);
  return mix(mapped, vec3(t), w * w * ${g(TONEMAP.pathToWhite)});
}
`;
