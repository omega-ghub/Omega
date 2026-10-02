// Grade operations as pure recipes on immer drafts (no store access), so
// they are unit-testable and each runs inside ONE labeled mutate() call.
import { clearKeyframes, isAnimated, paramAt, setParam } from '../../../engine/keyframes';
import type { RGB } from '../../../engine/scopes/analysis';
import { defaultGrade } from '../../../state/defaults';
import type { Clip, ColorGrade, InputTransform, Project, RGBY } from '../../../state/types';
import { OFFSET_SCALE } from './gradeModel';
import { lookOps, type LookDef } from './looks';

export const WHEELS = ['lift', 'gamma', 'gain', 'offset'] as const;
export type WheelName = (typeof WHEELS)[number];

export const SCALAR_PATHS = ['exposure', 'temperature', 'tint', 'contrast', 'pivot', 'saturation', 'vibrance', 'highlights', 'shadows'] as const;
export type ScalarName = (typeof SCALAR_PATHS)[number];

/** Every keyframeable grade param path. */
export const GRADE_PARAM_PATHS: string[] = [
  ...SCALAR_PATHS.map((k) => `grade.${k}`),
  ...WHEELS.flatMap((w) => ['r', 'g', 'b', 'y'].map((c) => `grade.${w}.${c}`)),
  'grade.lut.intensity',
];

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
 * and tint get the solved deltas, and any residual multiplier (beyond the
 * slider range) goes into the per-channel gain:
 *   (1 + gain.c + gain.y)·residual_c = 1 + gain′.c + gain.y
 */
export function applyWhiteBalanceTo(clip: Clip, local: number, sol: { temperature: number; tint: number; residual: RGB }): void {
  const t = paramAt(clip, 'grade.temperature', local);
  const n = paramAt(clip, 'grade.tint', local);
  setParam(clip, 'grade.temperature', local, r4(clamp(t + sol.temperature, -100, 100)));
  setParam(clip, 'grade.tint', local, r4(clamp(n + sol.tint, -100, 100)));
  if (sol.residual.some((r) => Math.abs(r - 1) > 0.005)) {
    const gy = paramAt(clip, 'grade.gain.y', local);
    (['r', 'g', 'b'] as const).forEach((c, k) => {
      const gc = paramAt(clip, `grade.gain.${c}`, local);
      setParam(clip, `grade.gain.${c}`, local, r4(clamp((1 + gc + gy) * sol.residual[k] - 1 - gy, -1, 1)));
    });
  }
  clip.grade.enabled = true;
}

/**
 * Applies a shot-match solution (x′ = g·x + o per channel, then saturation)
 * on top of the current grade at clip-local time `local`:
 *   gain:   (1 + gain′.c + gain.y)   = g_c · (1 + gain.c + gain.y)
 *   offset: (offset′.c + offset.y)·k = g_c · (offset.c + offset.y)·k + o_c   (k = OFFSET_SCALE)
 *   saturation′ = saturation · s
 */
export function applyMatchTo(clip: Clip, local: number, sol: { gain: RGB; offset: RGB; saturation: number }): void {
  const gy = paramAt(clip, 'grade.gain.y', local);
  const oy = paramAt(clip, 'grade.offset.y', local);
  (['r', 'g', 'b'] as const).forEach((c, k) => {
    const gc = paramAt(clip, `grade.gain.${c}`, local);
    setParam(clip, `grade.gain.${c}`, local, r4(clamp(sol.gain[k] * (1 + gc + gy) - 1 - gy, -1, 1)));
    const oc = paramAt(clip, `grade.offset.${c}`, local);
    setParam(clip, `grade.offset.${c}`, local, r4(clamp((sol.gain[k] * (oc + oy) * OFFSET_SCALE + sol.offset[k]) / OFFSET_SCALE - oy, -1, 1)));
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

/** True when any wheel/scalar is animated (shows the clip has a grade animation). */
export function hasGradeAnimation(clip: Clip): boolean {
  return GRADE_PARAM_PATHS.some((p) => isAnimated(clip, p));
}

/** Turns animation of several paths off at once (keeping the value at `local`). */
export function clearPaths(clip: Clip, paths: string[], local: number): void {
  for (const p of paths) clearKeyframes(clip, p, local);
}
