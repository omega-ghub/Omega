// Context menu builders (clips, lanes, transitions, captions, ruler, track
// headers, sequence tabs). Items carry the shortcut of the matching action.

import * as ops from '../../../engine/edit/ops';
import { transport } from '../../../engine/playback/transport';
import { snapToFrame } from '../../../engine/time';
import { useEditor } from '../../../state/store';
import type { LabelColor, Marker, Track, TransitionType } from '../../../state/types';
import { findClip } from '../../../state/types';
import { displayKey, keysFor } from '../actions';
import { labelHex, LABEL_LIST } from './colors';
import * as cmd from './commands';
import { transitionName } from './draw';
import { useTLView, type MenuItem } from './view';

const S = () => useEditor.getState();

export function hint(actionId: string): string | undefined {
  const k = keysFor(actionId)[0];
  return k ? displayKey(k) : undefined;
}

const LABEL_NAMES: Record<LabelColor, string> = {
  none: 'None',
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  violet: 'Violet',
  pink: 'Pink',
  grey: 'Grey',
};

export function labelSubmenu(current: LabelColor | undefined, apply: (l: LabelColor) => void): MenuItem[] {
  return LABEL_LIST.map((l) => ({ label: LABEL_NAMES[l], swatch: l === 'none' ? undefined : labelHex(l), checked: (current ?? 'none') === l, run: () => apply(l), testId: `tl-label-${l}` }));
}

const VIDEO_TRANSITIONS: TransitionType[] = ['crossDissolve', 'filmDissolve', 'additiveDissolve', 'dipToBlack', 'dipToWhite', 'wipe', 'slide', 'push', 'zoom', 'blurDissolve', 'iris', 'clockWipe', 'whip', 'glitch', 'lightLeak'];
export { VIDEO_TRANSITIONS };

/** Right-click on a clip. `t` is the clicked time. */
export function clipMenu(clipId: string, t: number): MenuItem[] {
  const st = S();
  const seq = cmd.currentSeq();
  if (!seq) return [];
  const f = findClip(seq, clipId);
  if (!f) return [];
  const sel = cmd.selectedClips(seq);
  const ids = sel.map((c) => c.id);
  const c = f.clip;
  const locked = f.track.locked;
  const anyEnabled = sel.some((x) => x.enabled);
  const linked = sel.length > 0 && sel.every((x) => x.linkId && x.linkId === sel[0].linkId);
  const grouped = sel.some((x) => x.groupId);
  const hasTransitions = sel.some((x) => x.transitionIn || x.transitionOut);
  const isAudio = f.track.kind === 'audio';
  const media = c.kind === 'media';
  const items: MenuItem[] = [
    { label: 'Cut', hint: hint('timeline.cut'), run: () => cmd.copySelection(true), disabled: locked },
    { label: 'Copy', hint: hint('timeline.copy'), run: () => cmd.copySelection(false) },
    { label: 'Paste', hint: hint('timeline.paste'), run: () => cmd.paste('overwrite'), disabled: !st.clipboard?.clips.length },
    { label: 'Paste Attributes…', hint: hint('timeline.pasteAttributes'), run: () => st.openModal('timeline.pasteAttributes', { clipIds: ids }), disabled: !st.clipboard?.clips.length },
    { separator: true },
    {
      label: 'Duplicate',
      run: () => {
        const span = Math.max(...sel.map((x) => x.start + x.duration)) - Math.min(...sel.map((x) => x.start));
        let created: string[] = [];
        if (cmd.editSeq('Duplicate', (s) => void (created = ops.duplicateClips(s, cmd.editableIds(s, ids), span)))) if (created?.length) st.selectClips(created);
      },
      disabled: locked,
    },
    { label: 'Delete', hint: hint('timeline.delete'), run: () => cmd.deleteSelection(false), disabled: locked, testId: 'tl-menu-delete' },
    { label: 'Ripple Delete', hint: hint('timeline.rippleDelete'), run: () => cmd.deleteSelection(true), disabled: locked },
    {
      label: 'Split Here',
      run: () => {
        const time = snapToFrame(t, seq.fps);
        const splitIds = st.linkedSelection && ids.includes(clipId) ? ids : [clipId];
        cmd.splitClipsAt(splitIds.filter((id) => {
          const x = findClip(seq, id)?.clip;
          return x && time > x.start + 1e-6 && time < x.start + x.duration - 1e-6;
        }), time, 'Split');
      },
      disabled: locked,
    },
    { separator: true },
    { label: 'Speed/Duration…', hint: hint('timeline.speedDialog'), run: () => st.openModal('timeline.speed', { clipIds: ids }), disabled: locked || !(media || c.kind === 'sequence') },
    { label: 'Freeze Frame', hint: hint('timeline.freezeFrame'), run: () => cmd.freezeClip(clipId), disabled: locked || !media || isAudio },
    { label: c.reverse ? 'Play Forward' : 'Reverse', run: () => cmd.reverseClips(ids), disabled: locked || !media },
    { label: anyEnabled ? 'Disable' : 'Enable', hint: hint('timeline.toggleEnabled'), run: () => cmd.toggleEnabled(), disabled: locked },
    { separator: true },
    { label: linked ? 'Unlink' : 'Link', hint: hint('timeline.link'), run: () => cmd.toggleLink(), disabled: !linked && sel.length < 2 },
    grouped ? { label: 'Ungroup', hint: hint('timeline.ungroup'), run: () => cmd.setGrouped(false) } : { label: 'Group', hint: hint('timeline.group'), run: () => cmd.setGrouped(true), disabled: sel.length < 2 },
    { label: 'Nest…', hint: hint('timeline.nest'), run: () => cmd.nestSelection(), disabled: locked },
    ...(c.kind === 'sequence'
      ? [
          { label: 'Open Nested Sequence', run: () => cmd.openNested(clipId) },
          { label: 'Un-nest', run: () => cmd.unnestClip(clipId), disabled: locked },
        ]
      : []),
    { separator: true },
    { label: 'Label', submenu: labelSubmenu(c.label, (l) => cmd.setLabel(l, ids)) },
    { label: 'Rename…', run: () => startRename(clipId), disabled: locked },
    { label: 'Reveal in Media', run: () => cmd.revealInMedia(clipId), disabled: !c.assetId },
    { label: 'Match Frame', hint: hint('timeline.matchFrame'), run: () => cmd.matchFrame(clipId), disabled: !c.assetId && c.kind !== 'sequence' },
    { separator: true },
    { label: isAudio ? 'Add Default Crossfade' : 'Add Default Transition', hint: hint(isAudio ? 'timeline.defaultAudioTransition' : 'timeline.defaultTransition'), run: () => cmd.addDefaultTransition(isAudio), disabled: locked },
    { label: 'Remove Transitions', run: () => cmd.removeTransitions(ids), disabled: locked || !hasTransitions },
    { label: 'Audio Gain…', hint: hint('timeline.audioGain'), run: () => st.openModal('timeline.audioGain', { clipIds: ids }), disabled: locked },
    { separator: true },
    { label: 'Properties…', run: () => st.openModal('timeline.clipProperties', { clipId }) },
  ];
  return items;
}

export function startRename(clipId: string) {
  const ctl = (window as unknown as { __deltaTimelineCtl?: { clipClientRect(id: string): DOMRect | null } }).__deltaTimelineCtl;
  const r = ctl?.clipClientRect(clipId);
  if (!r) return;
  useTLView.getState().setInline({ kind: 'clipName', clipId, x: r.x, y: r.y, w: Math.max(160, Math.min(r.width, 320)), h: Math.min(r.height, 24) });
}

/** Right-click on an empty part of a track lane. */
export function laneMenu(track: Track, t: number): MenuItem[] {
  const st = S();
  const seq = cmd.currentSeq();
  if (!seq) return [];
  const time = snapToFrame(Math.max(0, t), seq.fps);
  const items: MenuItem[] = [];
  if (track.kind === 'caption') {
    items.push({
      label: 'Add Caption Here',
      disabled: track.locked,
      run: () => {
        const id = `cue_${crypto.randomUUID().slice(0, 8)}`;
        cmd.editSeq('Add caption', (s) => {
          const tr = s.tracks.find((x) => x.id === track.id);
          if (!tr) return;
          const next = tr.cues.filter((q) => q.start > time).sort((a, b) => a.start - b.start)[0];
          const end = Math.min(time + 2, next ? next.start : Infinity);
          tr.cues.push({ id, start: time, end: Math.max(end, time + 1 / s.fps), text: 'Caption' });
        });
        st.select({ cueIds: [id] });
      },
    });
  }
  const view = useTLView.getState();
  items.push(
    {
      label: 'Paste Here',
      disabled: !st.clipboard?.clips.length,
      run: () => {
        transport.seek(time);
        cmd.paste('overwrite');
      },
    },
    { label: 'Add Marker Here', run: () => cmd.editSeq('Add marker', (s) => void ops.addMarker(s, time)) },
  );
  if (view.gap && view.gap.trackId === track.id) {
    items.push({ label: 'Close Gap', hint: hint('timeline.rippleDelete'), run: () => cmd.deleteSelection(true), disabled: track.locked });
  }
  if (track.kind !== 'caption') {
    items.push(
      { separator: true },
      { label: 'Select All on Track', run: () => cmd.selectTrackClips(track.id) },
      { label: 'Select Forward from Here', run: () => cmd.selectTrackClips(track.id, time) },
      { label: 'Close All Gaps on Track', run: () => cmd.editSeq('Close all gaps', (s) => cmd.closeGapsOn(s, [track.id])), disabled: track.locked },
    );
  }
  return items;
}

export function transitionMenu(clipId: string, edge: 'in' | 'out', isAudio: boolean, x: number, y: number): MenuItem[] {
  const seq = cmd.currentSeq();
  const f = seq && findClip(seq, clipId);
  const tr = f ? (edge === 'in' ? f.clip.transitionIn : f.clip.transitionOut) : null;
  if (!tr) return [];
  const setType = (type: TransitionType) =>
    cmd.editSeq('Transition type', (s) => {
      const g = findClip(s, clipId);
      const t = g && (edge === 'in' ? g.clip.transitionIn : g.clip.transitionOut);
      if (t) {
        t.type = type;
        t.params = {};
      }
    });
  return [
    { label: 'Edit Transition…', run: () => useTLView.getState().setTransitionPop({ clipId, edge, x, y }) },
    ...(isAudio ? [] : [{ label: 'Type', submenu: VIDEO_TRANSITIONS.map((type) => ({ label: transitionName(type), checked: tr.type === type, run: () => setType(type) })) }]),
    { separator: true },
    {
      label: 'Remove Transition',
      danger: true,
      run: () =>
        cmd.editSeq('Remove transition', (s) => {
          const g = findClip(s, clipId);
          if (!g) return;
          if (edge === 'in') g.clip.transitionIn = null;
          else g.clip.transitionOut = null;
        }),
    },
  ];
}

export function cueMenu(trackId: string, cueId: string, startEdit: () => void): MenuItem[] {
  const st = S();
  return [
    { label: 'Edit Text', run: startEdit },
    {
      label: 'Split at Playhead',
      run: () => {
        const t = st.playhead;
        cmd.editSeq('Split caption', (s) => {
          const tr = s.tracks.find((x) => x.id === trackId);
          const q = tr?.cues.find((x) => x.id === cueId);
          if (!tr || !q || t <= q.start || t >= q.end) return;
          tr.cues.push({ ...q, id: `cue_${crypto.randomUUID().slice(0, 8)}`, start: t });
          q.end = t;
        });
      },
    },
    { separator: true },
    {
      label: 'Delete Caption',
      danger: true,
      run: () =>
        cmd.editSeq('Delete caption', (s) => {
          const tr = s.tracks.find((x) => x.id === trackId);
          if (tr) tr.cues = tr.cues.filter((q) => q.id !== cueId);
        }),
    },
  ];
}

export function rulerMenu(t: number, marker: Marker | null): MenuItem[] {
  const st = S();
  const seq = cmd.currentSeq();
  if (!seq) return [];
  const time = snapToFrame(Math.max(0, t), seq.fps);
  const add = (kind: Marker['kind']) => () => {
    let id = '';
    if (cmd.editSeq(kind === 'chapter' ? 'Add chapter marker' : kind === 'todo' ? 'Add to-do marker' : 'Add marker', (s) => void (id = ops.addMarker(s, time, { kind, color: kind === 'chapter' ? 'violet' : kind === 'todo' ? 'orange' : 'teal' })))) if (id) st.select({ markerIds: [id] });
  };
  const items: MenuItem[] = [];
  if (marker) {
    items.push(
      { label: 'Edit Marker…', run: () => st.openModal('timeline.marker', { markerId: marker.id }) },
      { label: 'Delete Marker', danger: true, run: () => cmd.editSeq('Delete marker', (s) => void (s.markers = s.markers.filter((m) => m.id !== marker.id))) },
      { separator: true },
    );
  }
  items.push(
    { label: 'Add Marker Here', hint: hint('timeline.addMarker'), run: add('marker') },
    { label: 'Add Chapter Marker Here', run: add('chapter') },
    { label: 'Add To-do Marker Here', run: add('todo') },
    { separator: true },
    { label: 'Set In Here', run: () => cmd.editSeq('Set in', (s) => void ((s.inPoint = time), s.outPoint !== null && s.outPoint <= time && (s.outPoint = null))) },
    { label: 'Set Out Here', run: () => cmd.editSeq('Set out', (s) => void ((s.outPoint = time), s.inPoint !== null && s.inPoint >= time && (s.inPoint = null))) },
    { label: 'Clear In and Out', disabled: seq.inPoint === null && seq.outPoint === null, run: () => cmd.editSeq('Clear in and out', (s) => void ((s.inPoint = null), (s.outPoint = null))) },
    { separator: true },
    { label: 'Delete All Markers', disabled: !seq.markers.length, danger: true, run: () => cmd.editSeq('Delete all markers', (s) => void (s.markers = [])) },
  );
  return items;
}

export function trackHeaderMenu(track: Track): MenuItem[] {
  const seq = cmd.currentSeq();
  if (!seq) return [];
  const index = seq.tracks.findIndex((t) => t.id === track.id);
  const kindName = track.kind === 'video' ? 'Video' : track.kind === 'audio' ? 'Audio' : 'Caption';
  return [
    { label: `Add ${kindName} Track Above`, run: () => cmd.addTrack(track.kind, index) },
    { label: `Add ${kindName} Track Below`, run: () => cmd.addTrack(track.kind, index + 1) },
    { label: 'Delete Track', danger: true, run: () => cmd.removeTrack(track.id), testId: 'tl-track-delete' },
    { separator: true },
    { label: 'Color', submenu: labelSubmenu(track.color, (l) => cmd.setTrackColor(track.id, l)) },
    { separator: true },
    { label: track.targeted ? 'Untarget' : 'Target', run: () => cmd.patchTrack(track.id, track.targeted ? 'Untarget track' : 'Target track', (t) => void (t.targeted = !t.targeted)) },
    { label: track.locked ? 'Unlock' : 'Lock', run: () => cmd.patchTrack(track.id, track.locked ? 'Unlock track' : 'Lock track', (t) => void (t.locked = !t.locked)) },
    ...(track.kind !== 'caption'
      ? [
          { separator: true },
          { label: 'Select All on Track', run: () => cmd.selectTrackClips(track.id) },
          { label: 'Close All Gaps', run: () => cmd.editSeq('Close all gaps', (s) => cmd.closeGapsOn(s, [track.id])), disabled: track.locked },
        ]
      : []),
  ];
}

export function tabMenu(seqId: string, startRenameTab: () => void): MenuItem[] {
  const st = S();
  const p = st.project;
  if (!p) return [];
  return [
    { label: 'Rename…', run: startRenameTab },
    {
      label: 'Sequence Settings…',
      run: () => {
        if (p.activeSequenceId !== seqId) cmd.switchSequence(seqId);
        st.openModal('timeline.sequenceSettings');
      },
    },
    { label: 'Duplicate Sequence', run: () => cmd.duplicateSequence(seqId) },
    { separator: true },
    { label: 'Close Tab', run: () => cmd.closeSequenceTab(seqId) },
    { label: 'Delete Sequence', danger: true, disabled: p.sequences.length <= 1, run: () => cmd.deleteSequence(seqId) },
  ];
}
