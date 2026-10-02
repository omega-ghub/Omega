import { useMemo, type ReactElement } from 'react';
import { AppMark, OmegaMark } from '../brand/Logos';
import { THEMES, WORKSPACE_ORDER, type AppKind } from '../brand/themes';
import { useStore, type DashboardTab } from '../state/store';
import { I } from '../ui/Icons';
import { timeAgo } from '../ui/format';
import { SHORTCUTS } from '../workspaces/video/shortcuts';

const NAV: { id: DashboardTab; label: string; icon: (p: { size?: number }) => ReactElement }[] = [
  { id: 'home', label: 'Home', icon: I.Home },
  { id: 'apps', label: 'Apps', icon: I.Grid },
  { id: 'projects', label: 'Projects', icon: I.Folder },
  { id: 'learn', label: 'Learn', icon: I.Book },
  { id: 'plans', label: 'Plans', icon: I.Tag },
  { id: 'settings', label: 'Settings', icon: I.Settings },
];

export function Dashboard() {
  const tab = useStore((s) => s.dashboardTab);
  const setTab = useStore((s) => s.setDashboardTab);

  return (
    <div className="dash">
      <aside className="dash__side">
        <div className="dash__brand">
          <OmegaMark size={34} />
          <div>
            <div className="dash__brand-name">Omega</div>
            <div className="dash__brand-sub">Creative Suite</div>
          </div>
        </div>
        <nav className="dash__nav">
          {NAV.map((n) => (
            <button key={n.id} className={`dash__nav-item ${tab === n.id ? 'is-active' : ''}`} onClick={() => setTab(n.id)}>
              <n.icon size={18} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="dash__plan">
          <div className="dash__plan-label">Your plan</div>
          <div className="dash__plan-name">Free</div>
          <div className="dash__plan-hint">Every workspace. No watermark up to 1080p.</div>
          <button className="btn btn--accent btn--block" onClick={() => setTab('plans')}>
            See plans
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
  if (h < 5) return 'Still at it';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function HomeTab() {
  const recents = useStore((s) => s.recents);
  const openNew = useStore((s) => s.openNewProject);
  const openProject = useStore((s) => s.openProject);

  return (
    <div className="page">
      <section className="hero">
        <div className="hero__text">
          <div className="hero__eyebrow">{greeting()}</div>
          <h1 className="hero__title">What are you making today?</h1>
          <p className="hero__sub">Pick a workspace to start a project. Everything you make lives in one open file format and stays on your machine.</p>
        </div>
        <OmegaMark size={128} className="hero__mark" />
      </section>

      <section className="section">
        <div className="section__head">
          <h2>Create new</h2>
        </div>
        <div className="create-row">
          {WORKSPACE_ORDER.map((app) => (
            <CreateCard key={app} app={app} onClick={() => openNew(app)} />
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2>Recent projects</h2>
          <button className="btn btn--ghost" onClick={() => openProject()}>
            <I.Open size={16} /> Open project…
          </button>
        </div>
        {recents.length === 0 ? (
          <div className="empty">
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
  return (
    <button className="create-card" onClick={onClick} style={{ ['--card-accent' as string]: t.accent, ['--card-soft' as string]: t.accentSoft }}>
      <AppMark app={app} size={44} />
      <div className="create-card__name">{t.short}</div>
      <div className="create-card__hint">{t.available ? 'Start a project' : t.phase}</div>
    </button>
  );
}

function RecentCard({ r }: { r: { path: string; name: string; app: string; modifiedAt: number; summary: string } }) {
  const openProject = useStore((s) => s.openProject);
  const removeRecent = useStore((s) => s.removeRecent);
  const app = (r.app in THEMES ? r.app : 'video') as AppKind;
  const t = THEMES[app];
  return (
    <div className="recent-card" onDoubleClick={() => openProject(r.path)}>
      <div className="recent-card__thumb" style={{ background: `linear-gradient(135deg, ${t.accentSoft}, transparent 70%)` }}>
        <AppMark app={app} size={36} />
      </div>
      <div className="recent-card__body">
        <div className="recent-card__name" title={r.path}>
          {r.name}
        </div>
        <div className="recent-card__meta">
          {t.short} · {r.summary} · {timeAgo(r.modifiedAt)}
        </div>
      </div>
      <div className="recent-card__actions">
        <button className="btn btn--small btn--accent" onClick={() => openProject(r.path)}>
          Open
        </button>
        <button className="btn btn--small btn--ghost" onClick={() => removeRecent(r.path)} title="Remove from recents">
          <I.Close size={14} />
        </button>
      </div>
    </div>
  );
}

function AppsTab() {
  const openNew = useStore((s) => s.openNewProject);
  return (
    <div className="page">
      <h1 className="page__title">Apps</h1>
      <p className="page__sub">
        Omega is one application. Each workspace below is a different editor over the same project file, so a 3D scene or an audio mix can live right on a video timeline.
      </p>
      <div className="app-list">
        {WORKSPACE_ORDER.map((app) => {
          const t = THEMES[app];
          return (
            <div className="app-row" key={app}>
              <AppMark app={app} size={56} />
              <div className="app-row__text">
                <div className="app-row__name">
                  {t.name} {!t.available && <span className="pill">{t.phase}</span>}
                  {t.available && <span className="pill pill--accent" style={{ ['--pill' as string]: t.accent }}>Preview</span>}
                </div>
                <div className="app-row__tag">{t.tagline}</div>
              </div>
              <button className="btn btn--accent" style={{ ['--accent' as string]: t.accent, ['--accent-deep' as string]: t.accentDeep }} onClick={() => openNew(app)}>
                {t.available ? 'New project' : 'Preview'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProjectsTab() {
  const recents = useStore((s) => s.recents);
  const openProject = useStore((s) => s.openProject);
  const removeRecent = useStore((s) => s.removeRecent);
  return (
    <div className="page">
      <div className="section__head">
        <h1 className="page__title">Projects</h1>
        <button className="btn btn--accent" onClick={() => openProject()}>
          <I.Open size={16} /> Open from disk
        </button>
      </div>
      {recents.length === 0 ? (
        <div className="empty">
          <div className="empty__title">Nothing here yet</div>
          <div className="empty__sub">Projects you create or open will be listed here. They are stored wherever you choose, never in a cloud you didn't ask for.</div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Workspace</th>
              <th>Settings</th>
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
                  <td className="table__name">
                    <AppMark app={app} size={20} /> {r.name}
                  </td>
                  <td>{THEMES[app].short}</td>
                  <td>{r.summary}</td>
                  <td>{timeAgo(r.modifiedAt)}</td>
                  <td className="table__path" title={r.path}>
                    {r.path}
                  </td>
                  <td className="table__actions">
                    <button className="btn btn--small btn--accent" onClick={() => openProject(r.path)}>
                      Open
                    </button>
                    <button className="btn btn--small btn--ghost" onClick={() => removeRecent(r.path)}>
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
      <h1 className="page__title">Learn</h1>
      <p className="page__sub">Omega ships with a Premiere-compatible keyboard layout, so muscle memory carries over. Here is the Video workspace reference.</p>
      <div className="shortcut-grid">
        {groups.map(([group, items]) => (
          <div className="card" key={group}>
            <div className="card__title">{group}</div>
            <table className="keys">
              <tbody>
                {items.map((s) => (
                  <tr key={s.label}>
                    <td>{s.label}</td>
                    <td>
                      {s.keys.map((k) => (
                        <kbd key={k}>{k}</kbd>
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

function PlansTab() {
  return (
    <div className="page">
      <h1 className="page__title">Plans</h1>
      <p className="page__sub">Three prices, shown in full, no regional games. Switch or cancel any time from this screen.</p>
      <div className="plans">
        <div className="plan">
          <div className="plan__name">Free</div>
          <div className="plan__price">
            $0
          </div>
          <ul>
            <li>Every workspace, no time limit</li>
            <li>No watermark up to 1080p / stereo</li>
            <li>Local AI tools</li>
          </ul>
          <button className="btn btn--ghost btn--block" disabled>
            Current plan
          </button>
        </div>
        <div className="plan plan--featured">
          <div className="plan__name">Creator</div>
          <div className="plan__price">
            $9.99<span>/month</span>
          </div>
          <ul>
            <li>Everything unlocked, all resolutions</li>
            <li>All export presets, HDR delivery</li>
            <li>Priority support</li>
          </ul>
          <button className="btn btn--accent btn--block">Choose Creator</button>
        </div>
        <div className="plan">
          <div className="plan__name">Perpetual</div>
          <div className="plan__price">
            $149.99<span> once</span>
          </div>
          <ul>
            <li>Own this version forever</li>
            <li>One year of updates included</li>
            <li>Works offline, no account needed</li>
          </ul>
          <button className="btn btn--ghost btn--block">Buy once</button>
        </div>
        <div className="plan">
          <div className="plan__name">Studio</div>
          <div className="plan__price">
            $19.99<span>/seat/month</span>
          </div>
          <ul>
            <li>Shared libraries and review links</li>
            <li>Team admin and SSO</li>
            <li>Cloud render (optional)</li>
          </ul>
          <button className="btn btn--ghost btn--block">Contact us</button>
        </div>
      </div>
      <div className="card promises">
        <div className="card__title">
          <I.Shield size={18} /> Our promises
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
  const appInfo = useStore((s) => s.appInfo);
  return (
    <div className="page">
      <h1 className="page__title">Settings</h1>
      <div className="settings-grid">
        <div className="card">
          <div className="card__title">Keyboard</div>
          <label className="field">
            <span>Shortcut layout</span>
            <select defaultValue="premiere">
              <option value="premiere">Premiere-compatible (default)</option>
              <option value="omega">Omega</option>
            </select>
          </label>
          <p className="muted">Final Cut and Resolve layouts are planned.</p>
        </div>
        <div className="card">
          <div className="card__title">Privacy</div>
          <label className="field field--row">
            <input type="checkbox" defaultChecked={false} />
            <span>Send anonymous crash reports (off by default)</span>
          </label>
          <label className="field field--row">
            <input type="checkbox" defaultChecked={false} />
            <span>Check for updates automatically</span>
          </label>
          <p className="muted">Omega never sends your media or project contents anywhere.</p>
        </div>
        <div className="card">
          <div className="card__title">What's running</div>
          <p>
            <strong>Nothing in the background.</strong> When you close Omega, no helper, sync agent or updater keeps running.
          </p>
          <p className="muted">
            Omega {appInfo?.version} · Electron {appInfo?.electron} · Chromium {appInfo?.chrome}
          </p>
          <p className="muted">Data folder: {appInfo?.userData}</p>
        </div>
      </div>
    </div>
  );
}
