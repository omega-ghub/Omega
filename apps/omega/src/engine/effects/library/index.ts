// Built-in effects and transitions. OWNED BY THE EFFECTS PACKAGE.
// Each definition follows the contract in ../types.ts. Categories live in
// their own files; shared GLSL helpers are in glsl.ts and param constructors
// in params.ts. Validate every change with `npm run test:effects`.
import type { EffectDef, TransitionDef } from '../types';
import { BLUR_EFFECTS } from './blur';
import { COLOR_EFFECTS } from './color';
import { DISTORT_EFFECTS } from './distort';
import { FILM_EFFECTS } from './film';
import { GENERATE_EFFECTS } from './generate';
import { KEYING_EFFECTS } from './keying';
import { LIGHT_EFFECTS } from './light';
import { STYLIZE_EFFECTS } from './stylize';
import { ALL_TRANSITIONS } from './transitions';

export const EFFECTS: EffectDef[] = [
  ...BLUR_EFFECTS,
  ...COLOR_EFFECTS,
  ...STYLIZE_EFFECTS,
  ...DISTORT_EFFECTS,
  ...KEYING_EFFECTS,
  ...LIGHT_EFFECTS,
  ...FILM_EFFECTS,
  ...GENERATE_EFFECTS,
];

export const TRANSITIONS: TransitionDef[] = ALL_TRANSITIONS;
