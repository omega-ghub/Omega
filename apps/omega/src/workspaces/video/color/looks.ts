// Built-in looks: creative grade presets expressed as parameter changes that
// LAYER over the clip's existing correction (balance stays, the look goes on
// top). Pure; unit-tested.
//
// Composition rules (`composeLook`):
//   exposure, temperature, tint, vibrance, highlights, shadows → added
//   contrast, saturation                                      → multiplied
//   pivot                                                     → replaced (if the look sets it)
//   lift / gamma / gain / offset (r, g, b, y)                  → added
//   curves (per channel)                                      → replaced (if the look sets it)
// Values are clamped to each parameter's legal range.
import type { ColorGrade, CurvePoint, RGBY } from '../../../state/types';

export interface LookDef {
  id: string;
  name: string;
  /** One line shown in the tooltip. */
  description: string;
  add?: Partial<Record<'exposure' | 'temperature' | 'tint' | 'vibrance' | 'highlights' | 'shadows', number>>;
  mul?: Partial<Record<'contrast' | 'saturation', number>>;
  pivot?: number;
  wheels?: Partial<Record<'lift' | 'gamma' | 'gain' | 'offset', Partial<RGBY>>>;
  curves?: Partial<Record<'master' | 'r' | 'g' | 'b', CurvePoint[]>>;
}

const S_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 0.25, y: 0.2 },
  { x: 0.75, y: 0.8 },
  { x: 1, y: 1 },
];

export const LOOKS: LookDef[] = [
  {
    id: 'tealOrange',
    name: 'Teal & Orange',
    description: 'Warm skin against cool shadows, the blockbuster split.',
    add: { temperature: 6, vibrance: 0.15 },
    mul: { contrast: 1.12, saturation: 1.08 },
    wheels: { lift: { r: -0.05, g: 0.01, b: 0.06 }, gamma: { r: 0.015, b: -0.02 }, gain: { r: 0.06, g: 0.015, b: -0.07 } },
  },
  {
    id: 'bleachBypass',
    name: 'Bleach Bypass',
    description: 'Silver retained: low saturation, hard contrast, metallic highlights.',
    add: { highlights: -0.1, shadows: -0.08 },
    mul: { contrast: 1.32, saturation: 0.45 },
    curves: { master: [{ x: 0, y: 0 }, { x: 0.22, y: 0.16 }, { x: 0.7, y: 0.78 }, { x: 1, y: 0.98 }] },
  },
  {
    id: 'warmFilm',
    name: 'Warm Film',
    description: 'Print-film warmth with lifted, creamy blacks and a soft shoulder.',
    add: { temperature: 16, tint: 3 },
    mul: { contrast: 1.06, saturation: 0.94 },
    wheels: { lift: { r: 0.02, b: -0.02 }, gain: { r: 0.02, b: -0.03 } },
    curves: { master: [{ x: 0, y: 0.045 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.95 }] },
  },
  {
    id: 'coolNight',
    name: 'Cool Night',
    description: 'Blue, quiet and a little darker; neon-friendly.',
    add: { exposure: -0.35, temperature: -26, tint: 4 },
    mul: { contrast: 1.1, saturation: 0.82 },
    wheels: { lift: { r: -0.03, b: 0.05 } },
  },
  {
    id: 'softPastel',
    name: 'Soft Pastel',
    description: 'Airy and gentle: low contrast, lifted shadows, muted colour.',
    add: { highlights: -0.15, shadows: 0.2, exposure: 0.12 },
    mul: { contrast: 0.84, saturation: 0.78 },
    wheels: { lift: { y: 0.05 } },
  },
  {
    id: 'hcBW',
    name: 'High-Contrast B&W',
    description: 'Monochrome with deep blacks and bright whites.',
    mul: { contrast: 1.42, saturation: 0 },
    curves: { master: S_CURVE },
  },
  {
    id: 'fadedMatte',
    name: 'Faded Matte',
    description: 'Washed blacks and rolled whites, editorial and calm.',
    mul: { contrast: 0.94, saturation: 0.86 },
    curves: { master: [{ x: 0, y: 0.09 }, { x: 0.35, y: 0.34 }, { x: 1, y: 0.93 }] },
  },
  {
    id: 'goldenHour',
    name: 'Golden Hour',
    description: 'Late-sun gold with a touch of exposure and rich colour.',
    add: { exposure: 0.12, temperature: 28, tint: 5, vibrance: 0.1 },
    mul: { saturation: 1.1 },
    wheels: { gain: { r: 0.04, g: 0.015, b: -0.05 } },
  },
  {
    id: 'desatDrama',
    name: 'Desaturated Drama',
    description: 'Moody and heavy: drained colour, strong contrast, teal shadows.',
    add: { shadows: -0.15, highlights: -0.08 },
    mul: { contrast: 1.26, saturation: 0.55 },
    wheels: { lift: { r: -0.025, b: 0.03 } },
  },
  {
    id: 'vividSocial',
    name: 'Vivid Social',
    description: 'Punchy, bright and saturated for small screens.',
    add: { exposure: 0.1, vibrance: 0.35 },
    mul: { contrast: 1.12, saturation: 1.22 },
  },
  {
    id: 'log709',
    name: 'Rec.709 from Log',
    description: 'Neutral contrast and saturation restore for flat, log-looking footage.',
    mul: { contrast: 1.45, saturation: 1.3 },
    pivot: 0.435,
    curves: { master: [{ x: 0, y: 0 }, { x: 0.18, y: 0.14 }, { x: 0.82, y: 0.88 }, { x: 1, y: 1 }] },
  },
  {
    id: 'dayForNight',
    name: 'Day-for-Night',
    description: 'Turns a daylight shot into moonlight: dark, blue, desaturated.',
    add: { exposure: -1.25, temperature: -45, highlights: -0.2 },
    mul: { contrast: 1.18, saturation: 0.6 },
    wheels: { lift: { r: -0.02, b: 0.04 }, gain: { r: -0.04, b: 0.05 } },
  },
];

export const LOOK_BY_ID = new Map(LOOKS.map((l) => [l.id, l]));

/** Legal range of every look-touched scalar. */
export const RANGES: Record<string, [number, number]> = {
  exposure: [-6, 6],
  temperature: [-100, 100],
  tint: [-100, 100],
  contrast: [0, 4],
  pivot: [0, 1],
  saturation: [0, 4],
  vibrance: [-1, 1],
  highlights: [-1, 1],
  shadows: [-1, 1],
  wheel: [-1, 1],
};

const clamp = (v: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, v));
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Every param path a look touches, with a function mapping old → new value. */
export function lookOps(look: LookDef): { path: string; f: (v: number) => number }[] {
  const ops: { path: string; f: (v: number) => number }[] = [];
  for (const [k, d] of Object.entries(look.add ?? {})) ops.push({ path: `grade.${k}`, f: (v) => r4(clamp(v + d!, RANGES[k])) });
  for (const [k, m] of Object.entries(look.mul ?? {})) ops.push({ path: `grade.${k}`, f: (v) => r4(clamp(v * m!, RANGES[k])) });
  if (look.pivot !== undefined) ops.push({ path: 'grade.pivot', f: () => look.pivot! });
  for (const [w, c] of Object.entries(look.wheels ?? {})) {
    for (const [comp, d] of Object.entries(c ?? {})) ops.push({ path: `grade.${w}.${comp}`, f: (v) => r4(clamp(v + d!, RANGES.wheel)) });
  }
  return ops;
}

/** Composes a look over a static grade (used for previews and tests). */
export function composeLook(g: ColorGrade, look: LookDef): ColorGrade {
  const out: ColorGrade = structuredClone(g);
  for (const { path, f } of lookOps(look)) {
    const parts = path.split('.').slice(1);
    let obj = out as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]] as Record<string, unknown>;
    const key = parts[parts.length - 1];
    obj[key] = f(obj[key] as number);
  }
  for (const [k, pts] of Object.entries(look.curves ?? {})) out.curves[k as 'master'] = pts!.map((p) => ({ ...p }));
  return out;
}
