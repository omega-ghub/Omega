// Media-browser UI state (view, sort, open bin, column widths…). Preferences
// persist per user in localStorage; nothing here goes into the project.
import { create } from 'zustand';
import type { KindFilter, SortDir, SortKey } from './model';

export type ColumnId = 'name' | 'duration' | 'resolution' | 'fps' | 'codec' | 'audio' | 'size' | 'label' | 'rating' | 'notes' | 'inputTransform';

export const COLUMNS: { id: ColumnId; label: string; sort: SortKey; min: number; width: number; align?: 'right' }[] = [
  { id: 'name', label: 'Name', sort: 'name', min: 120, width: 220 },
  { id: 'duration', label: 'Duration', sort: 'duration', min: 70, width: 92, align: 'right' },
  { id: 'resolution', label: 'Resolution', sort: 'resolution', min: 70, width: 92, align: 'right' },
  { id: 'fps', label: 'FPS', sort: 'fps', min: 40, width: 56, align: 'right' },
  { id: 'codec', label: 'Video', sort: 'codec', min: 50, width: 66 },
  { id: 'audio', label: 'Audio', sort: 'audio', min: 70, width: 118 },
  { id: 'size', label: 'Size', sort: 'size', min: 50, width: 72, align: 'right' },
  { id: 'label', label: 'Label', sort: 'label', min: 40, width: 52 },
  { id: 'rating', label: 'Rating', sort: 'rating', min: 70, width: 82 },
  { id: 'notes', label: 'Notes', sort: 'notes', min: 80, width: 180 },
  { id: 'inputTransform', label: 'Input', sort: 'inputTransform', min: 80, width: 118 },
];

interface Prefs {
  view: 'grid' | 'list';
  sortKey: SortKey;
  sortDir: SortDir;
  thumbWidth: number;
  colWidths: Partial<Record<ColumnId, number>>;
  treeOpen: boolean;
  treeWidth: number;
}

export interface MediaUiState extends Prefs {
  openBinId: string | null;
  filter: KindFilter;
  query: string;
  /** Item being renamed inline; `where` picks the field when a bin shows in both the tree and the content. */
  renaming: { kind: 'asset' | 'bin'; id: string; where?: 'tree' | 'content' } | null;
  /** Shift-click anchor. */
  anchorId: string | null;
  /** Bumped to ask the panel to focus its search field. */
  focusSearchTick: number;
  /** Bins expanded in the tree. */
  expanded: Record<string, boolean>;
  /** How many package Modals hosts are mounted (the shell mounts one). */
  modalsMounted: number;
  /** Bin under an in-panel drag ('' = project root), for the drop highlight. */
  dropBin: string | null;
  /** OS files are being dragged over the panel. */
  fileDrag: boolean;
  set(patch: Partial<MediaUiState>): void;
  setPrefs(patch: Partial<Prefs>): void;
}

const KEY = 'delta.media';
const DEFAULT_PREFS: Prefs = { view: 'grid', sortKey: 'name', sortDir: 'asc', thumbWidth: 148, colWidths: {}, treeOpen: true, treeWidth: 156 };

function loadPrefs(): Prefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return { ...DEFAULT_PREFS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export const useMediaUi = create<MediaUiState>((set, get) => ({
  ...loadPrefs(),
  openBinId: null,
  filter: 'all',
  query: '',
  renaming: null,
  anchorId: null,
  focusSearchTick: 0,
  expanded: {},
  modalsMounted: 0,
  dropBin: null,
  fileDrag: false,
  set: (patch) => set(patch),
  setPrefs(patch) {
    set(patch);
    const s = get();
    const prefs: Prefs = { view: s.view, sortKey: s.sortKey, sortDir: s.sortDir, thumbWidth: s.thumbWidth, colWidths: s.colWidths, treeOpen: s.treeOpen, treeWidth: s.treeWidth };
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  },
}));

export function colWidth(id: ColumnId, widths: Partial<Record<ColumnId, number>>): number {
  const c = COLUMNS.find((x) => x.id === id)!;
  return Math.max(c.min, widths[id] ?? c.width);
}
