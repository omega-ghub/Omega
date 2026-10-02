// The effect & transition registry. The effects library registers its
// definitions at import time (see engine/effects/library/index.ts); the
// renderer and the UI look them up by type.

import { EFFECTS, TRANSITIONS } from './library';
import type { EffectDef, ParamDef, TransitionDef } from './types';
import type { EffectInstance } from '../../state/types';
import { newId } from '../../state/types';

const effects = new Map<string, EffectDef>();
const transitions = new Map<string, TransitionDef>();

export function registerEffect(def: EffectDef) {
  effects.set(def.type, def);
}
export function registerTransition(def: TransitionDef) {
  transitions.set(def.type, def);
}

for (const e of EFFECTS) registerEffect(e);
for (const t of TRANSITIONS) registerTransition(t);

export function getEffect(type: string): EffectDef | undefined {
  return effects.get(type);
}
export function listEffects(): EffectDef[] {
  return [...effects.values()];
}
export function getTransition(type: string): TransitionDef | undefined {
  return transitions.get(type);
}
export function listTransitions(): TransitionDef[] {
  return [...transitions.values()];
}

export function defaultParams(params: ParamDef[]): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = {};
  for (const p of params) out[p.key] = p.default;
  return out;
}

/** Creates a new effect instance with default params. */
export function instantiateEffect(type: string): EffectInstance {
  const def = getEffect(type);
  if (!def) throw new Error(`Unknown effect: ${type}`);
  return { id: newId('fx'), type, enabled: true, params: defaultParams(def.params) };
}
