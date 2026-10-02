// Shared type contract between the Electron main process and the renderer.
// The renderer only ever talks to the main process through `window.omega`,
// which the preload script exposes with contextBridge.

export interface MediaFileInfo {
  path: string;
  name: string;
  size: number;
  url: string; // omega-media:// URL that the renderer can stream from
}

export interface RecentProject {
  path: string;
  name: string;
  app: string;
  modifiedAt: number;
  summary: string;
}

export interface AppInfo {
  platform: NodeJS.Platform;
  version: string;
  electron: string;
  chrome: string;
  userData: string;
  defaultProjectsDir: string;
  customTitleBar: boolean;
}

export interface CatalogModule {
  id: string;
  name: string;
  version: string;
  size: number; // bytes, compressed download
  sha256: string;
  url: string; // relative to the catalog, or absolute
  description?: string;
}

export interface CatalogResult {
  ok: boolean;
  source: string;
  modules: CatalogModule[];
  error?: string;
}

export type InstalledMap = Record<string, { version: string }>;

export interface OmegaApi {
  appInfo(): Promise<AppInfo>;
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    onMaximizedChange(cb: (maximized: boolean) => void): () => void;
  };
  dialogs: {
    pickMedia(): Promise<MediaFileInfo[]>;
    pickFolder(defaultPath?: string): Promise<string | null>;
    pickProjectFile(): Promise<string | null>;
    pickExportPath(defaultName: string, extension: string): Promise<string | null>;
  };
  projects: {
    create(location: string, name: string, json: string): Promise<{ filePath: string; dir: string }>;
    save(filePath: string, json: string): Promise<void>;
    load(filePath: string): Promise<string>;
    recents(): Promise<RecentProject[]>;
    addRecent(entry: RecentProject): Promise<void>;
    removeRecent(path: string): Promise<void>;
    onChanged(cb: () => void): () => void;
  };
  modules: {
    catalog(): Promise<CatalogResult>;
    installed(): Promise<InstalledMap>;
    install(id: string): Promise<void>;
    uninstall(id: string): Promise<void>;
    open(id: string, projectPath: string): Promise<void>;
    onProgress(cb: (id: string, fraction: number) => void): () => void;
  };
  media: {
    urlFor(path: string): string;
    exists(path: string): Promise<boolean>;
  };
  files: {
    writeBinary(path: string, data: ArrayBuffer): Promise<void>;
    showInFolder(path: string): void;
  };
}

declare global {
  interface Window {
    omega: OmegaApi;
  }
}
