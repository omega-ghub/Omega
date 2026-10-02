import { useEffect } from 'react';
import { Dashboard } from './dashboard/Dashboard';
import { NewProjectDialog } from './dashboard/NewProjectDialog';
import { useStore } from './state/store';
import { TitleBar } from './ui/TitleBar';
import { ComingSoon } from './workspaces/ComingSoon';
import { VideoWorkspace } from './workspaces/video/VideoWorkspace';

export function App() {
  const init = useStore((s) => s.init);
  const view = useStore((s) => s.view);
  const project = useStore((s) => s.project);
  const newProjectFor = useStore((s) => s.newProjectFor);
  const toast = useStore((s) => s.toast);
  const appInfo = useStore((s) => s.appInfo);

  useEffect(() => {
    void init();
  }, [init]);

  // Autosave every 30 s while a project is dirty (promise #5: never lose work).
  useEffect(() => {
    const id = setInterval(() => {
      const s = useStore.getState();
      if (s.project && s.dirty && !s.playing) void s.saveProject();
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!appInfo) return <div className="boot" />;

  return (
    <div className="app">
      <TitleBar />
      <div className="app__body">
        {view === 'dashboard' || !project ? <Dashboard /> : project.app === 'video' ? <VideoWorkspace /> : <ComingSoon app={project.app} />}
      </div>
      {newProjectFor && <NewProjectDialog app={newProjectFor} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
