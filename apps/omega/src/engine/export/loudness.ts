// Loudness tools for export, working on planar Float32Array channels so they
// stream over long programs in chunks (and run in Node for tests):
//  - LoudnessMeter: ITU-R BS.1770-4 integrated loudness (K-weighting,
//    400 ms blocks with 75% overlap, -70 LUFS absolute and -10 LU relative
//    gates) plus 4× oversampled true peak.
//  - TruePeakLimiter: lookahead, true-peak-aware brickwall limiter that keeps
//    its state across chunks, so a chunked program is limited exactly like a
//    single buffer.
// The audio package's analyzeLoudness() is preferred for whole buffers when it
// is available; these are the streaming fallback used by the exporter.

// ---------------------------------------------------------------------------
// 4× interpolation (inter-sample peaks)
// ---------------------------------------------------------------------------

const HALF = 6; // taps on each side: x[n-5..n+6]
const FRACTIONS = [0.25, 0.5, 0.75];

/** Hann-windowed sinc coefficients for fractional positions n+0.25/0.5/0.75 (12 taps each, unity DC gain). */
const PHASE_COEFS: Float64Array[] = FRACTIONS.map((f) => {
  const h = new Float64Array(2 * HALF);
  let sum = 0;
  for (let j = -HALF + 1; j <= HALF; j++) {
    const d = j - f;
    const sinc = Math.abs(d) < 1e-12 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d);
    const w = 0.5 * (1 + Math.cos((Math.PI * d) / (HALF + 0.5)));
    h[j + HALF - 1] = sinc * w;
    sum += sinc * w;
  }
  for (let k = 0; k < h.length; k++) h[k] /= sum;
  return h;
});

/**
 * Peak magnitude over [n, n+1) of a channel: the sample itself and three
 * interpolated points. Reads x[n-5..n+6]; indices outside [0, len) read 0.
 */
export function intervalPeak(x: Float32Array, n: number, len = x.length): number {
  let peak = Math.abs(x[n]);
  const lo = n - HALF + 1;
  const safe = lo >= 0 && n + HALF < len;
  for (let p = 0; p < 3; p++) {
    const h = PHASE_COEFS[p];
    let acc = 0;
    if (safe) {
      for (let k = 0; k < 2 * HALF; k++) acc += h[k] * x[lo + k];
    } else {
      for (let k = 0; k < 2 * HALF; k++) {
        const i = lo + k;
        if (i >= 0 && i < len) acc += h[k] * x[i];
      }
    }
    const a = Math.abs(acc);
    if (a > peak) peak = a;
  }
  return peak;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(g: number): number {
  return g > 0 ? 20 * Math.log10(g) : -Infinity;
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  if (!a.length) return b;
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// ---------------------------------------------------------------------------
// BS.1770 K-weighting
// ---------------------------------------------------------------------------

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** K-weighting stages for any sample rate (same derivation as libebur128). */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const highpass: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, highpass];
}

export interface StreamingLoudness {
  integrated: number; // LUFS (-Infinity when silent)
  truePeak: number; // dBTP
  samplePeak: number; // dBFS
}

/** Streaming BS.1770-4 integrated loudness and true peak. */
export class LoudnessMeter {
  private readonly stages: [Biquad, Biquad];
  /** Per channel: [z1, z2] for each stage (direct form II transposed). */
  private readonly state: Float64Array[];
  private readonly sub: number; // samples per 100 ms sub-block
  private subFill = 0;
  private subAcc: Float64Array; // per-channel sum of squares in the current sub-block
  /** Mean-square energy (weighted channel sum) per completed 100 ms sub-block. */
  private readonly subBlocks: number[] = [];
  private tp = 0;
  private sp = 0;
  private tail: Float32Array[];
  private tailStart = 0; // index in tail of the first sample not yet checked for peaks

  constructor(
    readonly sampleRate: number,
    readonly channels: number,
  ) {
    this.stages = kWeighting(sampleRate);
    this.state = Array.from({ length: channels }, () => new Float64Array(4));
    this.sub = Math.max(1, Math.round(sampleRate / 10));
    this.subAcc = new Float64Array(channels);
    this.tail = Array.from({ length: channels }, () => new Float32Array(0));
  }

  push(input: Float32Array[]): void {
    const len = input[0]?.length ?? 0;
    const [s1, s2] = this.stages;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < this.channels; c++) {
        const x = input[Math.min(c, input.length - 1)][i];
        const st = this.state[c];
        // stage 1
        const y1 = s1.b0 * x + st[0];
        st[0] = s1.b1 * x - s1.a1 * y1 + st[1];
        st[1] = s1.b2 * x - s1.a2 * y1;
        // stage 2
        const y2 = s2.b0 * y1 + st[2];
        st[2] = s2.b1 * y1 - s2.a1 * y2 + st[3];
        st[3] = s2.b2 * y1 - s2.a2 * y2;
        this.subAcc[c] += y2 * y2;
      }
      if (++this.subFill === this.sub) {
        let e = 0;
        for (let c = 0; c < this.channels; c++) e += this.subAcc[c] / this.sub;
        this.subBlocks.push(e);
        this.subAcc.fill(0);
        this.subFill = 0;
      }
    }
    // True peak: interpolate with 5 samples of history and defer the last 6.
    let nextStart = this.tailStart;
    for (let c = 0; c < this.channels; c++) {
      const x = concat(this.tail[c], input[Math.min(c, input.length - 1)]);
      const start = this.tailStart;
      const end = x.length - HALF;
      for (let n = start; n < end; n++) {
        const p = intervalPeak(x, n, x.length);
        if (p > this.tp) this.tp = p;
        const a = Math.abs(x[n]);
        if (a > this.sp) this.sp = a;
      }
      const next = Math.max(start, end);
      const keepFrom = Math.max(0, next - (HALF - 1));
      this.tail[c] = x.slice(keepFrom);
      nextStart = next - keepFrom;
    }
    this.tailStart = nextStart;
  }

  result(): StreamingLoudness {
    // finish the deferred true-peak samples (signal ends in silence)
    let tp = this.tp;
    let sp = this.sp;
    for (let c = 0; c < this.channels; c++) {
      const x = this.tail[c];
      for (let n = this.tailStart; n < x.length; n++) {
        tp = Math.max(tp, intervalPeak(x, n, x.length));
        sp = Math.max(sp, Math.abs(x[n]));
      }
    }
    // 400 ms blocks = 4 consecutive sub-blocks, hop 100 ms.
    const blocks: number[] = [];
    for (let i = 0; i + 4 <= this.subBlocks.length; i++) blocks.push((this.subBlocks[i] + this.subBlocks[i + 1] + this.subBlocks[i + 2] + this.subBlocks[i + 3]) / 4);
    const lufs = (e: number) => -0.691 + 10 * Math.log10(e);
    const abs = blocks.filter((e) => e > 0 && lufs(e) > -70);
    let integrated = -Infinity;
    if (abs.length) {
      const rel = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
      const gated = abs.filter((e) => lufs(e) > rel);
      if (gated.length) integrated = lufs(gated.reduce((a, b) => a + b, 0) / gated.length);
    }
    return { integrated, truePeak: gainToDb(tp), samplePeak: gainToDb(sp) };
  }
}

/** Convenience: integrated loudness and true peak of whole planar buffers. */
export function measureLoudness(channels: Float32Array[], sampleRate: number): StreamingLoudness {
  const m = new LoudnessMeter(sampleRate, channels.length);
  m.push(channels);
  return m.result();
}

/** Gain (dB) that brings `integrated` to `target`, capped so silence isn't blown up. */
export function normalizationGainDb(integrated: number, target: number, maxBoostDb = 24): number | null {
  if (!Number.isFinite(integrated)) return null;
  return Math.min(maxBoostDb, target - integrated);
}

// ---------------------------------------------------------------------------
// Limiter
// ---------------------------------------------------------------------------

export interface LimiterOptions {
  sampleRate: number;
  channels: number;
  /** Static gain applied before limiting, dB. */
  gainDb: number;
  /** True-peak ceiling, dBTP. */
  ceilingDb: number;
  lookaheadMs?: number;
  releaseMs?: number;
  /** Safety margin below the ceiling for interpolation error, dB. */
  marginDb?: number;
}

/**
 * Lookahead brickwall limiter. For every output sample the gain is the
 * box-filtered forward minimum of the required gains over the lookahead
 * window, which is provably ≤ the required gain at that sample, followed by
 * a one-pole release. Output is sample-aligned with the input (no latency in
 * the result), but up to lookahead+6 samples are held back between calls.
 */
export class TruePeakLimiter {
  private readonly L: number;
  private readonly ceil: number;
  private readonly gain: number;
  private readonly rel: number;
  private readonly channels: number;
  /** Samples not yet emitted, gain-applied, preceded by up to 5 samples of history. */
  private buf: Float32Array[];
  private hist = 0; // history samples at the front of buf
  private skip: number; // virtual lead-in samples still to drop from the output
  /** Required gains for buf[hist + i], i < r.length. */
  private r: number[] = [];
  /** Sliding-window minimum over r: monotonic deque (absolute indices / values) with a head pointer. */
  private dqI: number[] = [];
  private dqV: number[] = [];
  private dqHead = 0;
  private fed = 0; // absolute index of the next r value to feed into the deque
  private rBase = 0; // absolute index of r[0]
  private emitted = 0; // absolute index of the next sample to emit (including virtual lead-in)
  private box: Float64Array;
  private boxPos = 0;
  private boxSum = 0;
  private g = 1;
  /** Largest gain reduction applied so far, dB (≤ 0). */
  reductionDb = 0;

  constructor(o: LimiterOptions) {
    this.channels = o.channels;
    this.L = Math.max(1, Math.round(((o.lookaheadMs ?? 5) / 1000) * o.sampleRate));
    this.ceil = dbToGain(o.ceilingDb - (o.marginDb ?? 0.2));
    this.gain = dbToGain(o.gainDb);
    this.rel = 1 - Math.exp(-1 / (((o.releaseMs ?? 80) / 1000) * o.sampleRate));
    // L-1 silent virtual samples in front make the box filter exact from sample 0.
    this.skip = this.L - 1;
    this.buf = Array.from({ length: o.channels }, () => new Float32Array(this.skip));
    this.box = new Float64Array(this.L).fill(1);
    this.boxSum = this.L;
  }

  /** Feeds a chunk; returns the samples that are ready (possibly fewer than given). */
  process(input: Float32Array[]): Float32Array[] {
    for (let c = 0; c < this.channels; c++) {
      const src = input[Math.min(c, input.length - 1)];
      const scaled = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) scaled[i] = src[i] * this.gain;
      this.buf[c] = concat(this.buf[c], scaled);
    }
    return this.run(false);
  }

  /** Emits everything still held back (call once after the last chunk). */
  flush(): Float32Array[] {
    return this.run(true);
  }

  private run(final: boolean): Float32Array[] {
    const total = this.buf[0].length - this.hist; // pending samples
    // 1) required gains for samples whose interpolation window is complete
    const haveR = this.r.length;
    const canR = final ? total : Math.max(haveR, total - HALF);
    for (let i = haveR; i < canR; i++) {
      const n = this.hist + i;
      let peak = 0;
      for (let c = 0; c < this.channels; c++) {
        const p = intervalPeak(this.buf[c], n, this.buf[c].length);
        if (p > peak) peak = p;
      }
      this.r.push(peak > this.ceil ? this.ceil / peak : 1);
    }
    // 2) emit samples whose lookahead window [n, n+L) is known
    const knownEnd = this.rBase + this.r.length; // absolute
    const emitEnd = final ? knownEnd : knownEnd - this.L + 1;
    const count = Math.max(0, emitEnd - this.emitted);
    const out = Array.from({ length: this.channels }, () => new Float32Array(Math.max(0, count - Math.max(0, Math.min(count, this.skip)))));
    let o = 0;
    for (let k = 0; k < count; k++) {
      const abs = this.emitted + k;
      // forward minimum of r over [abs, abs + L)
      const feedTo = Math.min(abs + this.L, knownEnd);
      for (; this.fed < feedTo; this.fed++) {
        const v = this.r[this.fed - this.rBase];
        while (this.dqV.length > this.dqHead && this.dqV[this.dqV.length - 1] >= v) {
          this.dqV.pop();
          this.dqI.pop();
        }
        this.dqI.push(this.fed);
        this.dqV.push(v);
      }
      while (this.dqI.length > this.dqHead && this.dqI[this.dqHead] < abs) this.dqHead++;
      const m = this.dqI.length > this.dqHead ? this.dqV[this.dqHead] : 1;
      // box average of the last L forward minimums
      this.boxSum += m - this.box[this.boxPos];
      this.box[this.boxPos] = m;
      this.boxPos = (this.boxPos + 1) % this.L;
      const s = Math.min(1, this.boxSum / this.L);
      this.g = s < this.g ? s : this.g + (s - this.g) * this.rel;
      if (this.skip > 0) {
        this.skip--;
        continue;
      }
      const n = this.hist + (abs - this.rBase);
      for (let c = 0; c < this.channels; c++) out[c][o] = this.buf[c][n] * this.g;
      if (this.g < 1) this.reductionDb = Math.min(this.reductionDb, gainToDb(this.g));
      o++;
    }
    this.emitted += count;
    // 3) drop emitted samples, keep 5 samples of history for interpolation
    const consumed = this.emitted - this.rBase; // relative index of the next pending sample
    const keepFrom = Math.max(0, this.hist + consumed - (HALF - 1));
    for (let c = 0; c < this.channels; c++) this.buf[c] = this.buf[c].slice(keepFrom);
    this.hist = this.hist + consumed - keepFrom;
    this.r = this.r.slice(consumed);
    this.rBase += consumed;
    if (this.dqHead > 4096) {
      this.dqI = this.dqI.slice(this.dqHead);
      this.dqV = this.dqV.slice(this.dqHead);
      this.dqHead = 0;
    }
    return out;
  }
}

/** Static gain + limiter over whole planar buffers (same as streaming in one chunk). */
export function limitBuffers(channels: Float32Array[], sampleRate: number, gainDb: number, ceilingDb: number): Float32Array[] {
  const lim = new TruePeakLimiter({ sampleRate, channels: channels.length, gainDb, ceilingDb });
  const a = lim.process(channels);
  const b = lim.flush();
  return a.map((x, c) => concat(x, b[c]));
}
