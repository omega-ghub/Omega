// Store-facing helpers of the color package: which clip is being graded,
// and labeled, undoable grade edits (one mutate() per gesture).
import { useEditor } from '../../../state/store';
import { activeSequence, findClip } from '../../../state/types';
import type { Clip, Project, Sequence, Track } from '../../../state/types';
import { setParam } from '../../../engine/keyframes';
import type { WheelName } from './gradeOps';

type EditorState = ReturnType<typeof useEditor.getState>;

/** Selected clips that can be graded (on video tracks), in selection order. */
export function gradeTargetIds(s: EditorState = useEditor.getState()): string[] {
  if (!s.project) return [];
  const seq = activeSequence(s.project);
  return s.selection.clipIds.filter((id) => findClip(seq, id)?.track.kind === 'video');
}

/** The clip shown in the color panel: the first selected clip on a video track. */
export function primaryGradeClipId(s: EditorState = useEditor.getState()): string | null {
  return gradeTargetIds(s)[0] ?? null;
}

export function getGradeClip(s: EditorState = useEditor.getState()): { clip: Clip; track: Track; seq: Sequence; project: Project } | null {
  const id = primaryGradeClipId(s);
  if (!id || !s.project) return null;
  const seq = activeSequence(s.project);
  const hit = findClip(seq, id);
  return hit ? { ...hit, seq, project: s.project } : null;
}

/** Reactive: the clip being graded (stable reference until it changes). */
export function useGradeClip(): Clip | null {
  return useEditor((s) => getGradeClip(s)?.clip ?? null);
}

/** Clip-local time of a timeline time, clamped to the clip. */
export function clipLocal(clip: Clip, t: number): number {
  return Math.max(0, Math.min(clip.duration, t - clip.start));
}

/** True when the playhead is over the clip (so the program frame shows it). */
export function playheadOverClip(clip: Clip, t = useEditor.getState().playhead): boolean {
  return t >= clip.start - 1e-6 && t < clip.start + clip.duration - 1e-6;
}

/** The topmost enabled video clip under the playhead (for "grade the clip under the playhead"). */
export function clipUnderPlayhead(s: EditorState = useEditor.getState()): Clip | null {
  if (!s.project) return null;
  const seq = activeSequence(s.project);
  for (const tr of seq.tracks) {
    if (tr.kind !== 'video' || tr.muted) continue;
    const c = tr.clips.find((x) => x.enabled && playheadOverClip(x, s.playhead));
    if (c) return c;
  }
  return null;
}

/** One labeled change on one clip of the active sequence. */
export function editGradeClip(clipId: string, label: string, recipe: (clip: Clip, project: Project, seq: Sequence) => void, coalesceKey?: string) {
  useEditor.getState().mutateSequence(
    label,
    (seq, project) => {
      const hit = findClip(seq, clipId);
      if (hit) recipe(hit.clip, project, seq);
    },
    coalesceKey ? { coalesceKey } : undefined,
  );
}

/** One labeled change on several clips (one undo step). */
export function editGradeClips(ids: string[], label: string, recipe: (clip: Clip, project: Project) => void) {
  useEditor.getState().mutateSequence(label, (seq, project) => {
    for (const id of ids) {
      const hit = findClip(seq, id);
      if (hit) recipe(hit.clip, project);
    }
  });
}

/** Sets a keyframeable grade param at the playhead (keyframe when animated). */
export function setGradeParam(clipId: string, path: string, value: number, label: string) {
  const t = useEditor.getState().playhead;
  editGradeClip(clipId, label, (c) => setParam(c, path, clipLocal(c, t), value), `cl:${clipId}:${path}`);
}

/** Sets several grade params in one step (e.g. a wheel's r/g/b). */
export function setGradeParams(clipId: string, values: Record<string, number>, label: string, coalesceKey: string) {
  const t = useEditor.getState().playhead;
  editGradeClip(
    clipId,
    label,
    (c) => {
      const local = clipLocal(c, t);
      for (const [p, v] of Object.entries(values)) setParam(c, p, local, v);
    },
    coalesceKey,
  );
}

export const WHEEL_LABEL: Record<WheelName, string> = { lift: 'Lift', gamma: 'Gamma', gain: 'Gain', offset: 'Offset' };

/**
 * Reactive clip-local playhead time, but only when the clip's grade is
 * animated (otherwise 0), so static grades do not re-render on every frame.
 */
export function useGradeLocal(clip: Clip | null): number {
  return useEditor((s) => {
    if (!clip) return 0;
    for (const p in clip.keyframes) if (p.startsWith('grade.') && clip.keyframes[p].length) return clipLocal(clip, s.playhead);
    return 0;
  });
}
