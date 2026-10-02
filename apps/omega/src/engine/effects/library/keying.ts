// Keying. Mattes are computed on perceptual Y'CbCr (how camera codecs store
// chroma), refined with separable choke and blur passes, and applied to the
// layer's alpha with spill suppression on the remaining color.
import type { EffectDef, EffectPass } from '../types';
import { gaussChain, glsl, memoPass, pass, pn } from './glsl';
import { choice, color, num, pct, px } from './params';

type P = Record<string, number | boolean | string>;

const VIEW = ['Composite', 'Matte', 'Status'];

/** Status view: black = fully transparent, white = solid, grey = partial. */
const STATUS_FN = /* glsl */ `
vec4 viewMatte(vec4 comp, float m, int view) {
  if (view == 1) return vec4(vec3(m), 1.0);
  if (view == 2) {
    float s = m <= 0.02 ? 0.0 : (m >= 0.98 ? 1.0 : 0.45);
    return vec4(vec3(s), 1.0);
  }
  return comp;
}
`;

// ---------------------------------------------------------------------------
// Chroma Key
// ---------------------------------------------------------------------------
const chromaHelpers = /* glsl */ `
vec3 keyYcc() { return rgb2ycc(toPerc(clamp(u_keyColor.rgb, 0.0, 1.0))); }
float keyness(vec3 P, vec3 K) {
  float kl = max(length(K.yz), 1e-4);
  vec2 kd = K.yz / kl;
  float along = dot(P.yz, kd);
  float perp = length(P.yz - kd * along);
  float k = (along - perp * 1.2) / kl;
  float lr = clamp(P.x / max(K.x, 1e-3), 0.25, 1.0);
  return k / mix(1.0, lr, 0.5);
}
`;

const chromaMatte = pass(
  glsl(
    ['util', 'perc', 'ycc'],
    `${chromaHelpers}
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  vec3 P = rgb2ycc(toPerc(clamp(unpremul(s), 0.0, 1.0)));
  float d = 1.0 - clamp(keyness(P, keyYcc()), -1.0, 1.5);
  float tol = u_tolerance * 0.01;
  float m = smoothstep(tol, tol + max(u_softness * 0.01, 1e-3), d);
  return vec4(m);
}`,
  ),
);

/** Separable min (choke > 0) / max (choke < 0) of the matte stored in all channels. */
function chokePass(id: string, dir: [number, number]): EffectPass {
  return memoPass(`choke|${id}|${dir[0]}`, () =>
    pass(
      glsl(
        ['taps'],
        `
vec4 effect(vec2 uv) {
  float r = abs(u_choke);
  float m = tapC(uv).a;
  bool erode = u_choke > 0.0;
  for (int i = 1; i <= 24; i++) {
    float fi = float(i);
    if (fi > r + 0.5) break;
    float w = clamp(r - fi + 1.0, 0.0, 1.0);
    vec2 o = vec2(${dir[0].toFixed(1)}, ${dir[1].toFixed(1)}) * fi * u_texel;
    float a = tapC(uv + o).a;
    float b = tapC(uv - o).a;
    float e = erode ? min(a, b) : max(a, b);
    m = erode ? min(m, mix(m, e, w)) : max(m, mix(m, e, w));
  }
  return vec4(m);
}`,
      ),
    ),
  );
}

const chromaFinal = pass(
  glsl(
    ['util', 'perc', 'ycc'],
    `${chromaHelpers}${STATUS_FN}
vec4 effect(vec2 uv) {
  vec4 o = texture(u_orig, uv);
  float m = src(uv).a;
  float cb = u_clipBlack * 0.01;
  float cw = max(u_clipWhite * 0.01, cb + 0.01);
  m = clamp((m - cb) / (cw - cb), 0.0, 1.0);
  vec3 c = unpremul(o);
  vec3 P = rgb2ycc(toPerc(c));
  vec3 K = keyYcc();
  vec2 kd = K.yz / max(length(K.yz), 1e-4);
  float along = dot(P.yz, kd);
  P.yz -= kd * max(along, 0.0) * u_spill * 0.01;
  vec3 col = fromPerc(ycc2rgb(P));
  float a = o.a * m;
  return viewMatte(premul(col, a), m * o.a, u_view);
}`,
  ),
);

function chromaExpand(p: P): EffectPass[] {
  const choke = pn(p, 'choke');
  const out: EffectPass[] = [chromaMatte];
  if (Math.abs(choke) > 0.01) out.push(chokePass('chroma', [1, 0]), chokePass('chroma', [0, 1]));
  out.push(...gaussChain({ id: 'chromaKey', sigma: 'u_soften * 0.5' }, pn(p, 'soften') * 0.5));
  out.push(chromaFinal);
  return out;
}

const chromaKey: EffectDef = {
  type: 'chromaKey',
  name: 'Chroma Key',
  category: 'Keying',
  description: 'Keys out a green or blue screen (or any color): tolerance and softness for the matte, choke and soften to refine its edge, and spill suppression for the subject.',
  params: [
    color('keyColor', 'Key color', '#22b14c'),
    pct('tolerance', 'Tolerance', 30, { hint: 'How far from the key color is still removed.' }),
    pct('softness', 'Edge softness', 18, { max: 100 }),
    num('choke', 'Choke', 0, { min: -20, max: 20, softMin: -6, softMax: 6, step: 0.1, unit: 'px', hint: 'Positive shrinks the matte, negative grows it.' }),
    px('soften', 'Soften matte', 1, { max: 40, softMax: 8 }),
    pct('spill', 'Spill suppression', 70),
    pct('clipBlack', 'Clip black', 0),
    pct('clipWhite', 'Clip white', 100),
    choice('view', 'View', 0, VIEW),
  ],
  passes: [],
  expand: chromaExpand,
  keywords: ['green screen', 'blue screen', 'keyer', 'ultra key', 'keylight', 'remove background', 'chromakey'],
};
chromaKey.passes = chromaExpand({ choke: 0, soften: 1 });

// ---------------------------------------------------------------------------
// Luma Key
// ---------------------------------------------------------------------------
const lumaKey: EffectDef = {
  type: 'lumaKey',
  name: 'Luma Key',
  category: 'Keying',
  description: 'Keys out dark or bright areas by brightness — fire, smoke and light elements shot on black, or titles on white.',
  params: [
    choice('keyOut', 'Key out', 0, ['Dark areas', 'Bright areas']),
    pct('threshold', 'Threshold', 12),
    pct('softness', 'Softness', 15),
    choice('view', 'View', 0, VIEW),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'perc'],
        `${STATUS_FN}
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float y = luma(toPerc(unpremul(s)));
  float th = u_threshold * 0.01;
  float sf = max(u_softness * 0.01, 1e-3);
  float m = u_keyOut == 1 ? 1.0 - smoothstep(th - sf, th, y) : smoothstep(th, th + sf, y);
  return viewMatte(s * m, m * s.a, u_view);
}`,
      ),
    ),
  ],
  keywords: ['luminance key', 'black key', 'white key', 'screen', 'remove black'],
};

// ---------------------------------------------------------------------------
// Color Difference Key
// ---------------------------------------------------------------------------
const colorDifferenceKey: EffectDef = {
  type: 'colorDifferenceKey',
  name: 'Color Difference Key',
  category: 'Keying',
  description: 'The classic screen-difference matte (screen channel minus the others). Excellent on hair, smoke and motion blur; pair with spill suppression.',
  params: [
    choice('screen', 'Screen', 0, ['Green', 'Blue']),
    color('screenColor', 'Screen color', '#22b14c', { hint: 'Pick the screen; it normalizes the matte.' }),
    pct('balance', 'Balance', 50, { hint: 'How much the strongest other channel counts against the screen channel.' }),
    pct('gain', 'Matte gain', 100, { min: 10, max: 400, softMax: 200 }),
    pct('clipBlack', 'Clip black', 5),
    pct('clipWhite', 'Clip white', 90),
    pct('spill', 'Spill suppression', 80),
    choice('view', 'View', 0, VIEW),
  ],
  passes: [
    pass(
      glsl(
        ['util', 'perc'],
        `${STATUS_FN}
float diffOf(vec3 c, float bal) {
  float s = u_screen == 1 ? c.b : c.g;
  float o1 = c.r;
  float o2 = u_screen == 1 ? c.g : c.b;
  return s - mix(0.5 * (o1 + o2), max(o1, o2), bal);
}
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  vec3 c = toPerc(clamp(unpremul(s), 0.0, 1.0));
  float bal = u_balance * 0.01;
  float ref = max(diffOf(toPerc(clamp(u_screenColor.rgb, 0.0, 1.0)), bal), 0.05);
  float m = 1.0 - clamp(diffOf(c, bal) / ref * u_gain * 0.01, 0.0, 1.0);
  float cb = u_clipBlack * 0.01;
  float cw = max(u_clipWhite * 0.01, cb + 0.01);
  m = clamp((m - cb) / (cw - cb), 0.0, 1.0);
  float lim = mix(0.5 * (c.r + (u_screen == 1 ? c.g : c.b)), max(c.r, u_screen == 1 ? c.g : c.b), bal);
  vec3 d = c;
  if (u_screen == 1) d.b = min(c.b, lim); else d.g = min(c.g, lim);
  c = mix(c, d, u_spill * 0.01);
  return viewMatte(premul(fromPerc(c), s.a * m), m * s.a, u_view);
}`,
      ),
    ),
  ],
  keywords: ['difference matte', 'green screen', 'blue screen', 'keyer', 'hair', 'despill'],
};

export const KEYING_EFFECTS: EffectDef[] = [chromaKey, lumaKey, colorDifferenceKey];
