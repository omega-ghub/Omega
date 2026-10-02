import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closeAllGaps,
  closeGap,
  deleteClips,
  extendEdit,
  extractSelection,
  insertGap,
  liftSelection,
  removeRange,
  rippleDeleteGap,
  splitAllTracks,
  splitAt,
  trimClip,
  trimToPlayhead,
} from './ops';
import { sourceTimeAt } from '../time';
import { assertClean, fixture, framesOf, layout } from './testkit';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

test('split: linked pair splits together; each half pair shares a link, the right one fresh', () => {
  const fx = fixture(24);
  const [v, s] = fx.av(0, 96);
  const link = v.linkId;
  const ids = splitAt(fx.seq, [v.id], fx.f(48));
  assert.equal(ids.length, 2);
  const rv = fx.V1.clips.find((c) => ids.includes(c.id))!;
  const rs = fx.A1.clips.find((c) => ids.includes(c.id))!;
  assert.equal(rv.linkId, rs.linkId);
  assert.notEqual(rv.linkId, link);
  assert.equal(v.linkId, link);
  assert.equal(s.linkId, link);
  assert.deepEqual(layout(fx.V1, 24), [[0, 48], [48, 96]]);
  assert.deepEqual(layout(fx.A1, 24), [[0, 48], [48, 96]]);
});

test('split: source continues across the cut; keyframes stay put; edge-only splits are no-ops', () => {
  const fx = fixture(24);
  const c = fx.clip(fx.V1, 0, 96, { inPoint: 1, keyframes: { 'transform.scale': [{ t: 3, v: 2, ease: 'linear' }] } });
  const [id] = splitAt(fx.seq, [c.id], fx.f(48));
  const r = fx.V1.clips.find((x) => x.id === id)!;
  assert.equal(r.inPoint, 3);
  assert.equal(r.keyframes['transform.scale'][0].t, 1);
  assert.deepEqual(splitAt(fx.seq, [c.id], 0), []);
  assert.deepEqual(splitAt(fx.seq, [c.id], fx.f(48)), []);
});

test('split: a reversed clip shows the same frames on both sides of the cut', () => {
  const fx = fixture(24);
  const c = fx.clip(fx.V1, 0, 96, { inPoint: 1, reverse: true });
  const before = [0.5, 1, 1.9, 2.5, 3.5].map((t) => sourceTimeAt(c, t));
  const [id] = splitAt(fx.seq, [c.id], fx.f(48));
  const r = fx.V1.clips.find((x) => x.id === id)!;
  const after = [0.5, 1, 1.9].map((t) => sourceTimeAt(c, t)).concat([2.5, 3.5].map((t) => sourceTimeAt(r, t - 2)));
  after.forEach((v, i) => close(v, before[i]));
  assert.equal(c.inPoint, 3);
  assert.equal(r.inPoint, 1);
});

test('split: transitions and fades go to the outer halves', () => {
  const fx = fixture(24);
  const c = fx.clip(fx.V1, 0, 96, { fadeIn: 0.5, fadeOut: 0.5, transitionIn: { type: 'crossDissolve', duration: 0.5, params: {}, ease: 'linear' }, transitionOut: { type: 'dipToBlack', duration: 0.5, params: {}, ease: 'linear' } });
  const [id] = splitAt(fx.seq, [c.id], fx.f(48));
  const r = fx.V1.clips.find((x) => x.id === id)!;
  assert.ok(c.transitionIn);
  assert.equal(c.transitionOut, null);
  assert.equal(c.fadeIn, 0.5);
  assert.equal(c.fadeOut, 0);
  assert.equal(r.transitionIn, null);
  assert.equal(r.transitionOut?.type, 'dipToBlack');
  assert.equal(r.fadeIn, 0);
  assert.equal(r.fadeOut, 0.5);
});

test('split null: targeted unlocked tracks (plus linked partners) only', () => {
  const fx = fixture(24);
  fx.av(0, 96);
  fx.clip(fx.V2, 0, 96);
  fx.clip(fx.V3, 0, 96);
  fx.V2.targeted = false;
  fx.A1.targeted = false;
  fx.V3.locked = true;
  const ids = splitAt(fx.seq, null, fx.f(30));
  assert.equal(ids.length, 2);
  assert.equal(fx.V1.clips.length, 2);
  assert.equal(fx.A1.clips.length, 2, 'linked audio follows even when untargeted');
  assert.equal(fx.V2.clips.length, 1);
  assert.equal(fx.V3.clips.length, 1);
});

test('splitAllTracks: every unlocked track, targeted or not', () => {
  const fx = fixture(24);
  fx.clip(fx.V1, 0, 96);
  fx.clip(fx.V2, 0, 96);
  fx.clip(fx.A3, 0, 96);
  fx.V2.targeted = false;
  fx.A3.locked = true;
  assert.equal(splitAllTracks(fx.seq, fx.f(10)).length, 2);
  assert.equal(fx.A3.clips.length, 1);
});

test('delete: linked partners go too; non-ripple leaves the gap', () => {
  const fx = fixture(24);
  fx.av(0, 24);
  const [B] = fx.av(24, 24);
  fx.av(48, 24);
  deleteClips(fx.seq, [B.id], false);
  assert.deepEqual(layout(fx.V1, 24), [[0, 24], [48, 72]]);
  assert.deepEqual(layout(fx.A1, 24), [[0, 24], [48, 72]]);
});

test('ripple delete: closes on every unlocked track; a music bed spanning the cut stays', () => {
  const fx = fixture(24);
  fx.av(0, 48);
  const [B] = fx.av(48, 24);
  fx.av(72, 48);
  const music = fx.clip(fx.A2, 0, 200);
  const captions = fx.seq.tracks.length;
  assert.equal(captions, 6);
  deleteClips(fx.seq, [B.id], true);
  assert.deepEqual(layout(fx.V1, 24), [[0, 48], [48, 96]]);
  assert.deepEqual(layout(fx.A1, 24), [[0, 48], [48, 96]]);
  assert.deepEqual(framesOf(music, 24), [0, 200]);
  assertClean(fx.seq);
});

test('ripple delete: limited by a later clip on another track (no sync break)', () => {
  const fx = fixture(24);
  fx.av(0, 48);
  const [B] = fx.av(48, 24);
  const [C] = fx.av(72, 48);
  fx.clip(fx.A2, 0, 60);
  const m2 = fx.clip(fx.A2, 80, 40);
  deleteClips(fx.seq, [B.id], true);
  assert.deepEqual(framesOf(C, 24), [52, 100]);
  assert.deepEqual(framesOf(m2, 24), [60, 100]);
  assertClean(fx.seq);
});

test('ripple delete with syncLock:false closes only the clip’s own tracks', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 24);
  const B = fx.clip(fx.V1, 24, 24);
  const other = fx.clip(fx.V2, 60, 10);
  deleteClips(fx.seq, [A.id], true, { syncLock: false });
  assert.deepEqual(framesOf(B, 24), [0, 24]);
  assert.deepEqual(framesOf(other, 24), [60, 70]);
});

test('lift: removes the range on targeted tracks only and leaves a gap', () => {
  const fx = fixture(24);
  fx.av(0, 96);
  const title = fx.clip(fx.V2, 30, 10);
  fx.V2.targeted = false;
  removeRange(fx.seq, fx.f(24), fx.f(48), false);
  assert.deepEqual(layout(fx.V1, 24), [[0, 24], [48, 96]]);
  assert.deepEqual(layout(fx.A1, 24), [[0, 24], [48, 96]]);
  assert.deepEqual(framesOf(title, 24), [30, 40]);
  const right = fx.V1.clips[1];
  assert.equal(right.inPoint, 2);
});

test('extract: closes the range with sync lock (untargeted tracks shift when they can)', () => {
  const fx = fixture(24);
  fx.av(0, 96);
  const later = fx.clip(fx.V2, 60, 12);
  fx.V2.targeted = false;
  removeRange(fx.seq, fx.f(24), fx.f(48), true);
  assert.deepEqual(layout(fx.V1, 24), [[0, 24], [24, 72]]);
  assert.deepEqual(layout(fx.A1, 24), [[0, 24], [24, 72]]);
  assert.deepEqual(framesOf(later, 24), [36, 48]);
  assertClean(fx.seq);
});

test('extract restricted to explicit tracks with syncLock:false', () => {
  const fx = fixture(24);
  fx.clip(fx.V1, 0, 96);
  const a = fx.clip(fx.A1, 60, 12);
  removeRange(fx.seq, fx.f(24), fx.f(48), true, [fx.V1.id], { syncLock: false });
  assert.deepEqual(layout(fx.V1, 24), [[0, 24], [24, 72]]);
  assert.deepEqual(framesOf(a, 24), [60, 72]);
});

test('lift/extract selection: uses In/Out when set, else the given clips', () => {
  const fx = fixture(24);
  fx.clip(fx.V1, 0, 96);
  fx.seq.inPoint = fx.f(24);
  fx.seq.outPoint = fx.f(48);
  assert.ok(extractSelection(fx.seq));
  assert.deepEqual(layout(fx.V1, 24), [[0, 24], [24, 72]]);
  fx.seq.inPoint = null;
  fx.seq.outPoint = null;
  const id = fx.V1.clips[0].id;
  assert.ok(liftSelection(fx.seq, [id]));
  assert.deepEqual(layout(fx.V1, 24), [[24, 72]]);
  assert.ok(!liftSelection(fx.seq));
});

test('closeGap: closes the gap under the time with sync lock', () => {
  const fx = fixture(24);
  fx.av(0, 24);
  const [B, b] = fx.av(48, 24);
  const closed = closeGap(fx.seq, fx.V1.id, fx.f(30));
  close(closed, 1);
  assert.deepEqual(framesOf(B, 24), [24, 48]);
  assert.deepEqual(framesOf(b, 24), [24, 48]);
  assert.equal(closeGap(fx.seq, fx.V1.id, fx.f(10)), 0, 'inside a clip: nothing');
});

test('closeGap null: every gap on the track including the leading one; rippleDeleteGap', () => {
  const fx = fixture(24);
  fx.clip(fx.V1, 12, 12);
  fx.clip(fx.V1, 48, 24);
  closeGap(fx.seq, fx.V1.id, null);
  assert.deepEqual(layout(fx.V1, 24), [[0, 12], [12, 36]]);
  const fx2 = fixture(24);
  fx2.clip(fx2.V2, 0, 10);
  const x = fx2.clip(fx2.V2, 20, 10);
  rippleDeleteGap(fx2.seq, fx2.V2.id, fx2.f(15));
  assert.deepEqual(framesOf(x, 24), [10, 20]);
});

test('closeAllGaps: only gaps common to the tracks (keeps them in sync); one track compacts fully', () => {
  const fx = fixture(24);
  fx.clip(fx.V1, 0, 24);
  fx.clip(fx.V1, 48, 24);
  fx.clip(fx.A1, 0, 24);
  fx.clip(fx.A1, 36, 36);
  close(closeAllGaps(fx.seq), fx.f(12));
  assert.deepEqual(layout(fx.V1, 24), [[0, 24], [36, 60]]);
  assert.deepEqual(layout(fx.A1, 24), [[0, 24], [24, 60]]);
  closeAllGaps(fx.seq, fx.V1.id);
  assert.deepEqual(layout(fx.V1, 24), [[0, 24], [24, 48]]);
  assert.deepEqual(layout(fx.A1, 24), [[0, 24], [24, 60]]);
  assert.equal(closeAllGaps.length, 2, 'timeline detects the (seq, trackIds) form');
});

test('insertGap: splits and pushes every unlocked track', () => {
  const fx = fixture(24);
  fx.clip(fx.V1, 0, 48);
  fx.clip(fx.A1, 24, 24);
  insertGap(fx.seq, fx.f(12), 1);
  assert.deepEqual(layout(fx.V1, 24), [[0, 12], [36, 72]]);
  assert.deepEqual(layout(fx.A1, 24), [[48, 72]]);
});

test('trimToPlayhead Q / W: ripple-trims the previous / next edit on targeted tracks', () => {
  const fx = fixture(24);
  fx.av(0, 48);
  const [B, b] = fx.av(48, 48);
  const [C] = fx.av(96, 24);
  assert.ok(trimToPlayhead(fx.seq, fx.f(60), 'start', true));
  assert.deepEqual(framesOf(B, 24), [48, 84]);
  assert.equal(B.inPoint, 0.5);
  assert.deepEqual(framesOf(b, 24), [48, 84]);
  assert.deepEqual(framesOf(C, 24), [84, 108]);
  assert.ok(trimToPlayhead(fx.seq, fx.f(60), 'end', true));
  assert.deepEqual(framesOf(B, 24), [48, 60]);
  assert.deepEqual(framesOf(C, 24), [60, 84]);
  assertClean(fx.seq);
});

test('trimToPlayhead works on unlinked clips across tracks where per-clip ripple trims block', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 48);
  const a = fx.clip(fx.A1, 0, 48);
  const B = fx.clip(fx.V1, 48, 48);
  const b = fx.clip(fx.A1, 48, 48);
  // a single ripple trim would collide with the unlinked audio
  assert.equal(trimClip(fx.project, fx.seq, A.id, 'start', fx.f(24), 'ripple'), 0);
  assert.ok(trimToPlayhead(fx.seq, fx.f(24), 'start', true));
  assert.deepEqual(framesOf(A, 24), [0, 24]);
  assert.deepEqual(framesOf(a, 24), [0, 24]);
  assert.deepEqual(framesOf(B, 24), [24, 72]);
  assert.deepEqual(framesOf(b, 24), [24, 72]);
  // without ripple: just trims (Alt+Q)
  assert.ok(trimToPlayhead(fx.seq, fx.f(30), 'start', false));
  assert.deepEqual(framesOf(B, 24), [30, 72]);
  assert.ok(!trimToPlayhead(fx.seq, fx.f(500), 'start', true));
});

test('extendEdit (E): rolls the selected clip’s edge to the playhead, or the nearest edit', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 48);
  const B = fx.clip(fx.V1, 48, 48, { inPoint: 3 });
  assert.ok(extendEdit(fx.seq, fx.f(60), { clipIds: [A.id], project: fx.project }));
  assert.deepEqual(framesOf(A, 24), [0, 60]);
  assert.deepEqual(framesOf(B, 24), [60, 96]);
  assert.ok(extendEdit(fx.seq, fx.f(55), { project: fx.project }));
  assert.deepEqual(framesOf(A, 24), [0, 55]);
  assert.deepEqual(framesOf(B, 24), [55, 96]);
  close(B.inPoint, 3 + 7 / 24);
});
