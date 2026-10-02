import { useEffect, useState } from 'react';
import type { AppKind } from '../brand/themes';
import { AppMark } from '../brand/Logos';
import { I } from './Icons';

/** Frameless-window title bar shared by the hub and every app. */
export function TitleBar({ app = 'omega', title, platform, children }: { app?: AppKind; title: string; platform?: string; children?: React.ReactNode }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void window.omega.window.isMaximized().then(setMaximized);
    return window.omega.window.onMaximizedChange(setMaximized);
  }, []);

  const mac = platform === 'darwin';
  return (
    <div className={`titlebar ${mac ? 'titlebar--mac' : ''}`} onDoubleClick={(e) => e.target === e.currentTarget && window.omega.window.toggleMaximize()}>
      <div className="titlebar__left">
        <AppMark app={app} size={16} />
        <span className="titlebar__title">{title}</span>
      </div>
      <div className="titlebar__center">{children}</div>
      {!mac && (
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
