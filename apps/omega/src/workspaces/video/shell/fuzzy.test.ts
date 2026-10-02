import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyMatch, searchScore } from './fuzzy';

test('substring beats scattered subsequence', () => {
  const a = fuzzyMatch('split', 'Split at playhead')!;
  const b = fuzzyMatch('split', 'Select previous linked item')!;
  assert.ok(a.score > (b?.score ?? -Infinity));
  assert.deepEqual(a.positions, [0, 1, 2, 3, 4]);
});

test('word-start initials match', () => {
  const m = fuzzyMatch('rd', 'Ripple delete');
  assert.ok(m);
  assert.deepEqual(m!.positions, [0, 7]);
});

test('missing characters do not match', () => {
  assert.equal(fuzzyMatch('xyz', 'Split at playhead'), null);
});

test('multi-word queries need every token', () => {
  assert.ok(searchScore('add marker', { label: 'Add marker' }));
  assert.ok(searchScore('marker add', { label: 'Add marker' }));
  assert.equal(searchScore('add zebra', { label: 'Add marker' }), null);
});

test('extra fields match with lower weight', () => {
  const byLabel = searchScore('color', { label: 'Color workspace' })!;
  const byGroup = searchScore('color', { label: 'Copy grade', extra: [{ text: 'Color', weight: 0.6 }] })!;
  assert.ok(byLabel.score > byGroup.score);
  assert.deepEqual(byGroup.positions, []);
});
