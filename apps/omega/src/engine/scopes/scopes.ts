// Video scopes: pure functions over RGBA8 display-referred pixels (what the
// program viewer shows, top row first). OWNED BY THE COLOR PACKAGE.
//
// Every scope works in two stages:
//   1. ACCUMULATE: count pixels into bins (Uint32Array). This is the exact,
//      testable part: a white frame lands in the 100 IRE row, a pure red frame
//      lands on the red vector target, and so on.
//   2. TONE: turn the counts into a log-scaled density (0..1) and paint it with
//      a phosphor-like look (tinted trace that blooms towards white where it is
//      dense). The UI draws the resulting RGBA image with additive blending.
//
// Signal conventions (full-range, display-referred, Rec.709 coefficients):
//   Y′ = 0.2126 R′ + 0.7152 G′ + 0.0722 B′           (code value / 255)
//   Cb = (B′ − Y′) / 1.8556,  Cr = (R′ − Y′) / 1.5748  (each in −0.5..0.5)
//   0 IRE = code 0, 100 IRE = code 255 (the viewer's RGBA8 output is full range).
//   10-bit legal code values: 0 IRE = 64, 100 IRE = 940 (SMPTE video range).

export const KR = 0.2126;
export const KG = 0.7152;
export const KB = 0.0722;
/** 2·(1 − Kb) and 2·(1 − Kr) for Rec.709. */
export const CB_DIV = 1.8556;
export const CR_DIV = 1.5748;

export interface RGBAFrame {
  width: number;
  height: number;
  /** RGBA8, top row first. Length ≥ width·height·4. */
  data: Uint8ClampedArray | Uint8Array;
}

/** A finished scope picture: RGBA8 ready for putImageData. */
export interface ScopeImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

// ---------------------------------------------------------------------------
// Signal helpers
// ---------------------------------------------------------------------------

/** Rec.709 luma (Y′) of 8-bit code values, returned in code units (0..255). */
export function luma8(r: number, g: number, b: number): number {
  return KR * r + KG * g + KB * b;
}

/** Cb/Cr (each −0.5..0.5) of normalized R′G′B′ (0..1). */
export function cbcr(r: number, g: number, b: number): { cb: number; cr: number; y: number } {
  const y = KR * r + KG * g + KB * b;
  return { cb: (b - y) / CB_DIV, cr: (r - y) / CR_DIV, y };
}

/** IRE (0..100) of a normalized signal level (0..1). */
export function toIre(level: number): number {
  return level * 100;
}

/** 10-bit legal-range code value of an IRE level (0 IRE → 64, 100 IRE → 940). */
export function ireToCode10(ire: number): number {
  return 64 + (ire / 100) * 876;
}

/** IRE of a 10-bit legal-range code value. */
export function code10ToIre(code: number): number {
  return ((code - 64) / 876) * 100;
}

// ---------------------------------------------------------------------------
// Waveform and parade
// ---------------------------------------------------------------------------

export interface WaveformAccum {
  cols: number;
  rows: number;
  /** cols·rows counts, row 0 = top (100 IRE), row rows−1 = bottom (0 IRE). */
  counts: Uint32Array;
}

/** Row (0 = top) of a normalized level 0..1 in a scope with `rows` rows. */
export function levelToRow(level: number, rows: number): number {
  const l = level < 0 ? 0 : level > 1 ? 1 : level;
  return Math.round((1 - l) * (rows - 1));
}

/** IRE value at the centre of a waveform row. */
export function rowToIre(row: number, rows: number): number {
  return (1 - row / (rows - 1)) * 100;
}

function colMap(width: number, cols: number): Uint16Array {
  const m = new Uint16Array(width);
  for (let x = 0; x < width; x++) m[x] = Math.min(cols - 1, Math.floor((x * cols) / width));
  return m;
}

/** Luma (Y′) waveform: one column per horizontal slice of the frame. */
export function waveformLuma(frame: RGBAFrame, cols = frame.width, rows = 256): WaveformAccum {
  const { width, height, data } = frame;
  cols = Math.max(1, Math.min(cols, width || 1));
  const counts = new Uint32Array(cols * rows);
  if (!width || !height) return { cols, rows, counts };
  const cm = colMap(width, cols);
  const scale = (rows - 1) / 255;
  for (let y = 0; y < height; y++) {
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      const v = KR * data[i] + KG * data[i + 1] + KB * data[i + 2];
      const row = rows - 1 - Math.round(v * scale);
      counts[row * cols + cm[x]]++;
    }
  }
  return { cols, rows, counts };
}

/** RGB parade: three waveforms (R′, G′, B′), each `cols` wide. */
export function waveformParade(frame: RGBAFrame, cols = frame.width, rows = 256): [WaveformAccum, WaveformAccum, WaveformAccum] {
  const { width, height, data } = frame;
  cols = Math.max(1, Math.min(cols, width || 1));
  const out: [WaveformAccum, WaveformAccum, WaveformAccum] = [
    { cols, rows, counts: new Uint32Array(cols * rows) },
    { cols, rows, counts: new Uint32Array(cols * rows) },
    { cols, rows, counts: new Uint32Array(cols * rows) },
  ];
  if (!width || !height) return out;
  const cm = colMap(width, cols);
  const scale = (rows - 1) / 255;
  const [r, g, b] = [out[0].counts, out[1].counts, out[2].counts];
  for (let y = 0; y < height; y++) {
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      const c = cm[x];
      r[(rows - 1 - Math.round(data[i] * scale)) * cols + c]++;
      g[(rows - 1 - Math.round(data[i + 1] * scale)) * cols + c]++;
      b[(rows - 1 - Math.round(data[i + 2] * scale)) * cols + c]++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vectorscope
// ---------------------------------------------------------------------------

/**
 * Chroma magnitude shown at the edge of the vectorscope at 1× zoom. The 100 %
 * targets peak at 0.5, so a little margin keeps them inside the circle.
 */
export const VECTOR_RANGE = 0.55;

export interface VectorAccum {
  size: number;
  zoom: number;
  /** size·size counts, x = Cb (right = +), y = Cr (up = +). */
  counts: Uint32Array;
}

/** Pixel position (0..size−1, y down) of a Cb/Cr pair. */
export function vectorPos(cb: number, cr: number, size: number, zoom = 1): { x: number; y: number } {
  const k = zoom / (2 * VECTOR_RANGE);
  return { x: (0.5 + cb * k) * (size - 1), y: (0.5 - cr * k) * (size - 1) };
}

export function vectorscope(frame: RGBAFrame, size = 256, zoom = 1): VectorAccum {
  const { width, height, data } = frame;
  const counts = new Uint32Array(size * size);
  const n = width * height;
  const k = (zoom / (2 * VECTOR_RANGE)) * (size - 1);
  const c = 0.5 * (size - 1);
  const inv = 1 / 255;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = data[i] * inv;
    const g = data[i + 1] * inv;
    const b = data[i + 2] * inv;
    const y = KR * r + KG * g + KB * b;
    const x = Math.round(c + ((b - y) / CB_DIV) * k);
    const v = Math.round(c - ((r - y) / CR_DIV) * k);
    if (x < 0 || v < 0 || x >= size || v >= size) continue;
    counts[v * size + x]++;
  }
  return { size, zoom, counts };
}

export type VectorTargetName = 'R' | 'Mg' | 'B' | 'Cy' | 'G' | 'Yl';

export interface VectorTarget {
  name: VectorTargetName;
  cb: number;
  cr: number;
  /** Display colour of the target label. */
  color: string;
}

const TARGET_RGB: Record<VectorTargetName, [number, number, number]> = {
  R: [1, 0, 0],
  Mg: [1, 0, 1],
  B: [0, 0, 1],
  Cy: [0, 1, 1],
  G: [0, 1, 0],
  Yl: [1, 1, 0],
};
const TARGET_COLOR: Record<VectorTargetName, string> = {
  R: '#ff6b6b',
  Mg: '#ff7ae0',
  B: '#7a9bff',
  Cy: '#6ee7f2',
  G: '#7cf29a',
  Yl: '#ffe066',
};

/** Colour-bar targets at a given amplitude (0.75 = 75 % bars, 1 = 100 %). */
export function vectorTargets(amplitude = 0.75): VectorTarget[] {
  return (Object.keys(TARGET_RGB) as VectorTargetName[]).map((name) => {
    const [r, g, b] = TARGET_RGB[name];
    const { cb, cr } = cbcr(r * amplitude, g * amplitude, b * amplitude);
    return { name, cb, cr, color: TARGET_COLOR[name] };
  });
}

/**
 * The skin-tone (flesh) line: the NTSC I axis at 123° from +Cb, the direction
 * in which almost all human skin falls regardless of ethnicity.
 */
export const SKIN_TONE_ANGLE_DEG = 123;

export function skinToneLine(length = 0.5): { cb: number; cr: number } {
  const a = (SKIN_TONE_ANGLE_DEG * Math.PI) / 180;
  return { cb: Math.cos(a) * length, cr: Math.sin(a) * length };
}

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

export interface Histogram {
  /** 256 bins each, code values 0..255. */
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  y: Uint32Array;
  total: number;
}

export function histogram(frame: RGBAFrame): Histogram {
  const { width, height, data } = frame;
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const y = new Uint32Array(256);
  const n = width * height;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const R = data[i];
    const G = data[i + 1];
    const B = data[i + 2];
    r[R]++;
    g[G]++;
    b[B]++;
    y[Math.round(KR * R + KG * G + KB * B)]++;
  }
  return { r, g, b, y, total: n };
}

/** Log-scaled histogram curve (0..1 per bin) for drawing. */
export function histogramCurve(bins: Uint32Array, ref?: number): Float32Array {
  let max = ref ?? 0;
  if (ref === undefined) for (let i = 0; i < bins.length; i++) if (bins[i] > max) max = bins[i];
  const out = new Float32Array(bins.length);
  if (max <= 0) return out;
  const norm = 1 / Math.log1p(max);
  for (let i = 0; i < bins.length; i++) out[i] = Math.min(1, Math.log1p(bins[i]) * norm);
  return out;
}

// ---------------------------------------------------------------------------
// Legality (false-colour statistics)
// ---------------------------------------------------------------------------

export interface LegalityStats {
  /** Percent of pixels whose luma is at or below 0 IRE (crushed). */
  lowPct: number;
  /** Percent of pixels whose luma is at or above 100 IRE (clipped). */
  highPct: number;
  /** Percent of pixels with any channel at code 0 / code 255. */
  channelLowPct: number;
  channelHighPct: number;
  /** Luma range and mean, in IRE. */
  minIre: number;
  maxIre: number;
  meanIre: number;
}

/**
 * Pixels whose luma rounds to code 0 sit at (or would be below) 0 IRE; luma
 * rounding to 255 sits at (or would be above) 100 IRE. The viewer's output is
 * 8-bit, so anything beyond the limits has already been clipped to them.
 */
/** IRE of an 8-bit level, rounded to 1e-6 so 255 reads exactly 100. */
function ire8(v: number): number {
  return Math.round((v / 255) * 100 * 1e6) / 1e6;
}

export function legality(frame: RGBAFrame): LegalityStats {
  const { width, height, data } = frame;
  const n = width * height;
  if (!n) return { lowPct: 0, highPct: 0, channelLowPct: 0, channelHighPct: 0, minIre: 0, maxIre: 0, meanIre: 0 };
  let low = 0;
  let high = 0;
  let chLow = 0;
  let chHigh = 0;
  let min = 255;
  let max = 0;
  let sum = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const R = data[i];
    const G = data[i + 1];
    const B = data[i + 2];
    const y = KR * R + KG * G + KB * B;
    if (y < 0.5) low++;
    else if (y >= 254.5) high++;
    if (R === 0 || G === 0 || B === 0) chLow++;
    if (R === 255 || G === 255 || B === 255) chHigh++;
    if (y < min) min = y;
    if (y > max) max = y;
    sum += y;
  }
  const pct = 100 / n;
  return {
    lowPct: low * pct,
    highPct: high * pct,
    channelLowPct: chLow * pct,
    channelHighPct: chHigh * pct,
    minIre: ire8(min),
    maxIre: ire8(max),
    meanIre: ire8(sum / n),
  };
}

// ---------------------------------------------------------------------------
// Tone: counts → log density → phosphor RGBA
// ---------------------------------------------------------------------------

/**
 * Log-scaled density in 0..1: log(1 + c·k) / log(1 + ref·k).
 * `ref` defaults to the largest count; `gain` (k) brightens faint traces.
 */
export function logDensity(counts: Uint32Array, gain = 1, ref?: number): Float32Array {
  let max = ref ?? 0;
  if (ref === undefined) for (let i = 0; i < counts.length; i++) if (counts[i] > max) max = counts[i];
  const out = new Float32Array(counts.length);
  if (max <= 0) return out;
  const norm = 1 / Math.log1p(max * gain);
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i];
    if (c) out[i] = Math.min(1, Math.log1p(c * gain) * norm);
  }
  return out;
}

export type Tint = [number, number, number];

/** Default trace colours: a pale phosphor green, and muted channel tints for the parade. */
export const PHOSPHOR: Tint = [0.55, 1, 0.7];
export const PARADE_TINTS: [Tint, Tint, Tint] = [
  [1, 0.42, 0.4],
  [0.45, 1, 0.55],
  [0.45, 0.62, 1],
];

/**
 * Paints a density field into RGBA8 with a phosphor look: faint traces glow
 * in the tint, dense areas bloom towards white. Black = no signal, so the
 * image composites additively ('lighter') over a graticule.
 */
export function paintPhosphor(density: Float32Array, width: number, height: number, tint: Tint = PHOSPHOR, out?: ScopeImage, xOffset = 0, outWidth = width): ScopeImage {
  const img = out ?? { width: outWidth, height, data: new Uint8ClampedArray(outWidth * height * 4) };
  const d = img.data;
  const [tr, tg, tb] = tint;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = density[y * width + x];
      const o = (y * img.width + x + xOffset) * 4;
      if (v <= 0) {
        d[o + 3] = 255;
        continue;
      }
      // brightness rises quickly so a single pixel is visible; white bloom only at the core
      const lum = Math.min(1, 0.18 + 0.82 * Math.pow(v, 0.75));
      const w = v * v * v * 0.85;
      d[o] = 255 * lum * (tr + (1 - tr) * w);
      d[o + 1] = 255 * lum * (tg + (1 - tg) * w);
      d[o + 2] = 255 * lum * (tb + (1 - tb) * w);
      d[o + 3] = 255;
    }
  }
  return img;
}

// ---------------------------------------------------------------------------
// One-call analysis (what the worker runs)
// ---------------------------------------------------------------------------

export interface ScopeRequest {
  waveform?: boolean;
  parade?: boolean;
  vectorscope?: boolean;
  histogram?: boolean;
  legality?: boolean;
  /** Waveform / parade rows (vertical resolution). Default 256. */
  rows?: number;
  /** Waveform columns (horizontal resolution). Default: the frame width, max 512. */
  cols?: number;
  /** Vectorscope resolution and zoom (1 or 2). */
  vectorSize?: number;
  vectorZoom?: number;
  /** Trace brightness (log gain). Default 1. */
  gain?: number;
}

export interface HistogramCurves {
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  y: Float32Array;
}

export interface ScopeResult {
  frameWidth: number;
  frameHeight: number;
  waveform?: ScopeImage;
  /** Three channels side by side: image width = 3·cols. */
  parade?: ScopeImage;
  vectorscope?: ScopeImage;
  histogram?: HistogramCurves;
  legality?: LegalityStats;
  /** Computation time in ms. */
  ms: number;
}

/**
 * Density reference for waveforms: the count a column would have if all its
 * pixels shared one level, divided down so typical images read clearly.
 */
function waveRef(frame: RGBAFrame, cols: number): number {
  return Math.max(1, (frame.height * frame.width) / cols / 6);
}

export function analyze(frame: RGBAFrame, req: ScopeRequest): ScopeResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const rows = req.rows ?? 256;
  const cols = Math.max(1, Math.min(req.cols ?? frame.width, 512, frame.width || 1));
  const gain = req.gain ?? 1;
  const res: ScopeResult = { frameWidth: frame.width, frameHeight: frame.height, ms: 0 };
  if (req.waveform) {
    const acc = waveformLuma(frame, cols, rows);
    res.waveform = paintPhosphor(logDensity(acc.counts, gain, waveRef(frame, acc.cols)), acc.cols, rows, PHOSPHOR);
  }
  if (req.parade) {
    const accs = waveformParade(frame, cols, rows);
    const c = accs[0].cols;
    const img: ScopeImage = { width: c * 3, height: rows, data: new Uint8ClampedArray(c * 3 * rows * 4) };
    const ref = waveRef(frame, c);
    accs.forEach((a, k) => paintPhosphor(logDensity(a.counts, gain, ref), c, rows, PARADE_TINTS[k], img, k * c, c * 3));
    res.parade = img;
  }
  if (req.vectorscope) {
    const size = req.vectorSize ?? 256;
    const acc = vectorscope(frame, size, req.vectorZoom ?? 1);
    // vectorscope bins concentrate heavily; reference on a fraction of the frame
    const ref = Math.max(1, (frame.width * frame.height) / 40);
    res.vectorscope = paintPhosphor(logDensity(acc.counts, gain * 2, ref), size, size, PHOSPHOR);
  }
  if (req.histogram) {
    const h = histogram(frame);
    let max = 0;
    for (const bins of [h.r, h.g, h.b, h.y]) for (let i = 0; i < 256; i++) if (bins[i] > max) max = bins[i];
    res.histogram = { r: histogramCurve(h.r, max), g: histogramCurve(h.g, max), b: histogramCurve(h.b, max), y: histogramCurve(h.y, max) };
  }
  if (req.legality) res.legality = legality(frame);
  res.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return res;
}
