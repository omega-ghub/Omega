import { useEffect, useState } from 'react';
import { useEditor } from '../../state/store';
import { VideoWorkspace } from '../../workspaces/video/shell';

// Entry point of the downloadable Delta (video) app. The hub opens this in
// its own window with ?project=<path to .omega file>. OWNED BY CORE.
export function ModuleApp() {
  const init = useEditor((s) => s.init);
  const openProject = useEditor((s) => s.openProject);
  const project = useEditor((s) => s.project);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      await init();
      const path = new URLSearchParams(location.search).get('project');
      if (!path) throw new Error('No project was specified.');
      await openProject(path);
    })().catch((e: Error) => setError(e.message));
  }, [init, openProject]);

  // Autosave a few seconds after any change, so closing the window never loses work.
  useEffect(() => {
    const id = setInterval(() => {
      const s = useEditor.getState();
      if (s.project && s.dirty && !s.playing && !s.saving) void s.saveProject();
    }, 4_000);
    const beforeUnload = () => {
      const s = useEditor.getState();
      if (s.project && s.dirty) void s.saveProject();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      clearInterval(id);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  if (project) return <VideoWorkspace />;
  return (
    <div className="boot-screen">
      {error ? <div className="boot-screen__error">{error}</div> : <div className="boot-screen__spinner" aria-label="Opening project" />}
    </div>
  );
}
