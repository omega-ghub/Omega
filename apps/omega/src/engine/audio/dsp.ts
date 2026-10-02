// Pure DSP helpers shared by the audio engine, the offline mixdown and the
// audio UI (fader taper, meter ballistics, EQ response curves). No Web Audio
// here: everything works on numbers and Float32Arrays so it runs in Node tests.

import type { ClipAudio } from '../../state/types';

/** Gains at or below this many dB are treated as silence (−∞). JSON cannot store −Infinity. */
export const DB_FLOOR = -96;
/** Lowest value the faders write into the document (shown as −∞). */
export const FADER_MIN_DB = -100;
/** Highest fader gain. */
export const FADER_MAX_DB = 12;

/** dB → linear amplitude. Non-numbers (e.g. null from an old document) read as 0 dB. */
export function dbToGain(db: number): number {
  if (typeof db !== 'number' || Number.isNaN(db)) return 1;
  if (db <= DB_FLOOR) return 0;
  return Math.pow(10, Math.min(db, 60) / 20);
}

/** Linear amplitude → dB (−Infinity for silence). */
export function gainToDb(g: number): number {
  return g > 0 ? 20 * Math.log10(g) : -Infinity;
}

/** A clean, finite dB for display ("−∞" below the floor). */
export function formatDb(db: number, digits = 1): string {
  if (!Number.isFinite(db) || db <= DB_FLOOR) return '−∞';
  const v = db.toFixed(digits);
  return (db > 0 ? '+' : db < 0 ? '−' : '') + v.replace('-', '');
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------
// Fader taper: position 0..1 ↔ dB. A quartic amplitude taper
// (dB = 12 + 80·log10 p) puts 0 dB at ~71% travel, −20 dB at 40%, −40 at 22%,
// −60 at 13%, which is how console faders feel.
// ---------------------------------------------------------------------------

export function dbFromFaderPos(p: number): number {
  if (p <= 0.0005) return FADER_MIN_DB;
  const db = FADER_MAX_DB + 80 * Math.log10(Math.min(1, p));
  return db <= DB_FLOOR ? FADER_MIN_DB : db;
}

export function faderPosFromDb(db: number): number {
  if (!Number.isFinite(db) || db <= DB_FLOOR) return 0;
  return clamp(Math.pow(10, (Math.min(db, FADER_MAX_DB) - FADER_MAX_DB) / 80), 0, 1);
}

// ---------------------------------------------------------------------------
// Meter deflection (IEC 60268-18 style scale), dBFS → 0..1
// ---------------------------------------------------------------------------

export function meterDeflection(db: number): number {
  if (!Number.isFinite(db) || db < -70) return 0;
  let pct: number;
  if (db < -60) pct = (db + 70) * 0.25;
  else if (db < -50) pct = (db + 60) * 0.5 + 2.5;
  else if (db < -40) pct = (db + 50) * 0.75 + 7.5;
  else if (db < -30) pct = (db + 40) * 1.5 + 15;
  else if (db < -20) pct = (db + 30) * 2 + 30;
  else if (db < 0) pct = (db + 20) * 2.5 + 50;
  else pct = 100;
  return pct / 100;
}

// ---------------------------------------------------------------------------
// Crossfade curves
// ---------------------------------------------------------------------------

export type FadeCurve = 'linear' | 'equalPower';

/** Fade-in gain at progress p (0..1). Equal power: sin(p·π/2), so in² + out² = 1. */
export function fadeInGain(p: number, curve: FadeCurve): number {
  const q = clamp(p, 0, 1);
  return curve === 'equalPower' ? Math.sin((q * Math.PI) / 2) : q;
}

export function fadeOutGain(p: number, curve: FadeCurve): number {
  return fadeInGain(1 - p, curve);
}

// ---------------------------------------------------------------------------
// Biquads, exactly as the Web Audio spec defines BiquadFilterNode (Audio EQ
// Cookbook; lowpass/highpass Q in dB, shelves with S = 1), so the UI's drawn
// response matches what the engine plays.
// ---------------------------------------------------------------------------

export type BiquadType = 'lowpass' | 'highpass' | 'lowshelf' | 'highshelf' | 'peaking';

export interface BiquadCoefs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export function biquadCoefficients(type: BiquadType, frequency: number, Q: number, gainDb: number, sampleRate: number): BiquadCoefs {
  const nyquist = sampleRate / 2;
  const f0 = clamp(frequency, 0, nyquist);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  let b0 = 1;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;
  switch (type) {
    case 'lowpass': {
      const alpha = sinw / (2 * Math.pow(10, Q / 20));
      b0 = (1 - cosw) / 2;
      b1 = 1 - cosw;
      b2 = (1 - cosw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
      break;
    }
    case 'highpass': {
      const alpha = sinw / (2 * Math.pow(10, Q / 20));
      b0 = (1 + cosw) / 2;
      b1 = -(1 + cosw);
      b2 = (1 + cosw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
      break;
    }
    case 'lowshelf': {
      const alphaS = (sinw / 2) * Math.SQRT2;
      const k = 2 * alphaS * Math.sqrt(A);
      b0 = A * (A + 1 - (A - 1) * cosw + k);
      b1 = 2 * A * (A - 1 - (A + 1) * cosw);
      b2 = A * (A + 1 - (A - 1) * cosw - k);
      a0 = A + 1 + (A - 1) * cosw + k;
      a1 = -2 * (A - 1 + (A + 1) * cosw);
      a2 = A + 1 + (A - 1) * cosw - k;
      break;
    }
    case 'highshelf': {
      const alphaS = (sinw / 2) * Math.SQRT2;
      const k = 2 * alphaS * Math.sqrt(A);
      b0 = A * (A + 1 + (A - 1) * cosw + k);
      b1 = -2 * A * (A - 1 + (A + 1) * cosw);
      b2 = A * (A + 1 + (A - 1) * cosw - k);
      a0 = A + 1 - (A - 1) * cosw + k;
      a1 = 2 * (A - 1 - (A + 1) * cosw);
      a2 = A + 1 - (A - 1) * cosw - k;
      break;
    }
    case 'peaking': {
      const alpha = sinw / (2 * Math.max(Q, 1e-4));
      b0 = 1 + alpha * A;
      b1 = -2 * cosw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosw;
      a2 = 1 - alpha / A;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** |H(e^jw)| in dB at frequency f. */
export function biquadMagnitudeDb(c: BiquadCoefs, f: number, sampleRate: number): number {
  const w = (2 * Math.PI * f) / sampleRate;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cos1 + c.b2 * cos2;
  const ni = -(c.b1 * sin1 + c.b2 * sin2);
  const dr = 1 + c.a1 * cos1 + c.a2 * cos2;
  const di = -(c.a1 * sin1 + c.a2 * sin2);
  const mag2 = (nr * nr + ni * ni) / Math.max(1e-30, dr * dr + di * di);
  return 10 * Math.log10(Math.max(mag2, 1e-30));
}

/** Butterworth resonance for Web Audio's dB-valued lowpass/highpass Q (1/√2 → −3.01 dB). */
export const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2);

export interface EqBand {
  /** Which ClipAudio.eq field this band is driven by (for UI hit-testing). */
  id: 'highpass' | 'low' | 'mid' | 'high' | 'lowpass';
  type: BiquadType;
  frequency: number;
  Q: number;
  gain: number;
  /** Bypassed bands are still built (as a 0 dB peaking filter = identity) so live edits never rebuild the graph. */
  active: boolean;
}

/** The five EQ bands of a clip, in signal order. */
export function eqBands(eq: ClipAudio['eq']): EqBand[] {
  const hp = eq.highpass > 0;
  const lp = eq.lowpass > 0;
  return [
    hp
      ? { id: 'highpass', type: 'highpass', frequency: eq.highpass, Q: BUTTERWORTH_Q_DB, gain: 0, active: true }
      : { id: 'highpass', type: 'peaking', frequency: 1000, Q: 1, gain: 0, active: false },
    { id: 'low', type: 'lowshelf', frequency: eq.lowFreq, Q: 1, gain: eq.lowGain, active: eq.lowGain !== 0 },
    { id: 'mid', type: 'peaking', frequency: eq.midFreq, Q: Math.max(0.05, eq.midQ), gain: eq.midGain, active: eq.midGain !== 0 },
    { id: 'high', type: 'highshelf', frequency: eq.highFreq, Q: 1, gain: eq.highGain, active: eq.highGain !== 0 },
    lp
      ? { id: 'lowpass', type: 'lowpass', frequency: eq.lowpass, Q: BUTTERWORTH_Q_DB, gain: 0, active: true }
      : { id: 'lowpass', type: 'peaking', frequency: 1000, Q: 1, gain: 0, active: false },
  ];
}

/** Summed magnitude response (dB) of a clip EQ at the given frequencies. */
export function eqResponseDb(eq: ClipAudio['eq'], freqs: ArrayLike<number>, sampleRate: number): Float32Array {
  const out = new Float32Array(freqs.length);
  if (!eq.enabled) return out;
  for (const band of eqBands(eq)) {
    if (!band.active) continue;
    const c = biquadCoefficients(band.type, band.frequency, band.Q, band.gain, sampleRate);
    for (let i = 0; i < freqs.length; i++) out[i] += biquadMagnitudeDb(c, freqs[i], sampleRate);
  }
  return out;
}

/** Log-spaced frequencies from lo to hi. */
export function logFrequencies(n: number, lo = 20, hi = 20000): Float32Array {
  const out = new Float32Array(n);
  const a = Math.log(lo);
  const b = Math.log(hi);
  for (let i = 0; i < n; i++) out[i] = Math.exp(a + ((b - a) * i) / Math.max(1, n - 1));
  return out;
}

/** Static compressor curve (output dB for input dB) with a soft knee, for the UI. */
export function compressorCurve(inputDb: number, threshold: number, ratio: number, knee: number): number {
  const r = Math.max(1, ratio);
  const k = Math.max(0, knee);
  const over = inputDb - threshold;
  if (k > 0 && Math.abs(over) <= k / 2) return inputDb + ((1 / r - 1) * (over + k / 2) ** 2) / (2 * k);
  if (over > k / 2) return threshold + over / r;
  return inputDb;
}

// ---------------------------------------------------------------------------
// Signal measurements on Float32Arrays
// ---------------------------------------------------------------------------

export function peakAbs(data: Float32Array, from = 0, to = data.length): number {
  let m = 0;
  for (let i = Math.max(0, from); i < Math.min(to, data.length); i++) {
    const v = data[i] < 0 ? -data[i] : data[i];
    if (v > m) m = v;
  }
  return m;
}

export function rms(data: Float32Array, from = 0, to = data.length): number {
  const a = Math.max(0, from);
  const b = Math.min(to, data.length);
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += data[i] * data[i];
  return Math.sqrt(s / (b - a));
}
