// Export audio: offline mixdown of the range through the audio package's
// renderMix (exactly as playback sounds), optional loudness normalization,
// and delivery to the encoder in short, sample-exact pieces so audio can be
// interleaved with video and long programs never sit in memory whole.
//
//   programs ≤ 10 min: one renderMix call (cached for both passes)
//   longer programs:   2-minute chunks, rendered once to measure and again
//                      to encode; the limiter keeps its state across chunks.
//
// Normalization measures integrated loudness (the audio package's
// analyzeLoudness when it reports a value, else our streaming BS.1770 meter),
// applies target − measured gain, and holds the true peak under the ceiling
// with a lookahead limiter (the audio package's applyGainWithLimiter for a
// single buffer when it is exported, else ours).

import * as audioEngine from '../audio/engine';
import type { Project } from '../../state/types';
import { audioChunks, sampleCount } from './plan';
import { LoudnessMeter, measureLoudness, normalizationGainDb, TruePeakLimiter } from './loudness';
import type { LoudnessSettings, TimeRange } from './types';
import { ExportFailed, exportDebug, throwIfAborted, yieldToEventLoop } from './util';

const SINGLE_MAX_SECONDS = 10 * 60;
const CHUNK_SECONDS = 120;
const PIECE_SECONDS = 4;

type Planar = Float32Array[];

interface BufferLike {
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}

type AnalyzeFn = (buffer: BufferLike) => { integrated: number; truePeak: number };
type LimitFn = (buffer: BufferLike, gainDb: number, ceilingDbtp: number) => unknown;

/** Optional audio-package exports, detected at runtime (they may not exist yet). */
function engineFn<T>(name: string): T | null {
  const fn = (audioEngine as unknown as Record<string, unknown>)[name];
  return typeof fn === 'function' ? (fn as T) : null;
}

function shim(planar: Planar, sampleRate: number): BufferLike {
  return { numberOfChannels: planar.length, sampleRate, length: planar[0]?.length ?? 0, getChannelData: (c) => planar[c] };
}

export interface LoudnessReport {
  measuredLufs: number;
  measuredTruePeak: number;
  gainDb: number;
  resultLufs?: number;
  resultTruePeak?: number;
}

export class AudioProgram {
  readonly totalSamples: number;
  private readonly single: boolean;
  private cache: Planar | null = null;
  private gainDb: number | null = null;
  report: LoudnessReport | null = null;
  readonly notes: string[] = [];
  /** Cancels mixdowns in flight. */
  signal?: AbortSignal;

  constructor(
    private readonly project: Project,
    private readonly sequenceId: string,
    private readonly range: TimeRange,
    readonly sampleRate: number,
    readonly channels: 1 | 2,
    private readonly loudness: LoudnessSettings,
  ) {
    this.totalSamples = sampleCount(range, sampleRate);
    this.single = this.totalSamples <= SINGLE_MAX_SECONDS * sampleRate;
  }

  get duration(): number {
    return this.totalSamples / this.sampleRate;
  }

  /** Renders [from, to) samples of the range, exactly to - from samples long. */
  private async render(from: number, to: number): Promise<Planar> {
    const sr = this.sampleRate;
    let buf: AudioBuffer;
    const t0 = performance.now();
    try {
      buf = await audioEngine.renderMix(this.project, this.sequenceId, this.range.start + from / sr, this.range.start + to / sr, sr, undefined, this.signal);
      exportDebug('renderMix', `${((to - from) / sr).toFixed(1)} s`, `${(performance.now() - t0).toFixed(0)} ms`);
    } catch (err) {
      throwIfAborted(this.signal);
      throw new ExportFailed(`The audio mixdown failed: ${(err as Error).message}`);
    }
    const len = to - from;
    const n = Math.max(1, buf.numberOfChannels);
    const out: Planar = [];
    for (let c = 0; c < n; c++) {
      const data = new Float32Array(len);
      if (c < buf.numberOfChannels) {
        const src = buf.getChannelData(c);
        data.set(src.length > len ? src.subarray(0, len) : src);
      }
      out.push(data);
    }
    return out;
  }

  /** Pass 1 (only when normalizing): measure the program's loudness. */
  async analyze(onFraction: (f: number) => void, signal?: AbortSignal): Promise<void> {
    if (!this.loudness.normalize) return;
    let measured: { integrated: number; truePeak: number };
    if (this.single) {
      this.cache = await this.render(0, this.totalSamples);
      throwIfAborted(signal);
      onFraction(0.5);
      const analyze = engineFn<AnalyzeFn>('analyzeLoudness');
      let r: { integrated: number; truePeak: number } | null = null;
      try {
        r = analyze ? analyze(shim(this.cache, this.sampleRate)) : null;
      } catch {
        r = null;
      }
      measured = r && Number.isFinite(r.integrated) ? r : measureLoudness(this.cache, this.sampleRate);
    } else {
      let meter: LoudnessMeter | null = null;
      const chunks = audioChunks(this.totalSamples, this.sampleRate, CHUNK_SECONDS);
      for (let i = 0; i < chunks.length; i++) {
        throwIfAborted(signal);
        const planar = await this.render(chunks[i].from, chunks[i].to);
        meter ??= new LoudnessMeter(this.sampleRate, planar.length);
        meter.push(planar);
        onFraction((i + 1) / chunks.length);
        await yieldToEventLoop();
      }
      measured = meter ? meter.result() : { integrated: -Infinity, truePeak: -Infinity };
    }
    onFraction(1);
    const gain = normalizationGainDb(measured.integrated, this.loudness.targetLufs);
    if (gain === null) {
      this.notes.push('Loudness normalization skipped: the mix is silent in this range.');
      return;
    }
    this.gainDb = gain;
    this.report = { measuredLufs: measured.integrated, measuredTruePeak: measured.truePeak, gainDb: gain };
    if (this.loudness.targetLufs - measured.integrated > gain + 0.05) this.notes.push(`Loudness gain capped at +${gain.toFixed(1)} dB; the result stays below the ${this.loudness.targetLufs} LUFS target.`);
  }

  /**
   * Pass 2: processed audio as consecutive AudioBuffers of ≤ 4 s, covering
   * exactly totalSamples. Measures the result when normalizing.
   */
  async *pieces(signal?: AbortSignal): AsyncGenerator<AudioBuffer> {
    const sr = this.sampleRate;
    const gain = this.gainDb;
    const ceiling = this.loudness.truePeakDbtp;
    const verify = gain !== null ? new LoudnessMeter(sr, this.channels) : null;
    const engineLimit = engineFn<LimitFn>('applyGainWithLimiter');
    let limiter: TruePeakLimiter | null = null;

    const emit = (planar: Planar) => this.slices(planar, verify);

    if (this.single) {
      const planar = this.cache ?? (await this.render(0, this.totalSamples));
      this.cache = null;
      throwIfAborted(signal);
      if (gain !== null) {
        if (engineLimit) {
          engineLimit(shim(planar, sr), gain, ceiling);
        } else {
          limiter = new TruePeakLimiter({ sampleRate: sr, channels: planar.length, gainDb: gain, ceilingDb: ceiling });
          const a = limiter.process(planar);
          const b = limiter.flush();
          for (let c = 0; c < planar.length; c++) {
            planar[c].set(a[c], 0);
            planar[c].set(b[c], a[c].length);
          }
        }
      }
      yield* emit(planar);
    } else {
      const chunks = audioChunks(this.totalSamples, sr, CHUNK_SECONDS);
      for (const ch of chunks) {
        throwIfAborted(signal);
        const planar = await this.render(ch.from, ch.to);
        if (gain !== null) {
          limiter ??= new TruePeakLimiter({ sampleRate: sr, channels: planar.length, gainDb: gain, ceilingDb: ceiling });
          const out = limiter.process(planar);
          if (out[0].length) yield* emit(out);
        } else {
          yield* emit(planar);
        }
        await yieldToEventLoop();
      }
      if (limiter) {
        const tail = limiter.flush();
        if (tail[0].length) yield* emit(tail);
      }
    }
    if (verify && this.report) {
      const r = verify.result();
      this.report.resultLufs = r.integrated;
      this.report.resultTruePeak = r.truePeak;
    }
  }

  private *slices(planar: Planar, verify: LoudnessMeter | null): Generator<AudioBuffer> {
    const sr = this.sampleRate;
    const shaped = this.shape(planar);
    verify?.push(shaped);
    const len = shaped[0]?.length ?? 0;
    const step = PIECE_SECONDS * sr;
    for (let o = 0; o < len; o += step) {
      const n = Math.min(step, len - o);
      const ab = new AudioBuffer({ length: n, numberOfChannels: this.channels, sampleRate: sr });
      for (let c = 0; c < this.channels; c++) ab.copyToChannel(shaped[c].subarray(o, o + n) as Float32Array<ArrayBuffer>, c);
      yield ab;
    }
  }

  /** Down- or up-mix to the output channel count. */
  private shape(planar: Planar): Planar {
    if (planar.length === this.channels) return planar;
    const len = planar[0]?.length ?? 0;
    if (this.channels === 1) {
      const mono = new Float32Array(len);
      for (const ch of planar) for (let i = 0; i < len; i++) mono[i] += ch[i] / planar.length;
      return [mono];
    }
    return [planar[0], planar[0]];
  }
}
