import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addGeneratedClip, placeMedia } from './ops';
import { assertClean, fixture, framesOf, layout } from './testkit';

test('placeMedia: overwrite puts linked video + audio on the targeted tracks', () => {
  const fx = fixture(24);
  const a = fx.asset({ duration: 10 });
  const ids = placeMedia(fx.project, fx.seq, a.id, { start: 0 });
  assert.equal(ids.length, 2);
  const [v] = fx.V1.clips;
  const [s] = fx.A1.clips;
  assert.deepEqual(ids, [v.id, s.id]);
  assert.equal(v.linkId, s.linkId);
  assert.ok(v.linkId);
  assert.deepEqual(framesOf(v, 24), [0, 240]);
  assert.equal(v.inPoint, 0);
  assert.equal(v.assetId, a.id);
  assertClean(fx.seq);
});

test('placeMedia: honours markIn/markOut, and explicit sourceIn/sourceOut win', () => {
  const fx = fixture(24);
  const a = fx.asset({ duration: 10, markIn: 2, markOut: 5 });
  placeMedia(fx.project, fx.seq, a.id, { start: fx.f(10) });
  assert.deepEqual(framesOf(fx.V1.clips[0], 24), [10, 82]);
  assert.equal(fx.V1.clips[0].inPoint, 2);
  placeMedia(fx.project, fx.seq, a.id, { start: fx.f(100), sourceIn: 1, sourceOut: 1.5 });
  const c = fx.V1.clips[1];
  assert.deepEqual(framesOf(c, 24), [100, 112]);
  assert.equal(c.inPoint, 1);
});

test('placeMedia: stills last settings.stillDuration and have no audio', () => {
  const fx = fixture(25);
  fx.project.settings.stillDuration = 3;
  const img = fx.asset({ kind: 'image', duration: 0, hasAudio: false, hasVideo: true, name: 'still.png' });
  const ids = placeMedia(fx.project, fx.seq, img.id, { start: 0 });
  assert.equal(ids.length, 1);
  assert.deepEqual(framesOf(fx.V1.clips[0], 25), [0, 75]);
  assert.equal(fx.A1.clips.length, 0);
});

test('placeMedia: audio-only asset goes to A1 only', () => {
  const fx = fixture(24);
  const a = fx.asset({ kind: 'audio', hasVideo: false, duration: 4 });
  const ids = placeMedia(fx.project, fx.seq, a.id, { start: 0 });
  assert.equal(ids.length, 1);
  assert.equal(fx.V1.clips.length, 0);
  assert.deepEqual(layout(fx.A1, 24), [[0, 96]]);
});

test('placeMedia: insert splits at the insertion point and pushes every unlocked track (sync lock)', () => {
  const fx = fixture(24);
  const [v, s] = fx.av(0, 48);
  const music = fx.clip(fx.A2, 0, 96);
  const locked = fx.clip(fx.A3, 0, 96);
  fx.A3.locked = true;
  const a = fx.asset({ duration: 1 });
  placeMedia(fx.project, fx.seq, a.id, { start: fx.f(24), mode: 'insert' });
  assert.deepEqual(layout(fx.V1, 24), [[0, 24], [24, 48], [48, 72]]);
  assert.deepEqual(layout(fx.A1, 24), [[0, 24], [24, 48], [48, 72]]);
  assert.deepEqual(layout(fx.A2, 24), [[0, 24], [48, 120]]);
  assert.deepEqual(layout(fx.A3, 24), [[0, 96]], 'locked track untouched');
  assert.equal(locked.start, 0);
  // the right halves of the original pair are still paired, with a fresh link
  const rv = fx.V1.clips.find((c) => c.start > 1)!;
  const rs = fx.A1.clips.find((c) => c.start > 1)!;
  assert.equal(rv.linkId, rs.linkId);
  assert.notEqual(rv.linkId, v.linkId);
  assert.equal(v.linkId, s.linkId);
  assert.equal(rv.inPoint, 1, 'right half continues the source');
  assert.ok(music);
  assertClean(fx.seq);
});

test('placeMedia: overwrite trims, splits and removes what lies underneath', () => {
  const fx = fixture(24);
  const c1 = fx.clip(fx.V1, 0, 24);
  const c2 = fx.clip(fx.V1, 24, 24);
  const c3 = fx.clip(fx.V1, 48, 24);
  const a = fx.asset({ duration: 1.5, hasAudio: false });
  placeMedia(fx.project, fx.seq, a.id, { start: fx.f(12) });
  assert.deepEqual(layout(fx.V1, 24), [[0, 12], [12, 48], [48, 72]]);
  assert.ok(fx.V1.clips.includes(c1));
  assert.ok(!fx.V1.clips.includes(c2), 'fully covered clip removed');
  assert.ok(fx.V1.clips.includes(c3));
  // middle of one long clip: split around the new one
  const fx2 = fixture(24);
  const long = fx2.clip(fx2.V1, 0, 96, { inPoint: 1 });
  const b = fx2.asset({ duration: 1, hasAudio: false });
  placeMedia(fx2.project, fx2.seq, b.id, { start: fx2.f(24) });
  assert.deepEqual(layout(fx2.V1, 24), [[0, 24], [24, 48], [48, 96]]);
  const right = fx2.V1.clips.find((c) => c.start > 1.5)!;
  assert.equal(right.inPoint, 3, 'right piece advanced by 2 s of source');
  assert.equal(long.inPoint, 1);
  assertClean(fx2.seq);
});

test('placeMedia: locked and untargeted tracks are skipped', () => {
  const fx = fixture(24);
  fx.V1.locked = true;
  const under = fx.clip(fx.V1, 0, 48);
  const a = fx.asset({ duration: 1, hasAudio: false });
  placeMedia(fx.project, fx.seq, a.id, { start: 0 });
  assert.deepEqual(layout(fx.V1, 24), [[0, 48]]);
  assert.equal(under.duration, fx.f(48));
  assert.equal(fx.V2.clips.length, 1, 'goes to the next unlocked targeted track');
  const fx2 = fixture(24);
  fx2.V1.targeted = false;
  const b = fx2.asset({ duration: 1, hasAudio: false });
  placeMedia(fx2.project, fx2.seq, b.id, { start: 0 });
  assert.equal(fx2.V1.clips.length, 0);
  assert.equal(fx2.V2.clips.length, 1);
});

test('placeMedia: explicit destination tracks', () => {
  const fx = fixture(24);
  const a = fx.asset({ duration: 1 });
  placeMedia(fx.project, fx.seq, a.id, { start: 0, videoTrackId: fx.V3.id, audioTrackId: fx.A2.id });
  assert.equal(fx.V3.clips.length, 1);
  assert.equal(fx.A2.clips.length, 1);
  placeMedia(fx.project, fx.seq, a.id, { start: 1, video: false });
  assert.equal(fx.A1.clips.length, 1);
  assert.equal(fx.V1.clips.length, 0);
});

test('placeMedia: four-point duration and fit to fill', () => {
  const fx = fixture(24);
  const a = fx.asset({ duration: 10, markIn: 0, markOut: 4 });
  const [vid] = placeMedia(fx.project, fx.seq, a.id, { start: 0, duration: 2, fitToFill: true, audio: false });
  const c = fx.V1.clips.find((x) => x.id === vid)!;
  assert.equal(c.speed, 2);
  assert.deepEqual(framesOf(c, 24), [0, 48]);
  const b = fx.asset({ duration: 1 });
  placeMedia(fx.project, fx.seq, b.id, { start: fx.f(100), duration: 3, audio: false });
  assert.deepEqual(framesOf(fx.V1.clips[1], 24), [100, 124], 'cut to the available source');
});

test('placeMedia: unknown asset id is a no-op', () => {
  const fx = fixture(24);
  assert.deepEqual(placeMedia(fx.project, fx.seq, 'nope', { start: 0 }), []);
});

test('addGeneratedClip: lowest free track above what is there', () => {
  const fx = fixture(24);
  fx.clip(fx.V1, 0, 240);
  const id = addGeneratedClip(fx.project, fx.seq, 'text', { start: 0, duration: 2 });
  assert.equal(fx.V2.clips.length, 1);
  const t = fx.V2.clips[0];
  assert.equal(t.id, id);
  assert.equal(t.kind, 'text');
  assert.ok(t.text);
  assert.deepEqual(framesOf(t, 24), [0, 48]);
});

test('addGeneratedClip: creates a top track when every track is busy', () => {
  const fx = fixture(24);
  for (const tr of [fx.V1, fx.V2, fx.V3]) fx.clip(tr, 0, 120);
  const id = addGeneratedClip(fx.project, fx.seq, 'solid', { start: fx.f(10) });
  const top = fx.seq.tracks[0];
  assert.equal(top.name, 'V4');
  assert.equal(top.clips[0].id, id);
  assert.deepEqual(framesOf(top.clips[0], 24), [10, 130], 'still duration (5 s)');
});

test('addGeneratedClip: explicit track overwrites; empty time goes to V1', () => {
  const fx = fixture(24);
  fx.clip(fx.V1, 0, 96);
  addGeneratedClip(fx.project, fx.seq, 'adjustment', { start: fx.f(24), duration: 1, trackId: fx.V1.id });
  assert.deepEqual(layout(fx.V1, 24), [[0, 24], [24, 48], [48, 96]]);
  const fx2 = fixture(24);
  addGeneratedClip(fx2.project, fx2.seq, 'shape', { start: 0, init: { name: 'Box' } });
  assert.equal(fx2.V1.clips[0].name, 'Box');
});
