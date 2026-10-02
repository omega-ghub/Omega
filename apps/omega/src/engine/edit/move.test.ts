import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeFrame, moveClips, moveClipsToTime, setSpeed, swapWithNeighbor } from './ops';
import { assertClean, fixture, framesOf, layout } from './testkit';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

test('move overwrite: the moved clip replaces what is under it', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 24);
  const B = fx.clip(fx.V1, 48, 48, { inPoint: 1 });
  const d = moveClips(fx.seq, [A.id], fx.f(60), 0, 'overwrite');
  close(d, fx.f(60));
  assert.deepEqual(layout(fx.V1, 24), [[48, 60], [60, 84], [84, 96]]);
  assert.deepEqual(framesOf(A, 24), [60, 84]);
  assert.deepEqual(framesOf(B, 24), [48, 60]);
  const right = fx.V1.clips.find((c) => c.start > 3)!;
  close(right.inPoint, 2.5);
  assertClean(fx.seq);
});

test('move insert: splits at the drop point and pushes every unlocked track; the origin keeps its gap', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 24);
  fx.clip(fx.V1, 24, 48);
  fx.clip(fx.V1, 72, 24);
  fx.clip(fx.A2, 30, 20);
  moveClips(fx.seq, [A.id], fx.f(48), 0, 'insert');
  assert.deepEqual(layout(fx.V1, 24), [[24, 48], [48, 72], [72, 96], [96, 120]]);
  assert.deepEqual(framesOf(A, 24), [48, 72]);
  assert.deepEqual(layout(fx.A2, 24), [[30, 48], [72, 74]]);
  assertClean(fx.seq);
});

test('move free: stops against the neighbour instead of overwriting', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 24);
  const B = fx.clip(fx.V1, 48, 24);
  const d = moveClips(fx.seq, [A.id], fx.f(40), 0, 'free');
  close(d, 1);
  assert.deepEqual(framesOf(A, 24), [24, 48]);
  assert.deepEqual(framesOf(B, 24), [48, 72]);
  assert.equal(moveClips(fx.seq, [A.id], fx.f(5), 0, 'free'), 0);
});

test('move: never before 0; locked clips stay', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 12, 24);
  moveClips(fx.seq, [A.id], -100, 0, 'overwrite');
  assert.deepEqual(framesOf(A, 24), [0, 24]);
  fx.V1.locked = true;
  moveClips(fx.seq, [A.id], 1, 0, 'overwrite');
  assert.deepEqual(framesOf(A, 24), [0, 24]);
});

test('move across tracks: linked audio mirrors the video (video up ⇒ audio down)', () => {
  const fx = fixture(24);
  const [v, s] = fx.av(0, 48);
  moveClips(fx.seq, [v.id], 0, -1, 'overwrite');
  assert.equal(fx.V2.clips[0], v);
  assert.equal(fx.A2.clips[0], s);
  assert.equal(fx.V1.clips.length + fx.A1.clips.length, 0);
  // dragging the audio down moves the video up (anchor = the dragged clip)
  moveClips(fx.seq, [v.id, s.id], 0, 1, 'overwrite', { anchorId: s.id });
  assert.equal(fx.V3.clips[0], v);
  assert.equal(fx.A3.clips[0], s);
});

test('move across tracks: refused when the destination is locked or missing', () => {
  const fx = fixture(24);
  const [v, s] = fx.av(0, 48);
  fx.V2.locked = true;
  moveClips(fx.seq, [v.id], fx.f(10), -1, 'overwrite');
  assert.equal(fx.V1.clips[0], v);
  assert.equal(fx.A1.clips[0], s, 'partner does not change tracks either');
  assert.deepEqual(framesOf(v, 24), [10, 58]);
  moveClips(fx.seq, [v.id], 0, 5, 'overwrite');
  assert.equal(fx.V1.clips[0], v);
});

test('move: groups and links come along unless unlinked', () => {
  const fx = fixture(24);
  const a = fx.clip(fx.V1, 0, 24, { groupId: 'g1' });
  const b = fx.clip(fx.V2, 10, 24, { groupId: 'g1' });
  const [v, s] = fx.av(100, 24);
  moveClips(fx.seq, [a.id], fx.f(24), 0, 'overwrite');
  assert.deepEqual(framesOf(b, 24), [34, 58]);
  moveClips(fx.seq, [v.id], fx.f(10), 0, 'overwrite', { unlinked: true });
  assert.deepEqual(framesOf(v, 24), [110, 134]);
  assert.deepEqual(framesOf(s, 24), [100, 124]);
});

test('moveClipsToTime: snaps a moving edge to the nearest edit point', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V2, 0, 24);
  fx.clip(fx.V1, 48, 48);
  const r = moveClipsToTime(fx.seq, [A.id], fx.f(46), { threshold: fx.f(3) });
  assert.equal(r.snappedTo, fx.f(48));
  assert.deepEqual(framesOf(A, 24), [48, 72]);
  const r2 = moveClipsToTime(fx.seq, [A.id], fx.f(30), { snap: false });
  assert.equal(r2.snappedTo, null);
  assert.deepEqual(framesOf(A, 24), [30, 54]);
  // the end edge snaps too
  moveClipsToTime(fx.seq, [A.id], fx.f(73), { threshold: fx.f(2) });
  assert.deepEqual(framesOf(A, 24), [72, 96]);
});

test('swapWithNeighbor: swaps order keeping the gap, linked audio follows', () => {
  const fx = fixture(24);
  const [A, a] = fx.av(0, 24);
  const [B, b] = fx.av(30, 48);
  assert.ok(swapWithNeighbor(fx.seq, A.id, 'right'));
  assert.deepEqual(framesOf(B, 24), [0, 48]);
  assert.deepEqual(framesOf(A, 24), [54, 78]);
  assert.deepEqual(framesOf(b, 24), [0, 48]);
  assert.deepEqual(framesOf(a, 24), [54, 78]);
  assert.ok(swapWithNeighbor(fx.seq, A.id, 'left'));
  assert.deepEqual(framesOf(A, 24), [0, 24]);
  assert.ok(!swapWithNeighbor(fx.seq, A.id, 'left'));
  assertClean(fx.seq);
});

test('setSpeed: the length becomes span/speed; linked audio too', () => {
  const fx = fixture(24);
  const [v, s] = fx.av(0, 96);
  setSpeed(fx.project, fx.seq, v.id, 2, {});
  assert.deepEqual(framesOf(v, 24), [0, 48]);
  assert.equal(v.speed, 2);
  assert.equal(s.speed, 2);
  assert.deepEqual(framesOf(s, 24), [0, 48]);
  setSpeed(fx.project, fx.seq, v.id, 1, {});
  assert.deepEqual(framesOf(v, 24), [0, 96], 'speed round trip restores the length');
});

test('setSpeed keepDuration: the length stays, limited by the source', () => {
  const fx = fixture(24);
  const c = fx.clip(fx.V1, 0, 96);
  setSpeed(fx.project, fx.seq, c.id, 2, { keepDuration: true });
  assert.deepEqual(framesOf(c, 24), [0, 96]);
  assert.equal(c.speed, 2);
  const a = fx.asset({ duration: 5 });
  const d = fx.clip(fx.V2, 0, 96, { assetId: a.id });
  setSpeed(fx.project, fx.seq, d.id, 2, { keepDuration: true });
  assert.deepEqual(framesOf(d, 24), [0, 60], 'only 5 s of media at 2×');
});

test('setSpeed ripple pulls / pushes later clips; without ripple a slower clip stops at the next', () => {
  const fx = fixture(24);
  const [A] = fx.av(0, 96);
  const [B, b] = fx.av(96, 24);
  setSpeed(fx.project, fx.seq, A.id, 2, { ripple: true });
  assert.deepEqual(framesOf(B, 24), [48, 72]);
  assert.deepEqual(framesOf(b, 24), [48, 72]);
  setSpeed(fx.project, fx.seq, A.id, 0.5, { ripple: true });
  assert.deepEqual(framesOf(A, 24), [0, 192]);
  assert.deepEqual(framesOf(B, 24), [192, 216]);
  const fx2 = fixture(24);
  const C = fx2.clip(fx2.V1, 0, 48);
  fx2.clip(fx2.V1, 48, 48);
  setSpeed(fx2.project, fx2.seq, C.id, 0.5, {});
  assert.deepEqual(framesOf(C, 24), [0, 48]);
  assert.equal(C.speed, 0.5);
  assertClean(fx.seq);
});

test('setSpeed: removes speed ramps, clamps 0.01–100×, sets reverse', () => {
  const fx = fixture(24);
  const c = fx.clip(fx.V1, 0, 48, { keyframes: { 'time.speed': [{ t: 0, v: 1, ease: 'linear' }, { t: 1, v: 2, ease: 'linear' }] } });
  setSpeed(fx.project, fx.seq, c.id, 1, { keepDuration: true });
  assert.equal(c.keyframes['time.speed'], undefined);
  setSpeed(fx.project, fx.seq, c.id, 1000, { keepDuration: true });
  assert.equal(c.speed, 100);
  setSpeed(fx.project, fx.seq, c.id, 1, { keepDuration: true });
  const before = c.inPoint;
  setSpeed(fx.project, fx.seq, c.id, 1, { reverse: true, keepDuration: true });
  assert.equal(c.reverse, true);
  assert.equal(c.inPoint, before);
  assert.deepEqual(framesOf(c, 24), [0, 48]);
});

test('freezeFrame: splits, inserts a hold segment and pushes everything (sound gets a gap)', () => {
  const fx = fixture(24);
  const [A, a] = fx.av(0, 96, { inPoint: 1 });
  const id = freezeFrame(fx.project, fx.seq, A.id, fx.f(24), 2);
  const hold = fx.V1.clips.find((c) => c.id === id)!;
  assert.ok(hold);
  assert.deepEqual(framesOf(hold, 24), [24, 72]);
  assert.equal(hold.holdFrame, 2);
  assert.equal(hold.linkId, undefined);
  assert.deepEqual(layout(fx.V1, 24), [[0, 24], [24, 72], [72, 144]]);
  assert.deepEqual(layout(fx.A1, 24), [[0, 24], [72, 144]]);
  assert.deepEqual(framesOf(A, 24), [0, 24]);
  assert.deepEqual(framesOf(a, 24), [0, 24]);
  const rest = fx.V1.clips.find((c) => c.start > 2)!;
  assert.equal(rest.inPoint, 2);
  // from the audio clip: uses the linked picture
  const id2 = freezeFrame(fx.project, fx.seq, a.id, 0, 1);
  assert.ok(id2);
  assertClean(fx.seq);
});
