// Blend modes: GLSL used by the compositor and a CPU reference with the same
// formulas (tests, pickers). OWNED BY THE RENDERER PACKAGE.
//
// Compositing is premultiplied scene-linear (W3C Compositing Level 1, source-over):
//   Co = Cs·(1 − αb) + Cb·(1 − αs) + αs·αb·B(cb, cs)      αo = αs + αb·(1 − αs)
// where cb/cs are the UNpremultiplied backdrop/source colors and B is the
// separable blend function below. Modes defined for 0..1 display values
// (screen, overlay, soft/hard light, dodge, burn, exclusion) are guarded for
// HDR: screen falls back to max() above 1 (as in Nuke), the contrast modes
// clamp their inputs to 0..1, and subtract never goes below 0.

import type { BlendMode } from '../../state/types';

export const BLEND_MODES: BlendMode[] = [
  'normal',
  'add',
  'subtract',
  'multiply',
  'screen',
  'overlay',
  'softLight',
  'hardLight',
  'darken',
  'lighten',
  'difference',
  'exclusion',
  'colorDodge',
  'colorBurn',
];

export function blendIndex(m: BlendMode | string | undefined): number {
  const i = BLEND_MODES.indexOf((m ?? 'normal') as BlendMode);
  return i < 0 ? 0 : i;
}

const c01 = (x: number) => Math.min(Math.max(x, 0), 1);

function softLightD(b: number) {
  return b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
}

/** Separable blend function B(cb, cs) on unpremultiplied linear values. */
export function blendFn(mode: BlendMode, cb: number, cs: number): number {
  switch (mode) {
    case 'normal':
      return cs;
    case 'add':
      return cb + cs;
    case 'subtract':
      return Math.max(cb - cs, 0);
    case 'multiply':
      return cb * cs;
    case 'screen':
      return cb <= 1 && cs <= 1 ? cb + cs - cb * cs : Math.max(cb, cs);
    case 'overlay':
      return blendFn('hardLight', c01(cs), c01(cb));
    case 'hardLight': {
      const b = c01(cb);
      const s = c01(cs);
      return s <= 0.5 ? b * 2 * s : blendFn('screen', b, 2 * s - 1);
    }
    case 'softLight': {
      const b = c01(cb);
      const s = c01(cs);
      return s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (softLightD(b) - b);
    }
    case 'darken':
      return Math.min(cb, cs);
    case 'lighten':
      return Math.max(cb, cs);
    case 'difference':
      return Math.abs(cb - cs);
    case 'exclusion': {
      const b = c01(cb);
      const s = c01(cs);
      return b + s - 2 * b * s;
    }
    case 'colorDodge': {
      const b = c01(cb);
      const s = c01(cs);
      if (b <= 0) return 0;
      if (s >= 1) return 1;
      return Math.min(1, b / (1 - s));
    }
    case 'colorBurn': {
      const b = c01(cb);
      const s = c01(cs);
      if (b >= 1) return 1;
      if (s <= 0) return 0;
      return 1 - Math.min(1, (1 - b) / s);
    }
  }
  return cs;
}

/** Premultiplied composite of source over backdrop with a blend mode (one channel + alpha). */
export function compositePremul(mode: BlendMode, Cb: number, ab: number, Cs: number, as: number): [number, number] {
  const cb = ab > 1e-6 ? Cb / ab : 0;
  const cs = as > 1e-6 ? Cs / as : 0;
  const Co = Cs * (1 - ab) + Cb * (1 - as) + as * ab * blendFn(mode, cb, cs);
  return [Co, as + ab * (1 - as)];
}

export const GLSL_BLEND = /* glsl */ `
float c01(float x) { return clamp(x, 0.0, 1.0); }
float screenF(float b, float s) { return (b <= 1.0 && s <= 1.0) ? b + s - b * s : max(b, s); }
float hardLightF(float b, float s) { b = c01(b); s = c01(s); return s <= 0.5 ? b * 2.0 * s : screenF(b, 2.0 * s - 1.0); }
float softLightF(float b, float s) {
  b = c01(b); s = c01(s);
  float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return s <= 0.5 ? b - (1.0 - 2.0 * s) * b * (1.0 - b) : b + (2.0 * s - 1.0) * (d - b);
}
float dodgeF(float b, float s) { b = c01(b); s = c01(s); if (b <= 0.0) return 0.0; if (s >= 1.0) return 1.0; return min(1.0, b / (1.0 - s)); }
float burnF(float b, float s) { b = c01(b); s = c01(s); if (b >= 1.0) return 1.0; if (s <= 0.0) return 0.0; return 1.0 - min(1.0, (1.0 - b) / s); }
float blendF(int m, float b, float s) {
  if (m == 1) return b + s;
  if (m == 2) return max(b - s, 0.0);
  if (m == 3) return b * s;
  if (m == 4) return screenF(b, s);
  if (m == 5) return hardLightF(s, b);
  if (m == 6) return softLightF(b, s);
  if (m == 7) return hardLightF(b, s);
  if (m == 8) return min(b, s);
  if (m == 9) return max(b, s);
  if (m == 10) return abs(b - s);
  if (m == 11) { float bb = c01(b), ss = c01(s); return bb + ss - 2.0 * bb * ss; }
  if (m == 12) return dodgeF(b, s);
  if (m == 13) return burnF(b, s);
  return s;
}
vec3 blendRgb(int m, vec3 b, vec3 s) { return vec3(blendF(m, b.r, s.r), blendF(m, b.g, s.g), blendF(m, b.b, s.b)); }
/** W3C source-over with a separable blend, premultiplied in and out. */
vec4 compositeW3C(int m, vec4 S, vec4 D) {
  vec3 cs = S.a > 1e-6 ? S.rgb / S.a : vec3(0.0);
  vec3 cb = D.a > 1e-6 ? D.rgb / D.a : vec3(0.0);
  vec3 Co = S.rgb * (1.0 - D.a) + D.rgb * (1.0 - S.a) + S.a * D.a * blendRgb(m, cb, cs);
  return vec4(Co, S.a + D.a * (1.0 - S.a));
}
`;
