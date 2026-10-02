import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Bin, MediaAsset, Project } from '../../../state/types';
import {
  assetsInScope,
  binAncestors,
  canMoveBin,
  childBins,
  clickSelect,
  deleteBinInPlace,
  descendantBinIds,
  filterAssets,
  matchesQuery,
  rangeSelect,
  sortAssets,
  totalDuration,
  uniqueBinName,
} from './model';

function asset(id: string, init: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id,
    name: `${id}.mp4`,
    path: `/m/${id}.mp4`,
    kind: 'video',
    binId: null,
    duration: 10,
    hasAudio: true,
    hasVideo: true,
    inputTransform: 'auto',
    ...init,
  };
}

const bins: Bin[] = [
  { id: 'footage', name: 'Footage', parentId: null },
  { id: 'day1', name: 'Day 1', parentId: 'footage' },
  { id: 'day10', name: 'Day 10', parentId: 'footage' },
  { id: 'day2', name: 'Day 2', parentId: 'footage' },
  { id: 'audio', name: 'Audio', parentId: null },
  { id: 'deep', name: 'Selects', parentId: 'day1' },
];

test('search matches name, notes and codecs (all terms)', () => {
  const a = asset('a', { name: 'Interview Wide.mov', notes: 'good take, slate 12', codec: 'avc', audioCodec: 'aac' });
  assert.equal(matchesQuery(a, ''), true);
  assert.equal(matchesQuery(a, 'interview'), true);
  assert.equal(matchesQuery(a, 'slate'), true);
  assert.equal(matchesQuery(a, 'h.264'), true); // codec label
  assert.equal(matchesQuery(a, 'avc wide'), true);
  assert.equal(matchesQuery(a, 'avc tight'), false);
  assert.equal(matchesQuery(a, 'AAC'), true);
});

test('kind, offline and unused filters', () => {
  const list = [asset('v'), asset('s', { kind: 'audio', hasVideo: false }), asset('i', { kind: 'image' }), asset('o', { offline: true })];
  const used = new Set(['v', 's']);
  const ids = (f: Parameters<typeof filterAssets>[1]['filter']) => filterAssets(list, { query: '', filter: f, used }).map((a) => a.id);
  assert.deepEqual(ids('all'), ['v', 's', 'i', 'o']);
  assert.deepEqual(ids('video'), ['v', 'o']);
  assert.deepEqual(ids('audio'), ['s']);
  assert.deepEqual(ids('image'), ['i']);
  assert.deepEqual(ids('offline'), ['o']);
  assert.deepEqual(ids('unused'), ['i', 'o']);
});

test('sorting: natural names, numbers, direction, stable ties', () => {
  const list = [
    asset('c', { name: 'Shot 10', duration: 5, importedAt: 3, width: 1920, height: 1080 }),
    asset('a', { name: 'Shot 2', duration: 20, importedAt: 1, width: 3840, height: 2160 }),
    asset('b', { name: 'shot 1', duration: 5, importedAt: 2, kind: 'audio' }),
    asset('d', { name: 'Logo', kind: 'image', duration: 5, importedAt: 4, width: 512, height: 512 }),
  ];
  const ids = (k: Parameters<typeof sortAssets>[1], d: 'asc' | 'desc' = 'asc') => sortAssets(list, k, d).map((a) => a.id);
  assert.deepEqual(ids('name'), ['d', 'b', 'a', 'c']);
  assert.deepEqual(ids('name', 'desc'), ['c', 'a', 'b', 'd']);
  assert.deepEqual(ids('importedAt', 'desc'), ['d', 'c', 'b', 'a']);
  // images sort first by duration (stills have none); ties fall back to the name
  assert.deepEqual(ids('duration'), ['d', 'b', 'c', 'a']);
  assert.deepEqual(ids('kind'), ['a', 'c', 'b', 'd']);
  assert.deepEqual(ids('resolution', 'desc'), ['a', 'c', 'd', 'b']);
  // the input array is not mutated
  assert.deepEqual(list.map((a) => a.id), ['c', 'a', 'b', 'd']);
});

test('click selection: replace, toggle, shift range', () => {
  const ord = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(clickSelect(['a', 'b'], ord, 'a', 'c', 'replace'), ['c']);
  assert.deepEqual(clickSelect(['a'], ord, 'a', 'c', 'toggle'), ['a', 'c']);
  assert.deepEqual(clickSelect(['a', 'c'], ord, 'a', 'c', 'toggle'), ['a']);
  assert.deepEqual(clickSelect(['b'], ord, 'b', 'd', 'range'), ['b', 'c', 'd']);
  assert.deepEqual(clickSelect(['d'], ord, 'd', 'b', 'range'), ['b', 'c', 'd']);
  assert.deepEqual(rangeSelect(ord, 'zz', 'c'), ['c']);
  assert.deepEqual(rangeSelect(ord, null, 'x'), []);
});

test('bin tree: children sorted naturally, ancestors, descendants', () => {
  assert.deepEqual(
    childBins(bins, 'footage').map((b) => b.name),
    ['Day 1', 'Day 2', 'Day 10'],
  );
  assert.deepEqual(
    childBins(bins, null).map((b) => b.id),
    ['audio', 'footage'],
  );
  assert.deepEqual(
    binAncestors(bins, 'deep').map((b) => b.id),
    ['footage', 'day1', 'deep'],
  );
  assert.deepEqual(binAncestors(bins, null), []);
  assert.deepEqual([...descendantBinIds(bins, 'footage')].sort(), ['day1', 'day10', 'day2', 'deep', 'footage']);
  // cycle-safe ancestors
  const loop: Bin[] = [
    { id: 'x', name: 'X', parentId: 'y' },
    { id: 'y', name: 'Y', parentId: 'x' },
  ];
  assert.equal(binAncestors(loop, 'x').length, 2);
});

test('bins cannot move into themselves or their descendants', () => {
  assert.equal(canMoveBin(bins, 'footage', 'deep'), false);
  assert.equal(canMoveBin(bins, 'footage', 'footage'), false);
  assert.equal(canMoveBin(bins, 'day1', 'audio'), true);
  assert.equal(canMoveBin(bins, 'deep', null), true);
});

test('unique bin names per parent', () => {
  assert.equal(uniqueBinName(bins, null), 'New Bin');
  const more: Bin[] = [...bins, { id: 'n1', name: 'New Bin', parentId: null }, { id: 'n2', name: 'new bin 2', parentId: null }];
  assert.equal(uniqueBinName(more, null), 'New Bin 3');
  assert.equal(uniqueBinName(more, 'footage'), 'New Bin');
});

test('deleting a bin moves its contents up one level', () => {
  const p = {
    bins: bins.map((b) => ({ ...b })),
    assets: [asset('a', { binId: 'day1' }), asset('b', { binId: 'deep' }), asset('c', { binId: 'footage' })],
  } as unknown as Project;
  deleteBinInPlace(p, 'day1');
  assert.equal(p.bins.some((b) => b.id === 'day1'), false);
  assert.equal(p.assets.find((a) => a.id === 'a')!.binId, 'footage');
  assert.equal(p.bins.find((b) => b.id === 'deep')!.parentId, 'footage');
  assert.equal(p.assets.find((a) => a.id === 'b')!.binId, 'deep');
  deleteBinInPlace(p, 'footage');
  assert.equal(p.assets.find((a) => a.id === 'a')!.binId, null);
  assert.equal(p.bins.find((b) => b.id === 'deep')!.parentId, null);
});

test('scope: direct contents, recursive search scope, dangling bin ids land in the root', () => {
  const p = {
    bins,
    assets: [asset('r'), asset('a', { binId: 'day1' }), asset('b', { binId: 'deep' }), asset('x', { binId: 'gone' })],
  };
  assert.deepEqual(
    assetsInScope(p, null, false).map((a) => a.id),
    ['r', 'x'],
  );
  assert.deepEqual(
    assetsInScope(p, 'day1', false).map((a) => a.id),
    ['a'],
  );
  assert.deepEqual(
    assetsInScope(p, 'footage', true).map((a) => a.id),
    ['a', 'b'],
  );
  assert.equal(assetsInScope(p, null, true).length, 4);
});

test('total duration ignores stills', () => {
  assert.equal(totalDuration([asset('a', { duration: 10 }), asset('b', { duration: 2.5 }), asset('c', { kind: 'image', duration: 5 })]), 12.5);
});
