import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  biquadCoefficients,
  biquadMagnitudeDb,
  compressorCurve,
  dbFromFaderPos,
  dbToGain,
  eqResponseDb,
  fadeInGain,
  fadeOutGain,
  faderPosFromDb,
  formatDb,
  meterDeflection,
} from './dsp';
import { LookaheadLimiter } from './limiterCore';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ±${tol}, got ${a}`);

test('fader taper round-trips and places 0 dB at ~71%', () => {
  for (const db of [12, 6, 0, -6, -20, -40, -60]) near(dbFromFaderPos(faderPosFromDb(db)), db, 1e-9, `${db}`);
  near(faderPosFromDb(0), 0.708, 0.01);
  assert.equal(faderPosFromDb(-Infinity), 0);
  assert.ok(dbToGain(dbFromFaderPos(0)) === 0, 'bottom of the fader is silence');
});

test('dB helpers', () => {
  assert.equal(dbToGain(0), 1);
  near(dbToGain(-6), 0.501, 0.001);
  assert.equal(dbToGain(-120), 0);
  assert.equal(dbToGain(null as unknown as number), 1);
  assert.equal(formatDb(-Infinity), '−∞');
  assert.equal(formatDb(3), '+3.0');
  assert.equal(formatDb(-3.2), '−3.2');
});

test('meter deflection is monotonic, 0 dBFS = full scale', () => {
  let prev = -1;
  for (let db = -80; db <= 3; db += 0.5) {
    const d = meterDeflection(db);
    assert.ok(d >= prev);
    prev = d;
  }
  assert.equal(meterDeflection(0), 1);
  assert.equal(meterDeflection(-Infinity), 0);
});

test('equal-power crossfade keeps constant power', () => {
  for (let p = 0; p <= 1; p += 0.05) near(fadeInGain(p, 'equalPower') ** 2 + fadeOutGain(p, 'equalPower') ** 2, 1, 1e-12);
  near(fadeInGain(0.5, 'linear') + fadeOutGain(0.5, 'linear'), 1, 1e-12);
});

test('Web Audio biquads: peaking, shelves, Butterworth high-pass', () => {
  const fs = 48000;
  near(biquadMagnitudeDb(biquadCoefficients('peaking', 1000, 1, 6, fs), 1000, fs), 6, 0.01, 'peak at f0');
  near(biquadMagnitudeDb(biquadCoefficients('peaking', 1000, 1, 6, fs), 20, fs), 0, 0.1, 'peak far away');
  near(biquadMagnitudeDb(biquadCoefficients('lowshelf', 200, 1, -9, fs), 10, fs), -9, 0.1, 'low shelf DC');
  near(biquadMagnitudeDb(biquadCoefficients('lowshelf', 200, 1, -9, fs), 200, fs), -4.5, 0.1, 'low shelf midpoint');
  near(biquadMagnitudeDb(biquadCoefficients('highshelf', 5000, 1, 4, fs), 20000, fs), 4, 0.2, 'high shelf top');
  near(biquadMagnitudeDb(biquadCoefficients('highpass', 100, -3.0103, 0, fs), 100, fs), -3.01, 0.05, 'HP corner');
  near(biquadMagnitudeDb(biquadCoefficients('highpass', 100, -3.0103, 0, fs), 25, fs), -24.1, 0.5, '12 dB/oct');
  near(biquadMagnitudeDb(biquadCoefficients('lowpass', 8000, -3.0103, 0, fs), 8000, fs), -3.01, 0.05, 'LP corner');
});

test('EQ response sums enabled bands; disabled EQ is flat', () => {
  const eq = { enabled: true, highpass: 80, lowGain: 0, lowFreq: 120, midGain: 5, midFreq: 2000, midQ: 1.5, highGain: 0, highFreq: 8000, lowpass: 0 };
  const r = eqResponseDb(eq, [2000, 10000, 80], 48000);
  near(r[0], 5, 0.05);
  near(r[1], 0, 0.5);
  near(r[2], -3, 0.2);
  const flat = eqResponseDb({ ...eq, enabled: false }, [100, 1000], 48000);
  assert.deepEqual([...flat], [0, 0]);
});

test('compressor static curve', () => {
  near(compressorCurve(-30, -20, 4, 0), -30, 1e-9);
  near(compressorCurve(-8, -20, 4, 0), -17, 1e-9);
  // soft knee is continuous at its edges
  near(compressorCurve(-23, -20, 4, 6), -23, 1e-9);
  near(compressorCurve(-17, -20, 4, 6), -20 + 3 / 4, 1e-9);
});

test('lookahead limiter: delay equals latency, never exceeds the ceiling on samples', () => {
  const sr = 48000;
  const lim = new LookaheadLimiter(sr, 1, { ceiling: 0.5, truePeak: false, lookaheadMs: 2 });
  const n = 4800;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(i * 0.05) * (i > 2000 && i < 2400 ? 2 : 0.25);
  const y = new Float32Array(n);
  lim.process([x], [y], n);
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(y[i]));
  assert.ok(max <= 0.5 + 1e-6, `max ${max}`);
  // before the loud burst the signal is passed through, delayed
  const L = lim.latency;
  for (let i = L; i < 1500; i++) near(y[i], x[i - L], 1e-6);
});
