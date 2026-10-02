// True-peak estimation, ITU-R BS.1770-4 Annex 2: 4× oversampling with the
// 48-tap (4 phases × 12 taps) polyphase interpolation FIR given in the
// recommendation. Pure and allocation-free per sample, so the same code runs
// in the loudness analyzer, the offline limiter and the realtime AudioWorklet.

/** Phase coefficients from BS.1770-4 Annex 2 (phases 2 and 3 mirror 1 and 0). */
const PHASE0 = [
  0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875, 0.1373291015625, 0.97216796875, -0.102294921875, 0.047607421875, -0.026611328125,
  0.014892578125, -0.00830078125,
];
const PHASE1 = [
  -0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625, 0.465087890625, 0.77978515625, -0.2003173828125, 0.1015625, -0.0582275390625,
  0.0330810546875, -0.0189208984375,
];

export const TP_TAPS = 12;
/** Interpolated points at time n lie between input samples n−6 and n−5. */
export const TP_LATENCY = 6;

/** Flat [phase][tap] table: P[r * 12 + j] multiplies x[n − j]. */
export const TP_COEFS: Float64Array = (() => {
  const t = new Float64Array(4 * TP_TAPS);
  for (let j = 0; j < TP_TAPS; j++) {
    t[0 * TP_TAPS + j] = PHASE0[j];
    t[1 * TP_TAPS + j] = PHASE1[j];
    t[2 * TP_TAPS + j] = PHASE1[TP_TAPS - 1 - j];
    t[3 * TP_TAPS + j] = PHASE0[TP_TAPS - 1 - j];
  }
  return t;
})();

/** Largest Σ|h| over the phases: an upper bound on |interpolated| / max|x| in the window. */
export const TP_MAX_GAIN = (() => {
  let best = 0;
  for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let j = 0; j < TP_TAPS; j++) s += Math.abs(TP_COEFS[r * TP_TAPS + j]);
    best = Math.max(best, s);
  }
  return best;
})();

/**
 * Streaming 4× interpolator for one channel. push(x) returns the largest
 * absolute value among the four interpolated points between x[n−6] and
 * x[n−5] and those two samples themselves.
 */
export class TruePeakChannel {
  private hist = new Float64Array(TP_TAPS * 2);
  private pos = 0;

  reset(): void {
    this.hist.fill(0);
    this.pos = 0;
  }

  push(x: number): number {
    // Mirror-buffer ring: hist[pos] and hist[pos + 12] both hold the newest sample,
    // so hist[pos .. pos + 11] is always contiguous, newest first.
    this.pos = this.pos === 0 ? TP_TAPS - 1 : this.pos - 1;
    const h = this.hist;
    const p = this.pos;
    h[p] = x;
    h[p + TP_TAPS] = x;
    let m = 0;
    const c = TP_COEFS;
    for (let r = 0; r < 4; r++) {
      const o = r * TP_TAPS;
      let acc = 0;
      for (let j = 0; j < TP_TAPS; j++) acc += c[o + j] * h[p + j];
      const a = acc < 0 ? -acc : acc;
      if (a > m) m = a;
    }
    const s0 = h[p + TP_LATENCY];
    const s1 = h[p + TP_LATENCY - 1];
    const a0 = s0 < 0 ? -s0 : s0;
    const a1 = s1 < 0 ? -s1 : s1;
    if (a0 > m) m = a0;
    if (a1 > m) m = a1;
    return m;
  }
}

/**
 * True peak (linear) of a whole signal. Blocks whose samples cannot possibly
 * produce an inter-sample value above the running maximum are skipped, which
 * keeps hour-long programs fast.
 */
export function truePeakOf(channels: Float32Array[], length = channels[0]?.length ?? 0): number {
  let best = 0;
  const BLOCK = 256;
  for (const data of channels) {
    const n = Math.min(length, data.length);
    const tp = new TruePeakChannel();
    let i = 0;
    while (i < n) {
      const end = Math.min(n, i + BLOCK);
      // Window that influences this block's interpolated points.
      let localMax = 0;
      for (let k = Math.max(0, i - TP_TAPS); k < Math.min(n, end + TP_TAPS); k++) {
        const v = data[k] < 0 ? -data[k] : data[k];
        if (v > localMax) localMax = v;
      }
      if (localMax * TP_MAX_GAIN <= best && i > 0) {
        // Cannot beat the running max: still feed the history (cheaply) for continuity.
        tp.reset();
        const from = Math.max(0, end - TP_TAPS);
        for (let k = from; k < end; k++) tp.push(data[k]);
        i = end;
        continue;
      }
      for (; i < end; i++) {
        const m = tp.push(data[i]);
        if (m > best) best = m;
      }
    }
    // Flush the filter tail so the last samples are interpolated too.
    for (let k = 0; k < TP_TAPS; k++) {
      const m = tp.push(0);
      if (m > best) best = m;
    }
  }
  return best;
}
