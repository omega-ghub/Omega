// Actions owned by the shell: palette, save, undo/redo, workspaces, panels,
// preferences, shortcuts, history, close. Registered on import (index.ts).
// OWNED BY THE SHELL PACKAGE.

import { useEditor, type Workspace } from '../../../state/store';
import { registerActions, type Action } from '../actions';
import { usePrefs } from './prefs';
import { useShell, type PanelId, type Region } from './state';

export const WORKSPACES: { id: Workspace; label: string }[] = [
  { id: 'edit', label: 'Edit' },
  { id: 'color', label: 'Color' },
  { id: 'audio', label: 'Audio' },
  { id: 'effects', label: 'Effects' },
  { id: 'captions', label: 'Captions' },
  { id: 'deliver', label: 'Deliver' },
];

const ed = () => useEditor.getState();

export function toggleModal(id: string, props?: Record<string, unknown>) {
  const s = ed();
  if (s.modal?.id === id) s.closeModal();
  else s.openModal(id, props);
}

export async function closeProject() {
  const s = ed();
  if (s.project && s.dirty && !s.readOnly) {
    await s.saveProject({ backup: true });
    const after = ed();
    if (after.dirty && after.saving === false && after.project === s.project) {
      after.showToast('Delta could not save the project, so the window stays open.', 'error');
      return;
    }
  }
  window.omega.window.close();
}

function toggleRegion(region: Region) {
  const ws = ed().workspace;
  useShell.getState().toggleRegion(ws, region);
}

function maximizePanel() {
  const sh = useShell.getState();
  if (sh.maximized) return sh.setMaximized(null);
  const target: PanelId | null = sh.hoveredPanel ?? sh.focusedPanel ?? 'program';
  sh.setMaximized(target);
}

const undoAction: Action = {
  id: 'edit.undo',
  get label() {
    const past = ed().past;
    return past.length ? `Undo ${past[past.length - 1].label}` : 'Undo';
  },
  group: 'Edit',
  keys: ['Mod+Z'],
  enabled: () => ed().past.length > 0 && !ed().readOnly,
  run: () => ed().undo(),
};

const redoAction: Action = {
  id: 'edit.redo',
  get label() {
    const future = ed().future;
    return future.length ? `Redo ${future[0].label}` : 'Redo';
  },
  group: 'Edit',
  keys: ['Mod+Shift+Z', 'Mod+Y'],
  enabled: () => ed().future.length > 0 && !ed().readOnly,
  run: () => ed().redo(),
};

registerActions([
  {
    id: 'shell.palette',
    label: 'Command palette',
    group: 'View',
    keys: ['Mod+Shift+P', 'Mod+P'],
    hint: 'Search every command, sequence and clip',
    run: () => toggleModal('shell.palette'),
  },
  {
    id: 'shell.save',
    label: 'Save project',
    group: 'Project',
    keys: ['Mod+S'],
    hint: 'Saves now and writes a backup to .backups',
    enabled: () => !!ed().project && !ed().readOnly,
    run: () => {
      void ed()
        .saveProject({ backup: true })
        .then(() => {
          const s = ed();
          if (!s.dirty) s.showToast('Project saved', 'success');
        });
    },
  },
  undoAction,
  redoAction,
  ...WORKSPACES.map(
    (w, i): Action => ({
      id: `workspace.${w.id}`,
      label: `${w.label} workspace`,
      group: 'View',
      keys: [`Alt+${i + 1}`],
      run: () => {
        useShell.getState().setMaximized(null);
        ed().setWorkspace(w.id);
      },
    }),
  ),
  {
    id: 'shell.shortcuts',
    label: 'Keyboard shortcuts…',
    group: 'Help',
    keys: ['Mod+Alt+K'],
    hint: 'Rebind keys, apply Final Cut or Resolve presets, print a cheat sheet',
    run: () => toggleModal('shell.shortcuts'),
  },
  {
    id: 'shell.cheatSheet',
    label: 'Keyboard cheat sheet',
    group: 'Help',
    run: () => ed().openModal('shell.shortcuts', { view: 'sheet' }),
  },
  {
    id: 'shell.preferences',
    label: 'Preferences…',
    group: 'Project',
    keys: ['Mod+,'],
    run: () => toggleModal('shell.preferences'),
  },
  {
    id: 'shell.history',
    label: 'Show history',
    group: 'View',
    hint: 'Every change, with jump-back',
    run: () => {
      const sh = useShell.getState();
      ed().setWorkspace('edit');
      if (sh.hidden['edit.left']) sh.toggleRegion('edit', 'left');
      sh.setMaximized(null);
      sh.setTab('edit.left', 'history');
    },
  },
  {
    id: 'shell.closeProject',
    label: 'Close project',
    group: 'Project',
    keys: ['Mod+W'],
    hint: 'Saves, then closes this window',
    run: () => void closeProject(),
  },
  {
    id: 'help.about',
    label: 'About Delta',
    group: 'Help',
    run: () => ed().openModal('shell.preferences', { section: 'about' }),
  },
  {
    id: 'help.gettingStarted',
    label: 'Show getting-started tips',
    group: 'Help',
    run: () => usePrefs.getState().set({ onboarding: true }),
  },
  {
    id: 'view.togglePanelLeft',
    label: 'Show / hide left panel',
    group: 'View',
    run: () => toggleRegion('left'),
  },
  {
    id: 'view.togglePanelRight',
    label: 'Show / hide right panel',
    group: 'View',
    enabled: () => ed().workspace !== 'deliver',
    run: () => toggleRegion('right'),
  },
  {
    id: 'view.togglePanelTimeline',
    label: 'Show / hide timeline',
    group: 'View',
    run: () => toggleRegion('timeline'),
  },
  {
    id: 'view.maximizePanel',
    label: 'Maximize panel under pointer',
    group: 'View',
    hint: 'Run again to restore the layout (or double-click a panel header)',
    run: maximizePanel,
  },
  {
    id: 'view.resetLayout',
    label: 'Reset workspace layout',
    group: 'View',
    run: () => {
      const ws = ed().workspace;
      const sh = useShell.getState();
      for (const k of ['left', 'right', 'split', 'timeline'] as const) sh.resetSize(ws, k);
      for (const r of ['left', 'right', 'timeline'] as const) if (sh.hidden[`${ws}.${r}`]) sh.toggleRegion(ws, r);
      sh.setMaximized(null);
    },
  },
]);
