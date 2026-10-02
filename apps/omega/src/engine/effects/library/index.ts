// Built-in effects and transitions. OWNED BY THE EFFECTS PACKAGE.
// Each definition follows the contract in ../types.ts.
import type { EffectDef, TransitionDef } from '../types';
import { BLUR_EFFECTS } from './blur';

export const EFFECTS: EffectDef[] = [...BLUR_EFFECTS];
export const TRANSITIONS: TransitionDef[] = [];
