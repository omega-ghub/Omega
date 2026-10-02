// Viewer-local UI state (not part of the document): which monitor has
// keyboard focus, fullscreen, the inline text editor, crop mode, the mask
// being edited, pan, and the checkerboard preference.
import { create } from 'zustand';

export type MonitorFocus = 'program' | 'source';

export interface TextEditState {
  clipId: string;
  /** Created by this click: an empty commit removes it again. */
  isNew: boolean;
  /** coalesceKey of the "Add text" history entry (so an empty commit can undo it). */
  historyKey?: string;
}

interface ViewerUi {
  focus: MonitorFocus;
  fullscreen: boolean;
  checkerboard: boolean;
  cropMode: boolean;
  /** The mask whose handles are shown (per clip). */
  activeMask: { clipId: string; maskId: string } | null;
  textEdit: TextEditState | null;
  pan: { x: number; y: number };
  /** Effective zoom (device px per sequence px) when the viewer is at Fit. */
  fitZoom: number;
  /** Bumped to make the source monitor take keyboard focus (e.g. match frame). */
  setFocus(f: MonitorFocus): void;
  setFullscreen(on: boolean): void;
  setCheckerboard(on: boolean): void;
  setCropMode(on: boolean): void;
  setActiveMask(m: { clipId: string; maskId: string } | null): void;
  setTextEdit(t: TextEditState | null): void;
  setPan(p: { x: number; y: number }): void;
  setFitZoom(z: number): void;
}

function loadChecker(): boolean {
  try {
    return localStorage.getItem('delta.viewer.checkerboard') === '1';
  } catch {
    return false;
  }
}

export const useViewerUi = create<ViewerUi>((set) => ({
  focus: 'program',
  fullscreen: false,
  checkerboard: loadChecker(),
  cropMode: false,
  activeMask: null,
  textEdit: null,
  pan: { x: 0, y: 0 },
  fitZoom: 1,
  setFocus: (focus) => set((s) => (s.focus === focus ? s : { focus })),
  setFullscreen: (fullscreen) => set({ fullscreen }),
  setCheckerboard(checkerboard) {
    set({ checkerboard });
    try {
      localStorage.setItem('delta.viewer.checkerboard', checkerboard ? '1' : '0');
    } catch {
      /* ignore */
    }
  },
  setCropMode: (cropMode) => set({ cropMode }),
  setActiveMask: (activeMask) => set({ activeMask }),
  setTextEdit: (textEdit) => set({ textEdit }),
  setPan: (pan) => set({ pan }),
  setFitZoom: (fitZoom) => set((s) => (Math.abs(s.fitZoom - fitZoom) < 1e-4 ? s : { fitZoom })),
}));

/** Lets other panels (e.g. the inspector's mask list) choose the mask the viewer shows handles for. */
export function selectViewerMask(clipId: string, maskId: string | null): void {
  useViewerUi.getState().setActiveMask(maskId ? { clipId, maskId } : null);
}

let focusTracking = false;

/**
 * Keyboard focus follows the last click: inside the source monitor → source,
 * anywhere else → program (the sequence). I/O, J/K/L, Space and the arrows
 * act on the focused monitor.
 */
export function installFocusTracking(): void {
  if (focusTracking || typeof window === 'undefined') return;
  focusTracking = true;
  window.addEventListener(
    'pointerdown',
    (e) => {
      const el = e.target as Element | null;
      const inSource = !!el?.closest?.('[data-vw-monitor="source"]');
      useViewerUi.getState().setFocus(inSource ? 'source' : 'program');
    },
    true,
  );
}
