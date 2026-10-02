// State for the Omega hub (dashboard, projects, app manager). The editor
// apps have their own stores (see state/store.ts for Delta).

import { create } from 'zustand';
import type { AppInfo, CatalogModule, InstalledMap, RecentProject } from '../../electron/api';
import type { AppKind } from '../brand/themes';
import { THEMES, applyTheme } from '../brand/themes';
import { makeSequence } from './defaults';
import { isDropFrameRate } from './presets';
import type { Project, ProjectSettings } from './types';
import { FORMAT_VERSION, newId } from './types';

export type DashboardTab = 'home' | 'apps' | 'projects' | 'learn' | 'plans' | 'settings';

interface HubState {
  dashboardTab: DashboardTab;
  appInfo: AppInfo | null;
  recents: RecentProject[];
  toast: string | null;
  newProjectFor: AppKind | null;
  catalog: CatalogModule[];
  catalogError: string | null;
  installed: InstalledMap;
  progress: Record<string, number>;

  init(): Promise<void>;
  setDashboardTab(tab: DashboardTab): void;
  showToast(message: string | null): void;
  openNewProject(app: AppKind): void;
  closeNewProject(): void;
  startApp(app: AppKind): Promise<void>;
  launchProject(path?: string): Promise<void>;
  refreshRecents(): Promise<void>;
  removeRecent(path: string): Promise<void>;
  refreshModules(): Promise<void>;
  installModule(id: string): Promise<boolean>;
  uninstallModule(id: string): Promise<void>;
  createProject(app: AppKind, name: string, location: string, settings: ProjectSettings): Promise<void>;
}

export function cleanError(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export function summarize(p: Pick<Project, 'settings'>): string {
  const s = p.settings;
  return `${s.width}×${s.height} · ${s.fps} fps`;
}

export const useHub = create<HubState>((set, get) => ({
  dashboardTab: 'home',
  appInfo: null,
  recents: [],
  toast: null,
  newProjectFor: null,
  catalog: [],
  catalogError: null,
  installed: {},
  progress: {},

  async init() {
    const [appInfo, recents] = await Promise.all([window.omega.appInfo(), window.omega.projects.recents()]);
    set({ appInfo, recents });
    applyTheme('omega');
    void get().refreshModules();
  },

  setDashboardTab: (dashboardTab) => set({ dashboardTab }),

  showToast(message) {
    set({ toast: message });
    if (message) setTimeout(() => get().toast === message && set({ toast: null }), 3500);
  },

  openNewProject: (app) => set({ newProjectFor: app }),
  closeNewProject: () => set({ newProjectFor: null }),

  async refreshRecents() {
    set({ recents: await window.omega.projects.recents() });
  },

  async removeRecent(path) {
    await window.omega.projects.removeRecent(path);
    set({ recents: await window.omega.projects.recents() });
  },

  async refreshModules() {
    const [cat, installed] = await Promise.all([window.omega.modules.catalog(), window.omega.modules.installed()]);
    set({ catalog: cat.modules, catalogError: cat.ok ? null : (cat.error ?? 'The app catalog is unavailable.'), installed });
  },

  async installModule(id) {
    set((s) => ({ progress: { ...s.progress, [id]: 0 } }));
    const clear = () =>
      set((s) => {
        const { [id]: _drop, ...rest } = s.progress;
        return { progress: rest };
      });
    try {
      await window.omega.modules.install(id);
    } catch (err) {
      clear();
      get().showToast(`Install failed: ${cleanError(err)}`);
      return false;
    }
    await get().refreshModules();
    clear();
    get().showToast(`${THEMES[id as AppKind]?.name ?? id} is installed`);
    return true;
  },

  async uninstallModule(id) {
    await window.omega.modules.uninstall(id);
    await get().refreshModules();
    get().showToast(`${THEMES[id as AppKind]?.name ?? id} was removed. Your projects are untouched.`);
  },

  // Dashboard card: make sure the app is installed (downloading it if needed), then start a project.
  async startApp(app) {
    const theme = THEMES[app];
    if (!theme.available) {
      get().showToast(`${theme.name} (${theme.category}) is planned for ${theme.phase}.`);
      return;
    }
    if (!get().installed[app]) {
      if (!get().catalog.some((m) => m.id === app)) {
        get().showToast(`${theme.name} can't be downloaded right now. Check the Apps page.`);
        set({ dashboardTab: 'apps' });
        return;
      }
      if (!(await get().installModule(app))) return;
    }
    set({ newProjectFor: app });
  },

  // Open an existing project file in the app that made it.
  async launchProject(path) {
    const filePath = path ?? (await window.omega.dialogs.pickProjectFile());
    if (!filePath) return;
    let app: string;
    try {
      app = JSON.parse(await window.omega.projects.load(filePath)).app;
    } catch {
      get().showToast('Could not read that project.');
      await window.omega.projects.removeRecent(filePath);
      return;
    }
    if (!get().installed[app]) {
      get().showToast(`Install ${THEMES[app as AppKind]?.name ?? app} to open this project.`);
      set({ dashboardTab: 'apps' });
      return;
    }
    try {
      await window.omega.modules.open(app, filePath);
    } catch (err) {
      get().showToast(cleanError(err));
    }
  },

  async createProject(app, name, location, settings) {
    if (!get().installed[app]) throw new Error(`${THEMES[app].name} is not installed.`);
    const now = Date.now();
    const full = { ...settings, dropFrame: isDropFrameRate(settings.fps) };
    const seq = makeSequence(full);
    const project: Project = {
      formatVersion: FORMAT_VERSION,
      id: newId('proj'),
      name,
      app,
      createdAt: now,
      modifiedAt: now,
      settings: full,
      assets: [],
      bins: [],
      luts: [],
      sequences: [seq],
      activeSequenceId: seq.id,
    };
    const handle = await window.omega.projects.create(location, name, JSON.stringify(project, null, 2));
    await window.omega.projects.addRecent({ path: handle.filePath, name, app, modifiedAt: now, summary: summarize(project) });
    set({ recents: await window.omega.projects.recents(), newProjectFor: null });
    try {
      await window.omega.modules.open(app, handle.filePath);
    } catch (err) {
      get().showToast(cleanError(err));
    }
  },
}));
