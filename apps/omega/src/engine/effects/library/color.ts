// Color effects. Display-style adjustments (levels, contrast, posterize...)
// operate on a perceptual encoding (sRGB-shaped, linearly extended above 1.0
// so HDR highlights survive); physically-based mixes (channel mixer, tint
// blends) operate in scene-linear light. Every effect un-premultiplies first
// and re-premultiplies at the end, so edges of keyed or titled layers stay clean.
import type { EffectDef } from '../types';
import { glsl, pass } from './glsl';
import { ang, bool, choice, color, num, pct, spct } from './params';

/** Wraps a per-pixel color function `vec3 fx(vec3 c)` working on straight (unpremultiplied) color. */
function pixel(uses: string[], body: string): ReturnType<typeof pass> {
  return pass(
    glsl(
      ['util', ...uses],
      `${body}
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  if (s.a <= 1e-5) return s;
  return premul(fx(unpremul(s), uv), s.a);
}`,
    ),
  );
}

const hueHelpers = /* glsl */ `
float hueDist(float h, float k) { return abs(fract(h - k + 0.5) - 0.5) * 360.0; }
`;

const brightnessContrast: EffectDef = {
  type: 'brightnessContrast',
  name: 'Brightness & Contrast',
  category: 'Color',
  description: 'Brightens or darkens midtones and adds or removes contrast with a smooth S-curve that never clips black or white.',
  params: [
    spct('brightness', 'Brightness', 0, { unit: '', step: 1, hint: 'Midtone brightness; black and white stay put.' }),
    spct('contrast', 'Contrast', 0, { unit: '', step: 1, hint: 'S-curve around middle grey.' }),
    pct('pivot', 'Pivot', 46, { min: 5, max: 95, hint: 'Brightness that contrast pivots around (46% ≈ 18% grey).' }),
  ],
  passes: [
    pixel(
      ['perc'],
      `
float bcCurve(float y, float be, float ce, float pv) {
  float x = clamp(y, 0.0, 1.0);
  float over = max(y - 1.0, 0.0);
  float under = min(y, 0.0);
  x = pow(x, be);
  x = x < pv ? pv * pow(x / pv, ce) : 1.0 - (1.0 - pv) * pow((1.0 - x) / (1.0 - pv), ce);
  return x + over + under;
}
vec3 fx(vec3 c, vec2 uv) {
  float b = clamp(u_brightness * 0.01, -1.0, 1.0);
  float k = clamp(u_contrast * 0.01, -1.0, 1.0);
  float be = exp2(-b * 1.25);
  float ce = k >= 0.0 ? 1.0 + 2.0 * k : 1.0 + k;
  float pv = clamp(u_pivot * 0.01, 0.05, 0.95);
  vec3 p = toPerc(c);
  return fromPerc(vec3(bcCurve(p.r, be, ce, pv), bcCurve(p.g, be, ce, pv), bcCurve(p.b, be, ce, pv)));
}`,
    ),
  ],
  keywords: ['exposure', 'lighten', 'darken', 'punch', 'flat', 'curve'],
};

const hueSaturation: EffectDef = {
  type: 'hueSaturation',
  name: 'Hue/Saturation',
  category: 'Color',
  description: 'Rotates hues, changes saturation and lightness, or colorizes the image with a single hue.',
  params: [
    ang('hue', 'Hue', 0, { min: -180, max: 180 }),
    spct('saturation', 'Saturation', 0, { unit: '', step: 1 }),
    spct('lightness', 'Lightness', 0, { unit: '', step: 1 }),
    bool('colorize', 'Colorize', false, { hint: 'Replace all hues with one hue.' }),
    ang('colorizeHue', 'Colorize hue', 30, { min: 0, max: 360 }),
    pct('colorizeSat', 'Colorize saturation', 35),
  ],
  passes: [
    pixel(
      ['perc', 'ycc'],
      `
vec3 hsl2rgb(float h, float s, float l) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  float C = (1.0 - abs(2.0 * l - 1.0)) * s;
  return l + C * (rgb - 0.5);
}
vec3 fx(vec3 c, vec2 uv) {
  vec3 p = toPerc(c);
  vec3 y = rgb2ycc(p);
  if (u_colorize > 0.5) {
    float l = clamp(y.x, 0.0, 1.0);
    p = hsl2rgb(fract(u_colorizeHue / 360.0), u_colorizeSat * 0.01, l) + max(y.x - 1.0, 0.0);
    y = rgb2ycc(p);
  }
  float a = radians(u_hue);
  y.yz = mat2(cos(a), sin(a), -sin(a), cos(a)) * y.yz;
  y.yz *= max(1.0 + u_saturation * 0.01, 0.0);
  p = ycc2rgb(y);
  float L = clamp(u_lightness * 0.01, -1.0, 1.0);
  p = L >= 0.0 ? mix(p, vec3(1.0), L) : p * (1.0 + L);
  return fromPerc(p);
}`,
    ),
  ],
  keywords: ['hue', 'saturation', 'vibrance', 'colorize', 'desaturate', 'hsl', 'color balance'],
};

const levels: EffectDef = {
  type: 'levels',
  name: 'Levels',
  category: 'Color',
  description: 'Sets the input black and white points, midtone gamma and output range, for the image or one channel.',
  params: [
    choice('channel', 'Channel', 0, ['RGB', 'Red', 'Green', 'Blue']),
    num('inBlack', 'Input black', 0, { min: 0, max: 255, step: 1 }),
    num('inWhite', 'Input white', 255, { min: 0, max: 255, step: 1 }),
    num('gamma', 'Gamma', 1, { min: 0.1, max: 10, softMin: 0.2, softMax: 4, step: 0.01, hint: 'Above 1 brightens midtones, below 1 darkens them.' }),
    num('outBlack', 'Output black', 0, { min: 0, max: 255, step: 1 }),
    num('outWhite', 'Output white', 255, { min: 0, max: 255, step: 1 }),
    bool('clip', 'Clip to output white', false, { hint: 'Off keeps HDR highlights above white.' }),
  ],
  passes: [
    pixel(
      ['perc'],
      `
float lv(float x) {
  float ib = u_inBlack / 255.0;
  float iw = max(u_inWhite / 255.0, ib + 1.0 / 255.0);
  float g = max(u_gamma, 0.01);
  float t = (x - ib) / (iw - ib);
  t = max(t, 0.0);
  t = t <= 1.0 ? pow(t, 1.0 / g) : (u_clip > 0.5 ? 1.0 : 1.0 + (t - 1.0) / g);
  return mix(u_outBlack / 255.0, u_outWhite / 255.0, t);
}
vec3 fx(vec3 c, vec2 uv) {
  vec3 p = toPerc(c);
  vec3 q = vec3(lv(p.r), lv(p.g), lv(p.b));
  if (u_channel == 1) q = vec3(q.r, p.g, p.b);
  else if (u_channel == 2) q = vec3(p.r, q.g, p.b);
  else if (u_channel == 3) q = vec3(p.r, p.g, q.b);
  return fromPerc(q);
}`,
    ),
  ],
  keywords: ['black point', 'white point', 'gamma', 'input output', 'histogram', 'clip'],
};

const channelMixer: EffectDef = {
  type: 'channelMixer',
  name: 'Channel Mixer',
  category: 'Color',
  description: 'Rebuilds each output channel as a mix of the input channels, in linear light. Use it for creative color, channel swaps and custom monochrome.',
  params: [
    num('rr', 'Red · Red', 100, { min: -200, max: 200, step: 1, unit: '%' }),
    num('rg', 'Red · Green', 0, { min: -200, max: 200, step: 1, unit: '%' }),
    num('rb', 'Red · Blue', 0, { min: -200, max: 200, step: 1, unit: '%' }),
    num('gr', 'Green · Red', 0, { min: -200, max: 200, step: 1, unit: '%' }),
    num('gg', 'Green · Green', 100, { min: -200, max: 200, step: 1, unit: '%' }),
    num('gb', 'Green · Blue', 0, { min: -200, max: 200, step: 1, unit: '%' }),
    num('br', 'Blue · Red', 0, { min: -200, max: 200, step: 1, unit: '%' }),
    num('bg', 'Blue · Green', 0, { min: -200, max: 200, step: 1, unit: '%' }),
    num('bb', 'Blue · Blue', 100, { min: -200, max: 200, step: 1, unit: '%' }),
    num('constant', 'Constant', 0, { min: -100, max: 100, step: 0.5, unit: '%', hint: 'Adds the same amount to every channel.' }),
    bool('monochrome', 'Monochrome', false, { hint: 'Uses the Red row for all three channels.' }),
    bool('preserveLuma', 'Preserve luminosity', false),
  ],
  passes: [
    pixel(
      [],
      `
vec3 fx(vec3 c, vec2 uv) {
  mat3 m = mat3(u_rr, u_gr, u_br, u_rg, u_gg, u_bg, u_rb, u_gb, u_bb) * 0.01;
  vec3 o = m * c + u_constant * 0.01;
  if (u_monochrome > 0.5) o = vec3(dot(vec3(u_rr, u_rg, u_rb) * 0.01, c) + u_constant * 0.01);
  if (u_preserveLuma > 0.5) {
    float li = luma(c);
    float lo = luma(o);
    o *= abs(lo) > 1e-5 ? li / lo : 1.0;
  }
  return o;
}`,
    ),
  ],
  keywords: ['swap channels', 'rgb mix', 'monochrome mix', 'matrix'],
};

const blackWhite: EffectDef = {
  type: 'blackWhite',
  name: 'Black & White',
  category: 'Color',
  description: 'Converts to monochrome with control over how bright each color becomes, plus an optional tint (sepia, selenium, cyanotype).',
  params: [
    num('reds', 'Reds', 40, { min: -200, max: 300, softMin: -100, softMax: 200, step: 1, unit: '%' }),
    num('yellows', 'Yellows', 60, { min: -200, max: 300, softMin: -100, softMax: 200, step: 1, unit: '%' }),
    num('greens', 'Greens', 40, { min: -200, max: 300, softMin: -100, softMax: 200, step: 1, unit: '%' }),
    num('cyans', 'Cyans', 60, { min: -200, max: 300, softMin: -100, softMax: 200, step: 1, unit: '%' }),
    num('blues', 'Blues', 20, { min: -200, max: 300, softMin: -100, softMax: 200, step: 1, unit: '%' }),
    num('magentas', 'Magentas', 80, { min: -200, max: 300, softMin: -100, softMax: 200, step: 1, unit: '%' }),
    bool('tint', 'Tint', false),
    color('tintColor', 'Tint color', '#c8a878'),
    pct('tintAmount', 'Tint amount', 100),
  ],
  passes: [
    pixel(
      ['perc'],
      `
vec3 fx(vec3 c, vec2 uv) {
  vec3 p = toPerc(c);
  float mn = minc(p);
  float mx = maxc(p);
  float md = p.r + p.g + p.b - mn - mx;
  float wp;
  float ws;
  if (p.r >= p.g && p.r >= p.b) { wp = u_reds; ws = p.g >= p.b ? u_yellows : u_magentas; }
  else if (p.g >= p.r && p.g >= p.b) { wp = u_greens; ws = p.r >= p.b ? u_yellows : u_cyans; }
  else { wp = u_blues; ws = p.r >= p.g ? u_magentas : u_cyans; }
  float g = mn + (md - mn) * ws * 0.01 + (mx - md) * wp * 0.01;
  vec3 o = vec3(g);
  if (u_tint > 0.5) {
    vec3 tc = toPerc(u_tintColor.rgb);
    tc += 0.5 - luma(tc);
    float l = clamp(g, 0.0, 1.0);
    vec3 t = l < 0.5 ? mix(vec3(0.0), tc, 2.0 * l) : mix(tc, vec3(1.0), 2.0 * l - 1.0);
    o = mix(o, t + max(g - 1.0, 0.0), u_tintAmount * 0.01);
  }
  return fromPerc(o);
}`,
    ),
  ],
  keywords: ['monochrome', 'grayscale', 'greyscale', 'desaturate', 'sepia', 'mono', 'bw', 'b&w'],
};

const tint: EffectDef = {
  type: 'tint',
  name: 'Tint',
  category: 'Color',
  description: 'Maps the dark tones to one color and the light tones to another, then blends with the original.',
  params: [color('black', 'Map black to', '#000000'), color('white', 'Map white to', '#ffffff'), pct('amount', 'Amount to tint', 100)],
  passes: [
    pixel(
      ['perc'],
      `
vec3 fx(vec3 c, vec2 uv) {
  vec3 p = toPerc(c);
  float y = luma(p);
  vec3 t = mix(toPerc(u_black.rgb), toPerc(u_white.rgb), clamp(y, 0.0, 1.0)) + max(y - 1.0, 0.0);
  return fromPerc(mix(p, t, u_amount * 0.01));
}`,
    ),
  ],
  keywords: ['colorize', 'monotone', 'wash', 'gradient map'],
};

const duotone: EffectDef = {
  type: 'duotone',
  name: 'Duotone',
  category: 'Color',
  description: 'Two-ink look: shadows take one color and highlights another, with control over the balance and contrast between them.',
  params: [
    color('shadows', 'Shadows', '#14234f'),
    color('highlights', 'Highlights', '#ffcf7a'),
    spct('balance', 'Balance', 0, { unit: '', step: 1, hint: 'Moves the crossover toward the shadows or highlights.' }),
    spct('contrast', 'Contrast', 0, { unit: '', step: 1 }),
    pct('amount', 'Amount', 100),
  ],
  passes: [
    pixel(
      ['perc'],
      `
vec3 fx(vec3 c, vec2 uv) {
  vec3 p = toPerc(c);
  float y = clamp(luma(p), 0.0, 1.0);
  y = pow(y, exp2(-u_balance * 0.015));
  float k = 1.0 + u_contrast * 0.02;
  k = max(k, 0.02);
  y = y < 0.5 ? 0.5 * pow(2.0 * y, k) : 1.0 - 0.5 * pow(2.0 - 2.0 * y, k);
  vec3 t = mix(toPerc(u_shadows.rgb), toPerc(u_highlights.rgb), y);
  return fromPerc(mix(p, t, u_amount * 0.01));
}`,
    ),
  ],
  keywords: ['two tone', 'gradient map', 'poster', 'spotify'],
};

const invert: EffectDef = {
  type: 'invert',
  name: 'Invert',
  category: 'Color',
  description: 'Inverts the picture as it is displayed (a photographic negative), or only its lightness, one channel, or the alpha.',
  params: [choice('channel', 'Channel', 0, ['RGB', 'Lightness', 'Red', 'Green', 'Blue', 'Alpha']), pct('blend', 'Blend with original', 0)],
  passes: [
    pass(
      glsl(
        ['util', 'perc', 'ycc'],
        `
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float a = s.a;
  vec3 p = clamp(toPerc(unpremul(s)), 0.0, 1.0);
  vec3 q = p;
  if (u_channel == 0) q = 1.0 - p;
  else if (u_channel == 1) { vec3 y = rgb2ycc(p); y.x = 1.0 - y.x; q = clamp(ycc2rgb(y), 0.0, 1.0); }
  else if (u_channel == 2) q.r = 1.0 - p.r;
  else if (u_channel == 3) q.g = 1.0 - p.g;
  else if (u_channel == 4) q.b = 1.0 - p.b;
  vec4 o;
  if (u_channel == 5) o = premul(unpremul(s), 1.0 - a);
  else o = premul(fromPerc(q), a);
  if (u_channel == 5 && a <= 1e-5) o = vec4(0.0, 0.0, 0.0, 1.0);
  return mix(o, s, u_blend * 0.01);
}`,
      ),
    ),
  ],
  keywords: ['negative', 'reverse colors', 'inverse'],
};

const posterize: EffectDef = {
  type: 'posterize',
  name: 'Posterize',
  category: 'Color',
  description: 'Reduces each channel to a few flat tonal levels for a screen-print look.',
  params: [num('levels', 'Levels', 5, { min: 2, max: 64, softMax: 16, step: 1, hint: 'Tonal levels per channel.' }), pct('smooth', 'Smoothness', 0, { hint: 'Softens the steps between levels.' })],
  passes: [
    pixel(
      ['perc'],
      `
vec3 fx(vec3 c, vec2 uv) {
  float n = max(floor(u_levels + 0.5), 2.0) - 1.0;
  vec3 p = toPerc(c) * n;
  vec3 b = floor(p);
  float s = clamp(u_smooth * 0.005, 0.0, 0.5);
  vec3 f = smoothstep(0.5 - s - 1e-4, 0.5 + s + 1e-4, p - b);
  return fromPerc((b + f) / n);
}`,
    ),
  ],
  keywords: ['banding', 'flat', 'screen print', 'reduce colors', 'quantize'],
};

const threshold: EffectDef = {
  type: 'threshold',
  name: 'Threshold',
  category: 'Color',
  description: 'Turns the image into pure black and white around a brightness level, with an antialiased edge.',
  params: [pct('level', 'Level', 50), pct('softness', 'Softness', 2, { max: 50, softMax: 20 }), color('dark', 'Dark color', '#000000'), color('light', 'Light color', '#ffffff')],
  passes: [
    pixel(
      ['perc'],
      `
vec3 fx(vec3 c, vec2 uv) {
  float y = luma(toPerc(c));
  float l = u_level * 0.01;
  float s = max(u_softness * 0.005, 1e-4);
  return mix(u_dark.rgb, u_light.rgb, smoothstep(l - s, l + s, y));
}`,
    ),
  ],
  keywords: ['black and white', 'binary', '1-bit', 'stencil', 'high contrast'],
};

const colorReplace: EffectDef = {
  type: 'colorReplace',
  name: 'Color Replace',
  category: 'Color',
  description: 'Keys one hue and turns it into another color, keeping the original shading. Recolor a shirt, a car or a sign.',
  params: [
    color('from', 'From color', '#c62828'),
    color('to', 'To color', '#1e6fd9'),
    ang('tolerance', 'Hue tolerance', 22, { min: 0, max: 180, softMax: 90 }),
    ang('softness', 'Softness', 14, { min: 0, max: 180, softMax: 60 }),
    pct('minSat', 'Ignore below saturation', 12, { hint: 'Greys and near-greys are never changed.' }),
    choice('change', 'Change', 1, ['Hue', 'Hue and saturation', 'Hue, saturation and brightness']),
    bool('showMatte', 'Show matte', false),
  ],
  passes: [
    pixel(
      ['perc'],
      `${hueHelpers}
vec3 fx(vec3 c, vec2 uv) {
  vec3 p = toPerc(c);
  vec3 h = rgb2hsv(clamp(p, 0.0, 1.0));
  vec3 hf = rgb2hsv(clamp(toPerc(u_from.rgb), 0.0, 1.0));
  vec3 ht = rgb2hsv(clamp(toPerc(u_to.rgb), 0.0, 1.0));
  float d = hueDist(h.x, hf.x);
  float m = 1.0 - smoothstep(u_tolerance, u_tolerance + u_softness + 1e-3, d);
  float ms = u_minSat * 0.01;
  m *= smoothstep(ms * 0.5, ms + 1e-3, h.y);
  if (u_showMatte > 0.5) return vec3(m);
  vec3 n = h;
  n.x = fract(h.x + (ht.x - hf.x));
  if (u_change >= 1) n.y = clamp(h.y * (ht.y / max(hf.y, 1e-3)), 0.0, 1.0);
  if (u_change >= 2) n.z = h.z * (ht.z / max(hf.z, 1e-3));
  vec3 r = hsv2rgb(n) + max(p - 1.0, 0.0);
  return fromPerc(mix(p, r, m));
}`,
    ),
  ],
  keywords: ['change color', 'recolor', 'hue shift', 'swap color', 'change to color'],
};

const bleachBypass: EffectDef = {
  type: 'bleachBypass',
  name: 'Bleach Bypass',
  category: 'Color',
  description: 'The skip-bleach film process: silver retained over the color image gives high contrast, crushed saturation and a metallic sheen.',
  params: [pct('amount', 'Amount', 70), pct('saturation', 'Saturation', 55, { max: 150, hint: 'Color left after the bypass.' })],
  passes: [
    pixel(
      ['perc'],
      `
vec3 fx(vec3 c, vec2 uv) {
  vec3 p = toPerc(c);
  vec3 b = clamp(p, 0.0, 1.0);
  float l = luma(b);
  vec3 bl = vec3(l);
  float L = clamp(10.0 * (l - 0.45), 0.0, 1.0);
  vec3 r1 = 2.0 * b * bl;
  vec3 r2 = 1.0 - 2.0 * (1.0 - bl) * (1.0 - b);
  vec3 n = mix(r1, r2, L);
  n = mix(vec3(luma(n)), n, u_saturation * 0.01);
  n += max(p - 1.0, 0.0);
  return fromPerc(mix(p, n, u_amount * 0.01));
}`,
    ),
  ],
  keywords: ['silver retention', 'skip bleach', 'gritty', 'war film', 'desaturated contrast'],
};

const crossProcess: EffectDef = {
  type: 'crossProcess',
  name: 'Cross Process',
  category: 'Color',
  description: 'Slide film developed as negative: punchy contrast, yellow-green highlights and cyan-blue shadows.',
  params: [pct('amount', 'Amount', 80), spct('warmth', 'Warmth', 0, { unit: '', step: 1, hint: 'Pushes the highlights toward yellow or green.' })],
  passes: [
    pixel(
      ['perc'],
      `
float sCurve(float x, float k) { x = clamp(x, 0.0, 1.0); return x < 0.5 ? 0.5 * pow(2.0 * x, k) : 1.0 - 0.5 * pow(2.0 - 2.0 * x, k); }
vec3 fx(vec3 c, vec2 uv) {
  vec3 p = toPerc(c);
  vec3 o;
  o.r = sCurve(p.r, 1.55);
  o.g = sCurve(p.g, 1.3) + 0.025;
  o.b = 0.14 + clamp(p.b, 0.0, 1.0) * 0.72;
  o.r += u_warmth * 0.0006;
  o.g += 0.03 - abs(u_warmth) * 0.0002;
  o += max(p - 1.0, 0.0);
  return fromPerc(mix(p, o, u_amount * 0.01));
}`,
    ),
  ],
  keywords: ['xpro', 'lomo', 'film look', 'e6 c41', 'retro'],
};

const selectiveDesaturate: EffectDef = {
  type: 'selectiveDesaturate',
  name: 'Selective Desaturate',
  category: 'Color',
  description: 'Keeps one color and turns everything else black and white — the classic "red coat" look.',
  params: [
    color('keep', 'Keep color', '#d02424'),
    ang('tolerance', 'Hue tolerance', 25, { min: 0, max: 180, softMax: 90 }),
    ang('softness', 'Softness', 20, { min: 0, max: 180, softMax: 60 }),
    pct('minSat', 'Ignore below saturation', 15),
    pct('amount', 'Desaturation', 100),
    bool('showMatte', 'Show matte', false),
  ],
  passes: [
    pixel(
      ['perc'],
      `${hueHelpers}
vec3 fx(vec3 c, vec2 uv) {
  vec3 p = toPerc(c);
  vec3 h = rgb2hsv(clamp(p, 0.0, 1.0));
  vec3 hk = rgb2hsv(clamp(toPerc(u_keep.rgb), 0.0, 1.0));
  float d = hueDist(h.x, hk.x);
  float m = 1.0 - smoothstep(u_tolerance, u_tolerance + u_softness + 1e-3, d);
  float ms = u_minSat * 0.01;
  m *= smoothstep(ms * 0.5, ms + 1e-3, h.y);
  if (u_showMatte > 0.5) return vec3(m);
  vec3 g = vec3(luma(c));
  return mix(c, g, (1.0 - m) * u_amount * 0.01);
}`,
    ),
  ],
  keywords: ['color pop', 'keep color', 'leave color', 'splash', 'isolate color', 'sin city'],
};

export const COLOR_EFFECTS: EffectDef[] = [
  brightnessContrast,
  hueSaturation,
  levels,
  channelMixer,
  blackWhite,
  tint,
  duotone,
  invert,
  posterize,
  threshold,
  colorReplace,
  bleachBypass,
  crossProcess,
  selectiveDesaturate,
];
