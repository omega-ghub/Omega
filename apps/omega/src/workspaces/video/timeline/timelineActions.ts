// Timeline actions with Premiere-compatible default keys. Registered once at
// import time (index.ts). I / O (mark in/out) belong to the viewer package.

import { useEditor, type Tool } from '../../../state/store';
import { registerActions, type Action } from '../actions';
import * as cmd from './commands';
import { HEIGHT_PRESETS } from './geometry';
import { useTLView, zoomToFit } from './view';

const S = () => useEditor.getState();
const hasProject = () => !!S().project;
const hasClips = () => !!S().project && S().selection.clipIds.length > 0;
const hasSomethingSelected = () => {
  const s = S();
  const v = useTLView.getState();
  return !!s.project && (s.selection.clipIds.length > 0 || s.selection.markerIds.length > 0 || s.selection.cueIds.length > 0 || s.selection.keyframes.length > 0 || !!v.gap || !!v.transition);
};

const TOOLS: { tool: Tool; key: string; label: string; hint: string }[] = [
  { tool: 'select', key: 'V', label: 'Selection tool', hint: 'Select, move and trim clips' },
  { tool: 'trackForward', key: 'A', label: 'Track select forward tool', hint: 'Selects every clip after the click on the track (Shift: all tracks)' },
  { tool: 'ripple', key: 'B', label: 'Ripple edit tool', hint: 'Trims an edit and shifts everything after it' },
  { tool: 'roll', key: 'N', label: 'Rolling edit tool', hint: 'Moves an edit point between two clips' },
  { tool: 'rate', key: 'R', label: 'Rate stretch tool', hint: 'Changes speed by dragging a clip edge' },
  { tool: 'slip', key: 'Y', label: 'Slip tool', hint: 'Changes the source in/out without moving the clip' },
  { tool: 'slide', key: 'U', label: 'Slide tool', hint: 'Moves a clip between its neighbours' },
  { tool: 'razor', key: 'C', label: 'Razor tool', hint: 'Splits clips where you click (Shift: all tracks)' },
  { tool: 'pen', key: 'P', label: 'Pen tool', hint: 'Adds and moves opacity and volume keyframes' },
  { tool: 'hand', key: 'H', label: 'Hand tool', hint: 'Scrolls the timeline' },
  { tool: 'zoom', key: 'Z', label: 'Zoom tool', hint: 'Click to zoom in, Alt-click to zoom out' },
];

export const TOOL_INFO = TOOLS;

const list: Action[] = [
  ...TOOLS.map((t) => ({ id: `timeline.tool.${t.tool}`, label: t.label, group: 'Tools', keys: [t.key], hint: t.hint, run: () => S().setTool(t.tool) })),

  // ---- editing
  { id: 'timeline.split', label: 'Add edit (split at playhead)', group: 'Edit', keys: ['Mod+K'], enabled: hasProject, hint: 'Splits the selected clips, or clips on targeted tracks, at the playhead', run: () => cmd.splitAtPlayhead(false) },
  { id: 'timeline.splitAll', label: 'Add edit to all tracks', group: 'Edit', keys: ['Mod+Shift+K'], enabled: hasProject, run: () => cmd.splitAtPlayhead(true) },
  { id: 'timeline.delete', label: 'Delete', group: 'Edit', keys: ['Delete', 'Backspace'], enabled: hasSomethingSelected, hint: 'Deletes the selected clips (closes gaps when magnetic)', run: () => cmd.deleteSelection(false) },
  { id: 'timeline.rippleDelete', label: 'Ripple delete', group: 'Edit', keys: ['Shift+Delete', 'Shift+Backspace'], enabled: hasSomethingSelected, hint: 'Deletes and closes the gap; also closes a selected gap', run: () => cmd.deleteSelection(true) },
  { id: 'timeline.lift', label: 'Lift', group: 'Edit', keys: [';'], enabled: hasProject, hint: 'Removes the In–Out range on targeted tracks, leaving a gap', run: () => cmd.liftExtract(false) },
  { id: 'timeline.extract', label: 'Extract', group: 'Edit', keys: ["'"], enabled: hasProject, hint: 'Removes the In–Out range on targeted tracks and closes the gap', run: () => cmd.liftExtract(true) },
  { id: 'timeline.insert', label: 'Insert', group: 'Edit', keys: [','], enabled: hasProject, hint: 'Inserts the source clip at the playhead (or sequence In)', run: () => cmd.sourceEdit('insert') },
  { id: 'timeline.overwrite', label: 'Overwrite', group: 'Edit', keys: ['.'], enabled: hasProject, hint: 'Overwrites with the source clip at the playhead (or sequence In)', run: () => cmd.sourceEdit('overwrite') },
  { id: 'timeline.nudgeLeft', label: 'Nudge clips left one frame', group: 'Edit', keys: ['Alt+ArrowLeft'], enabled: hasClips, run: () => cmd.nudge(-1) },
  { id: 'timeline.nudgeRight', label: 'Nudge clips right one frame', group: 'Edit', keys: ['Alt+ArrowRight'], enabled: hasClips, run: () => cmd.nudge(1) },
  { id: 'timeline.nudgeLeft5', label: 'Nudge clips left five frames', group: 'Edit', keys: ['Alt+Shift+ArrowLeft'], enabled: hasClips, run: () => cmd.nudge(-5) },
  { id: 'timeline.nudgeRight5', label: 'Nudge clips right five frames', group: 'Edit', keys: ['Alt+Shift+ArrowRight'], enabled: hasClips, run: () => cmd.nudge(5) },
  { id: 'timeline.moveUp', label: 'Move clips up a track', group: 'Edit', keys: ['Mod+Alt+ArrowUp'], enabled: hasClips, run: () => cmd.moveSelectionTrack(-1) },
  { id: 'timeline.moveDown', label: 'Move clips down a track', group: 'Edit', keys: ['Mod+Alt+ArrowDown'], enabled: hasClips, run: () => cmd.moveSelectionTrack(1) },
  { id: 'timeline.rippleTrimPrev', label: 'Ripple trim previous edit to playhead', group: 'Edit', keys: ['Q'], enabled: hasProject, run: () => cmd.rippleTrimToPlayhead('prev') },
  { id: 'timeline.rippleTrimNext', label: 'Ripple trim next edit to playhead', group: 'Edit', keys: ['W'], enabled: hasProject, run: () => cmd.rippleTrimToPlayhead('next') },
  { id: 'timeline.extendEdit', label: 'Extend selected edit to playhead', group: 'Edit', keys: ['E'], enabled: hasClips, run: () => cmd.extendEditToPlayhead() },

  // ---- clipboard
  { id: 'timeline.copy', label: 'Copy', group: 'Edit', keys: ['Mod+C'], enabled: hasClips, run: () => cmd.copySelection(false) },
  { id: 'timeline.cut', label: 'Cut', group: 'Edit', keys: ['Mod+X'], enabled: hasClips, run: () => cmd.copySelection(true) },
  { id: 'timeline.paste', label: 'Paste', group: 'Edit', keys: ['Mod+V'], enabled: () => hasProject() && !!S().clipboard?.clips.length, run: () => cmd.paste('overwrite') },
  { id: 'timeline.pasteInsert', label: 'Paste insert', group: 'Edit', keys: ['Mod+Shift+V'], enabled: () => hasProject() && !!S().clipboard?.clips.length, run: () => cmd.paste('insert') },
  {
    id: 'timeline.pasteAttributes',
    label: 'Paste attributes…',
    group: 'Edit',
    keys: ['Mod+Alt+V'],
    enabled: () => hasClips() && !!S().clipboard?.clips.length,
    run: () => S().openModal('timeline.pasteAttributes', { clipIds: S().selection.clipIds }),
  },

  // ---- clip
  { id: 'timeline.toggleEnabled', label: 'Enable / disable clip', group: 'Clip', keys: ['Shift+E'], enabled: hasClips, run: () => cmd.toggleEnabled() },
  { id: 'timeline.link', label: 'Link / unlink', group: 'Clip', keys: ['Mod+L'], enabled: hasClips, run: () => cmd.toggleLink() },
  { id: 'timeline.group', label: 'Group', group: 'Clip', keys: ['Mod+G'], enabled: hasClips, run: () => cmd.setGrouped(true) },
  { id: 'timeline.ungroup', label: 'Ungroup', group: 'Clip', keys: ['Mod+Shift+G'], enabled: hasClips, run: () => cmd.setGrouped(false) },
  { id: 'timeline.speedDialog', label: 'Speed/Duration…', group: 'Clip', keys: ['Mod+R'], enabled: hasClips, run: () => S().openModal('timeline.speed', { clipIds: S().selection.clipIds }) },
  { id: 'timeline.audioGain', label: 'Audio gain…', group: 'Clip', keys: ['G'], enabled: hasClips, run: () => S().openModal('timeline.audioGain', { clipIds: S().selection.clipIds }) },
  { id: 'timeline.freezeFrame', label: 'Freeze frame', group: 'Clip', keys: ['Alt+Shift+F'], enabled: hasProject, hint: 'Inserts a 2-second hold of the frame under the playhead', run: () => cmd.freezeFrameAtPlayhead() },
  { id: 'timeline.nest', label: 'Nest', group: 'Clip', keys: ['Mod+Alt+N'], enabled: hasClips, run: () => cmd.nestSelection() },
  {
    id: 'timeline.unnest',
    label: 'Un-nest',
    group: 'Clip',
    enabled: hasClips,
    run: () => {
      const seq = cmd.currentSeq();
      const nested = seq && cmd.selectedClips(seq).find((c) => c.kind === 'sequence');
      if (nested) cmd.unnestClip(nested.id);
      else cmd.toast('Select a nested sequence clip');
    },
  },
  { id: 'timeline.reverse', label: 'Reverse clip', group: 'Clip', enabled: hasClips, run: () => cmd.reverseClips(S().selection.clipIds) },
  { id: 'timeline.matchFrame', label: 'Match frame', group: 'Clip', enabled: hasProject, hint: 'Opens the clip under the playhead in the Source monitor at the same frame', run: () => cmd.matchFrame() },
  {
    id: 'timeline.revealInMedia',
    label: 'Reveal in Media',
    group: 'Clip',
    enabled: hasClips,
    run: () => {
      const seq = cmd.currentSeq();
      const c = seq && cmd.selectedClips(seq).find((x) => x.assetId);
      if (c) cmd.revealInMedia(c.id);
    },
  },
  { id: 'timeline.markClip', label: 'Mark clip', group: 'Marking', keys: ['X'], enabled: hasProject, hint: 'Sets the sequence In/Out to the clip under the playhead', run: () => cmd.markClip() },

  // ---- transitions
  { id: 'timeline.defaultTransition', label: 'Apply default video transition', group: 'Edit', keys: ['Mod+D'], enabled: hasProject, run: () => cmd.addDefaultTransition(false) },
  { id: 'timeline.defaultAudioTransition', label: 'Apply default audio crossfade', group: 'Edit', keys: ['Mod+Shift+D'], enabled: hasProject, run: () => cmd.addDefaultTransition(true) },

  // ---- markers & navigation
  { id: 'timeline.addMarker', label: 'Add marker', group: 'Marking', keys: ['M'], enabled: hasProject, hint: 'Adds a sequence marker at the playhead (press again to edit it)', run: () => cmd.addMarkerAtPlayhead() },
  { id: 'timeline.nextMarker', label: 'Go to next marker', group: 'Marking', keys: ['Shift+M'], enabled: hasProject, run: () => cmd.gotoMarker(1) },
  { id: 'timeline.prevMarker', label: 'Go to previous marker', group: 'Marking', keys: ['Mod+Shift+M'], enabled: hasProject, run: () => cmd.gotoMarker(-1) },
  { id: 'timeline.prevEdit', label: 'Go to previous edit point', group: 'Timeline', keys: ['ArrowUp'], enabled: hasProject, run: () => cmd.gotoEdit(-1) },
  { id: 'timeline.nextEdit', label: 'Go to next edit point', group: 'Timeline', keys: ['ArrowDown'], enabled: hasProject, run: () => cmd.gotoEdit(1) },
  { id: 'timeline.selectAtPlayhead', label: 'Select clip at playhead', group: 'Timeline', keys: ['D'], enabled: hasProject, run: () => cmd.selectAtPlayhead() },
  { id: 'timeline.selectAll', label: 'Select all', group: 'Timeline', keys: ['Mod+A'], enabled: hasProject, run: () => cmd.selectAll() },
  { id: 'timeline.deselectAll', label: 'Deselect all', group: 'Timeline', keys: ['Mod+Shift+A'], enabled: hasProject, run: () => cmd.deselectAll() },

  // ---- view
  { id: 'timeline.zoomIn', label: 'Zoom in', group: 'View', keys: ['=', '+'], enabled: hasProject, run: () => cmd.zoomBy(1.5) },
  { id: 'timeline.zoomOut', label: 'Zoom out', group: 'View', keys: ['-'], enabled: hasProject, run: () => cmd.zoomBy(1 / 1.5) },
  { id: 'timeline.zoomFit', label: 'Zoom to fit sequence', group: 'View', keys: ['\\'], enabled: hasProject, run: () => zoomToFit() },
  { id: 'timeline.toggleSnapping', label: 'Toggle snapping', group: 'Timeline', keys: ['S'], run: () => S().setSnapping(!S().snapping) },
  { id: 'timeline.toggleMagnetic', label: 'Toggle magnetic timeline', group: 'Timeline', keys: ['Alt+M'], hint: 'Deletes and moves close gaps automatically', run: () => S().setMagnetic(!S().magnetic) },
  { id: 'timeline.toggleLinkedSelection', label: 'Toggle linked selection', group: 'Timeline', run: () => S().setLinkedSelection(!S().linkedSelection) },
  ...(['S', 'M', 'L'] as const).map((p) => ({
    id: `timeline.trackHeight.${p}`,
    label: `Track height: ${p === 'S' ? 'small' : p === 'M' ? 'medium' : 'large'}`,
    group: 'View',
    enabled: hasProject,
    run: () => {
      cmd.setAllTrackHeights(HEIGHT_PRESETS[p]);
      useTLView.getState().setHeightPreset(p);
    },
  })),

  // ---- sequence & tracks
  { id: 'timeline.sequenceSettings', label: 'Sequence settings…', group: 'Sequence', enabled: hasProject, run: () => S().openModal('timeline.sequenceSettings') },
  { id: 'timeline.newSequence', label: 'New sequence', group: 'Sequence', enabled: hasProject, run: () => cmd.newSequence() },
  { id: 'timeline.addVideoTrack', label: 'Add video track', group: 'Sequence', enabled: hasProject, run: () => cmd.addTrack('video', 0) },
  { id: 'timeline.addAudioTrack', label: 'Add audio track', group: 'Sequence', enabled: hasProject, run: () => cmd.addTrack('audio') },
  { id: 'timeline.addCaptionTrack', label: 'Add caption track', group: 'Sequence', enabled: hasProject, run: () => cmd.addTrack('caption') },
];

let registered = false;
export function registerTimelineActions() {
  if (registered) return;
  registered = true;
  registerActions(list);
}
