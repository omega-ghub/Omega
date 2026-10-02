// Audio engine. OWNED BY THE AUDIO PACKAGE.
// Public API used by the viewer (playback clock), the timeline (waveforms),
// the mixer (meters) and export (offline mixdown). Stubbed until built.

import type { Project } from '../../state/types';

export interface Meter {
  /** dBFS, -Infinity when silent */
  peakL: number;
  peakR: number;
  rmsL: number;
  rmsR: number;
}

export interface Peaks {
  /** Samples per peak bucket at the asset's sample rate. */
  bucket: number;
  sampleRate: number;
  duration: number;
  /** Interleaved min/max per bucket, mono mixdown, -1..1 */
  data: Float32Array;
}

export interface LoudnessResult {
  integrated: number; // LUFS
  shortTermMax: number; // LUFS
  momentaryMax: number; // LUFS
  range: number; // LU (LRA)
  truePeak: number; // dBTP
}

export class AudioEngine {
  private static instance: AudioEngine | null = null;
  static get(): AudioEngine {
    return (this.instance ??= new AudioEngine());
  }

  private startedAt = 0;
  private fromTime = 0;
  playing = false;

  /** The engine re-reads the document on every play; call when it changes while playing. */
  setProject(_project: Project, _sequenceId: string): void {}

  /** Starts audio at timeline time `from`; resolves once sound is scheduled. */
  async play(from: number, _rate = 1): Promise<void> {
    this.fromTime = from;
    this.startedAt = performance.now();
    this.playing = true;
  }

  stop(): void {
    this.playing = false;
  }

  /** Current timeline time according to the audio clock (only meaningful while playing). */
  currentTime(): number {
    return this.fromTime + (performance.now() - this.startedAt) / 1000;
  }

  meters(): { master: Meter; tracks: Record<string, Meter> } {
    const silent = { peakL: -Infinity, peakR: -Infinity, rmsL: -Infinity, rmsR: -Infinity };
    return { master: silent, tracks: {} };
  }
}

/** Waveform peaks for an asset, or null if not computed yet (call requestPeaks). */
export function getPeaks(_assetId: string): Peaks | null {
  return null;
}

/** Decodes the asset's audio (cached) and computes peaks. Resolves when ready. */
export async function requestPeaks(_project: Project, _assetId: string): Promise<Peaks | null> {
  return null;
}

/** Subscribe to "peaks ready" notifications (timeline redraws). */
export function onPeaks(_cb: (assetId: string) => void): () => void {
  return () => {};
}

/** Offline mixdown of [start, end) of a sequence, exactly as playback sounds. */
export async function renderMix(project: Project, _sequenceId: string, start: number, end: number, sampleRate?: number): Promise<AudioBuffer> {
  const sr = sampleRate ?? project.settings.sampleRate;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil((end - start) * sr)), sr);
  return ctx.startRendering();
}

/** ITU-R BS.1770-4 / EBU R128 loudness measurement. */
export function analyzeLoudness(_buffer: AudioBuffer): LoudnessResult {
  return { integrated: -Infinity, shortTermMax: -Infinity, momentaryMax: -Infinity, range: 0, truePeak: -Infinity };
}
