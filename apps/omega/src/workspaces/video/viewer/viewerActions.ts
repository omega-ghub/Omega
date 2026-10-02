// The viewer package's actions (Premiere-compatible keys). Registered by
// index.ts as a side effect of importing the package.
import { useEditor } from '../../../state/store';
import { keysFor, listActions, registerActions, type Action } from '../actions';
import * as cmd from './commands';
import { useViewerUi } from './uiState';

const ed = () => useEditor.getState();
const hasProject = () => !!ed().project;

/** True when some other package's action already answers this key (then ours steps aside). */
function claimedElsewhere(selfId: string, key: string): boolean {
  return listActions().some((a) => a.id !== selfId && !a.id.startsWith('viewer.') && keysFor(a.id).includes(key) && (!a.enabled || a.enabled()));
}

const P = 'Playback';
const M = 'Marking';
const V = 'View';

export const VIEWER_ACTIONS: Action[] = [
  // ---- playback ----
  { id: 'viewer.playPause', label: 'Play / pause', group: P, keys: ['Space'], run: cmd.togglePlay, enabled: hasProject, hint: 'Plays the focused monitor' },
  { id: 'viewer.shuttleReverse', label: 'Shuttle reverse (J)', group: P, keys: ['J'], run: () => cmd.shuttle(-1), enabled: hasProject, hint: 'Tap again for 2×, 4×, 8×. Hold K and tap J to step back a frame' },
  { id: 'viewer.shuttleStop', label: 'Stop (K)', group: P, keys: ['K'], run: cmd.stop, enabled: hasProject },
  { id: 'viewer.shuttleForward', label: 'Shuttle forward (L)', group: P, keys: ['L'], run: () => cmd.shuttle(1), enabled: hasProject, hint: 'Tap again for 2×, 4×, 8×. Hold K and tap L to step forward a frame' },
  { id: 'viewer.stepBack', label: 'Step back one frame', group: P, keys: ['ArrowLeft'], run: () => cmd.step(-1), enabled: hasProject },
  { id: 'viewer.stepForward', label: 'Step forward one frame', group: P, keys: ['ArrowRight'], run: () => cmd.step(1), enabled: hasProject },
  { id: 'viewer.stepBack5', label: 'Step back five frames', group: P, keys: ['Shift+ArrowLeft'], run: () => cmd.step(-5), enabled: hasProject },
  { id: 'viewer.stepForward5', label: 'Step forward five frames', group: P, keys: ['Shift+ArrowRight'], run: () => cmd.step(5), enabled: hasProject },
  { id: 'viewer.goToStart', label: 'Go to start', group: P, keys: ['Home'], run: cmd.goToStart, enabled: hasProject },
  { id: 'viewer.goToEnd', label: 'Go to end', group: P, keys: ['End'], run: cmd.goToEnd, enabled: hasProject },
  { id: 'viewer.goToIn', label: 'Go to in', group: P, keys: ['Shift+I'], run: cmd.goToIn, enabled: hasProject },
  { id: 'viewer.goToOut', label: 'Go to out', group: P, keys: ['Shift+O'], run: cmd.goToOut, enabled: hasProject },
  {
    id: 'viewer.prevEdit',
    label: 'Go to previous edit point',
    group: P,
    keys: ['ArrowUp'],
    run: cmd.prevEdit,
    enabled: () => hasProject() && !claimedElsewhere('viewer.prevEdit', 'ArrowUp'),
  },
  {
    id: 'viewer.nextEdit',
    label: 'Go to next edit point',
    group: P,
    keys: ['ArrowDown'],
    run: cmd.nextEdit,
    enabled: () => hasProject() && !claimedElsewhere('viewer.nextEdit', 'ArrowDown'),
  },
  { id: 'viewer.playAround', label: 'Play around', group: P, keys: ['Shift+K'], run: cmd.playAround, enabled: hasProject, hint: 'Plays two seconds either side of the playhead, then returns' },
  { id: 'viewer.playInToOut', label: 'Play in to out', group: P, keys: ['Mod+Shift+Space'], run: cmd.playInToOut, enabled: hasProject },
  { id: 'viewer.toggleLoop', label: 'Loop playback', group: P, keys: ['Alt+L'], run: cmd.toggleLoop, hint: 'Loops in to out, or the whole sequence' },
  {
    id: 'viewer.matchFrame',
    label: 'Match frame',
    group: P,
    keys: ['F'],
    run: cmd.matchFrame,
    enabled: () => hasProject() && !claimedElsewhere('viewer.matchFrame', 'F'),
    hint: 'Opens the clip under the playhead in the source monitor at the same frame',
  },

  // ---- marking ----
  { id: 'viewer.markIn', label: 'Mark in', group: M, keys: ['I'], run: cmd.markIn, enabled: hasProject, hint: 'On the focused monitor' },
  { id: 'viewer.markOut', label: 'Mark out', group: M, keys: ['O'], run: cmd.markOut, enabled: hasProject, hint: 'On the focused monitor' },
  { id: 'viewer.clearIn', label: 'Clear in', group: M, keys: ['Mod+Shift+I'], run: cmd.clearIn, enabled: hasProject },
  { id: 'viewer.clearOut', label: 'Clear out', group: M, keys: ['Mod+Shift+O'], run: cmd.clearOut, enabled: hasProject },
  { id: 'viewer.clearInOut', label: 'Clear in and out', group: M, keys: ['Mod+Shift+X'], run: cmd.clearInOut, enabled: hasProject },

  // ---- view ----
  { id: 'viewer.fullscreen', label: 'Full-screen program', group: V, keys: ['`'], run: cmd.toggleFullscreen, enabled: hasProject, hint: 'Escape exits' },
  { id: 'viewer.zoomFit', label: 'Viewer: fit', group: V, keys: ['Shift+Z'], run: cmd.zoomFit, enabled: hasProject },
  // Shift+= / Shift+- zoom the viewer while the pointer is over it (handled by the monitor; the timeline owns them globally).
  { id: 'viewer.zoomIn', label: 'Viewer: zoom in', group: V, run: cmd.zoomIn, enabled: hasProject },
  { id: 'viewer.zoomOut', label: 'Viewer: zoom out', group: V, run: cmd.zoomOut, enabled: hasProject },
  { id: 'viewer.zoom100', label: 'Viewer: 100%', group: V, run: () => cmd.setZoom(1), enabled: hasProject },
  { id: 'viewer.safeAreas', label: 'Show safe areas', group: V, run: () => ed().setViewer({ safeAreas: !ed().viewer.safeAreas }) },
  { id: 'viewer.gridThirds', label: 'Grid: rule of thirds', group: V, run: () => ed().setViewer({ grid: ed().viewer.grid === 'thirds' ? 'off' : 'thirds' }) },
  { id: 'viewer.gridCenter', label: 'Grid: center cross', group: V, run: () => ed().setViewer({ grid: ed().viewer.grid === 'center' ? 'off' : 'center' }) },
  { id: 'viewer.gridGolden', label: 'Grid: golden ratio', group: V, run: () => ed().setViewer({ grid: ed().viewer.grid === 'golden' ? 'off' : 'golden' }) },
  { id: 'viewer.compareSplit', label: 'Compare: split wipe (before / after grade)', group: V, run: () => ed().setViewer({ compare: ed().viewer.compare === 'split' ? 'off' : 'split' }) },
  { id: 'viewer.compareBypass', label: 'Compare: bypass grades', group: V, run: () => ed().setViewer({ compare: ed().viewer.compare === 'bypass' ? 'off' : 'bypass' }) },
  { id: 'viewer.showMatte', label: 'Show qualifier matte', group: V, run: () => ed().setViewer({ showMatte: !ed().viewer.showMatte }) },
  { id: 'viewer.checkerboard', label: 'Show transparency as a checkerboard', group: V, run: () => useViewerUi.getState().setCheckerboard(!useViewerUi.getState().checkerboard) },
  { id: 'viewer.proxies', label: 'Use proxies for playback', group: V, run: () => ed().setViewer({ useProxies: !ed().viewer.useProxies }) },
  { id: 'viewer.resAuto', label: 'Playback resolution: Auto', group: V, run: () => ed().setViewer({ playbackScale: 'auto' }) },
  { id: 'viewer.resFull', label: 'Playback resolution: Full', group: V, run: () => ed().setViewer({ playbackScale: 1 }) },
  { id: 'viewer.resHalf', label: 'Playback resolution: 1/2', group: V, run: () => ed().setViewer({ playbackScale: 0.5 }) },
  { id: 'viewer.resQuarter', label: 'Playback resolution: 1/4', group: V, run: () => ed().setViewer({ playbackScale: 0.25 }) },
  { id: 'viewer.cropMode', label: 'Crop in the viewer', group: V, run: () => useViewerUi.getState().setCropMode(!useViewerUi.getState().cropMode), enabled: hasProject },

  // ---- export / tools ----
  { id: 'viewer.exportFrame', label: 'Export frame', group: 'Export', keys: ['Mod+Shift+E'], run: cmd.exportFrame, enabled: hasProject, hint: 'Saves the current frame as a full-resolution PNG' },
  { id: 'viewer.textTool', label: 'Type tool', group: 'Tools', keys: ['T'], run: cmd.textTool, enabled: hasProject, hint: 'Click in the program monitor to add a title' },
];

let registered = false;

export function registerViewerActions(): void {
  if (registered) return;
  registered = true;
  registerActions(VIEWER_ACTIONS);
}
