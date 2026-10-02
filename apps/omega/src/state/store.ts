// Editor state for Delta (the video app). OWNED BY CORE.
//
// The project document is immutable (immer). Every change goes through
// mutate(label, recipe), which records labeled history for undo/redo and the
// History panel. Packages add their own operations as pure functions on a
// draft (see engine/edit/ops.ts) and call mutate with them; they never write
// to `project` directly.

import { create } from 'zustand';
import { enablePatches, produce, setAutoFreeze } from 'immer';
import type { AppInfo } from '../../electron/api';
import { applyTheme } from '../brand/themes';
import { snapToFrame } from '../engine/time';
import { migrateProject } from './migrate';
import type { Clip, ColorGrade, Project, ProjectHandle, Sequence, TrackKind } from './types';
import { activeSequence, sequenceDuration } from './types';

enablePatches();
// Structural sharing makes undo snapshots cheap; freezing in dev catches accidental mutation.
setAutoFreeze(import.meta.env?.DEV ?? false);

export type Workspace = 'edit' | 'color' | 'audio' | 'effects' | 'captions' | 'deliver';

export type Tool =
  | 'select' // V
  | 'trackForward' // A
  | 'ripple' // B
  | 'roll' // N
  | 'rate' // R
  | 'slip' // Y
  | 'slide' // U
  | 'razor' // C
  | 'pen' // P (keyframes / rubber-band)
  | 'hand' // H
  | 'zoom' // Z
  | 'text'; // T

export interface HistoryEntry {
  label: string;
  time: number;
  /** The document BEFORE this change. */
  before: Project;
  coalesceKey?: string;
}

export interface Selection {
  clipIds: string[];
  markerIds: string[];
  cueIds: string[];
  trackId: string | null;
  /** Selected keyframes (graph/keyframe editors). */
  keyframes: { clipId: string; path: string; t: number }[];
  /** Selected asset in the media browser. */
  assetIds: string[];
}

export interface ViewerPrefs {
  zoom: 'fit' | number; // 1 = 100%
  safeAreas: boolean;
  grid: 'off' | 'thirds' | 'center' | 'golden';
  compare: 'off' | 'split' | 'bypass';
  comparePosition: number; // 0..1
  playbackScale: 'auto' | 1 | 0.5 | 0.25;
  useProxies: boolean;
  showMatte: boolean;
  loop: boolean;
}

export interface Toast {
  message: string;
  kind: 'info' | 'success' | 'error';
  id: number;
}

export interface ClipboardData {
  /** Clips with times relative to the earliest copied clip. */
  clips: { clip: Clip; trackIndex: number; trackKind: TrackKind }[];
}

interface EditorState {
  appInfo: AppInfo | null;
  project: Project | null;
  handle: ProjectHandle | null;
  dirty: boolean;
  saving: boolean;
  lastSavedAt: number | null;
  readOnly: boolean;
  toast: Toast | null;

  playhead: number;
  playing: boolean;
  shuttleRate: number;

  selection: Selection;
  tool: Tool;
  snapping: boolean;
  /** FCP-style: deleting/moving closes gaps on the track automatically. */
  magnetic: boolean;
  linkedSelection: boolean;
  zoom: number; // timeline pixels per second
  workspace: Workspace;
  viewer: ViewerPrefs;
  /** Source monitor */
  source: { assetId: string | null; time: number };
  /** Open modal dialog (owned by whichever package registered it). */
  modal: { id: string; props?: Record<string, unknown> } | null;

  past: HistoryEntry[];
  future: HistoryEntry[];
  clipboard: ClipboardData | null;
  gradeClipboard: ColorGrade | null;

  // ---- lifecycle ----
  init(): Promise<void>;
  openProject(path: string): Promise<void>;
  saveProject(opts?: { backup?: boolean }): Promise<void>;

  // ---- document changes ----
  mutate(label: string, recipe: (draft: Project) => void, opts?: { coalesceKey?: string }): void;
  mutateSequence(label: string, recipe: (seq: Sequence, project: Project) => void, opts?: { coalesceKey?: string }): void;
  undo(): void;
  redo(): void;
  /** Jump to the state before history entry `index` (History panel). */
  jumpToHistory(index: number): void;
  setActiveSequence(id: string): void;

  // ---- UI state ----
  setPlayhead(t: number): void;
  setPlaying(playing: boolean): void;
  setShuttleRate(rate: number): void;
  select(patch: Partial<Selection>): void;
  selectClips(ids: string[], mode?: 'replace' | 'add' | 'toggle'): void;
  clearSelection(): void;
  setTool(tool: Tool): void;
  setSnapping(on: boolean): void;
  setMagnetic(on: boolean): void;
  setLinkedSelection(on: boolean): void;
  setZoom(pxPerSecond: number): void;
  setWorkspace(ws: Workspace): void;
  setViewer(patch: Partial<ViewerPrefs>): void;
  setSource(patch: Partial<EditorState['source']>): void;
  openModal(id: string, props?: Record<string, unknown>): void;
  closeModal(): void;
  setClipboard(data: ClipboardData | null): void;
  setGradeClipboard(grade: ColorGrade | null): void;
  showToast(message: string, kind?: Toast['kind']): void;
}

const MAX_HISTORY = 300;
const COALESCE_MS = 900;
const BACKUP_EVERY_MS = 5 * 60_000;

const VIEWER_DEFAULTS: ViewerPrefs = {
  zoom: 'fit',
  safeAreas: false,
  grid: 'off',
  compare: 'off',
  comparePosition: 0.5,
  playbackScale: 'auto',
  useProxies: true,
  showMatte: false,
  loop: false,
};

function loadViewerPrefs(): ViewerPrefs {
  try {
    return { ...VIEWER_DEFAULTS, ...JSON.parse(localStorage.getItem('delta.viewer') ?? '{}') };
  } catch {
    return VIEWER_DEFAULTS;
  }
}

let lastBackupAt = 0;
let toastSeq = 0;

export const useEditor = create<EditorState>((set, get) => ({
  appInfo: null,
  project: null,
  handle: null,
  dirty: false,
  saving: false,
  lastSavedAt: null,
  readOnly: false,
  toast: null,

  playhead: 0,
  playing: false,
  shuttleRate: 0,

  selection: { clipIds: [], markerIds: [], cueIds: [], trackId: null, keyframes: [], assetIds: [] },
  tool: 'select',
  snapping: true,
  magnetic: false,
  linkedSelection: true,
  zoom: 80,
  workspace: 'edit',
  viewer: loadViewerPrefs(),
  source: { assetId: null, time: 0 },
  modal: null,

  past: [],
  future: [],
  clipboard: null,
  gradeClipboard: null,

  async init() {
    const appInfo = await window.omega.appInfo();
    set({ appInfo });
    applyTheme('video');
  },

  async openProject(path) {
    const raw = JSON.parse(await window.omega.projects.load(path));
    const project = migrateProject(raw);
    for (const a of project.assets) a.offline = !(await window.omega.media.exists(a.path));
    const dir = path.replace(/[\\/][^\\/]*$/, '');
    const seq = activeSequence(project);
    set({
      project,
      handle: { filePath: path, dir },
      dirty: false,
      playhead: seq?.inPoint ?? 0,
      past: [],
      future: [],
      selection: { clipIds: [], markerIds: [], cueIds: [], trackId: null, keyframes: [], assetIds: [] },
    });
    await window.omega.projects.addRecent({
      path,
      name: project.name,
      app: project.app,
      modifiedAt: Date.now(),
      summary: `${seq.width}×${seq.height} · ${seq.fps} fps`,
    });
  },

  async saveProject(opts) {
    const { project, handle, saving } = get();
    if (!project || !handle || saving) return;
    set({ saving: true });
    try {
      const saved: Project = { ...project, modifiedAt: Date.now() };
      // offline flags are recomputed on open; never persist them
      const json = JSON.stringify({ ...saved, assets: saved.assets.map(({ offline: _o, ...a }) => a) }, null, 2);
      await window.omega.projects.save(handle.filePath, json);
      // Rolling backups next to the project ("never lose work").
      if (opts?.backup || Date.now() - lastBackupAt > BACKUP_EVERY_MS) {
        lastBackupAt = Date.now();
        await window.omega.projects.backup(handle.filePath, json);
      }
      const seq = activeSequence(saved);
      await window.omega.projects.addRecent({
        path: handle.filePath,
        name: saved.name,
        app: saved.app,
        modifiedAt: saved.modifiedAt,
        summary: `${seq.width}×${seq.height} · ${seq.fps} fps`,
      });
      // Only clear `dirty` if nothing changed while saving.
      set((s) => ({ project: s.project === project ? saved : s.project, dirty: s.project !== project, lastSavedAt: Date.now() }));
    } catch (err) {
      get().showToast(`Save failed: ${(err as Error).message}`, 'error');
    } finally {
      set({ saving: false });
    }
  },

  mutate(label, recipe, opts) {
    const { project, past, readOnly } = get();
    if (!project || readOnly) return;
    const next = produce(project, recipe);
    if (next === project) return;
    const last = past[past.length - 1];
    const now = Date.now();
    // Coalesce rapid edits of the same control (slider drags) into one undo step.
    if (opts?.coalesceKey && last && last.coalesceKey === opts.coalesceKey && now - last.time < COALESCE_MS) {
      set({ project: next, dirty: true, future: [], past: [...past.slice(0, -1), { ...last, time: now }] });
      return;
    }
    const entry: HistoryEntry = { label, time: now, before: project, coalesceKey: opts?.coalesceKey };
    set({ project: next, dirty: true, future: [], past: [...past.slice(-(MAX_HISTORY - 1)), entry] });
  },

  mutateSequence(label, recipe, opts) {
    get().mutate(
      label,
      (draft) => {
        const seq = draft.sequences.find((s) => s.id === draft.activeSequenceId) ?? draft.sequences[0];
        recipe(seq, draft);
      },
      opts,
    );
  },

  undo() {
    const { project, past, future } = get();
    if (!project || past.length === 0) return;
    const entry = past[past.length - 1];
    set({
      project: entry.before,
      past: past.slice(0, -1),
      future: [{ ...entry, before: project }, ...future],
      dirty: true,
    });
    pruneSelection();
  },

  redo() {
    const { project, past, future } = get();
    if (!project || future.length === 0) return;
    const entry = future[0];
    set({
      project: entry.before,
      future: future.slice(1),
      past: [...past, { ...entry, before: project, coalesceKey: undefined }],
      dirty: true,
    });
    pruneSelection();
  },

  jumpToHistory(index) {
    const { past, future } = get();
    // index into the combined timeline [past..., (current), future...]
    if (index < past.length) {
      for (let i = past.length; i > index; i--) get().undo();
    } else {
      const steps = Math.min(index - past.length, future.length);
      for (let i = 0; i < steps; i++) get().redo();
    }
  },

  setActiveSequence(id) {
    const { project } = get();
    if (!project || !project.sequences.some((s) => s.id === id)) return;
    // Switching sequences is navigation, not an edit: no history entry.
    set({ project: { ...project, activeSequenceId: id }, dirty: true, playhead: 0 });
    get().clearSelection();
  },

  setPlayhead(t) {
    const p = get().project;
    if (!p) return;
    const seq = activeSequence(p);
    const max = Math.max(sequenceDuration(seq), 0);
    set({ playhead: snapToFrame(Math.max(0, Math.min(t, max)), seq.fps) });
  },
  setPlaying: (playing) => set({ playing }),
  setShuttleRate: (shuttleRate) => set({ shuttleRate }),

  select: (patch) => set((s) => ({ selection: { ...s.selection, ...patch } })),

  selectClips(ids, mode = 'replace') {
    const { project, linkedSelection, selection } = get();
    let expanded = ids;
    if (project && linkedSelection) {
      // Selecting one half of a linked A/V pair (or a group) selects the whole set.
      const seq = activeSequence(project);
      const all = seq.tracks.flatMap((t) => t.clips);
      const links = new Set(all.filter((c) => ids.includes(c.id) && c.linkId).map((c) => c.linkId));
      const groups = new Set(all.filter((c) => ids.includes(c.id) && c.groupId).map((c) => c.groupId));
      expanded = all.filter((c) => ids.includes(c.id) || (c.linkId && links.has(c.linkId)) || (c.groupId && groups.has(c.groupId))).map((c) => c.id);
    }
    let next: string[];
    if (mode === 'replace') next = expanded;
    else if (mode === 'add') next = [...new Set([...selection.clipIds, ...expanded])];
    else {
      const cur = new Set(selection.clipIds);
      const allIn = expanded.every((id) => cur.has(id));
      for (const id of expanded) allIn ? cur.delete(id) : cur.add(id);
      next = [...cur];
    }
    set({ selection: { ...selection, clipIds: next, keyframes: [] } });
  },

  clearSelection: () => set((s) => ({ selection: { ...s.selection, clipIds: [], markerIds: [], cueIds: [], keyframes: [] } })),
  setTool: (tool) => set({ tool }),
  setSnapping: (snapping) => set({ snapping }),
  setMagnetic: (magnetic) => set({ magnetic }),
  setLinkedSelection: (linkedSelection) => set({ linkedSelection }),
  setZoom: (zoom) => set({ zoom: Math.max(0.5, Math.min(4000, zoom)) }),
  setWorkspace: (workspace) => set({ workspace }),

  setViewer(patch) {
    const viewer = { ...get().viewer, ...patch };
    set({ viewer });
    try {
      localStorage.setItem('delta.viewer', JSON.stringify(viewer));
    } catch {
      /* ignore */
    }
  },

  setSource: (patch) => set((s) => ({ source: { ...s.source, ...patch } })),
  openModal: (id, props) => set({ modal: { id, props } }),
  closeModal: () => set({ modal: null }),
  setClipboard: (clipboard) => set({ clipboard }),
  setGradeClipboard: (gradeClipboard) => set({ gradeClipboard }),

  showToast(message, kind = 'info') {
    const id = ++toastSeq;
    set({ toast: { message, kind, id } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, kind === 'error' ? 6000 : 3200);
  },
}));

/** Drop selected ids that no longer exist after undo/redo. */
function pruneSelection() {
  const { project, selection } = useEditor.getState();
  if (!project) return;
  const seq = activeSequence(project);
  const clipIds = new Set(seq.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  const markerIds = new Set(seq.markers.map((m) => m.id));
  useEditor.setState({
    selection: {
      ...selection,
      clipIds: selection.clipIds.filter((id) => clipIds.has(id)),
      markerIds: selection.markerIds.filter((id) => markerIds.has(id)),
      keyframes: selection.keyframes.filter((k) => clipIds.has(k.clipId)),
    },
  });
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** The active sequence (throws if no project is open). */
export function useSequence(): Sequence {
  return useEditor((s) => activeSequence(s.project!));
}

export function getSequence(): Sequence {
  return activeSequence(useEditor.getState().project!);
}

/** Selected clips of the active sequence. */
export function useSelectedClips(): Clip[] {
  const ids = useEditor((s) => s.selection.clipIds);
  const seq = useSequence();
  return seq.tracks.flatMap((t) => t.clips.filter((c) => ids.includes(c.id)));
}

/** Back-compat alias used by older call sites. */
export const useStore = useEditor;
