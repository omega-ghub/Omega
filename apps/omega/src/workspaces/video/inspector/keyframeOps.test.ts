import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyKeys, deleteKeys, easeControlPoints, moveKeys, pasteKeys, setKeysEase, valueRange, writeKeysDraft } from './keyframeOps';
import type { Clip, Keyframe } from '../../../state/types';

const k = (t: number, v: number): Keyframe => ({ t, v, ease: 'linear' });

test('moveKeys shifts selected keys, replaces collisions and keeps order', () => {
  const list = [k(0, 0), k(1, 10), k(2, 20)];
  assert.deepEqual(
    moveKeys(list, [1], 0.5).map((x) => x.t),
    [0, 1.5, 2],
  );
  // moving key 0 onto key 1 replaces it
  const r = moveKeys(list, [0], 1);
  assert.deepEqual(
    r.map((x) => [x.t, x.v]),
    [
      [1, 0],
      [2, 20],
    ],
  );
  // values and clamping
  const c = moveKeys(list, [2], 5, 3, 0, 2.5);
  assert.deepEqual(c[c.length - 1], { t: 2.5, v: 23, ease: 'linear' });
  // input untouched
  assert.equal(list[1].t, 1);
});

test('deleteKeys and setKeysEase', () => {
  const list = [k(0, 0), k(1, 10), k(2, 20)];
  assert.deepEqual(
    deleteKeys(list, [1]).map((x) => x.t),
    [0, 2],
  );
  const eased = setKeysEase(list, [0, 2], 'bezier', [0.1, 0.2, 0.3, 0.4]);
  assert.equal(eased[0].ease, 'bezier');
  assert.deepEqual(eased[0].bez, [0.1, 0.2, 0.3, 0.4]);
  assert.equal(eased[1].ease, 'linear');
  const back = setKeysEase(eased, [0], 'hold');
  assert.equal(back[0].bez, undefined);
  assert.equal(easeControlPoints('hold'), null);
  assert.deepEqual(easeControlPoints('easeInOut'), [0.42, 0, 0.58, 1]);
});

test('copy and paste keys keep relative timing', () => {
  const clip = { keyframes: { 'transform.x': [k(1, 5), k(2, 6)], 'transform.opacity': [k(1.5, 0.5)] } } as unknown as Clip;
  const clipboard = copyKeys(clip, [
    { path: 'transform.x', t: 2 },
    { path: 'transform.opacity', t: 1.5 },
  ]);
  assert.deepEqual(
    clipboard.map((e) => [e.path, e.dt, e.v]),
    [
      ['transform.x', 0.5, 6],
      ['transform.opacity', 0, 0.5],
    ],
  );
  const pasted = pasteKeys([k(0, 1), k(4.5, 2)], clipboard.filter((e) => e.path === 'transform.x'), 4);
  assert.deepEqual(
    pasted.map((x) => [x.t, x.v]),
    [
      [0, 1],
      [4.5, 6],
    ],
  );
});

test('writeKeysDraft: empty list stops animation and keeps the value', () => {
  const clip = { keyframes: { 'transform.opacity': [k(0, 0), k(2, 1)] }, transform: { opacity: 1 } } as unknown as Clip;
  writeKeysDraft(clip, 'transform.opacity', [], 1);
  assert.equal(clip.keyframes['transform.opacity'], undefined);
  assert.equal((clip as unknown as { transform: { opacity: number } }).transform.opacity, 0.5);
});

test('valueRange pads flat ranges', () => {
  const r = valueRange([k(0, 5), k(1, 5)]);
  assert.ok(r.max > 5 && r.min < 5);
  const r2 = valueRange([k(0, 0), k(1, 100)]);
  assert.ok(r2.min < 0 && r2.max > 100);
});
