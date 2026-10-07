// Effects package state and operations: favorites (persisted), the effects
// clipboard (module-level, so effects can be copied between clips), and the
// undoable edits the browser, the stack and the actions share.

import { useSyncExternalStore } from 'react';
import { getEffect, getTransition, instantiateEffect } from '../../../engine/effects/registry';
import { addTransition } from '../../../engine/edit/ops';
import { makeTransition } from '../../../state/defaults';
import { useEditor } from '../../../state/store';
import { activeSequence, findClip, newId } from '../../../state/types';
import type { Clip, Sequence, TransitionType } from '../../../state/types';
import { copyEffects, favKey, moveItem, parseFavKey, pasteEffects, removeEffect, resetEffect, toggleFavorite, type EffectsPayload, type FavKind } from './logic';

// ---------------------------------------------------------------------------
// Tiny external store helper
// ---------------------------------------------------------------------------

function createStore<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      for (const s of subs) s();
    },
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------------------
// Favorites (order matters: it drives "Apply favorite 1…3")
// ---------------------------------------------------------------------------

const FAV_KEY = 'delta.fx.favorites';
const favStore = createStore<string[]>(
  (() => {
    const v = load<unknown>(FAV_KEY, []);
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string' && !!parseFavKey(k)) : [];
  })(),
);

export function getFavorites(): string[] {
  return favStore.get();
}

export function useFavorites(): string[] {
  return useSyncExternalStore(favStore.subscribe, favStore.get, favStore.get);
}

export function isFavorite(kind: FavKind, type: string): boolean {
  return favStore.get().includes(favKey(kind, type));
}

export function toggleFavoriteItem(kind: FavKind, type: string): void {
  const next = toggleFavorite(favStore.get(), favKey(kind, type));
  favStore.set(next);
  save(FAV_KEY, next);
}

// ---------------------------------------------------------------------------
// UI memory (collapsed categories, collapsed cards, active tab)
// ---------------------------------------------------------------------------

const UI_KEY = 'delta.fx.ui';
interface UiState {
  tab: 'effects' | 'transitions';
  collapsed: string[];
}
const uiStore = createStore<UiState>({ tab: 'effects', collapsed: [], ...load<Partial<UiState>>(UI_KEY, {}) });

export function useUi(): UiState {
  return useSyncExternalStore(uiStore.subscribe, uiStore.get, uiStore.get);
}

export function setUi(patch: Partial<UiState>): void {
  const next = { ...uiStore.get(), ...patch };
  uiStore.set(next);
  save(UI_KEY, next);
}

/** Collapsed effect cards in the stack (per effect instance id; session only). */
const cardStore = createStore<ReadonlySet<string>>(new Set());
export function useCollapsedCards(): ReadonlySet<string> {
  return useSyncExternalStore(cardStore.subscribe, cardStore.get, cardStore.get);
}
export function setCardCollapsed(id: string, collapsed: boolean): void {
  const next = new Set(cardStore.get());
  if (collapsed) next.add(id);
  else next.delete(id);
  cardStore.set(next);
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

const clipStore = createStore<EffectsPayload | null>(null);

export function getEffectsClipboard(): EffectsPayload | null {
  return clipStore.get();
}

export function useEffectsClipboard(): EffectsPayload | null {
  return useSyncExternalStore(clipStore.subscribe, clipStore.get, clipStore.get);
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

function seqNow(): Sequence | null {
  const p = useEditor.getState().project;
  return p ? activeSequence(p) : null;
}

function toast(message: string, kind: 'info' | 'success' | 'error' = 'info') {
  useEditor.getState().showToast(message, kind);
}

/** Selected clips on unlocked video tracks. */
export function selectedVideoClips(): Clip[] {
  const seq = seqNow();
  if (!seq) return [];
  const ids = new Set(useEditor.getState().selection.clipIds);
  return seq.tracks.filter((t) => t.kind === 'video' && !t.locked).flatMap((t) => t.clips.filter((c) => ids.has(c.id)));
}

/** Selected clips on unlocked tracks of any kind (for transitions: audio clips get crossfades). */
function selectedEditableClips(): Clip[] {
  const seq = seqNow();
  if (!seq) return [];
  const ids = new Set(useEditor.getState().selection.clipIds);
  return seq.tracks.filter((t) => t.kind !== 'caption' && !t.locked).flatMap((t) => t.clips.filter((c) => ids.has(c.id)));
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

/** Adds an effect to clips (default: the selected video clips). Returns how many clips changed. */
export function applyEffect(type: string, clipIds?: string[], index?: number): number {
  const def = getEffect(type);
  if (!def) return 0;
  const ids = clipIds ?? selectedVideoClips().map((c) => c.id);
  if (!ids.length) {
    toast('Select a video clip to add the effect to');
    return 0;
  }
  let count = 0;
  useEditor.getState().mutateSequence(`Add ${def.name}`, (seq) => {
    for (const id of ids) {
      const hit = findClip(seq, id);
      if (!hit || hit.track.kind !== 'video' || hit.track.locked) continue;
      const fx = instantiateEffect(type);
      const at = index === undefined ? hit.clip.effects.length : Math.max(0, Math.min(index, hit.clip.effects.length));
      hit.clip.effects.splice(at, 0, fx);
      count++;
    }
  });
  if (!count) toast('Effects go on unlocked video clips');
  return count;
}

/** Adds a transition at the head edge of clips (default: the selected clips). */
export function applyTransition(type: string, clipIds?: string[]): number {
  const def = getTransition(type);
  const st = useEditor.getState();
  if (!def || !st.project) return 0;
  const ids = clipIds ?? selectedEditableClips().map((c) => c.id);
  if (!ids.length) {
    toast('Select a clip to add the transition to its start');
    return 0;
  }
  const duration = st.project.settings.defaultTransitionDuration || 1;
  let count = 0;
  let error: string | null = null;
  try {
    st.mutateSequence(`Add ${def.name}`, (seq) => {
      for (const id of ids) {
        const hit = findClip(seq, id);
        if (!hit || hit.track.locked || hit.track.kind === 'caption') continue;
        const ty = (hit.track.kind === 'audio' ? 'audioCrossfade' : type === 'audioCrossfade' ? 'crossDissolve' : type) as TransitionType;
        try {
          // The editing engine snaps the duration to frames and limits it to the available handles.
          if (typeof addTransition === 'function') addTransition(seq, id, 'start', ty, duration);
          else hit.clip.transitionIn = makeTransition(ty, Math.min(duration, hit.clip.duration));
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          continue;
        }
        if (hit.clip.transitionIn) count++;
      }
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  if (error && !count) toast(error, 'error');
  else if (!count) toast('No room for a transition on the selected clips');
  return count;
}

/** Applies a favorite (1-based) to the selection. */
export function applyFavorite(n: number): boolean {
  const key = favStore.get()[n - 1];
  const fav = key ? parseFavKey(key) : null;
  if (!fav) {
    toast(`No favorite ${n} yet. Star an effect in the Effects browser.`);
    return false;
  }
  return (fav.kind === 'effect' ? applyEffect(fav.type) : applyTransition(fav.type)) > 0;
}

function editOneClip(clipId: string, label: string, recipe: (clip: Clip) => void, coalesceKey?: string) {
  useEditor.getState().mutateSequence(
    label,
    (seq) => {
      const hit = findClip(seq, clipId);
      if (hit) recipe(hit.clip);
    },
    coalesceKey ? { coalesceKey } : undefined,
  );
}

export function setEffectEnabled(clipId: string, fxId: string, enabled: boolean): void {
  const clip = findClipNow(clipId);
  const fx = clip?.effects.find((e) => e.id === fxId);
  const name = fx ? (getEffect(fx.type)?.name ?? fx.type) : 'effect';
  editOneClip(clipId, `${enabled ? 'Enable' : 'Disable'} ${name}`, (c) => {
    const e = c.effects.find((x) => x.id === fxId);
    if (e) e.enabled = enabled;
  });
}

export function deleteEffect(clipId: string, fxId: string): void {
  const fx = findClipNow(clipId)?.effects.find((e) => e.id === fxId);
  editOneClip(clipId, `Delete ${fx ? (getEffect(fx.type)?.name ?? fx.type) : 'effect'}`, (c) => removeEffect(c, fxId));
}

export function duplicateEffect(clipId: string, fxId: string): void {
  const clip = findClipNow(clipId);
  const idx = clip?.effects.findIndex((e) => e.id === fxId) ?? -1;
  if (!clip || idx < 0) return;
  const payload = copyEffects(clip, [fxId]);
  editOneClip(clipId, `Duplicate ${getEffect(clip.effects[idx].type)?.name ?? 'effect'}`, (c) => {
    pasteEffects(c, payload, () => newId('fx'), idx + 1);
  });
}

export function resetEffectParams(clipId: string, fxId: string): void {
  const fx = findClipNow(clipId)?.effects.find((e) => e.id === fxId);
  const def = fx ? getEffect(fx.type) : undefined;
  if (!def) return;
  editOneClip(clipId, `Reset ${def.name}`, (c) => resetEffect(c, fxId, def.params));
}

export function moveEffect(clipId: string, from: number, to: number): void {
  const clip = findClipNow(clipId);
  if (!clip || from === to || from < 0 || from >= clip.effects.length) return;
  const name = getEffect(clip.effects[from].type)?.name ?? 'effect';
  editOneClip(clipId, `Move ${name}`, (c) => {
    c.effects = moveItem(c.effects, from, to);
  });
}

/** Copies effects of a clip (all, or the given ids) to the effects clipboard. */
export function copyClipEffects(clipId: string, ids?: string[]): boolean {
  const clip = findClipNow(clipId);
  if (!clip || !clip.effects.length) {
    toast('This clip has no effects to copy');
    return false;
  }
  const payload = copyEffects(clip, ids);
  if (!payload.effects.length) return false;
  clipStore.set(payload);
  toast(`Copied ${plural(payload.effects.length, 'effect')}`);
  return true;
}

/** Pastes the effects clipboard onto clips (default: the selected video clips). */
export function pasteClipEffects(clipIds?: string[], index?: number): number {
  const payload = clipStore.get();
  if (!payload?.effects.length) {
    toast('No effects copied');
    return 0;
  }
  const ids = clipIds ?? selectedVideoClips().map((c) => c.id);
  if (!ids.length) {
    toast('Select a video clip to paste effects onto');
    return 0;
  }
  let count = 0;
  useEditor.getState().mutateSequence(`Paste ${plural(payload.effects.length, 'effect')}`, (seq) => {
    for (const id of ids) {
      const hit = findClip(seq, id);
      if (!hit || hit.track.kind !== 'video' || hit.track.locked) continue;
      pasteEffects(hit.clip, payload, () => newId('fx'), index);
      count++;
    }
  });
  return count;
}

/** Removes every effect (and its keyframes) from clips (default: the selected clips). */
export function removeAllEffects(clipIds?: string[]): number {
  const ids = clipIds ?? selectedVideoClips().map((c) => c.id);
  let count = 0;
  useEditor.getState().mutateSequence('Remove all effects', (seq) => {
    for (const id of ids) {
      const hit = findClip(seq, id);
      if (!hit || hit.track.locked || !hit.clip.effects.length) continue;
      for (const fx of [...hit.clip.effects]) removeEffect(hit.clip, fx.id);
      count++;
    }
  });
  return count;
}

/** Turns all effects of the selected clips off (or back on when all are off). */
export function toggleEffectsBypass(clipIds?: string[]): void {
  const clips = clipIds ? clipIds.map(findClipNow).filter((c): c is Clip => !!c) : selectedVideoClips();
  const all = clips.flatMap((c) => c.effects);
  if (!all.length) return;
  const anyOn = all.some((e) => e.enabled);
  const ids = clips.map((c) => c.id);
  useEditor.getState().mutateSequence(anyOn ? 'Disable effects' : 'Enable effects', (seq) => {
    for (const id of ids) {
      const hit = findClip(seq, id);
      if (hit) for (const e of hit.clip.effects) e.enabled = !anyOn;
    }
  });
}

export function findClipNow(clipId: string): Clip | null {
  const seq = seqNow();
  return seq ? (findClip(seq, clipId)?.clip ?? null) : null;
}
