import { useEffect } from 'react';
import { Dashboard } from './dashboard/Dashboard';
import { NewProjectDialog } from './dashboard/NewProjectDialog';
import { useHub } from './state/hubStore';
import { TitleBar } from './ui/TitleBar';

// The hub: dashboard, project list and app manager. Workspaces are separate
// downloadable apps that open in their own windows (see electron/modules.ts).
export function App() {
  const init = useHub((s) => s.init);
  const newProjectFor = useHub((s) => s.newProjectFor);
  const toast = useHub((s) => s.toast);
  const appInfo = useHub((s) => s.appInfo);

  useEffect(() => {
    void init();
    const offRecents = window.omega.projects.onChanged(() => void useHub.getState().refreshRecents());
    const offProgress = window.omega.modules.onProgress((id, f) => useHub.setState((s) => ({ progress: { ...s.progress, [id]: f } })));
    return () => {
      offRecents();
      offProgress();
    };
  }, [init]);

  if (!appInfo) return <div className="boot" />;

  return (
    <div className="app">
      <TitleBar title="Omega" platform={appInfo.platform} />
      <div className="app__body">
        <Dashboard />
      </div>
      {newProjectFor && <NewProjectDialog app={newProjectFor} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
