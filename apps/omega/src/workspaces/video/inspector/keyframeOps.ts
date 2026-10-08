// Pure keyframe list operations used by the keyframe lane, the graph editor
// and the keyframe actions. Lists are sorted by t; functions never mutate
// their inputs (except the *Draft helpers, which run on immer drafts).

import { evaluate, KEY_TOLERANCE, setStatic } from '../../../engine/keyframes';
import type { Clip, Ease, EaseParams, Keyframe } from '../../../state/types';

export type Bez = [number, number, number, number];

/** Control points of an ease, for drawing and editing handles. Linear = straight diagonal. */
export function easeControlPoints(ease: Ease, bez?: Bez): Bez | null {
  switch (ease) {
    case 'linear':
      return [1 / 3, 1 / 3, 2 / 3, 2 / 3];
    case 'easeIn':
      return [0.42, 0, 1, 1];
    case 'easeOut':
      return [0, 0, 0.58, 1];
    case 'easeInOut':
      return [0.42, 0, 0.58, 1];
    case 'bezier':
      return bez ?? [0.25, 0.1, 0.25, 1];
    case 'hold':
    case 'back':
    case 'elastic':
    case 'bounce':
    case 'spring':
      return null; // no bezier handles: the curve comes from physics (engine/motion.ts)
  }
}

const near = (a: number, b: number) => Math.abs(a - b) <= KEY_TOLERANCE;

export function sortKeys(list: Keyframe[]): Keyframe[] {
  return [...list].sort((a, b) => a.t - b.t);
}

/**
 * Moves the keys whose (original) times are in `selected` by `dt` and adds
 * `dv` to their values. Keys landing on an unselected key replace it.
 * `minT`/`maxT` clamp the moved keys (the clip range).
 */
export function moveKeys(list: Keyframe[], selected: number[], dt: number, dv = 0, minT = -Infinity, maxT = Infinity): Keyframe[] {
  const isSel = (k: Keyframe) => selected.some((t) => near(t, k.t));
  const moved = list.filter(isSel).map((k) => ({ ...k, t: Math.min(maxT, Math.max(minT, k.t + dt)), v: k.v + dv }));
  const rest = list.filter((k) => !isSel(k) && !moved.some((m) => near(m.t, k.t)));
  return sortKeys([...rest, ...moved]);
}

/** Removes keys at the given times. */
export function deleteKeys(list: Keyframe[], times: number[]): Keyframe[] {
  return list.filter((k) => !times.some((t) => near(t, k.t)));
}

/** Sets the ease (outgoing interpolation) of keys at the given times. */
export function setKeysEase(list: Keyframe[], times: number[], ease: Ease, bez?: Bez, ezp?: EaseParams): Keyframe[] {
  return list.map((k) => {
    if (!times.some((t) => near(t, k.t))) return k;
    const next: Keyframe = { ...k, ease };
    if (ease === 'bezier') next.bez = bez ?? (k.bez as Bez | undefined) ?? [0.25, 0.1, 0.25, 1];
    else delete next.bez;
    if (ezp && Object.keys(ezp).length) next.ezp = { ...ezp };
    else delete next.ezp;
    return next;
  });
}

export interface KeyClipboardEntry {
  path: string;
  /** Seconds relative to the earliest copied key. */
  dt: number;
  v: number;
  ease: Ease;
  bez?: Bez;
}

/** Copies the selected keys of a clip (times relative to the earliest one). */
export function copyKeys(clip: Clip, selection: { path: string; t: number }[]): KeyClipboardEntry[] {
  const picked: { path: string; k: Keyframe }[] = [];
  for (const s of selection) {
    const k = clip.keyframes[s.path]?.find((x) => near(x.t, s.t));
    if (k) picked.push({ path: s.path, k });
  }
  if (!picked.length) return [];
  const t0 = Math.min(...picked.map((p) => p.k.t));
  return picked.map(({ path, k }) => ({ path, dt: k.t - t0, v: k.v, ease: k.ease, bez: k.bez as Bez | undefined }));
}

/** Inserts clipboard keys at clip-local time `at` (replacing keys at the same times). */
export function pasteKeys(list: Keyframe[], entries: KeyClipboardEntry[], at: number, maxT = Infinity): Keyframe[] {
  let out = [...list];
  for (const e of entries) {
    const t = Math.min(maxT, Math.max(0, at + e.dt));
    out = out.filter((k) => !near(k.t, t));
    out.push({ t, v: e.v, ease: e.ease, ...(e.bez ? { bez: [...e.bez] as Bez } : {}) });
  }
  return sortKeys(out);
}

/**
 * Writes a new key list for a path on a clip draft. An empty list stops the
 * animation, keeping the value the param had at `keepAt` as its static value.
 */
export function writeKeysDraft(clip: Clip, path: string, list: Keyframe[], keepAt: number): void {
  if (list.length) {
    clip.keyframes[path] = list;
    return;
  }
  const before = clip.keyframes[path];
  if (before?.length) setStatic(clip, path, evaluate(before, keepAt));
  delete clip.keyframes[path];
}

/** Value range of a key list padded for a graph view (never zero height). */
export function valueRange(list: Keyframe[], samples: number[] = []): { min: number; max: number } {
  const vals = [...list.map((k) => k.v), ...samples];
  if (!vals.length) return { min: 0, max: 1 };
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (max - min < 1e-6) {
    const pad = Math.max(1, Math.abs(max) * 0.1);
    min -= pad;
    max += pad;
  }
  const pad = (max - min) * 0.12;
  return { min: min - pad, max: max + pad };
}

/** Snaps a clip-local time to the sequence frame grid relative to the clip start. */
export function snapLocal(t: number, clipStart: number, fps: number): number {
  const frame = 1 / fps;
  const abs = clipStart + t;
  return Math.round(abs / frame) * frame - clipStart;
}
