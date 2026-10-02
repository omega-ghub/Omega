// User preferences that live outside the project (per machine).
// OWNED BY THE SHELL PACKAGE.

import { create } from 'zustand';
import { useEditor } from '../../../state/store';

export type UiScale = 0.9 | 1 | 1.1;

export interface Prefs {
  /** Timeline snapping when a project opens. */
  snapping: boolean;
  /** Magnetic (gap-closing) timeline when a project opens. */
  magnetic: boolean;
  uiScale: UiScale;
  /** Show the getting-started card. */
  onboarding: boolean;
}

const KEY = 'delta.prefs.v1';
const DEFAULTS: Prefs = { snapping: true, magnetic: false, uiScale: 1, onboarding: true };

function load(): Prefs {
  try {
    const p = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as Prefs;
    if (![0.9, 1, 1.1].includes(p.uiScale)) p.uiScale = 1;
    return p;
  } catch {
    return DEFAULTS;
  }
}

interface PrefsState extends Prefs {
  set(patch: Partial<Prefs>): void;
}

export const usePrefs = create<PrefsState>((set, get) => ({
  ...load(),
  set(patch) {
    set(patch);
    const { set: _s, ...rest } = { ...get(), ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(rest));
    } catch {
      /* ignore */
    }
    if (patch.uiScale !== undefined) applyUiScale(patch.uiScale);
  },
}));

/**
 * UI scale is CSS zoom on #root, whose box is shrunk by the same factor so
 * the zoomed result still fills the window exactly.
 */
export function applyUiScale(scale: number) {
  const root = document.getElementById('root');
  if (!root) return;
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  if (scale === 1) {
    root.style.removeProperty('zoom');
    root.style.removeProperty('width');
    root.style.removeProperty('height');
  } else {
    root.style.zoom = String(scale);
    root.style.width = `${100 / scale}vw`;
    root.style.height = `${100 / scale}vh`;
  }
}

/** Applies the per-machine defaults to the editor once a project is open. */
export function applyStartupPrefs() {
  const p = usePrefs.getState();
  const ed = useEditor.getState();
  ed.setSnapping(p.snapping);
  ed.setMagnetic(p.magnetic);
  applyUiScale(p.uiScale);
}
