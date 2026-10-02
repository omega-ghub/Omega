import { useEffect, useState, type ReactNode } from 'react';
import { AppMark, AppTitle } from '../brand/Logos';
import type { AppKind } from '../brand/themes';
import { I } from './Icons';

/**
 * Frameless-window title bar shared by the hub and every app. OWNED BY THE
 * SHELL PACKAGE.
 *
 * Left: the app's corner mark (the Omega cutout in the hub, the rune tile in
 * apps) with the category label above the app name, then `title` (e.g. the
 * project name) and `left` (e.g. the save state). Center: `children`
 * (e.g. the workspace switcher). Right: `right`, then the window controls.
 */
export function TitleBar({
  app = 'omega',
  title,
  platform,
  children,
  left,
  right,
  bordered = false,
}: {
  app?: AppKind;
  title: string;
  platform?: string;
  children?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  bordered?: boolean;
}) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void window.omega.window.isMaximized().then(setMaximized);
    return window.omega.window.onMaximizedChange(setMaximized);
  }, []);

  const mac = platform === 'darwin';
  const hub = app === 'omega';
  return (
    <div
      className={`titlebar ${mac ? 'titlebar--mac' : ''} ${bordered ? 'titlebar--bordered' : ''}`}
      data-testid="titlebar"
      onDoubleClick={(e) => {
        if ((e.target as Element).closest('button, input, select, a, [role="switch"], [role="tab"]')) return;
        window.omega.window.toggleMaximize();
      }}
    >
      <div className="titlebar__left">
        <div className="titlebar__brand">
          <AppMark app={app} size={hub ? 18 : 20} />
          {!hub && <AppTitle app={app} size="sm" />}
        </div>
        {!hub && title && <span className="titlebar__sep" />}
        {title && (
          <span className="titlebar__title" title={title} data-testid="titlebar-title">
            {title}
          </span>
        )}
        {left}
      </div>
      <div className="titlebar__center">{children}</div>
      <div className="titlebar__right">
        {right}
        {!mac && (
          <div className="titlebar__controls">
            <button className="titlebar__btn" onClick={() => window.omega.window.minimize()} aria-label="Minimize">
              <I.Minimize size={15} strokeWidth={1.2} />
            </button>
            <button className="titlebar__btn" onClick={() => window.omega.window.toggleMaximize()} aria-label={maximized ? 'Restore' : 'Maximize'}>
              {maximized ? <I.Restore size={15} strokeWidth={1.2} /> : <I.Maximize size={14} strokeWidth={1.2} />}
            </button>
            <button className="titlebar__btn titlebar__btn--close" onClick={() => window.omega.window.close()} aria-label="Close">
              <I.Close size={15} strokeWidth={1.2} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
