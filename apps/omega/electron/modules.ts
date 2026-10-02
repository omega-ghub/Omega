// Module manager: workspaces (Video, Audio, ...) are not bundled with the hub.
// Each is a separate package (a zip of a self-contained web app) that is
// downloaded from a catalog, verified by SHA-256, and unpacked into the user's
// data folder. The hub then opens it in its own window through the
// omega-module:// protocol.

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import type { CatalogModule, CatalogResult, InstalledMap } from './api';

const DEFAULT_CATALOG_URL = 'https://github.com/omega-ghub/Omega/releases/latest/download/catalog.json';

export function modulesRoot() {
  return path.join(app.getPath('userData'), 'modules');
}

export function catalogUrl(): string {
  if (process.env.OMEGA_CATALOG_URL) return process.env.OMEGA_CATALOG_URL;
  if (!app.isPackaged) {
    // Running from source: use the catalog produced by `npm run build:modules`.
    const local = path.join(app.getAppPath(), 'dist-modules', 'catalog.json');
    if (fs.existsSync(local)) return pathToFileURL(local).href;
  }
  return DEFAULT_CATALOG_URL;
}

async function readBytes(url: URL, onProgress?: (fraction: number) => void): Promise<Buffer> {
  if (url.protocol === 'file:') {
    const buf = await fsp.readFile(fileURLToPath(url));
    onProgress?.(1);
    return buf;
  }
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length') || 0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    received += value.length;
    if (total) onProgress?.(Math.min(0.99, received / total));
  }
  onProgress?.(1);
  return Buffer.concat(chunks);
}

export async function loadCatalog(): Promise<CatalogResult> {
  const source = catalogUrl();
  try {
    const json = JSON.parse((await readBytes(new URL(source))).toString('utf8'));
    return { ok: true, source, modules: Array.isArray(json.modules) ? json.modules : [] };
  } catch (err) {
    return { ok: false, source, modules: [], error: `Could not reach the app catalog (${(err as Error).message})` };
  }
}

export function listInstalled(): InstalledMap {
  const out: InstalledMap = {};
  const root = modulesRoot();
  if (!fs.existsSync(root)) return out;
  for (const id of fs.readdirSync(root)) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(root, id, 'installed.json'), 'utf8'));
      if (meta.version && fs.existsSync(path.join(root, id, meta.version, 'index.html'))) out[id] = { version: meta.version };
    } catch {
      /* not a module folder */
    }
  }
  return out;
}

export async function installModule(id: string, onProgress: (fraction: number) => void): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid app id');
  const catalog = await loadCatalog();
  if (!catalog.ok) throw new Error(catalog.error);
  const entry: CatalogModule | undefined = catalog.modules.find((m) => m.id === id);
  if (!entry) throw new Error(`"${id}" is not in the app catalog`);

  // Download (0–90%), verify, unpack (90–100%).
  const url = new URL(entry.url, catalog.source);
  const zip = await readBytes(url, (f) => onProgress(f * 0.9));
  const digest = crypto.createHash('sha256').update(zip).digest('hex');
  if (digest !== entry.sha256.toLowerCase()) throw new Error('The download failed its integrity check, so it was discarded.');

  const files = unzipSync(new Uint8Array(zip));
  if (!files['index.html'] || !files['manifest.json']) throw new Error('The app package is incomplete.');
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'));
  if (manifest.id !== id) throw new Error('The app package does not match what was requested.');

  const base = path.join(modulesRoot(), id);
  const dest = path.join(base, entry.version);
  const staging = path.join(base, `.staging-${process.pid}`);
  await fsp.rm(staging, { recursive: true, force: true });
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    const target = path.resolve(staging, name);
    if (!target.startsWith(staging + path.sep)) throw new Error('The app package contains an unsafe path.');
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, data);
  }
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.rename(staging, dest);
  await fsp.writeFile(path.join(base, 'installed.json'), JSON.stringify({ version: entry.version, installedAt: Date.now() }));
  // drop older versions
  for (const name of await fsp.readdir(base)) {
    if (name !== entry.version && name !== 'installed.json') await fsp.rm(path.join(base, name), { recursive: true, force: true });
  }
  onProgress(1);
}

export async function uninstallModule(id: string): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid app id');
  await fsp.rm(path.join(modulesRoot(), id), { recursive: true, force: true });
}

const MODULE_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

/** Serves omega-module://<id>/<path> from the installed package. */
export async function serveModule(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.hostname;
  const installed = listInstalled()[id];
  if (!installed) return new Response('Not installed', { status: 404 });
  const root = path.join(modulesRoot(), id, installed.version);
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const target = path.resolve(root, rel);
  if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
  try {
    const data = await fsp.readFile(target);
    return new Response(data, { headers: { 'Content-Type': MODULE_MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
