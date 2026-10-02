import { ALL_FORMATS, Input, UrlSource } from 'mediabunny';
import type { AssetKind, MediaAsset } from '../state/types';
import { newId } from '../state/types';

const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg']);

export const STILL_DURATION = 5; // seconds a still image occupies when added to a timeline

export function kindForPath(p: string): AssetKind {
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (VIDEO_EXT.has(ext)) return 'video';
  return 'video';
}

/**
 * Reads the metadata the editor needs from a media file. Tries Mediabunny
 * first (fast, accurate, no decoding) and falls back to an HTMLMediaElement.
 */
export async function probeMedia(path: string, name: string): Promise<MediaAsset> {
  const url = window.omega.media.urlFor(path);
  const kind = kindForPath(path);

  if (kind === 'image') {
    const { width, height } = await loadImageSize(url);
    return { id: newId('asset'), name, path, kind, duration: STILL_DURATION, width, height, hasAudio: false, hasVideo: true };
  }

  try {
    const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
    try {
      const video = await input.getPrimaryVideoTrack();
      const audio = await input.getPrimaryAudioTrack();
      const duration = await input.computeDuration();
      let width: number | undefined;
      let height: number | undefined;
      let fps: number | undefined;
      let hasVideo = false;
      if (video && (await video.canDecode())) {
        hasVideo = true;
        width = await video.getDisplayWidth();
        height = await video.getDisplayHeight();
        const stats = await video.computePacketStats(120);
        fps = roundFps(stats.averagePacketRate);
      }
      const hasAudio = !!audio && (await audio.canDecode());
      return {
        id: newId('asset'),
        name,
        path,
        kind: hasVideo ? 'video' : 'audio',
        duration,
        width,
        height,
        fps,
        hasAudio,
        hasVideo,
      };
    } finally {
      input.dispose();
    }
  } catch (err) {
    console.warn('Mediabunny could not read', name, err);
    return probeWithElement(url, path, name, kind);
  }
}

function roundFps(rate: number): number {
  const known = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 120, 240];
  let best = rate;
  let bestDiff = Infinity;
  for (const k of known) {
    const d = Math.abs(k - rate);
    if (d < bestDiff) {
      bestDiff = d;
      best = k;
    }
  }
  return bestDiff < 0.3 ? best : Math.round(rate * 100) / 100;
}

function loadImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}

function probeWithElement(url: string, path: string, name: string, kind: AssetKind): Promise<MediaAsset> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video') as HTMLVideoElement;
    el.crossOrigin = 'anonymous';
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      const hasVideo = kind === 'video' && el.videoWidth > 0;
      resolve({
        id: newId('asset'),
        name,
        path,
        kind: hasVideo ? 'video' : 'audio',
        duration: Number.isFinite(el.duration) ? el.duration : 0,
        width: hasVideo ? el.videoWidth : undefined,
        height: hasVideo ? el.videoHeight : undefined,
        hasAudio: true, // cannot tell from the element; assume yes
        hasVideo,
      });
      el.removeAttribute('src');
      el.load();
    };
    el.onerror = () => reject(new Error(`Unsupported media: ${name}`));
    el.src = url;
  });
}
