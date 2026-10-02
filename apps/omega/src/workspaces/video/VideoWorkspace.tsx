import { AppMark } from '../../brand/Logos';
import { useStore } from '../../state/store';
import { I } from '../../ui/Icons';
import { ExportDialog } from './ExportDialog';
import { Inspector } from './Inspector';
import { MediaBin } from './MediaBin';
import { Monitor } from './Monitor';
import { Timeline } from './Timeline';
import { useShortcuts } from './useShortcuts';

const TABS = ['Edit', 'Color', 'Audio', 'Captions'];

export function VideoWorkspace() {
  const project = useStore((s) => s.project)!;
  const dirty = useStore((s) => s.dirty);
  const exportOpen = useStore((s) => s.exportOpen);
  const setExportOpen = useStore((s) => s.setExportOpen);
  const saveProject = useStore((s) => s.saveProject);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const canRedo = useStore((s) => s.redoStack.length > 0);
  const showToast = useStore((s) => s.showToast);

  useShortcuts(!exportOpen);

  return (
    <div className="ws">
      <header className="ws__header">
        <div className="ws__left">
          <button className="icon-btn" title="Save and close (back to Omega)" onClick={async () => { await saveProject(); window.omega.window.close(); }}>
            <I.Home />
          </button>
          <AppMark app="video" size={22} />
          <div className="ws__project">
            <span className="ws__name">{project.name}</span>
            <span className="ws__meta">
              {project.settings.width}×{project.settings.height} · {project.settings.fps} fps {dirty ? '· unsaved' : ''}
            </span>
          </div>
        </div>
        <nav className="ws__tabs">
          {TABS.map((t, i) => (
            <button key={t} className={`ws__tab ${i === 0 ? 'is-active' : ''}`} onClick={() => i !== 0 && showToast(`${t} is coming in a later preview.`)}>
              {t}
            </button>
          ))}
        </nav>
        <div className="ws__right">
          <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
            <I.Undo />
          </button>
          <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
            <I.Redo />
          </button>
          <button className="btn btn--ghost" onClick={() => saveProject()} title="Save (Ctrl+S)">
            <I.Save size={16} /> Save
          </button>
          <button className="btn btn--accent" onClick={() => setExportOpen(true)} title="Export (Ctrl+M)">
            <I.Export size={16} /> Export
          </button>
        </div>
      </header>
      <div className="ws__panels">
        <MediaBin />
        <Monitor />
        <Inspector />
      </div>
      <Timeline />
      {exportOpen && <ExportDialog />}
    </div>
  );
}
