import { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import { TitleBar } from '../../ui/TitleBar';
import { VideoWorkspace } from '../../workspaces/video/VideoWorkspace';

// Entry point of the downloadable Omega Video app. The hub opens this in its
// own window with ?project=<path to .omega file>.
export function ModuleApp() {
  const init = useStore((s) => s.init);
  const openProject = useStore((s) => s.openProject);
  const project = useStore((s) => s.project);
  const toast = useStore((s) => s.toast);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      await init();
      const path = new URLSearchParams(location.search).get('project');
      if (!path) throw new Error('No project was specified.');
      await openProject(path);
      if (!useStore.getState().project) throw new Error('That project could not be opened.');
    })().catch((e: Error) => setError(e.message));
  }, [init, openProject]);

  // Autosave: a few seconds after any change, so closing the window never loses work.
  useEffect(() => {
    const id = setInterval(() => {
      const s = useStore.getState();
      if (s.project && s.dirty && !s.playing) void s.saveProject();
    }, 5_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="app">
      <TitleBar />
      <div className="app__body">
        {project ? <VideoWorkspace /> : <div className="soon">{error ? <div className="error">{error}</div> : <div className="muted">Opening project…</div>}</div>}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
