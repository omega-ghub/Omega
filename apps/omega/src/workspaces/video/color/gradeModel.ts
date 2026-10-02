// CPU model of the primary grade, used for look-card previews and to turn
// measured corrections (auto balance, shot match) into grade parameters.
// It mirrors the documented semantics of ColorGrade (state/types.ts); the
// GPU renderer is the reference for what you see in the viewer, this is a
// close, fast twin for small previews. Pure; unit-tested.
//
// Pipeline (per pixel, display-referred input 0..1):
//   1. linearize (sRGB EOTF)
//   2. exposure: × 2^exposure                         (scene-linear)
//   3. white balance: × whiteBalanceGains(temp, tint) (scene-linear)
//   4. encode to the log grading space: (log2(x) + LOG_OFFSET) / LOG_RANGE,
//      with a linear toe; 18 % grey lands on the default pivot 0.435
//   5. offset (+), lift (raises blacks, white fixed), gain (×), gamma (power)
//      per channel with the master `y` added to each channel
//   6. contrast around pivot, shadows / highlights (smooth tonal ranges)
//   7. saturation around luma, vibrance (boosts low-saturation pixels most)
//   8. decode the grading space back to linear, then display-encode
//   9. curves (master, then R/G/B) on the display signal
import type { ColorGrade, RGBY } from '../../../state/types';
import { eotf, oetf, whiteBalanceGains, type RGB, type WhiteBalanceModel } from '../../../engine/scopes/analysis';
import { compileCurve } from './curves';

/** Temperature/tint strength: ±100 = ±0.5 stop on the R/B (temperature) or G (tint) channel. */
export const WB_MODEL: WhiteBalanceModel = { tempStops: 0.5, tintStops: 0.5 };

/** Offset wheel units → grading-space units (±1 on the wheel = ±0.25, about ±4.4 stops). */
export const OFFSET_SCALE = 0.25;

export const LOG_RANGE = 17.52;
/** Chosen so that 18 % grey encodes to 0.435 (the default pivot). */
export const LOG_OFFSET = 0.435 * LOG_RANGE - Math.log2(0.18);
const TOE = Math.pow(2, -12);

export function linToLog(x: number): number {
  if (x <= TOE) return (Math.log2(TOE) + LOG_OFFSET) / LOG_RANGE + ((x - TOE) / (TOE * Math.LN2)) / LOG_RANGE;
  return (Math.log2(x) + LOG_OFFSET) / LOG_RANGE;
}

export function logToLin(v: number): number {
  const toeLog = (Math.log2(TOE) + LOG_OFFSET) / LOG_RANGE;
  if (v <= toeLog) return TOE + (v - toeLog) * LOG_RANGE * TOE * Math.LN2;
  return Math.pow(2, v * LOG_RANGE - LOG_OFFSET);
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const ch = (c: RGBY, k: 0 | 1 | 2) => (k === 0 ? c.r : k === 1 ? c.g : c.b) + c.y;

/** Builds a fast per-pixel function for a (static) grade. */
export function compileGrade(g: ColorGrade): (rgb: RGB) => RGB {
  if (!g.enabled) return (rgb) => rgb;
  const exp = Math.pow(2, g.exposure);
  const wb = whiteBalanceGains(g.temperature, g.tint, WB_MODEL);
  const curveM = g.curves.master.length ? compileCurve(g.curves.master) : null;
  const curveC = [g.curves.r, g.curves.g, g.curves.b].map((c) => (c.length ? compileCurve(c) : null));
  const lift = [0, 1, 2].map((k) => ch(g.lift, k as 0)) as RGB;
  const gain = [0, 1, 2].map((k) => 1 + ch(g.gain, k as 0)) as RGB;
  const gam = [0, 1, 2].map((k) => Math.pow(2, -ch(g.gamma, k as 0))) as RGB;
  const off = [0, 1, 2].map((k) => ch(g.offset, k as 0) * OFFSET_SCALE) as RGB;
  return (rgb) => {
    const v = [0, 0, 0] as RGB;
    for (let k = 0; k < 3; k++) {
      let x = eotf(rgb[k]) * exp * wb[k];
      x = linToLog(Math.max(0, x));
      x += off[k];
      x = x + lift[k] * 0.5 * (1 - x);
      x *= gain[k];
      x = x > 0 ? Math.pow(x, gam[k]) : x;
      x = (x - g.pivot) * g.contrast + g.pivot;
      v[k] = x;
    }
    // tonal ranges on the luma of the log signal
    const yl = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    const tone = g.shadows * 0.12 * (1 - smooth(0.1, 0.5, yl)) + g.highlights * 0.12 * smooth(0.45, 0.85, yl);
    for (let k = 0; k < 3; k++) v[k] += tone;
    // saturation + vibrance in the log domain (perceptually even)
    const y = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    const sat = Math.max(Math.abs(v[0] - y), Math.abs(v[1] - y), Math.abs(v[2] - y));
    const s = g.saturation * (1 + g.vibrance * (1 - Math.min(1, sat * 4)));
    for (let k = 0; k < 3; k++) v[k] = y + (v[k] - y) * s;
    const out = [0, 0, 0] as RGB;
    for (let k = 0; k < 3; k++) {
      let d = oetf(Math.min(1, Math.max(0, logToLin(v[k]))));
      if (curveM) d = curveM(d);
      const c = curveC[k];
      if (c) d = c(d);
      out[k] = d;
    }
    return out;
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
