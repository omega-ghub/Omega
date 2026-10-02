// Pure helpers shared by the media engine (probe, decode, thumbnails,
// proxies). No DOM, no Mediabunny: everything here is unit-tested in Node.

import type { InputTransform, MediaAsset } from '../../state/types';

export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'] as const;
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus'] as const;
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'] as const;
export const LUT_EXTENSIONS = ['cube'] as const;
export const CAPTION_EXTENSIONS = ['srt', 'vtt'] as const;
export const MEDIA_EXTENSIONS: readonly string[] = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS];
/** Everything importPaths accepts. */
export const IMPORT_EXTENSIONS: readonly string[] = [...MEDIA_EXTENSIONS, ...LUT_EXTENSIONS, ...CAPTION_EXTENSIONS];

/** Lower-case extension without the dot ('' when there is none). */
export function extOf(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** File name without its extension. */
export function stem(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(0, i) : base;
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i > 0 ? path.slice(0, i) : i === 0 ? path.slice(0, 1) : '';
}

/** Joins with the separator style the base path already uses. */
export function joinPath(dir: string, ...parts: string[]): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return [dir.replace(/[\\/]+$/, ''), ...parts.map((p) => p.replace(/^[\\/]+|[\\/]+$/g, ''))].join(sep);
}

export type ImportRoute = 'media' | 'lut' | 'caption' | 'unsupported';

export function routeForPath(path: string): ImportRoute {
  const ext = extOf(path);
  if ((LUT_EXTENSIONS as readonly string[]).includes(ext)) return 'lut';
  if ((CAPTION_EXTENSIONS as readonly string[]).includes(ext)) return 'caption';
  if (MEDIA_EXTENSIONS.includes(ext)) return 'media';
  return 'unsupported';
}

// ---------------------------------------------------------------------------
// Frame rates
// ---------------------------------------------------------------------------

const KNOWN_RATES = [23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60, 72, 90, 96, 100, 119.88, 120, 144, 240];

/** Snaps a measured rate to the nearest broadcast/cinema rate when it is close. */
export function snapFps(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  let best = rate;
  let bestDiff = Infinity;
  for (const k of KNOWN_RATES) {
    const d = Math.abs(k - rate);
    if (d < bestDiff) {
      bestDiff = d;
      best = k;
    }
  }
  // within 0.5% of a known rate → that rate; otherwise keep 2 decimals
  return bestDiff <= best * 0.005 ? best : Math.round(rate * 100) / 100;
}

/** Drop-frame timecode is the convention for 29.97 and 59.94 only. */
export function defaultDropFrame(fps: number): boolean {
  return Math.abs(fps - 29.97) < 0.01 || Math.abs(fps - 59.94) < 0.01;
}

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

/** Maps a WebCodecs transfer characteristic to an input transform ('auto' = leave as is). */
export function transferToInputTransform(transfer: string | null | undefined): InputTransform {
  switch (transfer) {
    case 'pq':
    case 'smpte2084':
      return 'pq';
    case 'hlg':
    case 'arib-std-b67':
      return 'hlg';
    default:
      return 'auto';
  }
}

const LOG_TRANSFORMS: InputTransform[] = ['slog3', 'logc3', 'vlog', 'clog3', 'flog'];

export function isLogTransform(t: InputTransform): boolean {
  return LOG_TRANSFORMS.includes(t);
}

export function isHdrTransform(t: InputTransform): boolean {
  return t === 'pq' || t === 'hlg';
}

export const INPUT_TRANSFORM_LABELS: Record<InputTransform, string> = {
  auto: 'Auto (Rec.709)',
  rec709: 'Rec.709',
  srgb: 'sRGB',
  linear: 'Linear',
  slog3: 'Sony S-Log3',
  logc3: 'ARRI LogC3',
  vlog: 'Panasonic V-Log',
  clog3: 'Canon Log 3',
  flog: 'Fujifilm F-Log',
  hlg: 'HLG (BT.2100)',
  pq: 'PQ (ST 2084)',
};

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

/** Largest size with the same aspect that fits in maxW × maxH (never upscales). Even when `even`. */
export function fitWithin(w: number, h: number, maxW?: number, maxH?: number, even = false): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: Math.max(1, Math.round(maxW ?? 1)), height: Math.max(1, Math.round(maxH ?? 1)) };
  let s = 1;
  if (maxW && maxW > 0) s = Math.min(s, maxW / w);
  if (maxH && maxH > 0) s = Math.min(s, maxH / h);
  let width = Math.max(1, Math.round(w * s));
  let height = Math.max(1, Math.round(h * s));
  if (even) {
    width = Math.max(2, Math.round(width / 2) * 2);
    height = Math.max(2, Math.round(height / 2) * 2);
  }
  return { width, height };
}

/** Proxy frame size: the long side becomes `longSide` (1280 or 960), even dimensions. */
export function proxyDims(w: number, h: number, longSide = 1280): { width: number; height: number } {
  return fitWithin(w, h, w >= h ? longSide : undefined, w >= h ? undefined : longSide, true);
}

/** A sensible proxy bitrate: ~0.09 bits per pixel per frame, clamped to 1.5–8 Mb/s. */
export function proxyBitrate(width: number, height: number, fps: number): number {
  const rate = width * height * (fps > 0 ? fps : 30) * 0.09;
  return Math.round(Math.min(8_000_000, Math.max(1_500_000, rate)));
}

/** Whether to suggest proxies for this asset (UHD/DCI 4K and above, or high-frame-rate QHD+). */
export function wantsProxy(a: Pick<MediaAsset, 'kind' | 'width' | 'height' | 'fps'>): boolean {
  if (a.kind !== 'video' || !a.width || !a.height) return false;
  const long = Math.max(a.width, a.height);
  if (long >= 3840) return true;
  return (a.fps ?? 0) >= 50 && a.width * a.height >= 2560 * 1440;
}

export function is4k(a: Pick<MediaAsset, 'width' | 'height'>): boolean {
  return Math.max(a.width ?? 0, a.height ?? 0) >= 3840;
}

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------

/** Seconds between cached thumbnails of an asset: ≥ 1 frame, ≤ 2 s, ~240 per asset. */
export function thumbnailStep(a: Pick<MediaAsset, 'duration' | 'fps'>): number {
  const frame = 1 / (a.fps && a.fps > 0 ? a.fps : 30);
  const wanted = Math.min(2, Math.max(0, a.duration) / 240);
  return Math.max(frame, Math.ceil(wanted / frame) * frame);
}

/** Thumbnail slot index for a time. */
export function thumbSlot(time: number, step: number): number {
  return Math.max(0, Math.floor(time / step + 1e-6));
}

/** Time decoded for a slot: the slot start nudged a hair forward so we land inside the frame. */
export function slotTime(slot: number, step: number, duration: number): number {
  const t = slot * step + 1e-4;
  return Math.max(0, Math.min(t, Math.max(0, duration - 1e-3)));
}

/** Frame index used for exact-frame cache keys. */
export function frameIndex(time: number, fps: number | undefined): number {
  if (!fps || fps <= 0) return Math.round(time * 1000);
  return Math.floor(time * exactFps(fps) + 1e-4);
}

function exactFps(fps: number): number {
  for (const [nominal, exact] of [
    [23.976, 24000 / 1001],
    [29.97, 30000 / 1001],
    [47.952, 48000 / 1001],
    [59.94, 60000 / 1001],
    [119.88, 120000 / 1001],
  ] as const) {
    if (Math.abs(fps - nominal) < 0.01) return exact;
  }
  return fps;
}

/** Runs async tasks with a concurrency limit, preserving result order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/** Rejects with `message` if the promise takes longer than `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}
