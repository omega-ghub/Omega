import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  UrlSource,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import type { ExportPreset } from '../state/presets';
import type { Clip, MediaAsset, Project, Track } from '../state/types';

// Offline export. Decodes every source with WebCodecs (through Mediabunny),
// composites each frame onto an OffscreenCanvas, mixes audio with an
// OfflineAudioContext, and encodes with the first codec the machine supports
// (hardware encoders are used automatically when the OS exposes them).

export interface ExportJob {
  preset: ExportPreset;
  width: number;
  height: number;
  fps: number;
  start: number;
  end: number;
}

export interface ExportProgress {
  phase: 'preparing' | 'audio' | 'video' | 'finalizing' | 'done';
  fraction: number; // 0..1
  detail?: string;
}

export interface ExportResult {
  buffer: ArrayBuffer;
  videoCodec: string;
  audioCodec: string | null;
  extension: string;
}

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
  }
}

/** Sequential frame reader for one clip: timeline time in, frame canvas out. */
class ClipFrameReader {
  private iterator: AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number; duration: number }, void, unknown> | null = null;
  private current: { canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number; duration: number } | null = null;
  private next: { canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number; duration: number } | null = null;
  private done = false;

  constructor(private sink: CanvasSink, private clip: Clip) {}

  async frameAt(sourceTime: number) {
    if (!this.iterator) {
      this.iterator = this.sink.canvases(this.clip.inPoint, this.clip.inPoint + this.clip.duration + 1);
      await this.advance();
    }
    // advance while the next frame starts at or before the requested time
    while (!this.done && this.next && this.next.timestamp <= sourceTime + 1e-4) {
      await this.advance();
    }
    return this.current?.canvas ?? null;
  }

  private async advance() {
    if (!this.iterator) return;
    if (this.next) this.current = this.next;
    const r = await this.iterator.next();
    if (r.done) {
      this.done = true;
      this.next = null;
      if (!this.current) this.current = null;
    } else {
      this.next = r.value;
      if (!this.current) {
        this.current = r.value;
        // pull one more so `next` is really the following frame
        const r2 = await this.iterator.next();
        if (r2.done) {
          this.done = true;
          this.next = null;
        } else this.next = r2.value;
      }
    }
  }

  async close() {
    await this.iterator?.return(undefined);
  }
}

export async function exportSequence(
  project: Project,
  job: ExportJob,
  onProgress: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<ExportResult> {
  const { preset, width, height, fps } = job;
  const duration = Math.max(0, job.end - job.start);
  if (duration <= 0) throw new Error('Nothing to export: the sequence is empty.');
  const check = () => {
    if (signal?.aborted) throw new ExportCancelled();
  };

  onProgress({ phase: 'preparing', fraction: 0 });

  const videoCodec = await getFirstEncodableVideoCodec(preset.videoCodecs, { width, height });
  if (!videoCodec) throw new Error('No supported video encoder found on this machine for this preset.');
  const sampleRate = project.settings.sampleRate;
  const audioCodec = await getFirstEncodableAudioCodec(preset.audioCodecs, { numberOfChannels: 2, sampleRate });

  const format = preset.container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' });
  const target = new BufferTarget();
  const output = new Output({ format, target });

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const bitrate = Math.round(preset.bitrateMbps(height, fps) * 1_000_000);
  const videoSource = new CanvasSource(canvas, { codec: videoCodec, bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: fps });

  // ---- audio mixdown ------------------------------------------------------
  let audioSource: AudioBufferSource | null = null;
  const audioClips = clipsWithAudio(project, job.start, job.end);
  if (audioCodec && audioClips.length > 0) {
    onProgress({ phase: 'audio', fraction: 0 });
    const mixed = await mixAudio(project, audioClips, job, sampleRate, (f) => onProgress({ phase: 'audio', fraction: f }), signal);
    audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: preset.audioKbps * 1000 });
    output.addAudioTrack(audioSource);
    await output.start();
    await audioSource.add(mixed);
    audioSource.close();
  } else {
    await output.start();
  }

  // ---- video frames -------------------------------------------------------
  const videoTracks = project.sequence.tracks.filter((t) => t.kind === 'video' && !t.muted);
  const readers = new Map<string, ClipFrameReader>();
  const images = new Map<string, ImageBitmap>();
  const inputs: Input[] = [];
  const assetOf = (c: Clip) => project.assets.find((a) => a.id === c.assetId);

  const prepareClip = async (clip: Clip) => {
    const asset = assetOf(clip);
    if (!asset || asset.offline) return;
    const url = window.omega.media.urlFor(asset.path);
    if (asset.kind === 'image') {
      if (!images.has(asset.id)) {
        const blob = await (await fetch(url)).blob();
        images.set(asset.id, await createImageBitmap(blob));
      }
      return;
    }
    if (!asset.hasVideo) return;
    const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
    inputs.push(input);
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return;
    const sink = new CanvasSink(track, { width, height, fit: 'contain' });
    readers.set(clip.id, new ClipFrameReader(sink, clip));
  };

  try {
    const totalFrames = Math.max(1, Math.round(duration * fps));
    const frameDuration = 1 / fps;
    let lastReport = 0;
    for (let i = 0; i < totalFrames; i++) {
      check();
      const t = job.start + i * frameDuration;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      for (let ti = videoTracks.length - 1; ti >= 0; ti--) {
        const track = videoTracks[ti];
        const clip = track.clips.find((c) => t >= c.start && t < c.start + c.duration);
        if (!clip) continue;
        const asset = assetOf(clip);
        if (!asset) continue;
        if (!readers.has(clip.id) && !images.has(asset.id)) await prepareClip(clip);
        ctx.globalAlpha = clip.opacity ?? 1;
        if (asset.kind === 'image') {
          const bmp = images.get(asset.id);
          if (bmp) drawContain(ctx, bmp, bmp.width, bmp.height, width, height);
        } else {
          const reader = readers.get(clip.id);
          const frame = await reader?.frameAt(clip.inPoint + (t - clip.start));
          if (frame) ctx.drawImage(frame, 0, 0, width, height);
        }
        ctx.globalAlpha = 1;
      }
      await videoSource.add(i * frameDuration, frameDuration);
      // release readers for clips that have finished
      for (const [id, reader] of readers) {
        const clip = findClip(project, id);
        if (!clip || t >= clip.start + clip.duration) {
          await reader.close();
          readers.delete(id);
        }
      }
      const now = performance.now();
      if (now - lastReport > 100 || i === totalFrames - 1) {
        lastReport = now;
        onProgress({ phase: 'video', fraction: (i + 1) / totalFrames, detail: `Frame ${i + 1} of ${totalFrames}` });
      }
    }
    videoSource.close();
    onProgress({ phase: 'finalizing', fraction: 1 });
    await output.finalize();
  } catch (err) {
    try {
      await output.cancel();
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    for (const r of readers.values()) await r.close();
    for (const input of inputs) input.dispose();
    for (const bmp of images.values()) bmp.close();
  }

  const buffer = target.buffer;
  if (!buffer) throw new Error('Encoder produced no output.');
  onProgress({ phase: 'done', fraction: 1 });
  return { buffer, videoCodec, audioCodec, extension: preset.container };
}

function drawContain(ctx: OffscreenCanvasRenderingContext2D, img: CanvasImageSource, sw: number, sh: number, w: number, h: number) {
  const scale = Math.min(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function findClip(project: Project, id: string): Clip | undefined {
  for (const t of project.sequence.tracks) {
    const c = t.clips.find((x) => x.id === id);
    if (c) return c;
  }
  return undefined;
}

function clipsWithAudio(project: Project, start: number, end: number): { clip: Clip; track: Track; asset: MediaAsset }[] {
  const out: { clip: Clip; track: Track; asset: MediaAsset }[] = [];
  for (const track of project.sequence.tracks) {
    if (track.kind !== 'audio' || track.muted) continue;
    for (const clip of track.clips) {
      const asset = project.assets.find((a) => a.id === clip.assetId);
      if (!asset || asset.offline || !asset.hasAudio) continue;
      if (clip.start + clip.duration <= start || clip.start >= end) continue;
      out.push({ clip, track, asset });
    }
  }
  return out;
}

async function mixAudio(
  _project: Project,
  items: { clip: Clip; track: Track; asset: MediaAsset }[],
  job: ExportJob,
  sampleRate: number,
  onProgress: (f: number) => void,
  signal?: AbortSignal,
): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil((job.end - job.start) * sampleRate));
  const offline = new OfflineAudioContext(2, length, sampleRate);
  let done = 0;
  for (const { clip, asset } of items) {
    if (signal?.aborted) throw new ExportCancelled();
    const url = window.omega.media.urlFor(asset.path);
    const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track || !(await track.canDecode())) continue;
      const sink = new AudioBufferSink(track);
      const gainNode = offline.createGain();
      gainNode.gain.value = Math.pow(10, (clip.gain ?? 0) / 20);
      gainNode.connect(offline.destination);
      const clipEndSrc = clip.inPoint + clip.duration;
      for await (const { buffer, timestamp } of sink.buffers(clip.inPoint, clipEndSrc)) {
        if (signal?.aborted) throw new ExportCancelled();
        const bufStart = timestamp;
        const bufEnd = timestamp + buffer.duration;
        const srcFrom = Math.max(bufStart, clip.inPoint);
        const srcTo = Math.min(bufEnd, clipEndSrc);
        if (srcTo <= srcFrom) continue;
        const when = clip.start + (srcFrom - clip.inPoint) - job.start;
        const offset = srcFrom - bufStart;
        const dur = srcTo - srcFrom;
        if (when + dur <= 0 || when >= job.end - job.start) continue;
        const node = offline.createBufferSource();
        node.buffer = buffer;
        node.connect(gainNode);
        if (when < 0) node.start(0, offset - when, dur + when);
        else node.start(when, offset, dur);
      }
    } finally {
      input.dispose();
    }
    done++;
    onProgress(done / items.length);
  }
  return offline.startRendering();
}
