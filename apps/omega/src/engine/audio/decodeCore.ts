// Audio decoding core: Mediabunny (UrlSource + AudioSampleSink) to planar
// Float32 channels, down-mixed to at most stereo, with waveform peaks built
// on the way. No DOM or Web Audio types, so it runs in a dedicated Worker
// (decode.worker.ts) and, as a fallback, on the main thread.

import { ALL_FORMATS, AudioSampleSink, Input, UrlSource, type AudioSample } from 'mediabunny';
import { PeakBuilder, type Peaks } from './peaks';

export interface DecodeRequest {
  url: string;
  /** Source seconds to decode. */
  from: number;
  to: number;
  /** Build waveform peaks (whole-file decodes). */
  peaks: boolean;
  /** Keep the samples (false = peaks only). */
  retain: boolean;
  /** Probed duration, used when the container does not know its own. */
  durationHint: number;
}

export interface DecodeResult {
  ok: boolean;
  error?: string;
  /** True when the file has no decodable audio track. */
  noAudio?: boolean;
  sampleRate: number;
  /** Source seconds of frame 0. */
  start: number;
  length: number;
  channels: Float32Array[];
  peaks: Peaks[] | null;
}

const fail = (error: string, noAudio = false): DecodeResult => ({ ok: false, error, noAudio, sampleRate: 0, start: 0, length: 0, channels: [], peaks: null });

/** Cooperative yield that is not clamped like setTimeout on a busy page. */
export function yieldNow(): Promise<void> {
  const sch = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (sch?.yield) return sch.yield();
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
}

export async function decodeAudio(req: DecodeRequest, opts: { yieldEveryMs?: number } = {}): Promise<DecodeResult> {
  let input: Input | null = null;
  try {
    input = new Input({ source: new UrlSource(req.url), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track) return fail('no audio track', true);
    if (!(await track.canDecode())) return fail('audio codec cannot be decoded', true);
    const srcRate = await track.getSampleRate();
    let duration = req.durationHint;
    try {
      const d = await input.computeDuration();
      if (d > 0) duration = d;
    } catch {
      /* keep the hint */
    }
    const known = duration > 0 ? duration : Infinity;
    const startT = Math.max(0, req.from);
    const end = Math.min(req.to, known + 0.25);
    const span = Number.isFinite(end) ? end - startT : 60;
    const estimate = Math.max(1, Math.ceil(span * srcRate) + Math.ceil(srcRate * 0.05));
    const peaks = req.peaks ? new PeakBuilder(srcRate, estimate) : null;
    const sink = new AudioSampleSink(track);

    let chans: Float32Array[] = [];
    let cap = 0;
    let channels = 0;
    let writePos = -1; // frames relative to startT
    let maxWritten = 0;
    let tmp: Float32Array[] = [];
    let lastYield = performance.now();
    const yieldEvery = opts.yieldEveryMs ?? 0;

    const ensureCap = (need: number) => {
      if (!req.retain || need <= cap) return;
      const next = Math.max(need, Math.ceil(cap * 1.25));
      chans = chans.map((c) => {
        const n = new Float32Array(next);
        n.set(c);
        return n;
      });
      cap = next;
    };

    const planes = (s: AudioSample, n: number): Float32Array[] => {
      const C = s.numberOfChannels;
      if (tmp.length < C || tmp[0].length < n) tmp = Array.from({ length: Math.max(C, tmp.length) }, () => new Float32Array(Math.max(n, 4096)));
      for (let c = 0; c < C; c++) s.copyTo(tmp[c].subarray(0, n), { planeIndex: c, format: 'f32-planar' });
      if (C <= 2) return tmp.slice(0, C).map((t) => t.subarray(0, n));
      // 5.1 → stereo (Web Audio "speakers" down-mix); other layouts keep the first two channels.
      const L = tmp[0].subarray(0, n);
      const R = tmp[1].subarray(0, n);
      if (C >= 6) {
        const Cc = tmp[2];
        const SL = tmp[4];
        const SR = tmp[5];
        for (let i = 0; i < n; i++) {
          L[i] += Math.SQRT1_2 * (Cc[i] + SL[i]);
          R[i] += Math.SQRT1_2 * (Cc[i] + SR[i]);
        }
      }
      return [L, R];
    };

    for await (const sample of sink.samples(startT, end)) {
      try {
        const n = sample.numberOfFrames;
        const data = planes(sample, n);
        if (!channels) {
          channels = data.length;
          if (req.retain) {
            cap = estimate;
            chans = Array.from({ length: channels }, () => new Float32Array(cap));
          }
        }
        const pos = Math.round((sample.timestamp - startT) * srcRate);
        if (writePos < 0) {
          writePos = pos;
          if (peaks && pos > 0) peaks.pushSilence(pos);
        } else if (Math.abs(pos - writePos) > srcRate * 0.002) {
          // a gap (or overlap) in the stream: follow the timestamps
          if (peaks && pos > writePos) peaks.pushSilence(pos - writePos);
          writePos = pos;
        }
        const skip = writePos < 0 ? -writePos : 0;
        if (n > skip) {
          if (peaks) peaks.push(data.slice(0, channels), skip, n - skip);
          if (req.retain) {
            ensureCap(writePos + n);
            for (let c = 0; c < channels; c++) {
              const src = data[Math.min(c, data.length - 1)];
              chans[c].set(skip ? src.subarray(skip) : src, writePos + skip);
            }
          }
        }
        writePos += n;
        maxWritten = Math.max(maxWritten, writePos);
      } finally {
        sample.close();
      }
      if (yieldEvery > 0 && performance.now() - lastYield > yieldEvery) {
        await yieldNow();
        lastYield = performance.now();
      }
    }
    if (!channels) return fail('no decodable audio', true);
    const length = Math.max(1, req.retain ? Math.min(cap, maxWritten) : maxWritten);
    return {
      ok: true,
      sampleRate: srcRate,
      start: startT,
      length,
      channels: req.retain ? chans.map((c) => (c.length === length ? c : c.slice(0, length))) : [],
      peaks: peaks ? peaks.finish() : null,
    };
  } catch (err) {
    return fail((err as Error)?.message ?? String(err));
  } finally {
    try {
      input?.dispose();
    } catch {
      /* ignore */
    }
  }
}
