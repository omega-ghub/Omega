import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultTransform } from '../../state/defaults';
import type { Transform } from '../../state/types';
import { affApply, affInvert, affMul, axisScales, boundsOf, fitFrameInCanvas, fitScale, layerQuad, layerToFrame, workingScale } from './geometry';
import { BLEND_MODES, blendFn, blendIndex, compositePremul } from './blend';

const close = (a: number, b: number, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const T = (o: Partial<Transform>): Transform => ({ ...defaultTransform(), ...o });

test('fit modes', () => {
  assert.deepEqual(fitScale('fit', 3840, 2160, 1920, 1080), [0.5, 0.5]);
  assert.deepEqual(fitScale('fill', 1000, 1000, 1920, 1080), [1.92, 1.92]);
  assert.deepEqual(fitScale('fit', 1000, 1000, 1920, 1080), [1.08, 1.08]);
  assert.deepEqual(fitScale('stretch', 960, 540, 1920, 1080), [2, 2]);
  assert.deepEqual(fitScale('none', 960, 540, 1920, 1080), [1, 1]);
});

test('default transform centers a fitted layer in the frame', () => {
  const m = layerToFrame(T({}), 3840, 2160, 1920, 1080);
  const [x0, y0] = affApply(m, 0, 0);
  const [x1, y1] = affApply(m, 3840, 2160);
  close(x0, 0);
  close(y0, 0);
  close(x1, 1920);
  close(y1, 1080);
});

test('position, scale, rotation (clockwise), anchor and flips', () => {
  const W = 1920;
  const H = 1080;
  const c = (t: Partial<Transform>, x: number, y: number) => affApply(layerToFrame(T(t), W, H, W, H), x, y);
  // position moves the center
  assert.deepEqual(c({ x: 100, y: -50 }, 960, 540), [1060, 490]);
  // scale 2 about the center
  const [sx] = c({ scale: 2 }, 1060, 540);
  close(sx, 1160);
  // rotation 90° clockwise on screen: a point to the right of center goes below it
  const [rx, ry] = c({ rotation: 90 }, 1060, 540);
  close(rx, 960, 1e-9);
  close(ry, 640, 1e-9);
  // anchor: the anchor point lands at the position, and is the pivot
  const [ax, ay] = c({ anchorX: 100 }, 1060, 540);
  close(ax, 960);
  close(ay, 540);
  const [bx, by] = c({ anchorX: 100, rotation: 90 }, 960, 540); // the center is 100 px left of the pivot
  close(bx, 960);
  close(by, 440);
  // flips mirror about the layer center
  const [fx] = c({ flipH: true }, 0, 540);
  close(fx, 1920);
  const [, fy] = c({ flipV: true }, 960, 0);
  close(fy, 1080);
  // scaleX/scaleY are independent
  const m = layerToFrame(T({ scaleX: 2, scaleY: 0.5 }), W, H, W, H);
  const [kx, ky] = axisScales(m);
  close(kx, 2);
  close(ky, 0.5);
});

test('affine inverse and composition', () => {
  const m = layerToFrame(T({ x: 13, y: -7, rotation: 33, scale: 1.7, anchorX: 5 }), 800, 600, 1920, 1080);
  const id = affMul(affInvert(m), m);
  [1, 0, 0, 1, 0, 0].forEach((v, i) => close(id[i], v, 1e-9));
});

test('working scale: ≤1, quarter-octave steps, never below a texel', () => {
  assert.equal(workingScale(2, 100, 100, 4096), 1);
  assert.equal(workingScale(0.5, 100, 100, 4096), 0.5);
  const k = workingScale(0.3, 3840, 2160, 4096);
  assert.ok(k >= 0.3 && k < 0.3 * 1.19 + 1e-9, `${k}`);
  close(Math.log2(k) * 4, Math.round(Math.log2(k) * 4), 1e-9);
  assert.ok(workingScale(1e-9, 1000, 10, 4096) >= 1 / 1000);
  assert.ok(workingScale(1, 10000, 10, 4096) <= 4096 / 10000);
});

test('layer quad uvs use GL convention (v=0 at the bottom of the image)', () => {
  const q = layerQuad([1, 0, 0, 1, 0, 0], 100, 50, 0);
  const z = (a: [number, number][]) => a.map(([x, y]) => [x + 0, y + 0]);
  q.pos = z(q.pos) as [number, number][];
  q.uv = z(q.uv) as [number, number][];
  assert.deepEqual(q.pos, [
    [0, 0],
    [100, 0],
    [0, 50],
    [100, 50],
  ]);
  assert.deepEqual(q.uv, [
    [0, 1],
    [1, 1],
    [0, 0],
    [1, 0],
  ]);
  assert.deepEqual(boundsOf(q.pos, 64, 64), { x0: 0, y0: 0, x1: 64, y1: 50 });
  assert.equal(boundsOf([[-10, -10], [-5, -5]], 64, 64), null);
});

test('letterboxing keeps aspect and uses the full canvas when it matches', () => {
  assert.deepEqual(fitFrameInCanvas(1920, 1080, 960, 540), { x: 0, y: 0, w: 960, h: 540 });
  assert.deepEqual(fitFrameInCanvas(1920, 1080, 961, 540), { x: 0, y: 0, w: 961, h: 540 });
  assert.deepEqual(fitFrameInCanvas(1080, 1920, 1000, 1000), { x: 218, y: 0, w: 563, h: 1000 });
});

test('blend formulas', () => {
  assert.equal(BLEND_MODES.length, 14);
  assert.equal(blendIndex('normal'), 0);
  assert.equal(blendIndex('colorBurn'), 13);
  assert.equal(blendIndex('bogus'), 0);
  close(blendFn('multiply', 0.5, 0.4), 0.2);
  close(blendFn('screen', 0.5, 0.4), 0.7);
  close(blendFn('screen', 2, 0.5), 2); // HDR guard
  close(blendFn('overlay', 0.25, 0.5), 0.25);
  close(blendFn('hardLight', 0.25, 0.5), 0.25);
  close(blendFn('softLight', 0.3, 0.5), 0.3);
  close(blendFn('difference', 0.2, 0.7), 0.5);
  close(blendFn('exclusion', 0.5, 0.5), 0.5);
  close(blendFn('subtract', 0.2, 0.7), 0);
  close(blendFn('colorDodge', 0.5, 0.5), 1);
  close(blendFn('colorBurn', 0.5, 0.5), 0);
  // premultiplied composite: opaque normal = source; 50% source over opaque = mix
  const [c, a] = compositePremul('normal', 0.2, 1, 0.4, 0.5);
  close(c, 0.2 * 0.5 + 0.4);
  close(a, 1);
  // add on opaque = sum
  close(compositePremul('add', 0.3, 1, 0.4, 1)[0], 0.7);
  // transparent backdrop: any mode gives the source
  for (const m of BLEND_MODES) close(compositePremul(m, 0, 0, 0.3, 0.6)[0], 0.3, 1e-12, m);
});
