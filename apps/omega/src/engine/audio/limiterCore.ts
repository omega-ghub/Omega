// Lookahead, true-peak-aware brickwall limiter. One implementation serves the
// realtime master (inside an AudioWorklet), the offline mixdown (same
// worklet in an OfflineAudioContext) and export normalization
// (applyGainWithLimiter). Allocation-free after construction, as the realtime
// audio thread requires.
//
// Algorithm (stereo-linked):
//  1. Detector: per input sample, the larger of the sample peak and the four
//     BS.1770 4× interpolated points (TruePeakChannel), max over channels.
//  2. Required gain r = min(1, ceiling / peak), combined over the two samples
//     each interpolated segment touches.
//  3. Sliding minimum of r over L+1 detections (hold), then an L-tap moving
//     average (smooth attack that reaches the needed gain exactly when the
//     peak leaves the delay line), then a one-pole release that only slows
//     gain increases. Every stage keeps gain ≤ the requirement, so no sample
//     exceeds the ceiling; inter-sample overs are bounded by the gain
//     smoothness (verified by a final true-peak pass offline).
//  4. Audio is delayed by L + 6 samples (lookahead + interpolator latency).

import { TP_LATENCY, TruePeakChannel } from './truePeak';

/** Settings of the master-bus limiter (realtime and offline). */
export const LIMITER_LOOKAHEAD_MS = 3;
export const LIMITER_RELEASE_MS = 80;

/** Delay (frames) the master limiter adds at a sample rate. */
export function limiterLatencyFrames(sampleRate: number, lookaheadMs = LIMITER_LOOKAHEAD_MS): number {
  return Math.max(1, Math.round((lookaheadMs / 1000) * sampleRate)) + TP_LATENCY;
}

export interface LimiterOptions {
  lookaheadMs?: number;
  releaseMs?: number;
  /** Linear ceiling (e.g. 10^(−1/20) for −1 dBTP). */
  ceiling?: number;
  /** Detect inter-sample peaks (4× oversampled). */
  truePeak?: boolean;
}

export class LookaheadLimiter {
  readonly channels: number;
  readonly sampleRate: number;
  /** Total delay in samples between input and output. */
  readonly latency: number;
  private readonly L: number;
  private ceiling: number;
  private enabled = true;
  private readonly truePeak: boolean;
  private readonly releaseCoef: number;

  private readonly tp: TruePeakChannel[];
  // audio delay lines
  private readonly delay: Float32Array[];
  private dpos = 0;
  // detector raw sample-peak history for the non-true-peak path (latency alignment)
  private prevReq = 1;
  // sliding-min deque over required gains
  private readonly dqVal: Float64Array;
  private readonly dqIdx: Float64Array;
  private dqHead = 0;
  private dqLen = 0;
  private readonly dqCap: number;
  private detIndex = 0;
  // moving average of the held gain
  private readonly box: Float64Array;
  private boxPos = 0;
  private boxSum: number;
  private boxCount = 0;
  private gain = 1;
  /** Smallest gain applied since the last call to takeReduction() (for GR meters). */
  private minGain = 1;

  constructor(sampleRate: number, channels: number, opts: LimiterOptions = {}) {
    this.sampleRate = sampleRate;
    this.channels = Math.max(1, channels);
    this.L = Math.max(1, Math.round(((opts.lookaheadMs ?? 3) / 1000) * sampleRate));
    this.truePeak = opts.truePeak ?? true;
    this.ceiling = opts.ceiling ?? Math.pow(10, -1 / 20);
    this.releaseCoef = 1 - Math.exp(-1 / (((opts.releaseMs ?? 80) / 1000) * sampleRate));
    const det = this.truePeak ? TP_LATENCY : 0;
    this.latency = this.L + det;
    this.tp = Array.from({ length: this.channels }, () => new TruePeakChannel());
    this.delay = Array.from({ length: this.channels }, () => new Float32Array(this.latency + 1));
    this.dqCap = this.L + 4;
    this.dqVal = new Float64Array(this.dqCap);
    this.dqIdx = new Float64Array(this.dqCap);
    this.box = new Float64Array(this.L).fill(1);
    this.boxSum = this.L;
  }

  setCeiling(linear: number): void {
    this.ceiling = Math.max(1e-6, linear);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  /** Lowest gain applied since the previous call (1 = no reduction). */
  takeReduction(): number {
    const g = this.minGain;
    this.minGain = 1;
    return g;
  }

  reset(): void {
    for (const t of this.tp) t.reset();
    for (const d of this.delay) d.fill(0);
    this.dpos = 0;
    this.prevReq = 1;
    this.dqHead = 0;
    this.dqLen = 0;
    this.detIndex = 0;
    this.box.fill(1);
    this.boxSum = this.L;
    this.boxPos = 0;
    this.boxCount = 0;
    this.gain = 1;
    this.minGain = 1;
  }

  /**
   * Processes n frames. `input[c]` may be shorter than n or missing (silence).
   * `output[c]` receives the delayed, limited signal. preGain multiplies the
   * input first (used for export normalization).
   */
  process(input: ArrayLike<Float32Array | undefined>, output: ArrayLike<Float32Array>, n: number, preGain = 1, inOffset = 0, outOffset = 0): void {
    const C = this.channels;
    const D = this.latency + 1;
    for (let i = 0; i < n; i++) {
      // ---- detector
      let pk = 0;
      for (let c = 0; c < C; c++) {
        const src = input[c];
        const x = src && inOffset + i < src.length ? src[inOffset + i] * preGain : 0;
        // write to delay line
        this.delay[c][this.dpos] = x;
        let m: number;
        if (this.truePeak) m = this.tp[c].push(x);
        else m = x < 0 ? -x : x;
        if (m > pk) pk = m;
      }
      const ceil = this.ceiling;
      let req = this.enabled && pk > ceil ? ceil / pk : 1;
      // An interpolated segment touches two samples: require the gain for both.
      const both = req < this.prevReq ? req : this.prevReq;
      this.prevReq = req;
      req = both;

      // ---- sliding minimum over the last L+1 requirements (monotonic deque)
      const idx = this.detIndex++;
      while (this.dqLen > 0) {
        const tail = (this.dqHead + this.dqLen - 1) % this.dqCap;
        if (this.dqVal[tail] >= req) this.dqLen--;
        else break;
      }
      const ins = (this.dqHead + this.dqLen) % this.dqCap;
      this.dqVal[ins] = req;
      this.dqIdx[ins] = idx;
      this.dqLen++;
      while (this.dqIdx[this.dqHead] < idx - this.L - 1) {
        this.dqHead = (this.dqHead + 1) % this.dqCap;
        this.dqLen--;
      }
      const held = this.dqVal[this.dqHead];

      // ---- moving average (attack ramp)
      this.boxSum += held - this.box[this.boxPos];
      this.box[this.boxPos] = held;
      this.boxPos = this.boxPos + 1 === this.L ? 0 : this.boxPos + 1;
      if (++this.boxCount >= 8192) {
        // re-sum occasionally so floating-point drift never accumulates
        this.boxCount = 0;
        let s = 0;
        for (let k = 0; k < this.L; k++) s += this.box[k];
        this.boxSum = s;
      }
      let target = this.boxSum / this.L;
      if (target > 1) target = 1;

      // ---- release (only slows increases)
      let g = this.gain;
      g = target < g ? target : g + (target - g) * this.releaseCoef;
      this.gain = g;
      if (g < this.minGain) this.minGain = g;

      // ---- output the delayed sample
      const rd = (this.dpos + 1) % D;
      for (let c = 0; c < C; c++) {
        const out = output[c];
        if (out) out[outOffset + i] = this.delay[c][rd] * g;
      }
      this.dpos = rd;
    }
  }
}
