import { useEffect, useState } from 'react';
import { AppMark } from '../brand/Logos';
import { THEMES } from '../brand/themes';
import { useStore } from '../state/store';
import { I } from './Icons';

export function TitleBar() {
  const appInfo = useStore((s) => s.appInfo);
  const project = useStore((s) => s.project);
  const view = useStore((s) => s.view);
  const dirty = useStore((s) => s.dirty);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void window.omega.window.isMaximized().then(setMaximized);
    return window.omega.window.onMaximizedChange(setMaximized);
  }, []);

  const app = view === 'workspace' && project ? project.app : 'omega';
  const title = view === 'workspace' && project ? `${project.name}${dirty ? ' •' : ''} — ${THEMES[app].name}` : 'Omega';
  const mac = appInfo?.platform === 'darwin';

  return (
    <div className={`titlebar ${mac ? 'titlebar--mac' : ''}`}>
      <div className="titlebar__left">
        <AppMark app={app} size={18} />
        <span className="titlebar__title">{title}</span>
      </div>
      {appInfo?.customTitleBar && !mac && (
        <div className="titlebar__controls">
          <button className="titlebar__btn" onClick={() => window.omega.window.minimize()} aria-label="Minimize">
            <I.Minimize size={14} />
          </button>
          <button className="titlebar__btn" onClick={() => window.omega.window.toggleMaximize()} aria-label="Maximize">
            {maximized ? <I.Restore size={13} /> : <I.Maximize size={13} />}
          </button>
          <button className="titlebar__btn titlebar__btn--close" onClick={() => window.omega.window.close()} aria-label="Close">
            <I.Close size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
