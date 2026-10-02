// What this machine can encode (WebCodecs through Mediabunny). Results are
// cached per configuration; every check is wrapped so a missing API or an
// encoder that throws just reads as "not available".

import { canEncodeAudio, canEncodeVideo, Quality } from 'mediabunny';
import type { AudioCodecId, VideoCodecId } from './types';

export interface VideoCodecSupport {
  codec: VideoCodecId;
  available: boolean;
  /** true / false when the platform says; null when it can't be detected. */
  hardware: boolean | null;
}

const cache = new Map<string, Promise<boolean>>();

function cached(key: string, fn: () => Promise<boolean>): Promise<boolean> {
  let p = cache.get(key);
  if (!p) {
    p = fn().catch(() => false);
    cache.set(key, p);
  }
  return p;
}

export interface VideoProbe {
  width: number;
  height: number;
  fps?: number;
  kbps?: number;
}

/** True when `codec` can be encoded at this size (and bitrate, when given). */
export function canEncodeVideoAt(codec: VideoCodecId, o: VideoProbe): Promise<boolean> {
  const key = `v:${codec}:${o.width}x${o.height}:${Math.round(o.fps ?? 0)}:${o.kbps ?? 0}`;
  return cached(key, () =>
    canEncodeVideo(codec, {
      width: o.width,
      height: o.height,
      ...(o.fps ? { frameRate: o.fps } : {}),
      ...(o.kbps ? { quality: new Quality({ bitrate: o.kbps * 1000 }) } : {}),
    }),
  );
}

/** First codec of `prefs` that encodes at this size, or null. */
export async function firstEncodableVideo(prefs: VideoCodecId[], o: VideoProbe): Promise<VideoCodecId | null> {
  for (const c of prefs) if (await canEncodeVideoAt(c, o)) return c;
  return null;
}

/** Availability plus a hardware/software hint for each codec (Chromium treats 'prefer-hardware' as required in isConfigSupported). */
export async function probeVideoCodecs(codecs: VideoCodecId[], o: VideoProbe): Promise<VideoCodecSupport[]> {
  return Promise.all(
    codecs.map(async (codec) => {
      const available = await canEncodeVideoAt(codec, { width: o.width, height: o.height, fps: o.fps });
      if (!available) return { codec, available, hardware: null };
      const hw = await cached(`vh:${codec}:${o.width}x${o.height}`, () => canEncodeVideo(codec, { width: o.width, height: o.height, hardwareAcceleration: 'prefer-hardware' }));
      const sw = await cached(`vs:${codec}:${o.width}x${o.height}`, () => canEncodeVideo(codec, { width: o.width, height: o.height, hardwareAcceleration: 'prefer-software' }));
      // Only claim a kind when exactly one path answered; otherwise we can't tell.
      const hardware = hw && !sw ? true : sw && !hw ? false : hw && sw ? true : null;
      return { codec, available, hardware };
    }),
  );
}

export interface AudioProbe {
  sampleRate: number;
  channels: number;
  kbps?: number;
}

export function canEncodeAudioWith(codec: AudioCodecId, o: AudioProbe): Promise<boolean> {
  const key = `a:${codec}:${o.sampleRate}:${o.channels}:${o.kbps ?? 0}`;
  return cached(key, () =>
    canEncodeAudio(codec, {
      numberOfChannels: o.channels,
      sampleRate: o.sampleRate,
      ...(o.kbps && !codec.startsWith('pcm-') && codec !== 'flac' ? { quality: new Quality({ bitrate: o.kbps * 1000 }) } : {}),
    }),
  );
}

export async function firstEncodableAudio(prefs: AudioCodecId[], o: AudioProbe): Promise<AudioCodecId | null> {
  for (const c of prefs) if (await canEncodeAudioWith(c, o)) return c;
  return null;
}

export async function probeAudioCodecs(codecs: AudioCodecId[], o: AudioProbe): Promise<{ codec: AudioCodecId; available: boolean }[]> {
  return Promise.all(codecs.map(async (codec) => ({ codec, available: await canEncodeAudioWith(codec, o) })));
}
