// Loudness measurement per ITU-R BS.1770-4 and EBU R 128 (Tech 3341 / 3342),
// plus export normalization helpers. Pure math on Float32Arrays: it runs in
// Node unit tests and on AudioBuffers alike.
//
//  * K-weighting: stage 1 high shelf + stage 2 RLB high-pass. Coefficients are
//    derived from the analog prototypes for ANY sample rate (they reproduce the
//    48 kHz table of BS.1770 to ~1e-8).
//  * Gating blocks: 400 ms, 75% overlap (100 ms hop). Absolute gate −70 LUFS,
//    relative gate −10 LU → integrated loudness.
//  * Momentary (400 ms) and short-term (3 s) maxima, refreshed every 100 ms.
//  * LRA (Tech 3342): 3 s short-term values every 100 ms, absolute gate −70,
//    relative gate −20 LU, 10th–95th percentile spread.
//  * True peak: 4× polyphase FIR from BS.1770-4 Annex 2, in dBTP.

import { LookaheadLimiter } from './limiterCore';
import { truePeakOf } from './truePeak';

/** Anything shaped like an AudioBuffer (AudioBuffer itself, or a test shim). */
export interface AudioBufferLike {
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}

export interface LoudnessResult {
  integrated: number; // LUFS
  shortTermMax: number; // LUFS
  momentaryMax: number; // LUFS
  range: number; // LU (LRA)
  truePeak: number; // dBTP
  /** Highest sample peak, dBFS. */
  samplePeak?: number;
  /** Short-term loudness every 100 ms (LUFS, −Infinity when silent), for graphs. */
  shortTerm?: Float32Array;
  /** Momentary loudness every 100 ms (LUFS). */
  momentary?: Float32Array;
  /** Seconds analyzed. */
  duration?: number;
}

// ---------------------------------------------------------------------------
// K-weighting
// ---------------------------------------------------------------------------

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The two K-weighting biquads for a sample rate (libebur128 / BS.1770 analog prototypes). */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // Stage 1: high shelf (+4 dB above ~1.7 kHz, head-related)
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // Stage 2: RLB high-pass (~38 Hz)
  const f1 = 38.13547087602444;
  const Q1 = 0.5003270373238773;
  K = Math.tan((Math.PI * f1) / sampleRate);
  a0 = 1 + K / Q1 + K * K;
  const s2: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q1 + K * K) / a0 };
  return [s1, s2];
}

/** BS.1770 channel weights. 5.1 (L R C LFE Ls Rs): LFE excluded, surrounds +1.5 dB. */
export function channelWeights(n: number): number[] {
  if (n === 6) return [1, 1, 1, 0, 1.41, 1.41];
  if (n === 5) return [1, 1, 1, 1.41, 1.41];
  return new Array(n).fill(1);
}

const ABS_GATE = -70;
const REL_GATE_I = -10;
const REL_GATE_LRA = -20;

const lufs = (meanSquare: number) => (meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : -Infinity);

// ---------------------------------------------------------------------------
// Streaming meter
// ---------------------------------------------------------------------------

/**
 * Streaming BS.1770 meter: push audio in any chunk sizes, then read result().
 * Memory is O(duration / 100 ms), never a copy of the signal.
 */
export class LoudnessMeter {
  readonly sampleRate: number;
  readonly channels: number;
  private readonly weights: number[];
  private readonly k: [Biquad, Biquad];
  // filter state per channel: [x1, x2, y1, y2] for each stage
  private readonly st: Float64Array;
  private readonly acc: Float64Array; // energy of the current 100 ms sub-block per channel
  private subIndex = 0; // index of the current sub-block
  private subFilled = 0; // samples in the current sub-block
  private nextBoundary: number; // sample count where the current sub-block ends
  private total = 0; // samples pushed
  /** Weighted energy sum (Σ G_i Σ x²) and sample count per completed 100 ms sub-block. */
  private subEnergy: number[] = [];
  private subCount: number[] = [];
  private samplePeak = 0;

  constructor(sampleRate: number, channels: number) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.weights = channelWeights(channels);
    this.k = kWeighting(sampleRate);
    this.st = new Float64Array(channels * 8);
    this.acc = new Float64Array(channels);
    this.nextBoundary = this.boundary(1);
  }

  private boundary(i: number): number {
    return Math.round((i * this.sampleRate) / 10);
  }

  /** Feed `length` frames starting at `offset` of each channel array. */
  push(channels: Float32Array[], offset = 0, length = (channels[0]?.length ?? 0) - offset): void {
    const C = this.channels;
    const [s1, s2] = this.k;
    let done = 0;
    while (done < length) {
      const room = this.nextBoundary - this.total;
      const n = Math.min(room, length - done);
      for (let c = 0; c < C; c++) {
        const data = channels[c];
        if (!data) continue;
        const o = c * 8;
        let x1 = this.st[o];
        let x2 = this.st[o + 1];
        let y1 = this.st[o + 2];
        let y2 = this.st[o + 3];
        let u1 = this.st[o + 4];
        let u2 = this.st[o + 5];
        let z1 = this.st[o + 6];
        let z2 = this.st[o + 7];
        let e = 0;
        let pk = this.samplePeak;
        const base = offset + done;
        for (let i = 0; i < n; i++) {
          const x = data[base + i];
          const ax = x < 0 ? -x : x;
          if (ax > pk) pk = ax;
          const y = s1.b0 * x + s1.b1 * x1 + s1.b2 * x2 - s1.a1 * y1 - s1.a2 * y2;
          x2 = x1;
          x1 = x;
          y2 = y1;
          y1 = y;
          const z = s2.b0 * y + s2.b1 * u1 + s2.b2 * u2 - s2.a1 * z1 - s2.a2 * z2;
          u2 = u1;
          u1 = y;
          z2 = z1;
          z1 = z;
          e += z * z;
        }
        this.samplePeak = pk;
        this.st[o] = x1;
        this.st[o + 1] = x2;
        this.st[o + 2] = y1;
        this.st[o + 3] = y2;
        this.st[o + 4] = u1;
        this.st[o + 5] = u2;
        // denormal guard
        this.st[o + 6] = Math.abs(z1) < 1e-30 ? 0 : z1;
        this.st[o + 7] = Math.abs(z2) < 1e-30 ? 0 : z2;
        this.acc[c] += e;
      }
      done += n;
      this.total += n;
      this.subFilled += n;
      if (this.total >= this.nextBoundary) this.closeSubBlock();
    }
  }

  private closeSubBlock(): void {
    let e = 0;
    for (let c = 0; c < this.channels; c++) {
      e += this.weights[c] * this.acc[c];
      this.acc[c] = 0;
    }
    this.subEnergy.push(e);
    this.subCount.push(this.subFilled);
    this.subFilled = 0;
    this.subIndex++;
    this.nextBoundary = this.boundary(this.subIndex + 1);
  }

  /** Loudness of windows of `subs` × 100 ms, one per 100 ms hop (only complete windows). */
  private windows(subs: number): Float64Array {
    const E = this.subEnergy;
    const N = this.subCount;
    const count = Math.max(0, E.length - subs + 1);
    const out = new Float64Array(count); // mean squares (weighted)
    let e = 0;
    let n = 0;
    for (let i = 0; i < E.length; i++) {
      e += E[i];
      n += N[i];
      if (i >= subs) {
        e -= E[i - subs];
        n -= N[i - subs];
      }
      if (i >= subs - 1) out[i - subs + 1] = n > 0 ? Math.max(0, e) / n : 0;
    }
    return out;
  }

  result(opts: { truePeak?: number; series?: boolean } = {}): LoudnessResult {
    const blocks = this.windows(4); // 400 ms gating blocks / momentary
    const st = this.windows(30); // 3 s short-term

    // Integrated (two-stage gating)
    let integrated = -Infinity;
    {
      let sum = 0;
      let cnt = 0;
      for (const z of blocks)
        if (lufs(z) > ABS_GATE) {
          sum += z;
          cnt++;
        }
      if (cnt > 0) {
        const rel = lufs(sum / cnt) + REL_GATE_I;
        let s2 = 0;
        let c2 = 0;
        for (const z of blocks) {
          const l = lufs(z);
          if (l > ABS_GATE && l > rel) {
            s2 += z;
            c2++;
          }
        }
        if (c2 > 0) integrated = lufs(s2 / c2);
      }
    }

    let momentaryMax = -Infinity;
    for (const z of blocks) momentaryMax = Math.max(momentaryMax, lufs(z));
    let shortTermMax = -Infinity;
    for (const z of st) shortTermMax = Math.max(shortTermMax, lufs(z));

    const range = loudnessRange(st);
    const tp = opts.truePeak ?? this.samplePeak;
    const res: LoudnessResult = {
      integrated,
      shortTermMax,
      momentaryMax,
      range,
      truePeak: tp > 0 ? 20 * Math.log10(tp) : -Infinity,
      samplePeak: this.samplePeak > 0 ? 20 * Math.log10(this.samplePeak) : -Infinity,
      duration: this.total / this.sampleRate,
    };
    if (opts.series !== false) {
      res.shortTerm = Float32Array.from(st, lufs);
      res.momentary = Float32Array.from(blocks, lufs);
    }
    return res;
  }
}

/** EBU Tech 3342 loudness range from short-term mean squares (one per 100 ms). */
export function loudnessRange(shortTermMeanSquares: ArrayLike<number>): number {
  const vals: number[] = [];
  let sum = 0;
  for (let i = 0; i < shortTermMeanSquares.length; i++) {
    const z = shortTermMeanSquares[i];
    if (lufs(z) > ABS_GATE) {
      vals.push(z);
      sum += z;
    }
  }
  if (!vals.length) return 0;
  const rel = lufs(sum / vals.length) + REL_GATE_LRA;
  const gated = vals.map(lufs).filter((l) => l > rel);
  if (gated.length < 2) return 0;
  gated.sort((a, b) => a - b);
  return percentile(gated, 0.95) - percentile(gated, 0.1);
}

/** Linear-interpolated percentile of a sorted array. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const x = p * (sorted.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return i + 1 < sorted.length ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i];
}

function channelsOf(buffer: AudioBufferLike): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
}

/** ITU-R BS.1770-4 / EBU R128 loudness measurement of a whole buffer. */
export function analyzeLoudness(buffer: AudioBufferLike): LoudnessResult {
  const chans = channelsOf(buffer);
  const meter = new LoudnessMeter(buffer.sampleRate, buffer.numberOfChannels);
  meter.push(chans, 0, buffer.length);
  return meter.result({ truePeak: truePeakOf(chans, buffer.length) });
}

/**
 * Same as analyzeLoudness but yields to the event loop every few seconds of
 * audio so the UI stays responsive on long programs.
 */
export async function analyzeLoudnessAsync(buffer: AudioBufferLike, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<LoudnessResult> {
  const chans = channelsOf(buffer);
  const meter = new LoudnessMeter(buffer.sampleRate, buffer.numberOfChannels);
  const step = buffer.sampleRate * 20;
  for (let o = 0; o < buffer.length; o += step) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    meter.push(chans, o, Math.min(step, buffer.length - o));
    onProgress?.((o / buffer.length) * 0.7);
    await new Promise((r) => setTimeout(r, 0));
  }
  let tp = 0;
  for (let c = 0; c < chans.length; c++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    tp = Math.max(tp, truePeakOf([chans[c]], buffer.length));
    onProgress?.(0.7 + (0.3 * (c + 1)) / chans.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return meter.result({ truePeak: tp });
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Gain (dB) that brings the program to `targetLufs` without pushing the true
 * peak above `truePeakCeiling` (dBTP). When the ceiling wins, the result is
 * quieter than the target; use applyGainWithLimiter to reach the target anyway.
 */
export function normalizeGain(result: LoudnessResult, targetLufs: number, truePeakCeiling: number): number {
  if (!Number.isFinite(result.integrated)) return 0;
  const toTarget = targetLufs - result.integrated;
  if (Number.isFinite(result.truePeak) && result.truePeak + toTarget > truePeakCeiling) return truePeakCeiling - result.truePeak;
  return toTarget;
}

export interface NormalizationPlan {
  /** Gain that hits the loudness target. */
  targetGainDb: number;
  /** Largest gain that keeps the true peak under the ceiling without limiting. */
  safeGainDb: number;
  /** True when hitting the target needs peak limiting. */
  needsLimiter: boolean;
  /** Estimated true peak after the target gain, before limiting. */
  peakAfterDb: number;
}

export function planNormalization(result: LoudnessResult, targetLufs: number, truePeakCeiling: number): NormalizationPlan {
  const targetGainDb = Number.isFinite(result.integrated) ? targetLufs - result.integrated : 0;
  const safeGainDb = normalizeGain(result, targetLufs, truePeakCeiling);
  const peakAfterDb = result.truePeak + targetGainDb;
  return { targetGainDb, safeGainDb, needsLimiter: Number.isFinite(peakAfterDb) && peakAfterDb > truePeakCeiling, peakAfterDb };
}

/**
 * Applies `gainDb` to the buffer IN PLACE, through a lookahead true-peak
 * limiter that holds peaks at `ceilingDbtp`. A final true-peak check trims
 * any residual inter-sample over, so the result measures ≤ the ceiling.
 * Returns the same buffer.
 */
export function applyGainWithLimiter<T extends AudioBufferLike>(buffer: T, gainDb: number, ceilingDbtp: number, opts: { lookaheadMs?: number; releaseMs?: number } = {}): T {
  const chans = channelsOf(buffer);
  const n = buffer.length;
  if (!n || !chans.length) return buffer;
  const ceiling = Math.pow(10, ceilingDbtp / 20);
  // Aim a hair under the ceiling: the interpolator's passband ripple is ~±0.1 dB.
  const lim = new LookaheadLimiter(buffer.sampleRate, chans.length, {
    lookaheadMs: opts.lookaheadMs ?? 3,
    releaseMs: opts.releaseMs ?? 80,
    ceiling: ceiling * Math.pow(10, -0.1 / 20),
    truePeak: true,
  });
  const pre = Math.pow(10, gainDb / 20);
  const L = lim.latency;
  const CH = 4096;
  const tmpIn = chans.map(() => new Float32Array(CH));
  const tmpOut = chans.map(() => new Float32Array(CH));
  // Run the input plus L samples of silence through the limiter; output lags by L.
  for (let pos = 0; pos < n + L; pos += CH) {
    const len = Math.min(CH, n + L - pos);
    for (let c = 0; c < chans.length; c++) {
      const src = chans[c];
      const t = tmpIn[c];
      for (let i = 0; i < len; i++) t[i] = pos + i < n ? src[pos + i] : 0;
    }
    lim.process(tmpIn, tmpOut, len, pre);
    for (let c = 0; c < chans.length; c++) {
      const dst = chans[c];
      const t = tmpOut[c];
      for (let i = 0; i < len; i++) {
        const o = pos + i - L;
        if (o >= 0 && o < n) dst[o] = t[i];
      }
    }
  }
  const tp = truePeakOf(chans, n);
  if (tp > ceiling) {
    const trim = ceiling / tp;
    for (const d of chans) for (let i = 0; i < n; i++) d[i] *= trim;
  }
  return buffer;
}
