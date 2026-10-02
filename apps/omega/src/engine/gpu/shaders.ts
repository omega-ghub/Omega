// Internal GLSL passes of the compositor. OWNED BY THE RENDERER PACKAGE.
// Everything between passes is premultiplied, scene-linear Rec.709 light in
// GL texture convention (v = 0 at the bottom row).

import { GLSL_COLOR, glf, glslDecodeFn } from '../color/transforms';
import { TONE_RANGE } from '../color/grade';
import { GLSL_BLEND, glslBlendFns } from './blend';

const memo = new Map<string, string>();
/** Memoizes generated shader sources by variant key. */
export function variant(key: string, make: () => string): string {
  let v = memo.get(key);
  if (v === undefined) memo.set(key, (v = make()));
  return v;
}

const HEAD = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
`;

/**
 * Input pass: raw upload (display-encoded, top row first, premultiplied by the
 * browser) → linear premultiplied working texture at the layer's working size.
 * Downscales with a TAPS×TAPS grid of bilinear taps (a box filter in LINEAR
 * light), plus mip LOD for extreme reductions. Specialized per transfer
 * function, gamut and tap count (compile-time; no per-pixel branching).
 */
export function inputFragment(o: { code: number; gamut: boolean; taps: number }): string {
  const taps = Math.max(1, Math.min(8, Math.round(o.taps)));
  return /* glsl */ `${HEAD}
#define TAPS ${taps}
${o.gamut ? '#define USE_GAMUT' : ''}
${GLSL_COLOR}
${glslDecodeFn(o.code)}
uniform sampler2D u_raw;
uniform vec2 u_foot;     // output texel footprint in raw uv
uniform float u_lod;
uniform mat3 u_gamut;
in vec2 v_uv;
out vec4 outColor;
vec4 tap(vec2 uv) {
  vec4 t = textureLod(u_raw, uv, u_lod);
  float a = clamp(t.a, 0.0, 1.0);
  vec3 lin = decodeIn(a > 0.0 ? t.rgb / a : vec3(0.0));
#ifdef USE_GAMUT
  lin = u_gamut * lin;
#endif
  return vec4(lin * a, a);
}
void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
#if TAPS == 1
  outColor = tap(uv);
#else
  vec4 acc = vec4(0.0);
  for (int j = 0; j < TAPS; j++)
    for (int i = 0; i < TAPS; i++)
      acc += tap(uv + ((vec2(float(i), float(j)) + 0.5) / float(TAPS) - 0.5) * u_foot);
  outColor = acc / float(TAPS * TAPS);
#endif
}
`;
}

/**
 * Grade pass (feature flags as #defines → one cached program per variant).
 * Order: exposure → white balance → [log: contrast, highlights/shadows,
 * lift/gamma/gain/offset, saturation, vibrance] → curves → qualifier → LUT.
 */
export function gradeFragment(flags: { log: boolean; wb: boolean; curves: boolean; qual: boolean; lut: '' | '1d' | '3d'; shaper: boolean; matte: boolean }): string {
  const defs = [
    flags.log && '#define G_LOG',
    flags.wb && '#define G_WB',
    flags.curves && '#define G_CURVES',
    flags.qual && '#define G_QUAL',
    flags.lut === '3d' && '#define G_LUT3D',
    flags.lut === '1d' && '#define G_LUT1D',
    flags.shaper && '#define G_SHAPER',
    flags.matte && '#define G_MATTE',
  ]
    .filter(Boolean)
    .join('\n');
  return /* glsl */ `${HEAD}
${defs}
${GLSL_COLOR}
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
uniform sampler2D u_src;
uniform float u_exposure;
uniform mat3 u_wb;
uniform float u_contrast, u_pivot, u_sat, u_vib, u_hi, u_sh, u_logBlack, u_logWhite;
uniform vec3 u_lift, u_gexp, u_gain, u_offset;
uniform sampler2D u_curves;
uniform vec4 u_q0;   // hueCenter°, hueWidth°, softness, invert
uniform vec4 u_q1;   // satLow, satHigh, lumLow, lumHigh
uniform vec2 u_q2;   // exposure gain, saturation
uniform mat3 u_qHue;
uniform sampler3D u_lut3;
uniform sampler2D u_lut1;
uniform sampler2D u_shaper;
uniform vec3 u_lutMin, u_lutMax, u_shMin, u_shMax;
uniform int u_lutSize, u_shSize, u_lutW, u_shW;
uniform float u_lutMix;
in vec2 v_uv;
out vec4 outColor;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }

vec3 logStage(vec3 x) {
  x = (x - u_pivot) * u_contrast + u_pivot;
  float y = dot(LUMA, x);
  float wh = sstep(u_pivot - 0.02, u_pivot + 0.12, y);
  float ws = sstep(u_logBlack - 0.02, u_logBlack + 0.06, y) * (1.0 - sstep(u_pivot - 0.18, u_pivot + 0.03, y));
  x += (u_hi * wh + u_sh * ws) * ${glf(TONE_RANGE)};
  float span = u_logWhite - u_logBlack;
  vec3 n = (x - u_logBlack) / span;
  n = n + u_lift * (1.0 - n);
  n = sign(n) * pow(abs(n), u_gexp);
  n = n * u_gain + u_offset;
  x = u_logBlack + n * span;
  y = dot(LUMA, x);
  x = y + (x - y) * u_sat;
  float chroma = max(x.r, max(x.g, x.b)) - min(x.r, min(x.g, x.b));
  float f = 1.0 + u_vib * (1.0 - sstep(0.0, 0.2, chroma));
  return y + (x - y) * f;
}

float curveAt(float x, int ch) {
  vec4 lo = texture(u_curves, vec2(0.5 / 1024.0, 0.5));
  vec4 hi = texture(u_curves, vec2(1023.5 / 1024.0, 0.5));
  if (x > 1.0) return hi[ch] + (x - 1.0);
  if (x < 0.0) return lo[ch] + x;
  return texture(u_curves, vec2((x * 1023.0 + 0.5) / 1024.0, 0.5))[ch];
}

float qualKey(vec3 enc) {
  vec3 e = clamp(enc, 0.0, 1.0);
  vec3 hsv = rgb2hsv(e);
  float soft = max(u_q0.z, 0.0);
  float kh = 1.0;
  if (u_q0.y < 360.0) {
    float hue = hsv.x * 360.0;
    float dh = abs(mod(hue - u_q0.x + 540.0, 360.0) - 180.0);
    float half_ = max(u_q0.y, 0.0) * 0.5;
    kh = 1.0 - sstep(half_, half_ + max(soft * 60.0, 0.5), dh);
  }
  float sS = max(soft * 0.2, 0.002);
  float sat = hsv.y;
  float lum = dot(LUMA, e);
  float ks = sstep(u_q1.x - sS, u_q1.x, sat) * (1.0 - sstep(u_q1.y, u_q1.y + sS, sat));
  float kl = sstep(u_q1.z - sS, u_q1.z, lum) * (1.0 - sstep(u_q1.w, u_q1.w + sS, lum));
  float k = kh * ks * kl;
  return u_q0.w > 0.5 ? 1.0 - k : k;
}

vec3 fetch1(sampler2D t, int w, int i) { return texelFetch(t, ivec2(i % w, i / w), 0).rgb; }
vec3 lut1D(sampler2D t, int size, int w, vec3 dmin, vec3 dmax, vec3 c) {
  vec3 x = clamp((c - dmin) / (dmax - dmin), 0.0, 1.0) * float(size - 1);
  vec3 o;
  for (int ch = 0; ch < 3; ch++) {
    int i = min(int(floor(x[ch])), size - 2);
    float f = x[ch] - float(i);
    o[ch] = mix(fetch1(t, w, i)[ch], fetch1(t, w, i + 1)[ch], f);
  }
  return o;
}
vec3 lut3D(vec3 c) {
  int N = u_lutSize;
  vec3 p = clamp((c - u_lutMin) / (u_lutMax - u_lutMin), 0.0, 1.0) * float(N - 1);
  ivec3 b = min(ivec3(floor(p)), ivec3(N - 2));
  vec3 f = p - vec3(b);
  vec3 c000 = texelFetch(u_lut3, b, 0).rgb;
  vec3 c111 = texelFetch(u_lut3, b + ivec3(1, 1, 1), 0).rgb;
  vec3 o;
  if (f.r > f.g) {
    if (f.g > f.b) o = (1.0 - f.r) * c000 + (f.r - f.g) * texelFetch(u_lut3, b + ivec3(1, 0, 0), 0).rgb + (f.g - f.b) * texelFetch(u_lut3, b + ivec3(1, 1, 0), 0).rgb + f.b * c111;
    else if (f.r > f.b) o = (1.0 - f.r) * c000 + (f.r - f.b) * texelFetch(u_lut3, b + ivec3(1, 0, 0), 0).rgb + (f.b - f.g) * texelFetch(u_lut3, b + ivec3(1, 0, 1), 0).rgb + f.g * c111;
    else o = (1.0 - f.b) * c000 + (f.b - f.r) * texelFetch(u_lut3, b + ivec3(0, 0, 1), 0).rgb + (f.r - f.g) * texelFetch(u_lut3, b + ivec3(1, 0, 1), 0).rgb + f.g * c111;
  } else {
    if (f.b > f.g) o = (1.0 - f.b) * c000 + (f.b - f.g) * texelFetch(u_lut3, b + ivec3(0, 0, 1), 0).rgb + (f.g - f.r) * texelFetch(u_lut3, b + ivec3(0, 1, 1), 0).rgb + f.r * c111;
    else if (f.b > f.r) o = (1.0 - f.g) * c000 + (f.g - f.b) * texelFetch(u_lut3, b + ivec3(0, 1, 0), 0).rgb + (f.b - f.r) * texelFetch(u_lut3, b + ivec3(0, 1, 1), 0).rgb + f.r * c111;
    else o = (1.0 - f.g) * c000 + (f.g - f.r) * texelFetch(u_lut3, b + ivec3(0, 1, 0), 0).rgb + (f.r - f.b) * texelFetch(u_lut3, b + ivec3(1, 1, 0), 0).rgb + f.b * c111;
  }
  return o;
}

void main() {
  vec4 s = texture(u_src, v_uv);
  float a = s.a;
  if (a <= 1e-6) { outColor = vec4(0.0); return; }
  vec3 c = s.rgb / a;
  c *= u_exposure;
#ifdef G_WB
  c = u_wb * c;
#endif
#ifdef G_LOG
  c = gradeLogDec3(logStage(gradeLogEnc3(c)));
#endif
#ifdef G_CURVES
  {
    vec3 e = bt709Oetf3(c);
    c = bt709InvOetf3(vec3(curveAt(e.r, 0), curveAt(e.g, 1), curveAt(e.b, 2)));
  }
#endif
  float key = 1.0;
#ifdef G_QUAL
  key = qualKey(bt709Oetf3(c));
  {
    vec3 q = c * u_q2.x;
    float y = dot(LUMA, q);
    q = y + (q - y) * u_q2.y;
    q = u_qHue * q;
    c = mix(c, q, key);
  }
#endif
#ifdef G_MATTE
  outColor = vec4(vec3(key) * a, a);
  return;
#else
#if defined(G_LUT3D) || defined(G_LUT1D)
  {
    vec3 e = bt709Oetf3(c);
    vec3 l = e;
#ifdef G_SHAPER
    l = lut1D(u_shaper, u_shSize, u_shW, u_shMin, u_shMax, l);
#endif
#ifdef G_LUT3D
    l = lut3D(l);
#else
    l = lut1D(u_lut1, u_lutSize, u_lutW, u_lutMin, u_lutMax, l);
#endif
    c = bt709InvOetf3(mix(e, l, u_lutMix));
  }
#endif
  outColor = vec4(c * a, a);
#endif
}
`;
}

/**
 * Placement pass: draws a layer quad into the frame with crop (feathered),
 * masks (rect/ellipse, rotation, roundness, feather, expansion, opacity,
 * invert, add/subtract/intersect), opacity, bicubic upscaling, edge
 * anti-aliasing and blend modes. Normal/add use hardware blending ('hw');
 * other modes composite against a copy of the destination ('shader');
 * adjustment layers lerp the processed backdrop ('adjust').
 * Specialized per mask count, sampler, blend path and mode.
 */
export const MAX_MASKS = 8;
export function placeFragment(o: { masks: number; bicubic: boolean; blend: 'hw' | 'shader' | 'adjust'; mode: number; decode?: { code: number; gamut: boolean } | null }): string {
  const masks = Math.max(0, Math.min(MAX_MASKS, o.masks));
  const d = o.decode;
  return /* glsl */ `${HEAD}
#define MASKS ${masks}
${o.bicubic ? '#define BICUBIC' : ''}
#define BLEND_${o.blend.toUpperCase()}
${d ? '#define RAW' : ''}
${d?.gamut ? '#define USE_GAMUT' : ''}
${GLSL_BLEND}
${glslBlendFns(o.mode)}
${d ? `${GLSL_COLOR}\n${glslDecodeFn(d.code)}` : ''}
uniform sampler2D u_layer;
uniform mat3 u_gamut;
uniform sampler2D u_dst;
uniform vec2 u_dstSize;
uniform float u_opacity;
uniform vec2 u_layerPx;     // layer size in layer px
uniform vec2 u_texSize;     // layer texture size in texels
uniform vec4 u_crop;        // left, top, right, bottom (fractions)
uniform float u_cropFeather;
#if MASKS > 0
uniform vec4 u_mA[MASKS];  // cx, cy, halfW, halfH (layer px)
uniform vec4 u_mB[MASKS];  // cos, sin, corner radius, feather
uniform vec4 u_mC[MASKS];  // opacity, invert, mode (0 add, 1 sub, 2 intersect), shape (0 rect, 1 ellipse)
#endif
in vec2 v_uv;
out vec4 outColor;

#ifdef RAW
// Direct path: u_layer is the raw upload (display-encoded, premultiplied by the browser, top row first).
#define FETCH(p) texture(u_layer, vec2((p).x, 1.0 - (p).y))
vec4 decodeTex(vec4 t) {
  float a = clamp(t.a, 0.0, 1.0);
  vec3 lin = decodeIn(a > 0.0 ? t.rgb / a : vec3(0.0));
#ifdef USE_GAMUT
  lin = u_gamut * lin;
#endif
  return vec4(lin * a, a);
}
#else
#define FETCH(p) texture(u_layer, p)
vec4 decodeTex(vec4 t) { return t; }
#endif

#ifdef BICUBIC
vec4 sampleLayer(vec2 uv) {
  vec2 size = u_texSize;
  vec2 sp = uv * size;
  vec2 t1 = floor(sp - 0.5) + 0.5;
  vec2 f = sp - t1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 o12 = w2 / w12;
  vec2 p0 = (t1 - 1.0) / size;
  vec2 p3 = (t1 + 2.0) / size;
  vec2 p12 = (t1 + o12) / size;
  vec4 r = vec4(0.0);
  r += FETCH(vec2(p0.x, p0.y)) * w0.x * w0.y;
  r += FETCH(vec2(p12.x, p0.y)) * w12.x * w0.y;
  r += FETCH(vec2(p3.x, p0.y)) * w3.x * w0.y;
  r += FETCH(vec2(p0.x, p12.y)) * w0.x * w12.y;
  r += FETCH(vec2(p12.x, p12.y)) * w12.x * w12.y;
  r += FETCH(vec2(p3.x, p12.y)) * w3.x * w12.y;
  r += FETCH(vec2(p0.x, p3.y)) * w0.x * w3.y;
  r += FETCH(vec2(p12.x, p3.y)) * w12.x * w3.y;
  r += FETCH(vec2(p3.x, p3.y)) * w3.x * w3.y;
  r.a = clamp(r.a, 0.0, 1.0);
  return decodeTex(r);
}
#else
vec4 sampleLayer(vec2 uv) { return decodeTex(FETCH(uv)); }
#endif

// inside distance d (layer px): hard edges anti-aliased over fw, soft edges feathered inward
float edge(float d, float fw) {
  if (u_cropFeather > fw) return smoothstep(0.0, u_cropFeather, d);
  return clamp(d / fw + 0.5, 0.0, 1.0);
}
#if MASKS > 0
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float sdEllipse(vec2 p, vec2 r) {
  r = max(r, vec2(1e-3));
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  if (k1 < 1e-8) return -min(r.x, r.y);
  return k0 * (k0 - 1.0) / k1;
}
#endif

void main() {
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_layerPx;  // layer px, top-left origin
  float fwx = max(fwidth(px.x), 1e-4);
  float fwy = max(fwidth(px.y), 1e-4);
  float cov = edge(px.x - u_crop.x * u_layerPx.x, fwx)
            * edge((1.0 - u_crop.z) * u_layerPx.x - px.x, fwx)
            * edge(px.y - u_crop.y * u_layerPx.y, fwy)
            * edge((1.0 - u_crop.w) * u_layerPx.y - px.y, fwy);
#if MASKS > 0
  {
    float fw = max(fwx, fwy);
    float m = u_mC[0].z < 0.5 ? 0.0 : 1.0;
    for (int i = 0; i < MASKS; i++) {
      vec2 d = px - u_mA[i].xy;
      vec2 q = vec2(u_mB[i].x * d.x + u_mB[i].y * d.y, -u_mB[i].y * d.x + u_mB[i].x * d.y);
      float sd = u_mC[i].w < 0.5 ? sdRoundBox(q, u_mA[i].zw, u_mB[i].z) : sdEllipse(q, u_mA[i].zw);
      float f = u_mB[i].w;
      float c = f > fw ? 1.0 - smoothstep(-0.5 * f, 0.5 * f, sd) : clamp(0.5 - sd / fw, 0.0, 1.0);
      if (u_mA[i].z <= 0.0 || u_mA[i].w <= 0.0) c = 0.0;
      if (u_mC[i].y > 0.5) c = 1.0 - c;
      c *= u_mC[i].x;
      float mode = u_mC[i].z;
      m = mode < 0.5 ? m + c - m * c : (mode < 1.5 ? m * (1.0 - c) : m * c);
    }
    cov *= m;
  }
#endif
  float k = cov * u_opacity;
  vec4 s = sampleLayer(v_uv);
#if defined(BLEND_HW)
  outColor = s * k;
#else
  vec4 d = texture(u_dst, gl_FragCoord.xy / u_dstSize);
#if defined(BLEND_ADJUST)
  // s is the processed copy of what is below; keep the backdrop alpha.
  vec3 cb = d.a > 1e-6 ? d.rgb / d.a : vec3(0.0);
  vec3 cs = s.a > 1e-6 ? s.rgb / s.a : vec3(0.0);
  outColor = mix(d, vec4(blendMode(cb, cs) * d.a, d.a), k);
#else
  outColor = compositeW3C(s * k, d);
#endif
#endif
}
`;
}

/**
 * Output transform: scene-linear Rec.709 → display code values for the
 * sequence color space, split-compare, matte passthrough and dithering to 8 bit.
 * space: 0 rec709 (BT.709 OETF), 1 sRGB, 2 Display P3 (P3-D65 + sRGB
 * transfer), 3 HDR (HLG/PQ) tone-mapped to SDR Rec.709. Specialized per space.
 */
export function outputFragment(o: { space: number; split: boolean; passthrough: boolean; dither: boolean }): string {
  const enc = o.space === 1 || o.space === 2 ? 'srgbEncode3' : 'bt709Oetf3';
  return /* glsl */ `${HEAD}
${GLSL_COLOR}
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_split;
uniform mat3 u_toP3;
uniform float u_dither;
in vec2 v_uv;
out vec4 outColor;
// Interleaved gradient noise (Jimenez 2014): low-discrepancy, blue-ish spectrum.
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  ${o.split ? 'vec4 c = v_uv.x < u_split ? texture(u_b, v_uv) : texture(u_a, v_uv);' : 'vec4 c = texture(u_a, v_uv);'}
  float a = clamp(c.a, 0.0, 1.0);
  vec3 rgb = c.a > 1e-6 ? c.rgb / c.a : vec3(0.0);
  ${
    o.passthrough
      ? 'vec3 e = clamp(rgb, 0.0, 1.0);'
      : `${o.space === 3 ? 'rgb = tonemapRgb(gamutClip(rgb));' : ''}
  ${o.space === 2 ? 'rgb = u_toP3 * rgb;' : ''}
  rgb = gamutClip(rgb);
  vec3 e = clamp(${enc}(rgb), 0.0, 1.0);`
  }
  ${o.dither ? 'e = clamp(e + (ign(gl_FragCoord.xy) - 0.5) * u_dither / 255.0, 0.0, 1.0);' : ''}
  outColor = vec4(e * a, a);
}
`;
}

/** Box downscale (readback for scopes). */
export const FS_DOWNSAMPLE = /* glsl */ `${HEAD}
uniform sampler2D u_src;
uniform vec2 u_foot;
uniform int u_taps;
in vec2 v_uv;
out vec4 outColor;
void main() {
  if (u_taps <= 1) { outColor = texture(u_src, v_uv); return; }
  vec4 acc = vec4(0.0);
  float n = float(u_taps);
  for (int j = 0; j < 8; j++) {
    if (j >= u_taps) break;
    for (int i = 0; i < 8; i++) {
      if (i >= u_taps) break;
      acc += texture(u_src, v_uv + ((vec2(float(i), float(j)) + 0.5) / n - 0.5) * u_foot);
    }
  }
  outColor = acc / (n * n);
}
`;

/** Fallback transition when a TransitionDef is missing (cross-dissolve in linear light). */
export const CROSS_DISSOLVE_GLSL = /* glsl */ `vec4 transition(vec2 uv) { return mix(texture(u_from, uv), texture(u_to, uv), clamp(u_progress, 0.0, 1.0)); }`;
