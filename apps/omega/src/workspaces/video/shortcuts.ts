// Premiere-compatible defaults for the Video workspace. One table drives both
// the key handler and the reference shown on the dashboard's Learn page.

export interface ShortcutDef {
  id: string;
  group: string;
  label: string;
  keys: string[]; // display form
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'play', group: 'Playback', label: 'Play / pause', keys: ['Space'] },
  { id: 'shuttle-left', group: 'Playback', label: 'Back one second', keys: ['J'] },
  { id: 'stop', group: 'Playback', label: 'Stop', keys: ['K'] },
  { id: 'shuttle-right', group: 'Playback', label: 'Play forward', keys: ['L'] },
  { id: 'frame-back', group: 'Playback', label: 'Step back one frame', keys: ['←'] },
  { id: 'frame-fwd', group: 'Playback', label: 'Step forward one frame', keys: ['→'] },
  { id: 'frames-back', group: 'Playback', label: 'Step back five frames', keys: ['Shift', '←'] },
  { id: 'frames-fwd', group: 'Playback', label: 'Step forward five frames', keys: ['Shift', '→'] },
  { id: 'home', group: 'Playback', label: 'Go to start', keys: ['Home'] },
  { id: 'end', group: 'Playback', label: 'Go to end', keys: ['End'] },
  { id: 'prev-edit', group: 'Playback', label: 'Previous edit point', keys: ['↑'] },
  { id: 'next-edit', group: 'Playback', label: 'Next edit point', keys: ['↓'] },
  { id: 'in', group: 'Marking', label: 'Mark in', keys: ['I'] },
  { id: 'out', group: 'Marking', label: 'Mark out', keys: ['O'] },
  { id: 'clear-in-out', group: 'Marking', label: 'Clear in and out', keys: ['Ctrl', 'Shift', 'X'] },
  { id: 'select-tool', group: 'Tools', label: 'Selection tool', keys: ['V'] },
  { id: 'razor-tool', group: 'Tools', label: 'Razor tool', keys: ['C'] },
  { id: 'split', group: 'Editing', label: 'Add edit (split at playhead)', keys: ['Ctrl', 'K'] },
  { id: 'delete', group: 'Editing', label: 'Delete selected clips', keys: ['Delete'] },
  { id: 'select-all', group: 'Editing', label: 'Select all clips', keys: ['Ctrl', 'A'] },
  { id: 'undo', group: 'Editing', label: 'Undo', keys: ['Ctrl', 'Z'] },
  { id: 'redo', group: 'Editing', label: 'Redo', keys: ['Ctrl', 'Shift', 'Z'] },
  { id: 'insert', group: 'Editing', label: 'Add selected media at playhead', keys: [','] },
  { id: 'zoom-in', group: 'View', label: 'Zoom in', keys: ['='] },
  { id: 'zoom-out', group: 'View', label: 'Zoom out', keys: ['-'] },
  { id: 'zoom-fit', group: 'View', label: 'Zoom to fit sequence', keys: ['\\'] },
  { id: 'import', group: 'Project', label: 'Import media', keys: ['Ctrl', 'I'] },
  { id: 'save', group: 'Project', label: 'Save project', keys: ['Ctrl', 'S'] },
  { id: 'export', group: 'Project', label: 'Export', keys: ['Ctrl', 'M'] },
];
