// Stylize effects: light (glow, bloom, halation), lens and film artifacts,
// graphic treatments and alpha-based layer styles.
import type { EffectDef, EffectPass } from '../types';
import { BLEND_MODES, gaussChain, glsl, memoPass, pass, pn } from './glsl';
import { ang, bool, choice, color, hz, num, pct, point, px, spct } from './params';

type P = Record<string, number | boolean | string>;

// ---------------------------------------------------------------------------
// Highlight extraction shared by glow / bloom / halation: soft-knee threshold
// on the brightest channel, in premultiplied scene-linear light.
// ---------------------------------------------------------------------------
export const BRIGHT_FN = /* glsl */ `
vec4 brightOf(vec4 c, float th, float kneeFrac) {
  float knee = max(th * kneeFrac, 1e-3);
  float br = maxc(c.rgb);
  float soft = clamp(br - th + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-5);
  float w = max(soft, br - th) / max(br, 1e-5);
  return c * clamp(w, 0.0, 1.0);
}
`;

function brightPass(id: string, thresholdExpr: string, knee = 0.5): EffectPass {
  return memoPass(`bright|${id}`, () =>
    pass(
      glsl(
        ['util', 'perc'],
        `${BRIGHT_FN}
vec4 effect(vec2 uv) { return brightOf(src(uv), ${thresholdExpr}, ${knee.toFixed(3)}); }`,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Glow
// ---------------------------------------------------------------------------
const glowFinal = pass(
  glsl(
    ['util'],
    `
vec4 effect(vec2 uv) {
  vec4 o = texture(u_orig, uv);
  vec3 g = src(uv).rgb * u_tint.rgb * (u_intensity * 0.01);
  float ga = clamp(maxc(g), 0.0, 1.0);
  if (u_glowOnly > 0.5) return vec4(g, ga);
  vec3 rgb = u_mode == 1 ? o.rgb + g * (1.0 - clamp(o.rgb, 0.0, 1.0)) : o.rgb + g;
  return vec4(rgb, o.a + (1.0 - o.a) * ga);
}`,
  ),
);

function glowExpand(p: P): EffectPass[] {
  return [brightPass('glow', 'decP(u_threshold * 0.01)', 0.5), ...gaussChain({ id: 'glow', sigma: 'u_radius * 0.5' }, pn(p, 'radius') * 0.5), glowFinal];
}

const glow: EffectDef = {
  type: 'glow',
  name: 'Glow',
  category: 'Stylize',
  description: 'Bright areas radiate a soft glow. Works in linear light, so it adds up like real light; also great on titles and logos.',
  params: [
    pct('threshold', 'Threshold', 60, { max: 400, softMax: 100, hint: 'Only areas brighter than this glow.' }),
    px('radius', 'Radius', 30, { max: 1000, softMax: 200 }),
    pct('intensity', 'Intensity', 90, { max: 1000, softMax: 300 }),
    color('tint', 'Tint', '#ffffff'),
    choice('mode', 'Composite', 0, ['Add', 'Screen']),
    bool('glowOnly', 'Glow only', false),
  ],
  passes: [],
  expand: glowExpand,
  keywords: ['shine', 'aura', 'neon', 'soft light', 'radiance', 'diffusion'],
};
glow.passes = glowExpand({ radius: 30 });

// ---------------------------------------------------------------------------
// Bloom: wide Gaussian tail + a tight core sampled in the composite pass.
// ---------------------------------------------------------------------------
const bloomFinal = pass(
  glsl(
    ['util', 'perc', 'taps'],
    `${BRIGHT_FN}
vec4 effect(vec2 uv) {
  vec4 o = texture(u_orig, uv);
  vec3 wide = src(uv).rgb;
  float th = decP(u_threshold * 0.01);
  float rc = max(u_core, 0.5);
  vec3 core = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 16; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / 16.0) * 2.2;
    float a = fi * 2.3999632;
    float w = exp(-0.5 * r * r);
    core += brightOf(origC(uv + vec2(cos(a), sin(a)) * r * rc * u_texel), th, u_knee * 0.01).rgb * w;
    wsum += w;
  }
  core /= wsum;
  vec3 b = (wide * 0.7 + core * 0.3) * u_tint.rgb * (u_intensity * 0.01);
  b = mix(vec3(luma(b)), b, u_saturation * 0.01);
  return vec4(o.rgb + b, o.a + (1.0 - o.a) * clamp(maxc(b), 0.0, 1.0));
}`,
  ),
);

function bloomExpand(p: P): EffectPass[] {
  return [brightPassBloom, ...gaussChain({ id: 'bloom', sigma: 'u_radius * 0.5' }, pn(p, 'radius') * 0.5), bloomFinal];
}
const brightPassBloom = pass(
  glsl(
    ['util', 'perc'],
    `${BRIGHT_FN}
vec4 effect(vec2 uv) { return brightOf(src(uv), decP(u_threshold * 0.01), u_knee * 0.01); }`,
  ),
);

const bloom: EffectDef = {
  type: 'bloom',
  name: 'Bloom',
  category: 'Stylize',
  description: 'Physically based light bloom: highlights scatter with a tight core and a long soft tail, like light in a lens and the eye.',
  params: [
    pct('threshold', 'Threshold', 80, { max: 800, softMax: 200, hint: 'Brightness where blooming starts (100% = display white).' }),
    pct('knee', 'Knee', 50, { hint: 'Softness of the threshold.' }),
    pct('intensity', 'Intensity', 60, { max: 1000, softMax: 300 }),
    px('radius', 'Spread', 80, { max: 1500, softMax: 400 }),
    px('core', 'Core size', 6, { min: 0.5, max: 60, softMax: 20 }),
    pct('saturation', 'Saturation', 100, { max: 200 }),
    color('tint', 'Tint', '#ffffff'),
  ],
  passes: [],
  expand: bloomExpand,
  keywords: ['glow', 'highlights', 'hdr', 'dreamy', 'light scatter', 'pro mist'],
};
bloom.passes = bloomExpand({ radius: 80 });

// ---------------------------------------------------------------------------
// Halation: red-orange bleed around highlights (light reflecting off the film base).
// ---------------------------------------------------------------------------
export const HALATION_FINAL_BODY = /* glsl */ `
vec3 halationAdd(vec3 base, vec3 blurred, float th, float amount, vec3 tintc) {
  float h = luma(blurred);
  float self = smoothstep(th, th * 2.0 + 0.1, maxc(base));
  return tintc * h * amount * (1.0 - 0.6 * self);
}
`;

const halationFinal = pass(
  glsl(
    ['util', 'perc'],
    `${HALATION_FINAL_BODY}
vec4 effect(vec2 uv) {
  vec4 o = texture(u_orig, uv);
  vec3 add = halationAdd(o.rgb, src(uv).rgb, decP(u_threshold * 0.01), u_amount * 0.01 * 2.0, u_tint.rgb);
  return vec4(o.rgb + add, o.a + (1.0 - o.a) * clamp(maxc(add), 0.0, 1.0));
}`,
  ),
);

function halationExpand(p: P): EffectPass[] {
  return [brightPass('halation', 'decP(u_threshold * 0.01)', 0.6), ...gaussChain({ id: 'halation', sigma: 'u_radius * 0.5' }, pn(p, 'radius') * 0.5), halationFinal];
}

const halation: EffectDef = {
  type: 'halation',
  name: 'Halation',
  category: 'Stylize',
  description: 'The warm red fringe film shows around bright highlights, from light bouncing off the film base. Subtle and very filmic.',
  params: [
    pct('threshold', 'Threshold', 70, { max: 400, softMax: 150 }),
    px('radius', 'Radius', 14, { max: 400, softMax: 80 }),
    pct('amount', 'Amount', 55, { max: 400, softMax: 150 }),
    color('tint', 'Color', '#ff2a0a'),
  ],
  passes: [],
  expand: halationExpand,
  keywords: ['film', 'red glow', 'cinestill', 'highlight bleed', 'analog'],
};
halation.passes = halationExpand({ radius: 14 });

// ---------------------------------------------------------------------------
// Vignette (exposure-based falloff, so darkened corners keep their color)
// ---------------------------------------------------------------------------
export const VIGNETTE_FN = /* glsl */ `
float vignetteMask(vec2 uv, vec2 c, float midpoint, float roundness, float feather) {
  vec2 q = (uv - c) * 2.0;
  float aspect = u_resolution.x / u_resolution.y;
  if (roundness > 0.0) q.x *= mix(1.0, aspect, roundness);
  float n = roundness < 0.0 ? mix(2.0, 8.0, -roundness) : 2.0;
  vec2 aq = abs(q) + 1e-6;
  float d = pow(pow(aq.x, n) + pow(aq.y, n), 1.0 / n);
  float R = mix(0.35, 1.9, midpoint);
  float F = mix(0.03, 1.6, feather);
  return smoothstep(R - F * 0.5, R + F * 0.5, d);
}
`;

const vignette: EffectDef = {
  type: 'vignette',
  name: 'Vignette',
  category: 'Stylize',
  description: 'Darkens (or lightens) the edges of the frame with a natural, exposure-based falloff.',
  params: [
    spct('amount', 'Amount', -40, { unit: '', step: 1, hint: 'Negative darkens the edges, positive lightens them.' }),
    pct('midpoint', 'Midpoint', 50, { hint: 'How far the vignette reaches toward the center.' }),
    spct('roundness', 'Roundness', 0, { unit: '', step: 1, hint: '100 is a circle, 0 follows the frame, negative is more rectangular.' }),
    pct('feather', 'Feather', 55),
    point('center', 'Center', '0.5,0.5'),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'perc'],
        `${VIGNETTE_FN}
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float m = vignetteMask(uv, pt(u_center), u_midpoint * 0.01, u_roundness * 0.01, u_feather * 0.01);
  float a = clamp(u_amount * 0.01, -1.0, 1.0);
  if (a < 0.0) return vec4(s.rgb * exp2(a * 3.5 * m), s.a);
  vec3 c = toPerc(unpremul(s));
  c = mix(c, max(c, vec3(1.0)), a * m);
  return premul(fromPerc(c), s.a);
}`,
      ),
    ),
  ],
  keywords: ['edge darken', 'corners', 'lens falloff', 'spotlight', 'frame'],
};

// ---------------------------------------------------------------------------
// Film Grain (log-domain, luma-dependent, resolution independent, animated)
// ---------------------------------------------------------------------------
export const GRAIN_FN = /* glsl */ `
float grainN(vec2 p) { return gnoise(p) * 0.7 + gnoise(p * 2.07 + 19.1) * 0.3; }
vec3 applyGrain(vec3 c, vec2 uv, float amount, float size, float colorAmt, float shadows, float highlights, float animate) {
  vec3 l = linToLog(max(c, vec3(0.0)));
  float sz = max(size, 0.2) * u_resolution.y / 1080.0;
  vec2 p = uv * u_resolution / sz;
  float fr = animate > 0.5 ? floor(u_time * 120.0 + 0.5) : 0.0;
  vec2 off = vec2(hash11(fr * 0.731 + u_seed * 917.0), hash11(fr * 1.37 + u_seed * 311.0)) * 640.0;
  vec3 n;
  n.g = grainN(p + off);
  n.r = mix(n.g, grainN(p + off + vec2(71.3, 13.1)), colorAmt);
  n.b = mix(n.g, grainN(p + off + vec2(143.9, 57.7)), colorAmt);
  float y = dot(l, vec3(0.2126, 0.7152, 0.0722));
  float resp = y < 0.41 ? mix(shadows, 1.0, smoothstep(0.12, 0.41, y)) : mix(1.0, highlights, smoothstep(0.41, 0.8, y));
  l += n * amount * 0.045 * resp;
  return logToLin(l);
}
`;

const filmGrain: EffectDef = {
  type: 'filmGrain',
  name: 'Film Grain',
  category: 'Stylize',
  description: 'Organic film grain applied in log space: strongest in the midtones, finer in highlights, never a flat digital noise. Animates every frame.',
  params: [
    pct('amount', 'Amount', 35, { max: 200, softMax: 100 }),
    num('size', 'Size', 1.2, { min: 0.3, max: 8, softMax: 4, step: 0.05, unit: 'x', hint: 'Grain size relative to 35 mm grain at 1080p; independent of resolution.' }),
    pct('color', 'Color', 25, { hint: '0 is monochrome grain; higher values give each channel its own grain.' }),
    pct('shadows', 'Shadows', 70, { max: 200 }),
    pct('highlights', 'Highlights', 45, { max: 200 }),
    bool('animate', 'Animate', true),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'log', 'noise'],
        `${GRAIN_FN}
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  if (s.a <= 1e-5) return s;
  vec3 c = applyGrain(unpremul(s), uv, u_amount * 0.01, u_size, u_color * 0.01, u_shadows * 0.01, u_highlights * 0.01, u_animate);
  return premul(c, s.a);
}`,
      ),
    ),
  ],
  keywords: ['noise', 'film', '35mm', '16mm', 'texture', 'analog', 'grain'],
};

// ---------------------------------------------------------------------------
// Chromatic Aberration (spectral, 9 wavelengths)
// ---------------------------------------------------------------------------
const chromaticAberration: EffectDef = {
  type: 'chromaticAberration',
  name: 'Chromatic Aberration',
  category: 'Stylize',
  description: 'Splits colors toward the frame edges like an imperfect lens, with a smooth spectral fringe instead of hard RGB copies.',
  params: [
    px('amount', 'Amount', 6, { max: 200, softMax: 40, hint: 'Fringe width in pixels at the frame corners.' }),
    choice('mode', 'Mode', 0, ['Radial (lens)', 'Linear']),
    ang('angle', 'Angle', 0, { min: -180, max: 180, hint: 'Direction of the split in linear mode.' }),
    point('center', 'Center', '0.5,0.5'),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'taps', 'spectral'],
        `
vec4 effect(vec2 uv) {
  vec2 dir;
  if (u_mode == 0) {
    vec2 d = (uv - pt(u_center)) * u_resolution;
    float r = length(d) / (0.5 * length(u_resolution));
    dir = d / max(length(d), 1e-4) * r * u_amount;
  } else {
    float a = radians(u_angle);
    dir = vec2(cos(a), sin(a)) * u_amount;
  }
  if (length(dir) < 0.05) return tapC(uv);
  vec3 acc = vec3(0.0);
  vec3 ws = vec3(0.0);
  float aa = 0.0;
  for (int i = 0; i < 9; i++) {
    float t = float(i) / 8.0;
    vec3 w = spectralW(t);
    vec4 c = tapC(uv + dir * (0.5 - t) * u_texel);
    acc += c.rgb * w;
    ws += w;
    aa += c.a;
  }
  return vec4(acc / ws, aa / 9.0);
}`,
      ),
    ),
  ],
  keywords: ['rgb split', 'fringe', 'lens', 'color fringe', 'prism', 'ca'],
};

// ---------------------------------------------------------------------------
// Pixelate (box-averaged cells, square or hexagonal)
// ---------------------------------------------------------------------------
const pixelate: EffectDef = {
  type: 'pixelate',
  name: 'Pixelate',
  category: 'Stylize',
  description: 'Mosaic of flat cells, each the true average of the pixels it covers. Square or hexagonal.',
  params: [px('size', 'Cell size', 16, { min: 2, max: 512, softMax: 96, step: 1 }), choice('shape', 'Shape', 0, ['Square', 'Hexagon']), pct('gap', 'Gap', 0, { max: 50, hint: 'Dark grout between cells.' })],
  passes: [
    pass(
      glsl(
        ['taps'],
        `
vec2 hexCenter(vec2 p) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  return dot(a, a) < dot(b, b) ? p - a : p - b;
}
vec4 effect(vec2 uv) {
  float s = max(u_size, 1.0);
  vec2 p = uv * u_resolution;
  vec4 acc = vec4(0.0);
  float edge = 0.0;
  if (u_shape == 1) {
    vec2 c = hexCenter(p / s) * s;
    for (int i = 0; i < 7; i++) {
      float a = float(i) * 1.0471976;
      vec2 o = i == 0 ? vec2(0.0) : vec2(cos(a), sin(a)) * 0.33 * s;
      acc += tapC((c + o) * u_texel);
    }
    acc /= 7.0;
    vec2 d = abs(p - c) / s;
    edge = max(d.x * 1.0, dot(d, vec2(0.5, 0.8660254))) * 2.0;
  } else {
    vec2 cell = floor(p / s);
    for (int j = 0; j < 4; j++)
      for (int i = 0; i < 4; i++) acc += tapC((cell + (vec2(float(i), float(j)) + 0.5) / 4.0) * s * u_texel);
    acc /= 16.0;
    vec2 f = abs(fract(p / s) - 0.5) * 2.0;
    edge = max(f.x, f.y);
  }
  float g = u_gap * 0.01;
  if (g > 0.0) acc *= 1.0 - smoothstep(1.0 - g - 1.0 / s, 1.0 - g + 1.0 / s, edge);
  return acc;
}`,
      ),
    ),
  ],
  keywords: ['mosaic', 'censor', 'blur face', '8-bit', 'blocks', 'retro'],
};

// ---------------------------------------------------------------------------
// Halftone
// ---------------------------------------------------------------------------
const halftone: EffectDef = {
  type: 'halftone',
  name: 'Halftone',
  category: 'Stylize',
  description: 'Print-style screen of dots or lines, in one ink, true CMYK rosettes, or colored dots.',
  params: [
    px('size', 'Dot pitch', 8, { min: 2, max: 128, softMax: 40 }),
    ang('angle', 'Screen angle', 45, { min: -180, max: 180 }),
    choice('shape', 'Shape', 0, ['Dot', 'Line', 'Square']),
    choice('mode', 'Mode', 0, ['One ink', 'CMYK', 'Colored dots']),
    color('ink', 'Ink', '#111111'),
    color('paper', 'Paper', '#f4efe4'),
    spct('contrast', 'Contrast', 0, { unit: '', step: 1 }),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'perc', 'taps'],
        `
float dotCov(vec2 p, float ang, float dark, out vec2 cellCenter) {
  vec2 q = rot2(p, -ang);
  vec2 cell = floor(q) + 0.5;
  cellCenter = rot2(cell, ang);
  vec2 f = q - cell;
  float aa = 1.0 / max(u_size, 1.0);
  dark = clamp(dark, 0.0, 1.0);
  if (u_shape == 1) return 1.0 - smoothstep(dark * 0.5 - aa, dark * 0.5 + aa, abs(f.y));
  if (u_shape == 2) {
    float r = sqrt(dark) * 0.5;
    return 1.0 - smoothstep(r - aa, r + aa, max(abs(f.x), abs(f.y)));
  }
  float r = sqrt(dark / 3.14159265) * (dark > 0.785 ? 1.0 + (dark - 0.785) * 0.5 : 1.0);
  return 1.0 - smoothstep(r - aa, r + aa, length(f));
}
float tone(float x) {
  float k = exp2(u_contrast * 0.02);
  x = clamp(x, 0.0, 1.0);
  return x < 0.5 ? 0.5 * pow(2.0 * x, k) : 1.0 - 0.5 * pow(2.0 - 2.0 * x, k);
}
vec3 cellColor(vec2 cc) {
  vec4 s = tapC(cc * u_size * u_texel);
  return clamp(toPerc(unpremul(s)), 0.0, 1.0);
}
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  vec2 p = uv * u_resolution / max(u_size, 1.0);
  float ang = radians(u_angle);
  vec3 paper = toPerc(u_paper.rgb);
  vec3 ink = toPerc(u_ink.rgb);
  vec2 cc;
  vec3 o;
  if (u_mode == 1) {
    vec2 c1; vec2 c2; vec2 c3; vec2 c4;
    dotCov(p, ang + radians(15.0), 0.0, c1);
    dotCov(p, ang + radians(75.0), 0.0, c2);
    dotCov(p, ang, 0.0, c3);
    dotCov(p, ang + radians(45.0), 0.0, c4);
    vec3 s1 = cellColor(c1); vec3 s2 = cellColor(c2); vec3 s3 = cellColor(c3); vec3 s4 = cellColor(c4);
    float k1 = 1.0 - maxc(s1); float k2 = 1.0 - maxc(s2); float k3 = 1.0 - maxc(s3); float k4 = 1.0 - maxc(s4);
    float C = tone((1.0 - s1.r - k1) / max(1.0 - k1, 1e-3));
    float M = tone((1.0 - s2.g - k2) / max(1.0 - k2, 1e-3));
    float Y = tone((1.0 - s3.b - k3) / max(1.0 - k3, 1e-3));
    float K = tone(k4);
    float cC = dotCov(p, ang + radians(15.0), C, c1);
    float cM = dotCov(p, ang + radians(75.0), M, c2);
    float cY = dotCov(p, ang, Y, c3);
    float cK = dotCov(p, ang + radians(45.0), K, c4);
    o = paper * (1.0 - cC * vec3(0.95, 0.25, 0.05)) * (1.0 - cM * vec3(0.05, 0.85, 0.15)) * (1.0 - cY * vec3(0.02, 0.08, 0.9)) * (1.0 - 0.95 * cK);
  } else {
    dotCov(p, ang, 0.0, cc);
    vec3 sc = cellColor(cc);
    float dark = tone(1.0 - luma(sc));
    float cov = dotCov(p, ang, u_mode == 2 ? clamp(0.25 + 0.75 * dark, 0.0, 1.0) : dark, cc);
    vec3 inkc = u_mode == 2 ? sc * (1.0 - 0.35 * dark) : ink;
    o = mix(paper, inkc, cov);
  }
  return premul(fromPerc(o), s.a);
}`,
      ),
    ),
  ],
  keywords: ['print', 'comic', 'dots', 'newspaper', 'pop art', 'screen', 'cmyk'],
};

// ---------------------------------------------------------------------------
// Edge Detect / Emboss
// ---------------------------------------------------------------------------
const edgeDetect: EffectDef = {
  type: 'edgeDetect',
  name: 'Edge Detect',
  category: 'Stylize',
  description: 'Finds edges with a Sobel operator: glowing lines on black, a pencil sketch, or edges in their original colors.',
  params: [
    choice('mode', 'Style', 0, ['Edges on black', 'Sketch', 'Colored edges']),
    pct('strength', 'Strength', 150, { max: 1000, softMax: 400 }),
    px('width', 'Width', 1, { min: 0.5, max: 10, softMax: 4 }),
    pct('blend', 'Blend with original', 0),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'perc', 'taps'],
        `
float Lp(vec2 uv) { vec4 s = tapC(uv); return luma(clamp(toPerc(unpremul(s)), 0.0, 1.0)) * s.a; }
vec4 effect(vec2 uv) {
  vec2 d = u_texel * max(u_width, 0.5);
  float tl = Lp(uv + vec2(-d.x, d.y)); float tc = Lp(uv + vec2(0.0, d.y)); float tr = Lp(uv + d);
  float ml = Lp(uv - vec2(d.x, 0.0)); float mr = Lp(uv + vec2(d.x, 0.0));
  float bl = Lp(uv - d); float bc = Lp(uv - vec2(0.0, d.y)); float br = Lp(uv + vec2(d.x, -d.y));
  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
  float e = clamp(length(vec2(gx, gy)) * 0.25 * u_strength * 0.01, 0.0, 1.0);
  vec4 s = src(uv);
  vec3 c = clamp(toPerc(unpremul(s)), 0.0, 1.0);
  vec3 o;
  if (u_mode == 1) o = vec3(1.0 - e);
  else if (u_mode == 2) o = c * e * 1.6;
  else o = vec3(e);
  float a = u_mode == 1 ? max(s.a, 0.0) : s.a;
  vec4 r = premul(fromPerc(o), a);
  return mix(r, s, u_blend * 0.01);
}`,
      ),
    ),
  ],
  keywords: ['outline', 'sobel', 'sketch', 'lines', 'find edges', 'contour'],
};

const emboss: EffectDef = {
  type: 'emboss',
  name: 'Emboss',
  category: 'Stylize',
  description: 'Raises the image into relief, lit from one direction. Grey relief or embossed color.',
  params: [
    ang('direction', 'Direction', 135, { min: -180, max: 180, hint: 'Where the light comes from.' }),
    px('height', 'Height', 2, { min: 0.5, max: 30, softMax: 10 }),
    pct('relief', 'Relief', 250, { max: 1000, softMax: 600 }),
    bool('keepColor', 'Keep color', false),
    pct('blend', 'Blend with original', 0),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'perc', 'taps'],
        `
float Lp(vec2 uv) { vec4 s = tapC(uv); return luma(clamp(toPerc(unpremul(s)), 0.0, 1.0)) * s.a; }
vec4 effect(vec2 uv) {
  float a = radians(u_direction);
  vec2 d = vec2(cos(a), sin(a)) * max(u_height, 0.5) * u_texel;
  float r = (Lp(uv + d) - Lp(uv - d)) * u_relief * 0.01;
  vec4 s = src(uv);
  vec3 c = toPerc(unpremul(s));
  vec3 o = u_keepColor > 0.5 ? c + r : vec3(0.5 + r);
  return mix(premul(fromPerc(o), s.a), s, u_blend * 0.01);
}`,
      ),
    ),
  ],
  keywords: ['relief', 'stamp', 'bevel', 'metal', 'carve'],
};

// ---------------------------------------------------------------------------
// Scanlines
// ---------------------------------------------------------------------------
const scanlines: EffectDef = {
  type: 'scanlines',
  name: 'Scanlines',
  category: 'Stylize',
  description: 'CRT-style scanlines with optional phosphor mask and rolling motion.',
  params: [
    px('spacing', 'Spacing', 4, { min: 1.5, max: 64, softMax: 16 }),
    pct('thickness', 'Line thickness', 45),
    pct('darkness', 'Darkness', 55),
    pct('softness', 'Softness', 60),
    choice('orientation', 'Orientation', 0, ['Horizontal', 'Vertical']),
    num('speed', 'Roll speed', 0, { min: -500, max: 500, softMin: -100, softMax: 100, step: 0.5, unit: 'px', hint: 'Pixels per second.' }),
    pct('mask', 'Phosphor mask', 0),
  ],
  passes: [
    pass(
      glsl(
        ['util'],
        `
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  vec2 p = uv * u_resolution;
  float c = u_orientation == 1 ? p.x : u_resolution.y - p.y;
  c += u_time * u_speed;
  float sp = max(u_spacing, 1.0);
  float f = abs(fract(c / sp) - 0.5) * 2.0;
  float th = u_thickness * 0.01;
  float soft = max(u_softness * 0.01 * 0.5, 1.0 / sp);
  float line = smoothstep(1.0 - th - soft, 1.0 - th + soft, f);
  vec3 m = vec3(1.0);
  if (u_mask > 0.0) {
    float k = mod(floor(u_orientation == 1 ? p.y : p.x), 3.0);
    vec3 tri = k < 0.5 ? vec3(1.0, 0.35, 0.35) : (k < 1.5 ? vec3(0.35, 1.0, 0.35) : vec3(0.35, 0.35, 1.0));
    m = mix(vec3(1.0), tri * 1.45, u_mask * 0.01);
  }
  return vec4(s.rgb * (1.0 - line * u_darkness * 0.01) * m, s.a);
}`,
      ),
    ),
  ],
  keywords: ['crt', 'tv', 'retro', 'monitor', 'lines', 'interlace'],
};

// ---------------------------------------------------------------------------
// VHS
// ---------------------------------------------------------------------------
const vhs: EffectDef = {
  type: 'vhs',
  name: 'VHS',
  category: 'Stylize',
  description: 'Worn videotape: soft luma, smeared and offset chroma, line jitter, a rolling tracking band, head-switching noise and tape hiss.',
  params: [
    pct('amount', 'Amount', 70),
    px('bleed', 'Chroma bleed', 7, { max: 40, softMax: 20 }),
    px('jitter', 'Line jitter', 1.5, { max: 20, softMax: 8 }),
    pct('tracking', 'Tracking error', 35),
    pct('noise', 'Noise', 30),
    pct('saturation', 'Saturation', 115, { max: 200 }),
    px('softness', 'Softness', 1.5, { max: 8 }),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'perc', 'ycc', 'noise', 'taps'],
        `
vec3 Ycc(vec2 uv) { vec4 s = tapC(uv); return rgb2ycc(toPerc(unpremul(s))); }
vec4 effect(vec2 uv) {
  float A = u_amount * 0.01;
  float fr = floor(u_time * 29.97);
  float line = floor(uv.y * u_resolution.y);
  float j = (vnoise(vec2(line * 0.045, u_time * 5.0)) - 0.5) * 2.0 * u_jitter + (hash12(vec2(line, fr)) - 0.5) * u_jitter * 0.7;
  float bandY = 1.0 - fract(u_time * 0.11 + u_seed);
  float band = (1.0 - smoothstep(0.0, 0.05, abs(uv.y - bandY))) * u_tracking * 0.01;
  j += band * (hash12(vec2(line * 1.7, fr)) - 0.5) * 40.0;
  float head = smoothstep(0.035, 0.0, uv.y);
  j += head * 18.0 * (hash12(vec2(line * 0.3, fr)) + 0.5);
  vec2 q = uv + vec2(j * A * u_texel.x, 0.0);
  vec4 s0 = tapC(q);
  float soft = u_softness * A + 0.01;
  float Y = 0.0;
  for (int i = -2; i <= 2; i++) Y += Ycc(q + vec2(float(i) * soft * 0.5 * u_texel.x, 0.0)).x;
  Y /= 5.0;
  vec2 C = vec2(0.0);
  float bl = u_bleed * A;
  for (int i = 0; i < 9; i++) {
    float t = float(i) / 8.0;
    C += Ycc(q + vec2((t * bl + bl * 0.35) * u_texel.x, 0.0)).yz;
  }
  C /= 9.0;
  C *= mix(1.0, u_saturation * 0.01, A);
  float n = (hash12(uv * u_resolution + fr * 17.0) - 0.5) * u_noise * 0.01 * 0.22 * A;
  n += band * (hash12(vec2(uv.x * u_resolution.x * 0.5, line + fr)) - 0.5) * 0.6 * A;
  Y += n;
  Y = mix(Y, Y * 0.92 + 0.04, A);
  vec3 rgb = ycc2rgb(vec3(Y, C));
  return premul(fromPerc(rgb), s0.a);
}`,
      ),
    ),
  ],
  keywords: ['tape', 'vcr', 'retro', '80s', '90s', 'analog', 'camcorder', 'lo-fi'],
};

// ---------------------------------------------------------------------------
// Glitch
// ---------------------------------------------------------------------------
const glitch: EffectDef = {
  type: 'glitch',
  name: 'Glitch',
  category: 'Stylize',
  description: 'Digital corruption: displaced blocks, torn lines and animated RGB splits that change several times a second.',
  params: [
    pct('amount', 'Amount', 50),
    px('blockSize', 'Block size', 40, { min: 4, max: 400, softMax: 160 }),
    px('split', 'RGB split', 10, { max: 200, softMax: 60 }),
    hz('rate', 'Rate', 8, { max: 60, softMax: 24, hint: 'How many times per second the glitch pattern changes.' }),
    pct('jitter', 'Line tearing', 35),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'noise', 'taps'],
        `
vec4 effect(vec2 uv) {
  float A = u_amount * 0.01;
  float slice = floor(u_time * max(u_rate, 0.01));
  float sd = u_seed * 97.0 + slice * 1.618;
  float act = step(1.0 - (0.3 + 0.7 * A), hash11(sd * 1.31 + 0.17));
  vec2 p = uv * u_resolution;
  vec2 bs = max(vec2(u_blockSize * 2.2, u_blockSize * 0.55), vec2(2.0));
  vec2 cell = floor(p / bs);
  float hb = hash12(cell + vec2(sd * 13.7, sd * 3.1));
  float hit = step(1.0 - 0.3 * A, hb) * act;
  vec2 disp = (hash22(cell + sd) - 0.5) * vec2(u_blockSize * 3.0, u_blockSize * 0.4) * hit;
  float ln = floor(p.y / 3.0);
  float tear = step(1.0 - u_jitter * 0.01 * 0.25 * A, hash12(vec2(ln * 0.37, sd + 5.0))) * act;
  float lj = (hash12(vec2(ln, sd)) - 0.5) * u_blockSize * 1.5 * tear;
  vec2 q = uv + (disp + vec2(lj, 0.0)) * u_texel;
  float sgn = hash11(sd * 3.1) > 0.5 ? 1.0 : -1.0;
  vec2 sp = vec2(u_split * A * (0.35 + 0.65 * act) * sgn, u_split * 0.15 * A * act) * u_texel;
  vec4 cr = tapC(q + sp);
  vec4 cg = tapC(q);
  vec4 cb = tapC(q - sp);
  vec4 o = vec4(cr.r, cg.g, cb.b, max(cg.a, max(cr.a, cb.a)));
  if (hit > 0.5 && hash12(cell + sd * 3.3) > 0.82) o.rgb = max(vec3(o.a) - o.rgb, 0.0);
  if (hit > 0.5 && hash12(cell + sd * 7.7) > 0.9) o.rgb = o.rgb.gbr;
  return o;
}`,
      ),
    ),
  ],
  keywords: ['datamosh', 'corrupt', 'digital', 'distortion', 'error', 'cyberpunk', 'rgb split'],
};

// ---------------------------------------------------------------------------
// Letterbox
// ---------------------------------------------------------------------------
const ASPECTS = ['2.39:1 Scope', '2.35:1', '2.00:1 Univisium', '1.85:1 Flat', '1.66:1', '16:9', '4:3', '1:1', '4:5', '9:16', 'Custom'];

const letterbox: EffectDef = {
  type: 'letterbox',
  name: 'Letterbox',
  category: 'Stylize',
  description: 'Matte bars for a cinematic aspect ratio. Letterboxes or pillarboxes automatically depending on the target ratio.',
  params: [
    choice('aspect', 'Aspect ratio', 0, ASPECTS),
    num('custom', 'Custom ratio', 2.39, { min: 0.2, max: 6, softMin: 0.5, softMax: 3, step: 0.01, unit: 'x', hint: 'Width ÷ height, used when the ratio is Custom.' }),
    color('color', 'Color', '#000000'),
    pct('opacity', 'Opacity', 100),
    spct('offset', 'Offset', 0, { unit: '%', hint: 'Slides the picture window within the bars.' }),
    px('softness', 'Edge softness', 0, { max: 100, softMax: 20 }),
  ],
  passes: [
    pass(
      glsl(
        ['util'],
        `
const float AR[10] = float[10](2.39, 2.35, 2.0, 1.85, 1.66, 1.7777778, 1.3333333, 1.0, 0.8, 0.5625);
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float target = u_aspect >= 0 && u_aspect < 10 ? AR[u_aspect] : max(u_custom, 0.05);
  float la = u_resolution.x / u_resolution.y;
  vec2 p = uv * u_resolution;
  float d;
  if (target >= la) {
    float h = u_resolution.x / target;
    float bar = (u_resolution.y - h) * 0.5;
    float y = (1.0 - uv.y) * u_resolution.y - bar * (1.0 + u_offset * 0.01);
    d = max(-y, y - h);
  } else {
    float w = u_resolution.y * target;
    float bar = (u_resolution.x - w) * 0.5;
    float x = p.x - bar * (1.0 + u_offset * 0.01);
    d = max(-x, x - w);
  }
  float sf = max(u_softness, 0.5);
  float m = smoothstep(-sf * 0.5, sf * 0.5, d) * u_opacity * 0.01;
  vec4 bars = vec4(u_color.rgb, 1.0) * u_color.a;
  return mix(s, bars, m);
}`,
      ),
    ),
  ],
  keywords: ['cinemascope', 'bars', 'widescreen', 'aspect', 'pillarbox', 'matte', 'crop', 'anamorphic'],
};

// ---------------------------------------------------------------------------
// Drop Shadow (alpha-based)
// ---------------------------------------------------------------------------
const shadowSrc = pass(
  glsl(
    ['taps'],
    `
vec4 effect(vec2 uv) {
  float a = radians(u_angle);
  vec2 o = vec2(cos(a), sin(a)) * u_distance * u_texel;
  float al = tapT(uv - o).a;
  return vec4(al);
}`,
  ),
);

const shadowFinal = pass(
  glsl(
    [],
    `
vec4 effect(vec2 uv) {
  vec4 o = texture(u_orig, uv);
  float sa = clamp(src(uv).a, 0.0, 1.0) * u_opacity * 0.01 * u_color.a;
  vec4 sh = vec4(u_color.rgb * sa, sa);
  if (u_shadowOnly > 0.5) return sh;
  return o + sh * (1.0 - o.a);
}`,
  ),
);

function shadowExpand(p: P): EffectPass[] {
  return [shadowSrc, ...gaussChain({ id: 'dropShadow', sigma: 'u_softness * 0.5', tap: 'tapT' }, pn(p, 'softness') * 0.5), shadowFinal];
}

const dropShadow: EffectDef = {
  type: 'dropShadow',
  name: 'Drop Shadow',
  category: 'Stylize',
  description: 'A soft shadow cast from the layer’s alpha. Use it on titles, logos, keyed subjects and picture-in-picture.',
  params: [
    color('color', 'Color', '#000000'),
    pct('opacity', 'Opacity', 65),
    ang('angle', 'Direction', -45, { min: -360, max: 360, hint: '−45° casts the shadow down and to the right.' }),
    px('distance', 'Distance', 10, { max: 1000, softMax: 120 }),
    px('softness', 'Softness', 18, { max: 500, softMax: 120 }),
    bool('shadowOnly', 'Shadow only', false),
  ],
  passes: [],
  expand: shadowExpand,
  keywords: ['shadow', 'depth', 'lift', 'title', 'logo', 'cast shadow'],
};
dropShadow.passes = shadowExpand({ softness: 18 });

// ---------------------------------------------------------------------------
// Stroke / Outline: exact Euclidean distance transform of the alpha edge
// (two separable passes, Felzenszwalb style) within a search radius bucket.
// ---------------------------------------------------------------------------
const STROKE_BUCKETS = [4, 8, 16, 32, 64, 128];

function strokePasses(R: number): EffectPass[] {
  const N = R + 1;
  const h = memoPass(`stroke|h|${R}`, () =>
    pass(
      glsl(
        ['taps'],
        `
const int R = ${R};
const float NORM = ${N}.0;
bool insideAt(vec2 uv) { return tapT(uv).a >= 0.5; }
vec4 effect(vec2 uv) {
  bool me = insideAt(uv);
  float dIn = me ? 0.0 : NORM;
  float dOut = me ? NORM : 0.0;
  for (int i = 1; i <= R; i++) {
    float fi = float(i);
    if (fi >= max(dIn, dOut)) break;
    bool a = insideAt(uv + vec2(fi * u_texel.x, 0.0));
    bool b = insideAt(uv - vec2(fi * u_texel.x, 0.0));
    if (a || b) dIn = min(dIn, fi);
    if (!a || !b) dOut = min(dOut, fi);
  }
  return vec4(dIn / NORM, dOut / NORM, 0.0, 1.0);
}`,
      ),
    ),
  );
  const v = memoPass(`stroke|v|${R}`, () =>
    pass(
      glsl(
        [],
        `
const int R = ${R};
const float NORM = ${N}.0;
vec4 effect(vec2 uv) {
  vec2 h0 = src(uv).rg * NORM;
  float bIn = h0.x * h0.x;
  float bOut = h0.y * h0.y;
  for (int k = 1; k <= R; k++) {
    float fk = float(k);
    float k2 = fk * fk;
    if (k2 >= max(bIn, bOut)) break;
    vec2 off = vec2(0.0, fk * u_texel.y);
    vec2 a = src(clamp(uv + off, 0.0, 1.0)).rg * NORM;
    vec2 b = src(clamp(uv - off, 0.0, 1.0)).rg * NORM;
    if (uv.y + off.y > 1.0) a = vec2(NORM, 0.0);
    if (uv.y - off.y < 0.0) b = vec2(NORM, 0.0);
    bIn = min(bIn, k2 + min(a.x * a.x, b.x * b.x));
    bOut = min(bOut, k2 + min(a.y * a.y, b.y * b.y));
  }
  return vec4(sqrt(bIn) / (2.0 * NORM), sqrt(bOut) / (2.0 * NORM), 0.0, 1.0);
}`,
      ),
    ),
  );
  const fin = memoPass(`stroke|f|${R}`, () =>
    pass(
      glsl(
        ['util'],
        `
const float NORM = ${N}.0;
vec4 effect(vec2 uv) {
  vec4 o = texture(u_orig, uv);
  vec2 d = src(uv).rg * 2.0 * NORM;
  bool inside = o.a >= 0.5;
  float s = inside ? 0.5 - d.y : d.x - 0.5;
  if (abs(s) <= 0.55) s = 0.5 - o.a;
  float w = max(u_width, 0.0);
  float aa = max(u_softness, 0.0) + 0.5;
  vec3 sc = u_color.rgb;
  float op = u_opacity * 0.01 * u_color.a;
  if (u_position == 1) {
    float cov = smoothstep(-w - aa, -w + aa, s) * op;
    return vec4(mix(o.rgb, sc * o.a, cov), o.a);
  }
  if (u_position == 2) {
    float cov = (1.0 - smoothstep(w * 0.5 - aa, w * 0.5 + aa, abs(s))) * op;
    return vec4(sc * cov, cov) + o * (1.0 - cov);
  }
  float cov = (1.0 - smoothstep(w - aa, w + aa, s)) * op;
  return o + vec4(sc * cov, cov) * (1.0 - o.a);
}`,
      ),
    ),
  );
  return [h, v, fin];
}

function strokeExpand(p: P): EffectPass[] {
  const need = Math.max(pn(p, 'width'), 0) + Math.max(pn(p, 'softness'), 0) + 2;
  const R = STROKE_BUCKETS.find((b) => b >= need) ?? STROKE_BUCKETS[STROKE_BUCKETS.length - 1];
  return strokePasses(R);
}

const stroke: EffectDef = {
  type: 'stroke',
  name: 'Stroke',
  category: 'Stylize',
  description: 'Outlines the layer’s alpha edge — outside, inside or centered — using an exact distance field, so corners stay round and widths are true.',
  params: [
    px('width', 'Width', 4, { max: 120, softMax: 40 }),
    color('color', 'Color', '#ffffff'),
    pct('opacity', 'Opacity', 100),
    choice('position', 'Position', 0, ['Outside', 'Inside', 'Center']),
    px('softness', 'Softness', 0, { max: 20, softMax: 8 }),
  ],
  passes: [],
  expand: strokeExpand,
  keywords: ['outline', 'border', 'edge', 'contour', 'title', 'sticker'],
};
stroke.passes = strokeExpand({ width: 4, softness: 0 });

export const STYLIZE_EFFECTS: EffectDef[] = [
  glow,
  bloom,
  halation,
  vignette,
  filmGrain,
  chromaticAberration,
  pixelate,
  halftone,
  edgeDetect,
  emboss,
  scanlines,
  vhs,
  glitch,
  letterbox,
  dropShadow,
  stroke,
];

/** Blend mode labels re-exported for generators. */
export { BLEND_MODES };
