import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ParamDef } from '../../../engine/effects/types';
import type { Clip } from '../../../state/types';
import {
  clampParam,
  copyEffects,
  dropIndex,
  formatPoint,
  groupByCategory,
  matchScore,
  moveItem,
  parseFavKey,
  parsePoint,
  pasteEffects,
  removeEffect,
  resetEffect,
  searchItems,
  sliderRange,
  toggleFavorite,
  favKey,
} from './logic';

const items = [
  { type: 'gaussianBlur', name: 'Gaussian Blur', category: 'Blur & Sharpen', description: 'Smooth blur.', keywords: ['soften', 'defocus'] },
  { type: 'lensBlur', name: 'Lens Blur', category: 'Blur & Sharpen', description: 'Bokeh defocus.', keywords: ['bokeh'] },
  { type: 'chromaKey', name: 'Chroma Key', category: 'Keying', description: 'Keys out a green screen.', keywords: ['green screen', 'keyer'] },
  { type: 'glow', name: 'Glow', category: 'Stylize', description: 'Bright areas glow.', keywords: ['shine'] },
];

test('search ranks name matches above keywords and description', () => {
  assert.deepEqual(
    searchItems(items, 'blur').map((i) => i.type),
    ['gaussianBlur', 'lensBlur'],
  );
  // keyword match
  assert.deepEqual(
    searchItems(items, 'green').map((i) => i.type),
    ['chromaKey'],
  );
  // prefix of a word in a multi-word keyword
  assert.deepEqual(
    searchItems(items, 'scree').map((i) => i.type),
    ['chromaKey'],
  );
  // every term must match
  assert.deepEqual(searchItems(items, 'lens bokeh').map((i) => i.type), ['lensBlur']);
  assert.equal(searchItems(items, 'lens green').length, 0);
  // empty query keeps order
  assert.deepEqual(
    searchItems(items, '  ').map((i) => i.type),
    items.map((i) => i.type),
  );
  // exact name wins
  assert.ok(matchScore(items[3], 'glow') > matchScore(items[0], 'glow'));
  // case and punctuation insensitive
  assert.equal(searchItems(items, 'GAUSSIAN-blur')[0].type, 'gaussianBlur');
  // camelCase type ids are searchable
  assert.equal(searchItems(items, 'chroma')[0].type, 'chromaKey');
});

test('groupByCategory keeps the given order and drops empty groups', () => {
  const g = groupByCategory(items, ['Keying', 'Color', 'Blur & Sharpen']);
  assert.deepEqual(
    g.map((x) => x.category),
    ['Keying', 'Blur & Sharpen', 'Stylize'],
  );
  assert.equal(g[1].items.length, 2);
});

test('points parse and format', () => {
  assert.deepEqual(parsePoint('0.25,0.75'), { x: 0.25, y: 0.75 });
  assert.deepEqual(parsePoint('bad', { x: 1, y: 2 }), { x: 1, y: 2 });
  assert.deepEqual(parsePoint(3), { x: 0.5, y: 0.5 });
  assert.equal(formatPoint({ x: 0.123456789, y: 1 }), '0.1235,1');
});

test('slider range prefers soft limits', () => {
  const p: ParamDef = { key: 'r', label: 'R', type: 'number', default: 10, min: 0, max: 1000, softMax: 200 };
  assert.deepEqual(sliderRange(p), { min: 0, max: 200 });
  const q: ParamDef = { key: 'q', label: 'Q', type: 'number', default: 5 };
  const r = sliderRange(q);
  assert.ok(r.min < 5 && r.max > 5);
  assert.equal(clampParam(p, 5000), 1000);
  assert.equal(clampParam(p, -1), 0);
  assert.equal(clampParam(p, NaN), 10);
});

function clipWith(): Clip {
  return {
    id: 'c1',
    duration: 4,
    effects: [
      { id: 'fx_a', type: 'gaussianBlur', enabled: true, params: { radius: 12 } },
      { id: 'fx_b', type: 'glow', enabled: false, params: { radius: 30 } },
    ],
    keyframes: {
      'effects.fx_a.radius': [
        { t: 0, v: 0, ease: 'linear' },
        { t: 3.5, v: 40, ease: 'linear' },
      ],
      'transform.x': [{ t: 0, v: 1, ease: 'linear' }],
    },
  } as unknown as Clip;
}

test('copy/paste effects carries keyframes under new ids', () => {
  const src = clipWith();
  const payload = copyEffects(src, ['fx_a']);
  assert.equal(payload.effects.length, 1);
  assert.equal(payload.keyframes.fx_a.radius.length, 2);
  const dst = { ...clipWith(), effects: [], keyframes: {}, duration: 2 } as unknown as Clip;
  let n = 0;
  const ids = pasteEffects(dst, payload, () => `fx_new${++n}`);
  assert.deepEqual(ids, ['fx_new1']);
  assert.equal(dst.effects[0].type, 'gaussianBlur');
  // the key at 3.5 s is beyond the 2 s clip and is dropped
  assert.deepEqual(
    dst.keyframes['effects.fx_new1.radius'].map((k) => k.t),
    [0],
  );
  // the source is untouched (deep copies)
  payload.effects[0].params.radius = 99;
  assert.equal(src.effects[0].params.radius, 12);
});

test('paste inserts at an index', () => {
  const dst = clipWith();
  const payload = copyEffects(clipWith(), ['fx_b']);
  pasteEffects(dst, payload, () => 'fx_x', 0);
  assert.deepEqual(
    dst.effects.map((e) => e.id),
    ['fx_x', 'fx_a', 'fx_b'],
  );
});

test('remove and reset drop the effect keyframes', () => {
  const c = clipWith();
  resetEffect(c, 'fx_a', [{ key: 'radius', label: 'R', type: 'number', default: 5 }]);
  assert.equal(c.effects[0].params.radius, 5);
  assert.equal(c.keyframes['effects.fx_a.radius'], undefined);
  assert.ok(c.keyframes['transform.x']);
  const d = clipWith();
  removeEffect(d, 'fx_a');
  assert.deepEqual(
    d.effects.map((e) => e.id),
    ['fx_b'],
  );
  assert.equal(d.keyframes['effects.fx_a.radius'], undefined);
});

test('reorder helpers', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(moveItem(['a', 'b'], 5, 0), ['a', 'b']);
  // drag item 0 below item 2 → final index 2
  assert.equal(dropIndex(0, 2, true), 2);
  // drag item 3 above item 1 → index 1
  assert.equal(dropIndex(3, 1, false), 1);
});

test('favorites keep insertion order', () => {
  let f: string[] = [];
  f = toggleFavorite(f, favKey('effect', 'glow'));
  f = toggleFavorite(f, favKey('transition', 'wipe'));
  f = toggleFavorite(f, favKey('effect', 'glow'));
  assert.deepEqual(f, ['transition:wipe']);
  assert.deepEqual(parseFavKey('effect:gaussianBlur'), { kind: 'effect', type: 'gaussianBlur' });
  assert.equal(parseFavKey('nope'), null);
});
