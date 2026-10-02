// Action registry. Every command in Delta is an Action: the keyboard map,
// the command palette, menus and toolbar buttons all run actions by id, so a
// feature is reachable from everywhere by registering it once.
//
// Packages register their actions at module load:
//   registerActions([{ id: 'timeline.split', label: 'Split at playhead', group: 'Edit', keys: ['Mod+K'], run: () => … }])
//
// Key syntax: 'Mod' = Ctrl on Windows/Linux, Cmd on macOS. Modifiers in the
// order Mod+Alt+Shift+<Key>. Keys use KeyboardEvent.key names, uppercase for
// letters ('K'), and these names: Space, Enter, Escape, Backspace, Delete,
// ArrowLeft/Right/Up/Down, Home, End, PageUp, PageDown, Tab, F1..F12, and the
// literal characters for punctuation (',', '.', ';', "'", '=', '-', '[', ']', '\\', '`', '/').
// Premiere-compatible defaults wherever Premiere has an equivalent.

export interface Action {
  id: string;
  label: string;
  group: string; // 'Playback' | 'Edit' | 'Timeline' | 'Marking' | 'Tools' | 'Clip' | 'Sequence' | 'Color' | 'Audio' | 'Captions' | 'Export' | 'View' | 'Project' | 'Help'
  keys?: string[];
  run: () => void;
  enabled?: () => boolean;
  /** Shown in the palette, e.g. 'Ripple-deletes the selected clips' */
  hint?: string;
}

const actions = new Map<string, Action>();
const listeners = new Set<() => void>();
let overrides: Record<string, string[]> = {};

try {
  overrides = JSON.parse(localStorage.getItem('delta.keymap') ?? '{}');
} catch {
  overrides = {};
}

export function registerActions(list: Action[]): () => void {
  for (const a of list) actions.set(a.id, a);
  notify();
  return () => {
    for (const a of list) if (actions.get(a.id) === a) actions.delete(a.id);
    notify();
  };
}

export function getAction(id: string): Action | undefined {
  return actions.get(id);
}

export function listActions(): Action[] {
  return [...actions.values()];
}

export function runAction(id: string): boolean {
  const a = actions.get(id);
  if (!a || (a.enabled && !a.enabled())) return false;
  a.run();
  return true;
}

/** Effective key bindings (user overrides win). */
export function keysFor(id: string): string[] {
  return overrides[id] ?? actions.get(id)?.keys ?? [];
}

export function setKeys(id: string, keys: string[] | null) {
  if (keys === null) delete overrides[id];
  else overrides[id] = keys;
  try {
    localStorage.setItem('delta.keymap', JSON.stringify(overrides));
  } catch {
    /* ignore */
  }
  notify();
}

export function onActionsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  for (const l of listeners) l();
}

export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

/** Normalizes a KeyboardEvent to the registry's key syntax. */
export function eventToKey(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  // Shift is implied by the character for punctuation, explicit for letters / named keys
  if (e.shiftKey && (key.length > 1 || /[A-Z0-9]/.test(key))) parts.push('Shift');
  // Alt on macOS changes e.key; fall back to the physical key for letters/digits
  if (e.altKey && e.code.startsWith('Key')) key = e.code.slice(3);
  if (e.altKey && e.code.startsWith('Digit')) key = e.code.slice(5);
  parts.push(key);
  return parts.join('+');
}

/** Human-readable form of a binding: 'Mod+Shift+Z' → '⌘⇧Z' / 'Ctrl+Shift+Z'. */
export function displayKey(binding: string): string {
  const map: Record<string, string> = isMac
    ? { Mod: '⌘', Alt: '⌥', Shift: '⇧', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Delete: '⌦', Backspace: '⌫', Enter: '↩', Escape: 'Esc' }
    : { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Delete: 'Del', Backspace: 'Backspace', Enter: 'Enter', Escape: 'Esc' };
  return binding
    .split('+')
    .map((p) => map[p] ?? p)
    .join(isMac ? '' : '+');
}

/** Finds the action bound to a key event (first enabled match). */
export function actionForEvent(e: KeyboardEvent): Action | undefined {
  const key = eventToKey(e);
  for (const a of actions.values()) {
    if (keysFor(a.id).includes(key) && (!a.enabled || a.enabled())) return a;
  }
  return undefined;
}
