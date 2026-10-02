// Keyframe commands shared by the keyframe lane, the graph editor and the
// registered actions: selection, ease, delete, copy/paste, add, navigate.

import { useEditor } from '../../../state/store';
import type { Ease } from '../../../state/types';
import { KEY_TOLERANCE, paramAt, setKeyframe } from '../../../engine/keyframes';
import { getClip, editClip, localTime } from './model';
import { copyKeys, deleteKeys, pasteKeys, setKeysEase, writeKeysDraft, type Bez, type KeyClipboardEntry } from './keyframeOps';
import { primaryClipId } from './selection';
import { seekKeyframe } from './controls';

export type KeyRef = { clipId: string; path: string; t: number };

let keyClipboard: KeyClipboardEntry[] = [];

export function hasKeyClipboard(): boolean {
  return keyClipboard.length > 0;
}

/** Selected keyframes of a clip. */
export function selectedKeys(clipId: string): KeyRef[] {
  return useEditor.getState().selection.keyframes.filter((k) => k.clipId === clipId);
}

export function setKeySelection(keys: KeyRef[]): void {
  useEditor.getState().select({ keyframes: keys });
}

/** Keys an ease/delete command applies to: the selection, else every key under the playhead. */
export function targetKeys(): { clipId: string; keys: { path: string; t: number }[] } | null {
  const clipId = primaryClipId();
  if (!clipId) return null;
  const sel = selectedKeys(clipId);
  if (sel.length) return { clipId, keys: sel };
  const clip = getClip(clipId);
  if (!clip) return null;
  const local = useEditor.getState().playhead - clip.start;
  const keys: { path: string; t: number }[] = [];
  for (const [path, list] of Object.entries(clip.keyframes)) for (const k of list) if (Math.abs(k.t - local) <= KEY_TOLERANCE) keys.push({ path, t: k.t });
  return keys.length ? { clipId, keys } : null;
}

function byPath(keys: { path: string; t: number }[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const k of keys) m.set(k.path, [...(m.get(k.path) ?? []), k.t]);
  return m;
}

const EASE_LABEL: Record<Ease, string> = { linear: 'Linear', hold: 'Hold', easeIn: 'Ease in', easeOut: 'Ease out', easeInOut: 'Ease in-out', bezier: 'Custom ease' };

export function setEase(ease: Ease, bez?: Bez, target = targetKeys(), opts?: { coalesceKey?: string }): boolean {
  if (!target || !target.keys.length) return false;
  const groups = byPath(target.keys);
  editClip(
    target.clipId,
    `Keyframe interpolation: ${EASE_LABEL[ease]}`,
    (c) => {
      for (const [path, times] of groups) if (c.keyframes[path]) c.keyframes[path] = setKeysEase(c.keyframes[path], times, ease, bez);
    },
    opts,
  );
  return true;
}

export function deleteKeyRefs(clipId: string, keys: { path: string; t: number }[]): void {
  if (!keys.length) return;
  const groups = byPath(keys);
  const playhead = useEditor.getState().playhead;
  editClip(clipId, keys.length === 1 ? 'Delete keyframe' : `Delete ${keys.length} keyframes`, (c) => {
    const local = localTime(c, playhead);
    for (const [path, times] of groups) {
      const list = c.keyframes[path];
      if (list) writeKeysDraft(c, path, deleteKeys(list, times), local);
    }
  });
  setKeySelection([]);
}

export function deleteSelectedKeys(): boolean {
  const clipId = primaryClipId();
  if (!clipId) return false;
  const sel = selectedKeys(clipId);
  if (!sel.length) return false;
  deleteKeyRefs(clipId, sel);
  return true;
}

export function copySelectedKeys(): boolean {
  const clipId = primaryClipId();
  const clip = getClip(clipId);
  if (!clip) return false;
  const entries = copyKeys(clip, selectedKeys(clip.id));
  if (!entries.length) return false;
  keyClipboard = entries;
  useEditor.getState().showToast(entries.length === 1 ? 'Copied 1 keyframe' : `Copied ${entries.length} keyframes`);
  return true;
}

/** Pastes copied keys at the playhead into the selected clip (paths that exist on it). */
export function pasteKeysAtPlayhead(): boolean {
  const clipId = primaryClipId();
  const clip = getClip(clipId);
  if (!clip || !keyClipboard.length) return false;
  const at = localTime(clip, useEditor.getState().playhead);
  const usable = keyClipboard.filter((e) => {
    const parts = e.path.split('.');
    if (parts[0] === 'masks') return clip.masks.some((m) => m.id === parts[1]);
    if (parts[0] === 'effects') return clip.effects.some((x) => x.id === parts[1]);
    if (parts[0] === 'text') return !!clip.text;
    if (parts[0] === 'shape') return !!clip.shape;
    return true;
  });
  if (!usable.length) {
    useEditor.getState().showToast('The copied keyframes belong to parameters this clip does not have', 'error');
    return false;
  }
  const groups = new Map<string, KeyClipboardEntry[]>();
  for (const e of usable) groups.set(e.path, [...(groups.get(e.path) ?? []), e]);
  editClip(clip.id, usable.length === 1 ? 'Paste keyframe' : `Paste ${usable.length} keyframes`, (c) => {
    for (const [path, entries] of groups) c.keyframes[path] = pasteKeys(c.keyframes[path] ?? [], entries, at, c.duration);
  });
  setKeySelection(usable.map((e) => ({ clipId: clip.id, path: e.path, t: Math.min(clip.duration, at + e.dt) })));
  return true;
}

export function selectAllKeys(clipId: string): void {
  const clip = getClip(clipId);
  if (!clip) return;
  setKeySelection(Object.entries(clip.keyframes).flatMap(([path, list]) => list.map((k) => ({ clipId, path, t: k.t }))));
}

/**
 * Adds a keyframe at the playhead on every animated param of the selected
 * clip; when nothing is animated yet, starts animating Position.
 */
export function addKeysAtPlayhead(): boolean {
  const clipId = primaryClipId();
  const clip = getClip(clipId);
  if (!clip) return false;
  const animated = Object.keys(clip.keyframes).filter((p) => clip.keyframes[p].length);
  const paths = animated.length ? animated : ['transform.x', 'transform.y'];
  const playhead = useEditor.getState().playhead;
  editClip(clip.id, animated.length ? 'Add keyframes' : 'Animate Position', (c) => {
    const local = localTime(c, playhead);
    for (const p of paths) setKeyframe(c, p, local, paramAt(c, p, local));
  });
  return true;
}

export function gotoKey(dir: -1 | 1): boolean {
  const clipId = primaryClipId();
  return clipId ? seekKeyframe(clipId, dir) : false;
}
