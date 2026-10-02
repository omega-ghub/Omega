// Timeline editing commands. Every command is one labelled, undoable mutate
// that calls the edit ops (engine/edit/ops.ts). Errors (including ops that
// are still "not implemented") are caught and shown as a toast, never thrown
// into React or the key handler.

import * as ops from '../../../engine/edit/ops';
import { transport } from '../../../engine/playback/transport';
import { exactRate, snapToFrame, sourceSpan, sourceTimeAt } from '../../../engine/time';
import { makeSequence, makeTrack } from '../../../state/defaults';
import { useEditor } from '../../../state/store';
import type { ClipboardData } from '../../../state/store';
import type { Clip, LabelColor, Project, Sequence, Track, TrackKind, TransitionType } from '../../../state/types';
import { activeSequence, findClip, newId } from '../../../state/types';
import { clipAtTime, editTimes } from './geometry';
import { revealTime, tabsFor, useTLView, zoomAround, zoomToFit } from './view';

const S = () => useEditor.getState();

export function toast(message: string, kind: 'info' | 'success' | 'error' = 'info') {
  S().showToast(message, kind);
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Runs a document edit as one undo step. Returns false (and toasts) on failure. */
export function editProject(label: string, recipe: (p: Project) => void, opts?: { coalesceKey?: string }): boolean {
  const st = S();
  if (!st.project) return false;
  if (st.readOnly) {
    toast('This project is read-only', 'error');
    return false;
  }
  try {
    st.mutate(label, recipe, opts);
    return true;
  } catch (e) {
    toast(`${label} failed: ${errorText(e)}`, 'error');
    return false;
  }
}

/** Like editProject, on the active sequence. */
export function editSeq(label: string, recipe: (seq: Sequence, project: Project) => void, opts?: { coalesceKey?: string }): boolean {
  return editProject(
    label,
    (draft) => {
      const seq = draft.sequences.find((s) => s.id === draft.activeSequenceId) ?? draft.sequences[0];
      recipe(seq, draft);
    },
    opts,
  );
}

export function currentSeq(): Sequence | null {
  const p = S().project;
  return p ? activeSequence(p) : null;
}

export function frameDur(seq: Sequence): number {
  return 1 / exactRate(seq.fps);
}

export function selectedClips(seq: Sequence): Clip[] {
  const ids = new Set(S().selection.clipIds);
  const out: Clip[] = [];
  for (const t of seq.tracks) for (const c of t.clips) if (ids.has(c.id)) out.push(c);
  return out;
}

export function editableIds(seq: Sequence, ids: string[]): string[] {
  const set = new Set(ids);
  const out: string[] = [];
  for (const t of seq.tracks) {
    if (t.locked) continue;
    for (const c of t.clips) if (set.has(c.id)) out.push(c.id);
  }
  return out;
}

export function trackById(seq: Sequence, id: string): Track | undefined {
  return seq.tracks.find((t) => t.id === id);
}

/** Targeted, unlocked tracks (optionally of one kind). */
export function targetedTracks(seq: Sequence, kind?: TrackKind): Track[] {
  return seq.tracks.filter((t) => t.targeted && !t.locked && (!kind || t.kind === kind));
}

/** Clips under time t on the given tracks (one per track, the visible one). */
export function clipsAt(tracks: Track[], t: number): Clip[] {
  const out: Clip[] = [];
  for (const tr of tracks) {
    const c = clipAtTime(tr, t);
    if (c) out.push(c);
  }
  return out;
}

/** The most relevant clip at the playhead: a selected one under it, else the top-most targeted one. */
export function clipAtPlayhead(seq: Sequence, opts: { kind?: TrackKind; needAsset?: boolean } = {}): Clip | null {
  const t = S().playhead;
  const sel = selectedClips(seq).filter((c) => t >= c.start - 1e-9 && t < c.start + c.duration - 1e-9);
  const okKind = (c: Clip) => {
    const tr = seq.tracks.find((x) => x.clips.includes(c));
    return (!opts.kind || tr?.kind === opts.kind) && (!opts.needAsset || !!c.assetId || !!c.sequenceId);
  };
  const s = sel.find(okKind);
  if (s) return s;
  const ordered = [...targetedTracks(seq).filter((x) => x.kind === 'video'), ...targetedTracks(seq).filter((x) => x.kind === 'audio')];
  for (const c of clipsAt(ordered, t)) if (okKind(c)) return c;
  const anyTrack = [...seq.tracks.filter((x) => x.kind === 'video'), ...seq.tracks.filter((x) => x.kind === 'audio')];
  for (const c of clipsAt(anyTrack, t)) if (okKind(c)) return c;
  return null;
}

/** Bottom-most targeted video track (V1 first) and top-most targeted audio track. */
export function insertTargets(seq: Sequence): { video: Track | null; audio: Track | null } {
  const vids = seq.tracks.filter((t) => t.kind === 'video' && !t.locked);
  const auds = seq.tracks.filter((t) => t.kind === 'audio' && !t.locked);
  const video = [...vids].reverse().find((t) => t.targeted) ?? vids[vids.length - 1] ?? null;
  const audio = auds.find((t) => t.targeted) ?? auds[0] ?? null;
  return { video, audio };
}

/** Closes all gaps on the tracks (magnetic timeline). */
export function closeGapsOn(seq: Sequence, trackIds: Iterable<string>) {
  const anyOps = ops as unknown as Record<string, unknown>;
  const closeAll = anyOps.closeAllGaps;
  for (const id of new Set(trackIds)) {
    const tr = trackById(seq, id);
    if (!tr || tr.locked || tr.kind === 'caption') continue;
    if (typeof closeAll === 'function' && closeAll.length >= 2) (closeAll as (s: Sequence, trackId: string) => void)(seq, id);
    else ops.closeGap(seq, id, null);
  }
}

export function tracksOfClips(seq: Sequence, ids: string[]): string[] {
  const set = new Set(ids);
  return seq.tracks.filter((t) => t.clips.some((c) => set.has(c.id))).map((t) => t.id);
}

function seek(t: number) {
  transport.seek(Math.max(0, t));
}

// ---------------------------------------------------------------------------
// Cutting, deleting
// ---------------------------------------------------------------------------

export function splitAtPlayhead(allTracks = false) {
  const seq = currentSeq();
  if (!seq) return;
  const t = snapToFrame(S().playhead, seq.fps);
  const inside = (c: Clip) => t > c.start + 1e-6 && t < c.start + c.duration - 1e-6;
  if (allTracks) {
    const ids = seq.tracks.filter((tr) => !tr.locked).flatMap((tr) => tr.clips.filter(inside).map((c) => c.id));
    if (!ids.length) return toast('Nothing to split at the playhead');
    editSeq('Split all tracks', (s) => void ops.splitAt(s, ids, t));
    return;
  }
  const sel = editableIds(seq, selectedClips(seq).filter(inside).map((c) => c.id));
  editSeq('Split', (s) => void ops.splitAt(s, sel.length ? sel : null, t));
}

export function splitClipsAt(ids: string[] | null, t: number, label = 'Razor') {
  editSeq(label, (s) => void ops.splitAt(s, ids, t));
}

export function deleteSelection(ripple: boolean) {
  const st = S();
  const seq = currentSeq();
  if (!seq) return;
  const view = useTLView.getState();
  // 1. keyframes
  if (st.selection.keyframes.length) {
    const kfs = st.selection.keyframes;
    editSeq('Delete keyframes', (s) => {
      for (const k of kfs) {
        const f = findClip(s, k.clipId);
        const list = f?.clip.keyframes[k.path];
        if (!list) continue;
        const i = list.findIndex((x) => Math.abs(x.t - k.t) < 1e-4);
        if (i >= 0) list.splice(i, 1);
        if (!list.length) delete f!.clip.keyframes[k.path];
      }
    });
    st.select({ keyframes: [] });
    return;
  }
  // 2. a selected transition
  if (view.transition) {
    const { clipId, edge } = view.transition;
    editSeq('Remove transition', (s) => {
      const f = findClip(s, clipId);
      if (!f) return;
      if (edge === 'in') f.clip.transitionIn = null;
      else f.clip.transitionOut = null;
    });
    view.setTransition(null);
    return;
  }
  // 3. a selected gap closes
  if (view.gap) {
    const g = view.gap;
    editSeq('Close gap', (s) => ops.closeGap(s, g.trackId, (g.start + g.end) / 2));
    view.setGap(null);
    return;
  }
  // 4. clips
  const ids = editableIds(seq, st.selection.clipIds);
  if (ids.length) {
    const magnetic = st.magnetic;
    const tracks = tracksOfClips(seq, ids);
    editSeq(ripple ? 'Ripple delete' : 'Delete', (s) => {
      ops.deleteClips(s, ids, ripple);
      if (magnetic && !ripple) closeGapsOn(s, tracks);
    });
    st.selectClips([]);
    return;
  }
  // 5. caption cues
  if (st.selection.cueIds.length) {
    const cues = new Set(st.selection.cueIds);
    editSeq('Delete captions', (s) => {
      for (const tr of s.tracks) if (!tr.locked) tr.cues = tr.cues.filter((q) => !cues.has(q.id));
    });
    st.select({ cueIds: [] });
    return;
  }
  // 6. markers
  if (st.selection.markerIds.length) {
    const ms = new Set(st.selection.markerIds);
    editSeq(ms.size > 1 ? 'Delete markers' : 'Delete marker', (s) => {
      s.markers = s.markers.filter((m) => !ms.has(m.id));
    });
    st.select({ markerIds: [] });
  }
}

/** ; lift / ' extract between the sequence in and out. */
export function liftExtract(ripple: boolean) {
  const seq = currentSeq();
  if (!seq) return;
  if (seq.inPoint === null || seq.outPoint === null || seq.outPoint <= seq.inPoint) {
    toast('Set a sequence In and Out first (I / O)');
    return;
  }
  const a = seq.inPoint;
  const b = seq.outPoint;
  const ids = targetedTracks(seq).map((t) => t.id);
  if (!ids.length) return toast('No targeted tracks');
  if (
    editSeq(ripple ? 'Extract' : 'Lift', (s) => {
      ops.removeRange(s, a, b, ripple, ids);
      s.inPoint = null;
      s.outPoint = null;
    })
  )
    seek(a);
}

/** , insert / . overwrite: the source monitor clip (or the selected asset) at the playhead. */
export function sourceEdit(mode: 'insert' | 'overwrite') {
  const st = S();
  const seq = currentSeq();
  if (!seq || !st.project) return;
  const assetId = st.source.assetId ?? st.selection.assetIds[0];
  const asset = assetId ? st.project.assets.find((a) => a.id === assetId) : undefined;
  if (!asset) return toast('Open a clip in the Source monitor or select media first');
  const { video, audio } = insertTargets(seq);
  const start = seq.inPoint ?? st.playhead;
  let ids: string[] = [];
  const ok = editSeq(mode === 'insert' ? 'Insert' : 'Overwrite', (s, p) => {
    ids = ops.placeMedia(p, s, asset.id, {
      start,
      mode,
      videoTrackId: asset.hasVideo || asset.kind === 'image' ? (video?.id ?? null) : null,
      audioTrackId: asset.hasAudio ? (audio?.id ?? null) : null,
      sourceIn: asset.markIn ?? undefined,
      sourceOut: asset.markOut ?? undefined,
    });
  });
  if (!ok) return;
  const after = currentSeq();
  if (!after) return;
  let end = start;
  for (const id of ids ?? []) {
    const f = findClip(after, id);
    if (f) end = Math.max(end, f.clip.start + f.clip.duration);
  }
  seek(end);
  revealTime(end);
}

// ---------------------------------------------------------------------------
// Moving, trimming
// ---------------------------------------------------------------------------

export function nudge(frames: number) {
  const seq = currentSeq();
  if (!seq) return;
  const ids = editableIds(seq, S().selection.clipIds);
  if (!ids.length) return;
  const d = frames * frameDur(seq);
  editSeq(frames > 0 ? 'Nudge right' : 'Nudge left', (s) => ops.moveClips(s, ids, d, 0, 'overwrite'));
}

export function moveSelectionTrack(dir: -1 | 1) {
  const seq = currentSeq();
  if (!seq) return;
  const ids = editableIds(seq, S().selection.clipIds);
  if (!ids.length) return;
  editSeq(dir < 0 ? 'Move clips up a track' : 'Move clips down a track', (s) => ops.moveClips(s, ids, 0, dir, 'overwrite'));
}

/** Q / W: ripple-trim the previous / next edit to the playhead on targeted tracks. */
export function rippleTrimToPlayhead(which: 'prev' | 'next') {
  const st = S();
  const seq = currentSeq();
  if (!seq) return;
  const t = snapToFrame(st.playhead, seq.fps);
  const clips = clipsAt(targetedTracks(seq), t).filter((c) => t > c.start + 1e-6 && t < c.start + c.duration - 1e-6);
  if (!clips.length) return toast('No clip under the playhead on targeted tracks');
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const c of clips) {
    if (c.linkId && seen.has(c.linkId)) continue;
    if (c.linkId) seen.add(c.linkId);
    ids.push(c.id);
  }
  const editPoint = Math.min(...clips.map((c) => c.start));
  const ok = editSeq(which === 'prev' ? 'Ripple trim previous edit to playhead' : 'Ripple trim next edit to playhead', (s, p) => {
    for (const id of ids) {
      if (!findClip(s, id)) continue;
      ops.trimClip(p, s, id, which === 'prev' ? 'start' : 'end', t, 'ripple');
    }
  });
  if (ok && which === 'prev') seek(editPoint);
}

/** E: extend the selected edit (nearest edge of the selected clip) to the playhead. */
export function extendEditToPlayhead() {
  const st = S();
  const seq = currentSeq();
  if (!seq) return;
  const sel = selectedClips(seq);
  if (!sel.length) return toast('Select a clip edge to extend');
  const t = snapToFrame(st.playhead, seq.fps);
  const seen = new Set<string>();
  editSeq('Extend edit', (s, p) => {
    for (const c of sel) {
      if (c.linkId && seen.has(c.linkId)) continue;
      if (c.linkId) seen.add(c.linkId);
      const end = c.start + c.duration;
      const edge: 'start' | 'end' = t >= end ? 'end' : t <= c.start ? 'start' : t - c.start < end - t ? 'start' : 'end';
      const tr = s.tracks.find((x) => x.clips.some((y) => y.id === c.id));
      const neighbour = tr?.clips.find((o) => o.id !== c.id && (edge === 'end' ? Math.abs(o.start - end) < 1e-4 : Math.abs(o.start + o.duration - c.start) < 1e-4));
      ops.trimClip(p, s, c.id, edge, t, neighbour ? 'roll' : 'normal');
    }
  });
}

// ---------------------------------------------------------------------------
// Navigation, selection
// ---------------------------------------------------------------------------

export function gotoEdit(dir: -1 | 1) {
  const st = S();
  const seq = currentSeq();
  if (!seq) return;
  const targeted = seq.tracks.some((t) => t.targeted);
  const times = editTimes(seq, (t) => (targeted ? t.targeted : true));
  const t = st.playhead;
  const eps = frameDur(seq) / 2;
  const next = dir > 0 ? times.find((x) => x > t + eps) : [...times].reverse().find((x) => x < t - eps);
  if (next !== undefined) {
    seek(next);
    revealTime(next);
  }
}

export function gotoMarker(dir: -1 | 1) {
  const st = S();
  const seq = currentSeq();
  if (!seq) return;
  const eps = frameDur(seq) / 2;
  const times = seq.markers.map((m) => m.time).sort((a, b) => a - b);
  const t = st.playhead;
  const next = dir > 0 ? times.find((x) => x > t + eps) : [...times].reverse().find((x) => x < t - eps);
  if (next === undefined) return;
  seek(next);
  revealTime(next);
  const m = seq.markers.find((x) => Math.abs(x.time - next) < 1e-6);
  if (m) st.select({ markerIds: [m.id] });
}

export function selectAtPlayhead() {
  const seq = currentSeq();
  if (!seq) return;
  const t = S().playhead;
  const clips = clipsAt(
    seq.tracks.filter((x) => x.targeted),
    t,
  );
  S().selectClips(clips.map((c) => c.id));
}

export function selectAll() {
  const seq = currentSeq();
  if (!seq) return;
  S().selectClips(seq.tracks.flatMap((t) => t.clips.map((c) => c.id)));
}

export function deselectAll() {
  S().clearSelection();
  const v = useTLView.getState();
  v.setGap(null);
  v.setTransition(null);
}

export function selectTrackClips(trackId: string, from = 0) {
  const seq = currentSeq();
  const tr = seq && trackById(seq, trackId);
  if (!tr) return;
  S().selectClips(tr.clips.filter((c) => c.start + c.duration > from + 1e-9).map((c) => c.id));
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

export function copySelection(cut = false) {
  const st = S();
  const seq = currentSeq();
  if (!seq) return;
  const sel = selectedClips(seq);
  if (!sel.length) return;
  const t0 = Math.min(...sel.map((c) => c.start));
  const data: ClipboardData = { clips: [] };
  for (const tr of seq.tracks) {
    const kindIndex = seq.tracks.filter((x) => x.kind === tr.kind).indexOf(tr);
    for (const c of tr.clips) {
      if (!st.selection.clipIds.includes(c.id)) continue;
      const copy = structuredClone(c) as Clip;
      copy.start = c.start - t0;
      data.clips.push({ clip: copy, trackIndex: kindIndex, trackKind: tr.kind });
    }
  }
  st.setClipboard(data);
  if (cut) {
    const ids = editableIds(seq, sel.map((c) => c.id));
    const tracks = tracksOfClips(seq, ids);
    const magnetic = st.magnetic;
    editSeq('Cut', (s) => {
      ops.deleteClips(s, ids, false);
      if (magnetic) closeGapsOn(s, tracks);
    });
    st.selectClips([]);
  } else {
    toast(`Copied ${sel.length} clip${sel.length > 1 ? 's' : ''}`);
  }
}

export function paste(mode: 'overwrite' | 'insert') {
  const st = S();
  const seq = currentSeq();
  if (!seq) return;
  const cb = st.clipboard;
  if (!cb?.clips.length) return toast('The clipboard is empty');
  const t = snapToFrame(st.playhead, seq.fps);
  let ids: string[] = [];
  const ok = editSeq(mode === 'insert' ? 'Paste insert' : 'Paste', (s) => {
    ids = ops.pasteClips(s, structuredClone(cb.clips), t, mode);
  });
  if (!ok) return;
  if (ids?.length) {
    st.selectClips(ids);
    const after = currentSeq();
    if (after) {
      let end = t;
      for (const id of ids) {
        const f = findClip(after, id);
        if (f) end = Math.max(end, f.clip.start + f.clip.duration);
      }
      seek(end);
    }
  }
}

export interface AttrOptions {
  transform: boolean;
  crop: boolean;
  effects: boolean;
  grade: boolean;
  audio: boolean;
  speed: boolean;
}

const ATTR_PATHS: Record<keyof AttrOptions, (p: string) => boolean> = {
  transform: (p) => p.startsWith('transform.'),
  crop: (p) => p.startsWith('crop.'),
  effects: (p) => p.startsWith('effects.'),
  grade: (p) => p.startsWith('grade.'),
  audio: (p) => p.startsWith('audio.'),
  speed: (p) => p === 'time.speed',
};

/** Copies attributes (and their keyframes) from src onto a draft clip. */
export function applyAttributes(src: Clip, dst: Clip, o: AttrOptions) {
  const keep = (path: string) => (Object.keys(ATTR_PATHS) as (keyof AttrOptions)[]).some((k) => o[k] && ATTR_PATHS[k](path));
  // drop target keyframes that are being replaced
  for (const path of Object.keys(dst.keyframes)) if (keep(path)) delete dst.keyframes[path];
  if (o.transform) dst.transform = structuredClone(src.transform);
  if (o.crop) dst.crop = structuredClone(src.crop);
  if (o.grade) dst.grade = structuredClone(src.grade);
  if (o.audio) dst.audio = structuredClone(src.audio);
  const fxMap = new Map<string, string>();
  if (o.effects) {
    for (const path of Object.keys(dst.keyframes)) if (path.startsWith('effects.')) delete dst.keyframes[path];
    dst.effects = src.effects.map((e) => {
      const id = newId('fx');
      fxMap.set(e.id, id);
      return { ...structuredClone(e), id };
    });
  }
  for (const [path, list] of Object.entries(src.keyframes)) {
    if (!keep(path)) continue;
    let target = path;
    if (path.startsWith('effects.')) {
      const [, fx, ...rest] = path.split('.');
      const mapped = fxMap.get(fx);
      if (!mapped) continue;
      target = ['effects', mapped, ...rest].join('.');
    }
    dst.keyframes[target] = list.filter((k) => k.t <= dst.duration + 1e-6).map((k) => ({ ...k }));
    if (!dst.keyframes[target].length) delete dst.keyframes[target];
  }
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

function adjacentPrev(track: Track, clip: Clip): Clip | undefined {
  return track.clips.find((o) => o.id !== clip.id && Math.abs(o.start + o.duration - clip.start) < 1e-4);
}

/** Mod+D / Mod+Shift+D: default transition on the selected clips, or at the edit nearest the playhead. */
export function addDefaultTransition(audio: boolean) {
  const st = S();
  const seq = currentSeq();
  if (!seq || !st.project) return;
  const type: TransitionType = audio ? 'audioCrossfade' : 'crossDissolve';
  const kind: TrackKind = audio ? 'audio' : 'video';
  const dur = snapToFrame(st.project.settings.defaultTransitionDuration || 1, seq.fps);
  const sel = selectedClips(seq).filter((c) => trackById(seq, tracksOfClips(seq, [c.id])[0])?.kind === kind);
  const jobs: { id: string; edge: 'start' | 'end' }[] = [];
  if (sel.length) {
    for (const c of sel) jobs.push({ id: c.id, edge: 'start' }, { id: c.id, edge: 'end' });
  } else {
    const t = st.playhead;
    for (const tr of targetedTracks(seq, kind)) {
      let best: { id: string; edge: 'start' | 'end'; d: number } | null = null;
      for (const c of tr.clips) {
        const dS = Math.abs(c.start - t);
        const dE = Math.abs(c.start + c.duration - t);
        if (!best || dS < best.d) best = { id: c.id, edge: 'start', d: dS };
        if (dE < best.d) {
          const follower = tr.clips.find((o) => Math.abs(o.start - (c.start + c.duration)) < 1e-4);
          best = follower ? { id: follower.id, edge: 'start', d: dE } : { id: c.id, edge: 'end', d: dE };
        }
      }
      if (best) jobs.push(best);
    }
  }
  if (!jobs.length) return toast(audio ? 'No audio edit to add a crossfade to' : 'No video edit to add a transition to');
  editSeq(audio ? 'Add audio crossfade' : 'Add default transition', (s) => {
    for (const j of jobs) {
      const f = findClip(s, j.id);
      if (!f || f.track.locked) continue;
      // a clip's tail transition only applies when nothing follows: use the follower's head instead
      if (j.edge === 'end') {
        const follower = f.track.clips.find((o) => Math.abs(o.start - (f.clip.start + f.clip.duration)) < 1e-4);
        if (follower) {
          ops.addTransition(s, follower.id, 'start', type, dur);
          continue;
        }
      }
      ops.addTransition(s, j.id, j.edge, type, dur);
    }
  });
}

export function removeTransitions(ids: string[]) {
  editSeq('Remove transitions', (s) => {
    const set = new Set(ids);
    for (const tr of s.tracks) {
      if (tr.locked) continue;
      for (const c of tr.clips) {
        if (!set.has(c.id)) continue;
        c.transitionIn = null;
        c.transitionOut = null;
        // also the follower's head transition at this clip's tail
        const follower = tr.clips.find((o) => Math.abs(o.start - (c.start + c.duration)) < 1e-4);
        if (follower) follower.transitionIn = null;
      }
    }
  });
}

/** Adds a transition at a clip edge, from a drop or menu. */
export function addTransitionAt(clipId: string, edge: 'start' | 'end', type: TransitionType) {
  const st = S();
  const seq = currentSeq();
  if (!seq || !st.project) return;
  const dur = snapToFrame(st.project.settings.defaultTransitionDuration || 1, seq.fps);
  editSeq('Add transition', (s) => {
    const f = findClip(s, clipId);
    if (!f) return;
    if (edge === 'end') {
      const follower = f.track.clips.find((o) => Math.abs(o.start - (f.clip.start + f.clip.duration)) < 1e-4);
      if (follower) return ops.addTransition(s, follower.id, 'start', type, dur);
    }
    ops.addTransition(s, clipId, edge, type, dur);
  });
}

// ---------------------------------------------------------------------------
// Clip attributes
// ---------------------------------------------------------------------------

export function toggleEnabled() {
  const seq = currentSeq();
  if (!seq) return;
  const sel = selectedClips(seq);
  if (!sel.length) return;
  const enable = sel.every((c) => !c.enabled);
  const ids = new Set(editableIds(seq, sel.map((c) => c.id)));
  editSeq(enable ? 'Enable clips' : 'Disable clips', (s) => {
    for (const t of s.tracks) for (const c of t.clips) if (ids.has(c.id)) c.enabled = enable;
  });
}

export function toggleLink() {
  const seq = currentSeq();
  if (!seq) return;
  const sel = selectedClips(seq);
  if (!sel.length) return;
  const linked = sel.every((c) => c.linkId && c.linkId === sel[0].linkId);
  const ids = sel.map((c) => c.id);
  if (linked || (sel.length === 1 && sel[0].linkId)) editSeq('Unlink', (s) => ops.unlinkClips(s, ids));
  else if (sel.length > 1) editSeq('Link', (s) => ops.linkClips(s, ids));
}

export function setGrouped(group: boolean) {
  const seq = currentSeq();
  if (!seq) return;
  const ids = selectedClips(seq).map((c) => c.id);
  if (!ids.length) return;
  if (group) {
    if (ids.length < 2) return toast('Select two or more clips to group');
    editSeq('Group', (s) => ops.groupClips(s, ids));
  } else editSeq('Ungroup', (s) => ops.ungroupClips(s, ids));
}

export function setLabel(label: LabelColor, ids?: string[]) {
  const seq = currentSeq();
  if (!seq) return;
  const set = new Set(ids ?? S().selection.clipIds);
  if (!set.size) return;
  useTLView.setState({ lastLabel: label });
  editSeq('Label color', (s) => {
    for (const t of s.tracks) for (const c of t.clips) if (set.has(c.id)) c.label = label;
  });
}

export function renameClip(clipId: string, name: string) {
  const n = name.trim();
  if (!n) return;
  editSeq('Rename clip', (s) => {
    const f = findClip(s, clipId);
    if (f) f.clip.name = n;
  });
}

export function reverseClips(ids: string[]) {
  editSeq('Reverse', (s, p) => {
    for (const id of ids) {
      const f = findClip(s, id);
      if (!f || f.track.locked || f.clip.kind !== 'media') continue;
      ops.setSpeed(p, s, id, f.clip.speed, { reverse: !f.clip.reverse, keepDuration: true });
    }
  });
}

export function freezeFrameAtPlayhead() {
  const st = S();
  const seq = currentSeq();
  if (!seq) return;
  const clip = clipAtPlayhead(seq, { kind: 'video' });
  if (!clip || clip.kind !== 'media') return toast('Put the playhead over a video clip to freeze a frame');
  const t = snapToFrame(st.playhead, seq.fps);
  let id = '';
  editSeq('Freeze frame', (s, p) => {
    id = ops.freezeFrame(p, s, clip.id, t, 2);
  });
  if (id) st.selectClips([id]);
}

export function freezeClip(clipId: string) {
  const st = S();
  const seq = currentSeq();
  const f = seq && findClip(seq, clipId);
  if (!f) return;
  const t = st.playhead >= f.clip.start && st.playhead < f.clip.start + f.clip.duration ? st.playhead : f.clip.start;
  let id = '';
  editSeq('Freeze frame', (s, p) => {
    id = ops.freezeFrame(p, s, clipId, snapToFrame(t, s.fps), 2);
  });
  if (id) st.selectClips([id]);
}

export function nestSelection() {
  const st = S();
  const seq = currentSeq();
  if (!seq) return;
  const ids = editableIds(seq, st.selection.clipIds);
  if (!ids.length) return toast('Select clips to nest');
  let newSeq = '';
  const name = `Nested ${(st.project?.sequences.length ?? 0) + 1}`;
  if (editSeq('Nest', (s, p) => void (newSeq = ops.nestClips(p, s, ids, name)))) {
    if (newSeq) toast(`Nested ${ids.length} clip${ids.length > 1 ? 's' : ''} into “${name}”`, 'success');
  }
}

/**
 * Un-nest: replaces a nested sequence clip with the clips of that sequence
 * (trimmed to the used range), keeping their timing. Speed must be 100%.
 */
export function unnestClip(clipId: string) {
  const st = S();
  const seq = currentSeq();
  const p = st.project;
  if (!seq || !p) return;
  const f = findClip(seq, clipId);
  if (!f || f.clip.kind !== 'sequence' || !f.clip.sequenceId) return toast('Select a nested sequence clip');
  if (Math.abs(f.clip.speed - 1) > 1e-6 || f.clip.reverse || f.clip.keyframes['time.speed']?.length) return toast('Un-nest needs the nested clip at 100% speed', 'error');
  editProject('Un-nest', (draft) => {
    const s = draft.sequences.find((x) => x.id === draft.activeSequenceId) ?? draft.sequences[0];
    const found = findClip(s, clipId);
    const inner = draft.sequences.find((x) => x.id === f.clip.sequenceId);
    if (!found || !inner) return;
    const outer = found.clip;
    const a = outer.inPoint;
    const b = outer.inPoint + outer.duration;
    const offset = outer.start - outer.inPoint;
    // partners: other clips of this nest linked to it (its audio)
    const partners = outer.linkId ? s.tracks.flatMap((t) => t.clips.filter((c) => c.linkId === outer.linkId && c.id !== outer.id && c.sequenceId === outer.sequenceId)) : [];
    const anchor: Record<TrackKind, number> = { video: -1, audio: -1, caption: -1 };
    const vTracks = s.tracks.filter((t) => t.kind === 'video');
    anchor.video = vTracks.indexOf(found.track);
    const audioPartner = partners.map((c) => s.tracks.find((t) => t.clips.includes(c))).find((t) => t?.kind === 'audio');
    anchor.audio = audioPartner ? s.tracks.filter((t) => t.kind === 'audio').indexOf(audioPartner) : 0;
    // remove the nest and its partners
    const remove = new Set([outer.id, ...partners.map((c) => c.id)]);
    for (const t of s.tracks) t.clips = t.clips.filter((c) => !remove.has(c.id));
    const linkMap = new Map<string, string>();
    const groupMap = new Map<string, string>();
    const remap = (m: Map<string, string>, id?: string) => {
      if (!id) return undefined;
      let v = m.get(id);
      if (!v) m.set(id, (v = newId('lnk')));
      return v;
    };
    const innerVideo = inner.tracks.filter((t) => t.kind === 'video');
    const innerAudio = inner.tracks.filter((t) => t.kind === 'audio');
    const place = (innerTrack: Track, kind: 'video' | 'audio', i: number) => {
      const outerList = () => s.tracks.filter((t) => t.kind === kind);
      // video: bottom inner track lands on the nest's track, higher ones above it
      let target: Track | undefined;
      if (kind === 'video') {
        const fromBottom = innerVideo.length - 1 - i;
        let idx = anchor.video - fromBottom;
        while (idx < 0) {
          const nt = makeTrack('video', `V${outerList().length + 1}`);
          const firstVideo = s.tracks.findIndex((t) => t.kind === 'video');
          s.tracks.splice(Math.max(0, firstVideo), 0, nt);
          anchor.video += 1;
          idx += 1;
        }
        target = outerList()[idx];
      } else {
        let idx = anchor.audio + i;
        while (idx >= outerList().length) {
          const nt = makeTrack('audio', `A${outerList().length + 1}`);
          const lastAudio = s.tracks.map((t) => t.kind).lastIndexOf('audio');
          s.tracks.splice(lastAudio >= 0 ? lastAudio + 1 : s.tracks.length, 0, nt);
        }
        target = outerList()[idx];
      }
      if (!target) return;
      for (const c of innerTrack.clips) {
        const cs = c.start;
        const ce = c.start + c.duration;
        if (ce <= a + 1e-9 || cs >= b - 1e-9) continue;
        const copy = structuredClone(c) as Clip;
        copy.id = newId('clip');
        copy.linkId = remap(linkMap, c.linkId);
        copy.groupId = remap(groupMap, c.groupId);
        if (cs < a) {
          const cut = a - cs;
          copy.inPoint = c.reverse ? c.inPoint : sourceTimeAt(c, cut);
          for (const list of Object.values(copy.keyframes)) for (const k of list) k.t -= cut;
          copy.start = a;
          copy.duration -= cut;
          copy.transitionIn = null;
          copy.fadeIn = 0;
        }
        if (ce > b) {
          copy.duration = b - copy.start;
          copy.transitionOut = null;
          copy.fadeOut = 0;
        }
        if (c.reverse && ce > b && c.holdFrame === null) {
          // reversed: the lowest source time now sits at the new (earlier) tail
          const tailCut = ce - b;
          copy.inPoint = c.inPoint + (tailCut / c.duration) * sourceSpan(c);
        }
        copy.start += offset;
        // clear what is underneath on the target track (overwrite)
        const s0 = copy.start;
        const s1 = copy.start + copy.duration;
        target.clips = target.clips.filter((o) => o.start + o.duration <= s0 + 1e-9 || o.start >= s1 - 1e-9);
        target.clips.push(copy);
      }
    };
    innerVideo.forEach((t, i) => place(t, 'video', i));
    innerAudio.forEach((t, i) => place(t, 'audio', i));
  });
}

export function openNested(clipId: string) {
  const st = S();
  const seq = currentSeq();
  const f = seq && findClip(seq, clipId);
  if (!f?.clip.sequenceId || !st.project) return;
  const target = st.project.sequences.find((s) => s.id === f.clip.sequenceId);
  if (!target) return toast('The nested sequence no longer exists', 'error');
  const local = Math.max(0, st.playhead - f.clip.start);
  const innerT = sourceTimeAt(f.clip, Math.min(local, f.clip.duration));
  useTLView.getState().openTab(st.project.id, target.id);
  st.setActiveSequence(target.id);
  seek(innerT);
  revealTime(innerT, 'center');
}

export function revealInMedia(clipId: string) {
  const st = S();
  const seq = currentSeq();
  const f = seq && findClip(seq, clipId);
  if (!f?.clip.assetId) return toast('This clip has no media');
  st.select({ assetIds: [f.clip.assetId] });
  st.setWorkspace('edit');
}

/** Match frame: loads the clip's media into the Source monitor at the same source frame. */
export function matchFrame(clipId?: string) {
  const st = S();
  const seq = currentSeq();
  if (!seq) return;
  const clip = clipId ? findClip(seq, clipId)?.clip : clipAtPlayhead(seq, { needAsset: true });
  if (!clip) return toast('No clip under the playhead');
  if (clip.kind === 'sequence') return openNested(clip.id);
  if (!clip.assetId) return toast('This clip has no source media');
  const local = Math.max(0, Math.min(st.playhead - clip.start, clip.duration));
  st.setSource({ assetId: clip.assetId, time: sourceTimeAt(clip, local) });
}

/** X: sets the sequence in/out around the clip under the playhead. */
export function markClip() {
  const seq = currentSeq();
  if (!seq) return;
  const clip = clipAtPlayhead(seq);
  if (!clip) return toast('No clip under the playhead');
  editSeq('Mark clip', (s) => {
    s.inPoint = clip.start;
    s.outPoint = clip.start + clip.duration;
  });
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

export function addMarkerAtPlayhead() {
  const st = S();
  const seq = currentSeq();
  if (!seq) return;
  const t = snapToFrame(st.playhead, seq.fps);
  const existing = seq.markers.find((m) => Math.abs(m.time - t) < frameDur(seq) / 2);
  if (existing) {
    st.select({ markerIds: [existing.id] });
    st.openModal('timeline.marker', { markerId: existing.id });
    return;
  }
  let id = '';
  if (editSeq('Add marker', (s) => void (id = ops.addMarker(s, t)))) if (id) st.select({ markerIds: [id] });
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function zoomBy(factor: number) {
  const st = S();
  const v = useTLView.getState();
  const span = v.viewW / st.zoom;
  const ph = st.playhead;
  const anchor = ph >= v.t0 && ph <= v.t0 + span ? ph : v.t0 + span / 2;
  zoomAround(anchor, st.zoom * factor);
}

export { zoomToFit };

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

export function addTrack(kind: TrackKind, index?: number) {
  let name = '';
  if (
    editSeq(`Add ${kind} track`, (s) => {
      const t = ops.addTrack(s, kind, index);
      name = t?.name ?? '';
    })
  )
    if (name) toast(`Added ${name}`);
}

export function removeTrack(trackId: string) {
  const seq = currentSeq();
  const tr = seq && trackById(seq, trackId);
  if (!tr) return;
  if (seq!.tracks.filter((t) => t.kind === tr.kind).length <= 1 && tr.kind !== 'caption') return toast(`A sequence needs at least one ${tr.kind} track`);
  editSeq(`Delete track ${tr.name}`, (s) => ops.removeTrack(s, trackId));
}

export function setTrackColor(trackId: string, color: LabelColor) {
  editSeq('Track color', (s) => {
    const t = trackById(s, trackId);
    if (t) t.color = color === 'none' ? undefined : color;
  });
}

export function patchTrack(trackId: string, label: string, recipe: (t: Track) => void, coalesceKey?: string) {
  editSeq(label, (s) => {
    const t = trackById(s, trackId);
    if (t) recipe(t);
  }, coalesceKey ? { coalesceKey } : undefined);
}

export function setAllTrackHeights(preset: Record<TrackKind, number>) {
  editSeq('Track height', (s) => {
    for (const t of s.tracks) t.height = preset[t.kind];
  });
}

// ---------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------

export function newSequence() {
  const st = S();
  const p = st.project;
  if (!p) return;
  const cur = activeSequence(p);
  const names = new Set(p.sequences.map((s) => s.name));
  let n = p.sequences.length + 1;
  while (names.has(`Sequence ${n}`)) n++;
  const seq = makeSequence(cur, `Sequence ${n}`);
  seq.startTimecode = cur.startTimecode;
  if (editProject('New sequence', (d) => void d.sequences.push(seq))) {
    useTLView.getState().openTab(p.id, seq.id);
    st.setActiveSequence(seq.id);
  }
}

export function duplicateSequence(seqId: string) {
  const st = S();
  const p = st.project;
  const src = p?.sequences.find((s) => s.id === seqId);
  if (!p || !src) return;
  const copy = structuredClone(src) as Sequence;
  copy.id = newId('seq');
  copy.name = `${src.name} copy`;
  for (const t of copy.tracks) {
    t.id = newId(t.kind[0]);
    for (const c of t.clips) c.id = newId('clip');
    for (const q of t.cues) q.id = newId('cue');
  }
  for (const m of copy.markers) m.id = newId('mk');
  if (editProject('Duplicate sequence', (d) => void d.sequences.push(copy))) {
    useTLView.getState().openTab(p.id, copy.id);
    st.setActiveSequence(copy.id);
  }
}

export function deleteSequence(seqId: string) {
  const st = S();
  const p = st.project;
  if (!p) return;
  if (p.sequences.length <= 1) return toast('A project needs at least one sequence');
  const usedIn = p.sequences.find((s) => s.tracks.some((t) => t.clips.some((c) => c.sequenceId === seqId)));
  if (usedIn) return toast(`It is nested in “${usedIn.name}”; remove those clips first`, 'error');
  const remaining = p.sequences.filter((s) => s.id !== seqId);
  editProject('Delete sequence', (d) => {
    d.sequences = d.sequences.filter((s) => s.id !== seqId);
    if (d.activeSequenceId === seqId) d.activeSequenceId = remaining[0].id;
  });
  useTLView.getState().closeTab(p.id, seqId);
}

export function closeSequenceTab(seqId: string) {
  const st = S();
  const p = st.project;
  if (!p) return;
  const view = useTLView.getState();
  const tabs = tabsFor(p, view.tabs);
  if (tabs.length <= 1) return;
  const i = tabs.indexOf(seqId);
  // persist the explicit list (minus this one) so the active one doesn't reappear
  useTLView.setState({ tabs: { ...view.tabs, [p.id]: tabs } });
  view.closeTab(p.id, seqId);
  if (p.activeSequenceId === seqId) {
    const next = tabs[i + 1] ?? tabs[i - 1];
    if (next) st.setActiveSequence(next);
  }
}

export function renameSequence(seqId: string, name: string) {
  const n = name.trim();
  if (!n) return;
  editProject('Rename sequence', (d) => {
    const s = d.sequences.find((x) => x.id === seqId);
    if (s) s.name = n;
  });
}

export function switchSequence(seqId: string) {
  const st = S();
  if (!st.project) return;
  useTLView.getState().openTab(st.project.id, seqId);
  st.setActiveSequence(seqId);
}
