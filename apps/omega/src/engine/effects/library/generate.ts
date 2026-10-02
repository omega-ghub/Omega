// Generators: draw gradients, noise and patterns over the layer with a blend
// mode and opacity. Blending happens on perceptual values (how designers
// expect Multiply/Screen/Overlay to look), inside the layer's alpha.
import type { EffectDef } from '../types';
import { BLEND_MODES, glsl, pass } from './glsl';
import { ang, choice, color, num, pct, point, px, spct } from './params';

/** Composites a straight-alpha perceptual color `g` (with alpha ga) over the source. */
const OVER = /* glsl */ `
vec4 overLayer(vec4 s, vec3 g, float ga, vec2 uv) {
  vec3 b = toPerc(unpremul(s));
  float dither = (hash12(uv * u_resolution + 0.37) - 0.5) / 255.0;
  vec3 r = blendMode(u_blend, b, g) + dither;
  float k = clamp(ga * u_opacity * 0.01, 0.0, 1.0);
  return premul(fromPerc(mix(b, r, k)), s.a);
}
`;

const gradientOverlay: EffectDef = {
  type: 'gradientOverlay',
  name: 'Gradient Overlay',
  category: 'Generate',
  description: 'A linear or radial two-color gradient blended over the layer — darken the bottom for titles, add a sky tint, or build a ramp.',
  params: [
    choice('shape', 'Type', 0, ['Linear', 'Radial']),
    point('start', 'Start', '0.5,0.35'),
    color('startColor', 'Start color', '#00000000'),
    point('end', 'End', '0.5,1'),
    color('endColor', 'End color', '#000000d9'),
    choice('blend', 'Blend mode', 0, BLEND_MODES),
    pct('opacity', 'Opacity', 100),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'perc', 'blend'],
        `${OVER}
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 a = pt(u_start) * asp;
  vec2 b = pt(u_end) * asp;
  vec2 p = uv * asp;
  float t;
  if (u_shape == 1) t = length(p - a) / max(length(b - a), 1e-4);
  else { vec2 ab = b - a; t = dot(p - a, ab) / max(dot(ab, ab), 1e-8); }
  t = clamp(t, 0.0, 1.0);
  vec4 c0 = vec4(toPerc(u_startColor.rgb) * u_startColor.a, u_startColor.a);
  vec4 c1 = vec4(toPerc(u_endColor.rgb) * u_endColor.a, u_endColor.a);
  vec4 g = mix(c0, c1, t);
  return overLayer(s, g.a > 1e-5 ? g.rgb / g.a : vec3(0.0), g.a, uv);
}`,
      ),
    ),
  ],
  keywords: ['ramp', 'gradient', 'fade', 'darken', 'sky', 'vignette', 'overlay'],
};

const noise: EffectDef = {
  type: 'fractalNoise',
  name: 'Noise',
  category: 'Generate',
  description: 'Evolving fractal noise — basic, turbulent or ridged — for textures, smoke, clouds, backgrounds and organic overlays.',
  params: [
    choice('kind', 'Noise type', 0, ['Basic', 'Turbulent', 'Ridged']),
    px('scale', 'Scale', 220, { min: 2, max: 5000, softMax: 1000 }),
    num('complexity', 'Complexity', 5, { min: 1, max: 10, step: 1, hint: 'Number of octaves of detail.' }),
    pct('contrast', 'Contrast', 100, { max: 500, softMax: 300 }),
    spct('brightness', 'Brightness', 0, { unit: '', step: 1 }),
    num('evolution', 'Evolution speed', 0.2, { min: -10, max: 10, softMin: -2, softMax: 2, step: 0.01, unit: 'x' }),
    ang('angle', 'Rotation', 0, { min: -360, max: 360 }),
    choice('colorMode', 'Color', 0, ['Monochrome', 'Color']),
    choice('blend', 'Blend mode', 0, BLEND_MODES),
    pct('opacity', 'Opacity', 100),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'perc', 'blend', 'noise'],
        `${OVER}
float field(vec2 p, float t, float o) {
  int oct = int(clamp(floor(u_complexity + 0.5), 1.0, 10.0));
  vec2 w = vec2(fbm(p + vec2(t, o), 2), fbm(p - vec2(o, t) + 5.2, 2));
  float n = fbm(p + 0.7 * w + o, oct);
  if (u_kind == 1) n = abs(n) * 2.0 - 1.0;
  else if (u_kind == 2) { n = 1.0 - abs(n) * 2.0; n = n * n * 2.0 - 1.0; }
  return n;
}
float tone(float n) {
  float v = 0.5 + n * 0.5 * u_contrast * 0.01 * 1.6;
  return clamp(v + u_brightness * 0.01, 0.0, 1.0);
}
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  vec2 p = rot2((uv - 0.5) * u_resolution, -radians(u_angle)) / max(u_scale, 1.0);
  float t = u_time * u_evolution * 0.5 + u_seed * 17.0;
  vec3 g;
  if (u_colorMode == 1) g = vec3(tone(field(p, t, 0.0)), tone(field(p, t, 11.3)), tone(field(p, t, 23.7)));
  else g = vec3(tone(field(p, t, 0.0)));
  return overLayer(s, g, 1.0, uv);
}`,
      ),
    ),
  ],
  keywords: ['fractal noise', 'clouds', 'smoke', 'texture', 'perlin', 'turbulence', 'procedural'],
};

const checkerboard: EffectDef = {
  type: 'checkerboard',
  name: 'Checkerboard',
  category: 'Generate',
  description: 'An antialiased checkerboard pattern of any size, color and angle.',
  params: [
    px('size', 'Square size', 64, { min: 2, max: 2000, softMax: 400 }),
    color('colorA', 'Color A', '#ffffff'),
    color('colorB', 'Color B', '#000000'),
    point('anchor', 'Anchor', '0.5,0.5'),
    ang('angle', 'Rotation', 0, { min: -360, max: 360 }),
    choice('blend', 'Blend mode', 0, BLEND_MODES),
    pct('opacity', 'Opacity', 100),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'perc', 'blend'],
        `${OVER}
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float sz = max(u_size, 1.0);
  vec2 p = rot2((uv - pt(u_anchor)) * u_resolution, -radians(u_angle)) / sz;
  vec2 w = vec2(1.0 / sz);
  vec2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
  float k = 0.5 - 0.5 * i.x * i.y;
  vec3 a = toPerc(u_colorA.rgb);
  vec3 b = toPerc(u_colorB.rgb);
  float ga = mix(u_colorB.a, u_colorA.a, k);
  return overLayer(s, mix(b, a, k), ga, uv);
}`,
      ),
    ),
  ],
  keywords: ['checker', 'chess', 'pattern', 'grid', 'transparency'],
};

const grid: EffectDef = {
  type: 'grid',
  name: 'Grid',
  category: 'Generate',
  description: 'Crisp antialiased grid lines — for layout guides, tech overlays and graphic backgrounds.',
  params: [
    px('spacing', 'Spacing', 80, { min: 4, max: 2000, softMax: 400 }),
    num('ratio', 'Cell aspect', 1, { min: 0.1, max: 10, softMin: 0.25, softMax: 4, step: 0.01, unit: 'x', hint: 'Cell width ÷ height.' }),
    px('width', 'Line width', 2, { min: 0.25, max: 100, softMax: 12 }),
    color('color', 'Color', '#ffffff'),
    point('anchor', 'Anchor', '0.5,0.5'),
    ang('angle', 'Rotation', 0, { min: -360, max: 360 }),
    choice('blend', 'Blend mode', 0, BLEND_MODES),
    pct('opacity', 'Opacity', 50),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'perc', 'blend'],
        `${OVER}
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  vec2 cell = vec2(max(u_spacing, 1.0) * max(u_ratio, 0.05), max(u_spacing, 1.0));
  vec2 p = rot2((uv - pt(u_anchor)) * u_resolution, -radians(u_angle));
  vec2 d = abs(fract(p / cell + 0.5) - 0.5) * cell;
  float hw = max(u_width, 0.25) * 0.5;
  float cov = max(1.0 - smoothstep(hw - 0.5, hw + 0.5, d.x), 1.0 - smoothstep(hw - 0.5, hw + 0.5, d.y));
  cov *= min(u_width, 1.0);
  return overLayer(s, toPerc(u_color.rgb), cov * u_color.a, uv);
}`,
      ),
    ),
  ],
  keywords: ['lines', 'guides', 'graph paper', 'blueprint', 'layout', 'tech'],
};

export const GENERATE_EFFECTS: EffectDef[] = [gradientOverlay, noise, checkerboard, grid];
