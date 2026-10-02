// Public surface of the deliver package: its panels, the quick export modal,
// a queue status hook for the shell's status bar, and (as a side effect of
// importing this module) registration of its actions. OWNED BY THE PACKAGE.

import { createElement } from 'react';
import { useEditor } from '../../../state/store';
import { activeSequence } from '../../../state/types';
import { buildJobs, useRenderQueue } from '../../../engine/export';
import { exportEdl, exportFcpxml, exportOtio } from '../../../engine/interchange';
import { getAction, listActions, registerActions } from '../actions';
import { defaultDestination, useDeliverDraft } from './draft';
import { QUICK_EXPORT_MODAL, QuickExport } from './QuickExport';

export { DeliverPanel } from './DeliverPanel';
export { QUICK_EXPORT_MODAL } from './QuickExport';

/** Mounted by the shell at all times; renders the quick export dialog when it is open. */
export function Modals() {
  const open = useEditor((s) => s.modal?.id === QUICK_EXPORT_MODAL && !!s.project);
  if (!open) return null;
  return createElement(QuickExport, { onClose: () => useEditor.getState().closeModal() });
}

export interface QueueStatus {
  progress: number | null;
  label?: string;
  pending?: number;
}

/** Render-queue status for the shell's status bar. */
export function useQueueStatus(): QueueStatus | null {
  const current = useRenderQueue((s) => (s.currentId ? s.jobs.find((j) => j.id === s.currentId) : undefined));
  const pending = useRenderQueue((s) => s.jobs.filter((j) => j.status === 'queued' || j.status === 'rendering').length);
  if (!current && !pending) return null;
  return { progress: current ? current.progress : null, label: current ? `Rendering ${current.name}` : `${pending} queued`, pending };
}

const toast = (m: string, kind: 'info' | 'success' | 'error' = 'info') => useEditor.getState().showToast(m, kind);

async function addDraftToQueue(): Promise<string[]> {
  const { project, handle, playhead } = useEditor.getState();
  if (!project) return [];
  const store = useDeliverDraft.getState();
  store.attach(project, handle);
  let draft = store.draft;
  if (!draft.destination) draft = { ...draft, destination: defaultDestination(project, handle) };
  if (!draft.destination) {
    toast('Choose a destination folder in Deliver first', 'error');
    return [];
  }
  try {
    const jobs = buildJobs(draft, project, activeSequence(project), { playhead });
    const ids = await useRenderQueue.getState().add(jobs);
    toast(`Added ${ids.length > 1 ? `${ids.length} jobs` : `"${jobs[0].name}"`} to the render queue`, 'success');
    return ids;
  } catch (err) {
    toast((err as Error).message, 'error');
    return [];
  }
}

registerActions([
  {
    id: 'deliver.quickExport',
    label: 'Export…',
    group: 'Export',
    keys: ['Mod+M'],
    hint: 'Render the sequence with a preset, with progress in a dialog',
    enabled: () => !!useEditor.getState().project,
    run: () => useEditor.getState().openModal(QUICK_EXPORT_MODAL),
  },
  {
    id: 'deliver.addToQueue',
    label: 'Add to render queue',
    group: 'Export',
    keys: ['Mod+Alt+M'],
    hint: 'Queue the sequence with the current Deliver settings',
    enabled: () => !!useEditor.getState().project,
    run: () => void addDraftToQueue(),
  },
  {
    id: 'deliver.renderQueue',
    label: 'Render queue',
    group: 'Export',
    hint: 'Render every queued job in order',
    enabled: () => !useRenderQueue.getState().running && useRenderQueue.getState().jobs.some((j) => j.status === 'queued'),
    run: () => void useRenderQueue.getState().start(),
  },
  {
    id: 'deliver.cancel',
    label: 'Cancel render',
    group: 'Export',
    hint: 'Stop the job that is rendering',
    enabled: () => useRenderQueue.getState().running,
    run: () => useRenderQueue.getState().cancelCurrent(),
  },
]);

// Interchange exports belong to the captions/interchange package; offer them
// here only if it registers none (checked once every package has loaded).
setTimeout(() => {
  const theirs = listActions().some((a) => !a.id.startsWith('deliver.') && /edl|otio|fcpxml/i.test(a.id));
  if (theirs || getAction('deliver.handoff.edl')) return;
  const handoff = (kind: 'edl' | 'otio' | 'fcpxml', label: string) => ({
    id: `deliver.handoff.${kind}`,
    label,
    group: 'Export',
    enabled: () => !!useEditor.getState().project,
    run: async () => {
      const { project } = useEditor.getState();
      if (!project) return;
      const seq = activeSequence(project);
      try {
        const text = kind === 'edl' ? exportEdl(project, seq) : kind === 'otio' ? exportOtio(project, seq) : exportFcpxml(project, seq);
        const path = await window.omega.dialogs.pickSavePath(label.replace(/…$/, ''), seq.name.replace(/[<>:"/\\|?*]/g, '-'), kind);
        if (!path) return;
        await window.omega.files.writeText(path, text);
        toast(`Exported ${path.split(/[\\/]/).pop()}`, 'success');
      } catch (err) {
        toast(`Export failed: ${(err as Error).message}`, 'error');
      }
    },
  });
  registerActions([handoff('edl', 'Export EDL…'), handoff('otio', 'Export OpenTimelineIO…'), handoff('fcpxml', 'Export Final Cut Pro XML…')]);
}, 0);
