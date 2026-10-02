// The color panel's view of the grade math. Everything delegates to the
// renderer's CPU twin of its grade pass (engine/color/grade.ts), so look
// previews and the parameter mappings of Auto balance / Match agree exactly
// with what the viewer shows. Pure; unit-tested.
import { applyLogStage, hueRotationMatrix, LOG_BLACK, LOG_WHITE, logStage, logStageIsIdentity, qualifierKey, WHEEL, whiteBalanceMatrix } from '../../../engine/color/grade';
import { monotoneCurve } from '../../../engine/color/curves';
import { applyLut, type ParsedLut } from '../../../engine/color/lut';
import { apply3, bt709InvOetf, bt709Oetf, gradeLogDecode, gradeLogEncode, outputEncodeRgb, srgbDecode, type OutputSpace, type Vec3 } from '../../../engine/color/transforms';
import { codeTable, type M3, type RGB } from '../../../engine/scopes/analysis';
import type { ColorGrade, ColorSpace } from '../../../state/types';

/** Width of the normalized log domain the wheels work in. */
export const LOG_SPAN = LOG_WHITE - LOG_BLACK;
/** Stops per log-code unit in the grading log space (ACEScct: 17.52). */
export const STOPS_PER_LOG = 17.52;

/** The grade's linear white-balance matrix, as used by the renderer. */
export function wbMatrix(temperature: number, tint: number): M3 {
  return whiteBalanceMatrix(temperature, tint) as unknown as M3;
}

/** Display decode (code → scene-linear) for a sequence colour space. */
export function displayDecode(space: ColorSpace): (v: number) => number {
  return space === 'srgb' || space === 'p3' ? srgbDecode : bt709InvOetf;
}

/** 8-bit code → linear light, for the program frame of a sequence. */
export function linearTable(space: ColorSpace): Float32Array {
  const dec = displayDecode(space);
  return codeTable((v) => Math.max(0, dec(v)));
}

/**
 * 8-bit code → the wheels' normalized log domain n = (log − LOG_BLACK) / span,
 * where Gain multiplies and Offset adds (see applyLogStage in engine/color/grade.ts).
 */
export function logDomainTable(space: ColorSpace): Float32Array {
  const dec = displayDecode(space);
  return codeTable((v) => (gradeLogEncode(Math.max(0, dec(v))) - LOG_BLACK) / LOG_SPAN);
}

/** Offset wheel units for a per-channel linear multiplier m (exact in the log segment). */
export function offsetForMultiplier(m: number): number {
  return Math.log2(Math.max(m, 1e-6)) / (STOPS_PER_LOG * LOG_SPAN * WHEEL.offset);
}

/** Gain wheel units for a multiplier g in the normalized log domain. */
export function gainForMultiplier(g: number): number {
  return Math.log2(Math.max(g, 1e-6)) / WHEEL.gainStops;
}

/** Offset wheel units for an additive shift in the normalized log domain. */
export function offsetForShift(o: number): number {
  return o / WHEEL.offset;
}

/**
 * Builds a per-pixel function (display RGB 0..1 in and out) for a static
 * grade: the renderer's gradePixel pipeline (exposure → white balance → log
 * stage → curves → qualifier → LUT) with everything that depends only on the
 * grade (matrices, log-stage constants, curve splines) built once, then the
 * output encode. Unit-tested to match gradePixel exactly.
 */
export function compileGrade(g: ColorGrade, space: OutputSpace = 'rec709', lut: ParsedLut | null = null): (rgb: RGB) => RGB {
  const dec = displayDecode(space as ColorSpace);
  if (!g.enabled) return (rgb) => outputEncodeRgb(space, rgb.map(dec) as Vec3) as RGB;
  const ex = Math.pow(2, g.exposure);
  const W = g.temperature || g.tint ? whiteBalanceMatrix(g.temperature, g.tint) : null;
  const ls = logStageIsIdentity(g) ? null : logStage(g);
  const cv = g.curves;
  const curves = cv.master.length || cv.r.length || cv.g.length || cv.b.length ? { M: monotoneCurve(cv.master), ch: [monotoneCurve(cv.r), monotoneCurve(cv.g), monotoneCurve(cv.b)] } : null;
  const q = g.qualifier.enabled ? g.qualifier : null;
  const qExp = q ? Math.pow(2, q.exposure) : 1;
  const H = q && q.hueShift ? hueRotationMatrix(q.hueShift) : null;
  const useLut = lut && g.lut.id && g.lut.intensity ? lut : null;
  return (rgb) => {
    let c = [dec(rgb[0]) * ex, dec(rgb[1]) * ex, dec(rgb[2]) * ex] as Vec3;
    if (W) c = apply3(W, c);
    if (ls) c = applyLogStage(ls, c.map(gradeLogEncode) as Vec3).map(gradeLogDecode) as Vec3;
    if (curves) {
      const { M, ch } = curves;
      c = c.map((v, i) => {
        const e = bt709Oetf(v);
        const y = e > 1 ? ch[i](M(1)) + (e - 1) : e < 0 ? ch[i](M(0)) + e : ch[i](M(e));
        return bt709InvOetf(y);
      }) as Vec3;
    }
    if (q) {
      const key = qualifierKey(q, c.map(bt709Oetf) as Vec3);
      let a = c.map((v) => v * qExp) as Vec3;
      const y = 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
      a = a.map((v) => y + (v - y) * q.saturation) as Vec3;
      if (H) a = apply3(H, a);
      c = c.map((v, i) => v + (a[i] - v) * key) as Vec3;
    }
    if (useLut) {
      const e = c.map(bt709Oetf) as Vec3;
      const l = applyLut(useLut, e);
      c = e.map((v, i) => bt709InvOetf(v + (l[i] - v) * g.lut.intensity)) as Vec3;
    }
    return outputEncodeRgb(space, c) as RGB;
  };
}

/**
 * The look-card test scene (display-referred): a sky gradient, a band of
 * everyday colours (skin, foliage, sand, water, brick) and a grey ramp.
 */
export function swatchScene(x: number, y: number): RGB {
  if (y < 0.5) {
    const t = y / 0.5;
    return [0.28 + 0.6 * t, 0.42 + 0.42 * t, 0.72 + 0.04 * t];
  }
  if (y < 0.82) {
    const band: RGB[] = [
      [0.86, 0.62, 0.5], // skin
      [0.3, 0.5, 0.22], // foliage
      [0.86, 0.76, 0.54], // sand
      [0.16, 0.42, 0.52], // water
      [0.62, 0.26, 0.2], // brick
    ];
    const f = Math.min(band.length - 1, Math.floor(x * band.length));
    const shade = 0.75 + 0.35 * (1 - (y - 0.5) / 0.32);
    return band[f].map((c) => Math.min(1, c * shade)) as RGB;
  }
  return [x, x, x];
}

/** Renders a grade preview of the swatch scene into RGBA8. */
export function renderSwatch(g: ColorGrade, width: number, height: number): Uint8ClampedArray {
  const f = compileGrade(g);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const o = f(swatchScene(i / Math.max(1, width - 1), j / Math.max(1, height - 1)));
      const p = (j * width + i) * 4;
      data[p] = o[0] * 255;
      data[p + 1] = o[1] * 255;
      data[p + 2] = o[2] * 255;
      data[p + 3] = 255;
    }
  }
  return data;
}
