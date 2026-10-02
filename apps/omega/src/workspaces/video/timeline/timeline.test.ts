// Pure-logic tests for the timeline: ruler ticks, snapping, track layout,
// virtualized clip lookups, readouts and sequence re-snapping.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exactRate, fromFrames, toFrames } from '../../../engine/time';
import { makeClip, makeSequence, makeTrack } from '../../../state/defaults';
import type { Sequence } from '../../../state/types';
import { clipAtTime, clipsInRange, cuesInRange, editTimes, layoutTracks, nearestRow, rowAtY, GROUP_GAP } from './geometry';
import { formatFor, resnapSequence } from './seqformat';
import { makeSnapper, snapBlock, snapPointsFor } from './snap';
import { formatDelta, rulerTicks, stepCandidates } from './ticks';

const settings = { width: 1920, height: 1080, fps: 24, dropFrame: false, sampleRate: 48000 as const, colorSpace: 'rec709' as const };

function seqWith(clips: { track: number; start: number; duration: number }[]): Sequence {
  const s = makeSequence(settings);
  for (const c of clips) s.tracks[c.track].clips.push(makeClip('media', { start: c.start, duration: c.duration }));
  return s;
}

test('ruler shows single frames when zoomed in', () => {
  const r = rulerTicks(2400, 24, 0, 1);
  assert.ok(r.stepFrames < 24, `step ${r.stepFrames}`);
  assert.equal(r.frameCells, true);
  assert.equal(r.major[0].label, '00:00:00:00');
  // every major tick is on a whole frame
  for (const m of r.major) assert.equal(toFrames(m.t, 24), Math.round(m.t * 24));
});

test('ruler switches to seconds, then minutes, as zoom drops', () => {
  const mid = rulerTicks(80, 24, 0, 20);
  assert.ok(mid.stepFrames >= 24 && mid.stepFrames <= 24 * 5, `seconds step ${mid.stepFrames}`);
  const far = rulerTicks(0.5, 24, 0, 3600);
  assert.ok(far.stepFrames >= 24 * 60, `minutes step ${far.stepFrames}`);
  assert.ok(far.major.length >= 5 && far.major.length < 40);
  assert.ok(far.major.some((m) => m.label === '00:10:00:00'));
});

test('ruler ticks land on exact NTSC frames with drop-frame labels', () => {
  const r = rulerTicks(30, 29.97, 59, 61, { dropFrame: true });
  const rate = exactRate(29.97);
  for (const m of r.major) assert.ok(Math.abs(m.t * rate - Math.round(m.t * rate)) < 1e-6);
  assert.ok(r.major.some((m) => m.label.includes(';')), 'drop-frame separator');
});

test('step candidates are sorted and include frames and seconds', () => {
  const c = stepCandidates(24);
  assert.deepEqual(c.slice(0, 5), [1, 2, 5, 10, 12]);
  assert.ok(c.includes(24) && c.includes(24 * 60));
  for (let i = 1; i < c.length; i++) assert.ok(c[i] > c[i - 1]);
});

test('ruler never produces more than its cap of ticks', () => {
  const r = rulerTicks(4000, 60, 0, 3600);
  assert.ok(r.major.length + r.minor.length <= 4001);
});

test('snapper finds the nearest point within the threshold and prefers the playhead on ties', () => {
  const sn = makeSnapper([
    { t: 1, kind: 'edge' },
    { t: 2, kind: 'edge' },
    { t: 2, kind: 'playhead' },
    { t: 5, kind: 'marker' },
  ]);
  assert.equal(sn.nearest(1.04, 0.1)?.t, 1);
  assert.equal(sn.nearest(1.5, 0.1), null);
  assert.equal(sn.nearest(2.01, 0.1)?.kind, 'playhead');
  assert.equal(sn.nearest(4.95, 0.1)?.kind, 'marker');
});

test('snapBlock snaps whichever edge of a moved block is closer', () => {
  const sn = makeSnapper([{ t: 10, kind: 'edge' }]);
  // block 0..3 moved by 6.9 → end at 9.9 snaps to 10
  const r = snapBlock(sn, 0, 3, 6.9, 0.2);
  assert.equal(r.at, 10);
  assert.ok(Math.abs(r.delta - 7) < 1e-9);
  // start edge: block 0..3 moved by 9.95 → start 9.95 snaps to 10
  const r2 = snapBlock(sn, 0, 3, 9.95, 0.2);
  assert.ok(Math.abs(r2.delta - 10) < 1e-9);
  // nothing near
  assert.deepEqual(snapBlock(sn, 0, 3, 2, 0.2), { delta: 2, at: null });
});

test('snap points include edges, playhead, markers, in/out and keyframes, minus excluded clips', () => {
  const s = seqWith([
    { track: 2, start: 0, duration: 4 },
    { track: 2, start: 6, duration: 2 },
  ]);
  s.markers.push({ id: 'm', time: 3, duration: 1, label: '', note: '', color: 'teal', kind: 'marker' });
  s.inPoint = 1;
  s.outPoint = 7;
  const ex = s.tracks[2].clips[0];
  ex.keyframes['transform.opacity'] = [{ t: 1, v: 0, ease: 'linear' }];
  const all = snapPointsFor(s, { playhead: 2.5, keyframes: true }).map((p) => `${p.kind}@${p.t}`);
  for (const want of ['edge@4', 'edge@6', 'edge@8', 'playhead@2.5', 'marker@3', 'marker@4', 'inout@1', 'inout@7', 'keyframe@1']) assert.ok(all.includes(want), want);
  const some = snapPointsFor(s, { excludeClipIds: new Set([ex.id]) }).map((p) => `${p.kind}@${p.t}`);
  assert.ok(!some.includes('edge@4'));
});

test('layout stacks tracks with a gap between the video and audio groups', () => {
  const s = makeSequence(settings);
  const L = layoutTracks(s.tracks);
  assert.equal(L.rows.length, 6);
  const v1 = L.rows[2];
  const a1 = L.rows[3];
  assert.equal(a1.y, v1.y + v1.h + GROUP_GAP);
  assert.equal(L.dividerY, v1.y + v1.h);
  assert.equal(rowAtY(L, a1.y + 1)?.track.name, 'A1');
  assert.equal(rowAtY(L, v1.y + v1.h + 1), null, 'inside the divider');
  assert.equal(nearestRow(L, v1.y + v1.h + 1)?.track.name, 'V1');
  assert.equal(L.rows[3].kindIndex, 0);
  // cached by tracks array identity
  assert.equal(layoutTracks(s.tracks), L);
});

test('clip lookups are virtualized and handle unsorted and overlapping clips', () => {
  const t = makeTrack('video', 'V1');
  // 2000 clips, inserted in reverse order
  for (let i = 1999; i >= 0; i--) t.clips.push(makeClip('media', { start: i * 2, duration: 1.5 }));
  t.clips.push(makeClip('media', { start: 100, duration: 500 })); // a long one overlapping many
  const inView = clipsInRange(t, 1000, 1010);
  assert.ok(inView.length >= 5 && inView.length <= 7, `got ${inView.length}`);
  assert.ok(!inView.some((c) => c.start === 100), 'long clip ends at 600');
  const inLong = clipsInRange(t, 300, 304);
  assert.ok(inLong.some((c) => c.duration === 500));
  assert.equal(clipAtTime(t, 1001.2)?.start, 1000);
  assert.equal(clipAtTime(t, 1001.7), undefined);
  for (let i = 1; i < inView.length; i++) assert.ok(inView[i].start >= inView[i - 1].start);
});

test('caption cue range lookup', () => {
  const t = makeTrack('caption', 'C1');
  for (let i = 0; i < 100; i++) t.cues.push({ id: `q${i}`, start: i * 3, end: i * 3 + 2, text: `${i}` });
  const got = cuesInRange(t, 30.5, 36.5).map((q) => q.id);
  assert.deepEqual(got, ['q10', 'q11', 'q12']);
});

test('edit times only include the filtered tracks', () => {
  const s = seqWith([
    { track: 2, start: 1, duration: 2 },
    { track: 0, start: 10, duration: 2 },
  ]);
  s.tracks[0].targeted = false;
  assert.deepEqual(editTimes(s, (t) => t.targeted), [0, 1, 3]);
  assert.deepEqual(editTimes(s, () => true), [0, 1, 3, 10, 12]);
});

test('delta readouts are frames below a second, timecode above', () => {
  assert.equal(formatDelta(fromFrames(12, 24), 24), '+12f');
  assert.equal(formatDelta(-fromFrames(3, 24), 24), '-3f');
  assert.equal(formatDelta(fromFrames(24 * 61 + 5, 24), 24), '+1:01:05');
  assert.equal(formatDelta(fromFrames(24 * 3 + 2, 24), 24), '+3:02');
});

test('multi-aspect formats keep the master short side', () => {
  assert.deepEqual(
    (({ width, height }) => ({ width, height }))(formatFor({ width: 1920, height: 1080 }, { name: 'V', w: 9, h: 16 })),
    { width: 1080, height: 1920 },
  );
  const sq = formatFor({ width: 3840, height: 2160 }, { name: 'S', w: 1, h: 1 });
  assert.equal(sq.width, 2160);
  assert.equal(sq.height, 2160);
  const p = formatFor({ width: 1920, height: 1080 }, { name: 'P', w: 4, h: 5 });
  assert.equal(p.width, 1080);
  assert.equal(p.height, 1350);
});

test('changing fps re-snaps clips, markers and keyframes to the new grid', () => {
  const s = seqWith([{ track: 2, start: 1.01, duration: 2.003 }]);
  const c = s.tracks[2].clips[0];
  c.keyframes['transform.opacity'] = [{ t: 0.51, v: 1, ease: 'linear' }];
  s.markers.push({ id: 'm', time: 0.333, duration: 0, label: '', note: '', color: 'teal', kind: 'marker' });
  resnapSequence(s, 29.97);
  const rate = exactRate(29.97);
  const onGrid = (t: number) => Math.abs(t * rate - Math.round(t * rate)) < 1e-6;
  assert.ok(onGrid(c.start) && onGrid(c.start + c.duration), 'clip edges');
  assert.ok(onGrid(c.keyframes['transform.opacity'][0].t), 'keyframe');
  assert.ok(onGrid(s.markers[0].time), 'marker');
  assert.ok(c.duration > 0);
});
