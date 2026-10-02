// Effect & transition CONTRACT between the effects library (which writes the
// GLSL) and the GPU renderer (which compiles and runs it).
//
// ---------------------------------------------------------------------------
// Video effects
// ---------------------------------------------------------------------------
// An effect is one or more fragment passes run on a layer, in order, BEFORE
// the layer is transformed into the frame. Every pass reads the previous
// pass's output (`u_src`) and writes RGBA:
//   * premultiplied alpha
//   * scene-linear light (Rec.709 primaries), values may exceed 1.0
//   * texture size = the layer's own pixel size (u_resolution)
//
// The renderer compiles each pass as:
//
//   #version 300 es
//   precision highp float;
//   uniform sampler2D u_src;     // output of the previous pass (or the layer)
//   uniform sampler2D u_orig;    // the layer before this effect's first pass
//   uniform vec2  u_resolution;  // layer size in px
//   uniform vec2  u_texel;       // 1.0 / u_resolution
//   uniform float u_time;        // seconds since the clip start
//   uniform float u_seed;        // per-clip random seed (0..1)
//   <one uniform per param, named u_<key>, typed per PARAM_GLSL_TYPE>
//   in vec2 v_uv;                // 0..1, origin bottom-left
//   out vec4 outColor;
//   <GLSL_PRELUDE>               // helpers below
//   <pass.glsl>                  // MUST define: vec4 effect(vec2 uv)
//   void main() { outColor = effect(v_uv); }
//
// Param → uniform mapping: number/angle → float (angles in DEGREES as typed;
// convert with radians()), bool → float (0/1), choice → int (index into
// `choices`), color → vec4 (linear RGB, straight alpha), point → vec2 (0..1
// layer-normalized).
//
// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------
//   uniform sampler2D u_from, u_to;  // both already rendered in frame space
//   uniform float u_progress;        // 0..1, eased
//   uniform vec2 u_resolution, u_texel;
//   <u_<key> per param>
//   <GLSL_PRELUDE>
//   <glsl>                            // MUST define: vec4 transition(vec2 uv)
//   void main() { outColor = transition(v_uv); }
// Inputs and output are premultiplied, scene-linear, frame-sized.

export type ParamType = 'number' | 'angle' | 'bool' | 'choice' | 'color' | 'point';

export const PARAM_GLSL_TYPE: Record<ParamType, string> = {
  number: 'float',
  angle: 'float',
  bool: 'float',
  choice: 'int',
  color: 'vec4',
  point: 'vec2',
};

export interface ParamDef {
  key: string; // [a-zA-Z][a-zA-Z0-9]* — becomes uniform u_<key>
  label: string;
  type: ParamType;
  default: number | boolean | string; // color: '#rrggbb' / '#rrggbbaa'; point: 'x,y'
  min?: number;
  max?: number;
  /** Slider range when different from min/max (soft limits). */
  softMin?: number;
  softMax?: number;
  step?: number;
  unit?: '' | 'px' | '%' | '°' | 'dB' | 's' | 'x' | 'Hz';
  choices?: { value: number; label: string }[];
  /** Numeric params are animatable unless false. */
  animatable?: boolean;
  /** One-line help text shown in the inspector. */
  hint?: string;
}

export type EffectCategory = 'Blur & Sharpen' | 'Color' | 'Stylize' | 'Distort' | 'Keying' | 'Light' | 'Film' | 'Generate' | 'Utility';

export interface EffectPass {
  glsl: string;
  /** Render this pass at a fraction of the layer size (e.g. 0.5 for cheap blurs). */
  scale?: number;
}

export interface EffectDef {
  type: string; // stable id stored in projects, e.g. 'gaussianBlur'
  name: string;
  category: EffectCategory;
  description: string;
  params: ParamDef[];
  passes: EffectPass[];
  /**
   * Optional: dynamically repeat passes (e.g. blur radius → iterations).
   * Returns the pass list to run for the given param values.
   */
  expand?: (params: Record<string, number | boolean | string>, layerSize: { w: number; h: number }) => EffectPass[];
  /** Search keywords */
  keywords?: string[];
}

export interface TransitionDef {
  type: string; // matches TransitionType
  name: string;
  category: 'Dissolve' | 'Wipe' | 'Motion' | 'Stylized';
  description: string;
  params: ParamDef[];
  glsl: string;
}

/** Helpers available to every effect / transition pass. */
export const GLSL_PRELUDE = /* glsl */ `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
float luma(vec3 c) { return dot(c, LUMA); }
vec4 src(vec2 uv) { return texture(u_src, uv); }
vec3 unpremul(vec4 c) { return c.a > 1e-5 ? c.rgb / c.a : vec3(0.0); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
`;

/** Transitions get the same prelude minus src(); renderer swaps in this alias. */
export const GLSL_TRANSITION_PRELUDE = GLSL_PRELUDE.replace('vec4 src(vec2 uv) { return texture(u_src, uv); }', '');
