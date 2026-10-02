// Shared GLSL building blocks for the built-in effects and transitions.
//
// Each snippet is a named chunk of GLSL with its dependencies. `glsl(uses, body)`
// emits the requested snippets once each (dependencies first) followed by the
// pass body, so passes never redefine a helper. Snippets never redefine what
// GLSL_PRELUDE already provides (LUMA, luma, src, unpremul, hash12, rgb2hsv,
// hsv2rgb). Snippets marked `effectOnly` read u_src/u_orig and therefore must
// not be used by transitions (which have u_from/u_to instead).
import type { EffectPass } from '../types';

interface Snippet {
  deps?: string[];
  code: string;
}

const S: Record<string, Snippet> = {
  util: {
    code: /* glsl */ `
float sat01(float x) { return clamp(x, 0.0, 1.0); }
float maxc(vec3 c) { return max(c.r, max(c.g, c.b)); }
float minc(vec3 c) { return min(c.r, min(c.g, c.b)); }
vec4 premul(vec3 c, float a) { return vec4(c * a, a); }
vec2 rot2(vec2 v, float a) { float s = sin(a), c = cos(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
// Point params are stored top-left based (y down); v_uv is bottom-left based.
vec2 pt(vec2 p) { return vec2(p.x, 1.0 - p.y); }
vec2 inUnit(vec2 uv) { return step(vec2(0.0), uv) * step(uv, vec2(1.0)); }
float inside01(vec2 uv) { vec2 q = inUnit(uv); return q.x * q.y; }
`,
  },
  // Perceptual (sRGB-shaped) encoding with linear extension above 1.0 and odd
  // symmetry below 0, so HDR and out-of-gamut values survive a round trip.
  perc: {
    code: /* glsl */ `
float encP(float x) {
  float a = abs(x);
  float y = a <= 0.0031308 ? 12.92 * a : (a < 1.0 ? 1.055 * pow(a, 1.0 / 2.4) - 0.055 : 1.0 + (a - 1.0) * 0.4395833);
  return x < 0.0 ? -y : y;
}
float decP(float y) {
  float a = abs(y);
  float x = a <= 0.04045 ? a / 12.92 : (a < 1.0 ? pow((a + 0.055) / 1.055, 2.4) : 1.0 + (a - 1.0) / 0.4395833);
  return y < 0.0 ? -x : x;
}
vec3 toPerc(vec3 c) { return vec3(encP(c.r), encP(c.g), encP(c.b)); }
vec3 fromPerc(vec3 c) { return vec3(decP(c.r), decP(c.g), decP(c.b)); }
`,
  },
  // ACEScct-style log encoding (18% grey ≈ 0.4135). Used for film-like math.
  log: {
    code: /* glsl */ `
vec3 linToLog(vec3 x) {
  vec3 lo = 10.5402377 * x + 0.0729055;
  vec3 hi = (log2(max(x, vec3(1e-10))) + 9.72) / 17.52;
  return mix(lo, hi, step(vec3(0.0078125), x));
}
vec3 logToLin(vec3 y) {
  vec3 lo = (y - 0.0729055) / 10.5402377;
  vec3 hi = exp2(min(y, vec3(3.0)) * 17.52 - 9.72);
  return mix(lo, hi, step(vec3(0.1552511), y));
}
`,
  },
  // BT.709 Y'CbCr on perceptual values.
  ycc: {
    code: /* glsl */ `
vec3 rgb2ycc(vec3 c) {
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return vec3(y, (c.b - y) / 1.8556, (c.r - y) / 1.5748);
}
vec3 ycc2rgb(vec3 v) {
  float r = v.x + 1.5748 * v.z;
  float b = v.x + 1.8556 * v.y;
  float g = (v.x - 0.2126 * r - 0.0722 * b) / 0.7152;
  return vec3(r, g, b);
}
`,
  },
  noise: {
    code: /* glsl */ `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
// Value noise 0..1
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Gradient noise, roughly -1..1
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 ga = hash22(i) * 2.0 - 1.0;
  vec2 gb = hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0;
  vec2 gc = hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0;
  vec2 gd = hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0;
  float va = dot(ga, f);
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));
  return 1.6 * mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y);
}
float fbm(vec2 p, int octaves) {
  float s = 0.0;
  float a = 0.5;
  float n = 0.0;
  for (int i = 0; i < 10; i++) {
    if (i >= octaves) break;
    s += a * gnoise(p);
    n += a;
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.13;
    a *= 0.5;
  }
  return s / max(n, 1e-4);
}
`,
  },
  // Spectral weights for chromatic fringes: t in 0..1 (red → violet). The
  // weights of N evenly spaced samples sum to roughly equal per channel; the
  // caller normalizes.
  spectral: {
    code: /* glsl */ `
vec3 spectralW(float t) {
  vec3 w = vec3(
    sat01(1.6 - abs(t - 0.0) * 2.6) + 0.15 * sat01(1.0 - abs(t - 1.0) * 3.0),
    sat01(1.3 - abs(t - 0.5) * 2.6),
    sat01(1.6 - abs(t - 1.0) * 2.6)
  );
  return max(w, vec3(0.0));
}
`,
    deps: ['util'],
  },
  // Blend modes on perceptual values (b = base, s = blend layer). Index order
  // matches BLEND_MODES in glsl.ts.
  blend: {
    deps: ['util'],
    code: /* glsl */ `
vec3 softLightC(vec3 b, vec3 s) {
  vec3 d = mix(sqrt(max(b, 0.0)), ((16.0 * b - 12.0) * b + 4.0) * b, step(b, vec3(0.25)));
  return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(vec3(0.5), s));
}
vec3 overlayC(vec3 b, vec3 s) {
  return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(vec3(0.5), b));
}
vec3 blendMode(int m, vec3 b, vec3 s) {
  if (m == 1) return b * s;
  if (m == 2) return 1.0 - (1.0 - b) * (1.0 - s);
  if (m == 3) return overlayC(clamp(b, 0.0, 1.0), clamp(s, 0.0, 1.0));
  if (m == 4) return softLightC(clamp(b, 0.0, 1.0), clamp(s, 0.0, 1.0));
  if (m == 5) return b + s;
  if (m == 6) return abs(b - s);
  if (m == 7) return min(b, s);
  if (m == 8) return max(b, s);
  if (m == 9) return max(s - vec3(luma(s)) + vec3(luma(b)), 0.0);
  return s;
}
`,
  },
  // Clamped / transparent-edge sampling of the effect input.
  taps: {
    code: /* glsl */ `
vec4 tapC(vec2 uv) { return texture(u_src, clamp(uv, 0.5 * u_texel, 1.0 - 0.5 * u_texel)); }
vec4 tapT(vec2 uv) {
  vec2 q = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return texture(u_src, clamp(uv, 0.5 * u_texel, 1.0 - 0.5 * u_texel)) * (q.x * q.y);
}
vec4 origC(vec2 uv) { return texture(u_orig, clamp(uv, 0.5 * u_texel, 1.0 - 0.5 * u_texel)); }
vec4 origT(vec2 uv) {
  vec2 q = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return texture(u_orig, clamp(uv, 0.5 * u_texel, 1.0 - 0.5 * u_texel)) * (q.x * q.y);
}
`,
  },
};

/** Blend-mode labels for `blendMode()` (index = GLSL int). */
export const BLEND_MODES = ['Normal', 'Multiply', 'Screen', 'Overlay', 'Soft light', 'Add', 'Difference', 'Darken', 'Lighten', 'Color'];

/** Builds pass GLSL: requested snippets (deps first, once each) + body. */
export function glsl(uses: string[], body: string): string {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    const s = S[name];
    if (!s) throw new Error(`Unknown GLSL snippet: ${name}`);
    seen.add(name);
    for (const d of s.deps ?? []) visit(d);
    out.push(s.code.trim());
  };
  for (const u of uses) visit(u);
  out.push(body.trim());
  return out.join('\n');
}

/** Formats a JS number as a GLSL float literal. */
export function f(v: number): string {
  if (!Number.isFinite(v)) return '0.0';
  const s = String(Math.round(v * 1e6) / 1e6);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
}

// ---------------------------------------------------------------------------
// Pass cache: expand() runs every frame, so it must return the SAME pass
// objects (and GLSL strings) for the same configuration. The renderer caches
// compiled programs by source.
// ---------------------------------------------------------------------------

const passCache = new Map<string, EffectPass>();

export function memoPass(key: string, make: () => EffectPass): EffectPass {
  let p = passCache.get(key);
  if (!p) {
    p = make();
    passCache.set(key, p);
  }
  return p;
}

export function pass(glslSrc: string, scale?: number): EffectPass {
  return scale ? { glsl: glslSrc, scale } : { glsl: glslSrc };
}

/** A pass that copies its input (used when an effect has nothing to do). */
export const COPY_PASS: EffectPass = { glsl: 'vec4 effect(vec2 uv) { return src(uv); }' };

// ---------------------------------------------------------------------------
// Multi-level separable Gaussian
// ---------------------------------------------------------------------------
// A large Gaussian is split into levels. Level k samples at a spacing of 2^k
// texels; every level except the last applies a fixed σ_k = 1.5·2^k, so its
// input is already band-limited enough for sparse taps not to alias. The last
// level carries the remaining variance (σ² − Σσ_k²), so the total blur is a
// continuous function of the radius however many levels are used. σ may vary
// per pixel (tilt-shift, lens effects): each pass recomputes the split from
// the GLSL expression, and levels above what a pixel needs pass through.

const FIXED = (k: number) => 1.5 * 2 ** k;
const LAST_CAP = (k: number) => 2.6 * 2 ** k;
export const MAX_LEVELS = 11;

/** Number of levels needed for a total σ (layer px). Pure; unit-tested. */
export function gaussLevels(sigma: number): number {
  const v = Math.max(0, sigma) ** 2;
  let fixed = 0;
  for (let L = 1; L <= MAX_LEVELS; L++) {
    const cap = LAST_CAP(L - 1);
    if (v - fixed <= cap * cap) return L;
    fixed += FIXED(L - 1) ** 2;
  }
  return MAX_LEVELS;
}

/** Variance actually realized by the chain for a σ (for tests): Σ fixed + last. */
export function gaussChainSigma(sigma: number): number {
  const L = gaussLevels(sigma);
  let v = sigma * sigma;
  let total = 0;
  for (let k = 0; k < L - 1; k++) {
    const take = Math.min(FIXED(k) ** 2, Math.max(v, 0));
    v -= take;
    total += take;
  }
  const lastCap = LAST_CAP(L - 1) ** 2;
  total += Math.min(Math.max(v, 0), lastCap);
  return Math.sqrt(total);
}

export interface ChainOpts {
  /** Cache namespace (unique per effect + chain). */
  id: string;
  /** GLSL float expression: total σ in layer px. May use uv, uniforms and `helpers`. */
  sigma: string;
  /** Sampling function used by the taps: 'tapC' (clamp), 'tapT' (transparent) or a custom name defined in helpers. */
  tap?: string;
  /** Extra GLSL (functions) the sigma expression or tap needs. */
  helpers?: string;
  /** Snippets the helpers need. */
  uses?: string[];
}

function chainPass(o: ChainOpts, dir: [number, number], level: number, last: boolean): EffectPass {
  const key = `gauss|${o.id}|${dir[0]},${dir[1]}|${level}|${last ? 1 : 0}`;
  return memoPass(key, () => {
    const spacing = 2 ** level;
    const nt = last ? 9 : 5;
    const tap = o.tap ?? 'tapC';
    return pass(
      glsl(
        ['taps', ...(o.uses ?? [])],
        `${o.helpers ?? ''}
const int LEVEL = ${level};
const bool LAST = ${last ? 'true' : 'false'};
const vec2 DIR = vec2(${f(dir[0])}, ${f(dir[1])});
const float SPACING = ${f(spacing)};
float levelSigma(float total) {
  float v = total * total;
  for (int k = 0; k < ${MAX_LEVELS}; k++) {
    if (k >= LEVEL) break;
    float fk = 1.5 * exp2(float(k));
    v -= min(fk * fk, max(v, 0.0));
  }
  v = max(v, 0.0);
  if (LAST) return sqrt(v);
  float fl = 1.5 * exp2(float(LEVEL));
  return sqrt(min(v, fl * fl));
}
vec4 effect(vec2 uv) {
  float s = levelSigma(max(${o.sigma}, 0.0)) / SPACING;
  vec4 c = ${tap}(uv);
  if (s < 0.2) return c;
  float k = -0.5 / (s * s);
  vec2 st = DIR * u_texel * SPACING;
  vec4 acc = c;
  float ws = 1.0;
  for (int i = 1; i <= ${nt}; i++) {
    float fi = float(i);
    if (fi > 3.0 * s + 1.0) break;
    float w = exp(fi * fi * k);
    acc += w * (${tap}(uv + st * fi) + ${tap}(uv - st * fi));
    ws += 2.0 * w;
  }
  return acc / ws;
}`,
      ),
    );
  });
}

/**
 * Passes for a Gaussian of σ (layer px; the max σ when it varies per pixel).
 * `dirs` lists the 1D directions (unit vectors in texel space) applied per level.
 */
export function gaussChain(o: ChainOpts, sigmaPx: number, dirs: [number, number][] = [[1, 0], [0, 1]]): EffectPass[] {
  if (!(sigmaPx > 0.05) || dirs.length === 0) return [];
  const L = gaussLevels(sigmaPx);
  const out: EffectPass[] = [];
  for (let k = 0; k < L; k++) for (const d of dirs) out.push(chainPass(o, d, k, k === L - 1));
  return out;
}

/** Reads a number param with a fallback. */
export function pn(params: Record<string, number | boolean | string>, key: string, fallback = 0): number {
  const v = params[key];
  const n = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
