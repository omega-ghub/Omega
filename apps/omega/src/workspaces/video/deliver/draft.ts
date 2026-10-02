// Deliver UI state: the settings being edited (a draft built from a preset),
// custom presets, and remembered choices (last preset, name template, and the
// destination per project). OWNED BY THE DELIVER PACKAGE.

import { create } from 'zustand';
import { useEditor } from '../../../state/store';
import type { Project, ProjectHandle, Sequence } from '../../../state/types';
import { newId } from '../../../state/types';
import {
  BUILTIN_PRESETS,
  DEFAULT_NAME_TEMPLATE,
  DEFAULT_PRESET_ID,
  MAIN_FORMAT,
  draftFromPreset,
  findPreset,
  joinPath,
  sameAspect,
  type ExportDraft,
  type ExportPreset,
  type ExportSettings,
} from '../../../engine/export';

const K_LAST = 'delta.deliver.last';
const K_TEMPLATE = 'delta.deliver.nameTemplate';
const K_CUSTOM = 'delta.deliver.customPresets';
const K_DEST = (projectId: string) => `delta.deliver.dest.${projectId}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function loadCustomPresets(): ExportPreset[] {
  const list = read<ExportPreset[]>(K_CUSTOM, []);
  return Array.isArray(list) ? list.filter((p) => p && p.id && p.settings).map((p) => ({ ...p, group: 'Custom' as const, custom: true })) : [];
}

export function allPresets(custom: ExportPreset[]): ExportPreset[] {
  return [...BUILTIN_PRESETS, ...custom];
}

/** Default destination: remembered for the project, else "<project folder>/Exports". */
export function defaultDestination(project: Project | null, handle: ProjectHandle | null): string {
  if (project) {
    const saved = read<string | null>(K_DEST(project.id), null);
    if (saved) return saved;
  }
  return handle?.dir ? joinPath(handle.dir, 'Exports') : '';
}

export function rememberDestination(projectId: string | undefined, dest: string) {
  if (projectId && dest) write(K_DEST(projectId), dest);
}

/** Formats to render by default: a sequence format matching a fixed-size preset's aspect beats letterboxing the main one. */
export function defaultFormats(preset: ExportPreset, seq: Sequence | null): string[] {
  const r = preset.settings.video.resolution;
  if (!seq || r.mode !== 'fixed' || preset.settings.kind === 'audio' || preset.settings.kind === 'handoff') return [MAIN_FORMAT];
  if (sameAspect(seq.width, seq.height, r.width, r.height)) return [MAIN_FORMAT];
  const match = seq.formats.find((f) => sameAspect(f.width, f.height, r.width, r.height));
  return match ? [match.id] : [MAIN_FORMAT];
}

interface DraftState {
  draft: ExportDraft;
  /** Settings were edited since the preset was picked. */
  modified: boolean;
  customPresets: ExportPreset[];
  projectId: string | null;
  /** Bind to the open project (sets its destination). */
  attach(project: Project | null, handle: ProjectHandle | null): void;
  choosePreset(id: string): void;
  update(patch: Partial<Omit<ExportDraft, 'settings'>>): void;
  updateSettings(fn: (s: ExportSettings) => void): void;
  resetToPreset(): void;
  saveCustom(name: string): ExportPreset;
  deleteCustom(id: string): void;
}

function activeSeq(): Sequence | null {
  const p = useEditor.getState().project;
  return p ? (p.sequences.find((s) => s.id === p.activeSequenceId) ?? p.sequences[0] ?? null) : null;
}

function initialDraft(custom: ExportPreset[]): ExportDraft {
  const last = read<{ presetId?: string; settings?: ExportSettings; formats?: string[] } | null>(K_LAST, null);
  const preset = findPreset(last?.presetId ?? DEFAULT_PRESET_ID, custom) ?? findPreset(DEFAULT_PRESET_ID)!;
  const d = draftFromPreset(preset, { nameTemplate: read(K_TEMPLATE, DEFAULT_NAME_TEMPLATE) });
  if (last?.settings && last.presetId === preset.id) d.settings = last.settings;
  return d;
}

function persistLast(d: ExportDraft) {
  write(K_LAST, { presetId: d.presetId, settings: d.settings });
  write(K_TEMPLATE, d.nameTemplate);
}

const initialCustom = typeof localStorage !== 'undefined' ? loadCustomPresets() : [];

export const useDeliverDraft = create<DraftState>((set, get) => ({
  draft: initialDraft(initialCustom),
  modified: false,
  customPresets: initialCustom,
  projectId: null,

  attach(project, handle) {
    if (!project || get().projectId === project.id) return;
    const destination = defaultDestination(project, handle);
    set((s) => ({ projectId: project.id, draft: { ...s.draft, destination, formats: [MAIN_FORMAT] } }));
  },

  choosePreset(id) {
    const preset = findPreset(id, get().customPresets);
    if (!preset) return;
    const cur = get().draft;
    const range = preset.settings.kind === 'still' ? { mode: 'frame' as const, time: useEditor.getState().playhead } : cur.range.mode === 'frame' ? { mode: 'entire' as const } : cur.range;
    const d = draftFromPreset(preset, { nameTemplate: cur.nameTemplate, destination: cur.destination, range, formats: defaultFormats(preset, activeSeq()) });
    set({ draft: d, modified: false });
    persistLast(d);
  },

  update(patch) {
    const d = { ...get().draft, ...patch };
    set({ draft: d });
    if (patch.destination !== undefined) rememberDestination(get().projectId ?? undefined, patch.destination);
    persistLast(d);
  },

  updateSettings(fn) {
    const settings = JSON.parse(JSON.stringify(get().draft.settings)) as ExportSettings;
    fn(settings);
    const d = { ...get().draft, settings };
    set({ draft: d, modified: true });
    persistLast(d);
  },

  resetToPreset() {
    get().choosePreset(get().draft.presetId);
  },

  saveCustom(name) {
    const { draft, customPresets } = get();
    const base = findPreset(draft.presetId, customPresets);
    const preset: ExportPreset = {
      id: newId('preset'),
      name: name.trim() || `${draft.presetName} (custom)`,
      group: 'Custom',
      hint: base ? `Based on ${base.custom ? base.hint.replace(/^Based on /, '') : base.name}` : 'Custom preset',
      settings: JSON.parse(JSON.stringify(draft.settings)) as ExportSettings,
      ...(draft.limits ? { limits: draft.limits } : {}),
      ...(draft.expectsCodec ? { expectsCodec: draft.expectsCodec } : {}),
      custom: true,
    };
    const list = [...customPresets, preset];
    write(K_CUSTOM, list);
    set({ customPresets: list, draft: { ...draft, presetId: preset.id, presetName: preset.name }, modified: false });
    persistLast(get().draft);
    return preset;
  },

  deleteCustom(id) {
    const list = get().customPresets.filter((p) => p.id !== id);
    write(K_CUSTOM, list);
    set({ customPresets: list });
    if (get().draft.presetId === id) get().choosePreset(DEFAULT_PRESET_ID);
  },
}));
