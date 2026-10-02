// Multi-resolution waveform peaks. The finest level is built while decoding
// (min/max over all channels per 256 source samples); coarser levels are
// reduced from it. Pure: no Web Audio.

export interface Peaks {
  /** Samples per peak bucket at the asset's sample rate. */
  bucket: number;
  sampleRate: number;
  duration: number;
  /** Interleaved min/max per bucket (envelope across channels), -1..1 */
  data: Float32Array;
}

export const PEAK_BUCKETS = [256, 2048, 16384];

export class PeakBuilder {
  readonly sampleRate: number;
  private data: Float32Array;
  private count = 0; // completed buckets
  private fill = 0; // samples in the current bucket
  private mn = Infinity;
  private mx = -Infinity;
  private total = 0;

  constructor(sampleRate: number, expectedSamples = 0) {
    this.sampleRate = sampleRate;
    this.data = new Float32Array(Math.max(64, Math.ceil(expectedSamples / PEAK_BUCKETS[0]) * 2 + 8));
  }

  /** Feeds n frames from each channel array (starting at offset). */
  push(channels: ArrayLike<number>[], offset: number, n: number): void {
    const B = PEAK_BUCKETS[0];
    let i = 0;
    while (i < n) {
      const m = Math.min(n - i, B - this.fill);
      let mn = this.mn;
      let mx = this.mx;
      for (const ch of channels) {
        for (let k = offset + i, e = offset + i + m; k < e; k++) {
          const v = ch[k];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }
      this.mn = mn;
      this.mx = mx;
      this.fill += m;
      i += m;
      if (this.fill === B) this.flush();
    }
    this.total += n;
  }

  /** Feeds n frames of silence (gaps in the stream). */
  pushSilence(n: number): void {
    const z = new Float32Array(Math.min(n, 65536));
    let left = n;
    while (left > 0) {
      const m = Math.min(left, z.length);
      this.push([z], 0, m);
      left -= m;
    }
  }

  private flush(): void {
    if (this.count * 2 + 2 > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const mn = this.mn === Infinity ? 0 : this.mn;
    const mx = this.mx === -Infinity ? 0 : this.mx;
    this.data[this.count * 2] = mn;
    this.data[this.count * 2 + 1] = mx;
    this.count++;
    this.fill = 0;
    this.mn = Infinity;
    this.mx = -Infinity;
  }

  /** All levels, finest first. */
  finish(): Peaks[] {
    if (this.fill > 0) this.flush();
    const duration = this.total / this.sampleRate;
    const finest: Peaks = { bucket: PEAK_BUCKETS[0], sampleRate: this.sampleRate, duration, data: this.data.slice(0, this.count * 2) };
    const levels = [finest];
    for (let l = 1; l < PEAK_BUCKETS.length; l++) levels.push(reduce(levels[l - 1], PEAK_BUCKETS[l]));
    return levels;
  }
}

/** Coarser peaks from finer ones (bucket must be a multiple of the source bucket). */
export function reduce(src: Peaks, bucket: number): Peaks {
  const f = Math.max(1, Math.round(bucket / src.bucket));
  const n = src.data.length / 2;
  const m = Math.ceil(n / f);
  const out = new Float32Array(m * 2);
  for (let j = 0; j < m; j++) {
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = j * f, e = Math.min(n, (j + 1) * f); i < e; i++) {
      const a = src.data[i * 2];
      const b = src.data[i * 2 + 1];
      if (a < mn) mn = a;
      if (b > mx) mx = b;
    }
    out[j * 2] = mn === Infinity ? 0 : mn;
    out[j * 2 + 1] = mx === -Infinity ? 0 : mx;
  }
  return { bucket: src.bucket * f, sampleRate: src.sampleRate, duration: src.duration, data: out };
}

/** The coarsest level that still has at least one bucket per pixel, else the finest. */
export function pickLevel(levels: Peaks[], samplesPerPixel: number): Peaks | null {
  if (!levels.length) return null;
  let best = levels[0];
  for (const l of levels) if (l.bucket <= samplesPerPixel) best = l;
  return best;
}

/** Min/max of a source-time range [s0, s1) (seconds), from the best level. */
export function peakRange(levels: Peaks[], s0: number, s1: number): { min: number; max: number } {
  const p = levels[0];
  if (!p) return { min: 0, max: 0 };
  const n = p.data.length / 2;
  const a = Math.max(0, Math.floor((s0 * p.sampleRate) / p.bucket));
  const b = Math.min(n, Math.ceil((s1 * p.sampleRate) / p.bucket));
  let mn = 0;
  let mx = 0;
  for (let i = a; i < b; i++) {
    if (p.data[i * 2] < mn) mn = p.data[i * 2];
    if (p.data[i * 2 + 1] > mx) mx = p.data[i * 2 + 1];
  }
  return { min: mn, max: mx };
}
