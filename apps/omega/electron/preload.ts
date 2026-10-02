import { contextBridge, ipcRenderer } from 'electron';
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
  },
  projects: {
    create: (location, name, json) => ipcRenderer.invoke('project:create', location, name, json),
    save: (filePath, json) => ipcRenderer.invoke('project:save', filePath, json),
    load: (filePath) => ipcRenderer.invoke('project:load', filePath),
    recents: () => ipcRenderer.invoke('recents:list'),
    addRecent: (entry: RecentProject) => ipcRenderer.invoke('recents:add', entry),
    removeRecent: (path) => ipcRenderer.invoke('recents:remove', path),
  },
  media: {
    urlFor: mediaUrl,
    exists: (path) => ipcRenderer.invoke('media:exists', path),
  },
  files: {
    writeBinary: (path, data) => ipcRenderer.invoke('file:writeBinary', path, data),
    showInFolder: (path) => ipcRenderer.send('file:showInFolder', path),
  },
};

contextBridge.exposeInMainWorld('omega', api);
