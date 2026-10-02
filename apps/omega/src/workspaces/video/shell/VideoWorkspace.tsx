// Delta's editor window: title bar, workspace layout, status bar, every
// package's dialogs, toasts, the global file drop and keyboard map.
// OWNED BY THE SHELL PACKAGE.

import { useEffect } from 'react';
import { useEditor } from '../../../state/store';
import { TitleBar } from '../../../ui/TitleBar';
import { TooltipLayer } from '../../../ui/Tooltip';
import { SaveState, StatusBar, TitleActions, WorkspaceSwitcher } from './Chrome';
import { CommandPalette } from './CommandPalette';
import { useGlobalKeys } from './keyboard';
import { WorkspaceLayout } from './Layout';
import { FileDropTarget, Onboarding, ToastHost } from './Overlays';
import { PACKAGE_MODALS } from './packages';
import { applyStartupPrefs } from './prefs';
import { Preferences } from './Preferences';
import { PanelBoundary } from './Panel';
import { ShortcutsEditor } from './ShortcutsEditor';
import './shell.css';

export function VideoWorkspace() {
  const name = useEditor((s) => s.project?.name ?? 'Untitled');
  const platform = useEditor((s) => s.appInfo?.platform);
  const ws = useEditor((s) => s.workspace);

  useGlobalKeys();

  useEffect(() => {
    applyStartupPrefs();
  }, []);

  useEffect(() => {
    document.title = `${name} · Delta`;
  }, [name]);

  return (
    <div className="ws sh-root" data-workspace={ws} data-testid="sh-root">
      <TitleBar app="video" title={name} platform={platform} left={<SaveState />} right={<TitleActions />}>
        <WorkspaceSwitcher />
      </TitleBar>
      <WorkspaceLayout />
      <StatusBar />
      <ShellModals />
      {PACKAGE_MODALS.map(({ name: pkg, Modals }) => (
        <PanelBoundary key={pkg} name={`${pkg} dialogs`}>
          <Modals />
        </PanelBoundary>
      ))}
      <Onboarding />
      <FileDropTarget />
      <ToastHost />
      <TooltipLayer />
    </div>
  );
}

function ShellModals() {
  const modal = useEditor((s) => s.modal);
  const close = useEditor((s) => s.closeModal);
  if (!modal) return null;
  switch (modal.id) {
    case 'shell.palette':
      return <CommandPalette onClose={close} />;
    case 'shell.shortcuts':
      return <ShortcutsEditor onClose={close} initialView={modal.props?.view === 'sheet' ? 'sheet' : 'edit'} />;
    case 'shell.preferences':
      return <Preferences onClose={close} initial={typeof modal.props?.section === 'string' ? modal.props.section : undefined} />;
    default:
      return null;
  }
}
