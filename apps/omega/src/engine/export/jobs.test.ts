import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAsset, makeClip, makeMarker, makeSequence, makeTrack } from '../../state/defaults';
import type { Project, Sequence } from '../../state/types';
import { buildJobs, draftFromPreset, effectiveRangeSpec, MAIN_FORMAT } from './jobs';
import { findPreset } from './presets';
import { rangeUsage, shiftedSequence } from './usage';

function project(): { project: Project; seq: Sequence } {
  const seq = makeSequence({ width: 1920, height: 1080, fps: 25, dropFrame: false, sampleRate: 48000, colorSpace: 'rec709' }, 'Main Edit');
  const a = makeAsset({ name: 'a.mp4', path: '/m/a.mp4', kind: 'video', duration: 20, hasAudio: true, hasVideo: true });
  const b = makeAsset({ name: 'b.mp4', path: '/m/b.mp4', kind: 'video', duration: 20, hasAudio: true, hasVideo: true, offline: true });
  const v1 = seq.tracks.find((t) => t.name === 'V1')!;
  const a1 = seq.tracks.find((t) => t.name === 'A1')!;
  v1.clips.push(makeClip('media', { start: 0, duration: 4, assetId: a.id, name: 'A' }));
  v1.clips.push(makeClip('media', { start: 4, duration: 4, assetId: b.id, name: 'B' }));
  a1.clips.push(makeClip('media', { start: 0, duration: 4, assetId: a.id, name: 'A audio' }));
  seq.formats.push({ id: 'fmt_v', name: 'Vertical 9:16', width: 1080, height: 1920 });
  const caps = makeTrack('caption', 'English');
  caps.cues.push({ id: 'c1', start: 1, end: 2, text: 'Hello' }, { id: 'c2', start: 5, end: 6, text: 'World' });
  seq.tracks.push(caps);
  seq.markers.push(makeMarker(0, { kind: 'chapter', label: 'Intro' }), makeMarker(5, { kind: 'chapter', label: 'Part 2' }));
  const p = { formatVersion: 'x', id: 'p1', name: 'Trailer', app: 'video', createdAt: 0, modifiedAt: 0, settings: {} as Project['settings'], assets: [a, b], bins: [], luts: [], sequences: [seq], activeSequenceId: seq.id } as unknown as Project;
  return { project: p, seq };
}

const now = new Date(2026, 9, 2);

test('one job per selected format, alternates suffixed by format name', () => {
  const { project: p, seq } = project();
  const draft = draftFromPreset(findPreset('yt-1080')!, { destination: '/out', formats: [MAIN_FORMAT, 'fmt_v'] });
  const jobs = buildJobs(draft, p, seq, { playhead: 0, now });
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].outputPath, '/out/Main Edit - YouTube 1080p_16x9.mp4');
  assert.equal(jobs[0].formatId, null);
  assert.equal(jobs[1].outputPath, '/out/Main Edit - YouTube 1080p_Vertical 9x16.mp4');
  assert.equal(jobs[1].formatId, 'fmt_v');
  assert.deepEqual(jobs[0].range, { start: 0, end: 8 });
  // single format: no suffix
  const one = buildJobs({ ...draft, formats: [MAIN_FORMAT] }, p, seq, { playhead: 0, now });
  assert.equal(one[0].outputPath, '/out/Main Edit - YouTube 1080p.mp4');
});

test('stills export the frame at the playhead; handoff ignores formats', () => {
  const { project: p, seq } = project();
  const still = draftFromPreset(findPreset('png-still')!, { destination: '/out' });
  assert.deepEqual(effectiveRangeSpec(still, 3.3), { mode: 'frame', time: 0 });
  const s = buildJobs({ ...still, range: { mode: 'entire' } }, p, seq, { playhead: 3.3, now });
  assert.equal(s.length, 1);
  assert.ok(Math.abs(s[0].range.start - 3.28) < 1e-9);
  assert.ok(s[0].outputPath.endsWith('.png'));
  const edl = draftFromPreset(findPreset('handoff-edl')!, { destination: '/out', formats: [MAIN_FORMAT, 'fmt_v'] });
  const e = buildJobs(edl, p, seq, { playhead: 0, now });
  assert.equal(e.length, 1);
  assert.equal(e[0].outputPath, '/out/Main Edit - EDL (CMX 3600).edl');
  const ch = buildJobs(draftFromPreset(findPreset('handoff-chapters')!, { destination: '/out' }), p, seq, { playhead: 0, now });
  assert.ok(ch[0].outputPath.endsWith('.txt'));
});

test('image sequences render into a folder', () => {
  const { project: p, seq } = project();
  const jobs = buildJobs(draftFromPreset(findPreset('png-sequence')!, { destination: '/out', nameTemplate: '{sequence}_{date}' }), p, seq, { playhead: 0, now });
  assert.equal(jobs[0].outputPath, '/out/Main Edit_2026-10-02');
});

test('range usage finds offline media, audio, captions and chapters', () => {
  const { project: p, seq } = project();
  const all = rangeUsage(p, seq.id, { start: 0, end: 8 });
  assert.equal(all.videoAssets.length, 2);
  assert.equal(all.offline.length, 1);
  assert.equal(all.offline[0].name, 'b.mp4');
  assert.equal(all.hasAudio, true);
  assert.equal(all.captionCues, 2);
  assert.equal(all.chapterMarkers, 2);
  const first = rangeUsage(p, seq.id, { start: 0, end: 4 });
  assert.equal(first.offline.length, 0);
  assert.equal(first.captionCues, 1);
  const late = rangeUsage(p, seq.id, { start: 4.5, end: 8 });
  assert.equal(late.hasAudio, false);
});

test('sidecar sequences are shifted to the range start', () => {
  const { seq } = project();
  const s = shiftedSequence(seq, { start: 4.5, end: 8 });
  const cues = s.tracks.find((t) => t.kind === 'caption')!.cues;
  assert.deepEqual(cues.map((c) => [c.start, c.end]), [[0.5, 1.5]]);
  assert.deepEqual(s.markers.map((m) => m.time), [0.5]);
});
