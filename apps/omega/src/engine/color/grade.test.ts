import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultGrade } from '../../state/defaults';
import { bakeCurves, monotoneCurve, sampleBaked } from './curves';
import { LUMA709, gradeIsNeutral, gradePixel, hueRotationMatrix, qualifierKey, whiteBalanceMatrix } from './grade';
import { identityLut } from './lut';
import { apply3, bt709InvOetf, bt709Oetf, type Vec3 } from './transforms';

const close = (a: number, b: number, eps: number, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);

test('monotone cubic: identity, passes through points, no overshoot', () => {
  const id = monotoneCurve([]);
  for (const x of [0, 0.25, 0.5, 1]) close(id(x), x, 1e-12);
  const f = monotoneCurve([
    { x: 0.25, y: 0.1 },
    { x: 0.5, y: 0.75 },
    { x: 0.75, y: 0.8 },
  ]);
  close(f(0.5), 0.75, 1e-12);
  close(f(0.25), 0.1, 1e-12);
  let prev = -1;
  for (let x = 0; x <= 1; x += 0.001) {
    const y = f(x);
    assert.ok(y >= prev - 1e-12, `monotone at ${x}`);
    assert.ok(y >= 0 && y <= 1);
    prev = y;
  }
  // flat segment stays flat (no ringing)
  const g = monotoneCurve([
    { x: 0.3, y: 0.5 },
    { x: 0.7, y: 0.5 },
  ]);
  for (let x = 0.3; x <= 0.7; x += 0.05) close(g(x), 0.5, 1e-12);
});

test('baked curves compose master then channel', () => {
  const t = bakeCurves({ master: [{ x: 0.5, y: 0.6 }], r: [], g: [{ x: 0.6, y: 0.3 }], b: [] }, 1025);
  close(sampleBaked(t, 0, 0.5), 0.6, 1e-6);
  close(sampleBaked(t, 1, 0.5), 0.3, 1e-6);
  close(sampleBaked(t, 2, 1.25), 1.25, 1e-6);
});

test('white balance: 0/0 is identity, white stays neutral-ish in luminance, warm raises R over B', () => {
  const m = whiteBalanceMatrix(0, 0);
  for (let i = 0; i < 9; i++) close(m[i], i % 4 === 0 ? 1 : 0, 1e-12);
  const tiny = whiteBalanceMatrix(1e-9, 0);
  for (let i = 0; i < 9; i++) close(tiny[i], i % 4 === 0 ? 1 : 0, 1e-6);
  const warm = apply3(whiteBalanceMatrix(50, 0), [0.5, 0.5, 0.5]);
  assert.ok(warm[0] > 0.5 && warm[2] < 0.5, `warm ${warm}`);
  const cool = apply3(whiteBalanceMatrix(-50, 0), [0.5, 0.5, 0.5]);
  assert.ok(cool[2] > 0.5 && cool[0] < 0.5, `cool ${cool}`);
  const magenta = apply3(whiteBalanceMatrix(0, 50), [0.5, 0.5, 0.5]);
  assert.ok(magenta[1] < magenta[0] && magenta[1] < magenta[2], `magenta ${magenta}`);
  const lum = (c: Vec3) => c[0] * LUMA709[0] + c[1] * LUMA709[1] + c[2] * LUMA709[2];
  close(lum(warm), 0.5, 0.03);
});

test('grade: neutral default, exposure doubles, contrast pivots on 18% grey', () => {
  const g = defaultGrade();
  assert.ok(gradeIsNeutral(g));
  const c: Vec3 = [0.18, 0.3, 0.05];
  assert.deepEqual(gradePixel(g, c), c);
  g.exposure = 1;
  const e = gradePixel(g, c);
  for (let i = 0; i < 3; i++) close(e[i], c[i] * 2, 1e-12);
  g.exposure = 0;
  g.contrast = 1.5;
  close(gradePixel(g, [0.18, 0.18, 0.18])[0], 0.18, 1e-9);
  assert.ok(gradePixel(g, [0.5, 0.5, 0.5])[0] > 0.5);
  assert.ok(gradePixel(g, [0.05, 0.05, 0.05])[0] < 0.05);
});

test('grade: lift/gamma/gain keep their anchors', () => {
  const g = defaultGrade();
  g.gain = { r: 0, g: 0, b: 0, y: 0.5 };
  close(gradePixel(g, [0, 0, 0])[0], 0, 1e-9); // gain anchors black
  assert.ok(gradePixel(g, [1, 1, 1])[0] > 1.5);
  const l = defaultGrade();
  l.lift = { r: 0, g: 0, b: 0, y: 0.5 };
  close(gradePixel(l, [1, 1, 1])[0], 1, 1e-9); // lift anchors white
  assert.ok(gradePixel(l, [0.01, 0.01, 0.01])[0] > 0.01);
  const m = defaultGrade();
  m.gamma = { r: 0, g: 0, b: 0, y: 0.5 };
  close(gradePixel(m, [1, 1, 1])[0], 1, 1e-9);
  close(gradePixel(m, [0, 0, 0])[0], 0, 1e-9);
  assert.ok(gradePixel(m, [0.18, 0.18, 0.18])[0] > 0.18);
  const s = defaultGrade();
  s.saturation = 0;
  const grey = gradePixel(s, [0.6, 0.2, 0.1]);
  close(grey[0], grey[1], 1e-9);
  close(grey[1], grey[2], 1e-9);
});

test('grade: identity LUT at full intensity is identity', () => {
  const g = defaultGrade();
  g.lut = { id: 'x', intensity: 1 };
  const lut = identityLut('3d', 33);
  for (const c of [
    [0.18, 0.18, 0.18],
    [0.7, 0.1, 0.3],
  ] as Vec3[]) {
    const o = gradePixel(g, c, lut);
    for (let i = 0; i < 3; i++) close(o[i], c[i], 1e-6);
  }
});

test('qualifier: keys the chosen hue and respects invert', () => {
  const g = defaultGrade().qualifier;
  g.enabled = true;
  g.hueCenter = 0;
  g.hueWidth = 40;
  g.softness = 0.1;
  const red: Vec3 = [0.8, 0.1, 0.1];
  const blue: Vec3 = [0.1, 0.1, 0.8];
  close(qualifierKey(g, red), 1, 1e-9);
  close(qualifierKey(g, blue), 0, 1e-9);
  g.invert = true;
  close(qualifierKey(g, blue), 1, 1e-9);
});

test('hue rotation: 120° maps red to green, preserves neutral', () => {
  const m = hueRotationMatrix(120);
  const g = apply3(m, [1, 0, 0]);
  close(g[0], 0, 1e-12);
  close(g[1], 1, 1e-12);
  const n = apply3(hueRotationMatrix(37), [0.4, 0.4, 0.4]);
  for (const v of n) close(v, 0.4, 1e-12);
});

test('curves are applied in the Rec.709-encoded domain', () => {
  const g = defaultGrade();
  g.curves.master = [{ x: 0.5, y: 0.75 }];
  const lin = bt709InvOetf(0.5);
  close(bt709Oetf(gradePixel(g, [lin, lin, lin])[0]), 0.75, 1e-9);
});
