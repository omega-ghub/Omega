// The Omega hub dashboard. OWNED BY THE SHELL PACKAGE.
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { AppMark, AppTitle, OmegaMark } from '../brand/Logos';
import { THEMES, WORKSPACE_ORDER, type AppKind } from '../brand/themes';
import { useHub, type DashboardTab } from '../state/hubStore';
import { I } from '../ui/Icons';
import { Keys } from '../ui/controls';
import { formatBytes, timeAgo } from '../ui/format';
import { SHORTCUTS } from '../workspaces/video/shortcuts';

const NAV: { id: DashboardTab; label: string; icon: (p: { size?: number }) => ReactElement }[] = [
  { id: 'home', label: 'Home', icon: I.NavHome },
  { id: 'apps', label: 'Apps', icon: I.NavApps },
  { id: 'projects', label: 'Projects', icon: I.NavProjects },
  { id: 'learn', label: 'Learn', icon: I.NavLearn },
  { id: 'plans', label: 'Plans', icon: I.NavPlans },
  { id: 'settings', label: 'Settings', icon: I.NavSettings },
];

const SIDEBAR_KEY = 'omega.sidebar.expanded';

function useSidebar(): [boolean, () => void] {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, expanded ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [expanded]);
  return [expanded, () => setExpanded((v) => !v)];
}

const accentVars = (app: AppKind) => {
  const t = THEMES[app];
  return { ['--accent' as string]: t.accent, ['--accent-deep' as string]: t.accentDeep, ['--accent-soft' as string]: t.accentSoft };
};

export function Dashboard() {
  const tab = useHub((s) => s.dashboardTab);
  const setTab = useHub((s) => s.setDashboardTab);
  const [expanded, toggle] = useSidebar();

  return (
    <div className={`dash ${expanded ? 'is-expanded' : ''}`}>
      <aside className="dash__side" data-testid="hub-sidebar" aria-label="Omega">
        <div className="dash__brand" data-tip={expanded ? undefined : 'Omega'} data-tip-side="right">
          <OmegaMark size={24} />
          <span className="dash__fade">
            <AppTitle app="omega" size="sm" describe />
          </span>
        </div>
        <nav className="dash__nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`dash__nav-item ${tab === n.id ? 'is-active' : ''}`}
              onClick={() => setTab(n.id)}
              aria-label={n.label}
              aria-current={tab === n.id ? 'page' : undefined}
              data-tip={expanded ? undefined : n.label}
              data-tip-side="right"
              data-testid={`hub-nav-${n.id}`}
            >
              <n.icon size={18} />
              <span className="dash__fade dash__nav-label">{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="dash__foot">
          <button
            className={`dash__plan ${expanded ? '' : 'is-compact'}`}
            onClick={() => setTab('plans')}
            data-tip={expanded ? undefined : 'Free plan · See plans'}
            data-tip-side="right"
            aria-label="Free plan. See plans"
            data-testid="hub-plan"
          >
            <span className="dash__plan-badge">Free</span>
            <span className="dash__fade dash__plan-text">
              <span className="dash__plan-name">Free plan</span>
              <span className="dash__plan-hint">Every app, no watermark up to 1080p</span>
            </span>
          </button>
          <button
            className="dash__nav-item dash__toggle"
            onClick={toggle}
            aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-expanded={expanded}
            data-tip={expanded ? undefined : 'Expand sidebar'}
            data-tip-side="right"
            data-testid="hub-sidebar-toggle"
          >
            <I.SidebarToggle size={18} style={{ transform: expanded ? 'scaleX(-1)' : undefined }} />
            <span className="dash__fade dash__nav-label">Collapse</span>
          </button>
        </div>
      </aside>
      <main className="dash__main">
        {tab === 'home' && <HomeTab />}
        {tab === 'apps' && <AppsTab />}
        {tab === 'projects' && <ProjectsTab />}
        {tab === 'learn' && <LearnTab />}
        {tab === 'plans' && <PlansTab />}
        {tab === 'settings' && <SettingsTab />}
      </main>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function HomeTab() {
  const recents = useHub((s) => s.recents);
  const startApp = useHub((s) => s.startApp);
  const openProject = useHub((s) => s.launchProject);
  const deltaInstalled = useHub((s) => !!s.installed.video);
  const delta = THEMES.video;

  return (
    <div className="page">
      <section className="hero">
        <div className="hero__text">
          <div className="hero__eyebrow">{greeting()}</div>
          <h1 className="hero__title">What are you making today?</h1>
          <p className="hero__sub">Start a project in any app. Everything you make lives in one open project format, on your machine.</p>
          <div className="hero__actions">
            <button className="btn btn--primary btn--tinted" style={accentVars('video')} onClick={() => startApp('video')} data-testid="hub-hero-new">
              <I.Plus size={15} /> {deltaInstalled ? `New ${delta.name} project` : `Get ${delta.name}`}
            </button>
            <button className="btn" onClick={() => openProject()} data-testid="hub-hero-open">
              <I.Open size={15} /> Open project…
            </button>
          </div>
        </div>
        <OmegaMark size={72} className="hero__mark" />
      </section>

      <section className="section">
        <div className="section__head">
          <h2>Create new</h2>
        </div>
        <div className="create-row">
          {WORKSPACE_ORDER.map((app) => (
            <CreateCard key={app} app={app} onClick={() => startApp(app)} />
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2>Recent projects</h2>
          {recents.length > 0 && (
            <button className="btn btn--ghost btn--sm" onClick={() => useHub.getState().setDashboardTab('projects')}>
              View all <I.ChevronRight size={14} />
            </button>
          )}
        </div>
        {recents.length === 0 ? (
          <div className="empty">
            <div className="empty-state__icon">
              <I.NavProjects size={18} />
            </div>
            <div className="empty__title">No projects yet</div>
            <div className="empty__sub">Create one above, or open an existing .omega file.</div>
          </div>
        ) : (
          <div className="recent-grid">
            {recents.slice(0, 8).map((r) => (
              <RecentCard key={r.path} r={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CreateCard({ app, onClick }: { app: AppKind; onClick: () => void }) {
  const t = THEMES[app];
  const installed = useHub((s) => !!s.installed[app]);
  const entry = useHub((s) => s.catalog.find((m) => m.id === app));
  const progress = useHub((s) => s.progress[app]);
  let hint: string = t.phase;
  if (t.available) {
    if (progress !== undefined) hint = `Installing… ${Math.round(progress * 100)}%`;
    else if (installed) hint = 'New project';
    else hint = entry ? `Get it · ${formatBytes(entry.size)}` : 'Not available offline';
  }
  return (
    <button
      className={`create-card ${t.available ? 'is-ready' : 'is-planned'}`}
      onClick={onClick}
      disabled={progress !== undefined}
      data-testid={`hub-create-${app}`}
      style={{ ['--card-accent' as string]: t.accent }}
    >
      <AppMark app={app} size={36} />
      <span className="create-card__text">
        <AppTitle app={app} />
        <span className="create-card__hint">
          {t.available && installed && progress === undefined && <I.Plus size={12} />}
          {t.available && !installed && progress === undefined && entry && <I.Download size={12} />}
          {hint}
        </span>
      </span>
    </button>
  );
}

function RecentCard({ r }: { r: { path: string; name: string; app: string; modifiedAt: number; summary: string } }) {
  const openProject = useHub((s) => s.launchProject);
  const removeRecent = useHub((s) => s.removeRecent);
  const app = (r.app in THEMES ? r.app : 'video') as AppKind;
  return (
    <div className="recent-card" onDoubleClick={() => openProject(r.path)} data-testid="hub-recent">
      <div className="recent-card__thumb" data-format={r.summary}>
        <div className="recent-card__app">
          <AppMark app={app} size={26} />
          <AppTitle app={app} />
        </div>
      </div>
      <div className="recent-card__body">
        <div className="recent-card__name" title={r.path}>
          {r.name}
        </div>
        <div className="recent-card__meta">Edited {timeAgo(r.modifiedAt)}</div>
      </div>
      <div className="recent-card__actions">
        <button className="btn btn--sm btn--primary btn--tinted" style={accentVars(app)} onClick={() => openProject(r.path)}>
          Open
        </button>
        <button className="icon-btn icon-btn--sm" onClick={() => removeRecent(r.path)} data-tip="Remove from recents" aria-label="Remove from recents">
          <I.Close size={14} />
        </button>
      </div>
    </div>
  );
}

function AppsTab() {
  const startApp = useHub((s) => s.startApp);
  const catalog = useHub((s) => s.catalog);
  const catalogError = useHub((s) => s.catalogError);
  const installed = useHub((s) => s.installed);
  const progress = useHub((s) => s.progress);
  const installModule = useHub((s) => s.installModule);
  const uninstallModule = useHub((s) => s.uninstallModule);
  const refreshModules = useHub((s) => s.refreshModules);
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Apps</h1>
          <p className="page__sub">Omega is a small hub. Each app downloads only when you want it and shares one project format with the others.</p>
        </div>
      </div>
      {catalogError && (
        <div className="note note--warn">
          <I.Warning size={15} />
          <span style={{ flex: 1 }}>{catalogError}</span>
          <button className="btn btn--xs" onClick={() => refreshModules()}>
            Retry
          </button>
        </div>
      )}
      <div className="app-list">
        {WORKSPACE_ORDER.map((app) => {
          const t = THEMES[app];
          const entry = catalog.find((m) => m.id === app);
          const inst = installed[app];
          const busy = progress[app] !== undefined;
          const update = !!(inst && entry && entry.version !== inst.version);
          return (
            <div className={`app-row ${t.available ? '' : 'is-planned'}`} key={app} data-testid={`hub-app-${app}`} style={accentVars(app)}>
              <AppMark app={app} size={44} />
              <div className="app-row__text">
                <div className="app-row__name">
                  <AppTitle app={app} size="lg" />
                  {!t.available && <span className="badge badge--outline">{t.phase}</span>}
                  {inst && (
                    <span className="badge badge--accent">
                      <span className="badge__dot" />
                      Installed · v{inst.version}
                    </span>
                  )}
                </div>
                {busy && (
                  <div className="progress app-row__progress">
                    <div className="progress__bar">
                      <div className="progress__fill" style={{ width: `${Math.round(progress[app] * 100)}%` }} />
                    </div>
                    <span className="progress__text">{Math.round(progress[app] * 100)}%</span>
                  </div>
                )}
              </div>
              <div className="app-row__actions">
                {!t.available && <span className="muted">Coming later</span>}
                {t.available && !inst && (
                  <button className="btn btn--primary btn--tinted" disabled={busy || !entry} onClick={() => installModule(app)}>
                    <I.Download size={15} /> {busy ? 'Installing…' : entry ? `Install · ${formatBytes(entry.size)}` : 'Unavailable'}
                  </button>
                )}
                {t.available && inst && (
                  <>
                    {update && (
                      <button className="btn" disabled={busy} onClick={() => installModule(app)}>
                        Update to v{entry!.version}
                      </button>
                    )}
                    <button className="btn btn--ghost" onClick={() => uninstallModule(app)} data-tip="Removes the app. Your projects are kept.">
                      Uninstall
                    </button>
                    <button className="btn btn--primary btn--tinted" onClick={() => startApp(app)}>
                      New project
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProjectsTab() {
  const recents = useHub((s) => s.recents);
  const openProject = useHub((s) => s.launchProject);
  const removeRecent = useHub((s) => s.removeRecent);
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Projects</h1>
          <p className="page__sub">Projects live wherever you save them. Nothing is uploaded.</p>
        </div>
        <button className="btn" onClick={() => openProject()}>
          <I.Open size={15} /> Open from disk…
        </button>
      </div>
      {recents.length === 0 ? (
        <div className="empty">
          <div className="empty-state__icon">
            <I.NavProjects size={18} />
          </div>
          <div className="empty__title">Nothing here yet</div>
          <div className="empty__sub">Projects you create or open are listed here.</div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>App</th>
              <th>Format</th>
              <th>Modified</th>
              <th>Location</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {recents.map((r) => {
              const app = (r.app in THEMES ? r.app : 'video') as AppKind;
              return (
                <tr key={r.path} onDoubleClick={() => openProject(r.path)}>
                  <td>
                    <div className="table__name">
                      <AppMark app={app} size={22} /> {r.name}
                    </div>
                  </td>
                  <td>
                    <AppTitle app={app} size="sm" />
                  </td>
                  <td className="mono" style={{ fontSize: 11.5 }}>
                    {r.summary}
                  </td>
                  <td>{timeAgo(r.modifiedAt)}</td>
                  <td className="table__path" title={r.path}>
                    {r.path}
                  </td>
                  <td className="table__actions">
                    <button className="btn btn--sm btn--primary btn--tinted" style={accentVars(app)} onClick={() => openProject(r.path)}>
                      Open
                    </button>
                    <button className="btn btn--sm btn--ghost" onClick={() => removeRecent(r.path)}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function LearnTab() {
  const groups = useMemo(() => {
    const map = new Map<string, typeof SHORTCUTS>();
    for (const s of SHORTCUTS) {
      if (!map.has(s.group)) map.set(s.group, []);
      map.get(s.group)!.push(s);
    }
    return [...map.entries()];
  }, []);
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Learn</h1>
          <p className="page__sub">
            {THEMES.video.name} ships with a Premiere Pro–compatible keyboard layout, so your muscle memory carries over. Final Cut Pro and DaVinci Resolve layouts are one
            click away in its Keyboard Shortcuts window.
          </p>
        </div>
      </div>
      <div className="learn-app">
        <AppMark app="video" size={32} />
        <AppTitle app="video" />
        <span className="learn-app__hint">
          Open the full, editable list inside {THEMES.video.name} with <Keys binding="Mod+Alt+K" />
        </span>
      </div>
      <div className="shortcut-grid">
        {groups.map(([group, items]) => (
          <div className="card" key={group}>
            <div className="card__title">{group}</div>
            <table className="keys">
              <tbody>
                {items.map((s) => (
                  <tr key={s.id}>
                    <td>{s.label}</td>
                    <td>
                      {s.keys.map((k, i) => (
                        <span key={k}>
                          {i > 0 && <span className="keys__or">or</span>}
                          <Keys binding={k} />
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

const PROMISES = [
  'A perpetual license is always available. Stop paying and you keep what you bought.',
  'Cancel in two clicks. No early-termination fees, ever.',
  'Your work is yours. We never train AI on your content and never look at your files.',
  'Open project format with a published spec.',
  'Works fully offline. A license check never blocks opening a file.',
  'No background services. Close Omega and nothing of ours keeps running.',
  'Windows, macOS and Linux.',
];

const PLANS: { name: string; price: string; unit?: string; features: string[]; cta: string; featured?: boolean; current?: boolean }[] = [
  { name: 'Free', price: '$0', features: ['Every app, no time limit', 'No watermark up to 1080p and stereo', 'Local AI tools'], cta: 'Current plan', current: true },
  { name: 'Creator', price: '$9.99', unit: '/month', features: ['Everything unlocked, all resolutions', 'All export presets, HDR delivery', 'Priority support'], cta: 'Choose Creator', featured: true },
  { name: 'Perpetual', price: '$149.99', unit: ' once', features: ['Own this version forever', 'One year of updates included', 'Works offline, no account needed'], cta: 'Buy once' },
  { name: 'Studio', price: '$19.99', unit: '/seat/month', features: ['Shared libraries and review links', 'Team admin and SSO', 'Cloud render (optional)'], cta: 'Contact us' },
];

function PlansTab() {
  const showToast = useHub((s) => s.showToast);
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Plans</h1>
          <p className="page__sub">Four prices, shown in full, with no regional games. Switch or cancel any time from this screen.</p>
        </div>
      </div>
      <div className="plans">
        {PLANS.map((p) => (
          <div key={p.name} className={`plan ${p.featured ? 'plan--featured' : ''}`}>
            {p.featured && <span className="badge plan__badge">Popular</span>}
            <div className="plan__name">{p.name}</div>
            <div className="plan__price">
              {p.price}
              {p.unit && <span>{p.unit}</span>}
            </div>
            <ul>
              {p.features.map((f) => (
                <li key={f}>
                  <I.Check size={14} /> {f}
                </li>
              ))}
            </ul>
            <button
              className={`btn btn--block ${p.featured ? 'btn--primary' : ''}`}
              disabled={p.current}
              onClick={() => showToast('Purchasing opens with the 1.0 release. Every app is free during the preview.')}
            >
              {p.cta}
            </button>
          </div>
        ))}
      </div>
      <div className="card promises">
        <div className="card__title">
          <I.Shield size={16} /> Our promises
        </div>
        <ul>
          {PROMISES.map((p) => (
            <li key={p}>
              <I.Check size={14} /> {p}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SettingsTab() {
  const appInfo = useHub((s) => s.appInfo);
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Settings</h1>
          <p className="page__sub">Omega keeps everything on this computer.</p>
        </div>
      </div>
      <div className="settings-grid">
        <div className="card">
          <div className="card__title">
            <I.Shield size={16} /> Privacy
          </div>
          <ul className="facts">
            <li>
              <I.Check size={14} /> No telemetry and no crash reports are sent.
            </li>
            <li>
              <I.Check size={14} /> No account or sign-in, ever required.
            </li>
            <li>
              <I.Check size={14} /> Your media and projects never leave this machine.
            </li>
            <li>
              <I.Check size={14} /> The app catalog is fetched only to list and download apps.
            </li>
          </ul>
        </div>
        <div className="card">
          <div className="card__title">
            <I.Keyboard size={16} /> Keyboard
          </div>
          <p className="muted" style={{ lineHeight: 1.55 }}>
            Each app keeps its own shortcuts. In {THEMES.video.name}, open Keyboard Shortcuts with <Keys binding="Mod+Alt+K" /> to rebind keys or switch between the Premiere
            Pro, Final Cut Pro and DaVinci Resolve layouts.
          </p>
        </div>
        <div className="card">
          <div className="card__title">
            <I.Monitor size={16} /> This computer
          </div>
          <div className="row">
            <span className="row__label">Omega</span>
            <span className="row__value">{appInfo?.version}</span>
          </div>
          <div className="row">
            <span className="row__label">Electron</span>
            <span className="row__value">{appInfo?.electron}</span>
          </div>
          <div className="row">
            <span className="row__label">Chromium</span>
            <span className="row__value">{appInfo?.chrome}</span>
          </div>
          <div className="row">
            <span className="row__label">Data folder</span>
            <span className="row__value truncate" title={appInfo?.userData} style={{ maxWidth: 220 }}>
              {appInfo?.userData}
            </span>
          </div>
          <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            Nothing runs in the background: when you close Omega, no helper, sync agent or updater keeps running.
          </p>
        </div>
      </div>
    </div>
  );
}
