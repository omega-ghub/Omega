// Opening media files through Mediabunny over the omega-media:// scheme.
import { ALL_FORMATS, Input, UrlSource } from 'mediabunny';
import type { MediaAsset } from '../../state/types';

const MiB = 1024 * 1024;

/** URL the renderer streams a path from (works in tests without Electron too). */
export function urlForPath(path: string): string {
  if (typeof window !== 'undefined' && window.omega?.media?.urlFor) return window.omega.media.urlFor(path);
  return `omega-media://local/${encodeURIComponent(path)}`;
}

/**
 * Opens a Mediabunny Input on a local file. Failed requests are retried twice
 * and then given up on, so a file that vanished mid-session fails fast instead
 * of retrying forever.
 */
export function openInput(path: string, cacheMiB = 16): Input<UrlSource> {
  const source = new UrlSource(urlForPath(path), {
    maxCacheSize: cacheMiB * MiB,
    parallelism: 2,
    getRetryDelay: (attempts) => (attempts < 2 ? 0.2 * (attempts + 1) : null),
    handleUnhandledError: (err) => console.warn('[media] read error', path, err),
  });
  return new Input({ source, formats: ALL_FORMATS });
}

/** The file to read for an asset: the proxy when asked for and ready, else the original. */
export function sourcePathFor(asset: MediaAsset, useProxy?: boolean): { path: string; proxy: boolean } {
  if (useProxy && asset.proxyStatus === 'ready' && asset.proxyPath) return { path: asset.proxyPath, proxy: true };
  return { path: asset.path, proxy: false };
}

/** File size in bytes via a HEAD request (falls back to a 1-byte range request). */
export async function fileSize(path: string): Promise<number | undefined> {
  const url = urlForPath(path);
  try {
    const res = await fetch(url, { method: 'HEAD' });
    void res.body?.cancel().catch(() => {});
    if (res.status === 404) return undefined;
    const len = Number(res.headers.get('content-length'));
    if (res.ok && Number.isFinite(len) && len > 0) return len;
  } catch {
    /* fall through to a range request */
  }
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    void res.body?.cancel().catch(() => {});
    const total = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')?.[1];
    if (total) return Number(total);
    const len = Number(res.headers.get('content-length'));
    return res.status === 200 && len > 0 ? len : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a file exists (through the main process). */
export async function fileExists(path: string): Promise<boolean> {
  try {
    return await window.omega.media.exists(path);
  } catch {
    return false;
  }
}

/** Loads an image element (crossOrigin so canvases do not taint). */
export function loadImage(path: string, timeoutMs = 20_000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const id = setTimeout(() => {
      img.src = '';
      reject(new Error('Timed out loading the image'));
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(id);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(id);
      reject(new Error('The image could not be decoded'));
    };
    img.src = urlForPath(path);
  });
}

/** Intrinsic size of an image; SVGs without one get 1920×1080. */
export function imageSize(img: HTMLImageElement): { width: number; height: number } {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (width > 0 && height > 0) return { width, height };
  return { width: 1920, height: 1080 };
}
