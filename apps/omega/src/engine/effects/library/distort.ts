// Distort effects: every one is an inverse mapping (output pixel → source
// position), computed in pixel space so shapes stay round on any aspect ratio.
// Samples that fall outside the layer are transparent unless noted.
import type { EffectDef } from '../types';
import { glsl, pass } from './glsl';
import { ang, bool, choice, num, pct, point, px, spct } from './params';

const mirror: EffectDef = {
  type: 'mirror',
  name: 'Mirror',
  category: 'Distort',
  description: 'Reflects one side of the picture onto the other across a line at any angle, or across both axes for a four-way mirror.',
  params: [
    point('center', 'Reflection center', '0.5,0.5'),
    ang('angle', 'Reflection angle', 0, { min: -360, max: 360, hint: '0° keeps the left side and mirrors it onto the right.' }),
    bool('both', 'Mirror both axes', false),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'taps'],
        `
vec4 effect(vec2 uv) {
  vec2 c = pt(u_center) * u_resolution;
  vec2 p = uv * u_resolution - c;
  float a = radians(u_angle);
  vec2 n = vec2(cos(a), sin(a));
  float d = dot(p, n);
  if (d > 0.0) p -= 2.0 * d * n;
  if (u_both > 0.5) {
    vec2 m = vec2(-n.y, n.x);
    float e = dot(p, m);
    if (e > 0.0) p -= 2.0 * e * m;
  }
  return tapC((p + c) * u_texel);
}`,
      ),
    ),
  ],
  keywords: ['reflect', 'flip', 'symmetry', 'twin'],
};

const kaleidoscope: EffectDef = {
  type: 'kaleidoscope',
  name: 'Kaleidoscope',
  category: 'Distort',
  description: 'Folds the picture into mirrored wedges around a center point.',
  params: [
    num('segments', 'Segments', 6, { min: 2, max: 48, softMax: 24, step: 1 }),
    ang('rotation', 'Rotation', 0, { min: -3600, max: 3600, softMin: -360, softMax: 360 }),
    pct('zoom', 'Zoom', 100, { min: 10, max: 1000, softMax: 400 }),
    point('center', 'Center', '0.5,0.5'),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'taps'],
        `
vec4 effect(vec2 uv) {
  vec2 c = pt(u_center) * u_resolution;
  vec2 p = uv * u_resolution - c;
  float r = length(p) / max(u_zoom * 0.01, 0.01);
  float n = max(floor(u_segments + 0.5), 2.0);
  float wedge = 6.2831853 / n;
  float rot = radians(u_rotation);
  float th = atan(p.y, p.x) - rot;
  th = mod(th, wedge);
  if (th > wedge * 0.5) th = wedge - th;
  vec2 q = (c + r * vec2(cos(th + rot), sin(th + rot))) * u_texel;
  q = 1.0 - abs(1.0 - mod(q, 2.0));
  return tapC(q);
}`,
      ),
    ),
  ],
  keywords: ['mandala', 'symmetry', 'prism', 'pattern', 'trippy'],
};

const lensDistortion: EffectDef = {
  type: 'lensDistortion',
  name: 'Lens Distortion',
  category: 'Distort',
  description: 'Barrel or pincushion distortion with an optional chromatic fringe. Add a fisheye look, or match a lens when compositing.',
  params: [
    spct('curvature', 'Curvature', 30, { unit: '', step: 1, hint: 'Positive bulges outward (barrel), negative pinches (pincushion).' }),
    bool('fill', 'Scale to fill', true, { hint: 'Zooms so the corners stay filled.' }),
    pct('fringe', 'Chromatic fringe', 0, { max: 200, softMax: 100 }),
    point('center', 'Optical center', '0.5,0.5'),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'taps', 'spectral'],
        `
vec2 distortAt(vec2 q, float k) {
  float r2 = dot(q, q);
  float f = 1.0 + k * r2 + 0.25 * k * r2 * r2;
  if (u_fill > 0.5 && k > 0.0) f /= 1.0 + k * 1.0 + 0.25 * k;
  return q * f;
}
vec4 effect(vec2 uv) {
  vec2 c = pt(u_center);
  float hd = 0.5 * length(u_resolution);
  vec2 q = (uv - c) * u_resolution / hd;
  float k = u_curvature * 0.01 * 0.6;
  float fr = u_fringe * 0.01 * 0.08;
  if (fr <= 0.0) return tapT(c + distortAt(q, k) * hd * u_texel);
  vec3 acc = vec3(0.0);
  vec3 ws = vec3(0.0);
  float aa = 0.0;
  for (int i = 0; i < 7; i++) {
    float t = float(i) / 6.0;
    vec3 w = spectralW(t);
    vec2 qq = distortAt(q, k) * (1.0 + (t - 0.5) * fr);
    vec4 s = tapT(c + qq * hd * u_texel);
    acc += s.rgb * w;
    ws += w;
    aa += s.a;
  }
  return vec4(acc / ws, aa / 7.0);
}`,
      ),
    ),
  ],
  keywords: ['fisheye', 'barrel', 'pincushion', 'gopro', 'lens', 'warp'],
};

const waveWarp: EffectDef = {
  type: 'waveWarp',
  name: 'Wave Warp',
  category: 'Distort',
  description: 'Ripples the picture with traveling waves — sine, triangle, square or smooth noise — that animate on their own.',
  params: [
    choice('wave', 'Wave type', 0, ['Sine', 'Triangle', 'Square', 'Smooth noise']),
    px('height', 'Wave height', 12, { max: 500, softMax: 80 }),
    px('width', 'Wave width', 140, { min: 2, max: 4000, softMax: 800 }),
    ang('direction', 'Direction', 0, { min: -360, max: 360, hint: 'Direction the waves travel; pixels move across it.' }),
    num('speed', 'Wave speed', 1, { min: -50, max: 50, softMin: -5, softMax: 5, step: 0.05, unit: 'Hz' }),
    ang('phase', 'Phase', 0, { min: -3600, max: 3600, softMin: -360, softMax: 360 }),
    choice('pinning', 'Pinning', 0, ['None', 'All edges', 'Left and right', 'Top and bottom']),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'taps', 'noise'],
        `
float waveAt(float s, float lat) {
  if (u_wave == 1) return 1.0 - 4.0 * abs(fract(s + 0.25) - 0.5);
  if (u_wave == 2) return smoothstep(-0.03, 0.03, sin(6.2831853 * s)) * 2.0 - 1.0;
  if (u_wave == 3) return gnoise(vec2(s, lat * 0.35)) * 1.2;
  return sin(6.2831853 * s);
}
vec4 effect(vec2 uv) {
  vec2 p = uv * u_resolution;
  float a = radians(u_direction);
  vec2 d = vec2(cos(a), sin(a));
  vec2 n = vec2(-d.y, d.x);
  float wl = max(u_width, 1.0);
  float s = dot(p, d) / wl - u_time * u_speed + u_phase / 360.0;
  float w = waveAt(s, dot(p, n) / wl);
  float pin = 1.0;
  vec2 e = min(uv, 1.0 - uv) * u_resolution / max(min(u_resolution.x, u_resolution.y) * 0.12, 1.0);
  if (u_pinning == 1) pin = smoothstep(0.0, 1.0, min(e.x, e.y));
  else if (u_pinning == 2) pin = smoothstep(0.0, 1.0, e.x);
  else if (u_pinning == 3) pin = smoothstep(0.0, 1.0, e.y);
  return tapT((p - n * w * u_height * pin) * u_texel);
}`,
      ),
    ),
  ],
  keywords: ['ripple', 'wave', 'flag', 'water', 'wobble', 'distort', 'heat'],
};

const twirl: EffectDef = {
  type: 'twirl',
  name: 'Twirl',
  category: 'Distort',
  description: 'Twists the picture around a center point; strongest in the middle, fading out at the radius.',
  params: [
    ang('angle', 'Angle', 120, { min: -3600, max: 3600, softMin: -720, softMax: 720 }),
    pct('radius', 'Radius', 45, { min: 1, max: 300, softMax: 120, hint: 'As a percentage of the smaller frame dimension.' }),
    point('center', 'Center', '0.5,0.5'),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'taps'],
        `
vec4 effect(vec2 uv) {
  vec2 c = pt(u_center) * u_resolution;
  vec2 p = uv * u_resolution - c;
  float R = max(u_radius * 0.01 * min(u_resolution.x, u_resolution.y), 1.0);
  float t = length(p) / R;
  if (t >= 1.0) return tapT(uv);
  float f = 1.0 - t;
  float th = -radians(u_angle) * f * f;
  return tapT((c + rot2(p, th)) * u_texel);
}`,
      ),
    ),
  ],
  keywords: ['swirl', 'spiral', 'vortex', 'twist', 'whirlpool'],
};

const bulge: EffectDef = {
  type: 'bulge',
  name: 'Bulge',
  category: 'Distort',
  description: 'Magnifies (bulge) or shrinks (pinch) a round area with a smooth edge.',
  params: [
    spct('amount', 'Amount', 50, { unit: '', step: 1, hint: 'Positive bulges, negative pinches.' }),
    pct('radius', 'Radius', 35, { min: 1, max: 300, softMax: 120, hint: 'As a percentage of the smaller frame dimension.' }),
    point('center', 'Center', '0.5,0.5'),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'taps'],
        `
vec4 effect(vec2 uv) {
  vec2 c = pt(u_center) * u_resolution;
  vec2 p = uv * u_resolution - c;
  float R = max(u_radius * 0.01 * min(u_resolution.x, u_resolution.y), 1.0);
  float t = length(p) / R;
  if (t >= 1.0) return tapT(uv);
  float a = clamp(u_amount * 0.01, -1.0, 0.95);
  float f = 1.0 - a * (1.0 - t) * (1.0 - t);
  return tapT((c + p * f) * u_texel);
}`,
      ),
    ),
  ],
  keywords: ['pinch', 'spherize', 'magnify', 'bloat', 'fisheye', 'punch'],
};

const offsetTile: EffectDef = {
  type: 'offsetTile',
  name: 'Offset & Tile',
  category: 'Distort',
  description: 'Shifts the picture with wrap-around, and repeats it as tiles — plain or mirrored for seamless patterns.',
  params: [
    num('x', 'Offset X', 0, { min: -1000, max: 1000, softMin: -100, softMax: 100, step: 0.1, unit: '%' }),
    num('y', 'Offset Y', 0, { min: -1000, max: 1000, softMin: -100, softMax: 100, step: 0.1, unit: '%' }),
    num('tiles', 'Tiles', 2, { min: 1, max: 32, softMax: 8, step: 1, hint: 'Copies across each axis.' }),
    bool('mirrorTiles', 'Mirror tiles', false),
    pct('blend', 'Blend with original', 0),
  ],
  passes: [
    pass(
      glsl(
        ['taps'],
        `
vec4 effect(vec2 uv) {
  vec2 q = uv * max(u_tiles, 1.0) - vec2(u_x, -u_y) * 0.01;
  if (u_mirrorTiles > 0.5) q = 1.0 - abs(1.0 - mod(q, 2.0));
  else q = fract(q);
  return mix(tapC(q), src(uv), u_blend * 0.01);
}`,
      ),
    ),
  ],
  keywords: ['wrap', 'shift', 'repeat', 'tile', 'pattern', 'scroll', 'seamless'],
};

const cornerPin: EffectDef = {
  type: 'cornerPin',
  name: 'Corner Pin',
  category: 'Distort',
  description: 'Pins the four corners of the layer anywhere with a true perspective (homography) warp — for screen replacements and signs.',
  params: [
    point('topLeft', 'Top left', '0,0'),
    point('topRight', 'Top right', '1,0'),
    point('bottomRight', 'Bottom right', '1,1'),
    point('bottomLeft', 'Bottom left', '0,1'),
  ],
  passes: [
    pass(
      glsl(
        ['taps'],
        `
vec4 effect(vec2 uv) {
  // image coordinates (y down) in pixels
  vec2 S = u_resolution;
  vec2 P = vec2(uv.x, 1.0 - uv.y) * S;
  vec2 p0 = u_topLeft * S;
  vec2 p1 = u_topRight * S;
  vec2 p2 = u_bottomRight * S;
  vec2 p3 = u_bottomLeft * S;
  float dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  float dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  float den = dx1 * dy2 - dx2 * dy1;
  float g = 0.0;
  float h = 0.0;
  if (abs(den) > 1e-6) {
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  float a = p1.x - p0.x + g * p1.x;
  float b = p3.x - p0.x + h * p3.x;
  float c = p0.x;
  float d = p1.y - p0.y + g * p1.y;
  float e = p3.y - p0.y + h * p3.y;
  float f = p0.y;
  float sx = (e - f * h) * P.x + (c * h - b) * P.y + (b * f - c * e);
  float sy = (f * g - d) * P.x + (a - c * g) * P.y + (c * d - a * f);
  float sw = (d * h - e * g) * P.x + (b * g - a * h) * P.y + (a * e - b * d);
  float swS = abs(sw) < 1e-9 ? 1e-9 : sw;
  vec2 st = vec2(sx, sy) / swS;
  vec2 fw = max(fwidth(st), vec2(1e-6));
  vec2 edge = clamp(min(st, 1.0 - st) / fw + 0.5, 0.0, 1.0);
  float cov = edge.x * edge.y;
  if (cov <= 0.0) return vec4(0.0);
  return tapC(vec2(st.x, 1.0 - st.y)) * cov;
}`,
      ),
    ),
  ],
  keywords: ['perspective', 'four corner', 'screen replacement', 'distort', 'homography', 'warp'],
};

export const DISTORT_EFFECTS: EffectDef[] = [mirror, kaleidoscope, lensDistortion, waveWarp, twirl, bulge, offsetTile, cornerPin];
