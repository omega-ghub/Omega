import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTrack, addTransition, closeGap, deleteClips, moveClips, nestClips, placeMedia, removeRange, slipClip, splitAt, trimClip } from './ops';
import { makeTransition } from '../../state/defaults';
import { assertClean, fixture, framesOf, layout } from './testkit';

test('sync lock: caption cues follow inserts and ripple deletes', () => {
  const fx = fixture(24);
  const C1 = addTrack(fx.seq, 'caption');
  C1.cues.push({ id: 'q1', start: fx.f(10), end: fx.f(20), text: 'Hello' }, { id: 'q2', start: fx.f(100), end: fx.f(110), text: 'World' });
  fx.clip(fx.V1, 0, 48);
  const B = fx.clip(fx.V1, 48, 48);
  fx.clip(fx.V1, 96, 48);
  deleteClips(fx.seq, [B.id], true);
  assert.deepEqual(C1.cues.map((q) => [fx.F(q.start), fx.F(q.end)]), [[10, 20], [52, 62]]);
  const a = fx.asset({ duration: 1 });
  placeMedia(fx.project, fx.seq, a.id, { start: 0, mode: 'insert' });
  assert.deepEqual(C1.cues.map((q) => [fx.F(q.start), fx.F(q.end)]), [[34, 44], [76, 86]]);
  // a locked caption track stays put
  C1.locked = true;
  placeMedia(fx.project, fx.seq, a.id, { start: 0, mode: 'insert' });
  assert.deepEqual(C1.cues.map((q) => [fx.F(q.start), fx.F(q.end)]), [[34, 44], [76, 86]]);
});

test('lift on a targeted caption track trims and splits cues', () => {
  const fx = fixture(24);
  const C1 = addTrack(fx.seq, 'caption');
  C1.cues.push({ id: 'q1', start: 0, end: 4, text: 'Long line' });
  removeRange(fx.seq, 1, 2, false, [C1.id]);
  assert.deepEqual(C1.cues.map((q) => [q.start, q.end, q.text]), [[0, 1, 'Long line'], [2, 4, 'Long line']]);
  assert.notEqual(C1.cues[0].id, C1.cues[1].id);
});

test('nested-sequence clips are limited by the nested sequence length', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 48);
  nestClips(fx.project, fx.seq, [A.id]);
  const nv = fx.V1.clips[0];
  trimClip(fx.project, fx.seq, nv.id, 'end', fx.f(200), 'normal');
  assert.deepEqual(framesOf(nv, 24), [0, 48]);
  trimClip(fx.project, fx.seq, nv.id, 'end', fx.f(24), 'normal');
  slipClip(fx.project, fx.seq, nv.id, 5);
  assert.equal(nv.inPoint, 1, 'slip stops at the end of the nested sequence');
});

test('freeze frames trim freely (no source limit) and keep their held frame', () => {
  const fx = fixture(24);
  const a = fx.asset({ duration: 2 });
  const h = fx.clip(fx.V1, 0, 24, { assetId: a.id, holdFrame: 1.5, inPoint: 1.5 });
  trimClip(fx.project, fx.seq, h.id, 'end', fx.f(500), 'normal');
  assert.deepEqual(framesOf(h, 24), [0, 500]);
  trimClip(fx.project, fx.seq, h.id, 'start', fx.f(100), 'normal');
  assert.equal(h.holdFrame, 1.5);
  assert.equal(h.inPoint, 1.5);
});

test('slip: a typed source in lands exactly, even from an off-grid in point', () => {
  const fx = fixture(24);
  const c = fx.clip(fx.V1, 0, 48, { inPoint: 1.013 });
  slipClip(fx.project, fx.seq, c.id, 2 - c.inPoint);
  assert.equal(c.inPoint, 2);
});

test('overwriting across a cut removes the transition there; ripple trims keep it', () => {
  const fx = fixture(24);
  fx.clip(fx.V1, 0, 48);
  const B = fx.clip(fx.V1, 48, 48, { inPoint: 2, transitionIn: makeTransition('crossDissolve', 0.5) });
  const C = fx.clip(fx.V1, 96, 48, { inPoint: 2 });
  addTransition(fx.seq, C.id, 'start', 'crossDissolve', 0.5);
  trimClip(fx.project, fx.seq, B.id, 'start', fx.f(60), 'ripple');
  assert.ok(B.transitionIn, 'ripple keeps B against A');
  assert.ok(C.transitionIn, 'and C against B');
  const a = fx.asset({ duration: 1, hasAudio: false });
  placeMedia(fx.project, fx.seq, a.id, { start: fx.f(36) });
  assert.equal(B.transitionIn, null);
  assert.ok(C.transitionIn);
});

test('insert move of a linked pair keeps it in sync across tracks', () => {
  const fx = fixture(24);
  const [A, a] = fx.av(0, 24);
  fx.av(24, 48);
  moveClips(fx.seq, [A.id], fx.f(48), 0, 'insert');
  assert.deepEqual(framesOf(A, 24), [48, 72]);
  assert.deepEqual(framesOf(a, 24), [48, 72]);
  assert.deepEqual(layout(fx.V1, 24), layout(fx.A1, 24));
  assertClean(fx.seq);
});

test('closeGap on one track with syncLock:false leaves other tracks alone', () => {
  const fx = fixture(24);
  fx.clip(fx.V1, 0, 24);
  const B = fx.clip(fx.V1, 48, 24);
  const s = fx.clip(fx.A1, 48, 24);
  closeGap(fx.seq, fx.V1.id, fx.f(30), { syncLock: false });
  assert.deepEqual(framesOf(B, 24), [24, 48]);
  assert.deepEqual(framesOf(s, 24), [48, 72]);
});

test('large timeline (5000 clips): edits stay interactive', () => {
  const fx = fixture(23.976);
  let t = 0;
  const vs = [];
  for (let i = 0; i < 2500; i++) {
    const v = fx.clip(fx.V1, t, 48, { linkId: `l${i}`, inPoint: 5 });
    fx.A1.clips.push({ ...structuredClone(v), id: `a${i}` });
    vs.push(v);
    t += 48;
  }
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) {
    trimClip(fx.project, fx.seq, vs[100 + i].id, 'end', vs[100 + i].start + 1, 'ripple');
    trimClip(fx.project, fx.seq, vs[300 + i].id, 'end', vs[300 + i].start + vs[300 + i].duration + 0.25, 'roll');
    splitAt(fx.seq, [vs[500 + i].id], vs[500 + i].start + 0.5);
  }
  const ms = performance.now() - t0;
  assert.ok(ms < 4000, `30 edits on 5000 clips took ${ms.toFixed(0)} ms`);
  assertClean(fx.seq);
});
