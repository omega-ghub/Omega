// UI-only state of Delta's shell (never part of the document or undo).
// OWNED BY THE SHELL PACKAGE.

import { create } from 'zustand';
import type { Workspace } from '../../../state/store';

export type PanelId =
  | 'media'
  | 'effectsBrowser'
  | 'titles'
  | 'history'
  | 'source'
  | 'program'
  | 'inspector'
  | 'timeline'
  | 'scopes'
  | 'color'
  | 'mixer'
  | 'loudness'
  | 'clipAudio'
  | 'captions'
  | 'deliver';

export type Region = 'left' | 'right' | 'timeline';

export interface Sizes {
  /** Left column width (px). */
  left: number;
  /** Right column width (px). */
  right: number;
  /** Edit: Source share of the Source|Program row. Audio: top share of the right stack. */
  split: number;
  /** Timeline height (px). */
  timeline: number;
}

export const DEFAULT_SIZES: Record<Workspace, Sizes> = {
  edit: { left: 300, right: 320, split: 0.5, timeline: 330 },
  color: { left: 380, right: 400, split: 0.5, timeline: 176 },
  audio: { left: 440, right: 340, split: 0.5, timeline: 320 },
  effects: { left: 300, right: 340, split: 0.5, timeline: 320 },
  captions: { left: 400, right: 320, split: 0.5, timeline: 320 },
  deliver: { left: 560, right: 0, split: 0.5, timeline: 168 },
};

export const MIN = { side: 220, center: 320, timeline: 112, top: 220 };

const LAYOUT_KEY = 'delta.layout.v1';
const SHELL_KEY = 'delta.shell.v1';
const RECENT_KEY = 'delta.palette.recent';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the UI still works, it just won't remember */
  }
}

interface Persisted {
  /** Active tab per workspace column, e.g. { 'edit.left': 'history' }. */
  tabs: Record<string, PanelId>;
  /** Hidden regions per workspace, e.g. { 'edit.right': true }. */
  hidden: Record<string, boolean>;
}

interface ShellState extends Persisted {
  sizes: Record<Workspace, Sizes>;
  /** Panel shown alone (Premiere's "maximize frame", the ` key). */
  maximized: PanelId | null;
  /** Panel that last received a click (drives the focus outline and `). */
  focusedPanel: PanelId | null;
  hoveredPanel: PanelId | null;
  recentActions: string[];

  setSize(ws: Workspace, patch: Partial<Sizes>): void;
  resetSize(ws: Workspace, key: keyof Sizes): void;
  setTab(slot: string, panel: PanelId): void;
  toggleRegion(ws: Workspace, region: Region): void;
  setMaximized(p: PanelId | null): void;
  setFocusedPanel(p: PanelId | null): void;
  setHoveredPanel(p: PanelId | null): void;
  noteRecentAction(id: string): void;
}

const persisted = load<Persisted>(SHELL_KEY, { tabs: {}, hidden: {} });

function loadSizes(): Record<Workspace, Sizes> {
  const stored = load<Partial<Record<Workspace, Partial<Sizes>>>>(LAYOUT_KEY, {});
  const out = {} as Record<Workspace, Sizes>;
  for (const ws of Object.keys(DEFAULT_SIZES) as Workspace[]) out[ws] = { ...DEFAULT_SIZES[ws], ...(stored[ws] ?? {}) };
  return out;
}

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

export const useShell = create<ShellState>((set, get) => ({
  tabs: persisted.tabs ?? {},
  hidden: persisted.hidden ?? {},
  sizes: loadSizes(),
  maximized: null,
  focusedPanel: null,
  hoveredPanel: null,
  recentActions: loadRecent(),

  setSize(ws, patch) {
    const sizes = { ...get().sizes, [ws]: { ...get().sizes[ws], ...patch } };
    set({ sizes });
    save(LAYOUT_KEY, sizes);
  },
  resetSize(ws, key) {
    get().setSize(ws, { [key]: DEFAULT_SIZES[ws][key] });
  },
  setTab(slot, panel) {
    const tabs = { ...get().tabs, [slot]: panel };
    set({ tabs });
    save(SHELL_KEY, { tabs, hidden: get().hidden });
  },
  toggleRegion(ws, region) {
    const key = `${ws}.${region}`;
    const hidden = { ...get().hidden, [key]: !get().hidden[key] };
    set({ hidden, maximized: null });
    save(SHELL_KEY, { tabs: get().tabs, hidden });
  },
  setMaximized: (maximized) => set({ maximized }),
  setFocusedPanel: (focusedPanel) => {
    if (get().focusedPanel !== focusedPanel) set({ focusedPanel });
  },
  setHoveredPanel: (hoveredPanel) => {
    if (get().hoveredPanel !== hoveredPanel) set({ hoveredPanel });
  },
  noteRecentAction(id) {
    const recentActions = [id, ...get().recentActions.filter((x) => x !== id)].slice(0, 12);
    set({ recentActions });
    save(RECENT_KEY, recentActions);
  },
}));
