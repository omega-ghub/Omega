// Blur & Sharpen. All blurs run on premultiplied scene-linear light, which is
// what makes bright highlights bloom realistically instead of turning grey.
import type { EffectDef, EffectPass } from '../types';
import { COPY_PASS, gaussChain, glsl, memoPass, pass, pn } from './glsl';
import { ang, bool, choice, num, pct, point, px } from './params';

type P = Record<string, number | boolean | string>;

// ---------------------------------------------------------------------------
// Gaussian Blur
// ---------------------------------------------------------------------------
const gaussTap = /* glsl */ `vec4 tapE(vec2 uv) { return u_repeatEdges > 0.5 ? tapC(uv) : tapT(uv); }`;

function gaussianExpand(p: P): EffectPass[] {
  const sigma = pn(p, 'radius') * 0.5;
  const dims = pn(p, 'dims');
  const dirs: [number, number][] = dims === 1 ? [[1, 0]] : dims === 2 ? [[0, 1]] : [[1, 0], [0, 1]];
  const out = gaussChain({ id: 'gaussianBlur', sigma: 'u_radius * 0.5', tap: 'tapE', helpers: gaussTap }, sigma, dirs);
  return out.length ? out : [COPY_PASS];
}

const gaussianBlur: EffectDef = {
  type: 'gaussianBlur',
  name: 'Gaussian Blur',
  category: 'Blur & Sharpen',
  description: 'Smooth, high-quality blur of any size. Separable and multi-level, so even very large radii stay fast and clean.',
  params: [
    px('radius', 'Blurriness', 12, { max: 1500, softMax: 200, hint: 'Blur radius in layer pixels (about two standard deviations).' }),
    choice('dims', 'Dimensions', 0, ['Horizontal and vertical', 'Horizontal', 'Vertical']),
    bool('repeatEdges', 'Repeat edge pixels', true, { hint: 'Extend the border pixels so edges do not darken.' }),
  ],
  passes: [],
  expand: gaussianExpand,
  keywords: ['soften', 'defocus', 'smooth', 'gauss', 'fast blur', 'box blur'],
};
gaussianBlur.passes = gaussianExpand({ radius: 12, dims: 0, repeatEdges: true });

// ---------------------------------------------------------------------------
// Two-stage line/arc/zoom blurs: stage 0 takes N taps across the full span,
// stage 1 takes N taps across one stage-0 step, so together they act like N²
// evenly spaced taps (a smooth box filter with no stepping).
// ---------------------------------------------------------------------------
const N_TAPS = 24;

function directionalPass(stage: number): EffectPass {
  return memoPass(`directionalBlur|${stage}`, () =>
    pass(
      glsl(
        ['taps'],
        `
vec4 effect(vec2 uv) {
  float len = max(u_length, 0.0);
  float span = ${stage === 0 ? 'len' : `len / ${N_TAPS}.0`};
  if (span < 0.35) return tapC(uv);
  float a = radians(u_angle);
  vec2 dir = vec2(cos(a), sin(a)) * u_texel;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${N_TAPS}; i++) {
    float t = (float(i) + 0.5) / ${N_TAPS}.0 - 0.5;
    acc += tapC(uv + dir * (t * span));
  }
  return acc / ${N_TAPS}.0;
}`,
      ),
    ),
  );
}

const directionalBlur: EffectDef = {
  type: 'directionalBlur',
  name: 'Directional Blur',
  category: 'Blur & Sharpen',
  description: 'Streaks the image along one direction, like a camera or subject moving fast during the exposure.',
  params: [
    ang('angle', 'Direction', 0, { min: -360, max: 360, hint: '0° is horizontal; positive turns counter-clockwise.' }),
    px('length', 'Blur length', 40, { max: 2000, softMax: 400, hint: 'Total length of the streak in layer pixels.' }),
  ],
  passes: [directionalPass(0), directionalPass(1)],
  keywords: ['motion blur', 'streak', 'linear blur', 'speed'],
};

function radialPass(stage: number): EffectPass {
  return memoPass(`radialBlur|${stage}`, () =>
    pass(
      glsl(
        ['taps', 'util'],
        `
vec4 effect(vec2 uv) {
  float span = radians(max(u_amount, 0.0))${stage === 0 ? '' : ` / ${N_TAPS}.0`};
  vec2 c = pt(u_center) * u_resolution;
  vec2 p = uv * u_resolution - c;
  if (span * length(p) < 0.35) return tapC(uv);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${N_TAPS}; i++) {
    float t = (float(i) + 0.5) / ${N_TAPS}.0 - 0.5;
    acc += tapC((c + rot2(p, t * span)) * u_texel);
  }
  return acc / ${N_TAPS}.0;
}`,
      ),
    ),
  );
}

const radialBlur: EffectDef = {
  type: 'radialBlur',
  name: 'Radial Blur',
  category: 'Blur & Sharpen',
  description: 'Spins the image around a center point, as if the camera rotated during the exposure.',
  params: [
    ang('amount', 'Spin', 8, { min: 0, max: 360, softMax: 90, hint: 'Rotation covered by the blur, in degrees.' }),
    point('center', 'Center', '0.5,0.5'),
  ],
  passes: [radialPass(0), radialPass(1)],
  keywords: ['spin blur', 'rotate', 'circular', 'swirl'],
};

function zoomPass(stage: number): EffectPass {
  return memoPass(`zoomBlur|${stage}`, () =>
    pass(
      glsl(
        ['taps', 'util'],
        `
vec4 effect(vec2 uv) {
  float amt = clamp(u_amount * 0.01, 0.0, 0.98);
  float k = -log(1.0 - amt)${stage === 0 ? '' : ` / ${N_TAPS}.0`};
  vec2 c = pt(u_center);
  vec2 d = (uv - c) * u_resolution;
  if (k * length(d) < 0.35) return tapC(uv);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${N_TAPS}; i++) {
    float t = (float(i) + 0.5) / ${N_TAPS}.0 - 0.5;
    acc += tapC(c + (uv - c) * exp(t * k));
  }
  return acc / ${N_TAPS}.0;
}`,
      ),
    ),
  );
}

const zoomBlur: EffectDef = {
  type: 'zoomBlur',
  name: 'Zoom Blur',
  category: 'Blur & Sharpen',
  description: 'Streaks rays outward from a center point, like zooming the lens during the exposure.',
  params: [pct('amount', 'Amount', 20, { max: 95, softMax: 60, hint: 'How far the zoom travels during the exposure.' }), point('center', 'Center', '0.5,0.5')],
  passes: [zoomPass(0), zoomPass(1)],
  keywords: ['radial zoom', 'warp speed', 'rays', 'punch in'],
};

// ---------------------------------------------------------------------------
// Tilt-Shift: per-pixel σ (zero inside the focus band, ramping to max blur).
// ---------------------------------------------------------------------------
const tiltHelpers = /* glsl */ `
float tsMask(vec2 uv) {
  vec2 p = (uv - pt(u_center)) * u_resolution / u_resolution.y;
  float d;
  if (u_shape == 1) d = length(p);
  else {
    float a = radians(u_angle);
    d = abs(dot(p, vec2(-sin(a), cos(a))));
  }
  float hw = u_focus * 0.005;
  float tr = max(u_transition * 0.01, 1e-4);
  return smoothstep(0.0, 1.0, (d - hw) / tr);
}
`;

function tiltExpand(p: P): EffectPass[] {
  const chain = gaussChain({ id: 'tiltShift', sigma: 'tsMask(uv) * u_blur * 0.5', helpers: tiltHelpers, uses: ['util'] }, pn(p, 'blur') * 0.5);
  return [...chain, tiltFinal];
}

const tiltFinal = pass(
  glsl(
    ['util'],
    `${tiltHelpers}
vec4 effect(vec2 uv) {
  vec4 c = src(uv);
  vec3 col = unpremul(c);
  float y = luma(col);
  col = max(mix(vec3(y), col, 1.0 + u_saturation * 0.01), 0.0);
  vec4 o = premul(col, c.a);
  if (u_showFocus > 0.5) {
    float m = 1.0 - tsMask(uv);
    o.rgb = mix(o.rgb, vec3(0.85, 0.12, 0.2) * o.a, 0.45 * m);
  }
  return o;
}`,
  ),
);

const tiltShift: EffectDef = {
  type: 'tiltShift',
  name: 'Tilt-Shift',
  category: 'Blur & Sharpen',
  description: 'Keeps a band (or circle) in focus and blurs progressively away from it, for the miniature look or to steer attention.',
  params: [
    point('center', 'Focus center', '0.5,0.55'),
    ang('angle', 'Angle', 0, { min: -180, max: 180, hint: 'Rotation of the focus band.' }),
    choice('shape', 'Shape', 0, ['Band', 'Radial']),
    pct('focus', 'Focus size', 18, { max: 200, softMax: 100, hint: 'Size of the sharp area, as a percentage of the frame height.' }),
    pct('transition', 'Transition', 30, { max: 200, softMax: 100, hint: 'Distance over which the blur ramps up to its maximum.' }),
    px('blur', 'Blur', 24, { max: 400, softMax: 120 }),
    num('saturation', 'Saturation', 15, { min: -100, max: 100, unit: '%', step: 1, hint: 'Extra saturation sells the miniature look.' }),
    bool('showFocus', 'Show focus area', false, { hint: 'Tints the sharp area red while you adjust it.' }),
  ],
  passes: [],
  expand: tiltExpand,
  keywords: ['miniature', 'diorama', 'focus', 'depth of field', 'bokeh band'],
};
tiltShift.passes = tiltExpand({ blur: 24 });

// ---------------------------------------------------------------------------
// Sharpen (unsharp mask on perceptual luma, so it never adds color fringes)
// ---------------------------------------------------------------------------
const sharpenFinal = pass(
  glsl(
    ['perc', 'util'],
    `
vec4 effect(vec2 uv) {
  vec4 o = texture(u_orig, uv);
  vec4 b = src(uv);
  vec3 oc = toPerc(unpremul(o));
  vec3 bc = toPerc(unpremul(b));
  float d = luma(oc) - luma(bc);
  float th = u_threshold * 0.01;
  float g = th <= 0.0 ? 1.0 : smoothstep(th * 0.5, th * 1.5, abs(d));
  vec3 r = oc + d * g * u_amount * 0.01;
  return premul(fromPerc(r), o.a);
}`,
  ),
);

function sharpenExpand(p: P): EffectPass[] {
  return [...gaussChain({ id: 'sharpen', sigma: 'u_radius' }, pn(p, 'radius')), sharpenFinal];
}

const sharpen: EffectDef = {
  type: 'sharpen',
  name: 'Sharpen',
  category: 'Blur & Sharpen',
  description: 'Unsharp mask: boosts local contrast at edges. Works on luminance only, with a threshold that protects smooth areas and noise.',
  params: [
    pct('amount', 'Amount', 60, { max: 500, softMax: 200 }),
    px('radius', 'Radius', 1.2, { min: 0.1, max: 100, softMax: 10, hint: 'Size of the edges being sharpened.' }),
    pct('threshold', 'Threshold', 1.5, { max: 50, softMax: 20, hint: 'Differences smaller than this are left alone (keeps skin and noise smooth).' }),
  ],
  passes: [],
  expand: sharpenExpand,
  keywords: ['unsharp mask', 'usm', 'detail', 'crisp', 'clarity'],
};
sharpen.passes = sharpenExpand({ radius: 1.2 });

// ---------------------------------------------------------------------------
// Lens Blur: bokeh-shaped disc (circle / polygon) in linear light.
// ---------------------------------------------------------------------------
const lensHelpers = /* glsl */ `
float bladeScale(float th) {
  if (u_shape == 0) return 1.0;
  float n = u_shape == 1 ? 6.0 : 8.0;
  float seg = 6.2831853 / n;
  float a = mod(th - radians(u_rotation), seg) - 0.5 * seg;
  return cos(0.5 * seg) / cos(a);
}
vec4 boosted(vec2 uv) {
  vec4 c = tapC(uv);
  float b = u_boost * 0.01;
  if (b <= 0.0) return c;
  float th = decP(u_threshold * 0.01);
  float m = maxc(c.rgb) / max(c.a, 1e-4);
  return c * (1.0 + 6.0 * b * smoothstep(th, th * 1.25 + 0.02, m));
}
`;

const lensA = pass(
  glsl(
    ['taps', 'util', 'perc'],
    `${lensHelpers}
vec4 effect(vec2 uv) {
  float R = max(u_radius, 0.0);
  if (R < 0.5) return boosted(uv);
  vec4 acc = vec4(0.0);
  const int N = 72;
  for (int i = 0; i < N; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / float(N));
    float th = fi * 2.3999632;
    vec2 o = vec2(cos(th), sin(th)) * r * R * bladeScale(th);
    acc += boosted(uv + o * u_texel);
  }
  return acc / float(N);
}`,
  ),
);

const lensB = pass(
  glsl(
    ['taps'],
    `
vec4 effect(vec2 uv) {
  float R = max(u_radius, 0.0) * 0.16;
  if (R < 0.5) return tapC(uv);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 12; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / 12.0);
    float th = fi * 2.3999632;
    acc += tapC(uv + vec2(cos(th), sin(th)) * r * R * u_texel);
  }
  return acc / 12.0;
}`,
  ),
);

const lensBlur: EffectDef = {
  type: 'lensBlur',
  name: 'Lens Blur',
  category: 'Blur & Sharpen',
  description: 'Optical defocus with a real aperture shape. Bright highlights bloom into crisp bokeh discs instead of smearing.',
  params: [
    px('radius', 'Radius', 10, { max: 250, softMax: 60, hint: 'Radius of the bokeh disc in layer pixels.' }),
    choice('shape', 'Iris', 0, ['Circle', 'Hexagon', 'Octagon']),
    ang('rotation', 'Iris rotation', 0, { min: -180, max: 180 }),
    pct('boost', 'Highlight boost', 20, { hint: 'Brightens near-white highlights so they read as bright bokeh, like real light sources.' }),
    pct('threshold', 'Boost threshold', 95, { max: 200, softMax: 100, hint: 'Brightness above which highlights are boosted.' }),
  ],
  passes: [lensA, lensB],
  keywords: ['bokeh', 'defocus', 'depth of field', 'camera blur', 'out of focus'],
};

// ---------------------------------------------------------------------------
// Smart Denoise: edge-preserving bilateral filter in Y'CbCr, with separate
// strengths for luma and chroma (chroma noise can go hard without losing detail).
// ---------------------------------------------------------------------------
const denoise = pass(
  glsl(
    ['taps', 'perc', 'ycc', 'util'],
    `
vec4 effect(vec2 uv) {
  vec4 c0 = tapC(uv);
  vec3 p0 = rgb2ycc(toPerc(unpremul(c0)));
  float R = max(u_radius, 0.5);
  float stp = R / 3.0;
  float ss = -0.5 / (0.45 * R * 0.45 * R + 1e-4);
  float sr = max(u_threshold * 0.01, 1e-3);
  float kl = -0.5 / (sr * sr);
  float kc = -0.5 / (4.0 * sr * sr);
  vec3 accL = vec3(0.0);
  float wL = 0.0;
  vec2 accC = vec2(0.0);
  float wC = 0.0;
  for (int j = -3; j <= 3; j++) {
    for (int i = -3; i <= 3; i++) {
      vec2 o = vec2(float(i), float(j)) * stp;
      vec4 c = tapC(uv + o * u_texel);
      vec3 p = rgb2ycc(toPerc(unpremul(c)));
      float ds = dot(o, o) * ss;
      vec3 d = p - p0;
      float dy = d.x * d.x;
      float dc = dot(d.yz, d.yz);
      float w1 = exp(ds + (dy + dc) * kl);
      float w2 = exp(ds + (dy * 0.5 + dc) * kc);
      accL += p * w1;
      wL += w1;
      accC += p.yz * w2;
      wC += w2;
    }
  }
  vec3 fl = accL / max(wL, 1e-6);
  vec2 fc = accC / max(wC, 1e-6);
  vec3 o = vec3(mix(p0.x, fl.x, u_luma * 0.01), mix(p0.yz, fc, u_chroma * 0.01));
  return premul(fromPerc(ycc2rgb(o)), c0.a);
}`,
  ),
);

const smartDenoise: EffectDef = {
  type: 'smartDenoise',
  name: 'Smart Denoise',
  category: 'Blur & Sharpen',
  description: 'Edge-preserving noise reduction (bilateral). Smooths grain and compression noise while keeping edges and texture crisp.',
  params: [
    px('radius', 'Radius', 2.5, { min: 0.5, max: 12, softMax: 6, hint: 'Spatial reach of the filter.' }),
    pct('threshold', 'Threshold', 6, { min: 0.5, max: 50, softMax: 20, hint: 'Differences larger than this count as detail and are preserved.' }),
    pct('luma', 'Luma reduction', 60),
    pct('chroma', 'Chroma reduction', 100),
  ],
  passes: [denoise],
  keywords: ['noise reduction', 'nr', 'bilateral', 'grain removal', 'clean', 'surface blur'],
};

export const BLUR_EFFECTS: EffectDef[] = [gaussianBlur, directionalBlur, radialBlur, zoomBlur, tiltShift, sharpen, lensBlur, smartDenoise];
