// Film effects: damage, gate weave and a one-stop film look (curve, grain,
// halation and vignette). All animation is driven by u_time and u_seed, so
// preview and export render the same frames.
import type { EffectDef, EffectPass } from '../types';
import { gaussChain, glsl, pass, pn } from './glsl';
import { ang, hz, num, pct, px, spct } from './params';
import { BRIGHT_FN, GRAIN_FN, HALATION_FINAL_BODY, VIGNETTE_FN } from './stylize';

type P = Record<string, number | boolean | string>;

const filmDamage: EffectDef = {
  type: 'filmDamage',
  name: 'Film Damage',
  category: 'Film',
  description: 'Dust, hairs, scratches and exposure flicker of a well-travelled print, re-randomized every film frame.',
  params: [
    pct('dust', 'Dust', 40, { max: 200 }),
    pct('scratches', 'Scratches', 30, { max: 200 }),
    pct('flicker', 'Flicker', 25, { max: 200 }),
    num('rate', 'Damage frame rate', 24, { min: 1, max: 60, step: 1, unit: 'Hz', animatable: false, hint: 'How often the dirt pattern changes.' }),
    pct('dark', 'Dark dirt', 65, { hint: 'Share of specks that are dark (print dirt) rather than bright (negative dust).' }),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'noise'],
        `
float specks(vec2 p, float fr, float density) {
  float cell = 48.0;
  vec2 g = floor(p / cell);
  float m = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = g + vec2(float(i), float(j));
      float h = hash13(vec3(c, fr));
      if (h > density) continue;
      vec2 pos = (c + hash22(c + fr * 1.7)) * cell;
      float r = mix(0.6, 3.2, pow(hash13(vec3(c, fr + 9.1)), 3.0)) * u_resolution.y / 1080.0;
      vec2 d = p - pos;
      float hair = hash13(vec3(c, fr + 3.3));
      if (hair > 0.93) {
        float ang = hash13(vec3(c, fr + 5.5)) * 6.2831853;
        vec2 dd = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * d;
        float bend = sin(dd.x * 0.08 + hair * 20.0) * 6.0;
        float len = 40.0 * u_resolution.y / 1080.0;
        float hm = (1.0 - smoothstep(0.4, 1.2, abs(dd.y - bend))) * (1.0 - smoothstep(len * 0.7, len, abs(dd.x)));
        m = max(m, hm * 0.85);
      } else {
        vec2 sq = d * vec2(1.0, 0.6 + hash13(vec3(c, fr + 2.2)));
        m = max(m, 1.0 - smoothstep(r * 0.6, r, length(sq)));
      }
    }
  }
  return m;
}
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  vec3 c = unpremul(s);
  float rate = max(u_rate, 1.0);
  float fr = floor(u_time * rate + 0.5) + u_seed * 1000.0;
  vec2 p = uv * u_resolution;
  float fl = (vnoise(vec2(fr * 0.37, u_seed * 31.0)) - 0.5) * 2.0;
  c *= 1.0 + fl * u_flicker * 0.01 * 0.22;
  float dens = clamp(u_dust * 0.01 * 0.06, 0.0, 0.4);
  float m = specks(p, fr, dens);
  float darkShare = u_dark * 0.01;
  float isDark = step(hash13(vec3(floor(p / 48.0), fr + 4.4)), darkShare);
  c = mix(c, isDark > 0.5 ? c * 0.08 : max(c, vec3(1.0)) * 1.1, m);
  float slow = floor(u_time * 1.6) + u_seed * 77.0;
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    float exists = step(hash11(fk * 13.1 + slow), u_scratches * 0.01 * 0.6);
    if (exists < 0.5) continue;
    float x = hash11(fk * 7.7 + slow * 0.31) + sin(u_time * (0.8 + fk) + fk) * 0.004;
    float w = mix(0.6, 1.8, hash11(fk * 3.3 + slow)) * u_resolution.y / 1080.0;
    float dx = abs(uv.x - x) * u_resolution.x;
    float along = vnoise(vec2(uv.y * 14.0 + fk * 9.0, fr * 0.5));
    float line = (1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0, dx)) * smoothstep(0.25, 0.6, along);
    bool bright = hash11(fk * 5.1 + slow) > 0.4;
    c = mix(c, bright ? max(c, vec3(0.9)) : c * 0.25, line * 0.85);
  }
  return premul(c, s.a);
}`,
      ),
    ),
  ],
  keywords: ['dust', 'scratches', 'old film', 'vintage', 'flicker', 'dirt', 'aged', 'projector'],
};

const gateWeave: EffectDef = {
  type: 'gateWeave',
  name: 'Gate Weave',
  category: 'Film',
  description: 'The gentle wander of film moving through a camera or projector gate: slow drift plus frame-to-frame registration jitter.',
  params: [
    px('amount', 'Amount', 1.5, { max: 40, softMax: 8, hint: 'Peak drift in pixels at 1080p (scales with resolution).' }),
    hz('speed', 'Speed', 1.2, { max: 10, softMax: 4 }),
    ang('rotation', 'Rotation', 0.08, { min: 0, max: 5, softMax: 1, step: 0.01 }),
    pct('jitter', 'Frame jitter', 30),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'noise', 'taps'],
        `
vec4 effect(vec2 uv) {
  float sc = u_resolution.y / 1080.0;
  float t = u_time * u_speed + u_seed * 50.0;
  float fr = floor(u_time * 24.0 + 0.5);
  vec2 drift = vec2(gnoise(vec2(t, 1.7)), gnoise(vec2(t * 0.8, 9.2)) * 0.65);
  vec2 jit = (vec2(hash11(fr + u_seed * 100.0), hash11(fr * 1.3 + 7.0)) - 0.5) * u_jitter * 0.01;
  vec2 off = (drift + jit) * u_amount * sc;
  float rot = radians(u_rotation) * gnoise(vec2(t * 0.7, 4.4));
  vec2 c = 0.5 * u_resolution;
  vec2 p = uv * u_resolution - c;
  p = rot2(p, -rot) - off;
  return tapC((p + c) * u_texel);
}`,
      ),
    ),
  ],
  keywords: ['weave', 'jitter', 'wobble', 'projector', 'film shake', 'registration'],
};

const filmLookFinal = pass(
  glsl(
    ['util', 'perc', 'log', 'noise'],
    `${HALATION_FINAL_BODY}${VIGNETTE_FN}${GRAIN_FN}
vec4 effect(vec2 uv) {
  vec4 o = texture(u_orig, uv);
  if (o.a <= 1e-5 && maxc(src(uv).rgb) <= 1e-5) return o;
  vec3 c = unpremul(o);
  float a = o.a;
  c += halationAdd(c, src(uv).rgb, decP(0.72), u_halation * 0.01 * 1.6, vec3(1.0, 0.16, 0.03)) / max(a, 0.05);
  vec3 l = linToLog(max(c, vec3(0.0)));
  float k = 1.0 + u_curve * 0.01 * 0.6;
  vec3 x = (l - 0.4135) * k;
  l = 0.4135 + x / (1.0 + abs(x) * u_curve * 0.01 * 0.9);
  c = logToLin(l);
  float y = luma(c);
  c = max(mix(vec3(y), c, u_saturation * 0.01), 0.0);
  c *= exp2(u_warmth * 0.01 * 0.25 * vec3(1.0, 0.1, -1.0));
  if (u_vignette < 0.0) c *= exp2(u_vignette * 0.01 * 2.5 * vignetteMask(uv, vec2(0.5), 0.58, 0.0, 0.65));
  c = applyGrain(c, uv, u_grain * 0.01, u_grainSize, 0.2, 0.7, 0.45, 1.0);
  return premul(c, a);
}`,
  ),
);

const filmLookBright = pass(
  glsl(
    ['util', 'perc'],
    `${BRIGHT_FN}
vec4 effect(vec2 uv) { return brightOf(src(uv), decP(0.72), 0.6); }`,
  ),
);

function filmLookExpand(p: P): EffectPass[] {
  const r = pn(p, 'halationRadius') * 0.5;
  return [filmLookBright, ...gaussChain({ id: 'filmLook', sigma: 'u_halationRadius * 0.5' }, r), filmLookFinal];
}

const filmLook: EffectDef = {
  type: 'filmLook',
  name: 'Film Look',
  category: 'Film',
  description: 'A complete film emulation in one effect: soft-shouldered print curve, gentle desaturation, warm halation, organic grain and a subtle vignette.',
  params: [
    pct('curve', 'Film curve', 35, { hint: 'Contrast with a soft toe and shoulder, applied in log.' }),
    pct('saturation', 'Saturation', 92, { max: 200 }),
    spct('warmth', 'Warmth', 10, { unit: '', step: 1 }),
    pct('grain', 'Grain', 30, { max: 200 }),
    num('grainSize', 'Grain size', 1.2, { min: 0.3, max: 6, softMax: 3, step: 0.05, unit: 'x' }),
    pct('halation', 'Halation', 40, { max: 300 }),
    px('halationRadius', 'Halation radius', 12, { max: 200, softMax: 60 }),
    num('vignette', 'Vignette', -20, { min: -100, max: 0, step: 1, hint: 'Darkens the edges.' }),
  ],
  passes: [],
  expand: filmLookExpand,
  keywords: ['cinematic', 'film emulation', 'kodak', 'analog', 'grain', 'halation', 'movie look', 'print film'],
};
filmLook.passes = filmLookExpand({ halationRadius: 12 });

export const FILM_EFFECTS: EffectDef[] = [filmDamage, gateWeave, filmLook];
