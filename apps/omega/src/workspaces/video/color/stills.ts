// Stills gallery: reference frames grabbed from the program viewer.
// Session-only (module state, never saved with the project); the selected
// still is the reference shown beside the scopes and used by "Match".
import { useSyncExternalStore } from 'react';

export interface Still {
  id: string;
  width: number;
  height: number;
  /** RGBA8 display-referred pixels, top row first. */
  data: Uint8ClampedArray;
  /** Sequence time of the grab (seconds) and its timecode. */
  time: number;
  timecode: string;
  clipId: string | null;
  clipName: string;
  createdAt: number;
}

const MAX_STILLS = 48;

let stills: readonly Still[] = [];
let referenceId: string | null = null;
let overlay = false;
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version++;
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function addStill(s: Omit<Still, 'id' | 'createdAt'>): Still {
  const still: Still = { ...s, id: `still_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, createdAt: Date.now() };
  stills = [...stills, still].slice(-MAX_STILLS);
  if (referenceId && !stills.some((x) => x.id === referenceId)) referenceId = null;
  emit();
  return still;
}

export function removeStill(id: string) {
  stills = stills.filter((s) => s.id !== id);
  if (referenceId === id) referenceId = null;
  emit();
}

export function clearStills() {
  stills = [];
  referenceId = null;
  emit();
}

export function setReference(id: string | null) {
  referenceId = id && stills.some((s) => s.id === id) ? id : null;
  emit();
}

export function getStills(): readonly Still[] {
  return stills;
}

export function getReference(): Still | null {
  return stills.find((s) => s.id === referenceId) ?? null;
}

export function setReferenceOverlay(on: boolean) {
  overlay = on;
  emit();
}

export function getReferenceOverlay(): boolean {
  return overlay;
}

export function useStills(): readonly Still[] {
  return useSyncExternalStore(subscribe, () => stills);
}

export function useReference(): Still | null {
  useSyncExternalStore(subscribe, () => version);
  return getReference();
}

export function useReferenceOverlay(): boolean {
  return useSyncExternalStore(subscribe, () => overlay);
}
