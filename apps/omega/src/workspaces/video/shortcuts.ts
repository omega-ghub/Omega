// Delta's default keyboard layout (Premiere Pro–compatible), as shown on the
// hub's Learn page. The hub does not load Delta's packages, so this is a
// static reference of the defaults each package registers in the action
// registry (workspaces/video/actions.ts); keep it in sync when defaults change.
// Keys use the registry syntax ('Mod+K'); each entry may list alternatives.
// OWNED BY THE SHELL PACKAGE.

export interface ShortcutDef {
  /** Action id in the registry. */
  id: string;
  group: string;
  label: string;
  /** Alternative bindings, registry syntax. */
  keys: string[];
}

export const SHORTCUTS: ShortcutDef[] = [
  // Playback (viewer)
  { id: 'viewer.playPause', group: 'Playback', label: 'Play / pause', keys: ['Space'] },
  { id: 'viewer.shuttleReverse', group: 'Playback', label: 'Shuttle reverse (tap for 2×, 4×, 8×)', keys: ['J'] },
  { id: 'viewer.shuttleStop', group: 'Playback', label: 'Stop', keys: ['K'] },
  { id: 'viewer.shuttleForward', group: 'Playback', label: 'Shuttle forward (tap for 2×, 4×, 8×)', keys: ['L'] },
  { id: 'viewer.stepBack', group: 'Playback', label: 'Step back one frame', keys: ['ArrowLeft'] },
  { id: 'viewer.stepForward', group: 'Playback', label: 'Step forward one frame', keys: ['ArrowRight'] },
  { id: 'viewer.stepBack5', group: 'Playback', label: 'Step back five frames', keys: ['Shift+ArrowLeft'] },
  { id: 'viewer.stepForward5', group: 'Playback', label: 'Step forward five frames', keys: ['Shift+ArrowRight'] },
  { id: 'viewer.goToStart', group: 'Playback', label: 'Go to start', keys: ['Home'] },
  { id: 'viewer.goToEnd', group: 'Playback', label: 'Go to end', keys: ['End'] },
  { id: 'timeline.prevEdit', group: 'Playback', label: 'Previous edit point', keys: ['ArrowUp'] },
  { id: 'timeline.nextEdit', group: 'Playback', label: 'Next edit point', keys: ['ArrowDown'] },
  { id: 'viewer.playAround', group: 'Playback', label: 'Play around the playhead', keys: ['Shift+K'] },
  { id: 'viewer.playInToOut', group: 'Playback', label: 'Play in to out', keys: ['Mod+Shift+Space'] },
  { id: 'viewer.toggleLoop', group: 'Playback', label: 'Loop playback', keys: ['Alt+L'] },
  { id: 'viewer.fullscreen', group: 'Playback', label: 'Full-screen program', keys: ['`'] },

  // Marking
  { id: 'viewer.markIn', group: 'Marking', label: 'Mark in', keys: ['I'] },
  { id: 'viewer.markOut', group: 'Marking', label: 'Mark out', keys: ['O'] },
  { id: 'timeline.markClip', group: 'Marking', label: 'Mark clip', keys: ['X'] },
  { id: 'viewer.goToIn', group: 'Marking', label: 'Go to in', keys: ['Shift+I'] },
  { id: 'viewer.goToOut', group: 'Marking', label: 'Go to out', keys: ['Shift+O'] },
  { id: 'viewer.clearInOut', group: 'Marking', label: 'Clear in and out', keys: ['Mod+Shift+X'] },
  { id: 'timeline.addMarker', group: 'Marking', label: 'Add marker', keys: ['M'] },
  { id: 'timeline.nextMarker', group: 'Marking', label: 'Next marker', keys: ['Shift+M'] },
  { id: 'timeline.prevMarker', group: 'Marking', label: 'Previous marker', keys: ['Mod+Shift+M'] },

  // Tools (timeline)
  { id: 'timeline.tool.select', group: 'Tools', label: 'Selection', keys: ['V'] },
  { id: 'timeline.tool.trackForward', group: 'Tools', label: 'Track select forward', keys: ['A'] },
  { id: 'timeline.tool.ripple', group: 'Tools', label: 'Ripple edit', keys: ['B'] },
  { id: 'timeline.tool.roll', group: 'Tools', label: 'Rolling edit', keys: ['N'] },
  { id: 'timeline.tool.rate', group: 'Tools', label: 'Rate stretch', keys: ['R'] },
  { id: 'timeline.tool.slip', group: 'Tools', label: 'Slip', keys: ['Y'] },
  { id: 'timeline.tool.slide', group: 'Tools', label: 'Slide', keys: ['U'] },
  { id: 'timeline.tool.razor', group: 'Tools', label: 'Razor', keys: ['C'] },
  { id: 'timeline.tool.pen', group: 'Tools', label: 'Pen (keyframes)', keys: ['P'] },
  { id: 'timeline.tool.hand', group: 'Tools', label: 'Hand', keys: ['H'] },
  { id: 'timeline.tool.zoom', group: 'Tools', label: 'Zoom', keys: ['Z'] },
  { id: 'viewer.textTool', group: 'Tools', label: 'Type', keys: ['T'] },

  // Editing (timeline)
  { id: 'timeline.split', group: 'Editing', label: 'Add edit (split at playhead)', keys: ['Mod+K'] },
  { id: 'timeline.splitAll', group: 'Editing', label: 'Add edit to all tracks', keys: ['Mod+Shift+K'] },
  { id: 'timeline.insert', group: 'Editing', label: 'Insert', keys: [','] },
  { id: 'timeline.overwrite', group: 'Editing', label: 'Overwrite', keys: ['.'] },
  { id: 'timeline.lift', group: 'Editing', label: 'Lift', keys: [';'] },
  { id: 'timeline.extract', group: 'Editing', label: 'Extract', keys: ["'"] },
  { id: 'timeline.delete', group: 'Editing', label: 'Delete', keys: ['Delete', 'Backspace'] },
  { id: 'timeline.rippleDelete', group: 'Editing', label: 'Ripple delete', keys: ['Shift+Delete'] },
  { id: 'timeline.rippleTrimPrev', group: 'Editing', label: 'Ripple trim previous edit to playhead', keys: ['Q'] },
  { id: 'timeline.rippleTrimNext', group: 'Editing', label: 'Ripple trim next edit to playhead', keys: ['W'] },
  { id: 'timeline.extendEdit', group: 'Editing', label: 'Extend edit to playhead', keys: ['E'] },
  { id: 'timeline.nudgeLeft', group: 'Editing', label: 'Nudge one frame left / right', keys: ['Alt+ArrowLeft', 'Alt+ArrowRight'] },
  { id: 'timeline.copy', group: 'Editing', label: 'Copy / cut / paste', keys: ['Mod+C', 'Mod+X', 'Mod+V'] },
  { id: 'timeline.pasteInsert', group: 'Editing', label: 'Paste insert', keys: ['Mod+Shift+V'] },
  { id: 'timeline.defaultTransition', group: 'Editing', label: 'Default video transition', keys: ['Mod+D'] },
  { id: 'timeline.defaultAudioTransition', group: 'Editing', label: 'Default audio crossfade', keys: ['Mod+Shift+D'] },
  { id: 'edit.undo', group: 'Editing', label: 'Undo', keys: ['Mod+Z'] },
  { id: 'edit.redo', group: 'Editing', label: 'Redo', keys: ['Mod+Shift+Z', 'Mod+Y'] },

  // Clip
  { id: 'timeline.speedDialog', group: 'Clip', label: 'Speed / duration', keys: ['Mod+R'] },
  { id: 'timeline.toggleEnabled', group: 'Clip', label: 'Enable / disable', keys: ['Shift+E'] },
  { id: 'timeline.link', group: 'Clip', label: 'Link / unlink', keys: ['Mod+L'] },
  { id: 'timeline.group', group: 'Clip', label: 'Group / ungroup', keys: ['Mod+G', 'Mod+Shift+G'] },
  { id: 'timeline.nest', group: 'Clip', label: 'Nest', keys: ['Mod+Alt+N'] },
  { id: 'timeline.audioGain', group: 'Clip', label: 'Audio gain', keys: ['G'] },
  { id: 'timeline.freezeFrame', group: 'Clip', label: 'Freeze frame', keys: ['Alt+Shift+F'] },
  { id: 'viewer.matchFrame', group: 'Clip', label: 'Match frame', keys: ['F'] },

  // Timeline
  { id: 'timeline.zoomIn', group: 'Timeline', label: 'Zoom in / out', keys: ['=', '-'] },
  { id: 'timeline.zoomFit', group: 'Timeline', label: 'Zoom to fit sequence', keys: ['\\'] },
  { id: 'timeline.toggleSnapping', group: 'Timeline', label: 'Snapping', keys: ['S'] },
  { id: 'timeline.toggleMagnetic', group: 'Timeline', label: 'Magnetic timeline', keys: ['Alt+M'] },
  { id: 'timeline.selectAtPlayhead', group: 'Timeline', label: 'Select clip at playhead', keys: ['D'] },
  { id: 'timeline.selectAll', group: 'Timeline', label: 'Select all / deselect all', keys: ['Mod+A', 'Mod+Shift+A'] },

  // Workspaces and project (shell, media, deliver)
  { id: 'workspace.edit', group: 'Workspaces & project', label: 'Edit · Color · Audio · Effects · Captions · Deliver', keys: ['Alt+1…6'] },
  { id: 'shell.palette', group: 'Workspaces & project', label: 'Command palette', keys: ['Mod+Shift+P', 'Mod+P'] },
  { id: 'media.import', group: 'Workspaces & project', label: 'Import media', keys: ['Mod+I'] },
  { id: 'deliver.export', group: 'Workspaces & project', label: 'Export', keys: ['Mod+M'] },
  { id: 'viewer.exportFrame', group: 'Workspaces & project', label: 'Export frame', keys: ['Mod+Shift+E'] },
  { id: 'shell.save', group: 'Workspaces & project', label: 'Save (with backup)', keys: ['Mod+S'] },
  { id: 'shell.preferences', group: 'Workspaces & project', label: 'Preferences', keys: ['Mod+,'] },
  { id: 'shell.shortcuts', group: 'Workspaces & project', label: 'Keyboard shortcuts', keys: ['Mod+Alt+K'] },
  { id: 'shell.closeProject', group: 'Workspaces & project', label: 'Close project', keys: ['Mod+W'] },
];
