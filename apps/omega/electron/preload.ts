import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { OmegaApi, RecentProject } from './api';

function mediaUrl(filePath: string): string {
  return `omega-media://local/${encodeURIComponent(filePath)}`;
}

const api: OmegaApi = {
  appInfo: () => ipcRenderer.invoke('app:info'),
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizedChange: (cb) => {
      const listener = (_e: unknown, value: boolean) => cb(value);
      ipcRenderer.on('window:maximized', listener);
      return () => ipcRenderer.removeListener('window:maximized', listener);
    },
  },
  dialogs: {
    pickMedia: () => ipcRenderer.invoke('dialog:pickMedia'),
    pickFolder: (defaultPath) => ipcRenderer.invoke('dialog:pickFolder', defaultPath),
    pickProjectFile: () => ipcRenderer.invoke('dialog:pickProjectFile'),
    pickExportPath: (defaultName, extension) => ipcRenderer.invoke('dialog:pickExportPath', defaultName, extension),
    pickFiles: (title, extensions) => ipcRenderer.invoke('dialog:pickFiles', title, extensions),
    pickSavePath: (title, defaultName, extension) => ipcRenderer.invoke('dialog:pickSavePath', title, defaultName, extension),
  },
  projects: {
    create: (location, name, json) => ipcRenderer.invoke('project:create', location, name, json),
    save: (filePath, json) => ipcRenderer.invoke('project:save', filePath, json),
    load: (filePath) => ipcRenderer.invoke('project:load', filePath),
    backup: (filePath, json) => ipcRenderer.invoke('project:backup', filePath, json),
    recents: () => ipcRenderer.invoke('recents:list'),
    addRecent: (entry: RecentProject) => ipcRenderer.invoke('recents:add', entry),
    removeRecent: (path) => ipcRenderer.invoke('recents:remove', path),
    onChanged: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('recents:changed', listener);
      return () => ipcRenderer.removeListener('recents:changed', listener);
    },
  },
  modules: {
    catalog: () => ipcRenderer.invoke('modules:catalog'),
    installed: () => ipcRenderer.invoke('modules:installed'),
    install: (id) => ipcRenderer.invoke('modules:install', id),
    uninstall: (id) => ipcRenderer.invoke('modules:uninstall', id),
    open: (id, projectPath) => ipcRenderer.invoke('modules:open', id, projectPath),
    onProgress: (cb) => {
      const listener = (_e: unknown, id: string, f: number) => cb(id, f);
      ipcRenderer.on('modules:progress', listener);
      return () => ipcRenderer.removeListener('modules:progress', listener);
    },
  },
  media: {
    urlFor: mediaUrl,
    exists: (path) => ipcRenderer.invoke('media:exists', path),
  },
  files: {
    writeBinary: (path, data) => ipcRenderer.invoke('file:writeBinary', path, data),
    readText: (path) => ipcRenderer.invoke('file:readText', path),
    writeText: (path, text) => ipcRenderer.invoke('file:writeText', path, text),
    pathForFile: (file) => webUtils.getPathForFile(file),
    showInFolder: (path) => ipcRenderer.send('file:showInFolder', path),
  },
};

contextBridge.exposeInMainWorld('omega', api);
