import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMatch,
  channelStats,
  eotf,
  estimateIlluminant,
  neutralizingGains,
  oetf,
  solveMatch,
  solveWhiteBalance,
  whiteBalanceGains,
  type RGB,
} from './analysis';
import type { RGBAFrame } from './scopes';

/** Deterministic pseudo-random generator (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A synthetic "scene": random neutral-ish reflectances lit by `light` (linear multipliers). */
function scene(w: number, h: number, light: RGB, seed = 1): RGBAFrame {
  const rand = rng(seed);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    // greys with some colourful patches that average out to neutral
    const base = 0.04 + rand() * 0.5;
    const tint = [1 + (rand() - 0.5) * 0.6, 1 + (rand() - 0.5) * 0.6, 1 + (rand() - 0.5) * 0.6];
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(oetf(Math.min(1, base * tint[c] * light[c])) * 255);
    data[i * 4 + 3] = 255;
  }
  // a white card: the brightest surface
  for (let i = 0; i < Math.floor(w * h * 0.04); i++) for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(oetf(Math.min(1, 0.85 * light[c])) * 255);
  return { width: w, height: h, data };
}

function castOf(f: RGBAFrame): RGB {
  return estimateIlluminant(f)!.cast;
}

test('transfer functions round-trip', () => {
  for (const v of [0, 0.001, 0.04, 0.18, 0.5, 1]) assert.ok(Math.abs(eotf(oetf(v)) - v) < 1e-9);
});

test('auto balance: a neutral scene needs (almost) no correction', () => {
  const est = estimateIlluminant(scene(64, 36, [1, 1, 1]))!;
  for (const c of est.cast) assert.ok(Math.abs(c - 1) < 0.04, `cast ${est.cast}`);
});

test('auto balance: a warm cast is detected and neutralized by the multipliers', () => {
  const light: RGB = [1.3, 1, 0.7];
  const f = scene(96, 54, light, 7);
  const est = estimateIlluminant(f)!;
  assert.ok(est.cast[0] > est.cast[1] && est.cast[1] > est.cast[2], `warm cast ${est.cast}`);
  const m = neutralizingGains(est.cast);
  // the multipliers undo the light: m·light ∝ (1,1,1)
  const fixed = light.map((v, k) => v * m[k]);
  const ratio = (a: number, b: number) => Math.abs(Math.log2(a / b));
  assert.ok(ratio(fixed[0], fixed[1]) < 0.08 && ratio(fixed[2], fixed[1]) < 0.08, `fixed ${fixed}`);
  // luminance of the cast is preserved
  const y = 0.2126 * est.cast[0] * m[0] + 0.7152 * est.cast[1] * m[1] + 0.0722 * est.cast[2] * m[2];
  assert.ok(Math.abs(y - 1) < 1e-6);
});

test('auto balance: clipped and black pixels are ignored', () => {
  const f = scene(32, 32, [1, 1, 1], 3);
  // paint a third of the frame with clipped orange and another third with pure black
  for (let i = 0; i < 340; i++) f.data.set([255, 180, 0, 255], i * 4);
  for (let i = 340; i < 680; i++) f.data.set([0, 0, 0, 255], i * 4);
  const est = estimateIlluminant(f)!;
  for (const c of est.cast) assert.ok(Math.abs(c - 1) < 0.06, `cast ${est.cast}`);
});

test('auto balance: an empty or black frame gives no estimate', () => {
  assert.equal(estimateIlluminant({ width: 8, height: 8, data: new Uint8ClampedArray(256) }), null);
});

test('white-balance solve: temperature and tint reproduce the multipliers exactly', () => {
  const model = { tempStops: 0.6, tintStops: 0.4 };
  for (const [T, N] of [
    [30, 0],
    [0, -25],
    [-40, 15],
    [12.5, 33],
  ]) {
    const m = whiteBalanceGains(T, N, model);
    const sol = solveWhiteBalance(m, model);
    assert.ok(Math.abs(sol.temperature - T) < 1e-6, `T ${sol.temperature} vs ${T}`);
    assert.ok(Math.abs(sol.tint - N) < 1e-6, `N ${sol.tint} vs ${N}`);
    for (const r of sol.residual) assert.ok(Math.abs(r - 1) < 1e-9);
  }
});

test('white-balance solve: a brightness-only multiplier needs no temperature or tint', () => {
  const sol = solveWhiteBalance([2, 2, 2], { tempStops: 0.6, tintStops: 0.4 });
  assert.ok(Math.abs(sol.temperature) < 1e-9 && Math.abs(sol.tint) < 1e-9);
});

test('white-balance solve: beyond the slider range the rest goes to the residual gain', () => {
  const model = { tempStops: 0.5, tintStops: 0.5 };
  const m = whiteBalanceGains(150, 0, model); // more than the slider can do
  const sol = solveWhiteBalance(m, model, { temperature: 20, tint: 0 });
  assert.equal(sol.temperature, 80); // clamped to +100 total
  const achieved = whiteBalanceGains(80, 0, model);
  const total = achieved.map((v, k) => v * sol.residual[k]);
  // total ∝ m (up to brightness)
  const k0 = total[1] / m[1];
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(total[c] / m[c] - k0) < 1e-6);
});

test('auto balance end-to-end: estimate → solve → the model gains cancel the cast', () => {
  const model = { tempStops: 0.6, tintStops: 0.4 };
  const light: RGB = [0.8, 1.05, 1.35]; // cool, slightly green
  const f = scene(96, 54, light, 11);
  const m = neutralizingGains(castOf(f));
  const sol = solveWhiteBalance(m, model);
  assert.ok(sol.temperature > 0, 'a cool shot is warmed up');
  const g = whiteBalanceGains(sol.temperature, sol.tint, model).map((v, k) => v * sol.residual[k]);
  const fixed = light.map((v, k) => v * g[k]);
  assert.ok(Math.abs(Math.log2(fixed[0] / fixed[1])) < 0.1 && Math.abs(Math.log2(fixed[2] / fixed[1])) < 0.1, `fixed ${fixed}`);
});

function gradientFrame(w: number, h: number, f: (x: number, y: number) => RGB): RGBAFrame {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = f(x / (w - 1), y / (h - 1));
      data.set([c[0] * 255, c[1] * 255, c[2] * 255, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}

test('match: aligns per-channel means and standard deviations to the reference', () => {
  const ref = gradientFrame(64, 32, (x, y) => [0.2 + 0.5 * x, 0.25 + 0.4 * y, 0.3 + 0.3 * (1 - x) * y]);
  // the current shot: flatter, darker, with a cyan cast
  const cur = gradientFrame(64, 32, (x, y) => [0.15 + 0.3 * x, 0.3 + 0.25 * y, 0.35 + 0.2 * (1 - x) * y]);
  const sol = solveMatch(cur, ref);
  const out = channelStats(applyMatch(cur, sol));
  const want = channelStats(ref);
  for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs(out.mean[c] - want.mean[c]) < 0.01, `mean ${c}: ${out.mean[c]} vs ${want.mean[c]}`);
    assert.ok(Math.abs(out.std[c] - want.std[c]) < 0.03, `std ${c}: ${out.std[c]} vs ${want.std[c]}`);
  }
  assert.ok(Math.abs(out.chromaRms - want.chromaRms) < 0.01);
});

test('match: identical frames give the identity', () => {
  const f = gradientFrame(32, 16, (x, y) => [x * 0.8, 0.5 * y + 0.2, 0.4]);
  const sol = solveMatch(f, f);
  for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs(sol.gain[c] - 1) < 1e-9);
    assert.ok(Math.abs(sol.offset[c]) < 1e-9);
  }
  assert.ok(Math.abs(sol.saturation - 1) < 1e-9);
});

test('match: a pure exposure difference maps to an equal gain on every channel', () => {
  const ref = gradientFrame(32, 16, (x, y) => [0.1 + 0.6 * x, 0.1 + 0.6 * x, 0.1 + 0.6 * y]);
  const cur = gradientFrame(32, 16, (x, y) => [0.05 + 0.3 * x, 0.05 + 0.3 * x, 0.05 + 0.3 * y]);
  const sol = solveMatch(cur, ref);
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(sol.gain[c] - 2) < 0.03, `gain ${sol.gain}`);
});

test('match: a desaturated shot gets saturation > 1', () => {
  const ref = gradientFrame(32, 16, (x) => [0.2 + 0.6 * x, 0.5, 0.8 - 0.6 * x]);
  const cur = gradientFrame(32, 16, (x) => [0.4 + 0.2 * x, 0.5, 0.6 - 0.2 * x]);
  const sol = solveMatch(cur, ref);
  const out = channelStats(applyMatch(cur, sol));
  assert.ok(Math.abs(out.chromaRms - channelStats(ref).chromaRms) < 0.01);
});
