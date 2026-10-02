import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateStretch, slideClip, slipClip, trimClip, trimRange } from './ops';
import { assertClean, fixture, framesOf, layout } from './testkit';
import { toFrames } from '../time';
import type { Clip } from '../../state/types';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

test('trim head: inPoint follows the source delta and keyframes stay put on the timeline', () => {
  const fx = fixture(24);
  const c = fx.clip(fx.V1, 24, 96, { inPoint: 2, keyframes: { 'transform.opacity': [{ t: 1.5, v: 0.5, ease: 'linear' }] } });
  const d = trimClip(fx.project, fx.seq, c.id, 'start', fx.f(48), 'normal');
  close(d, 1);
  assert.deepEqual(framesOf(c, 24), [48, 120]);
  close(c.inPoint, 3);
  close(c.keyframes['transform.opacity'][0].t, 0.5);
  close(c.start + c.keyframes['transform.opacity'][0].t, fx.f(24) + 1.5);
});

test('trim head: cannot reveal media before the source start, nor overlap the previous clip', () => {
  const fx = fixture(24);
  const c = fx.clip(fx.V1, 48, 48, { inPoint: 1 });
  trimClip(fx.project, fx.seq, c.id, 'start', 0, 'normal');
  assert.deepEqual(framesOf(c, 24), [24, 96]);
  assert.equal(c.inPoint, 0);
  const fx2 = fixture(24);
  fx2.clip(fx2.V1, 0, 36);
  const b = fx2.clip(fx2.V1, 48, 48, { inPoint: 5 });
  trimClip(fx2.project, fx2.seq, b.id, 'start', 0, 'normal');
  assert.deepEqual(framesOf(b, 24), [36, 96]);
  close(b.inPoint, 4.5);
});

test('trim tail: limited by the media length (asset.duration)', () => {
  const fx = fixture(24);
  const a = fx.asset({ duration: 3 });
  const c = fx.clip(fx.V1, 0, 48, { assetId: a.id });
  trimClip(fx.project, fx.seq, c.id, 'end', fx.f(500), 'normal');
  assert.deepEqual(framesOf(c, 24), [0, 72]);
});

test('trim tail: cannot overlap the next clip; never below one frame', () => {
  const fx = fixture(24);
  const c = fx.clip(fx.V1, 0, 48);
  fx.clip(fx.V1, 60, 40);
  trimClip(fx.project, fx.seq, c.id, 'end', fx.f(80), 'normal');
  assert.deepEqual(framesOf(c, 24), [0, 60]);
  trimClip(fx.project, fx.seq, c.id, 'start', fx.f(1000), 'normal');
  assert.deepEqual(framesOf(c, 24), [59, 60]);
  trimClip(fx.project, fx.seq, c.id, 'end', -5, 'normal');
  assert.deepEqual(framesOf(c, 24), [59, 60]);
});

test('trim: stills and generated clips are unlimited', () => {
  const fx = fixture(24);
  const img = fx.asset({ kind: 'image', duration: 0, hasAudio: false });
  const c = fx.clip(fx.V1, 24, 24, { assetId: img.id });
  trimClip(fx.project, fx.seq, c.id, 'start', 0, 'normal');
  trimClip(fx.project, fx.seq, c.id, 'end', fx.f(2000), 'normal');
  assert.deepEqual(framesOf(c, 24), [0, 2000]);
  assert.equal(c.inPoint, 0);
  const t = fx.clip(fx.V2, 100, 24, { kind: 'text' });
  trimClip(fx.project, fx.seq, t.id, 'start', fx.f(10), 'normal');
  assert.deepEqual(framesOf(t, 24), [10, 124]);
  assert.equal(t.inPoint, 0);
});

test('trim: reverse clips keep the head frame on tail trims and the tail frame on head trims', () => {
  const fx = fixture(24);
  const c = fx.clip(fx.V1, 0, 96, { inPoint: 1, reverse: true });
  trimClip(fx.project, fx.seq, c.id, 'start', fx.f(24), 'normal');
  assert.equal(c.inPoint, 1, 'head trim of a reversed clip removes the high end');
  assert.deepEqual(framesOf(c, 24), [24, 96]);
  // head shows inPoint + span = 1 + 3 = 4 s
  trimClip(fx.project, fx.seq, c.id, 'end', fx.f(72), 'normal');
  close(c.inPoint, 2);
  close(c.inPoint + c.duration * c.speed, 4);
});

test('trim: speed is respected (2× consumes two source seconds per second)', () => {
  const fx = fixture(24);
  const c = fx.clip(fx.V1, 0, 96, { speed: 2 });
  trimClip(fx.project, fx.seq, c.id, 'start', fx.f(24), 'normal');
  close(c.inPoint, 2);
});

test('trim: speed ramps integrate the curve and shift the ramp', () => {
  const fx = fixture(24);
  const c = fx.clip(fx.V1, 0, 96, { keyframes: { 'time.speed': [{ t: 0, v: 1, ease: 'linear' }, { t: 2, v: 3, ease: 'linear' }] } });
  trimClip(fx.project, fx.seq, c.id, 'start', fx.f(24), 'normal');
  // ∫0..1 (1 + t) dt = 1.5
  close(c.inPoint, 1.5, 1e-4);
  close(c.keyframes['time.speed'][0].t, -1);
  close(c.keyframes['time.speed'][1].t, 1);
});

test('trim: linked partners trim together unless unlinked; locked partners never change', () => {
  const fx = fixture(24);
  const [v, s] = fx.av(0, 96);
  trimClip(fx.project, fx.seq, v.id, 'end', fx.f(48), 'normal');
  assert.deepEqual(framesOf(s, 24), [0, 48]);
  trimClip(fx.project, fx.seq, v.id, 'end', fx.f(24), 'normal', { unlinked: true });
  assert.deepEqual(framesOf(v, 24), [0, 24]);
  assert.deepEqual(framesOf(s, 24), [0, 48]);
  const fx2 = fixture(24);
  const [v2, s2] = fx2.av(0, 96);
  fx2.A1.locked = true;
  trimClip(fx2.project, fx2.seq, v2.id, 'end', fx2.f(48), 'normal');
  assert.deepEqual(framesOf(v2, 24), [0, 48]);
  assert.deepEqual(framesOf(s2, 24), [0, 96]);
  // a clip on a locked track can't be trimmed at all
  trimClip(fx2.project, fx2.seq, s2.id, 'end', fx2.f(24), 'normal');
  assert.deepEqual(framesOf(s2, 24), [0, 96]);
});

test('ripple trim tail: later clips move on every unlocked track (sync lock)', () => {
  const fx = fixture(24);
  const [A] = fx.av(0, 48);
  fx.av(48, 48);
  const m = fx.clip(fx.A2, 60, 30);
  const d = trimClip(fx.project, fx.seq, A.id, 'end', fx.f(24), 'ripple');
  close(d, -1);
  assert.deepEqual(layout(fx.V1, 24), [[0, 24], [24, 72]]);
  assert.deepEqual(layout(fx.A1, 24), [[0, 24], [24, 72]]);
  assert.deepEqual(framesOf(m, 24), [36, 66]);
  trimClip(fx.project, fx.seq, A.id, 'end', fx.f(36), 'ripple');
  assert.deepEqual(layout(fx.V1, 24), [[0, 36], [36, 84]]);
  assert.deepEqual(framesOf(m, 24), [48, 78]);
  assertClean(fx.seq);
});

test('ripple trim head: the clip keeps its start, its head material goes, later clips close up', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 48, { keyframes: { 'transform.x': [{ t: 1, v: 10, ease: 'linear' }] } });
  const B = fx.clip(fx.V1, 48, 48);
  const title = fx.clip(fx.V2, 30, 10, { kind: 'text' });
  trimClip(fx.project, fx.seq, A.id, 'start', fx.f(12), 'ripple');
  assert.deepEqual(framesOf(A, 24), [0, 36]);
  close(A.inPoint, 0.5);
  close(A.keyframes['transform.x'][0].t, 0.5);
  assert.deepEqual(framesOf(B, 24), [36, 84]);
  assert.deepEqual(framesOf(title, 24), [18, 28], 'title stays over its picture');
  // extending the head ripples right
  trimClip(fx.project, fx.seq, A.id, 'start', -fx.f(6), 'ripple');
  assert.deepEqual(framesOf(A, 24), [0, 42]);
  assert.deepEqual(framesOf(B, 24), [42, 90]);
  close(A.inPoint, 0.25);
});

test('ripple trim: limited by clips on other tracks instead of breaking sync', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 48);
  const B = fx.clip(fx.V1, 48, 48);
  fx.clip(fx.A2, 0, 60);
  const m2 = fx.clip(fx.A2, 70, 40);
  const d = trimClip(fx.project, fx.seq, A.id, 'end', fx.f(24), 'ripple');
  close(d, -fx.f(10));
  assert.deepEqual(framesOf(A, 24), [0, 38]);
  assert.deepEqual(framesOf(B, 24), [38, 86]);
  assert.deepEqual(framesOf(m2, 24), [60, 100]);
  assertClean(fx.seq);
});

test('ripple trim with syncLock:false only moves the edited tracks', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 48);
  const B = fx.clip(fx.V1, 48, 48);
  fx.clip(fx.A2, 0, 60);
  const m2 = fx.clip(fx.A2, 70, 40);
  trimClip(fx.project, fx.seq, A.id, 'end', fx.f(24), 'ripple', { syncLock: false });
  assert.deepEqual(framesOf(A, 24), [0, 24]);
  assert.deepEqual(framesOf(B, 24), [24, 72]);
  assert.deepEqual(framesOf(m2, 24), [70, 110]);
});

test('roll: moves the shared edit point of adjacent clips (and their linked audio)', () => {
  const fx = fixture(24);
  const [A, a] = fx.av(0, 48);
  const [B, b] = fx.av(48, 48, { inPoint: 2 });
  trimClip(fx.project, fx.seq, A.id, 'end', fx.f(60), 'roll');
  assert.deepEqual(framesOf(A, 24), [0, 60]);
  assert.deepEqual(framesOf(B, 24), [60, 96]);
  close(B.inPoint, 2.5);
  assert.deepEqual(framesOf(a, 24), [0, 60]);
  assert.deepEqual(framesOf(b, 24), [60, 96]);
  trimClip(fx.project, fx.seq, B.id, 'start', fx.f(36), 'roll');
  assert.deepEqual(framesOf(A, 24), [0, 36]);
  assert.deepEqual(framesOf(B, 24), [36, 96]);
  close(B.inPoint, 1.5);
  assertClean(fx.seq);
});

test('roll: limited by the incoming clip’s head handle; without a neighbour it is a normal trim', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 48);
  const B = fx.clip(fx.V1, 48, 48, { inPoint: 0.5 });
  trimClip(fx.project, fx.seq, B.id, 'start', fx.f(20), 'roll');
  assert.deepEqual(framesOf(A, 24), [0, 36]);
  assert.deepEqual(framesOf(B, 24), [36, 96]);
  assert.equal(B.inPoint, 0);
  const fx2 = fixture(24);
  const C = fx2.clip(fx2.V1, 0, 48);
  fx2.clip(fx2.V1, 60, 36);
  trimClip(fx2.project, fx2.seq, C.id, 'end', fx2.f(72), 'roll');
  assert.deepEqual(framesOf(C, 24), [0, 60]);
});

function driftRun(fps: number) {
  const fx = fixture(fps);
  const clips: Clip[] = [];
  let t = 0;
  for (let i = 0; i < 8; i++) {
    const len = 30 + ((i * 37) % 50);
    const [v] = fx.av(t, len, { inPoint: fx.f(200) });
    clips.push(v);
    t += len + (i % 3 === 0 ? 7 : 0);
  }
  fx.clip(fx.A2, 5, 400);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const modes = ['normal', 'ripple', 'roll'] as const;
  for (let i = 0; i < 250; i++) {
    const c = clips[Math.floor(rnd() * clips.length)];
    const edge = rnd() < 0.5 ? 'start' : 'end';
    const mode = modes[Math.floor(rnd() * 3)];
    const edgeT = edge === 'start' ? c.start : c.start + c.duration;
    // deliberately off-grid targets
    const target = edgeT + (rnd() - 0.5) * 3.3333;
    trimClip(fx.project, fx.seq, c.id, edge, target, mode);
    assertClean(fx.seq);
  }
  // a ripple head trim and its inverse restore the source exactly
  const c = [...clips].sort((x, y) => y.duration - x.duration)[0];
  const in0 = c.inPoint;
  const s0 = c.start;
  const d1 = trimClip(fx.project, fx.seq, c.id, 'start', c.start + fx.f(17), 'ripple');
  assert.ok(d1 > 0, 'first ripple trim applied');
  const d2 = trimClip(fx.project, fx.seq, c.id, 'start', s0 - d1, 'ripple');
  assert.ok(Math.abs(d2 + d1) < 1e-9);
  assert.ok(Math.abs(c.inPoint - in0) < 1e-9, `inPoint drifted ${c.inPoint} vs ${in0}`);
  assert.equal(c.start, s0);
}

test('no drift at 23.976: every edge stays on a frame through 250 random trims', () => driftRun(23.976));
test('no drift at 29.97: every edge stays on a frame through 250 random trims', () => driftRun(29.97));
test('no drift at 59.94', () => driftRun(59.94));

test('23.976: ripple trim lands exactly on the 24000/1001 grid', () => {
  const fx = fixture(23.976);
  const A = fx.clip(fx.V1, 0, 1001);
  const B = fx.clip(fx.V1, 1001, 500);
  trimClip(fx.project, fx.seq, A.id, 'end', 30.0, 'ripple');
  // 30 s at 23.976 ≈ 719.28 frames → frame 719
  assert.equal(toFrames(A.start + A.duration, 23.976), 719);
  assert.equal(B.start, A.start + A.duration);
  assert.equal(B.start, 719 * 1001 / 24000);
});

test('trimRange reports the allowed edge range', () => {
  const fx = fixture(24);
  fx.clip(fx.V1, 0, 12);
  const c = fx.clip(fx.V1, 24, 48, { inPoint: 1 });
  const r = trimRange(fx.project, fx.seq, c.id, 'start', 'normal')!;
  close(r.min, fx.f(12));
  close(r.max, fx.f(71));
  const a = fx.asset({ duration: 4 });
  const d = fx.clip(fx.V2, 0, 24, { assetId: a.id, inPoint: 1 });
  const r2 = trimRange(fx.project, fx.seq, d.id, 'end', 'ripple')!;
  close(r2.max, 3);
});

test('slip: changes the source window only, within the media', () => {
  const fx = fixture(24);
  const a = fx.asset({ duration: 10 });
  const [v, s] = fx.av(0, 48, { assetId: a.id, inPoint: 2, keyframes: { 'transform.x': [{ t: 1, v: 3, ease: 'linear' }] } });
  close(slipClip(fx.project, fx.seq, v.id, 1), 1);
  assert.equal(v.inPoint, 3);
  assert.equal(s.inPoint, 3);
  assert.deepEqual(framesOf(v, 24), [0, 48]);
  assert.equal(v.keyframes['transform.x'][0].t, 1, 'keyframes stay with the timeline');
  close(slipClip(fx.project, fx.seq, v.id, -10), -3);
  assert.equal(v.inPoint, 0);
  slipClip(fx.project, fx.seq, v.id, 100);
  close(v.inPoint, 8);
  const h = fx.clip(fx.V2, 0, 24, { assetId: a.id, holdFrame: 4 });
  slipClip(fx.project, fx.seq, h.id, 1);
  close(h.holdFrame!, 5);
});

test('slide: neighbours give and take frames; the clip keeps its source', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 48);
  const B = fx.clip(fx.V1, 48, 24, { inPoint: 5 });
  const C = fx.clip(fx.V1, 72, 48, { inPoint: 2 });
  close(slideClip(fx.project, fx.seq, B.id, fx.f(12)), fx.f(12));
  assert.deepEqual(framesOf(A, 24), [0, 60]);
  assert.deepEqual(framesOf(B, 24), [60, 84]);
  assert.equal(B.inPoint, 5);
  assert.deepEqual(framesOf(C, 24), [84, 120]);
  close(C.inPoint, 2.5);
  slideClip(fx.project, fx.seq, B.id, fx.f(1000));
  assert.deepEqual(framesOf(C, 24), [119, 120], 'next clip keeps one frame');
  assert.deepEqual(framesOf(B, 24), [95, 119]);
  assertClean(fx.seq);
});

test('slide: limited by handles, and a gap side just changes the gap', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 48);
  const B = fx.clip(fx.V1, 60, 24);
  const C = fx.clip(fx.V1, 84, 36, { inPoint: 0.25 });
  slideClip(fx.project, fx.seq, B.id, -fx.f(20));
  // C can only extend 6 frames (0.25 s of handle)
  assert.deepEqual(framesOf(B, 24), [54, 78]);
  assert.deepEqual(framesOf(C, 24), [78, 120]);
  assert.equal(C.inPoint, 0);
  assert.deepEqual(framesOf(A, 24), [0, 48]);
});

test('rate stretch: same source in a new length; keyframes scale; 100× limit; neighbours', () => {
  const fx = fixture(24);
  const c = fx.clip(fx.V1, 0, 48, { keyframes: { 'transform.x': [{ t: 1, v: 0, ease: 'linear' }] } });
  rateStretch(fx.project, fx.seq, c.id, 'end', fx.f(96));
  assert.deepEqual(framesOf(c, 24), [0, 96]);
  close(c.speed, 0.5);
  close(c.keyframes['transform.x'][0].t, 2);
  const d = fx.clip(fx.V2, 48, 48);
  rateStretch(fx.project, fx.seq, d.id, 'start', fx.f(72));
  assert.deepEqual(framesOf(d, 24), [72, 96]);
  close(d.speed, 2);
  const e = fx.clip(fx.V3, 0, 240);
  rateStretch(fx.project, fx.seq, e.id, 'end', fx.f(1));
  assert.deepEqual(framesOf(e, 24), [0, 3]);
  close(e.speed, 80);
  const g = fx.clip(fx.V1, 200, 24);
  fx.clip(fx.V1, 240, 24);
  rateStretch(fx.project, fx.seq, g.id, 'end', fx.f(300));
  assert.deepEqual(framesOf(g, 24), [200, 240]);
  close(g.speed, 0.6);
});
