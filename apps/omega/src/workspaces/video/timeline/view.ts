// Timeline UI state that is not part of the document: scroll position, open
// sequence tabs, menus, popovers and inline editors. Zoom (pixels per second)
// lives in the editor store (useEditor().zoom) because other panels read it.

import { create } from 'zustand';
import { useEditor } from '../../../state/store';
import type { LabelColor, Project } from '../../../state/types';
import { activeSequence, sequenceDuration } from '../../../state/types';
import { contentDuration } from './geometry';

export interface MenuItem {
  label?: string;
  hint?: string; // shortcut
  run?: () => void;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  separator?: boolean;
  submenu?: MenuItem[];
  /** Small color swatch before the label (label colors). */
  swatch?: string;
  testId?: string;
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
  testId?: string;
}

export type InlineEdit =
  | { kind: 'clipName'; clipId: string; x: number; y: number; w: number; h: number }
  | { kind: 'cue'; trackId: string; cueId: string; x: number; y: number; w: number; h: number };

export interface TransitionPop {
  clipId: string;
  edge: 'in' | 'out';
  x: number;
  y: number;
}

export interface GapSel {
  trackId: string;
  start: number;
  end: number;
}

export interface VisibleClip {
  id: string;
  name: string;
  trackId: string;
  kind: string;
  selected: boolean;
  /** Client (viewport) coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  start: number;
  end: number;
}

interface TLViewState {
  /** Time at the left edge of the clip area (seconds). */
  t0: number;
  scrollY: number;
  /** Clip area size in CSS px. */
  viewW: number;
  viewH: number;
  /** Open sequence tabs (sequence ids), per project. */
  tabs: Record<string, string[]>;
  menu: MenuState | null;
  inline: InlineEdit | null;
  transitionPop: TransitionPop | null;
  gap: GapSel | null;
  /** Selected transition (Delete removes it). */
  transition: { clipId: string; edge: 'in' | 'out' } | null;
  /** Visible clips (for the hidden accessible list and tests). */
  visible: VisibleClip[];
  /** Height preset last applied. */
  heightPreset: 'S' | 'M' | 'L' | null;
  /** Label color last chosen (menus). */
  lastLabel: LabelColor;

  setT0(t: number): void;
  setScrollY(y: number): void;
  setViewSize(w: number, h: number): void;
  openMenu(m: MenuState | null): void;
  setInline(e: InlineEdit | null): void;
  setTransitionPop(p: TransitionPop | null): void;
  setGap(g: GapSel | null): void;
  setTransition(t: TLViewState['transition']): void;
  setVisible(v: VisibleClip[]): void;
  openTab(projectId: string, seqId: string): void;
  closeTab(projectId: string, seqId: string): void;
  setHeightPreset(p: 'S' | 'M' | 'L' | null): void;
}

function loadTabs(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem('delta.tl.tabs') ?? '{}');
  } catch {
    return {};
  }
}
function saveTabs(tabs: Record<string, string[]>) {
  try {
    localStorage.setItem('delta.tl.tabs', JSON.stringify(tabs));
  } catch {
    /* ignore */
  }
}

export const useTLView = create<TLViewState>((set, get) => ({
  t0: 0,
  scrollY: 0,
  viewW: 800,
  viewH: 240,
  tabs: loadTabs(),
  menu: null,
  inline: null,
  transitionPop: null,
  gap: null,
  transition: null,
  visible: [],
  heightPreset: null,
  lastLabel: 'none',

  setT0: (t) => set({ t0: clampT0(t) }),
  setScrollY: (y) => set({ scrollY: Math.max(0, y) }),
  setViewSize: (viewW, viewH) => {
    if (viewW !== get().viewW || viewH !== get().viewH) set({ viewW, viewH });
  },
  openMenu: (menu) => set({ menu }),
  setInline: (inline) => set({ inline }),
  setTransitionPop: (transitionPop) => set({ transitionPop }),
  setGap: (gap) => set({ gap }),
  setTransition: (transition) => set({ transition }),
  setVisible: (visible) => set({ visible }),
  openTab(projectId, seqId) {
    const tabs = { ...get().tabs };
    const list = tabs[projectId] ?? [];
    if (!list.includes(seqId)) tabs[projectId] = [...list, seqId];
    set({ tabs });
    saveTabs(tabs);
  },
  closeTab(projectId, seqId) {
    const tabs = { ...get().tabs };
    tabs[projectId] = (tabs[projectId] ?? []).filter((id) => id !== seqId);
    set({ tabs });
    saveTabs(tabs);
  },
  setHeightPreset: (heightPreset) => set({ heightPreset }),
}));

/** Upper bound for the left-edge time so the sequence end stays reachable. */
export function maxT0(): number {
  const { project, zoom, playhead } = useEditor.getState();
  const { viewW } = useTLView.getState();
  if (!project) return 0;
  const seq = activeSequence(project);
  const viewSeconds = viewW / zoom;
  const dur = contentDuration(Math.max(sequenceDuration(seq), playhead), viewSeconds);
  return Math.max(0, dur - viewSeconds);
}

export function clampT0(t: number): number {
  return Math.max(0, Math.min(Number.isFinite(t) ? t : 0, maxT0()));
}

/** Zooms keeping `anchorT` at the same screen position. */
export function zoomAround(anchorT: number, nextZoom: number) {
  const ed = useEditor.getState();
  const view = useTLView.getState();
  const prev = ed.zoom;
  ed.setZoom(nextZoom);
  const z = useEditor.getState().zoom;
  const x = (anchorT - view.t0) * prev;
  view.setT0(anchorT - x / z);
}

/** Zoom so the whole sequence fits the view. */
export function zoomToFit() {
  const ed = useEditor.getState();
  if (!ed.project) return;
  const seq = activeSequence(ed.project);
  const { viewW } = useTLView.getState();
  const dur = Math.max(sequenceDuration(seq), 1);
  ed.setZoom((Math.max(200, viewW) - 48) / dur);
  useTLView.getState().setT0(0);
}

/** Scrolls so time t is visible (page-scroll when it leaves the view). */
export function revealTime(t: number, mode: 'page' | 'center' = 'page') {
  const { zoom } = useEditor.getState();
  const view = useTLView.getState();
  const span = view.viewW / zoom;
  if (mode === 'center') {
    view.setT0(t - span / 2);
    return;
  }
  if (t < view.t0 || t > view.t0 + span - 8 / zoom) view.setT0(t < view.t0 ? t - span * 0.1 : t - 12 / zoom);
}

/** Open tabs of the current project, always including the active sequence. */
export function tabsFor(project: Project, tabs: Record<string, string[]>): string[] {
  const ids = new Set(project.sequences.map((s) => s.id));
  const list = (tabs[project.id] ?? []).filter((id) => ids.has(id));
  const active = activeSequence(project)?.id;
  if (active && !list.includes(active)) list.push(active);
  return list;
}
