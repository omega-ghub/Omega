// Light effects: procedural light added in scene-linear light, so it sums
// with the picture the way real light does.
import type { EffectDef } from '../types';
import { glsl, pass } from './glsl';
import { ang, bool, color, num, pct, point, spct } from './params';

/** Additive light composite that keeps premultiplied alpha sensible. */
const ADD_LIGHT = /* glsl */ `
vec4 addLight(vec4 o, vec3 l) {
  return vec4(o.rgb + l, o.a + (1.0 - o.a) * clamp(maxc(l), 0.0, 1.0));
}
`;

const lightLeak: EffectDef = {
  type: 'lightLeak',
  name: 'Light Leak',
  category: 'Light',
  description: 'Warm, drifting light spilling in from the edge of the frame, like light fogging film in the camera. Animates on its own.',
  params: [
    color('colorA', 'Color', '#ff5a14'),
    color('colorB', 'Secondary color', '#ffc46b'),
    pct('intensity', 'Intensity', 80, { max: 400, softMax: 200 }),
    ang('direction', 'From', 20, { min: -360, max: 360, hint: 'Edge the leak comes from; 0° is the right edge.' }),
    pct('spread', 'Spread', 55),
    pct('scale', 'Scale', 100, { min: 10, max: 500, softMax: 250 }),
    num('speed', 'Drift speed', 0.25, { min: 0, max: 5, softMax: 2, step: 0.01, unit: 'x' }),
    pct('evolution', 'Evolution', 0, { min: 0, max: 1000, softMax: 100, hint: 'Picks a different leak pattern.' }),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'noise'],
        `${ADD_LIGHT}
vec4 effect(vec2 uv) {
  vec4 o = src(uv);
  float asp = u_resolution.x / u_resolution.y;
  vec2 p = (uv - 0.5) * vec2(asp, 1.0);
  float a = radians(u_direction);
  vec2 dir = vec2(cos(a), sin(a));
  float t = u_time * u_speed + u_evolution * 0.07 + u_seed * 13.0;
  float reach = mix(0.15, 1.2, u_spread * 0.01);
  float edge = dot(p, dir) / (0.5 * (abs(dir.x) * asp + abs(dir.y)));
  float e = smoothstep(1.0 - reach * 1.6, 1.15, edge);
  vec2 q = p / max(u_scale * 0.01, 0.1) * 1.6;
  vec2 w = vec2(fbm(q * 0.9 + vec2(t * 0.6, -t * 0.4), 3), fbm(q * 0.9 + vec2(-t * 0.5, t * 0.3) + 7.3, 3));
  float n = fbm(q + w * 1.4 + vec2(t * 0.25, t * 0.1), 4) * 0.5 + 0.5;
  float n2 = fbm(q * 0.6 - w + 3.1, 3) * 0.5 + 0.5;
  float leak = e * smoothstep(0.25, 0.85, n + e * 0.35);
  float pulse = 0.85 + 0.15 * sin(t * 2.1 + n2 * 4.0);
  vec3 col = mix(u_colorB.rgb, u_colorA.rgb, smoothstep(0.2, 0.8, n2 + (1.0 - e) * 0.4));
  vec3 l = col * leak * leak * pulse * u_intensity * 0.01 * 2.2;
  return addLight(o, l);
}`,
      ),
    ),
  ],
  keywords: ['film burn', 'light leak', 'flare', 'warm', 'vintage', 'analog', 'glow'],
};

const lensFlare: EffectDef = {
  type: 'lensFlare',
  name: 'Lens Flare',
  category: 'Light',
  description: 'A procedural flare at a light source: core glow, starburst, anamorphic streak, halo ring and ghosts reflected across the frame.',
  params: [
    point('position', 'Light position', '0.28,0.3'),
    pct('brightness', 'Brightness', 100, { max: 500, softMax: 250 }),
    pct('scale', 'Scale', 100, { min: 10, max: 400, softMax: 250 }),
    color('tint', 'Tint', '#ffe0b8'),
    pct('ghosts', 'Ghosts', 60, { max: 200 }),
    pct('streak', 'Anamorphic streak', 50, { max: 200 }),
    color('streakColor', 'Streak color', '#5aa8ff'),
    pct('rays', 'Starburst', 40, { max: 200 }),
    pct('halo', 'Halo', 30, { max: 200 }),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'noise'],
        `${ADD_LIGHT}
vec3 ghost(vec2 p, vec2 c, float r, vec3 col) {
  float d = length(p - c) / r;
  float disc = smoothstep(1.0, 0.75, d) * (0.35 + 0.65 * smoothstep(0.2, 1.0, d));
  return col * disc;
}
vec4 effect(vec2 uv) {
  vec4 o = src(uv);
  float asp = u_resolution.x / u_resolution.y;
  vec2 P = vec2(uv.x * asp, uv.y);
  vec2 L = vec2(pt(u_position).x * asp, pt(u_position).y);
  vec2 C = vec2(0.5 * asp, 0.5);
  float S = max(u_scale * 0.01, 0.05);
  vec2 d = P - L;
  float r = length(d) / S;
  vec3 tint = u_tint.rgb;
  vec3 l = vec3(0.0);
  l += tint * (0.9 / (1.0 + pow(r / 0.012, 2.0)) + 0.25 * exp(-r * 9.0));
  float th = atan(d.y, d.x);
  float burst = pow(abs(sin(th * 6.0 + 0.4)), 18.0) + 0.6 * pow(abs(sin(th * 11.0 + 1.3)), 40.0) * (0.6 + 0.4 * vnoise(vec2(th * 8.0, 1.0)));
  l += tint * burst * exp(-r * 6.0) * u_rays * 0.01 * 1.2;
  float sy = abs(d.y) / S;
  float sx = abs(d.x) / S;
  l += u_streakColor.rgb * exp(-sy * 140.0) * exp(-sx * 1.4) * u_streak * 0.01 * 1.6;
  float hr = 0.28;
  vec3 ring = vec3(exp(-pow((r - hr * 1.03) / 0.025, 2.0)), exp(-pow((r - hr) / 0.025, 2.0)), exp(-pow((r - hr * 0.97) / 0.025, 2.0)));
  l += ring * 0.25 * u_halo * 0.01;
  vec2 axis = C - L;
  vec3 g = vec3(0.0);
  g += ghost(P, L + axis * 0.45, 0.035 * S, vec3(0.30, 0.55, 0.35));
  g += ghost(P, L + axis * 0.8, 0.07 * S, vec3(0.45, 0.30, 0.55));
  g += ghost(P, L + axis * 1.25, 0.05 * S, vec3(0.55, 0.42, 0.20));
  g += ghost(P, L + axis * 1.55, 0.12 * S, vec3(0.20, 0.35, 0.55));
  g += ghost(P, L + axis * 1.9, 0.025 * S, vec3(0.60, 0.50, 0.30));
  g += ghost(P, L + axis * 2.2, 0.09 * S, vec3(0.30, 0.25, 0.45));
  l += g * 0.18 * u_ghosts * 0.01;
  return addLight(o, l * u_brightness * 0.01);
}`,
      ),
    ),
  ],
  keywords: ['flare', 'sun', 'anamorphic', 'jj abrams', 'optical', 'glare', 'light source'],
};

const lightSweep: EffectDef = {
  type: 'lightSweep',
  name: 'Light Sweep',
  category: 'Light',
  description: 'A band of light sweeping across the layer — the classic shine across a logo or title. Animate Position, or set an automatic speed.',
  params: [
    pct('position', 'Position', 50, { min: -50, max: 150, hint: 'Where the band is, from one side (0%) to the other (100%).' }),
    num('speed', 'Auto sweep', 0, { min: 0, max: 10, softMax: 2, step: 0.05, unit: 'Hz', hint: 'Sweeps per second; 0 uses Position.' }),
    ang('angle', 'Angle', 70, { min: -180, max: 180 }),
    pct('width', 'Width', 12, { max: 100, softMax: 50 }),
    pct('softness', 'Softness', 60),
    pct('intensity', 'Intensity', 120, { max: 500, softMax: 300 }),
    color('color', 'Color', '#ffffff'),
    bool('alphaOnly', 'Only on the layer', true, { hint: 'Keeps the shine inside the layer’s alpha.' }),
    spct('falloff', 'Center boost', 30, { unit: '', step: 1, hint: 'Extra brightness at the band’s center.' }),
  ],
  passes: [
    pass(
      glsl(
        ['util'],
        `${ADD_LIGHT}
vec4 effect(vec2 uv) {
  vec4 o = src(uv);
  float a = radians(u_angle);
  vec2 n = vec2(cos(a), sin(a));
  vec2 p = (uv - 0.5) * u_resolution / u_resolution.y;
  float ext = 0.5 * (abs(n.x) * u_resolution.x / u_resolution.y + abs(n.y));
  float pos = u_speed > 0.0 ? fract(u_time * u_speed) * 1.3 - 0.15 : u_position * 0.01;
  float c = mix(-ext, ext, pos);
  float w = max(u_width * 0.01 * 0.5, 1e-3);
  float d = abs(dot(p, n) - c);
  float sf = max(u_softness * 0.01, 0.0);
  float band = 1.0 - smoothstep(w * (1.0 - sf), w * (1.0 + sf) + 1e-3, d);
  band *= 1.0 + u_falloff * 0.01 * exp(-pow(d / (w * 0.35 + 1e-3), 2.0));
  vec3 l = u_color.rgb * band * u_intensity * 0.01;
  if (u_alphaOnly > 0.5) return vec4(o.rgb + l * o.a, o.a);
  return addLight(o, l);
}`,
      ),
    ),
  ],
  keywords: ['shine', 'glint', 'sheen', 'logo reveal', 'gleam', 'sweep'],
};

export const LIGHT_EFFECTS: EffectDef[] = [lightLeak, lensFlare, lightSweep];
