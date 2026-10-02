import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoudnessMeter, TruePeakLimiter, limitBuffers, measureLoudness, normalizationGainDb, gainToDb, intervalPeak } from './loudness';

const SR = 48000;

function sine(freq: number, amp: number, seconds: number, phase = 0, sr = SR): Float32Array {
  const n = Math.round(seconds * sr);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr + phase);
  return x;
}

function truePeakDb(channels: Float32Array[]): number {
  let p = 0;
  for (const x of channels) for (let n = 0; n < x.length; n++) p = Math.max(p, intervalPeak(x, n));
  return gainToDb(p);
}

test('BS.1770: stereo 1 kHz sine at -20 dBFS reads -20 LUFS', () => {
  const x = sine(1000, 0.1, 5);
  const r = measureLoudness([x, x], SR);
  assert.ok(Math.abs(r.integrated - -20) < 0.1, `got ${r.integrated}`);
  // mono (one channel) is 3 dB lower
  const m = measureLoudness([x], SR);
  assert.ok(Math.abs(m.integrated - -23.01) < 0.1, `got ${m.integrated}`);
});

test('BS.1770 works at 44.1 kHz too', () => {
  const x = sine(1000, 0.1, 4, 0, 44100);
  const r = measureLoudness([x, x], 44100);
  assert.ok(Math.abs(r.integrated - -20) < 0.15, `got ${r.integrated}`);
});

test('gating ignores silence', () => {
  const tone = sine(1000, 0.1, 3);
  const withSilence = new Float32Array(tone.length * 3);
  withSilence.set(tone, 0);
  const r = measureLoudness([withSilence, withSilence], SR);
  // only the 3 blocks straddling the end of the tone pull it down (≈ -0.22 LU)
  assert.ok(Math.abs(r.integrated - -20.22) < 0.05, `got ${r.integrated}`);
  assert.equal(measureLoudness([new Float32Array(SR)], SR).integrated, -Infinity);
});

test('streaming in chunks gives the same loudness as one buffer', () => {
  const x = sine(440, 0.3, 6);
  const whole = measureLoudness([x, x], SR);
  const m = new LoudnessMeter(SR, 2);
  for (let i = 0; i < x.length; i += 12345) {
    const part = x.subarray(i, Math.min(x.length, i + 12345));
    m.push([part, part]);
  }
  const parts = m.result();
  assert.ok(Math.abs(whole.integrated - parts.integrated) < 0.01);
  assert.ok(Math.abs(whole.truePeak - parts.truePeak) < 0.01);
});

test('true peak catches inter-sample peaks', () => {
  // fs/4 sine at 45° phase: samples sit at ±0.707, the waveform peaks at 1.0
  const x = sine(SR / 4, 1, 0.1, Math.PI / 4);
  const r = measureLoudness([x], SR);
  assert.ok(r.samplePeak < -2.9 && r.samplePeak > -3.1, `sample peak ${r.samplePeak}`);
  assert.ok(r.truePeak > -0.5, `true peak ${r.truePeak}`);
});

test('normalization gain', () => {
  assert.equal(normalizationGainDb(-20, -14), 6);
  assert.equal(normalizationGainDb(-60, -14), 24); // capped
  assert.equal(normalizationGainDb(-Infinity, -14), null);
});

test('limiter: quiet audio passes through untouched (and sample-aligned)', () => {
  const x = sine(220, 0.1, 1);
  const [y] = limitBuffers([x], SR, 0, -1);
  assert.equal(y.length, x.length);
  for (let i = 0; i < x.length; i += 997) assert.ok(Math.abs(y[i] - x[i]) < 1e-6);
});

test('limiter keeps the true peak under the ceiling after +12 dB of gain', () => {
  const x = sine(997, 0.5, 1);
  const y = limitBuffers([x, x], SR, 12, -1);
  assert.equal(y[0].length, x.length);
  const tp = truePeakDb(y);
  assert.ok(tp <= -1 + 0.05, `true peak ${tp}`);
  assert.ok(tp > -2, `over-limited: ${tp}`);
});

test('limiter: chunked processing equals one pass', () => {
  const x = sine(150, 0.9, 0.5);
  const burst = sine(3000, 0.9, 0.5);
  const sig = new Float32Array(x.length * 2);
  sig.set(x, 0);
  sig.set(burst, x.length);
  const whole = limitBuffers([sig], SR, 6, -1)[0];
  const lim = new TruePeakLimiter({ sampleRate: SR, channels: 1, gainDb: 6, ceilingDb: -1 });
  const out: Float32Array[] = [];
  for (let i = 0; i < sig.length; i += 7001) out.push(lim.process([sig.subarray(i, Math.min(sig.length, i + 7001))])[0]);
  out.push(lim.flush()[0]);
  const joined = new Float32Array(out.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of out) {
    joined.set(a, o);
    o += a.length;
  }
  assert.equal(joined.length, whole.length);
  let maxDiff = 0;
  for (let i = 0; i < whole.length; i++) maxDiff = Math.max(maxDiff, Math.abs(whole[i] - joined[i]));
  assert.ok(maxDiff < 1e-6, `diff ${maxDiff}`);
  assert.ok(lim.reductionDb < -1);
});
