import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LruCache } from './lru';
import {
  basename,
  codecLabel,
  defaultDropFrame,
  dirname,
  evenDim,
  extOf,
  fitWithin,
  frameIndex,
  joinPath,
  mapLimit,
  posterTime,
  proxyBitrate,
  proxyDims,
  routeForPath,
  slotTime,
  snapFps,
  stem,
  thumbSlot,
  thumbnailStep,
  transferToInputTransform,
  wantsProxy,
} from './mediaMath';
import { applyPrefixMap, durationsAgree, inferPrefixMap, matchCandidates, matchScore } from './relinkMatch';
import { assetUsage, clipCountByAsset, removeClipsOfAssets, usedAssetIds } from './usage';
import type { Project } from '../../state/types';

// ---------------------------------------------------------------------------
// paths & routing
// ---------------------------------------------------------------------------

test('path helpers work for POSIX and Windows paths', () => {
  assert.equal(basename('/a/b/Clip 01.MOV'), 'Clip 01.MOV');
  assert.equal(basename('C:\\Footage\\A001.mp4'), 'A001.mp4');
  assert.equal(stem('/a/b/clip.v2.mp4'), 'clip.v2');
  assert.equal(stem('/a/b/.hidden'), '.hidden');
  assert.equal(extOf('/a/B.CUBE'), 'cube');
  assert.equal(extOf('/a/noext'), '');
  assert.equal(dirname('/a/b/c.mp4'), '/a/b');
  assert.equal(dirname('C:\\x\\y.wav'), 'C:\\x');
  assert.equal(joinPath('/proj/', 'Proxies', 'a.proxy.mp4'), '/proj/Proxies/a.proxy.mp4');
  assert.equal(joinPath('C:\\proj', 'Proxies', 'a.mp4'), 'C:\\proj\\Proxies\\a.mp4');
});

test('import routing by extension', () => {
  assert.equal(routeForPath('/x/a.mp4'), 'media');
  assert.equal(routeForPath('/x/a.WAV'), 'media');
  assert.equal(routeForPath('/x/look.cube'), 'lut');
  assert.equal(routeForPath('/x/subs.srt'), 'caption');
  assert.equal(routeForPath('/x/subs.vtt'), 'caption');
  assert.equal(routeForPath('/x/notes.txt'), 'unsupported');
  assert.equal(routeForPath('/x/folder'), 'unsupported');
});

// ---------------------------------------------------------------------------
// rates, color, sizes
// ---------------------------------------------------------------------------

test('fps snapping to broadcast and cinema rates', () => {
  assert.equal(snapFps(23.976023), 23.976);
  assert.equal(snapFps(24000 / 1001), 23.976);
  assert.equal(snapFps(29.97002997), 29.97);
  assert.equal(snapFps(59.94005994), 59.94);
  assert.equal(snapFps(25.0), 25);
  assert.equal(snapFps(29.85), 29.97); // VFR phone footage near 29.97
  assert.equal(snapFps(12.5), 12.5);
  assert.equal(snapFps(0), 0);
  assert.equal(snapFps(NaN), 0);
});

test('drop frame default only for 29.97 and 59.94', () => {
  assert.equal(defaultDropFrame(29.97), true);
  assert.equal(defaultDropFrame(59.94), true);
  assert.equal(defaultDropFrame(23.976), false);
  assert.equal(defaultDropFrame(30), false);
});

test('HDR transfers map to input transforms', () => {
  assert.equal(transferToInputTransform('pq'), 'pq');
  assert.equal(transferToInputTransform('hlg'), 'hlg');
  assert.equal(transferToInputTransform('bt709'), 'auto');
  assert.equal(transferToInputTransform(null), 'auto');
});

test('fitWithin keeps aspect, never upscales, can force even sizes', () => {
  assert.deepEqual(fitWithin(3840, 2160, 1280), { width: 1280, height: 720 });
  assert.deepEqual(fitWithin(1920, 1080, 4000, 4000), { width: 1920, height: 1080 });
  assert.deepEqual(fitWithin(1080, 1920, undefined, 960), { width: 540, height: 960 });
  assert.deepEqual(fitWithin(4096, 2160, 1280, undefined, true), { width: 1280, height: 676 });
});

test('proxy size: long side 1280 (or 960), even dimensions, vertical-aware', () => {
  assert.deepEqual(proxyDims(3840, 2160), { width: 1280, height: 720 });
  assert.deepEqual(proxyDims(4096, 2160), { width: 1280, height: 676 });
  assert.deepEqual(proxyDims(2160, 3840), { width: 720, height: 1280 });
  assert.deepEqual(proxyDims(3840, 2160, 960), { width: 960, height: 540 });
  const br = proxyBitrate(1280, 720, 59.94);
  assert.ok(br >= 1_500_000 && br <= 8_000_000);
  assert.ok(proxyBitrate(1280, 720, 59.94) > proxyBitrate(1280, 720, 23.976));
  assert.equal(evenDim(1349), 1350);
});

test('proxy suggestions: UHD and DCI 4K, vertical 4K, HFR QHD; not HD', () => {
  assert.equal(wantsProxy({ kind: 'video', width: 3840, height: 2160, fps: 25 }), true);
  assert.equal(wantsProxy({ kind: 'video', width: 4096, height: 2160, fps: 23.976 }), true);
  assert.equal(wantsProxy({ kind: 'video', width: 2160, height: 3840, fps: 30 }), true);
  assert.equal(wantsProxy({ kind: 'video', width: 2560, height: 1440, fps: 59.94 }), true);
  assert.equal(wantsProxy({ kind: 'video', width: 1920, height: 1080, fps: 59.94 }), false);
  assert.equal(wantsProxy({ kind: 'image', width: 6000, height: 4000 }), false);
});

// ---------------------------------------------------------------------------
// thumbnails & frames
// ---------------------------------------------------------------------------

test('thumbnail step: at least one frame, at most 2 s, ~240 per asset', () => {
  const short = thumbnailStep({ duration: 6, fps: 30 });
  assert.ok(Math.abs(short - 1 / 30) < 1e-9);
  const mid = thumbnailStep({ duration: 120, fps: 25 });
  assert.ok(Math.abs(mid - 0.52) < 1e-9, String(mid)); // 0.5 s rounded up to whole frames
  assert.equal(thumbnailStep({ duration: 3600, fps: 24 }), 2);
  // step is a whole number of frames
  const s = thumbnailStep({ duration: 100, fps: 23.976 });
  assert.ok(Math.abs(s * 23.976 - Math.round(s * 23.976)) < 1e-6);
});

test('thumbnail slots quantize and stay inside the clip', () => {
  assert.equal(thumbSlot(0, 0.5), 0);
  assert.equal(thumbSlot(0.49, 0.5), 0);
  assert.equal(thumbSlot(0.5, 0.5), 1);
  assert.equal(thumbSlot(-3, 0.5), 0);
  assert.ok(slotTime(10, 0.5, 4) < 4);
  assert.ok(slotTime(2, 0.5, 4) >= 1);
});

test('frame index for cache keys', () => {
  assert.equal(frameIndex(0, 24), 0);
  assert.equal(frameIndex(1, 24), 24);
  assert.equal(frameIndex(1001 / 24000, 23.976), 1);
  assert.equal(frameIndex(1001 / 24000 - 1e-9, 23.976), 1); // float noise lands on the same frame
  assert.equal(frameIndex(0.0415, 24), 0);
  assert.equal(frameIndex(1.2345, undefined), 1235);
});

test('poster time: mark in, else 10% (max 1 s); stills use 0', () => {
  assert.equal(posterTime({ kind: 'video', duration: 4, markIn: null }), 0.4);
  assert.equal(posterTime({ kind: 'video', duration: 60 }), 1);
  assert.equal(posterTime({ kind: 'video', duration: 60, markIn: 12 }), 12);
  assert.equal(posterTime({ kind: 'image', duration: 5 }), 0);
});

test('codec labels', () => {
  assert.equal(codecLabel('avc'), 'H.264');
  assert.equal(codecLabel('pcm-s24'), 'PCM 24-bit');
  assert.equal(codecLabel('pcm-f32'), 'PCM 32-bit float');
  assert.equal(codecLabel(undefined), '');
});

test('mapLimit preserves order and honours the limit', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 3, 2, 4], 2, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, n));
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 30, 20, 40]);
  assert.equal(peak, 2);
});

// ---------------------------------------------------------------------------
// LRU
// ---------------------------------------------------------------------------

test('LRU evicts least recently used entries over the byte budget', () => {
  const evicted: string[] = [];
  const c = new LruCache<string, number>(100, (k) => evicted.push(k));
  c.set('a', 1, 40);
  c.set('b', 2, 40);
  assert.equal(c.get('a'), 1); // a is now most recent
  c.set('c', 3, 40); // over budget → evict b
  assert.deepEqual(evicted, ['b']);
  assert.equal(c.has('a'), true);
  assert.equal(c.has('b'), false);
  assert.equal(c.bytes, 80);
  c.set('a', 9, 10); // replace updates bytes
  assert.equal(c.bytes, 50);
  assert.equal(c.peek('a'), 9);
  assert.equal(c.deleteWhere((k) => k === 'c'), 1);
  assert.equal(c.size, 1);
  // a single oversized entry is kept
  c.set('huge', 0, 1000);
  assert.equal(c.has('huge'), true);
  assert.equal(c.size, 1);
});

// ---------------------------------------------------------------------------
// relink matching
// ---------------------------------------------------------------------------

test('durations agree within half a percent or 0.25 s', () => {
  assert.equal(durationsAgree(10, 10.2), true);
  assert.equal(durationsAgree(10, 11), false);
  assert.equal(durationsAgree(3600, 3610), true);
  assert.equal(durationsAgree(undefined, 5), true);
});

test('relink matches by file name, then duration, then folder name', () => {
  const offline = [
    { id: 'a', path: '/old/Day1/A001.mov', duration: 12 },
    { id: 'b', path: '/old/Day2/A001.mov', duration: 30 },
    { id: 'c', path: '/old/Audio/boom.wav', duration: 60 },
  ];
  const cands = [
    { path: '/new/Day2/A001.mov', duration: 30 },
    { path: '/new/Day1/A001.mov', duration: 12 },
    { path: '/new/Audio/BOOM.WAV', duration: 60.1 },
    { path: '/new/other.mov', duration: 12 },
  ];
  const m = matchCandidates(offline, cands);
  assert.equal(m.get('a'), '/new/Day1/A001.mov');
  assert.equal(m.get('b'), '/new/Day2/A001.mov');
  assert.equal(m.get('c'), '/new/Audio/BOOM.WAV');
});

test('relink rejects a same-named file with a different duration', () => {
  assert.equal(matchScore({ id: 'a', path: '/x/a.mp4', duration: 10 }, { path: '/y/a.mp4', duration: 25 }), -1);
  const m = matchCandidates([{ id: 'a', path: '/x/a.mp4', duration: 10 }], [{ path: '/y/a.mp4', duration: 25 }]);
  assert.equal(m.size, 0);
});

test('relink accepts a different extension only when durations are known and agree', () => {
  assert.ok(matchScore({ id: 'a', path: '/x/clip.mov', duration: 8 }, { path: '/y/clip.mp4', duration: 8 }) > 0);
  assert.equal(matchScore({ id: 'a', path: '/x/clip.mov', duration: 8 }, { path: '/y/clip.mp4' }), -1);
  // exact names beat stem matches
  const m = matchCandidates([{ id: 'a', path: '/x/clip.mov', duration: 8 }], [{ path: '/y/clip.mp4', duration: 8 }, { path: '/z/clip.mov', duration: 8 }]);
  assert.equal(m.get('a'), '/z/clip.mov');
});

test('relink infers folder moves and applies them to siblings', () => {
  const map = inferPrefixMap('/Volumes/A/Proj/Footage/Day1/c1.mp4', '/Users/me/Proj/Footage/Day1/c1.mp4');
  assert.deepEqual(map, { from: '/Volumes/A', to: '/Users/me' });
  assert.equal(applyPrefixMap('/Volumes/A/Proj/Audio/x.wav', map!), '/Users/me/Proj/Audio/x.wav');
  assert.equal(applyPrefixMap('/Volumes/B/y.wav', map!), null);
  // renamed leaf folder: only siblings in the same folder follow
  const m2 = inferPrefixMap('/a/Day1/c1.mp4', '/b/Shoot/c1.mp4');
  assert.deepEqual(m2, { from: '/a/Day1', to: '/b/Shoot' });
  assert.equal(applyPrefixMap('/a/Day1/c2.mp4', m2!), '/b/Shoot/c2.mp4');
  assert.equal(applyPrefixMap('/a/Day2/c3.mp4', m2!), null);
  // nothing in common
  assert.equal(inferPrefixMap('/a/x.mp4', '/b/y.mp4'), null);
  // Windows paths
  const w = inferPrefixMap('D:\\Proj\\A.mov', 'E:\\Backup\\Proj\\A.mov');
  assert.deepEqual(w, { from: 'D:', to: 'E:\\Backup' });
  assert.equal(applyPrefixMap('D:\\Proj\\B.mov', w!), 'E:\\Backup\\Proj\\B.mov');
});

// ---------------------------------------------------------------------------
// usage
// ---------------------------------------------------------------------------

function project(): Pick<Project, 'sequences'> {
  const clip = (id: string, assetId?: string) => ({ id, assetId }) as never;
  return {
    sequences: [
      { id: 's1', name: 'Main', tracks: [{ clips: [clip('c1', 'a'), clip('c2', 'b'), clip('c3')] }, { clips: [clip('c4', 'a')] }] },
      { id: 's2', name: 'Alt', tracks: [{ clips: [clip('c5', 'a')] }] },
    ],
  } as never;
}

test('asset usage across sequences', () => {
  const p = project();
  assert.deepEqual(assetUsage(p, 'a'), [
    { sequenceId: 's1', sequenceName: 'Main', clipIds: ['c1', 'c4'] },
    { sequenceId: 's2', sequenceName: 'Alt', clipIds: ['c5'] },
  ]);
  assert.deepEqual(assetUsage(p, 'zzz'), []);
  assert.deepEqual([...usedAssetIds(p)].sort(), ['a', 'b']);
  assert.equal(clipCountByAsset(p).get('a'), 3);
  assert.equal(removeClipsOfAssets(p, new Set(['a'])), 3);
  assert.deepEqual([...usedAssetIds(p)], ['b']);
});
