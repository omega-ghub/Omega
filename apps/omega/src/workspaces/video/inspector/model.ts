// Store access helpers for the inspector (and for packages using the shared
// control kit): find the clip being edited, read animated values at the
// playhead, and write params "the way an editor expects" (keyframe when
// animated, else the static value) as one coalesced undo step per control.

import { useEditor } from '../../../state/store';
import { activeSequence, findClip } from '../../../state/types';
import type { Clip, Project, Sequence, Track } from '../../../state/types';
import { paramAt, setParam } from '../../../engine/keyframes';
import { paramLabel } from './paths';
import { clamp } from './util';

/** The clip with this id in the active sequence (non-reactive). */
export function getClip(clipId: string | null | undefined): Clip | null {
  const p = useEditor.getState().project;
  if (!p || !clipId) return null;
  return findClip(activeSequence(p), clipId)?.clip ?? null;
}

/** Reactive: the clip with this id in the active sequence (stable reference until it changes). */
export function useClip(clipId: string | null | undefined): Clip | null {
  return useEditor((s) => (s.project && clipId ? (findClip(activeSequence(s.project), clipId)?.clip ?? null) : null));
}

/** Reactive: the track holding the clip. */
export function useClipTrack(clipId: string | null | undefined): Track | null {
  return useEditor((s) => (s.project && clipId ? (findClip(activeSequence(s.project), clipId)?.track ?? null) : null));
}

/** Clip-local time of a timeline time, clamped to the clip. */
export function localTime(clip: Clip, timelineTime: number): number {
  return clamp(timelineTime - clip.start, 0, clip.duration);
}

/** Reactive: clip-local playhead time (clamped). Re-renders only when it changes. */
export function useLocalTime(clipId: string | null | undefined): number {
  return useEditor((s) => {
    if (!s.project || !clipId) return 0;
    const c = findClip(activeSequence(s.project), clipId)?.clip;
    return c ? localTime(c, s.playhead) : 0;
  });
}

/** Reactive: value of a param at the playhead (animated or static). */
export function useParam(clipId: string | null | undefined, path: string): number {
  return useEditor((s) => {
    if (!s.project || !clipId) return 0;
    const c = findClip(activeSequence(s.project), clipId)?.clip;
    return c ? paramAt(c, path, localTime(c, s.playhead)) : 0;
  });
}

/** Runs `recipe` on the clip's draft inside one labeled, undoable change. */
export function editClip(
  clipId: string,
  label: string,
  recipe: (clip: Clip, seq: Sequence, project: Project) => void,
  opts?: { coalesceKey?: string },
): void {
  useEditor.getState().mutateSequence(
    label,
    (seq, project) => {
      const hit = findClip(seq, clipId);
      if (hit) recipe(hit.clip, seq, project);
    },
    opts,
  );
}

/** Runs `recipe` on several clips in one undo step. */
export function editClips(clipIds: string[], label: string, recipe: (clip: Clip, seq: Sequence) => void, opts?: { coalesceKey?: string }): void {
  useEditor.getState().mutateSequence(
    label,
    (seq) => {
      for (const id of clipIds) {
        const hit = findClip(seq, id);
        if (hit) recipe(hit.clip, seq);
      }
    },
    opts,
  );
}

/**
 * Sets a numeric param at the playhead: a keyframe when the param is animated,
 * otherwise its static value. Coalesces with key `ins:<clipId>:<path>`.
 */
export function editParam(clipId: string, path: string, value: number, opts?: { label?: string }): void {
  const playhead = useEditor.getState().playhead;
  const clip = getClip(clipId);
  editClip(clipId, opts?.label ?? `Change ${paramLabel(path, clip)}`, (c) => setParam(c, path, localTime(c, playhead), value), {
    coalesceKey: `ins:${clipId}:${path}`,
  });
}

/** Sets a non-animatable field with a coalesce key `ins:<clipId>:<key>`. */
export function editField(clipId: string, key: string, label: string, recipe: (clip: Clip) => void): void {
  editClip(clipId, label, recipe, { coalesceKey: `ins:${clipId}:${key}` });
}
