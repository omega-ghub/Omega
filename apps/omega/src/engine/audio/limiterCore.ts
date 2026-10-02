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

import { TP_LATENCY, TP_MAX_GAIN, TP_TAPS, TruePeakChannel } from './truePeak';

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
  /** Per channel: samples left during which inter-sample peaks could reach the ceiling. */
  private readonly hot: Int32Array;
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
    this.hot = new Int32Array(this.channels);
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
    this.hot.fill(0);
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
    const L = this.L;
    const cap = this.dqCap;
    const ceil = this.ceiling;
    const enabled = this.enabled;
    const truePeak = this.truePeak;
    const hotGate = ceil / TP_MAX_GAIN;
    const rel = this.releaseCoef;
    const dqVal = this.dqVal;
    const dqIdx = this.dqIdx;
    const box = this.box;
    const delay = this.delay;
    const tp = this.tp;
    const hot = this.hot;
    let dpos = this.dpos;
    let dqHead = this.dqHead;
    let dqLen = this.dqLen;
    let boxPos = this.boxPos;
    let boxSum = this.boxSum;
    let boxCount = this.boxCount;
    let gain = this.gain;
    let minGain = this.minGain;
    let prevReq = this.prevReq;
    let idx = this.detIndex;
    for (let i = 0; i < n; i++) {
      // ---- detector (stereo-linked)
      let pk = 0;
      for (let c = 0; c < C; c++) {
        const src = input[c];
        const k = inOffset + i;
        const x = src !== undefined && k < src.length ? src[k] * preGain : 0;
        delay[c][dpos] = x;
        const ax = x < 0 ? -x : x;
        let m = ax;
        if (truePeak) {
          // Interpolated values are bounded by TP_MAX_GAIN × the window's largest
          // sample: while every sample in the 12-tap window is that far below the
          // ceiling, no inter-sample peak can need gain reduction, so skip the FIR.
          const t = tp[c];
          t.write(x);
          if (ax >= hotGate) hot[c] = TP_TAPS + 1;
          if (hot[c] > 0) {
            hot[c]--;
            m = t.interp();
          }
        }
        if (m > pk) pk = m;
      }
      let req = enabled && pk > ceil ? ceil / pk : 1;
      // An interpolated segment touches two samples: require the gain for both.
      const both = req < prevReq ? req : prevReq;
      prevReq = req;
      req = both;

      // ---- sliding minimum over the last L+2 requirements (monotonic deque)
      while (dqLen > 0) {
        let tail = dqHead + dqLen - 1;
        if (tail >= cap) tail -= cap;
        if (dqVal[tail] >= req) dqLen--;
        else break;
      }
      let ins = dqHead + dqLen;
      if (ins >= cap) ins -= cap;
      dqVal[ins] = req;
      dqIdx[ins] = idx;
      dqLen++;
      const oldest = idx - L - 1;
      while (dqIdx[dqHead] < oldest) {
        dqHead++;
        if (dqHead === cap) dqHead = 0;
        dqLen--;
      }
      idx++;
      const held = dqVal[dqHead];

      // ---- moving average (attack ramp)
      boxSum += held - box[boxPos];
      box[boxPos] = held;
      boxPos++;
      if (boxPos === L) boxPos = 0;
      if (++boxCount >= 8192) {
        // re-sum occasionally so floating-point drift never accumulates
        boxCount = 0;
        let s = 0;
        for (let k = 0; k < L; k++) s += box[k];
        boxSum = s;
      }
      let target = boxSum / L;
      if (target > 1) target = 1;

      // ---- release (only slows increases)
      gain = target < gain ? target : gain + (target - gain) * rel;
      if (gain < minGain) minGain = gain;

      // ---- output the delayed sample
      let rd = dpos + 1;
      if (rd === D) rd = 0;
      for (let c = 0; c < C; c++) {
        const out = output[c];
        if (out !== undefined) out[outOffset + i] = delay[c][rd] * gain;
      }
      dpos = rd;
    }
    this.dpos = dpos;
    this.dqHead = dqHead;
    this.dqLen = dqLen;
    this.boxPos = boxPos;
    this.boxSum = boxSum;
    this.boxCount = boxCount;
    this.gain = gain;
    this.minGain = minGain;
    this.prevReq = prevReq;
    this.detIndex = idx;
  }
}
