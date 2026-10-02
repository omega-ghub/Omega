// Frame analysis for grading assists: white balance estimation ("Auto
// balance") and statistical shot matching ("Match to reference").
// Pure functions over RGBA8 display-referred pixels. OWNED BY THE COLOR PACKAGE.
//
// AUTO BALANCE (gray world + white point)
// ---------------------------------------
//   1. Linearize every pixel with the sRGB/Rec.709 display EOTF (the viewer's
//      output is display-referred, so ratios must be taken in linear light).
//   2. Ignore pixels that cannot tell us about the illuminant: any channel at
//      or above code 250 (clipped, its chroma is wrong) and pixels darker than
//      0.4 % linear luma (noise and crushed blacks).
//   3. Gray-world estimate GW = mean linear RGB of the kept pixels (the
//      average scene reflectance is assumed achromatic).
//   4. White-point estimate WP = mean linear RGB of the brightest 3 % of the
//      kept pixels, ranked by R+G+B (not by luma, which would favour greenish
//      pixels). The brightest surfaces are assumed to be white or specular,
//      i.e. to show the illuminant colour. Averaging rather than taking the max
//      makes it robust to single hot pixels.
//   5. Each estimate is normalized to unit luminance and the two are combined
//      as a weighted geometric mean (log-chromaticity average). The white
//      point gets weight 0.5, reduced linearly to 0 as the clipped share of
//      the frame grows from 0.2 % to 2 % (clipped highlights hide the light's
//      colour and bias the remaining bright pixels), and capped at 0.25 when
//      the bright pixels are strongly coloured (a red car is not a white wall).
//   6. The neutralizing per-channel multiplier is m_c = Y(cast) / cast_c, which
//      maps the cast to grey and leaves its luminance unchanged.
//   7. log2(m) is decomposed into an orthogonal basis:
//        temperature axis t = ( a, 0, −a)    (red ↔ blue)
//        tint axis        n = ( b/2, −b, b/2) (magenta ↔ green)
//        brightness       1 = ( 1, 1, 1)
//      T = (L_r − L_b) / 2a,   N = (L_r/2 − L_g + L_b/2) / 1.5b
//      Whatever cannot be expressed after clamping T and N to their slider
//      range is returned as a residual per-channel multiplier (applied to gain).
//
// SHOT MATCH (per-channel mean and standard deviation)
// ----------------------------------------------------
//   For each channel c of the display-referred signal (0..1):
//     g_c = σ_ref,c / σ_cur,c          (contrast / gain per channel)
//     o_c = μ_ref,c − g_c · μ_cur,c     (balance / offset per channel)
//   so the matched channel x′ = g_c·x + o_c has exactly the reference's mean
//   and spread. Saturation s is then the ratio of the reference's chroma RMS
//   (Cb/Cr spread around its mean) to the chroma RMS the current frame would
//   have after the per-channel map. g_c is clamped to 0.25..4, s to 0..2.

import { CB_DIV, CR_DIV, KB, KG, KR, type RGBAFrame } from './scopes';

export type RGB = [number, number, number];

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------

/** sRGB / Rec.709-display EOTF of a normalized value. */
export function eotf(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Inverse of `eotf`. */
export function oetf(v: number): number {
  if (v <= 0) return 0;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

const LIN8 = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) t[i] = eotf(i / 255);
  return t;
})();

export function lumaLinear(c: RGB): number {
  return KR * c[0] + KG * c[1] + KB * c[2];
}

// ---------------------------------------------------------------------------
// White balance
// ---------------------------------------------------------------------------

export interface IlluminantEstimate {
  /** Mean linear RGB of usable pixels. */
  grayWorld: RGB;
  /** Mean linear RGB of the brightest usable pixels. */
  whitePoint: RGB;
  /** Combined cast, normalized to unit luminance (1,1,1 = neutral). */
  cast: RGB;
  /** Weight given to the white-point estimate. */
  whiteWeight: number;
  /** Number of pixels used. */
  used: number;
}

const CLIP_CODE = 250;
const DARK_LIN = 0.004;
const WHITE_FRACTION = 0.03;

function normalizeLuma(c: RGB): RGB {
  const y = lumaLinear(c);
  return y > 1e-9 ? [c[0] / y, c[1] / y, c[2] / y] : [1, 1, 1];
}

/** Chroma strength of a unit-luma colour: spread of its log2 channels. */
function logSpread(c: RGB): number {
  const l = c.map((v) => Math.log2(Math.max(v, 1e-6)));
  return Math.max(...l) - Math.min(...l);
}

export function estimateIlluminant(frame: RGBAFrame): IlluminantEstimate | null {
  const { width, height, data } = frame;
  const n = width * height;
  // pass 1: gray world + brightness histogram of usable pixels (for the top-N threshold)
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let used = 0;
  let clipped = 0;
  const hist = new Uint32Array(1024);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const R = data[i];
    const G = data[i + 1];
    const B = data[i + 2];
    if (R >= CLIP_CODE || G >= CLIP_CODE || B >= CLIP_CODE) {
      clipped++;
      continue;
    }
    const r = LIN8[R];
    const g = LIN8[G];
    const b = LIN8[B];
    if (KR * r + KG * g + KB * b < DARK_LIN) continue;
    sr += r;
    sg += g;
    sb += b;
    used++;
    hist[Math.min(1023, Math.floor(((r + g + b) / 3) * 1024))]++;
  }
  if (used < 16) return null;
  const grayWorld: RGB = [sr / used, sg / used, sb / used];
  // threshold for the brightest WHITE_FRACTION
  const want = Math.max(1, Math.round(used * WHITE_FRACTION));
  let acc = 0;
  let thr = 1023;
  for (; thr > 0; thr--) {
    acc += hist[thr];
    if (acc >= want) break;
  }
  const sMin = thr / 1024;
  let wr = 0;
  let wg = 0;
  let wb = 0;
  let wn = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const R = data[i];
    const G = data[i + 1];
    const B = data[i + 2];
    if (R >= CLIP_CODE || G >= CLIP_CODE || B >= CLIP_CODE) continue;
    const r = LIN8[R];
    const g = LIN8[G];
    const b = LIN8[B];
    if (KR * r + KG * g + KB * b < DARK_LIN || (r + g + b) / 3 < sMin) continue;
    wr += r;
    wg += g;
    wb += b;
    wn++;
  }
  const whitePoint: RGB = wn ? [wr / wn, wg / wn, wb / wn] : grayWorld;
  const gw = normalizeLuma(grayWorld);
  const wp = normalizeLuma(whitePoint);
  const clippedShare = clipped / n;
  let whiteWeight = 0.5 * Math.max(0, Math.min(1, 1 - (clippedShare - 0.002) / 0.018));
  // A strongly coloured "white" is more likely a coloured object than the light.
  if (logSpread(wp) > 1.2) whiteWeight = Math.min(whiteWeight, 0.25);
  const cast = normalizeLuma([0, 1, 2].map((k) => Math.exp((1 - whiteWeight) * Math.log(Math.max(gw[k], 1e-6)) + whiteWeight * Math.log(Math.max(wp[k], 1e-6)))) as RGB);
  return { grayWorld, whitePoint, cast, whiteWeight, used };
}

/** Per-channel multipliers that turn `cast` grey without changing its luminance. */
export function neutralizingGains(cast: RGB): RGB {
  const y = lumaLinear(cast);
  return [y / Math.max(cast[0], 1e-6), y / Math.max(cast[1], 1e-6), y / Math.max(cast[2], 1e-6)];
}

/**
 * The white-balance model of the temperature and tint sliders, as log2
 * multipliers per unit of slider: temperature +1 multiplies R by 2^tempStops/100
 * and B by 2^−tempStops/100; tint +1 multiplies G by 2^−tintStops/100 and R, B
 * by 2^(tintStops/200) (positive tint = magenta).
 */
export interface WhiteBalanceModel {
  /** log2 stops on R (and −stops on B) at temperature +100. */
  tempStops: number;
  /** log2 stops removed from G at tint +100 (half added to R and B). */
  tintStops: number;
}

export interface WhiteBalanceSolution {
  /** Slider deltas to add to the current temperature and tint. */
  temperature: number;
  tint: number;
  /** Residual per-channel multiplier not reachable within the slider range (1 = none). */
  residual: RGB;
}

/**
 * Expresses the multipliers `m` in temperature/tint units (see the header),
 * given the current slider values so the result stays within ±100.
 */
export function solveWhiteBalance(m: RGB, model: WhiteBalanceModel, current = { temperature: 0, tint: 0 }): WhiteBalanceSolution {
  const L = m.map((v) => Math.log2(Math.max(v, 1e-6)));
  const a = model.tempStops / 100;
  const b = model.tintStops / 100;
  let T = (L[0] - L[2]) / (2 * a);
  let N = (L[0] / 2 - L[1] + L[2] / 2) / (1.5 * b);
  const clampDelta = (d: number, cur: number) => Math.max(-100 - cur, Math.min(100 - cur, d));
  T = clampDelta(T, current.temperature);
  N = clampDelta(N, current.tint);
  // achieved log multipliers
  const A = [T * a + (N * b) / 2, -N * b, -T * a + (N * b) / 2];
  const rest = L.map((v, k) => v - A[k]);
  const mean = (rest[0] + rest[1] + rest[2]) / 3;
  const residual = rest.map((v) => Math.pow(2, v - mean)) as RGB;
  return { temperature: T, tint: N, residual };
}

/** The per-channel multipliers a temperature/tint pair produces in the model. */
export function whiteBalanceGains(temperature: number, tint: number, model: WhiteBalanceModel): RGB {
  const a = model.tempStops / 100;
  const b = model.tintStops / 100;
  return [Math.pow(2, temperature * a + (tint * b) / 2), Math.pow(2, -tint * b), Math.pow(2, -temperature * a + (tint * b) / 2)];
}

// ---------------------------------------------------------------------------
// Statistics and shot match
// ---------------------------------------------------------------------------

export interface ChannelStats {
  /** Mean per channel, display-referred 0..1. */
  mean: RGB;
  /** Standard deviation per channel. */
  std: RGB;
  /** Chroma RMS around the mean chroma (Cb/Cr units). */
  chromaRms: number;
  /** Mean luma 0..1. */
  meanLuma: number;
  count: number;
}

export function channelStats(frame: RGBAFrame, map?: { gain: RGB; offset: RGB }): ChannelStats {
  const { width, height, data } = frame;
  const n = width * height;
  const g = map?.gain ?? [1, 1, 1];
  const o = map?.offset ?? [0, 0, 0];
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;
  let scb = 0;
  let scr = 0;
  let qc = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = (data[i] / 255) * g[0] + o[0];
    const gg = (data[i + 1] / 255) * g[1] + o[1];
    const b = (data[i + 2] / 255) * g[2] + o[2];
    s0 += r;
    s1 += gg;
    s2 += b;
    q0 += r * r;
    q1 += gg * gg;
    q2 += b * b;
    const y = KR * r + KG * gg + KB * b;
    const cb = (b - y) / CB_DIV;
    const cr = (r - y) / CR_DIV;
    scb += cb;
    scr += cr;
    qc += cb * cb + cr * cr;
  }
  if (!n) return { mean: [0, 0, 0], std: [0, 0, 0], chromaRms: 0, meanLuma: 0, count: 0 };
  const mean: RGB = [s0 / n, s1 / n, s2 / n];
  const sd = (q: number, m: number) => Math.sqrt(Math.max(0, q / n - m * m));
  const std: RGB = [sd(q0, mean[0]), sd(q1, mean[1]), sd(q2, mean[2])];
  const mcb = scb / n;
  const mcr = scr / n;
  const chromaRms = Math.sqrt(Math.max(0, qc / n - mcb * mcb - mcr * mcr));
  return { mean, std, chromaRms, meanLuma: KR * mean[0] + KG * mean[1] + KB * mean[2], count: n };
}

export interface MatchSolution {
  /** Per-channel multiplier and offset (display-referred) that align mean and std. */
  gain: RGB;
  offset: RGB;
  /** Saturation multiplier aligning the chroma spread. */
  saturation: number;
  /** Stats of both frames, for display. */
  current: ChannelStats;
  reference: ChannelStats;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function solveMatch(current: RGBAFrame, reference: RGBAFrame): MatchSolution {
  const cur = channelStats(current);
  const ref = channelStats(reference);
  const gain = [0, 1, 2].map((k) => (cur.std[k] > 1e-4 ? clamp(ref.std[k] / cur.std[k], 0.25, 4) : 1)) as RGB;
  let offset = [0, 1, 2].map((k) => ref.mean[k] - gain[k] * cur.mean[k]) as RGB;
  // Chroma spread is unaffected by offsets, so it can be predicted before they are final.
  const predicted = channelStats(current, { gain, offset });
  const saturation = predicted.chromaRms > 1e-4 ? clamp(ref.chromaRms / predicted.chromaRms, 0, 2) : 1;
  // Saturation scales chroma around luma, which would also scale the mean
  // colour; pre-compensate the offsets so the means still land exactly:
  //   μ′_c = Y_ref + s·(μA_c − Y_ref) = μ_ref,c  ⇒  μA_c = Y_ref + (μ_ref,c − Y_ref)/s
  if (saturation > 0.05) {
    const yRef = ref.meanLuma;
    offset = [0, 1, 2].map((k) => yRef + (ref.mean[k] - yRef) / saturation - gain[k] * cur.mean[k]) as RGB;
  }
  return { gain, offset, saturation, current: cur, reference: ref };
}

/**
 * Applies a match solution to pixels (CPU reference of the intended result):
 * per-channel affine map, then saturation around luma. Used by tests and for
 * the reference preview.
 */
export function applyMatch(frame: RGBAFrame, sol: Pick<MatchSolution, 'gain' | 'offset' | 'saturation'>): RGBAFrame {
  const { width, height, data } = frame;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height * 4; i += 4) {
    const r = (data[i] / 255) * sol.gain[0] + sol.offset[0];
    const g = (data[i + 1] / 255) * sol.gain[1] + sol.offset[1];
    const b = (data[i + 2] / 255) * sol.gain[2] + sol.offset[2];
    const y = KR * r + KG * g + KB * b;
    out[i] = (y + (r - y) * sol.saturation) * 255;
    out[i + 1] = (y + (g - y) * sol.saturation) * 255;
    out[i + 2] = (y + (b - y) * sol.saturation) * 255;
    out[i + 3] = 255;
  }
  return { width, height, data: out };
}
