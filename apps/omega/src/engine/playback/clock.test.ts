import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRange,
  AutoScaler,
  droppedBetween,
  FpsMeter,
  lastFrameOf,
  loopRange,
  markOutAt,
  MasterClock,
  nextEditPoint,
  nextShuttleRate,
  outFrame,
  playStartTime,
  prevEditPoint,
  renderSize,
  sequenceEditPoints,
} from './clock';
import { toFrames } from '../time';
import type { Sequence } from '../../state/types';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('wall clock runs at rate', () => {
  let now = 1000;
  const c = new MasterClock(() => now);
  c.startWall(10, 1);
  now += 500;
  near(c.time(), 10.5);
  c.startWall(c.time(), 4);
  now += 250;
  near(c.time(), 11.5);
  c.startWall(5, -2);
  now += 1000;
  near(c.time(), 3);
});

test('clock holds until audio starts, then follows it without stepping back', () => {
  let now = 0;
  let audio = 2;
  const c = new MasterClock(() => now);
  c.startHeld(2);
  now += 100;
  near(c.time(), 2);
  assert.equal(c.isHolding, true);
  c.attachAudio(() => audio);
  audio = 2.05;
  near(c.time(), 2.05);
  audio = 2.04; // audio jitter must not run time backwards
  near(c.time(), 2.05);
  now += 400;
  audio = 2.5;
  near(c.time(), 2.5);
  c.fallbackToWall();
  now += 1000;
  near(c.time(), 3.5);
});

test('an audio clock that runs away from wall time is dropped', () => {
  let now = 0;
  let audio = 1;
  const c = new MasterClock(() => now);
  c.startHeld(1);
  c.attachAudio(() => audio);
  now += 200;
  audio = 1.2;
  near(c.time(), 1.2);
  assert.equal(c.usingAudio, true);
  // the device clock suddenly runs 3 s ahead
  now += 100;
  audio = 4.3;
  const t = c.time();
  assert.equal(c.usingAudio, false);
  assert.ok(c.rejectedAudio);
  assert.ok(t >= 1.2 && t <= 1.31, `continues from wall time (${t})`);
  now += 500;
  near(c.time(), t + 0.5);
});

test('J/L multi-tap shuttle speeds', () => {
  assert.equal(nextShuttleRate(0, 1), 1);
  assert.equal(nextShuttleRate(1, 1), 2);
  assert.equal(nextShuttleRate(2, 1), 4);
  assert.equal(nextShuttleRate(4, 1), 8);
  assert.equal(nextShuttleRate(8, 1), 8);
  assert.equal(nextShuttleRate(4, -1), -1);
  assert.equal(nextShuttleRate(-1, -1), -2);
  assert.equal(nextShuttleRate(-8, 1), 1);
});

test('loop range uses in/out when set', () => {
  assert.deepEqual(loopRange({ inPoint: null, outPoint: null }, 10), { start: 0, end: 10 });
  assert.deepEqual(loopRange({ inPoint: 2, outPoint: 5 }, 10), { start: 2, end: 5 });
  assert.deepEqual(loopRange({ inPoint: 2, outPoint: null }, 10), { start: 2, end: 10 });
  assert.deepEqual(loopRange({ inPoint: null, outPoint: 4 }, 10), { start: 0, end: 4 });
  // out beyond the end is clamped
  assert.deepEqual(loopRange({ inPoint: 1, outPoint: 20 }, 10), { start: 1, end: 10 });
});

test('range end: stop or wrap', () => {
  const r = { start: 2, end: 4 };
  assert.deepEqual(applyRange(3, 1, r, false, 24), { t: 3, event: 'none' });
  assert.deepEqual(applyRange(4.1, 1, r, false, 24), { t: 4, event: 'ended' });
  const w = applyRange(4.5, 1, r, true, 24);
  assert.equal(w.event, 'wrapped');
  near(w.t, 2.5);
  assert.deepEqual(applyRange(1.9, -1, r, false, 24), { t: 2, event: 'ended' });
  const back = applyRange(1.9, -1, r, true, 24);
  assert.equal(back.event, 'wrapped');
  assert.ok(back.t < 4 && back.t > 3.8);
});

test('play from the end restarts', () => {
  const r = { start: 0, end: 10 };
  assert.equal(playStartTime(10, r, 25, 1), 0);
  assert.equal(playStartTime(10 - 1 / 25, r, 25, 1), 0);
  assert.equal(playStartTime(3, r, 25, 1), 3);
  assert.equal(playStartTime(0, r, 25, -1), 10 - 1 / 25);
  near(lastFrameOf(r, 25), 9.96, 1e-9);
});

test('mark out includes the frame under the playhead', () => {
  const fps = 23.976;
  const t = 10 * (1001 / 24000);
  assert.equal(toFrames(markOutAt(t, fps, 100), fps), 11);
  assert.equal(toFrames(outFrame(markOutAt(t, fps, 100), fps), fps), 10);
  // at the very end the out point is clamped to the duration
  assert.equal(markOutAt(100, 25, 100), 100);
});

test('edit points and navigation', () => {
  const clip = (start: number, duration: number) => ({ start, duration }) as Sequence['tracks'][number]['clips'][number];
  const seq = {
    fps: 25,
    tracks: [
      { kind: 'video', clips: [clip(0, 2), clip(2, 3)], cues: [] },
      { kind: 'audio', clips: [clip(1, 2)], cues: [] },
      { kind: 'caption', clips: [], cues: [{ id: 'q', start: 7, end: 8, text: '' }] },
    ],
  } as unknown as Sequence;
  const pts = sequenceEditPoints(seq);
  assert.deepEqual(pts, [0, 1, 2, 3, 5, 8]);
  assert.equal(nextEditPoint(pts, 2, 25), 3);
  assert.equal(prevEditPoint(pts, 2, 25), 1);
  assert.equal(prevEditPoint(pts, 0, 25), null);
  assert.equal(nextEditPoint(pts, 8, 25), null);
});

test('render size respects scale, display and aspect', () => {
  assert.deepEqual(renderSize(3840, 2160, 960, 540, 1), { w: 960, h: 540 });
  assert.deepEqual(renderSize(3840, 2160, 3000, 1688, 0.5), { w: 1920, h: 1080 });
  assert.deepEqual(renderSize(3840, 2160, 3000, 1688, 0.25), { w: 960, h: 540 });
  // zoomed past 100%: never more than the sequence resolution
  assert.deepEqual(renderSize(1920, 1080, 4000, 2250, 1), { w: 1920, h: 1080 });
  assert.deepEqual(renderSize(1080, 1920, 300, 533, 1), { w: 300, h: 533 });
});

test('auto scaler steps down when slow and back up when fast', () => {
  const a = new AutoScaler();
  let now = 0;
  for (let i = 0; i < 10; i++) a.sample(40, false, 41.7, (now += 42));
  assert.equal(a.scale, 0.5);
  // cooldown: stays put right after a change
  for (let i = 0; i < 4; i++) a.sample(40, true, 41.7, (now += 42));
  assert.equal(a.scale, 0.5);
  for (let i = 0; i < 200; i++) a.sample(2, false, 41.7, (now += 42));
  assert.equal(a.scale, 1);
});

test('fps meter and dropped frames', () => {
  const m = new FpsMeter();
  for (let i = 0; i <= 24; i++) m.tick(i * (1000 / 24));
  near(m.fps(1000), 24, 0.01);
  assert.equal(droppedBetween(null, 5, 1), 0);
  assert.equal(droppedBetween(5, 6, 1), 0);
  assert.equal(droppedBetween(5, 9, 1), 3);
  assert.equal(droppedBetween(5, 9, 4), 0);
});
