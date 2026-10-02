import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLoudness, applyGainWithLimiter, kWeighting, LoudnessMeter, normalizeGain, planNormalization, type AudioBufferLike } from './loudness';
import { truePeakOf } from './truePeak';

// Tiny AudioBuffer-like shim: Node has no Web Audio.
function shim(channels: Float32Array[], sampleRate: number): AudioBufferLike {
  return { numberOfChannels: channels.length, sampleRate, length: channels[0].length, getChannelData: (c: number) => channels[c] };
}

/** Sine at `dbfs` (peak level: a full-scale sine is 0 dBFS, as in EBU Tech 3341). */
function sine(freq: number, dbfs: number, seconds: number, sr: number, phase = 0): Float32Array {
  const a = Math.pow(10, dbfs / 20);
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a * Math.sin((2 * Math.PI * freq * i) / sr + phase);
  return out;
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const stereo = (x: Float32Array, sr: number) => shim([x, x.slice()], sr);
const near = (actual: number, expected: number, tol: number, msg = '') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg} expected ${expected} ±${tol}, got ${actual}`);

test('K-weighting from analog prototypes reproduces the BS.1770 48 kHz coefficients', () => {
  const [s1, s2] = kWeighting(48000);
  near(s1.b0, 1.53512485958697, 1e-6);
  near(s1.b1, -2.69169618940638, 1e-6);
  near(s1.b2, 1.19839281085285, 1e-6);
  near(s1.a1, -1.69065929318241, 1e-6);
  near(s1.a2, 0.73248077421585, 1e-6);
  near(s2.a1, -1.99004745483398, 1e-6);
  near(s2.a2, 0.99007225036621, 1e-6);
});

test('EBU Tech 3341 #1: stereo 997 Hz at −23 dBFS reads −23.0 LUFS (M, S, I)', () => {
  const r = analyzeLoudness(stereo(sine(997, -23, 20, 48000), 48000));
  near(r.integrated, -23, 0.1, 'I');
  near(r.momentaryMax, -23, 0.1, 'M');
  near(r.shortTermMax, -23, 0.1, 'S');
});

test('stereo −20 dBFS sine reads −20.0 LUFS; mono reads −23.0 (single channel)', () => {
  near(analyzeLoudness(stereo(sine(997, -20, 10, 48000), 48000)).integrated, -20, 0.1, 'stereo');
  near(analyzeLoudness(shim([sine(997, -20, 10, 48000)], 48000)).integrated, -23.01, 0.1, 'mono');
});

test('coefficients adapt to 44.1 kHz and 96 kHz', () => {
  near(analyzeLoudness(stereo(sine(997, -23, 10, 44100), 44100)).integrated, -23, 0.1, '44.1k');
  near(analyzeLoudness(stereo(sine(997, -23, 10, 96000), 96000)).integrated, -23, 0.1, '96k');
});

test('EBU Tech 3341 #3 and #4: gating ignores quiet passages', () => {
  const sr = 48000;
  const t3 = concat(sine(1000, -36, 10, sr), sine(1000, -23, 60, sr), sine(1000, -36, 10, sr));
  near(analyzeLoudness(stereo(t3, sr)).integrated, -23, 0.1, '#3');
  const t4 = concat(sine(1000, -72, 10, sr), sine(1000, -36, 10, sr), sine(1000, -23, 60, sr), sine(1000, -36, 10, sr), sine(1000, -72, 10, sr));
  near(analyzeLoudness(stereo(t4, sr)).integrated, -23, 0.1, '#4');
});

test('silence measures −Infinity', () => {
  const r = analyzeLoudness(stereo(new Float32Array(48000 * 5), 48000));
  assert.equal(r.integrated, -Infinity);
  assert.equal(r.momentaryMax, -Infinity);
  assert.equal(r.shortTermMax, -Infinity);
  assert.equal(r.truePeak, -Infinity);
  assert.equal(r.range, 0);
});

test('EBU Tech 3342 LRA: two-level signals', () => {
  const sr = 48000;
  const lra = (a: number, b: number) => analyzeLoudness(stereo(concat(sine(1000, a, 20, sr), sine(1000, b, 20, sr)), sr)).range;
  near(lra(-20, -30), 10, 1, '#1');
  near(lra(-20, -15), 5, 1, '#2');
  near(lra(-40, -20), 20, 1, '#3');
});

test('true peak: 0 dBFS sine at fs/4 with 45° phase shows the inter-sample overshoot', () => {
  const sr = 48000;
  const x = sine(sr / 4, 0, 1, sr, Math.PI / 4); // samples land on ±0.707
  const r = analyzeLoudness(stereo(x, sr));
  near(r.samplePeak!, -3.01, 0.05, 'sample peak');
  assert.ok(r.truePeak > r.samplePeak! + 2.5, `true peak ${r.truePeak} should exceed sample peak ${r.samplePeak}`);
  near(r.truePeak, 0, 0.5, 'true peak');
});

test('true peak of a low-frequency sine equals its sample peak', () => {
  const x = sine(997, -6, 2, 48000);
  near(20 * Math.log10(truePeakOf([x])), -6, 0.15);
});

test('streaming meter gives the same answer for any chunking', () => {
  const sr = 48000;
  const x = concat(sine(500, -18, 4, sr), sine(3000, -28, 4, sr));
  const whole = analyzeLoudness(stereo(x, sr));
  const m = new LoudnessMeter(sr, 2);
  for (let o = 0; o < x.length; o += 1234) m.push([x, x], o, Math.min(1234, x.length - o));
  const r = m.result();
  near(r.integrated, whole.integrated, 1e-9);
  near(r.shortTermMax, whole.shortTermMax, 1e-9);
});

test('normalizeGain respects the target and the true-peak ceiling', () => {
  const base = { integrated: -20, shortTermMax: -18, momentaryMax: -17, range: 4, truePeak: -6 };
  assert.equal(normalizeGain(base, -23, -1), -3); // turn down 3 dB
  assert.equal(normalizeGain(base, -14, -1), 5); // ceiling allows only +5 (TP −6 → −1)
  assert.equal(normalizeGain({ ...base, truePeak: -12 }, -14, -1), 6);
  assert.equal(normalizeGain({ ...base, integrated: -Infinity }, -14, -1), 0);
  const plan = planNormalization(base, -14, -1);
  assert.equal(plan.targetGainDb, 6);
  assert.equal(plan.needsLimiter, true);
});

test('applyGainWithLimiter hits the gain and holds the true-peak ceiling', () => {
  const sr = 48000;
  // music-like: a sine with periodic transients
  const x = sine(220, -12, 6, sr);
  for (let i = 0; i < x.length; i += sr / 2) for (let k = 0; k < 200; k++) x[i + k] += 0.5 * Math.sin(k * 0.9) * Math.exp(-k / 60);
  const buf = stereo(x, sr);
  const before = analyzeLoudness(buf);
  applyGainWithLimiter(buf, 10, -1);
  const after = analyzeLoudness(buf);
  assert.ok(after.truePeak <= -1 + 1e-6, `true peak ${after.truePeak} must be ≤ −1 dBTP`);
  assert.ok(after.integrated > before.integrated + 8, `loudness should rise ~10 dB (got ${after.integrated - before.integrated})`);
});

test('applyGainWithLimiter is transparent (and latency-compensated) below the ceiling', () => {
  const sr = 48000;
  const x = sine(440, -20, 1, sr);
  const ref = x.slice();
  applyGainWithLimiter(shim([x], sr), 6, -1);
  const g = Math.pow(10, 6 / 20);
  let maxErr = 0;
  for (let i = 0; i < x.length; i++) maxErr = Math.max(maxErr, Math.abs(x[i] - ref[i] * g));
  assert.ok(maxErr < 1e-5, `max error ${maxErr}`);
});
