// Built-in effects and transitions. OWNED BY THE EFFECTS PACKAGE.
// Each definition follows the contract in ../types.ts.
import type { EffectDef, TransitionDef } from '../types';
import { BLUR_EFFECTS } from './blur';
import { COLOR_EFFECTS } from './color';

export const EFFECTS: EffectDef[] = [...BLUR_EFFECTS, ...COLOR_EFFECTS];
export const TRANSITIONS: TransitionDef[] = [];
