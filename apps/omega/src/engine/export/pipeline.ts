// The export pipeline. One job renders one output (one sequence format):
//
//   preflight  planExport(): output size / rate / codecs / size estimate and
//              every problem we can find before spending minutes rendering
//              (offline media, missing LUTs, unencodable codecs, no decoder,
//              disk space, platform limits).
//   audio      AudioProgram: renderMix → optional loudness normalization →
//              sample-exact pieces, interleaved with video.
//   frames     for each output frame time: buildFrameGraph → decode its media
//              (ExportFrameProvider) → Renderer on an OffscreenCanvas at the
//              output size → CanvasSource (WebCodecs) → Mediabunny Output →
//              StreamTarget → positioned writes on disk.
//   sidecars   SRT / VTT captions and chapter lists next to the output.
//
// Image sequences and stills reuse the frame path and write PNGs; handoff
// files (EDL, OTIO, FCPXML, captions, chapters) come from the interchange and
// caption writers. Cancelling through the AbortSignal stops at the next frame
// and deletes the partial file.

import {
  AudioBufferSource,
  CanvasSource,
  FlacOutputFormat,
  MkvOutputFormat,
  MovOutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  Quality,
  WavOutputFormat,
  WebMOutputFormat,
  type AudioCodec,
  type OutputFormat,
  type VideoCodec,
} from 'mediabunny';
import { Renderer } from '../gpu/Renderer';
import { buildFrameGraph } from '../render/graph';
import { loadLut } from '../color/lut';
import { writeSrt, writeVtt } from '../captions/format';
import { exportChapters, exportEdl, exportFcpxml, exportOtio } from '../interchange';
import { formatTimecode } from '../time';
import type { Project, Sequence } from '../../state/types';
import { AudioProgram, type LoudnessReport } from './audio';
import { firstEncodableAudio, firstEncodableVideo, canEncodeVideoAt } from './codecs';
import { ExportFrameProvider, probeDecode, type DecodeMode } from './frameProvider';
import { baseName, joinPath, sequenceFrameName, stripExtension } from './naming';
import { estimateBytes, frameCount, frameTime, resolveFps, resolveOutputSize, resolveVideoKbps, sameAspect, type OutputSize } from './plan';
import { AUDIO_CODEC_LABEL, CONTAINER_AUDIO_CODECS, CONTAINER_VIDEO_CODECS, codecsForContainer, VIDEO_CODEC_LABEL } from './presets';
import type { AudioCodecId, ExportProgress, ExportSettings, HandoffFormat, PreflightIssue, PresetLimits, TimeRange, VideoCodecId } from './types';
import { rangeUsage, shiftedSequence, type RangeUsage } from './usage';
import { ExportCancelled, ExportFailed, errorMessage, exportDebug, isCancel, throwIfAborted, withTimeout, yieldToEventLoop } from './util';
import { openFileSink, type FileSink } from './writer';
import { formatBytesShort, formatClock } from './format';

export { ExportCancelled, ExportFailed } from './util';

export interface ExportJob {
  /** Display name (also the file's title tag). */
  name: string;
  project: Project;
  sequenceId: string;
  settings: ExportSettings;
  range: TimeRange;
  /** Alternate sequence format (multi-aspect), or null for the main format. */
  formatId: string | null;
  /** Output file, or the folder for an image sequence. */
  outputPath: string;
  presetName?: string;
  limits?: PresetLimits;
  /** The platform's expected codec; falling back to another is a warning. */
  expectsCodec?: VideoCodecId;
}

export interface ExportPlan {
  kind: ExportSettings['kind'];
  source: { width: number; height: number };
  size: OutputSize;
  fps: number;
  frames: number;
  duration: number;
  videoCodec: VideoCodecId | null;
  videoKbps: number;
  audioCodec: AudioCodecId | null;
  /** Audio track will be written. */
  audio: boolean;
  usage: RangeUsage | null;
  estimatedBytes: number;
  freeBytes: number | null;
  issues: PreflightIssue[];
  /** Per-asset decode path, from the deep preflight. */
  decode: Map<string, DecodeMode>;
}

export interface ExportResult {
  outputPath: string;
  /** Every file written (outputs and sidecars). */
  files: string[];
  bytes: number;
  videoCodec: VideoCodecId | null;
  audioCodec: AudioCodecId | null;
  width: number;
  height: number;
  fps: number;
  frames: number;
  duration: number;
  loudness: LoudnessReport | null;
  warnings: string[];
  log: string[];
}

export interface PlanOptions {
  /** Probe decoders for every used asset (slow; done right before rendering). */
  deep?: boolean;
  /** Query free disk space at the destination. */
  diskSpace?: boolean;
  signal?: AbortSignal;
}

const AUDIO_LOOKAHEAD = 2; // seconds of audio queued ahead of video
const ENCODE_TIMEOUT_MS = 120_000;
const YIELD_EVERY_MS = 40;

function sequenceOf(project: Project, id: string): Sequence {
  const seq = project.sequences.find((s) => s.id === id);
  if (!seq) throw new ExportFailed('The sequence to export no longer exists.');
  return seq;
}

function names(list: { name: string }[], max = 3): string {
  const shown = list.slice(0, max).map((a) => `"${a.name}"`);
  return list.length > max ? `${shown.join(', ')} and ${list.length - max} more` : shown.join(', ');
}

function aspectText(w: number, h: number): string {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(w, h);
  const a = w / d;
  const b = h / d;
  return a <= 32 && b <= 32 ? `${a}:${b}` : `${(w / h).toFixed(2)}:1`;
}

// ---------------------------------------------------------------------------
// Planning / preflight
// ---------------------------------------------------------------------------

export async function planExport(job: ExportJob, opts: PlanOptions = {}): Promise<ExportPlan> {
  const { project, settings, range } = job;
  const issues: PreflightIssue[] = [];
  const add = (level: PreflightIssue['level'], code: string, message: string) => issues.push({ level, code, message });
  const seq = sequenceOf(project, job.sequenceId);
  const format = job.formatId ? seq.formats.find((f) => f.id === job.formatId) : null;
  if (job.formatId && !format) add('error', 'format', 'The selected sequence format no longer exists.');
  const source = { width: format?.width ?? seq.width, height: format?.height ?? seq.height };
  const kind = settings.kind;
  const duration = Math.max(0, range.end - range.start);
  const plan: ExportPlan = {
    kind,
    source,
    size: { width: 0, height: 0, innerWidth: 0, innerHeight: 0, padded: false },
    fps: seq.fps,
    frames: 0,
    duration,
    videoCodec: null,
    videoKbps: 0,
    audioCodec: null,
    audio: false,
    usage: null,
    estimatedBytes: 0,
    freeBytes: null,
    issues,
    decode: new Map(),
  };

  if (!job.outputPath) add('error', 'destination', 'Choose a destination folder.');

  // ---- handoff files describe the whole sequence ----
  if (kind === 'handoff') {
    const fmt = settings.container as HandoffFormat;
    const whole = { start: 0, end: Math.max(duration, range.end) };
    const usage = rangeUsage(project, seq.id, { start: 0, end: Number.MAX_SAFE_INTEGER });
    plan.usage = usage;
    if ((fmt === 'srt' || fmt === 'vtt') && usage.captionCues === 0) add('error', 'captions', 'This sequence has no caption cues to export.');
    if (fmt === 'chapters' && usage.chapterMarkers === 0) add('error', 'chapters', 'This sequence has no chapter markers. Add markers of kind "Chapter" first.');
    plan.duration = whole.end;
    plan.estimatedBytes = estimateBytes({ settings, duration: 0, frames: 0, width: 0, height: 0, videoKbps: 0, audioCodec: null, hasAudio: false });
    return plan;
  }

  if (!(duration > 0)) add('error', 'range', 'The export range is empty.');
  const usage = rangeUsage(project, seq.id, range);
  plan.usage = usage;

  if (usage.missingAssetClips.length) add('error', 'missing', `${usage.missingAssetClips.length} clip${usage.missingAssetClips.length > 1 ? 's point' : ' points'} at media that was removed from the project (${usage.missingAssetClips.slice(0, 3).join(', ')}).`);
  const visual = kind === 'video' || kind === 'imageSequence' || kind === 'still';
  const neededOffline = usage.offline.filter((a) => (visual && usage.videoAssets.includes(a)) || ((kind === 'video' || kind === 'audio') && usage.audioAssets.includes(a)));
  if (neededOffline.length) add('error', 'offline', `Media offline: ${names(neededOffline)}. Relink ${neededOffline.length > 1 ? 'them' : 'it'} in the Media panel before exporting.`);

  if (visual) {
    for (const lut of usage.luts) {
      if (!lut.ref) add('error', 'lut', `The LUT used by "${lut.clipName}" is no longer in the project. Re-import it or turn it off in the grade.`);
      else if (window.omega?.media?.exists && !(await window.omega.media.exists(lut.ref.path).catch(() => true))) add('error', 'lut', `LUT file missing: ${lut.ref.path}`);
    }
    if (!Renderer.isSupported()) add('error', 'gpu', 'GPU rendering (WebGL2) is not available on this system, so frames cannot be rendered.');
    plan.size = resolveOutputSize(settings.video.resolution, source);
    plan.fps = kind === 'still' ? seq.fps : resolveFps(settings.video.fps, seq.fps);
    plan.frames = kind === 'still' ? 1 : frameCount(range, plan.fps);
    if (plan.size.padded) {
      const r = settings.video.resolution as { width: number; height: number };
      add('warning', 'letterbox', `${job.presetName ?? 'This preset'} is ${r.width}×${r.height} (${aspectText(r.width, r.height)}), but the ${format ? `"${format.name}" format` : 'sequence'} is ${aspectText(source.width, source.height)}: the picture will be letterboxed. Add a ${aspectText(r.width, r.height)} format to the sequence for a reframed version.`);
    }
  }

  // ---- video codec ----
  if (kind === 'video') {
    const prefs = codecsForContainer(settings.video.codecs, CONTAINER_VIDEO_CODECS[settings.container]);
    const probe = { width: plan.size.width, height: plan.size.height, fps: plan.fps };
    const codec = await firstEncodableVideo(prefs, probe);
    plan.videoCodec = codec;
    if (!codec) {
      add('error', 'video-codec', `This system can't encode ${settings.container.toUpperCase()} video at ${plan.size.width}×${plan.size.height} (tried ${prefs.map((c) => VIDEO_CODEC_LABEL[c]).join(', ')}). Try a smaller size or another container.`);
    } else {
      plan.videoKbps = resolveVideoKbps(settings.video.bitrate, plan.size.width, plan.size.height, plan.fps, codec, settings.video.bitrateKbps);
      if (codec !== prefs[0]) add('warning', 'video-fallback', `${VIDEO_CODEC_LABEL[prefs[0]]} isn't available at this size here; using ${VIDEO_CODEC_LABEL[codec]}.`);
      if (job.expectsCodec && codec !== job.expectsCodec && prefs[0] === job.expectsCodec) add('warning', 'platform-codec', `${job.presetName ?? 'The platform'} expects ${VIDEO_CODEC_LABEL[job.expectsCodec]}; ${VIDEO_CODEC_LABEL[codec]} may be rejected or re-encoded.`);
      if (!(await canEncodeVideoAt(codec, { ...probe, kbps: plan.videoKbps }))) add('warning', 'bitrate', `The encoder may not accept ${(plan.videoKbps / 1000).toFixed(1)} Mbps at this size; it will use the closest rate it supports.`);
    }
  }

  // ---- audio codec ----
  const wantsAudio = kind === 'audio' || (kind === 'video' && settings.audio.enabled && usage.hasAudio);
  if (kind === 'audio' && !usage.hasAudio) add('warning', 'silent', 'Nothing audible in this range: the file will be silent.');
  if (wantsAudio) {
    const prefs = codecsForContainer(settings.audio.codecs, CONTAINER_AUDIO_CODECS[settings.container]);
    const codec = await firstEncodableAudio(prefs, { sampleRate: settings.audio.sampleRate, channels: settings.audio.channels, kbps: settings.audio.bitrateKbps });
    plan.audioCodec = codec;
    plan.audio = !!codec;
    if (!codec) add('error', 'audio-codec', `This system can't encode audio for ${settings.container.toUpperCase()} (tried ${prefs.map((c) => AUDIO_CODEC_LABEL[c]).join(', ')}). Turn audio off or choose another container.`);
    else if (codec !== prefs[0]) add('warning', 'audio-fallback', `${AUDIO_CODEC_LABEL[prefs[0]]} encoding isn't available on this system; using ${AUDIO_CODEC_LABEL[codec]}.`);
  }

  // ---- captions / chapters ----
  if (kind === 'video' && settings.captions !== 'none' && usage.captionCues === 0) add('info', 'no-captions', 'No caption cues in this range, so no captions will be ' + (settings.captions === 'burnIn' ? 'burned in.' : 'written.'));
  if ((kind === 'video' || kind === 'audio') && settings.chapters && usage.chapterMarkers === 0) add('info', 'no-chapters', 'No chapter markers in this range, so no chapter list will be written.');

  // ---- size, disk and platform limits ----
  plan.estimatedBytes = estimateBytes({ settings, duration, frames: plan.frames, width: plan.size.width, height: plan.size.height, videoKbps: plan.videoKbps, audioCodec: plan.audioCodec, hasAudio: usage.hasAudio });
  if (opts.diskSpace && job.outputPath && window.omega?.files?.freeSpace) {
    plan.freeBytes = await window.omega.files.freeSpace(job.outputPath).catch(() => null);
    if (plan.freeBytes !== null && plan.estimatedBytes > plan.freeBytes * 0.95)
      add('warning', 'disk', `About ${formatBytesShort(plan.estimatedBytes)} is needed but only ${formatBytesShort(plan.freeBytes)} is free at the destination.`);
  }
  const lim = job.limits;
  if (lim) {
    if (lim.maxDurationSec && duration > lim.maxDurationSec + 0.01) add('warning', 'limit-duration', `${job.presetName ?? 'This platform'} allows up to ${formatClock(lim.maxDurationSec)}; this export is ${formatClock(duration)}.${lim.note ? ` ${lim.note}` : ''}`);
    if (lim.maxBytes && plan.estimatedBytes > lim.maxBytes) add('warning', 'limit-size', `The estimated ${formatBytesShort(plan.estimatedBytes)} is over ${job.presetName ?? 'the platform'}'s ${formatBytesShort(lim.maxBytes)} limit. Lower the bitrate or shorten the range.`);
    if (lim.maxFps && plan.fps > lim.maxFps + 0.01) add('warning', 'limit-fps', `${job.presetName ?? 'This platform'} accepts up to ${lim.maxFps} fps.`);
  }

  // ---- decoders (deep) ----
  if (opts.deep && visual) {
    const unreadable: string[] = [];
    for (const asset of usage.videoAssets) {
      if (asset.offline) continue;
      throwIfAborted(opts.signal);
      const t0 = performance.now();
      const mode = await probeDecode(asset).catch(() => null);
      exportDebug('decode probe', asset.name, mode, `${(performance.now() - t0).toFixed(0)} ms`);
      if (mode) plan.decode.set(asset.id, mode);
      else unreadable.push(asset.name);
    }
    if (unreadable.length && unreadable.length === usage.videoAssets.filter((a) => !a.offline).length)
      add('error', 'decoder', `Video frames can't be decoded right now (the media decoder returned no frames for ${unreadable.slice(0, 3).map((n) => `"${n}"`).join(', ')}). The export needs decoded frames from the original media.`);
    else if (unreadable.length) add('error', 'decoder', `Can't decode ${unreadable.slice(0, 3).map((n) => `"${n}"`).join(', ')}: the file may be damaged or use a codec this system can't decode.`);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

class Progress {
  private last = 0;
  private samples: { t: number; frame: number }[] = [];
  private started = performance.now();
  constructor(private readonly cb: (p: ExportProgress) => void) {}

  emit(p: Omit<ExportProgress, 'fps' | 'eta'> & { fps?: number | null; eta?: number | null }, force = false) {
    const now = performance.now();
    if (!force && now - this.last < 120) return;
    this.last = now;
    this.cb({ fps: null, eta: null, ...p });
  }

  /** Frame-based progress with rolling fps and ETA. `span` maps 0..1 of frames into the overall fraction. */
  frame(phase: ExportProgress['phase'], frame: number, total: number, span: [number, number], tailSeconds = 0) {
    const now = performance.now();
    this.samples.push({ t: now, frame });
    while (this.samples.length > 2 && now - this.samples[0].t > 3000) this.samples.shift();
    const first = this.samples[0];
    const dt = (now - first.t) / 1000;
    const fps = dt > 0.25 ? (frame - first.frame) / dt : frame / Math.max(0.001, (now - this.started) / 1000);
    const eta = fps > 0 ? (total - frame) / fps + tailSeconds : null;
    const f = total ? frame / total : 1;
    this.emit({ phase, fraction: span[0] + (span[1] - span[0]) * f, fps: Number.isFinite(fps) ? fps : null, eta, frame, totalFrames: total }, frame === total);
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function exportJob(job: ExportJob, onProgress: (p: ExportProgress) => void, signal?: AbortSignal): Promise<ExportResult> {
  const progress = new Progress(onProgress);
  const log: string[] = [];
  const warnings: string[] = [];
  const started = performance.now();
  const note = (m: string) => log.push(m);
  progress.emit({ phase: 'preflight', fraction: 0, message: 'Checking media and encoders' }, true);
  throwIfAborted(signal);

  exportDebug('preflight', job.name, job.outputPath);
  const plan = await planExport(job, { deep: true, diskSpace: true, signal });
  exportDebug('plan', plan.size, plan.fps, plan.frames, plan.videoCodec, plan.audioCodec, plan.issues.map((i) => i.message));
  for (const i of plan.issues) {
    if (i.level === 'warning') warnings.push(i.message);
    if (i.level !== 'error') note(`${i.level}: ${i.message}`);
  }
  const errors = plan.issues.filter((i) => i.level === 'error');
  if (errors.length) throw new ExportFailed(errors.map((e) => e.message).join('\n'));
  throwIfAborted(signal);

  const result: ExportResult = {
    outputPath: job.outputPath,
    files: [],
    bytes: 0,
    videoCodec: plan.videoCodec,
    audioCodec: plan.audioCodec,
    width: plan.size.width,
    height: plan.size.height,
    fps: plan.fps,
    frames: plan.frames,
    duration: plan.duration,
    loudness: null,
    warnings,
    log,
  };

  switch (job.settings.kind) {
    case 'handoff':
      await writeHandoff(job, result);
      break;
    case 'still':
    case 'imageSequence':
      await renderImages(job, plan, result, progress, signal);
      break;
    case 'audio':
    case 'video':
      await renderMedia(job, plan, result, progress, signal);
      break;
  }

  if (job.settings.kind === 'video' || job.settings.kind === 'audio') {
    progress.emit({ phase: 'sidecars', fraction: 0.995 }, true);
    await writeSidecars(job, plan, result);
  }
  const secs = (performance.now() - started) / 1000;
  note(`Finished in ${secs.toFixed(1)} s · ${formatBytesShort(result.bytes)}${result.frames > 1 ? ` · ${(result.frames / secs).toFixed(1)} fps average` : ''}`);
  progress.emit({ phase: 'done', fraction: 1 }, true);
  return result;
}

function makeFormat(container: ExportSettings['container'], estimatedBytes: number): OutputFormat {
  switch (container) {
    case 'mp4':
    case 'm4a':
      return new Mp4OutputFormat({ fastStart: false });
    case 'mov':
      return new MovOutputFormat({ fastStart: false });
    case 'webm':
      return new WebMOutputFormat();
    case 'mkv':
      return new MkvOutputFormat();
    case 'wav':
      return new WavOutputFormat({ large: estimatedBytes > 3.8 * 1024 ** 3 });
    case 'flac':
      return new FlacOutputFormat();
    case 'ogg':
      return new OggOutputFormat();
    default:
      throw new ExportFailed(`"${container}" is not a media container.`);
  }
}

function audioSourceFor(codec: AudioCodecId, kbps: number): AudioBufferSource {
  const c = codec as AudioCodec;
  if (codec.startsWith('pcm-') || codec === 'flac') return new AudioBufferSource({ codec: c });
  return new AudioBufferSource({ codec: c, quality: new Quality({ bitrate: Math.round(kbps * 1000) }) });
}

async function preloadLuts(job: ExportJob, plan: ExportPlan, result: ExportResult) {
  for (const lut of plan.usage?.luts ?? []) {
    if (!lut.ref) continue;
    try {
      await loadLut(lut.ref.id, lut.ref.path);
    } catch (err) {
      const msg = errorMessage(err);
      if (/not implemented/i.test(msg)) result.warnings.push(`LUT "${lut.ref.name}" can't be applied yet (LUT loading is unavailable); clips using it render without it.`);
      else throw new ExportFailed(`LUT "${lut.ref.name}" couldn't be loaded: ${msg}`);
    }
  }
  void job;
}

/** Sets up the renderer and returns a function that renders output frame i into the encode canvas. */
function createFrameRenderer(job: ExportJob, plan: ExportPlan) {
  const { size } = plan;
  const renderCanvas = new OffscreenCanvas(size.innerWidth, size.innerHeight);
  let renderer: Renderer;
  try {
    renderer = new Renderer(renderCanvas);
  } catch (err) {
    throw new ExportFailed(`The GPU renderer could not start: ${errorMessage(err)}`);
  }
  renderer.setSize(size.innerWidth, size.innerHeight);
  const encodeCanvas = size.padded ? new OffscreenCanvas(size.width, size.height) : renderCanvas;
  const pad = size.padded ? (encodeCanvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D | null) : null;
  if (size.padded && !pad) throw new ExportFailed('Could not create the letterbox canvas.');
  const seq = sequenceOf(job.project, job.sequenceId);
  const tc = (t: number) => formatTimecode(t, seq.fps, seq.dropFrame);
  const frames = new ExportFrameProvider(job.project, plan.decode, (t) => `${t.toFixed(3)} s`);
  const burnIn = job.settings.kind === 'video' ? job.settings.captions === 'burnIn' : true;

  return {
    canvas: encodeCanvas,
    async render(t: number, index: number, signal?: AbortSignal): Promise<OffscreenCanvas> {
      const graph = buildFrameGraph(job.project, job.sequenceId, t, { formatId: job.formatId, captions: burnIn });
      try {
        await frames.prepare(graph, index, signal);
      } catch (err) {
        if (isCancel(err)) throw err;
        throw new ExportFailed(`At ${tc(t)}: ${errorMessage(err)}`);
      }
      try {
        renderer.render(graph, frames, {});
      } catch (err) {
        throw new ExportFailed(`Rendering failed at ${tc(t)}: ${errorMessage(err)}`);
      }
      if (pad) {
        pad.fillStyle = '#000';
        pad.fillRect(0, 0, size.width, size.height);
        pad.drawImage(renderCanvas, Math.round((size.width - size.innerWidth) / 2), Math.round((size.height - size.innerHeight) / 2));
      }
      frames.endFrame(index);
      return encodeCanvas;
    },
    dispose() {
      frames.dispose();
      try {
        renderer.dispose();
      } catch {
        /* ignore */
      }
    },
  };
}

async function renderMedia(job: ExportJob, plan: ExportPlan, result: ExportResult, progress: Progress, signal?: AbortSignal) {
  const { settings } = job;
  const isVideo = settings.kind === 'video';
  const sink: FileSink = await openFileSink(job.outputPath);
  const output = new Output({ format: makeFormat(settings.container, plan.estimatedBytes), target: sink.target });
  const cleanups: (() => void)[] = [];
  let finished = false;
  try {
    // ---- tracks ----
    let videoSource: CanvasSource | null = null;
    let frameRenderer: ReturnType<typeof createFrameRenderer> | null = null;
    if (isVideo) {
      await preloadLuts(job, plan, result);
      frameRenderer = createFrameRenderer(job, plan);
      cleanups.push(() => frameRenderer?.dispose());
      videoSource = new CanvasSource(frameRenderer.canvas, {
        codec: plan.videoCodec as VideoCodec,
        quality: new Quality({ bitrate: plan.videoKbps * 1000, bitrateMode: settings.video.bitrateMode === 'cbr' ? 'constant' : 'variable' }),
        keyFrameInterval: settings.video.keyframeInterval,
        latencyMode: 'quality',
      });
      output.addVideoTrack(videoSource, { frameRate: plan.fps });
      result.log.push(`Video: ${VIDEO_CODEC_LABEL[plan.videoCodec!]} ${plan.size.width}×${plan.size.height} @ ${plan.fps.toFixed(3).replace(/\.?0+$/, '')} fps, ${(plan.videoKbps / 1000).toFixed(1)} Mbps ${settings.video.bitrateMode.toUpperCase()}, key frame every ${settings.video.keyframeInterval} s`);
    }
    let audioSource: AudioBufferSource | null = null;
    let program: AudioProgram | null = null;
    if (plan.audio && plan.audioCodec) {
      audioSource = audioSourceFor(plan.audioCodec, settings.audio.bitrateKbps);
      output.addAudioTrack(audioSource);
      program = new AudioProgram(job.project, job.sequenceId, job.range, settings.audio.sampleRate, settings.audio.channels, settings.loudness);
      program.signal = signal;
      result.log.push(`Audio: ${AUDIO_CODEC_LABEL[plan.audioCodec]} ${settings.audio.sampleRate / 1000} kHz ${settings.audio.channels === 1 ? 'mono' : 'stereo'}${plan.audioCodec.startsWith('pcm-') || plan.audioCodec === 'flac' ? '' : ` ${settings.audio.bitrateKbps} kbps`}`);
    }
    if (!videoSource && !audioSource) throw new ExportFailed('Nothing to export: the range has no audio.');
    try {
      output.setMetadataTags({ title: job.name, date: new Date(), comment: 'Exported with Omega Delta' });
    } catch {
      /* not every container takes tags */
    }
    await output.start();
    exportDebug('output started', settings.container);

    // ---- loudness analysis (pass 1) ----
    const analyzeSpan: [number, number] = program && settings.loudness.normalize ? [0.01, isVideo ? 0.08 : 0.4] : [0.01, 0.01];
    if (program && settings.loudness.normalize) {
      progress.emit({ phase: 'analyzing', fraction: analyzeSpan[0], message: 'Measuring loudness' }, true);
      await program.analyze((f) => progress.emit({ phase: 'analyzing', fraction: analyzeSpan[0] + (analyzeSpan[1] - analyzeSpan[0]) * f, message: 'Measuring loudness' }), signal);
      for (const n of program.notes) result.warnings.push(n);
    }

    // ---- audio feed (pass 2), interleaved with video ----
    const feed = program?.pieces(signal);
    let audioUntil = 0;
    let audioDone = !audioSource;
    const pumpAudio = async (until: number) => {
      while (!audioDone && audioUntil < until) {
        throwIfAborted(signal);
        const next = await feed!.next();
        if (next.done) {
          audioDone = true;
          audioSource!.close();
          break;
        }
        await withTimeout(audioSource!.add(next.value), ENCODE_TIMEOUT_MS, 'The audio encoder stopped responding.', signal);
        audioUntil += next.value.duration;
        exportDebug('audio until', audioUntil.toFixed(2));
        if (!videoSource) progress.emit({ phase: 'audio', fraction: analyzeSpan[1] + (0.97 - analyzeSpan[1]) * Math.min(1, audioUntil / Math.max(0.001, program!.duration)), message: 'Encoding audio' });
      }
    };

    if (videoSource && frameRenderer) {
      const span: [number, number] = [analyzeSpan[1], 0.97];
      let lastYield = performance.now();
      const timing = { audio: 0, render: 0, encode: 0 };
      for (let i = 0; i < plan.frames; i++) {
        throwIfAborted(signal);
        const ts = i / plan.fps;
        const t0 = performance.now();
        await pumpAudio(ts + AUDIO_LOOKAHEAD);
        const t1 = performance.now();
        await frameRenderer.render(frameTime(job.range, plan.fps, i), i, signal);
        const t2 = performance.now();
        await withTimeout(videoSource.add(ts, 1 / plan.fps), ENCODE_TIMEOUT_MS, 'The video encoder stopped responding.', signal);
        const t3 = performance.now();
        timing.audio += t1 - t0;
        timing.render += t2 - t1;
        timing.encode += t3 - t2;
        if (i % 10 === 0 || i === plan.frames - 1) exportDebug(`frame ${i + 1}/${plan.frames}`, `audio ${timing.audio.toFixed(0)} ms`, `render ${timing.render.toFixed(0)} ms`, `encode ${timing.encode.toFixed(0)} ms`, `sink ${sink.written()} B`);
        progress.frame('rendering', i + 1, plan.frames, span);
        if (performance.now() - lastYield > YIELD_EVERY_MS) {
          await yieldToEventLoop();
          lastYield = performance.now();
        }
      }
      videoSource.close();
    }
    await pumpAudio(Infinity);
    if (program?.report) {
      result.loudness = program.report;
      const r = program.report;
      result.log.push(
        `Loudness: measured ${r.measuredLufs.toFixed(1)} LUFS / ${r.measuredTruePeak.toFixed(1)} dBTP, gain ${r.gainDb >= 0 ? '+' : ''}${r.gainDb.toFixed(1)} dB` +
          (r.resultLufs !== undefined ? ` → ${r.resultLufs.toFixed(1)} LUFS / ${r.resultTruePeak!.toFixed(1)} dBTP` : ''),
      );
    }

    progress.emit({ phase: 'finalizing', fraction: 0.98, message: 'Finishing the file' }, true);
    throwIfAborted(signal);
    await withTimeout(output.finalize(), ENCODE_TIMEOUT_MS * 2, 'Finishing the file took too long.', signal);
    result.bytes = await sink.finish();
    finished = true;
    result.files.push(job.outputPath);
  } catch (err) {
    if (!finished) {
      await output.cancel().catch(() => undefined);
      await sink.abort();
    }
    if (isCancel(err)) throw new ExportCancelled();
    if (err instanceof ExportFailed) throw err;
    throw new ExportFailed(describeEncodeError(err));
  } finally {
    for (const c of cleanups) c();
  }
}

function describeEncodeError(err: unknown): string {
  const msg = errorMessage(err);
  if (/ENOSPC|disk.*full/i.test(msg)) return 'The disk is full.';
  if (/EACCES|EPERM|permission/i.test(msg)) return `No permission to write there: ${msg}`;
  if (/encod/i.test(msg)) return `The encoder failed: ${msg}`;
  return `Export failed: ${msg}`;
}

async function renderImages(job: ExportJob, plan: ExportPlan, result: ExportResult, progress: Progress, signal?: AbortSignal) {
  await preloadLuts(job, plan, result);
  const fr = createFrameRenderer(job, plan);
  const still = job.settings.kind === 'still';
  const base = baseName(job.outputPath);
  let written = 0;
  try {
    let lastYield = performance.now();
    for (let i = 0; i < plan.frames; i++) {
      throwIfAborted(signal);
      const canvas = await fr.render(frameTime(job.range, plan.fps, i), i, signal);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const path = still ? job.outputPath : joinPath(job.outputPath, sequenceFrameName(base, i, plan.frames));
      await window.omega.files.writeBinary(path, await blob.arrayBuffer());
      result.bytes += blob.size;
      written++;
      if (still) result.files.push(path);
      progress.frame('rendering', i + 1, plan.frames, [0.01, 0.99]);
      if (performance.now() - lastYield > YIELD_EVERY_MS) {
        await yieldToEventLoop();
        lastYield = performance.now();
      }
    }
    if (!still) {
      result.files.push(job.outputPath);
      result.log.push(`${written} PNG frames in ${job.outputPath}`);
    }
  } catch (err) {
    if (isCancel(err)) {
      if (!still && written) result.log.push(`Cancelled after ${written} frames; the frames already written are kept.`);
      throw new ExportCancelled();
    }
    throw err instanceof ExportFailed ? err : new ExportFailed(describeEncodeError(err));
  } finally {
    fr.dispose();
  }
}

// ---------------------------------------------------------------------------
// Text outputs
// ---------------------------------------------------------------------------

function captionFiles(seq: Sequence, fmt: 'srt' | 'vtt', basePath: string): { path: string; text: string }[] {
  const tracks = seq.tracks.filter((t) => t.kind === 'caption' && !t.muted && t.cues.length);
  return tracks.map((t) => {
    const cues = [...t.cues].sort((a, b) => a.start - b.start);
    const suffix = tracks.length > 1 ? `.${t.name.replace(/[<>:"/\\|?*]/g, '-')}` : '';
    return { path: `${basePath}${suffix}.${fmt}`, text: fmt === 'srt' ? writeSrt(cues) : writeVtt(cues) };
  });
}

async function writeText(path: string, text: string, result: ExportResult) {
  await window.omega.files.writeText(path, text);
  result.files.push(path);
  result.bytes += new Blob([text]).size;
}

async function writeHandoff(job: ExportJob, result: ExportResult) {
  const seq = sequenceOf(job.project, job.sequenceId);
  const fmt = job.settings.container as HandoffFormat;
  try {
    switch (fmt) {
      case 'edl':
        return await writeText(job.outputPath, exportEdl(job.project, seq), result);
      case 'otio':
        return await writeText(job.outputPath, exportOtio(job.project, seq), result);
      case 'fcpxml':
        return await writeText(job.outputPath, exportFcpxml(job.project, seq), result);
      case 'chapters':
        return await writeText(job.outputPath, exportChapters(seq), result);
      case 'srt':
      case 'vtt':
        for (const f of captionFiles(seq, fmt, stripExtension(job.outputPath))) await writeText(f.path, f.text, result);
        if (result.files[0]) result.outputPath = result.files[0];
        return;
    }
  } catch (err) {
    const msg = errorMessage(err);
    if (/not implemented/i.test(msg)) throw new ExportFailed(`${fmt.toUpperCase()} export isn't available yet in this build.`);
    throw new ExportFailed(`Couldn't write the ${fmt.toUpperCase()} file: ${msg}`);
  }
}

async function writeSidecars(job: ExportJob, plan: ExportPlan, result: ExportResult) {
  const seq = sequenceOf(job.project, job.sequenceId);
  const shifted = shiftedSequence(seq, job.range);
  const base = stripExtension(job.outputPath);
  const mode = job.settings.captions;
  if (job.settings.kind === 'video' && (mode === 'srt' || mode === 'vtt') && plan.usage?.captionCues) {
    try {
      for (const f of captionFiles(shifted, mode, base)) await writeText(f.path, f.text, result);
    } catch (err) {
      result.warnings.push(`Caption sidecar not written: ${errorMessage(err)}`);
    }
  }
  if (job.settings.chapters && plan.usage?.chapterMarkers) {
    try {
      await writeText(`${base}.chapters.txt`, exportChapters(shifted), result);
    } catch (err) {
      result.warnings.push(`Chapter list not written: ${errorMessage(err)}`);
    }
  }
}

/** True when a preset's fixed frame matches a format's aspect (for picking formats automatically). */
export function formatMatchesAspect(width: number, height: number, fmt: { width: number; height: number }): boolean {
  return sameAspect(fmt.width, fmt.height, width, height);
}
