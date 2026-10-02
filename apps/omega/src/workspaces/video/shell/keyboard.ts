// The one global keyboard handler: maps key events to registered actions.
// OWNED BY THE SHELL PACKAGE.

import { useEffect } from 'react';
import { useEditor } from '../../../state/store';
import { isModalOpen } from '../../../ui/Modal';
import { actionForEvent, eventToKey } from '../actions';

const TEXT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', '']);

/** Fields that consume typing (and their own arrows, Space, Enter…). */
export function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return TEXT_TYPES.has(type) || type === 'range';
  }
  return el.closest('[data-keys="own"]') !== null;
}

/** While typing, only these actions still fire (with their modifier). */
function allowedWhileTyping(id: string, key: string): boolean {
  if (!/^(Mod|Alt)\+/.test(key)) return false;
  return id.startsWith('shell.') || id.startsWith('workspace.') || id === 'help.about';
}

export function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (['Control', 'Shift', 'Alt', 'Meta', 'OS', 'CapsLock'].includes(e.key)) return;
      const ed = useEditor.getState();
      if (!ed.project) return;
      const target = e.target;
      const editable = isEditable(target);

      // Dialogs own the keyboard; only Save still works underneath them.
      if (ed.modal || isModalOpen()) {
        const a = actionForEvent(e);
        if (a?.id === 'shell.save') {
          e.preventDefault();
          a.run();
        }
        return;
      }

      if (editable) {
        if (e.key === 'Escape' && target instanceof HTMLElement) {
          e.preventDefault();
          target.blur();
          return;
        }
        const a = actionForEvent(e);
        if (!a || !allowedWhileTyping(a.id, eventToKey(e))) return;
        e.preventDefault();
        run(a.id, a.run, a.label);
        return;
      }

      const a = actionForEvent(e);
      if (!a) return;
      // Buttons keep focus after a click; Space/Enter must still reach the editor.
      e.preventDefault();
      run(a.id, a.run, a.label);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function run(id: string, fn: () => void, label: string) {
  try {
    fn();
  } catch (err) {
    console.error(`[action ${id}]`, err);
    useEditor.getState().showToast(`${label} failed: ${(err as Error)?.message ?? err}`, 'error');
  }
}
