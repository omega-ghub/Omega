import { app, BrowserWindow, ipcMain, dialog, protocol, shell, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { AppInfo, MediaFileInfo, RecentProject } from './api';

// ---------------------------------------------------------------------------
// Media streaming protocol
// ---------------------------------------------------------------------------
// Media is served from disk through a privileged scheme (omega-media://) with
// HTTP range support so <video> elements and Mediabunny can seek efficiently.
// Nothing is ever uploaded anywhere: this is purely local.

protocol.registerSchemesAsPrivileged([
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

function createWindow() {
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

  if (isDev) {
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

  ipcMain.handle('recents:list', () => readRecents());
  ipcMain.handle('recents:add', async (_e, entry: RecentProject) => {
    const list = (await readRecents()).filter((r) => r.path !== entry.path);
    list.unshift(entry);
    await writeRecents(list.slice(0, 30));
  });
  ipcMain.handle('recents:remove', async (_e, p: string) => {
    await writeRecents((await readRecents()).filter((r) => r.path !== p));
  });

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

app.whenReady().then(() => {
  protocol.handle('omega-media', serveMedia);
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
