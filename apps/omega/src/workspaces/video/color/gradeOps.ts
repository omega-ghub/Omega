// Grade operations as pure recipes on immer drafts (no store access), so
// they are unit-testable and each runs inside ONE labeled mutate() call.
import { paramAt, setParam } from '../../../engine/keyframes';
import type { RGB } from '../../../engine/scopes/analysis';
import { defaultGrade } from '../../../state/defaults';
import type { Clip, ColorGrade, InputTransform, Project, RGBY } from '../../../state/types';
import { LOG_BLACK, WHEEL } from '../../../engine/color/grade';
import { gainForMultiplier, LOG_SPAN, offsetForMultiplier, offsetForShift } from './gradeModel';
import { lookOps, type LookDef } from './looks';

export const WHEELS = ['lift', 'gamma', 'gain', 'offset'] as const;
export type WheelName = (typeof WHEELS)[number];

export const SCALAR_PATHS = ['exposure', 'temperature', 'tint', 'contrast', 'pivot', 'saturation', 'vibrance', 'highlights', 'shadows'] as const;
export type ScalarName = (typeof SCALAR_PATHS)[number];

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Drops every grade keyframe (the static values stay as they are). */
export function clearGradeKeyframes(clip: Clip): void {
  for (const p of Object.keys(clip.keyframes)) if (p.startsWith('grade.')) delete clip.keyframes[p];
}

/** The grade as seen at clip-local time `local`, with animated values resolved. */
export function gradeSnapshot(clip: Clip, local: number): ColorGrade {
  const g: ColorGrade = structuredClone(clip.grade);
  for (const k of SCALAR_PATHS) g[k] = paramAt(clip, `grade.${k}`, local);
  for (const w of WHEELS) for (const c of ['r', 'g', 'b', 'y'] as const) g[w][c] = paramAt(clip, `grade.${w}.${c}`, local);
  g.lut.intensity = paramAt(clip, 'grade.lut.intensity', local);
  return g;
}

/** Pastes a grade: everything except the clip's own input transform (a property of its source). */
export function pasteGradeInto(clip: Clip, grade: ColorGrade): void {
  clearGradeKeyframes(clip);
  clip.grade = { ...structuredClone(grade), inputTransform: clip.grade.inputTransform };
}

/** Resets the grade to neutral, keeping the clip's input transform. */
export function resetGradeOf(clip: Clip): void {
  clearGradeKeyframes(clip);
  clip.grade = { ...defaultGrade(), inputTransform: clip.grade.inputTransform };
}

/**
 * Maps a param through `f` everywhere it lives: the static value, or every
 * keyframe when it is animated (so a look shifts an animation instead of
 * being hidden by it).
 */
export function mapParam(clip: Clip, path: string, f: (v: number) => number): void {
  const kfs = clip.keyframes[path];
  if (kfs?.length) {
    for (const k of kfs) k.v = f(k.v);
    return;
  }
  setParam(clip, path, 0, f(paramAt(clip, path, 0)));
}

/** Layers a look over the clip's grade (see looks.ts for the rules). */
export function applyLookTo(clip: Clip, look: LookDef): void {
  for (const { path, f } of lookOps(look)) mapParam(clip, path, f);
  for (const [k, pts] of Object.entries(look.curves ?? {})) clip.grade.curves[k as 'master'] = pts!.map((p) => ({ ...p }));
  clip.grade.enabled = true;
}

/** Sets the source's input transform and returns its clips to 'auto' (everywhere in the project). */
export function setSourceInputTransform(project: Project, assetId: string, it: InputTransform): number {
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) return 0;
  asset.inputTransform = it === 'auto' ? 'rec709' : it;
  let n = 0;
  for (const seq of project.sequences)
    for (const tr of seq.tracks)
      for (const c of tr.clips)
        if (c.assetId === assetId && c.grade.inputTransform !== 'auto') {
          c.grade.inputTransform = 'auto';
          n++;
        }
  return n;
}

/** Copies a grade to every other clip of the same source (all sequences). Returns the count. */
export function applyGradeToSource(project: Project, assetId: string, grade: ColorGrade, exceptClipId: string): number {
  let n = 0;
  for (const seq of project.sequences)
    for (const tr of seq.tracks) {
      if (tr.kind !== 'video') continue;
      for (const c of tr.clips)
        if (c.assetId === assetId && c.id !== exceptClipId) {
          pasteGradeInto(c, grade);
          n++;
        }
    }
  return n;
}

/** Effective input transform of a clip (what the renderer will use). */
export function effectiveInputTransform(clip: Clip, project: Project): InputTransform {
  if (clip.grade.inputTransform !== 'auto') return clip.grade.inputTransform;
  if (clip.kind !== 'media') return clip.kind === 'adjustment' || clip.kind === 'sequence' ? 'linear' : 'srgb';
  const asset = project.assets.find((a) => a.id === clip.assetId);
  const it = asset?.inputTransform ?? 'auto';
  return it === 'auto' ? (asset?.kind === 'image' ? 'srgb' : 'rec709') : it;
}

// ---------------------------------------------------------------------------
// Measured corrections → parameters
// ---------------------------------------------------------------------------

/**
 * Applies an auto-balance solution at clip-local time `local`: temperature
 * and tint are set to the solved values, and any residual multiplier the
 * sliders could not reach goes to the per-channel Offset (in the log grading
 * space an offset is exactly a linear-light multiplier):
 *   offset′.c = offset.c + log2(residual_c) / (17.52 · span · WHEEL.offset)
 */
export function applyWhiteBalanceTo(clip: Clip, local: number, sol: { temperature: number; tint: number; residual: RGB }): void {
  setParam(clip, 'grade.temperature', local, r4(clamp(sol.temperature, -100, 100)));
  setParam(clip, 'grade.tint', local, r4(clamp(sol.tint, -100, 100)));
  if (sol.residual.some((r) => Math.abs(r - 1) > 0.004)) {
    (['r', 'g', 'b'] as const).forEach((c, k) => {
      const oc = paramAt(clip, `grade.offset.${c}`, local);
      setParam(clip, `grade.offset.${c}`, local, r4(clamp(oc + offsetForMultiplier(sol.residual[k]), -1, 1)));
    });
  }
  clip.grade.enabled = true;
}

/**
 * Applies a shot-match solution solved in the wheels' normalized log domain
 * (x′ = g·x + o per channel, then saturation) on top of the current grade.
 *
 * The log stage is: contrast around the pivot, then per channel n·G + O
 * (G = 2^((y+c)·gainStops), O = (y+c)·WHEEL.offset), then saturation. The
 * common part of the scale, k = ∛(g_r·g_g·g_b), goes to Contrast (wide range);
 * in n units contrast·k maps n → k·n + d with d = (pivot − LOG_BLACK)(1 − k)/span.
 * The per-channel rest g′ = g/k goes to Gain and the offsets absorb d:
 *   contrast′ = contrast·k
 *   G′ = g′·G                   →  gain′.c   = log2(G′)/gainStops − gain.y
 *   O′ = g·O + o − G′·d         →  offset′.c = O′/WHEEL.offset − offset.y
 *   saturation′ = saturation · s
 * Exact while lift and gamma are neutral; a close first step otherwise (run
 * Match again to refine).
 */
export function applyMatchTo(clip: Clip, local: number, sol: { gain: RGB; offset: RGB; saturation: number }): void {
  const C = paramAt(clip, 'grade.contrast', local);
  const pivot = paramAt(clip, 'grade.pivot', local);
  const kWant = Math.cbrt(Math.max(1e-6, sol.gain[0] * sol.gain[1] * sol.gain[2]));
  const C2 = r4(clamp(C * kWant, 0.05, 4));
  const k = C > 1e-6 ? C2 / C : 1;
  setParam(clip, 'grade.contrast', local, C2);
  const d = ((pivot - LOG_BLACK) * (1 - k)) / LOG_SPAN;
  const gy = paramAt(clip, 'grade.gain.y', local);
  const oy = paramAt(clip, 'grade.offset.y', local);
  (['r', 'g', 'b'] as const).forEach((c, i) => {
    const gc = paramAt(clip, `grade.gain.${c}`, local);
    const gc2 = r4(clamp(gc + gainForMultiplier(sol.gain[i] / k), -1, 1));
    setParam(clip, `grade.gain.${c}`, local, gc2);
    const G2 = Math.pow(2, (gy + gc2) * WHEEL.gainStops);
    const oc = paramAt(clip, `grade.offset.${c}`, local);
    const O = (oy + oc) * WHEEL.offset;
    const O2 = sol.gain[i] * O + sol.offset[i] - G2 * d;
    setParam(clip, `grade.offset.${c}`, local, r4(clamp(offsetForShift(O2) - oy, -1, 1)));
  });
  const s = paramAt(clip, 'grade.saturation', local);
  setParam(clip, 'grade.saturation', local, r4(clamp(s * sol.saturation, 0, 4)));
  clip.grade.enabled = true;
}

// ---------------------------------------------------------------------------
// Wheels: puck position ↔ r/g/b balance
// ---------------------------------------------------------------------------

/**
 * Chroma (Cb/Cr, Rec.709) at the edge of a wheel. The wheel is oriented like
 * the vectorscope, so pushing a wheel towards red moves the trace towards
 * the red target.
 */
export const WHEEL_CHROMA = 0.3;

/** r/g/b balance (zero luma) for a puck position in the unit disc (x right, y up). */
export function puckToRgb(x: number, y: number): { r: number; g: number; b: number } {
  const cb = x * WHEEL_CHROMA;
  const cr = y * WHEEL_CHROMA;
  const r = 1.5748 * cr;
  const b = 1.8556 * cb;
  const g = -(0.2126 * r + 0.0722 * b) / 0.7152;
  return { r: r4(r), g: r4(g), b: r4(b) };
}

/** Puck position of an r/g/b balance (its luma component is ignored). */
export function rgbToPuck(c: Pick<RGBY, 'r' | 'g' | 'b'>): { x: number; y: number; luma: number } {
  const luma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return { x: (c.b - luma) / 1.8556 / WHEEL_CHROMA, y: (c.r - luma) / 1.5748 / WHEEL_CHROMA, luma };
}
