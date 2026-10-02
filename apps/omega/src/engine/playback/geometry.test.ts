import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorPoint,
  apply,
  axisScaleFactors,
  boundsOf,
  contentMatrix,
  croppedRect,
  dragRotation,
  fitFactors,
  invert,
  layerMatrix,
  layerRect,
  layoutTextLines,
  maskMatrix,
  maskResize,
  moveAnchorTo,
  multiply,
  quad,
  snapMove,
  textBox,
  uniformScaleFactor,
  type Affine,
  type LayerTransform,
  type Vec,
} from './geometry';

const tf = (patch: Partial<LayerTransform> = {}): LayerTransform => ({
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX: 0,
  anchorY: 0,
  fit: 'fit',
  flipH: false,
  flipV: false,
  ...patch,
});

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const nearV = (a: Vec, b: Vec, eps = 1e-6) => {
  near(a.x, b.x, eps);
  near(a.y, b.y, eps);
};
const nearM = (a: Affine, b: Affine, eps = 1e-6) => {
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const) near(a[k], b[k], eps);
};

test('fit factors', () => {
  assert.deepEqual(fitFactors('fit', 3840, 2160, 1920, 1080), { fx: 0.5, fy: 0.5 });
  // 4:3 into 16:9: fit is height-limited, fill width-limited
  near(fitFactors('fit', 1440, 1080, 1920, 1080).fx, 1);
  near(fitFactors('fill', 1440, 1080, 1920, 1080).fx, 1920 / 1440);
  assert.deepEqual(fitFactors('stretch', 1000, 500, 2000, 2000), { fx: 2, fy: 4 });
  assert.deepEqual(fitFactors('none', 1000, 500, 2000, 2000), { fx: 1, fy: 1 });
});

test('identity layer fills the frame', () => {
  const m = layerMatrix(tf(), 1920, 1080, 1920, 1080);
  const b = boundsOf(quad(m, layerRect(1920, 1080)));
  assert.deepEqual(b, { x0: 0, y0: 0, x1: 1920, y1: 1080 });
});

test('4K source in an HD frame is fitted, x/y move the center', () => {
  const m = layerMatrix(tf({ x: 100, y: -50 }), 3840, 2160, 1920, 1080);
  nearV(apply(m, { x: 0, y: 0 }), { x: 1060, y: 490 });
  const b = boundsOf(quad(m, layerRect(3840, 2160)));
  near(b.x1 - b.x0, 1920);
  near(b.y1 - b.y0, 1080);
});

test('rotation is clockwise on screen', () => {
  const m = layerMatrix(tf({ rotation: 90 }), 200, 100, 1000, 1000);
  // fit: 1000/200 = 5 → layer is 1000×500; its right edge midpoint (100,0) goes below the center
  nearV(apply(m, { x: 100, y: 0 }), { x: 500, y: 1000 });
});

test('anchor is the pivot: it does not move when scaling or rotating', () => {
  const base = tf({ x: 40, y: 30, anchorX: 300, anchorY: -100 });
  const p0 = anchorPoint(base, 1920, 1080, 1920, 1080);
  for (const patch of [{ scale: 2 }, { rotation: 33 }, { scaleX: 0.5, rotation: -120 }])
    nearV(anchorPoint({ ...base, ...patch }, 1920, 1080, 1920, 1080), p0);
  // at scale 1 / no rotation the anchor does not move the layer
  nearV(apply(layerMatrix(base, 1920, 1080, 1920, 1080), { x: 0, y: 0 }), { x: 1000, y: 570 });
});

test('anchor is in layer (source) pixels', () => {
  // 4K layer fitted at 0.5: anchor 400 source px → 200 sequence px from the center
  const p = anchorPoint(tf({ anchorX: 400 }), 3840, 2160, 1920, 1080);
  nearV(p, { x: 960 + 200, y: 540 });
});

test('inverse round-trips', () => {
  const m = layerMatrix(tf({ x: 12, y: -7, scale: 1.3, scaleX: 0.8, rotation: 27, anchorX: 50, anchorY: 20 }), 1280, 720, 1920, 1080);
  nearM(multiply(m, invert(m)), { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
});

test('moving the anchor keeps the picture in place', () => {
  const t0 = tf({ x: 10, y: 20, scale: 1.7, scaleY: 0.6, rotation: 41, anchorX: -30, anchorY: 15 });
  const m0 = layerMatrix(t0, 1920, 1080, 1920, 1080);
  const target = { x: 300, y: 222 };
  const r = moveAnchorTo(t0, 1920, 1080, 1920, 1080, target);
  const t1 = { ...t0, ...r };
  nearM(layerMatrix(t1, 1920, 1080, 1920, 1080), m0, 1e-6);
  nearV(anchorPoint(t1, 1920, 1080, 1920, 1080), target, 1e-6);
});

test('moving the anchor of a fitted 4K layer keeps the picture in place', () => {
  const t0 = tf({ scale: 0.8, rotation: -15 });
  const m0 = layerMatrix(t0, 3840, 2160, 1920, 1080);
  const r = moveAnchorTo(t0, 3840, 2160, 1920, 1080, { x: 100, y: 100 });
  nearM(layerMatrix({ ...t0, ...r }, 3840, 2160, 1920, 1080), m0, 1e-6);
});

test('corner drag scale factor', () => {
  near(uniformScaleFactor({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 200 }), 2);
  near(uniformScaleFactor({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 30 }), 0.5);
  const k = axisScaleFactors({ x: 0, y: 0 }, 90, { x: 0, y: 100 }, { x: 0, y: 300 });
  // with the layer rotated 90°, dragging down stretches the layer's own x axis
  near(k.kx, 3);
});

test('rotation drag with snapping', () => {
  near(dragRotation(0, { x: 0, y: 0 }, { x: 0, y: -100 }, { x: 100, y: 0 }), 90);
  near(dragRotation(10, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 12 }, 15), 15);
});

test('crop shrinks the visible rect', () => {
  assert.deepEqual(croppedRect(100, 50, { left: 0.1, top: 0, right: 0.2, bottom: 0.5 }), { x: -40, y: -25, w: 70, h: 25 });
  // flipped layers show the crop mirrored
  const m = contentMatrix(tf({ flipH: true }), 100, 100, 100, 100);
  nearV(apply(m, { x: -50, y: 0 }), { x: 100, y: 50 });
});

test('snap to the frame center and edges', () => {
  const r = snapMove({ x0: 100, y0: 100, x1: 300, y1: 200 }, 755, -96, 1920, 1080, 8);
  // center x 200+755=955 → 960; top 100-96=4 → 0
  near(r.dx, 760);
  near(r.dy, -100);
  assert.deepEqual(r.guidesX, [960]);
  assert.deepEqual(r.guidesY, [0]);
  const none = snapMove({ x0: 100, y0: 100, x1: 300, y1: 200 }, 50, 50, 1920, 1080, 8);
  assert.deepEqual([none.dx, none.dy, none.guidesX.length], [50, 50, 0]);
});

test('mask matrix and resize', () => {
  const mask = { x: 0.75, y: 0.5, width: 0.5, height: 0.25, rotation: 0 };
  const m = maskMatrix(mask, 200, 100);
  nearV(apply(m, { x: 0, y: 0 }), { x: 50, y: 0 });
  nearV(apply(m, { x: 0.5, y: 0.5 }), { x: 100, y: 12.5 });
  const s = maskResize(mask, 200, 100, { x: 50 + 80, y: 0 }, 'x');
  near(s.width, 0.8);
  near(s.height, 0.25);
});

test('text layout wraps and measures', () => {
  const measure = (_font: string, s: string) => s.length * 10;
  const t = { content: 'hello big world\nok', uppercase: false, maxWidth: 100, letterSpacing: 0, italic: false, weight: 600, size: 20, font: 'x' };
  const lines = layoutTextLines(t, measure);
  assert.deepEqual(
    lines.map((l) => l.text),
    ['hello big', 'world', 'ok'],
  );
  const box = textBox({ ...t, lineHeight: 1, color: '#fff', align: 'center', stroke: { enabled: false, color: '', width: 0 }, shadow: { enabled: false, color: '', blur: 0, x: 0, y: 0, opacity: 0 }, background: { enabled: true, color: '#000', opacity: 1, paddingX: 5, paddingY: 5, radius: 0 }, animation: { in: 'none', out: 'none', inDuration: 0, outDuration: 0 } }, measure);
  assert.deepEqual(box, { x: -50, y: -35, w: 100, h: 70 });
});
