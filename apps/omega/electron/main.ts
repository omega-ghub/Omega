import { app, BrowserWindow, ipcMain, dialog, protocol, shell, nativeImage, session, systemPreferences } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { AppInfo, MediaFileInfo, RecentProject } from './api';
import { installModule, listInstalled, loadCatalog, serveModule, uninstallModule } from './modules';

// ---------------------------------------------------------------------------
// Media streaming protocol
// ---------------------------------------------------------------------------
// Media is served from disk through a privileged scheme (omega-media://) with
// HTTP range support so <video> elements and Mediabunny can seek efficiently.
// Nothing is ever uploaded anywhere: this is purely local.

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'omega-module',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
  {
    scheme: 'omega-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true },
  },
]);

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};

const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'];
const AUDIO_EXT = ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'];

function mediaUrl(filePath: string): string {
  return `omega-media://local/${encodeURIComponent(filePath)}`;
}

function toWeb(stream: fs.ReadStream): ReadableStream {
  return Readable.toWeb(stream) as unknown as ReadableStream;
}

// The renderer page and the media scheme are different origins, so every
// response carries CORS headers; otherwise fetch() fails and canvases taint.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

async function serveMedia(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''));
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return new Response('Not found', { status: 404, headers: CORS });
  }
  const mime = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const range = request.headers.get('range');
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      let start = match[1] ? Number(match[1]) : NaN;
      let end = match[2] ? Number(match[2]) : NaN;
      if (Number.isNaN(start)) {
        // suffix range: last N bytes
        start = Math.max(0, stat.size - end);
        end = stat.size - 1;
      } else if (Number.isNaN(end)) {
        end = stat.size - 1;
      }
      end = Math.min(end, stat.size - 1);
      if (start > end || start >= stat.size) {
        return new Response(null, { status: 416, headers: { ...CORS, 'Content-Range': `bytes */${stat.size}` } });
      }
      return new Response(toWeb(fs.createReadStream(filePath, { start, end })), {
        status: 206,
        headers: {
          ...CORS,
          'Content-Type': mime,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
        },
      });
    }
  }
  return new Response(toWeb(fs.createReadStream(filePath)), {
    status: 200,
    headers: { ...CORS, 'Content-Type': mime, 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes' },
  });
}

// ---------------------------------------------------------------------------
// Recent projects (stored in userData, never in the cloud)
// ---------------------------------------------------------------------------

function recentsPath() {
  return path.join(app.getPath('userData'), 'recents.json');
}

async function readRecents(): Promise<RecentProject[]> {
  try {
    const raw = await fsp.readFile(recentsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeRecents(list: RecentProject[]) {
  await fsp.mkdir(path.dirname(recentsPath()), { recursive: true });
  await fsp.writeFile(recentsPath(), JSON.stringify(list, null, 2));
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const customTitleBar = true;

function iconPath() {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'icon.png'),
    path.join(app.getAppPath(), 'resources', 'icon.png'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function createWindow(targetUrl?: string) {
  const icon = iconPath();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0e0e10',
    show: false,
    frame: !customTitleBar,
    titleBarStyle: customTitleBar ? 'hidden' : 'default',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 12 } } : {}),
    icon: icon ? nativeImage.createFromPath(icon) : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => win.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win.webContents.send('window:maximized', false));

  if (targetUrl) {
    void win.loadURL(targetUrl);
  } else if (isDev) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  return win;
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('app:info', (): AppInfo => ({
    platform: process.platform,
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    userData: app.getPath('userData'),
    defaultProjectsDir: path.join(app.getPath('documents'), 'Omega Projects'),
    customTitleBar,
  }));

  ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.on('window:toggleMaximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.handle('window:isMaximized', (e) => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false);

  ipcMain.handle('dialog:pickMedia', async (e): Promise<MediaFileInfo[]> => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    // Automated smoke tests cannot drive native dialogs; they pass files in.
    const smoke = process.env.OMEGA_SMOKE_MEDIA;
    const result = smoke
      ? { canceled: false, filePaths: smoke.split(path.delimiter).filter(Boolean) }
      : await dialog.showOpenDialog(win!, {
      title: 'Import media',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All media', extensions: [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT] },
        { name: 'Video', extensions: VIDEO_EXT },
        { name: 'Audio', extensions: AUDIO_EXT },
        { name: 'Images', extensions: IMAGE_EXT },
      ],
    });
    if (result.canceled) return [];
    const infos: MediaFileInfo[] = [];
    for (const p of result.filePaths) {
      const stat = await fsp.stat(p);
      infos.push({ path: p, name: path.basename(p), size: stat.size, url: mediaUrl(p) });
    }
    return infos;
  });

  ipcMain.handle('dialog:pickFolder', async (e, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose project location',
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:pickProjectFile', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const result = await dialog.showOpenDialog(win!, {
      title: 'Open project',
      properties: ['openFile'],
      filters: [{ name: 'Omega project', extensions: ['omega'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:pickExportPath', async (e, defaultName: string, extension: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    if (process.env.OMEGA_SMOKE_EXPORT) return process.env.OMEGA_SMOKE_EXPORT;
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export',
      defaultPath: path.join(app.getPath('videos'), `${defaultName}.${extension}`),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    return result.canceled || !result.filePath ? null : result.filePath;
  });

  ipcMain.handle('project:create', async (_e, location: string, name: string, json: string) => {
    const safeName = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'Untitled';
    const dir = path.join(location, safeName);
    await fsp.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${safeName}.omega`);
    await atomicWrite(filePath, json);
    return { filePath, dir };
  });

  ipcMain.handle('project:save', async (_e, filePath: string, json: string) => {
    await atomicWrite(filePath, json);
  });

  ipcMain.handle('project:load', async (_e, filePath: string) => fsp.readFile(filePath, 'utf8'));

  // Rolling backups in <project dir>/.backups, newest 20 kept.
  ipcMain.handle('project:backup', async (_e, filePath: string, json: string) => {
    const dir = path.join(path.dirname(filePath), '.backups');
    await fsp.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fsp.writeFile(path.join(dir, `${path.basename(filePath, '.omega')} ${stamp}.omega`), json, 'utf8');
    const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.omega')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 20))) await fsp.rm(path.join(dir, f), { force: true });
  });

  // Text files the renderer needs to read (LUTs, captions) — read-only.
  ipcMain.handle('file:readText', async (_e, p: string) => fsp.readFile(p, 'utf8'));
  ipcMain.handle('file:writeText', async (_e, p: string, text: string) => {
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, text, 'utf8');
  });
  ipcMain.handle('dialog:pickFiles', async (e, title: string, extensions: string[]) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const smoke = process.env.OMEGA_SMOKE_FILES;
    if (smoke) {
      const want = smoke.split(path.delimiter).filter((f) => extensions.includes(path.extname(f).slice(1).toLowerCase()));
      if (want.length) return want;
    }
    const result = await dialog.showOpenDialog(win!, { title, properties: ['openFile', 'multiSelections'], filters: [{ name: title, extensions }] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('dialog:pickSavePath', async (e, title: string, defaultName: string, extension: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    if (process.env.OMEGA_SMOKE_EXPORT_DIR) return path.join(process.env.OMEGA_SMOKE_EXPORT_DIR, `${defaultName}.${extension}`);
    const result = await dialog.showSaveDialog(win!, { title, defaultPath: path.join(app.getPath('videos'), `${defaultName}.${extension}`), filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    return result.canceled || !result.filePath ? null : result.filePath;
  });

  ipcMain.handle('recents:list', () => readRecents());
  ipcMain.handle('recents:add', async (_e, entry: RecentProject) => {
    const list = (await readRecents()).filter((r) => r.path !== entry.path);
    list.unshift(entry);
    await writeRecents(list.slice(0, 30));
    notifyRecentsChanged();
  });
  ipcMain.handle('recents:remove', async (_e, p: string) => {
    await writeRecents((await readRecents()).filter((r) => r.path !== p));
    notifyRecentsChanged();
  });

  // ---- apps (modules) ----
  ipcMain.handle('modules:catalog', () => loadCatalog());
  ipcMain.handle('modules:installed', () => listInstalled());
  ipcMain.handle('modules:install', async (e, id: string) => {
    await installModule(id, (f) => e.sender.send('modules:progress', id, f));
  });
  ipcMain.handle('modules:uninstall', (_e, id: string) => uninstallModule(id));
  ipcMain.handle('modules:open', (_e, id: string, projectPath: string) => openModuleWindow(id, projectPath));

  ipcMain.handle('media:exists', async (_e, p: string) => {
    try {
      await fsp.access(p);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('file:writeBinary', async (_e, p: string, data: ArrayBuffer) => {
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, Buffer.from(data));
  });
  ipcMain.on('file:showInFolder', (_e, p: string) => shell.showItemInFolder(p));

  // Streaming writes (long exports): positioned writes into `<path>.partial`,
  // renamed into place on close so a crash or cancel never leaves a truncated
  // file under the real name.
  ipcMain.handle('file:openWrite', async (_e, p: string) => {
    await fsp.mkdir(path.dirname(p), { recursive: true });
    const partial = `${p}.partial`;
    const fh = await fsp.open(partial, 'w');
    const id = nextWriteHandle++;
    writeHandles.set(id, { fh, path: p, partial });
    return id;
  });
  ipcMain.handle('file:writeAt', async (_e, id: number, data: ArrayBuffer | Uint8Array, position: number) => {
    const h = writeHandles.get(id);
    if (!h) throw new Error('This export file is no longer open.');
    const buf = data instanceof Uint8Array ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : Buffer.from(data);
    let off = 0;
    while (off < buf.length) {
      const { bytesWritten } = await h.fh.write(buf, off, buf.length - off, position + off);
      if (bytesWritten <= 0) throw new Error('Disk write failed (the disk may be full).');
      off += bytesWritten;
    }
  });
  ipcMain.handle('file:closeWrite', async (_e, id: number, discard: boolean) => {
    const h = writeHandles.get(id);
    if (!h) return 0;
    writeHandles.delete(id);
    const { size } = await h.fh.stat();
    await h.fh.close();
    if (discard) {
      await fsp.rm(h.partial, { force: true });
      return 0;
    }
    await fsp.rename(h.partial, h.path);
    return size;
  });
  ipcMain.handle('file:freeSpace', async (_e, p: string) => {
    let dir = p;
    for (let i = 0; i < 64; i++) {
      try {
        const s = await fsp.statfs(dir);
        return Number(s.bavail) * Number(s.bsize);
      } catch {
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
      }
    }
    return null;
  });
}

const writeHandles = new Map<number, { fh: Awaited<ReturnType<typeof fsp.open>>; path: string; partial: string }>();
let nextWriteHandle = 1;

function notifyRecentsChanged() {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('recents:changed');
}

const moduleWindows = new Map<string, BrowserWindow>();

function openModuleWindow(id: string, projectPath: string) {
  if (!listInstalled()[id]) throw new Error(`This app is not installed yet. Install it from the Apps page.`);
  const key = `${id}:${projectPath}`;
  const existing = moduleWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return;
  }
  const win = createWindow(`omega-module://${id}/index.html?project=${encodeURIComponent(projectPath)}`);
  moduleWindows.set(key, win);
  win.on('closed', () => moduleWindows.delete(key));
}

// Crash-safe save: write to a temp file, then rename over the target.
async function atomicWrite(filePath: string, contents: string) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, contents, 'utf8');
  await fsp.rename(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

app.setName('Omega');
// WebGL must work on machines without a usable GPU (VMs, remote desktops, CI):
// allow Chromium's software rasterizer as a fallback. Content is local and trusted.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

// Permissions (microphone for voiceover recording, etc.): granted to the
// app's own pages only (hub, installed modules, dev server), never to
// anything else that might end up in a window.
function isAppUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('omega-module:') || url.startsWith('file:')) return true;
  try {
    return !!process.env.VITE_DEV_SERVER_URL && new URL(url).origin === new URL(process.env.VITE_DEV_SERVER_URL).origin;
  } catch {
    return false;
  }
}

function installPermissionHandlers() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (!isAppUrl(details.requestingUrl || wc.getURL())) return callback(false);
    const wantsMic = permission === 'media' && (details as { mediaTypes?: string[] }).mediaTypes?.includes('audio');
    if (wantsMic && process.platform === 'darwin') {
      systemPreferences.askForMediaAccess('microphone').then(callback, () => callback(false));
      return;
    }
    callback(true);
  });
  ses.setPermissionCheckHandler((_wc, _permission, requestingOrigin) => isAppUrl(requestingOrigin));
}

app.whenReady().then(() => {
  protocol.handle('omega-media', serveMedia);
  protocol.handle('omega-module', serveModule);
  installPermissionHandlers();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
