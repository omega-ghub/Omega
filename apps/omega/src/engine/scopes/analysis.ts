// Frame analysis for grading assists: white balance estimation ("Auto
// balance") and statistical shot matching ("Match to reference").
// Pure functions over RGBA8 display-referred pixels. OWNED BY THE COLOR PACKAGE.
//
// AUTO BALANCE (gray world + white point)
// ---------------------------------------
//   1. Linearize every pixel with the display decode of the sequence (BT.709
//      inverse OETF for Rec.709, sRGB for sRGB/P3; a 256-entry table), since
//      illuminant ratios must be taken in linear light.
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
//   6. Solve the sliders (`solveWhiteBalance`): with W(T, N) the grade's
//      white-balance matrix (temperature T, tint N), the frame was rendered
//      with W(T0, N0), so the scene illuminant is s = W(T0, N0)⁻¹ · cast. Newton
//      iterations (numeric Jacobian) find T, N with W(T, N)·s neutral, i.e.
//      ln(R/G) = ln(B/G) = 0, clamped to the ±100 slider range.
//   7. Whatever the sliders cannot reach is returned as a residual per-channel
//      multiplier r_c = Y(o) / o_c (o = W(T, N)·s), luminance-preserving, which
//      the color panel applies as an Offset (in a log grading space an offset
//      is exactly a per-channel linear multiplier).
//
// SHOT MATCH (per-channel mean and standard deviation)
// ----------------------------------------------------
//   Statistics are taken in a working domain given by a 256-entry table per
//   code value (default: the display signal 0..1; the color panel passes the
//   renderer's normalized log grading domain so the result maps onto the
//   wheels exactly). For each channel c:
//     g_c = σ_ref,c / σ_cur,c          (gain per channel, clamped 0.25..4)
//     o_c = μ_ref,c − g_c · μ_cur,c     (offset per channel)
//   so x′ = g_c·x + o_c has exactly the reference's mean and spread. The
//   saturation s (clamped 0..2) is the ratio of the reference's chroma RMS
//   (Cb/Cr spread around its mean chroma) to the chroma RMS after the map.
//   Saturation scales chroma around luma, which would also scale the mean
//   colour, so the offsets are pre-compensated to keep the means exact:
//     o_c = Y_ref + (μ_ref,c − Y_ref)/s − g_c · μ_cur,c

import { CB_DIV, CR_DIV, KB, KG, KR, type RGBAFrame } from './scopes';

export type RGB = [number, number, number];
/** Row-major 3×3 matrix. */
export type M3 = [number, number, number, number, number, number, number, number, number];

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------

/** sRGB EOTF of a normalized value. */
export function eotf(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Inverse of `eotf`. */
export function oetf(v: number): number {
  if (v <= 0) return 0;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** A per-code-value table (256 entries) mapping 8-bit codes into a working domain. */
export function codeTable(f: (v: number) => number): Float32Array {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) t[i] = f(i / 255);
  return t;
}

const SRGB_TABLE = codeTable(eotf);
const IDENTITY_TABLE = codeTable((v) => v);

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

/**
 * Estimates the colour of the light in a display-referred frame.
 * `linear` maps 8-bit codes to linear light (default: sRGB EOTF).
 */
export function estimateIlluminant(frame: RGBAFrame, linear: Float32Array = SRGB_TABLE): IlluminantEstimate | null {
  const { width, height, data } = frame;
  const n = width * height;
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
    const r = linear[R];
    const g = linear[G];
    const b = linear[B];
    if (KR * r + KG * g + KB * b < DARK_LIN) continue;
    sr += r;
    sg += g;
    sb += b;
    used++;
    hist[Math.min(1023, Math.max(0, Math.floor(((r + g + b) / 3) * 1024)))]++;
  }
  if (used < 16) return null;
  const grayWorld: RGB = [sr / used, sg / used, sb / used];
  // brightness threshold of the brightest WHITE_FRACTION
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
    const r = linear[R];
    const g = linear[G];
    const b = linear[B];
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
  if (logSpread(wp) > 1.2) whiteWeight = Math.min(whiteWeight, 0.25);
  const cast = normalizeLuma([0, 1, 2].map((k) => Math.exp((1 - whiteWeight) * Math.log(Math.max(gw[k], 1e-6)) + whiteWeight * Math.log(Math.max(wp[k], 1e-6)))) as RGB);
  return { grayWorld, whitePoint, cast, whiteWeight, used };
}

/** Per-channel multipliers that turn `cast` grey without changing its luminance. */
export function neutralizingGains(cast: RGB): RGB {
  const y = lumaLinear(cast);
  return [y / Math.max(cast[0], 1e-6), y / Math.max(cast[1], 1e-6), y / Math.max(cast[2], 1e-6)];
}

export function applyM3(m: M3, v: RGB): RGB {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

export function invM3(m: M3): M3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const k = Math.abs(det) > 1e-12 ? 1 / det : 0;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

export interface WhiteBalanceSolution {
  /** New absolute slider values (−100..100). */
  temperature: number;
  tint: number;
  /** Residual per-channel multiplier the sliders could not reach (1 = none). */
  residual: RGB;
  /** Remaining imbalance after the solve, |ln(R/G)| + |ln(B/G)| of the neutralized cast. */
  error: number;
}

/**
 * Finds temperature/tint that neutralize an observed cast (see the header).
 * `wb(T, N)` is the grade's linear white-balance matrix.
 */
export function solveWhiteBalance(cast: RGB, wb: (temperature: number, tint: number) => M3, current = { temperature: 0, tint: 0 }): WhiteBalanceSolution {
  const scene = applyM3(invM3(wb(current.temperature, current.tint)), cast);
  const F = (T: number, N: number): [number, number] => {
    const o = applyM3(wb(T, N), scene).map((v) => Math.max(v, 1e-9));
    return [Math.log(o[0] / o[1]), Math.log(o[2] / o[1])];
  };
  const clampS = (v: number) => Math.max(-100, Math.min(100, v));
  let T = current.temperature;
  let N = current.tint;
  let f = F(T, N);
  for (let it = 0; it < 40 && Math.abs(f[0]) + Math.abs(f[1]) > 1e-7; it++) {
    const h = 0.25;
    const fT = F(T + h, N);
    const fN = F(T, N + h);
    const j00 = (fT[0] - f[0]) / h;
    const j10 = (fT[1] - f[1]) / h;
    const j01 = (fN[0] - f[0]) / h;
    const j11 = (fN[1] - f[1]) / h;
    const det = j00 * j11 - j01 * j10;
    let dT: number;
    let dN: number;
    if (Math.abs(det) > 1e-12) {
      dT = (-f[0] * j11 + f[1] * j01) / det;
      dN = (-f[1] * j00 + f[0] * j10) / det;
    } else {
      // degenerate: gradient step on the squared error
      dT = -(f[0] * j00 + f[1] * j10) * 50;
      dN = -(f[0] * j01 + f[1] * j11) * 50;
    }
    // damp very large steps, stay inside the slider range
    const len = Math.hypot(dT, dN);
    if (len > 60) {
      dT *= 60 / len;
      dN *= 60 / len;
    }
    const nT = clampS(T + dT);
    const nN = clampS(N + dN);
    const nf = F(nT, nN);
    if (Math.abs(nf[0]) + Math.abs(nf[1]) >= Math.abs(f[0]) + Math.abs(f[1]) - 1e-12) {
      // no progress (e.g. pinned at the range edge): try a half step once, then stop
      const hT = clampS(T + dT / 2);
      const hN = clampS(N + dN / 2);
      const hf = F(hT, hN);
      if (Math.abs(hf[0]) + Math.abs(hf[1]) < Math.abs(f[0]) + Math.abs(f[1])) {
        T = hT;
        N = hN;
        f = hf;
        continue;
      }
      break;
    }
    T = nT;
    N = nN;
    f = nf;
  }
  const o = applyM3(wb(T, N), scene);
  const residual = neutralizingGains(o.map((v) => Math.max(v, 1e-9)) as RGB);
  return { temperature: T, tint: N, residual, error: Math.abs(f[0]) + Math.abs(f[1]) };
}

// ---------------------------------------------------------------------------
// Statistics and shot match
// ---------------------------------------------------------------------------

export interface ChannelStats {
  /** Mean per channel, in the working domain. */
  mean: RGB;
  /** Standard deviation per channel. */
  std: RGB;
  /** Chroma RMS around the mean chroma (Cb/Cr units). */
  chromaRms: number;
  /** Luma of the mean. */
  meanLuma: number;
  count: number;
}

export interface ChannelMap {
  gain: RGB;
  offset: RGB;
  /** Saturation around luma, applied after gain/offset (default 1). */
  saturation?: number;
}

/**
 * Per-channel statistics of a frame in the working domain given by `table`
 * (default: display signal 0..1), optionally after a channel map.
 */
export function channelStats(frame: RGBAFrame, map?: ChannelMap, table: Float32Array = IDENTITY_TABLE): ChannelStats {
  const { width, height, data } = frame;
  const n = width * height;
  const g = map?.gain ?? [1, 1, 1];
  const o = map?.offset ?? [0, 0, 0];
  const s = map?.saturation ?? 1;
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
    let r = table[data[i]] * g[0] + o[0];
    let gg = table[data[i + 1]] * g[1] + o[1];
    let b = table[data[i + 2]] * g[2] + o[2];
    const y = KR * r + KG * gg + KB * b;
    if (s !== 1) {
      r = y + (r - y) * s;
      gg = y + (gg - y) * s;
      b = y + (b - y) * s;
    }
    s0 += r;
    s1 += gg;
    s2 += b;
    q0 += r * r;
    q1 += gg * gg;
    q2 += b * b;
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
  /** Per-channel multiplier and offset (working domain) that align mean and std. */
  gain: RGB;
  offset: RGB;
  /** Saturation multiplier aligning the chroma spread. */
  saturation: number;
  /** Stats of both frames, for display. */
  current: ChannelStats;
  reference: ChannelStats;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Solves the statistical match of `current` to `reference` (see the header). */
export function solveMatch(current: RGBAFrame, reference: RGBAFrame, table: Float32Array = IDENTITY_TABLE): MatchSolution {
  const cur = channelStats(current, undefined, table);
  const ref = channelStats(reference, undefined, table);
  const gain = [0, 1, 2].map((k) => (cur.std[k] > 1e-4 ? clamp(ref.std[k] / cur.std[k], 0.25, 4) : 1)) as RGB;
  let offset = [0, 1, 2].map((k) => ref.mean[k] - gain[k] * cur.mean[k]) as RGB;
  // Chroma spread does not depend on the offsets, so it can be predicted now.
  const predicted = channelStats(current, { gain, offset }, table);
  const saturation = predicted.chromaRms > 1e-4 ? clamp(ref.chromaRms / predicted.chromaRms, 0, 2) : 1;
  if (saturation > 0.05) {
    const yRef = ref.meanLuma;
    offset = [0, 1, 2].map((k) => yRef + (ref.mean[k] - yRef) / saturation - gain[k] * cur.mean[k]) as RGB;
  }
  return { gain, offset, saturation, current: cur, reference: ref };
}

/** Stats of `frame` after applying a match solution (CPU reference of the intended result). */
export function matchedStats(frame: RGBAFrame, sol: Pick<MatchSolution, 'gain' | 'offset' | 'saturation'>, table: Float32Array = IDENTITY_TABLE): ChannelStats {
  return channelStats(frame, { gain: sol.gain, offset: sol.offset, saturation: sol.saturation }, table);
}
