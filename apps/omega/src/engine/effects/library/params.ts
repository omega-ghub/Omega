// Terse constructors for ParamDefs. Every built-in effect declares its params
// through these so labels, units and ranges stay consistent across the library.
//
// Conventions (shared with the EffectStack UI):
//   * percentages are stored as 0..100 and divided by 100 in GLSL
//   * angles are degrees; 0° points right, positive angles turn counter-clockwise
//   * points are 'x,y' in layer-normalized IMAGE coordinates (0,0 = top-left,
//     y grows downward). Shaders flip y (see `pt()` in glsl.ts) because v_uv
//     has its origin at the bottom-left.
//   * choice values equal their index, so the GLSL int and `value` agree.
import type { ParamDef } from '../types';

type Opts = Partial<Omit<ParamDef, 'key' | 'label' | 'type' | 'default'>>;

export function num(key: string, label: string, def: number, o: Opts = {}): ParamDef {
  return { key, label, type: 'number', default: def, step: 0.01, ...o };
}

/** 0..100 % (soft range can be overridden). */
export function pct(key: string, label: string, def: number, o: Opts = {}): ParamDef {
  return { key, label, type: 'number', default: def, min: 0, max: 100, step: 0.1, unit: '%', ...o };
}

/** Signed −100..100 %. */
export function spct(key: string, label: string, def: number, o: Opts = {}): ParamDef {
  return { key, label, type: 'number', default: def, min: -100, max: 100, step: 0.1, unit: '%', ...o };
}

/** Pixels (layer pixels). */
export function px(key: string, label: string, def: number, o: Opts = {}): ParamDef {
  return { key, label, type: 'number', default: def, min: 0, step: 0.1, unit: 'px', ...o };
}

export function ang(key: string, label: string, def: number, o: Opts = {}): ParamDef {
  return { key, label, type: 'angle', default: def, step: 0.1, unit: '°', ...o };
}

export function bool(key: string, label: string, def: boolean, o: Opts = {}): ParamDef {
  return { key, label, type: 'bool', default: def, animatable: false, ...o };
}

export function choice(key: string, label: string, def: number, labels: string[], o: Opts = {}): ParamDef {
  return { key, label, type: 'choice', default: def, choices: labels.map((l, i) => ({ value: i, label: l })), animatable: false, ...o };
}

export function color(key: string, label: string, def: string, o: Opts = {}): ParamDef {
  return { key, label, type: 'color', default: def, animatable: false, ...o };
}

export function point(key: string, label: string, def: string, o: Opts = {}): ParamDef {
  return { key, label, type: 'point', default: def, animatable: false, ...o };
}

/** Speed in cycles (or units) per second; used by animated generators. */
export function hz(key: string, label: string, def: number, o: Opts = {}): ParamDef {
  return { key, label, type: 'number', default: def, min: 0, max: 60, softMax: 10, step: 0.01, unit: 'Hz', ...o };
}
