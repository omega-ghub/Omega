// Docked panel chrome: a 32px header (11px uppercase title or tabs) above the
// package's panel, plus an error boundary so one failing panel never takes
// the editor down. OWNED BY THE SHELL PACKAGE.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { I } from '../../../ui/Icons';
import { useShell, type PanelId } from './state';

export interface PanelTab {
  id: PanelId;
  label: string;
}

export function Panel({
  id,
  title,
  subtitle,
  tabs,
  activeTab,
  onTab,
  actions,
  children,
  className = '',
  flushHead = false,
  chromeless = false,
}: {
  id: PanelId;
  title?: string;
  subtitle?: ReactNode;
  tabs?: PanelTab[];
  activeTab?: PanelId;
  onTab?: (id: PanelId) => void;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Header without the bottom hairline (panels that draw their own toolbar). */
  flushHead?: boolean;
  /** No shell header: the package's panel draws its own title row. */
  /** 'auto': hide the shell header when the package panel starts with its own header row. */
  chromeless?: boolean | 'auto';
}) {
  const focused = useShell((s) => s.focusedPanel === id);
  const maximized = useShell((s) => s.maximized === id);
  const setFocused = useShell((s) => s.setFocusedPanel);
  const setHovered = useShell((s) => s.setHoveredPanel);
  const setMaximized = useShell((s) => s.setMaximized);

  return (
    <section
      className={`panel sh-panel ${focused ? 'is-focused' : ''} ${maximized ? 'is-maximized' : ''} ${className}`}
      data-panel={id}
      data-autohead={chromeless === 'auto' ? '' : undefined}
      data-testid={`sh-panel-${id}`}
      onPointerDownCapture={() => setFocused(id)}
      onFocusCapture={() => setFocused(id)}
      onPointerEnter={() => setHovered(id)}
      onPointerLeave={() => setHovered(null)}
    >
      {chromeless !== true && (
        <header
          className={`panel__head sh-panel__head ${flushHead ? 'sh-panel__head--flush' : ''}`}
          onDoubleClick={(e) => e.target === e.currentTarget && setMaximized(maximized ? null : id)}
        >
          {tabs && tabs.length > 1 ? (
            <div className="tabs" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={t.id === activeTab}
                  className={`tab ${t.id === activeTab ? 'is-active' : ''}`}
                  data-testid={`sh-tab-${t.id}`}
                  onClick={() => onTab?.(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : (
            <span className="panel__title">{tabs?.[0]?.label ?? title}</span>
          )}
          {subtitle && <span className="panel__subtitle sh-panel__subtitle">{subtitle}</span>}
          <div className="panel__actions">
            {actions}
            <button
              className="icon-btn icon-btn--xs sh-panel__max"
              data-tip={maximized ? 'Restore layout' : 'Maximize panel'}
              data-tip-action="view.maximizePanel"
              data-testid={`sh-maximize-${id}`}
              aria-label={maximized ? 'Restore layout' : 'Maximize panel'}
              onClick={() => setMaximized(maximized ? null : id)}
            >
              {maximized ? <I.Collapse size={13} /> : <I.Expand size={13} />}
            </button>
          </div>
        </header>
      )}
      <div className="panel__body sh-panel__body">
        <PanelBoundary name={title ?? tabs?.find((t) => t.id === activeTab)?.label ?? id}>{children}</PanelBoundary>
      </div>
    </section>
  );
}

interface BoundaryState {
  error: Error | null;
}

export class PanelBoundary extends Component<{ name: string; children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[panel ${this.props.name}]`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="sh-panel-error" role="alert">
        <I.Warning size={18} />
        <div className="sh-panel-error__title">{this.props.name} stopped working</div>
        <div className="sh-panel-error__msg">{this.state.error.message}</div>
        <button className="btn btn--sm" onClick={() => this.setState({ error: null })}>
          Reload panel
        </button>
      </div>
    );
  }
}
