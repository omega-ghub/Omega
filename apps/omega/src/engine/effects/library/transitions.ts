// Transitions: one TransitionDef per TransitionType (state/types.ts).
//
// Every transition starts exactly on the outgoing picture (progress 0) and ends
// exactly on the incoming one (progress 1); the validation harness checks this.
// Transition params are stored as numbers (Transition.params), so positions
// are separate X/Y percentages rather than point params, and choices are ints.
// Color params are the exception (the dips): the shader falls back to the
// default color when the uniform arrives unset (NaN or zero alpha).
import type { TransitionDef } from '../types';
import { glsl } from './glsl';
import { ang, choice, num, pct } from './params';

/** Sampling helpers for transitions (no u_src here). Clamped and transparent-edge variants. */
const T_HELPERS = /* glsl */ `
vec4 F(vec2 uv) { return texture(u_from, clamp(uv, 0.5 * u_texel, 1.0 - 0.5 * u_texel)); }
vec4 T(vec2 uv) { return texture(u_to, clamp(uv, 0.5 * u_texel, 1.0 - 0.5 * u_texel)); }
vec4 Fz(vec2 uv) { return F(uv) * inside01(uv); }
vec4 Tz(vec2 uv) { return T(uv) * inside01(uv); }
vec2 mirrorUv(vec2 uv) { return 1.0 - abs(1.0 - mod(uv, 2.0)); }
vec2 aspectV() { return vec2(u_resolution.x / u_resolution.y, 1.0); }
`;

function tglsl(uses: string[], body: string): string {
  return glsl(['util', ...uses], `${T_HELPERS}\n${body}`);
}

/** Direction choices shared by slide / push / whip: unit vector the picture MOVES toward. */
const DIRS = ['Left', 'Right', 'Up', 'Down'];
const DIR_FN = /* glsl */ `
vec2 moveDir(int d) {
  if (d == 1) return vec2(1.0, 0.0);
  if (d == 2) return vec2(0.0, 1.0);
  if (d == 3) return vec2(0.0, -1.0);
  return vec2(-1.0, 0.0);
}
`;

const crossDissolve: TransitionDef = {
  type: 'crossDissolve',
  name: 'Cross Dissolve',
  category: 'Dissolve',
  description: 'Blends the two shots in linear light — the physically correct mix of two exposures.',
  params: [],
  glsl: tglsl([], `vec4 transition(vec2 uv) { return mix(F(uv), T(uv), u_progress); }`),
};

const filmDissolve: TransitionDef = {
  type: 'filmDissolve',
  name: 'Film Dissolve',
  category: 'Dissolve',
  description: 'Mixes in a log (density) domain like an optical printer: highlights hold longer and the blend feels more filmic.',
  params: [],
  glsl: tglsl(
    ['log'],
    `
vec4 transition(vec2 uv) {
  vec4 a = F(uv);
  vec4 b = T(uv);
  float p = u_progress;
  float al = mix(a.a, b.a, p);
  if (al <= 1e-6) return vec4(0.0);
  float wa = (1.0 - p) * a.a;
  float wb = p * b.a;
  float t = wb / max(wa + wb, 1e-6);
  vec3 c = logToLin(mix(linToLog(max(unpremul(a), 0.0)), linToLog(max(unpremul(b), 0.0)), t));
  return vec4(c * al, al);
}`,
  ),
};

const additiveDissolve: TransitionDef = {
  type: 'additiveDissolve',
  name: 'Additive Dissolve',
  category: 'Dissolve',
  description: 'Adds the incoming shot before fading the outgoing one, so the middle of the transition flares brighter.',
  params: [],
  glsl: tglsl(
    [],
    `
vec4 transition(vec2 uv) {
  float p = u_progress;
  return F(uv) * min(1.0, 2.0 * (1.0 - p)) + T(uv) * min(1.0, 2.0 * p);
}`,
  ),
};

function dip(type: 'dipToBlack' | 'dipToWhite', name: string, def: string, fallback: string, description: string): TransitionDef {
  return {
    type,
    name,
    category: 'Dissolve',
    description,
    params: [
      { key: 'color', label: 'Color', type: 'color', default: def, animatable: false },
      pct('hold', 'Hold', 0, { max: 80, hint: 'Part of the transition spent fully on the color.' }),
    ],
    glsl: tglsl(
      ['perc'],
      `
vec4 mixP(vec4 a, vec4 b, float t) {
  float al = mix(a.a, b.a, t);
  if (al <= 1e-6) return vec4(0.0);
  float wb = t * b.a / max((1.0 - t) * a.a + t * b.a, 1e-6);
  vec3 c = fromPerc(mix(toPerc(unpremul(a)), toPerc(unpremul(b)), wb));
  return vec4(c * al, al);
}
vec4 dipColor() {
  vec4 c = u_color;
  if (any(isnan(c)) || any(isinf(c)) || c.a <= 0.0) c = ${fallback};
  return vec4(c.rgb, 1.0);
}
vec4 transition(vec2 uv) {
  float p = u_progress;
  float h = clamp(u_hold * 0.01, 0.0, 0.9) * 0.5;
  vec4 C = dipColor();
  if (p < 0.5) return mixP(F(uv), C, clamp(p / (0.5 - h), 0.0, 1.0));
  return mixP(C, T(uv), clamp((p - 0.5 - h) / (0.5 - h), 0.0, 1.0));
}`,
    ),
  };
}

const dipToBlack = dip('dipToBlack', 'Dip to Black', '#000000', 'vec4(0.0, 0.0, 0.0, 1.0)', 'Fades the outgoing shot to black, then up into the incoming shot. Pick another color for a dip to color.');
const dipToWhite = dip('dipToWhite', 'Dip to White', '#ffffff', 'vec4(1.0)', 'Flashes through white between the two shots. Pick another color for a dip to color.');

const wipe: TransitionDef = {
  type: 'wipe',
  name: 'Wipe',
  category: 'Wipe',
  description: 'A straight edge travels across the frame at any angle, revealing the incoming shot.',
  params: [ang('angle', 'Angle', 0, { min: -360, max: 360, hint: 'Direction the edge travels; 0° wipes left to right.' }), pct('softness', 'Softness', 4, { max: 100, softMax: 40 })],
  glsl: tglsl(
    [],
    `
vec4 transition(vec2 uv) {
  float a = radians(u_angle);
  vec2 d = vec2(cos(a), sin(a));
  vec2 asp = aspectV();
  vec2 p = (uv - 0.5) * asp;
  float ext = 0.5 * (abs(d.x) * asp.x + abs(d.y) * asp.y);
  float s = max(u_softness * 0.01 * ext, 0.5 / u_resolution.y);
  float pos = mix(-ext - s, ext + s, u_progress);
  float m = 1.0 - smoothstep(pos - s, pos + s, dot(p, d));
  return mix(F(uv), T(uv), m);
}`,
  ),
};

const motionBlurFn = /* glsl */ `
vec4 smear(vec2 uv, vec2 dir, float len, bool from) {
  if (len * u_resolution.x < 0.5) return from ? Fz(uv) : Tz(uv);
  vec4 acc = vec4(0.0);
  float j = hash12(uv * u_resolution) - 0.5;
  for (int i = 0; i < 12; i++) {
    float t = (float(i) + 0.5 + j) / 12.0 - 0.5;
    vec2 q = uv + dir * t * len;
    acc += from ? Fz(q) : Tz(q);
  }
  return acc / 12.0;
}
`;

const slide: TransitionDef = {
  type: 'slide',
  name: 'Slide',
  category: 'Motion',
  description: 'The incoming shot slides in over the outgoing one, with optional motion blur.',
  params: [choice('direction', 'Direction', 0, DIRS, { hint: 'Direction the incoming shot moves.' }), pct('blur', 'Motion blur', 40)],
  glsl: tglsl(
    [],
    `${DIR_FN}${motionBlurFn}
vec4 transition(vec2 uv) {
  float p = u_progress;
  vec2 d = moveDir(u_direction);
  float len = u_blur * 0.01 * 0.12 * sin(3.14159265 * p);
  vec4 b = smear(uv + d * (1.0 - p), d, len, false);
  return b + F(uv) * (1.0 - b.a);
}`,
  ),
};

const push: TransitionDef = {
  type: 'push',
  name: 'Push',
  category: 'Motion',
  description: 'The incoming shot pushes the outgoing one out of frame, edge to edge.',
  params: [choice('direction', 'Direction', 0, DIRS, { hint: 'Direction both shots move.' }), pct('blur', 'Motion blur', 40)],
  glsl: tglsl(
    [],
    `${DIR_FN}${motionBlurFn}
vec4 transition(vec2 uv) {
  float p = u_progress;
  vec2 d = moveDir(u_direction);
  float len = u_blur * 0.01 * 0.12 * sin(3.14159265 * p);
  vec4 b = smear(uv + d * (1.0 - p), d, len, false);
  vec4 a = smear(uv - d * p, d, len, true);
  return b + a * (1.0 - b.a);
}`,
  ),
};

const zoom: TransitionDef = {
  type: 'zoom',
  name: 'Zoom',
  category: 'Motion',
  description: 'Punches through the outgoing shot into the incoming one with a radial zoom blur. Zoom in or out.',
  params: [
    choice('mode', 'Direction', 0, ['Zoom in', 'Zoom out']),
    pct('strength', 'Strength', 100, { min: 10, max: 400, softMax: 250, hint: 'How far each shot zooms.' }),
    pct('blur', 'Zoom blur', 60, { max: 200 }),
    pct('centerX', 'Center X', 50),
    pct('centerY', 'Center Y', 50, { hint: 'From the top.' }),
  ],
  glsl: tglsl(
    [],
    `
vec4 sampleZ(vec2 uv, vec2 c, float s, float blur, bool from) {
  vec4 acc = vec4(0.0);
  float j = hash12(uv * u_resolution) - 0.5;
  for (int i = 0; i < 12; i++) {
    float t = (float(i) + 0.5 + j) / 12.0 - 0.5;
    vec2 q = mirrorUv(c + (uv - c) / (s * exp(t * blur)));
    acc += from ? F(q) : T(q);
  }
  return acc / 12.0;
}
vec4 transition(vec2 uv) {
  float p = u_progress;
  vec2 c = vec2(u_centerX * 0.01, 1.0 - u_centerY * 0.01);
  float L = log(1.0 + max(u_strength, 1.0) * 0.01);
  float dir = u_mode == 1 ? -1.0 : 1.0;
  float sA = exp(dir * L * p);
  float sB = exp(dir * L * (p - 1.0));
  float blur = u_blur * 0.01 * L * 0.9 * sin(3.14159265 * p);
  float m = smoothstep(0.38, 0.62, p);
  if (m <= 0.0) return blur < 1e-4 ? F(mirrorUv(c + (uv - c) / sA)) : sampleZ(uv, c, sA, blur, true);
  if (m >= 1.0) return blur < 1e-4 ? T(mirrorUv(c + (uv - c) / sB)) : sampleZ(uv, c, sB, blur, false);
  return mix(sampleZ(uv, c, sA, blur, true), sampleZ(uv, c, sB, blur, false), m);
}`,
  ),
};

const blurDissolve: TransitionDef = {
  type: 'blurDissolve',
  name: 'Blur Dissolve',
  category: 'Dissolve',
  description: 'Both shots defocus toward the middle of the transition as they cross-dissolve.',
  params: [num('amount', 'Blur', 40, { min: 0, max: 400, softMax: 150, unit: 'px', step: 0.5 })],
  glsl: tglsl(
    [],
    `
vec4 discBlur(vec2 uv, float R, bool from) {
  if (R < 0.5) return from ? F(uv) : T(uv);
  vec4 acc = vec4(0.0);
  float rot = hash12(uv * u_resolution) * 6.2831853;
  for (int i = 0; i < 28; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / 28.0);
    float a = fi * 2.3999632 + rot;
    vec2 q = uv + vec2(cos(a), sin(a)) * r * R * u_texel;
    acc += from ? F(q) : T(q);
  }
  return acc / 28.0;
}
vec4 transition(vec2 uv) {
  float p = u_progress;
  float R = u_amount * sin(3.14159265 * p);
  float m = smoothstep(0.2, 0.8, p);
  if (m <= 0.0) return discBlur(uv, R, true);
  if (m >= 1.0) return discBlur(uv, R, false);
  return mix(discBlur(uv, R, true), discBlur(uv, R, false), m);
}`,
  ),
};

const iris: TransitionDef = {
  type: 'iris',
  name: 'Iris',
  category: 'Wipe',
  description: 'A circle, diamond or square opens from a point to reveal the incoming shot (or closes over the outgoing one).',
  params: [
    choice('shape', 'Shape', 0, ['Circle', 'Diamond', 'Square']),
    choice('mode', 'Mode', 0, ['Open', 'Close']),
    pct('softness', 'Softness', 3, { max: 100, softMax: 30 }),
    pct('centerX', 'Center X', 50),
    pct('centerY', 'Center Y', 50, { hint: 'From the top.' }),
  ],
  glsl: tglsl(
    [],
    `
float metric(vec2 v) {
  if (u_shape == 1) return abs(v.x) + abs(v.y);
  if (u_shape == 2) return max(abs(v.x), abs(v.y));
  return length(v);
}
vec4 transition(vec2 uv) {
  vec2 asp = aspectV();
  vec2 c = vec2(u_centerX * 0.01, 1.0 - u_centerY * 0.01) * asp;
  float d = metric(uv * asp - c);
  float rmax = max(max(metric(vec2(0.0) - c), metric(vec2(asp.x, 0.0) - c)), max(metric(vec2(0.0, 1.0) - c), metric(asp - c)));
  float s = max(u_softness * 0.01 * 0.25, 0.75 / u_resolution.y);
  float m;
  if (u_mode == 1) {
    float r = mix(rmax + s, -s, u_progress);
    m = smoothstep(r - s, r + s, d);
  } else {
    float r = mix(-s, rmax + s, u_progress);
    m = 1.0 - smoothstep(r - s, r + s, d);
  }
  return mix(F(uv), T(uv), m);
}`,
  ),
};

const clockWipe: TransitionDef = {
  type: 'clockWipe',
  name: 'Clock Wipe',
  category: 'Wipe',
  description: 'A clock hand sweeps around the center, revealing the incoming shot.',
  params: [
    ang('start', 'Start angle', 90, { min: -360, max: 360, hint: '90° starts at twelve o’clock.' }),
    choice('direction', 'Direction', 0, ['Clockwise', 'Counter-clockwise']),
    pct('softness', 'Softness', 2, { max: 50, softMax: 20 }),
    pct('centerX', 'Center X', 50),
    pct('centerY', 'Center Y', 50, { hint: 'From the top.' }),
  ],
  glsl: tglsl(
    [],
    `
vec4 transition(vec2 uv) {
  vec2 c = vec2(u_centerX * 0.01, 1.0 - u_centerY * 0.01);
  vec2 v = (uv - c) * u_resolution;
  float th = atan(v.y, v.x);
  float st = radians(u_start);
  float f = u_direction == 1 ? fract((th - st) / 6.2831853) : fract((st - th) / 6.2831853);
  float s = max(u_softness * 0.01 * 0.25, 1e-4);
  float P = u_progress * (1.0 + 2.0 * s) - s;
  float m = 1.0 - smoothstep(P - s, P + s, f);
  float seam = clamp(f * 6.2831853 * length(v), 0.0, 1.0);
  m *= mix(seam, 1.0, smoothstep(0.9, 1.0, u_progress));
  return mix(F(uv), T(uv), m);
}`,
  ),
};

const whip: TransitionDef = {
  type: 'whip',
  name: 'Whip Pan',
  category: 'Motion',
  description: 'A fast camera whip: both shots streak past with heavy directional motion blur.',
  params: [choice('direction', 'Direction', 0, DIRS, { hint: 'Direction the picture moves.' }), pct('blur', 'Motion blur', 100, { max: 200 })],
  glsl: tglsl(
    [],
    `${DIR_FN}
vec4 streak(vec2 uv, vec2 dir, float len, bool from) {
  vec4 acc = vec4(0.0);
  float j = hash12(uv * u_resolution) - 0.5;
  for (int i = 0; i < 24; i++) {
    float t = (float(i) + 0.5 + j) / 24.0 - 0.5;
    vec2 q = uv + dir * t * len;
    acc += from ? Fz(q) : Tz(q);
  }
  return acc / 24.0;
}
vec4 transition(vec2 uv) {
  float p = u_progress;
  vec2 d = moveDir(u_direction);
  float e = sin(3.14159265 * p);
  float len = u_blur * 0.01 * 0.9 * e * e;
  float sp = p * p * (3.0 - 2.0 * p);
  if (len * u_resolution.x < 0.5) {
    vec4 b0 = Tz(uv + d * (1.0 - sp));
    return b0 + Fz(uv - d * sp) * (1.0 - b0.a);
  }
  vec4 b = streak(uv + d * (1.0 - sp), d, len, false);
  vec4 a = streak(uv - d * sp, d, len, true);
  return b + a * (1.0 - b.a);
}`,
  ),
};

const glitchT: TransitionDef = {
  type: 'glitch',
  name: 'Glitch',
  category: 'Stylized',
  description: 'The cut tears through digital corruption: blocks of both shots jump, RGB channels split, and the picture snaps across.',
  params: [
    pct('intensity', 'Intensity', 70, { max: 200 }),
    num('blockSize', 'Block size', 48, { min: 4, max: 400, softMax: 160, unit: 'px', step: 1 }),
    num('split', 'RGB split', 24, { min: 0, max: 200, softMax: 80, unit: 'px', step: 0.5 }),
  ],
  glsl: tglsl(
    ['noise'],
    `
vec4 pick(vec2 uv, bool to) { return to ? T(uv) : F(uv); }
vec4 transition(vec2 uv) {
  float p = u_progress;
  float e = pow(max(sin(3.14159265 * p), 0.0), 0.6) * u_intensity * 0.01;
  float slice = floor(p * 14.0);
  vec2 px = uv * u_resolution;
  vec2 bs = max(vec2(u_blockSize * 2.4, u_blockSize * 0.5), vec2(2.0));
  vec2 cell = floor(px / bs);
  float h = hash12(cell + slice * 7.13);
  float hit = step(1.0 - 0.45 * e, h);
  vec2 disp = (hash22(cell + slice) - 0.5) * vec2(u_blockSize * 3.0, u_blockSize * 0.4) * hit * e;
  float th = 0.5 + (hash12(cell * 1.31 + 3.7) - 0.5) * 0.5 * min(e * 2.0, 1.0);
  bool to = p >= th;
  vec2 q = uv + disp * u_texel;
  vec2 sp = vec2(u_split * e, 0.0) * u_texel * (hash11(slice + 0.5) > 0.5 ? 1.0 : -1.0);
  vec4 r = pick(q + sp, to);
  vec4 g = pick(q, to);
  vec4 b = pick(q - sp, to);
  vec4 o = vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
  if (hit > 0.5 && hash12(cell + slice * 3.3) > 0.85) o.rgb = max(vec3(o.a) - o.rgb, 0.0);
  return o;
}`,
  ),
};

const lightLeakT: TransitionDef = {
  type: 'lightLeak',
  name: 'Light Leak',
  category: 'Stylized',
  description: 'A burst of warm light washes over the cut, hiding it in an overexposed film flash.',
  params: [
    choice('tone', 'Tone', 0, ['Warm', 'Gold', 'Rose', 'Cool']),
    pct('intensity', 'Intensity', 100, { max: 300, softMax: 200 }),
    ang('direction', 'From', 30, { min: -360, max: 360 }),
    pct('variation', 'Variation', 0, { min: 0, max: 1000, softMax: 100, hint: 'Picks a different leak pattern.' }),
  ],
  glsl: tglsl(
    ['noise'],
    `
vec3 toneA(int t) {
  if (t == 1) return vec3(1.0, 0.62, 0.18);
  if (t == 2) return vec3(1.0, 0.25, 0.32);
  if (t == 3) return vec3(0.35, 0.6, 1.0);
  return vec3(1.0, 0.32, 0.06);
}
vec3 toneB(int t) {
  if (t == 1) return vec3(1.0, 0.9, 0.55);
  if (t == 2) return vec3(1.0, 0.7, 0.55);
  if (t == 3) return vec3(0.75, 0.9, 1.0);
  return vec3(1.0, 0.78, 0.4);
}
vec4 transition(vec2 uv) {
  float p = u_progress;
  vec4 base = mix(F(uv), T(uv), smoothstep(0.3, 0.7, p));
  float env = sin(3.14159265 * p);
  env = env * env;
  vec2 asp = aspectV();
  vec2 q = (uv - 0.5) * asp;
  float a = radians(u_direction);
  vec2 dir = vec2(cos(a), sin(a));
  float sweep = dot(q, dir) / (0.5 * (abs(dir.x) * asp.x + abs(dir.y))) + (1.0 - 2.0 * p) * 1.2;
  float t = p * 2.0 + u_variation * 0.07;
  vec2 w = vec2(fbm(q * 1.5 + t, 3), fbm(q * 1.5 - t + 4.1, 3));
  float n = fbm(q * 2.2 + w * 1.2 + vec2(t * 0.3, 0.0), 4) * 0.5 + 0.5;
  float leak = smoothstep(0.0, 1.0, 1.0 - abs(sweep) * 0.8) * smoothstep(0.2, 0.8, n + 0.25);
  vec3 col = mix(toneB(u_tone), toneA(u_tone), smoothstep(0.3, 0.9, n));
  vec3 l = col * (leak * 2.4 + 0.35) * env * u_intensity * 0.01;
  return vec4(base.rgb + l * max(base.a, env), max(base.a, clamp(maxc(l), 0.0, 1.0) * env));
}`,
  ),
};

const audioCrossfade: TransitionDef = {
  type: 'audioCrossfade',
  name: 'Audio Crossfade',
  category: 'Dissolve',
  description: 'Constant-power audio crossfade between two clips (the picture, if any, simply dissolves).',
  params: [],
  glsl: tglsl([], `vec4 transition(vec2 uv) { return mix(F(uv), T(uv), u_progress); }`),
};

export const ALL_TRANSITIONS: TransitionDef[] = [
  crossDissolve,
  filmDissolve,
  additiveDissolve,
  dipToBlack,
  dipToWhite,
  wipe,
  slide,
  push,
  zoom,
  blurDissolve,
  iris,
  clockWipe,
  whip,
  glitchT,
  lightLeakT,
  audioCrossfade,
];
