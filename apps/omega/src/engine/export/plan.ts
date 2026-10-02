// Pure export planning math: output size, frame rate, bitrate, size
// estimates, ranges and frame-time sampling. No DOM, no Mediabunny, so all of
// it is unit-tested in Node (plan.test.ts).

import { exactRate, snapToFrame } from '../time';
import type { Sequence } from '../../state/types';
import { sequenceDuration } from '../../state/types';
import type { AudioCodecId, AudioSettings, BitrateRule, ExportSettings, FpsPolicy, RangeSpec, ResolutionPolicy, TimeRange, VideoCodecId } from './types';

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface OutputSize {
  /** Encoded frame size (always even). */
  width: number;
  height: number;
  /** Size of the picture inside the frame; smaller than the frame when letterboxed. */
  innerWidth: number;
  innerHeight: number;
  /** The picture is letterboxed / pillarboxed inside the frame. */
  padded: boolean;
}

/** Rounds to the nearest even integer ≥ 2 (4:2:0 chroma needs even sizes). */
export function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

const ASPECT_TOLERANCE = 0.01;

export function sameAspect(w1: number, h1: number, w2: number, h2: number): boolean {
  const a = w1 / h1;
  const b = w2 / h2;
  return Math.abs(a - b) / b < ASPECT_TOLERANCE;
}

/** Largest size with the source aspect that fits inside box (may upscale). */
export function fitInside(srcW: number, srcH: number, boxW: number, boxH: number): { width: number; height: number } {
  const s = Math.min(boxW / srcW, boxH / srcH);
  return { width: even(srcW * s), height: even(srcH * s) };
}

export function resolveOutputSize(policy: ResolutionPolicy, src: { width: number; height: number }): OutputSize {
  const plain = (w: number, h: number): OutputSize => ({ width: even(w), height: even(h), innerWidth: even(w), innerHeight: even(h), padded: false });
  switch (policy.mode) {
    case 'sequence': {
      const s = (policy.scale ?? 100) / 100;
      return plain(src.width * s, src.height * s);
    }
    case 'fixed': {
      if (sameAspect(src.width, src.height, policy.width, policy.height)) return plain(policy.width, policy.height);
      const inner = fitInside(src.width, src.height, policy.width, policy.height);
      return { width: even(policy.width), height: even(policy.height), innerWidth: Math.min(inner.width, even(policy.width)), innerHeight: Math.min(inner.height, even(policy.height)), padded: true };
    }
    case 'max': {
      // The box follows the picture's orientation: "1920×1080 max" holds a
      // vertical 1080×1920 sequence as is instead of shrinking it.
      const portrait = src.height > src.width;
      const boxPortrait = policy.height > policy.width;
      const [bw, bh] = portrait !== boxPortrait ? [policy.height, policy.width] : [policy.width, policy.height];
      if (src.width <= bw && src.height <= bh) return plain(src.width, src.height);
      const f = fitInside(src.width, src.height, bw, bh);
      return plain(f.width, f.height);
    }
  }
}

// ---------------------------------------------------------------------------
// Frame rate
// ---------------------------------------------------------------------------

/** Common labels for exact NTSC rates. */
export function fpsLabel(fps: number): string {
  const r = exactRate(fps);
  if (Math.abs(r - Math.round(r)) < 1e-6) return String(Math.round(r));
  return (Math.round(r * 1000) / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Output frame rate for a policy (exact NTSC rationals). Over `max`, the
 * rate is divided by the smallest whole factor that fits (119.88 → 59.94),
 * so motion stays even. `allowed` snaps only when the rate is more than 0.5%
 * away from every allowed rate (23.976 stays 23.976 for a 24 list).
 */
export function resolveFps(policy: FpsPolicy, sequenceFps: number): number {
  if (policy.mode === 'fixed') return exactRate(policy.fps);
  let fps = exactRate(sequenceFps);
  if (policy.max && fps > policy.max + 1e-6) {
    let d = 2;
    while (fps / d > policy.max + 1e-6) d++;
    fps = fps / d;
  }
  if (policy.allowed?.length) {
    const near = policy.allowed.some((a) => Math.abs(exactRate(a) - fps) / exactRate(a) <= 0.005);
    if (!near) {
      let best = exactRate(policy.allowed[0]);
      for (const a of policy.allowed) if (Math.abs(exactRate(a) - fps) < Math.abs(best - fps)) best = exactRate(a);
      fps = best;
    }
  }
  return fps;
}

// ---------------------------------------------------------------------------
// Bitrate
// ---------------------------------------------------------------------------

/** Relative bitrate needed for similar quality (H.264 = 1). */
export const CODEC_EFFICIENCY: Record<VideoCodecId, number> = { avc: 1, hevc: 0.75, vp9: 0.8, av1: 0.65, vp8: 1.15 };

export function isHighFrameRate(fps: number): boolean {
  return fps > 31;
}

/** Target video bitrate in kbps for an output size, rate and codec. */
export function resolveVideoKbps(rule: BitrateRule, width: number, height: number, fps: number, codec: VideoCodecId, overrideKbps?: number | null): number {
  if (overrideKbps && overrideKbps > 0) return Math.round(overrideKbps);
  const base = isHighFrameRate(fps) ? (rule.hfrKbps ?? rule.kbps * 1.5) : rule.kbps;
  const pixels = (width * height) / (rule.refWidth * rule.refHeight);
  const eff = CODEC_EFFICIENCY[codec] / CODEC_EFFICIENCY[rule.refCodec];
  const kbps = base * pixels * eff;
  return Math.round(Math.min(rule.maxKbps ?? 400_000, Math.max(rule.minKbps ?? 250, kbps)));
}

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

export function isPcm(codec: AudioCodecId): boolean {
  return codec.startsWith('pcm-');
}

export function pcmBytesPerSample(codec: AudioCodecId): number {
  if (codec === 'pcm-s16') return 2;
  if (codec === 'pcm-s24') return 3;
  return 4;
}

/** Audio bitrate in kbps for a codec (PCM and FLAC are derived from the format). */
export function audioKbps(audio: Pick<AudioSettings, 'bitrateKbps' | 'sampleRate' | 'channels'>, codec: AudioCodecId): number {
  if (isPcm(codec)) return (audio.sampleRate * audio.channels * pcmBytesPerSample(codec) * 8) / 1000;
  // FLAC of mixed program material is typically ~55-65% of 16/24-bit PCM.
  if (codec === 'flac') return (audio.sampleRate * audio.channels * 3 * 8 * 0.6) / 1000;
  return audio.bitrateKbps;
}

export interface SizeEstimateInput {
  settings: ExportSettings;
  duration: number;
  frames: number;
  width: number;
  height: number;
  videoKbps: number;
  audioCodec: AudioCodecId | null;
  /** Whether the sequence has any audible audio in range. */
  hasAudio: boolean;
}

/** Estimated bytes on disk (± ~10% for constant bitrate, rough for PNG). */
export function estimateBytes(i: SizeEstimateInput): number {
  const { settings, duration } = i;
  switch (settings.kind) {
    case 'handoff':
      return 16 * 1024;
    case 'still':
      return Math.round(i.width * i.height * 1.8);
    case 'imageSequence':
      return Math.round(i.width * i.height * 1.8 * i.frames);
    case 'audio': {
      if (!i.audioCodec) return 0;
      return Math.round((audioKbps(settings.audio, i.audioCodec) * 1000 * duration) / 8 + 4096);
    }
    case 'video': {
      const a = settings.audio.enabled && i.hasAudio && i.audioCodec ? audioKbps(settings.audio, i.audioCodec) : 0;
      const payload = ((i.videoKbps + a) * 1000 * duration) / 8;
      // container overhead: ~1% plus per-frame index entries
      return Math.round(payload * 1.01 + i.frames * 24 + 8192);
    }
  }
}

// ---------------------------------------------------------------------------
// Ranges and frame sampling
// ---------------------------------------------------------------------------

export class ExportRangeError extends Error {}

/**
 * Resolves a range spec against a sequence; times are snapped to the
 * sequence's frame grid. Throws a readable error for an empty range.
 */
export function resolveRange(spec: RangeSpec, seq: Pick<Sequence, 'fps' | 'inPoint' | 'outPoint' | 'tracks'>, outFps?: number): TimeRange {
  const duration = sequenceDuration(seq as Sequence);
  const snap = (t: number) => snapToFrame(Math.max(0, t), seq.fps);
  let start = 0;
  let end = duration;
  switch (spec.mode) {
    case 'entire':
      break;
    case 'inout':
      start = seq.inPoint ?? 0;
      end = seq.outPoint ?? duration;
      if (seq.inPoint === null && seq.outPoint === null) throw new ExportRangeError('No in or out point is set on the sequence. Mark in (I) and out (O), or render the entire sequence.');
      break;
    case 'custom':
      start = spec.start;
      end = spec.end;
      break;
    case 'frame': {
      // the frame on screen at spec.time (floor), never past the last frame
      const rate = exactRate(seq.fps);
      const t = Math.min(Math.floor(Math.max(0, spec.time) * rate + 1e-6) / rate, Math.max(0, snap(duration) - 1 / rate));
      return { start: t, end: t + 1 / exactRate(outFps ?? seq.fps) };
    }
  }
  start = snap(start);
  end = snap(end);
  if (!(end > start)) {
    if (duration <= 0) throw new ExportRangeError('The sequence is empty: there is nothing to export.');
    throw new ExportRangeError('The export range is empty: the end must come after the start.');
  }
  return { start, end };
}

/** Number of output frames for a range at an output frame rate. */
export function frameCount(range: TimeRange, fps: number): number {
  return Math.max(1, Math.round((range.end - range.start) * fps - 1e-6));
}

/** Timeline time of output frame i (the timeline is sampled at the output frame times). */
export function frameTime(range: TimeRange, fps: number, i: number): number {
  return range.start + i / fps;
}

/** Sequence frame index shown at timeline time t (the frame whose start is ≤ t). */
export function sequenceFrameAt(t: number, sequenceFps: number): number {
  return Math.floor(t * exactRate(sequenceFps) + 1e-6);
}

/** Exact sample count for a range at a sample rate (chunks are cut on this grid). */
export function sampleCount(range: TimeRange, sampleRate: number): number {
  return Math.max(1, Math.round((range.end - range.start) * sampleRate));
}

/** [startSample, endSample) chunks of at most `chunkSeconds`. */
export function audioChunks(totalSamples: number, sampleRate: number, chunkSeconds: number): { from: number; to: number }[] {
  const size = Math.max(1, Math.round(chunkSeconds * sampleRate));
  const out: { from: number; to: number }[] = [];
  for (let from = 0; from < totalSamples; from += size) out.push({ from, to: Math.min(totalSamples, from + size) });
  return out;
}
