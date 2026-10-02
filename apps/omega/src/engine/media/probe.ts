// Media probing (v2). OWNED BY THE MEDIA PACKAGE.
//
// Reads everything the editor needs from a file without decoding pictures:
// codecs, display size (rotation applied), frame rate from packet timing,
// duration, channels / sample rate, HDR transfer, and the file size.
// Mediabunny first; an HTMLMediaElement as the fallback for containers it
// cannot parse. probeFile() never throws: corrupt or unsupported files come
// back as { ok: false, error } with a message fit for the UI.

import { UnsupportedInputFormatError } from 'mediabunny';
import { makeAsset } from '../../state/defaults';
import type { AssetKind, InputTransform, MediaAsset } from '../../state/types';
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, basename, codecLabel, extOf, snapFps, transferToInputTransform, withTimeout } from './mediaMath';
import { fileExists, fileSize, imageSize, loadImage, openInput, urlForPath } from './source';

export { MEDIA_EXTENSIONS, IMPORT_EXTENSIONS, codecLabel } from './mediaMath';

/** Seconds a still image occupies when placed without settings (project.settings.stillDuration wins). */
export const STILL_DURATION = 5;

export function kindForPath(p: string): AssetKind {
  const ext = extOf(p);
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'image';
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return 'audio';
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return 'video';
  return 'video';
}

export interface ProbeOk {
  ok: true;
  asset: MediaAsset;
  /** Non-fatal problems, e.g. a codec this system cannot decode. */
  warnings: string[];
}

export interface ProbeFail {
  ok: false;
  path: string;
  name: string;
  error: string;
}

export type ProbeResult = ProbeOk | ProbeFail;

export class MediaProbeError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = 'MediaProbeError';
  }
}

const PROBE_TIMEOUT_MS = 45_000;

/** Probes a file. Never throws. */
export async function probeFile(path: string, opts: { name?: string; size?: number } = {}): Promise<ProbeResult> {
  const name = opts.name ?? basename(path);
  try {
    return await withTimeout(probeInner(path, name, opts.size), PROBE_TIMEOUT_MS, 'Timed out while reading the file');
  } catch (err) {
    return { ok: false, path, name, error: describeError(err) };
  }
}

/**
 * Reads the metadata of a media file as a new asset. Rejects with a
 * MediaProbeError (clear, user-facing message) if the file cannot be used.
 */
export async function probeMedia(path: string, name: string): Promise<MediaAsset> {
  const r = await probeFile(path, { name });
  if (!r.ok) throw new MediaProbeError(r.error, path);
  return r.asset;
}

async function probeInner(path: string, name: string, knownSize?: number): Promise<ProbeResult> {
  const fail = (error: string): ProbeFail => ({ ok: false, path, name, error });
  const kind = kindForPath(path);
  const size = knownSize ?? (await fileSize(path));
  if (size === undefined && !(await fileExists(path))) return fail('File not found');
  if (size === 0) return fail('The file is empty');

  if (kind === 'image') {
    const img = await loadImage(path);
    const { width, height } = imageSize(img);
    img.src = '';
    const ext = extOf(path);
    return {
      ok: true,
      warnings: [],
      asset: makeAsset({ name, path, kind: 'image', duration: STILL_DURATION, width, height, hasAudio: false, hasVideo: true, size, codec: ext === 'jpg' ? 'jpeg' : ext }),
    };
  }

  let firstError: unknown = null;
  try {
    const r = await probeWithMediabunny(path, name, size);
    if (r) return r;
  } catch (err) {
    firstError = err;
    console.warn('[media] Mediabunny could not read', name, err);
  }
  try {
    return await probeWithElement(path, name, kind, size);
  } catch (err) {
    return fail(describeError(firstError ?? err));
  }
}

async function probeWithMediabunny(path: string, name: string, size: number | undefined): Promise<ProbeResult | null> {
  const input = openInput(path, 8);
  try {
    if (!(await input.canRead())) return null;
    const warnings: string[] = [];
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();

    let hasVideo = false;
    let codec: string | undefined;
    let width: number | undefined;
    let height: number | undefined;
    let fps: number | undefined;
    let inputTransform: InputTransform = 'auto';
    if (video) {
      const vc = await video.getCodec().catch(() => null);
      // Tracks with codecs Mediabunny does not know (e.g. MJPEG cover art) are ignored.
      if (vc) {
        hasVideo = true;
        codec = vc;
        width = await video.getDisplayWidth();
        height = await video.getDisplayHeight();
        fps = await measureFps(video);
        try {
          const cs = await video.getColorSpace();
          inputTransform = transferToInputTransform(cs?.transfer);
        } catch {
          /* no color info */
        }
        if (!(await video.canDecode().catch(() => false))) warnings.push(`${codecLabel(vc)} video cannot be decoded on this system`);
      }
    }

    let hasAudio = false;
    let audioCodec: string | undefined;
    let channels: number | undefined;
    let sampleRate: number | undefined;
    if (audio) {
      const ac = await audio.getCodec().catch(() => null);
      channels = await audio.getNumberOfChannels().catch(() => undefined);
      sampleRate = await audio.getSampleRate().catch(() => undefined);
      audioCodec = ac ?? undefined;
      if (ac && (await audio.canDecode().catch(() => false))) hasAudio = true;
      else warnings.push(`${ac ? codecLabel(ac) : 'Unknown'} audio cannot be decoded on this system`);
    }

    if (!hasVideo && !hasAudio) {
      return { ok: false, path, name, error: video || audio ? 'No decodable audio or video in this file' : 'No audio or video tracks found' };
    }

    let duration = await withTimeout(input.computeDuration(), 10_000, 'duration').catch(() => null);
    if (duration === null || !Number.isFinite(duration) || duration <= 0) {
      duration = (await input.getDurationFromMetadata().catch(() => null)) ?? 0;
    }
    if (!(duration > 0)) return { ok: false, path, name, error: 'The file has no playable duration' };

    return {
      ok: true,
      warnings,
      asset: makeAsset({
        name,
        path,
        kind: hasVideo ? 'video' : 'audio',
        duration,
        width,
        height,
        fps,
        codec,
        audioCodec,
        channels: hasAudio || audio ? channels : undefined,
        sampleRate: hasAudio || audio ? sampleRate : undefined,
        size,
        hasAudio,
        hasVideo,
        inputTransform,
      }),
    };
  } finally {
    input.dispose();
  }
}

type VideoTrackLike = {
  computeFrameRateMetrics?: (o?: { targetPacketCount?: number }) => Promise<{ bestGuessFrameRate: number }>;
  computePacketStats: (n?: number) => Promise<{ averagePacketRate: number }>;
};

async function measureFps(video: VideoTrackLike): Promise<number | undefined> {
  try {
    if (video.computeFrameRateMetrics) {
      const m = await video.computeFrameRateMetrics({ targetPacketCount: 256 });
      const r = snapFps(m.bestGuessFrameRate);
      if (r > 0) return r;
    }
  } catch {
    /* fall back to packet stats */
  }
  try {
    const stats = await video.computePacketStats(120);
    const r = snapFps(stats.averagePacketRate);
    return r > 0 ? r : undefined;
  } catch {
    return undefined;
  }
}

function probeWithElement(path: string, name: string, kind: AssetKind, size: number | undefined): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video') as HTMLVideoElement;
    el.crossOrigin = 'anonymous';
    el.preload = 'metadata';
    el.muted = true;
    const cleanup = () => {
      clearTimeout(timer);
      el.onloadedmetadata = null;
      el.onerror = null;
      el.removeAttribute('src');
      el.load();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out while reading the file'));
    }, 15_000);
    el.onloadedmetadata = () => {
      const hasVideo = kind === 'video' && el.videoWidth > 0;
      const duration = Number.isFinite(el.duration) ? el.duration : 0;
      const result: ProbeResult =
        duration > 0
          ? {
              ok: true,
              warnings: ['Read with the fallback decoder; frame-accurate decoding may not be available'],
              asset: makeAsset({
                name,
                path,
                kind: hasVideo ? 'video' : 'audio',
                duration,
                width: hasVideo ? el.videoWidth : undefined,
                height: hasVideo ? el.videoHeight : undefined,
                size,
                hasAudio: true, // an element cannot tell; assume yes
                hasVideo,
              }),
            }
          : { ok: false, path, name, error: 'The file has no playable duration' };
      cleanup();
      resolve(result);
    };
    el.onerror = () => {
      cleanup();
      reject(new Error('Unsupported or damaged media file'));
    };
    el.src = urlForPath(path);
  });
}

function describeError(err: unknown): string {
  if (err instanceof UnsupportedInputFormatError) return 'Unsupported file format';
  const msg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  if (/unsupported|not supported|format/i.test(msg) && !/timed out/i.test(msg)) return 'Unsupported or damaged media file';
  if (/404|not found/i.test(msg)) return 'File not found';
  return msg || 'Unknown error';
}
