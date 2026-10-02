import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Clip, MediaAsset, Project, Sequence } from '../../state/types';
import { FORMAT_VERSION } from '../../state/types';
import { makeAsset, makeClip, makeMarker, makeSequence, makeTrack, makeTransition } from '../../state/defaults';
import { exactRate, fromFrames, toFrames } from '../time';
import { exportChapters, exportChaptersDetailed, exportEdl, exportFcpxml, exportFcpxmlDetailed, exportOtio, fileUrl, frameRational, importOtio, pathFromUrl, rationalTime } from './index';
import { buildOtio } from './otio';
import { child, findAll, parseXml, type XmlNode } from './xml';
import { parseRationalTime } from './common';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function project(seqs: Sequence[], assets: MediaAsset[]): Project {
  return {
    formatVersion: FORMAT_VERSION,
    id: 'p1',
    name: 'Fixture',
    app: 'video',
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, fps: 23.976, dropFrame: false, sampleRate: 48000, colorSpace: 'rec709', matchFirstClip: false, stillDuration: 5, defaultTransitionDuration: 1 },
    assets,
    bins: [],
    luts: [],
    sequences: seqs,
    activeSequenceId: seqs[0].id,
  };
}

const camA = makeAsset({ name: 'A001C003_220101.mov', path: '/media/A001C003_220101.mov', kind: 'video', duration: 700, hasAudio: true, hasVideo: true, width: 1920, height: 1080, fps: 23.976, channels: 2, sampleRate: 48000 });
const broll = makeAsset({ name: 'B-roll shot.mp4', path: '/media/B-roll shot.mp4', kind: 'video', duration: 30, hasAudio: false, hasVideo: true, width: 3840, height: 2160, fps: 23.976 });
const music = makeAsset({ name: 'score.wav', path: '/media/audio/score.wav', kind: 'audio', duration: 120, hasAudio: true, hasVideo: false, channels: 2, sampleRate: 48000 });

/** 23.976 fixture: A (V1) dissolves into B (V1); C at 2x speed on V2 over a V1 gap; A's audio on A1+A2. */
function fixture2398(): { project: Project; seq: Sequence } {
  const fps = 23.976;
  const F = (n: number) => fromFrames(n, fps);
  const seq = makeSequence({ width: 1920, height: 1080, fps, dropFrame: false, sampleRate: 48000, colorSpace: 'rec709' }, 'Golden 23976');
  seq.startTimecode = F(86400); // 01:00:00:00
  const [v3, v2, v1, a1, a2] = seq.tracks;
  void v3;
  v1.clips.push(makeClip('media', { name: 'A001C003_220101.mov', assetId: camA.id, start: 0, duration: F(120), inPoint: F(24), linkId: 'L1' }));
  v1.clips.push(makeClip('media', { name: 'B-roll shot.mp4', assetId: broll.id, start: F(120), duration: F(96), inPoint: F(48), transitionIn: makeTransition('crossDissolve', F(24)) }));
  v2.clips.push(makeClip('media', { name: 'B-roll shot.mp4', assetId: broll.id, start: F(240), duration: F(48), inPoint: 0, speed: 2 }));
  // A text overlay on V3 must not cut the picture in the EDL.
  seq.tracks[0].clips.push(makeClip('text', { name: 'Lower third', start: F(10), duration: F(50) }));
  a1.clips.push(makeClip('media', { name: 'A001C003_220101.mov', assetId: camA.id, start: 0, duration: F(120), inPoint: F(24), linkId: 'L1' }));
  a2.clips.push(makeClip('media', { name: 'A001C003_220101.mov', assetId: camA.id, start: 0, duration: F(120), inPoint: F(24) }));
  seq.markers.push(makeMarker(F(48), { label: 'Check focus', color: 'red', note: 'soft?' }));
  seq.markers.push(makeMarker(0, { label: 'Opening', kind: 'chapter' }));
  seq.markers.push(makeMarker(F(130), { label: 'Fix audio', kind: 'todo', done: false }));
  return { project: project([seq], [camA, broll, music]), seq };
}

/** 29.97 DF fixture crossing the minute boundary, with a fade to black at the end. */
function fixture2997(): { project: Project; seq: Sequence } {
  const fps = 29.97;
  const F = (n: number) => fromFrames(n, fps);
  const seq = makeSequence({ width: 1920, height: 1080, fps, dropFrame: true, sampleRate: 48000, colorSpace: 'rec709' }, 'Golden 2997');
  const v1 = seq.tracks[2];
  v1.clips.push(makeClip('media', { name: 'X', assetId: camA.id, start: 0, duration: F(1800), inPoint: 0 }));
  v1.clips.push(makeClip('media', { name: 'Y', assetId: camA.id, start: F(1800), duration: F(300), inPoint: F(17982), transitionOut: makeTransition('dipToBlack', F(30)) }));
  return { project: project([seq], [camA]), seq };
}

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

test('rational frame durations and times', () => {
  assert.deepEqual(frameRational(23.976), { num: 1001, den: 24000 });
  assert.deepEqual(frameRational(29.97), { num: 1001, den: 30000 });
  assert.deepEqual(frameRational(59.94), { num: 1001, den: 60000 });
  assert.deepEqual(frameRational(24), { num: 100, den: 2400 });
  assert.deepEqual(frameRational(25), { num: 100, den: 2500 });
  assert.equal(rationalTime(0, 23.976), '0s');
  assert.equal(rationalTime(1, 23.976), '1001/24000s');
  assert.equal(rationalTime(24, 23.976), '1001/1000s');
  assert.equal(rationalTime(48, 24), '2s');
  assert.equal(rationalTime(86400, 23.976), '18018/5s');
  assert.equal(parseRationalTime('1001/24000s'), 1001 / 24000);
  assert.equal(parseRationalTime('5s'), 5);
});

test('file URLs', () => {
  assert.equal(fileUrl('/media/B-roll shot.mp4'), 'file:///media/B-roll%20shot.mp4');
  assert.equal(fileUrl('C:\\Users\\Ann\\Clip #1.mov'), 'file:///C:/Users/Ann/Clip%20%231.mov');
  assert.equal(pathFromUrl('file:///media/B-roll%20shot.mp4'), '/media/B-roll shot.mp4');
  assert.equal(pathFromUrl('file:///C:/Users/Ann/Clip%20%231.mov'), 'C:/Users/Ann/Clip #1.mov');
  assert.equal(pathFromUrl('file://localhost/media/a.mov'), '/media/a.mov');
  assert.equal(pathFromUrl('file://server/share/a%20b.mov'), '\\\\server\\share\\a b.mov');
  assert.equal(pathFromUrl('/plain/path.mov'), '/plain/path.mov');
});

// ---------------------------------------------------------------------------
// EDL
// ---------------------------------------------------------------------------

test('EDL golden: 23.976 NDF with dissolve, AA audio, M2 speed, overlay ignored', () => {
  const { project, seq } = fixture2398();
  const expected = [
    'TITLE: Golden 23976',
    'FCM: NON-DROP FRAME',
    '',
    '001  A001C003 V     C        00:00:01:00 00:00:05:12 01:00:00:00 01:00:04:12',
    '* FROM CLIP NAME: A001C003_220101.mov',
    '* SOURCE FILE: /media/A001C003_220101.mov',
    '',
    '002  A001C003 AA    C        00:00:01:00 00:00:06:00 01:00:00:00 01:00:05:00',
    '* FROM CLIP NAME: A001C003_220101.mov',
    '* SOURCE FILE: /media/A001C003_220101.mov',
    '',
    '003  A001C003 V     C        00:00:05:12 00:00:05:12 01:00:04:12 01:00:04:12',
    '003  B_ROLL_S V     D    024 00:00:01:12 00:00:06:00 01:00:04:12 01:00:09:00',
    '* FROM CLIP NAME: A001C003_220101.mov',
    '* TO CLIP NAME: B-roll shot.mp4',
    '* SOURCE FILE: /media/B-roll shot.mp4',
    '',
    '004  B_ROLL_S V     C        00:00:00:00 00:00:04:00 01:00:10:00 01:00:12:00',
    'M2   B_ROLL_S  048.0                00:00:00:00',
    '* FROM CLIP NAME: B-roll shot.mp4',
    '* SOURCE FILE: /media/B-roll shot.mp4',
    '',
  ].join('\n');
  assert.equal(exportEdl(project, seq), expected);
});

test('EDL golden: 29.97 drop frame with fade to black', () => {
  const { project, seq } = fixture2997();
  const expected = [
    'TITLE: Golden 2997',
    'FCM: DROP FRAME',
    '',
    '001  A001C003 V     C        00:00:00;00 00:01:00;02 00:00:00;00 00:01:00;02',
    '* FROM CLIP NAME: X',
    '* SOURCE FILE: /media/A001C003_220101.mov',
    '',
    '002  A001C003 V     C        00:10:00;00 00:10:09;15 00:01:00;02 00:01:09;17',
    '* FROM CLIP NAME: Y',
    '* SOURCE FILE: /media/A001C003_220101.mov',
    '',
    '003  A001C003 V     C        00:10:09;15 00:10:09;15 00:01:09;17 00:01:09;17',
    '003  BL       V     D    030 00:00:00;00 00:00:01;00 00:01:09;17 00:01:10;17',
    '* EFFECT NAME: DIP TO BLACK',
    '* FROM CLIP NAME: Y',
    '* SOURCE FILE: /media/A001C003_220101.mov',
    '',
  ].join('\n');
  assert.equal(exportEdl(project, seq), expected);
});

test('EDL: event lines follow the CMX 3600 column layout', () => {
  const { project, seq } = fixture2398();
  const edl = exportEdl(project, seq, { eol: '\r\n' });
  assert.ok(edl.includes('\r\n'));
  const events = edl.split('\r\n').filter((l) => /^\d{3}  /.test(l));
  assert.ok(events.length >= 4);
  for (const l of events) {
    assert.match(l, /^\d{3} {2}[A-Z0-9_]{1,8} *[ ](V|A|A2|AA|NONE) *[ ](C|D) +(\d{3})? (\d\d:\d\d:\d\d[:;]\d\d ){3}\d\d:\d\d:\d\d[:;]\d\d$/);
    assert.equal(l.indexOf(' ', 5) <= 13, true);
    // record TC starts at a fixed column
    assert.equal(l.slice(29, 40).length, 11);
    assert.match(l.slice(29, 40), /^\d\d:\d\d:\d\d[:;]\d\d$/);
  }
});

test('EDL: reel names are sanitized and unique; nested sequences are flattened', () => {
  const fps = 25;
  const F = (n: number) => fromFrames(n, fps);
  const a = makeAsset({ name: 'interview take 1.mov', path: '/m/interview take 1.mov', kind: 'video', duration: 100, hasAudio: false, hasVideo: true });
  const b = makeAsset({ name: 'interview take 2.mov', path: '/m/interview take 2.mov', kind: 'video', duration: 100, hasAudio: false, hasVideo: true });
  const nested = makeSequence({ width: 1920, height: 1080, fps, dropFrame: false, sampleRate: 48000, colorSpace: 'rec709' }, 'Nest');
  nested.tracks[2].clips.push(makeClip('media', { name: 'b', assetId: b.id, start: 0, duration: F(50), inPoint: F(10) }));
  const seq = makeSequence({ width: 1920, height: 1080, fps, dropFrame: false, sampleRate: 48000, colorSpace: 'rec709' }, 'Main');
  seq.tracks[2].clips.push(makeClip('media', { name: 'a', assetId: a.id, start: 0, duration: F(25), inPoint: 0 }));
  seq.tracks[2].clips.push(makeClip('sequence', { name: 'Nest', sequenceId: nested.id, start: F(25), duration: F(25), inPoint: F(5) }));
  const edl = exportEdl(project([seq, nested], [a, b]), seq);
  const lines = edl.split('\n').filter((l) => /^\d{3}/.test(l));
  assert.equal(lines[0].slice(5, 13), 'INTERVIE');
  assert.equal(lines[1].slice(5, 13), 'INTERV_2');
  // nested clip b: nested time 5..30 → source 15..40 frames
  assert.ok(lines[1].includes('00:00:00:15 00:00:01:15 00:00:01:00 00:00:02:00'), lines[1]);
});

test('EDL: single-track export and reverse speed', () => {
  const { project, seq } = fixture2398();
  const v2 = seq.tracks[1];
  v2.clips[0].reverse = true;
  const edl = exportEdl(project, seq, { videoTrackId: v2.id, audio: false });
  const lines = edl.split('\n');
  assert.equal(lines.filter((l) => /^\d{3}/.test(l)).length, 1);
  assert.ok(lines.some((l) => l.startsWith('M2   B_ROLL_S -048.0')));
});

// ---------------------------------------------------------------------------
// OTIO
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;

function walk(o: J, visit: (o: J) => void) {
  if (!o || typeof o !== 'object') return;
  visit(o);
  for (const v of Object.values(o)) walk(v, visit);
}

test('OTIO: schema structure and rational times', () => {
  const { project, seq } = fixture2398();
  const text = exportOtio(project, seq);
  const doc: J = JSON.parse(text);
  assert.equal(doc.OTIO_SCHEMA, 'Timeline.1');
  assert.equal(doc.tracks.OTIO_SCHEMA, 'Stack.1');
  assert.deepEqual(doc.global_start_time, { OTIO_SCHEMA: 'RationalTime.1', rate: 24000 / 1001, value: 86400 });
  // integer values are written as doubles, like OTIO's own writer
  assert.match(text, /"value": 86400\.0/);
  assert.match(text, /"rate": 23\.976023976023978/);
  const kinds = doc.tracks.children.map((t: J) => `${t.OTIO_SCHEMA}:${t.kind}:${t.name}`);
  assert.deepEqual(kinds, ['Track.1:Video:V1', 'Track.1:Video:V2', 'Track.1:Video:V3', 'Track.1:Audio:A1', 'Track.1:Audio:A2', 'Track.1:Audio:A3']);
  // Every RationalTime has the sequence rate and an integer frame value.
  let count = 0;
  walk(doc, (o) => {
    if (o.OTIO_SCHEMA === 'RationalTime.1') {
      count++;
      assert.equal(o.rate, 24000 / 1001);
      assert.ok(Number.isInteger(o.value), JSON.stringify(o));
    }
  });
  assert.ok(count > 20);
  const v1 = doc.tracks.children[0];
  assert.deepEqual(
    v1.children.map((c: J) => c.OTIO_SCHEMA),
    ['Clip.2', 'Transition.1', 'Clip.2'],
  );
  const [a, tr, b] = v1.children;
  assert.equal(a.media_references.DEFAULT_MEDIA.OTIO_SCHEMA, 'ExternalReference.1');
  assert.equal(a.media_references.DEFAULT_MEDIA.target_url, 'file:///media/A001C003_220101.mov');
  assert.deepEqual(a.media_references.DEFAULT_MEDIA.available_range.duration.value, Math.round(700 * exactRate(23.976)));
  assert.equal(a.active_media_reference_key, 'DEFAULT_MEDIA');
  assert.equal(a.source_range.start_time.value, 24);
  assert.equal(a.source_range.duration.value, 120);
  assert.equal(tr.transition_type, 'SMPTE_Dissolve');
  assert.equal(tr.in_offset.value, 12);
  assert.equal(tr.out_offset.value, 12);
  assert.equal(b.source_range.start_time.value, 48);
  // V2: gap then a 2x clip with a LinearTimeWarp
  const v2 = doc.tracks.children[1];
  assert.deepEqual(
    v2.children.map((c: J) => c.OTIO_SCHEMA),
    ['Gap.1', 'Clip.2'],
  );
  assert.equal(v2.children[0].source_range.duration.value, 240);
  assert.equal(v2.children[1].effects[0].OTIO_SCHEMA, 'LinearTimeWarp.1');
  assert.equal(v2.children[1].effects[0].time_scalar, 2);
  // text clip → GeneratorReference, with Omega metadata
  const v3 = doc.tracks.children[2];
  assert.equal(v3.children[1].media_references.DEFAULT_MEDIA.OTIO_SCHEMA, 'GeneratorReference.1');
  assert.equal(v3.children[1].metadata.omega.kind, 'text');
  // markers on the top-level stack
  const markers = doc.tracks.markers;
  assert.equal(markers.length, 3);
  assert.equal(markers[0].OTIO_SCHEMA, 'Marker.2');
  assert.equal(markers[1].name, 'Check focus');
  assert.equal(markers[1].color, 'RED');
  assert.equal(markers[1].comment, 'soft?');
  assert.equal(markers[1].marked_range.start_time.value, 48);
  assert.equal(markers[0].metadata.omega.kind, 'chapter');
  // track lengths add up (transitions take no time)
  const len = (t: J) => t.children.filter((c: J) => c.OTIO_SCHEMA !== 'Transition.1').reduce((s: number, c: J) => s + c.source_range.duration.value, 0);
  assert.equal(len(v1), 216);
  assert.equal(len(v2), 288);
});

test('OTIO: nested sequences become stacks; fade to nothing adds a gap', () => {
  const fps = 25;
  const F = (n: number) => fromFrames(n, fps);
  const nested = makeSequence({ width: 1920, height: 1080, fps, dropFrame: false, sampleRate: 48000, colorSpace: 'rec709' }, 'Nest');
  nested.tracks[2].clips.push(makeClip('media', { name: 'b', assetId: broll.id, start: 0, duration: F(50) }));
  const seq = makeSequence({ width: 1920, height: 1080, fps, dropFrame: false, sampleRate: 48000, colorSpace: 'rec709' }, 'Main');
  seq.tracks[2].clips.push(makeClip('sequence', { name: 'Nest', sequenceId: nested.id, start: 0, duration: F(25), inPoint: F(5), transitionOut: makeTransition('crossDissolve', F(10)) }));
  const doc: J = buildOtio(project([seq, nested], [broll]), seq);
  const v1 = doc.tracks.children[0];
  assert.deepEqual(
    v1.children.map((c: J) => c.OTIO_SCHEMA),
    ['Stack.1', 'Transition.1', 'Gap.1'],
  );
  const st = v1.children[0];
  assert.equal(st.source_range.start_time.value, 5);
  assert.equal(st.source_range.duration.value, 25);
  assert.equal(st.children[0].OTIO_SCHEMA, 'Track.1');
  assert.equal(st.children.every((t: J) => t.kind === 'Video'), true);
  assert.equal(v1.children[2].source_range.duration.value, 5);
});

test('OTIO round trip through importOtio', () => {
  const { project: p, seq } = fixture2398();
  seq.tracks.push({ ...makeTrack('caption', 'C1'), cues: [{ id: 'q1', start: 0.5, end: 2, text: 'Hello', speaker: 'ANNA' }] });
  seq.tracks[2].clips[0].grade.exposure = 0.5;
  seq.tracks[2].clips[0].effects.push({ id: 'fx1', type: 'gaussianBlur', enabled: true, params: { radius: 8 } });
  const r = importOtio(p, exportOtio(p, seq));
  assert.equal(r.assets.length, 0, 'existing assets are matched by path');
  const out = r.sequence;
  assert.equal(out.name, 'Golden 23976');
  assert.equal(out.fps, 23.976);
  assert.equal(toFrames(out.startTimecode, 23.976), 86400);
  const sig = (s: Sequence) =>
    s.tracks.map((t) => [
      t.kind,
      t.name,
      t.clips.map((c: Clip) => [c.kind, c.assetId ?? '', toFrames(c.start, 23.976), toFrames(c.duration, 23.976), toFrames(c.inPoint, 23.976), c.speed, c.reverse, c.transitionIn?.type ?? '', c.linkId ?? '']),
      t.cues.map((q) => [q.start, q.end, q.text, q.speaker]),
    ]);
  assert.deepEqual(sig(out), sig(seq));
  const a = out.tracks[2].clips[0];
  assert.equal(a.grade.exposure, 0.5);
  assert.equal(a.effects[0].type, 'gaussianBlur');
  assert.equal(out.tracks[2].clips[1].transitionIn!.duration, fromFrames(24, 23.976));
  assert.deepEqual(
    out.markers.map((m) => [m.label, m.kind, m.color, toFrames(m.time, 23.976)]),
    seq.markers.slice().sort((x, y) => x.time - y.time).map((m) => [m.label, m.kind, m.color, toFrames(m.time, 23.976)]),
  );
  assert.equal(out.tracks.find((t) => t.kind === 'caption')!.captionStyle!.size > 0, true);
});

test('importOtio: foreign OTIO creates assets and handles gaps and transitions', () => {
  const RT = (v: number) => ({ OTIO_SCHEMA: 'RationalTime.1', rate: 24, value: v });
  const TR = (s: number, d: number) => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: RT(s), duration: RT(d) });
  const clip = (name: string, url: string, s: number, d: number) => ({
    OTIO_SCHEMA: 'Clip.1',
    name,
    source_range: TR(s, d),
    media_reference: { OTIO_SCHEMA: 'ExternalReference.1', target_url: url, available_range: TR(0, 2400) },
  });
  const doc = {
    OTIO_SCHEMA: 'Timeline.1',
    name: 'From Resolve',
    global_start_time: RT(86400),
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      children: [
        {
          OTIO_SCHEMA: 'Track.1',
          kind: 'Video',
          name: 'Video 1',
          children: [
            { OTIO_SCHEMA: 'Gap.1', source_range: TR(0, 24) },
            clip('one', 'file:///shots/one.mov', 10, 48),
            { OTIO_SCHEMA: 'Transition.1', in_offset: RT(6), out_offset: RT(6), transition_type: 'SMPTE_Dissolve' },
            clip('two', 'file:///shots/two%20b.mov', 0, 24),
          ],
        },
        { OTIO_SCHEMA: 'Track.1', kind: 'Audio', name: 'Audio 1', children: [clip('mix', 'file:///shots/mix.wav', 0, 96)] },
      ],
      markers: [{ OTIO_SCHEMA: 'Marker.2', name: 'M', color: 'GREEN', marked_range: TR(12, 0) }],
    },
  };
  const r = importOtio(project([fixture2398().seq], [camA]), JSON.stringify(doc));
  assert.equal(r.sequence.fps, 24);
  assert.equal(r.assets.length, 3);
  assert.deepEqual(
    r.assets.map((a) => [a.path, a.kind, a.duration]),
    [
      ['/shots/one.mov', 'video', 100],
      ['/shots/two b.mov', 'video', 100],
      ['/shots/mix.wav', 'audio', 100],
    ],
  );
  const v = r.sequence.tracks.find((t) => t.kind === 'video')!;
  assert.deepEqual(
    v.clips.map((c) => [c.name, c.start, c.duration, c.inPoint]),
    [
      ['one', 1, 2, 10 / 24],
      ['two', 3, 1, 0],
    ],
  );
  assert.equal(v.clips[1].transitionIn!.duration, 0.5);
  assert.equal(r.sequence.markers[0].color, 'green');
  assert.equal(r.sequence.startTimecode, 3600);
  assert.throws(() => importOtio(project([fixture2398().seq], []), '{"nope": 1}'), /OpenTimelineIO/);
  assert.throws(() => importOtio(project([fixture2398().seq], []), 'not json'), /Not a valid OTIO/);
});

// ---------------------------------------------------------------------------
// FCPXML
// ---------------------------------------------------------------------------

const TIME_RE = /^(0|\d+(\/\d+)?)s$/;

function onFrame(attr: string, fps: number): boolean {
  const s = parseRationalTime(attr)!;
  const f = s * exactRate(fps);
  return Math.abs(f - Math.round(f)) < 1e-6;
}

test('FCPXML: well-formed, resources and rational times', () => {
  const { project: p, seq } = fixture2398();
  const { xml, warnings } = exportFcpxmlDetailed(p, seq);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>'));
  const root = parseXml(xml);
  assert.equal(root.name, 'fcpxml');
  assert.equal(root.attrs.version, '1.11');
  const res = child(root, 'resources')!;
  const fmt = res.children[0];
  assert.deepEqual(fmt.attrs, { id: 'r1', name: 'FFVideoFormat1080p2398', frameDuration: '1001/24000s', width: '1920', height: '1080', colorSpace: '1-1-1 (Rec. 709)' });
  const assets = findAll(root, 'asset');
  assert.equal(assets.length, 2);
  const cam = assets.find((a) => a.attrs.name === 'A001C003_220101.mov')!;
  assert.equal(cam.attrs.hasVideo, '1');
  assert.equal(cam.attrs.hasAudio, '1');
  assert.equal(cam.attrs.duration, rationalTime(toFrames(700, 23.976), 23.976));
  assert.equal(child(cam, 'media-rep')!.attrs.src, 'file:///media/A001C003_220101.mov');
  const effect = findAll(root, 'effect')[0];
  assert.equal(effect.attrs.uid, 'FxPlug:4731E73A-8DAC-4113-9A30-AE85B1761265');
  // every id referenced exists
  const ids = new Set(res.children.map((c) => c.attrs.id));
  for (const n of [...findAll(root, 'asset-clip'), ...findAll(root, 'filter-video')]) assert.ok(ids.has(n.attrs.ref), n.attrs.ref);
  for (const n of [...findAll(root, 'asset'), ...findAll(root, 'sequence')]) if (n.attrs.format) assert.ok(ids.has(n.attrs.format));
  // every time attribute is a rational on the 23.976 frame grid
  const all: XmlNode[] = [];
  const collect = (n: XmlNode) => {
    all.push(n);
    n.children.forEach(collect);
  };
  collect(root);
  for (const n of all) {
    for (const k of ['offset', 'start', 'duration', 'tcStart']) {
      const v = n.attrs[k];
      if (v === undefined || n.name === 'asset') continue;
      assert.match(v, TIME_RE, `${n.name}@${k}=${v}`);
      assert.ok(onFrame(v, 23.976), `${n.name}@${k}=${v} is off the frame grid`);
    }
  }
  assert.ok(warnings.some((w) => /Titles/.test(w)));
});

test('FCPXML: spine, lanes, transitions and markers', () => {
  const { project: p, seq } = fixture2398();
  const root = parseXml(exportFcpxml(p, seq));
  const sequence = findAll(root, 'sequence')[0];
  assert.equal(sequence.attrs.tcStart, '18018/5s');
  assert.equal(sequence.attrs.tcFormat, 'NDF');
  assert.equal(sequence.attrs.audioRate, '48k');
  const spine = child(sequence, 'spine')!;
  assert.deepEqual(
    spine.children.map((c) => c.name),
    ['asset-clip', 'transition', 'asset-clip', 'gap'],
  );
  const [a, tr, b, gap] = spine.children;
  const sec = (s: string) => parseRationalTime(s)!;
  const T0 = fromFrames(86400, 23.976);
  // spine items are contiguous from tcStart
  assert.ok(Math.abs(sec(a.attrs.offset) - T0) < 1e-9);
  assert.ok(Math.abs(sec(b.attrs.offset) - (sec(a.attrs.offset) + sec(a.attrs.duration))) < 1e-9);
  assert.ok(Math.abs(sec(gap.attrs.offset) - (sec(b.attrs.offset) + sec(b.attrs.duration))) < 1e-9);
  assert.ok(Math.abs(sec(sequence.attrs.duration) - fromFrames(288, 23.976)) < 1e-9);
  // centered transition
  assert.equal(tr.attrs.name, 'Cross Dissolve');
  assert.ok(Math.abs(sec(tr.attrs.offset) - (T0 + fromFrames(108, 23.976))) < 1e-9);
  assert.equal(tr.attrs.duration, rationalTime(24, 23.976));
  assert.equal(child(tr, 'filter-video')!.attrs.name, 'Cross Dissolve');
  // A: video only (its audio is on connected lanes), start = in point
  assert.equal(a.attrs.srcEnable, 'video');
  assert.equal(a.attrs.start, rationalTime(24, 23.976));
  const lanesA = a.children.filter((c) => c.attrs.lane).map((c) => [c.name, c.attrs.lane, c.attrs.srcEnable, c.attrs.offset]);
  assert.deepEqual(lanesA, [
    ['asset-clip', '-1', 'audio', rationalTime(24, 23.976)],
    ['asset-clip', '-2', 'audio', rationalTime(24, 23.976)],
  ]);
  // markers: chapter at 0 and red marker at 48 frames live on A, in A's local time
  const chapter = child(a, 'chapter-marker')!;
  assert.equal(chapter.attrs.value, 'Opening');
  assert.equal(chapter.attrs.start, rationalTime(24, 23.976));
  const mk = a.children.find((c) => c.name === 'marker')!;
  assert.equal(mk.attrs.value, 'Check focus');
  assert.equal(mk.attrs.note, 'soft?');
  assert.equal(mk.attrs.start, rationalTime(72, 23.976));
  // todo marker on B
  const todo = b.children.find((c) => c.name === 'marker')!;
  assert.equal(todo.attrs.completed, '0');
  // V2 clip (2x) is connected to the trailing gap on lane 1 with a timeMap
  const conn = gap.children.find((c) => c.attrs.lane === '1')!;
  assert.equal(conn.name, 'asset-clip');
  // offset is in the gap's local time (its start = its sequence time)
  assert.equal(gap.attrs.start, gap.attrs.offset);
  assert.equal(conn.attrs.offset, rationalTime(86400 + 240, 23.976));
  const tm = child(conn, 'timeMap')!;
  assert.equal(tm.children.length, 2);
  // connected-clip elements come before markers inside a clip (DTD order)
  const order = a.children.map((c) => c.name);
  assert.ok(order.lastIndexOf('asset-clip') < order.indexOf('chapter-marker'));
});

test('FCPXML: drop frame, compound clips, escaping', () => {
  const { project: p, seq } = fixture2997();
  seq.name = 'Q&A <final> "cut"';
  const nested = makeSequence({ width: 1920, height: 1080, fps: 29.97, dropFrame: true, sampleRate: 48000, colorSpace: 'rec709' }, 'Nest & Co');
  nested.tracks[2].clips.push(makeClip('media', { name: 'n', assetId: camA.id, start: 0, duration: 10 }));
  p.sequences.push(nested);
  seq.tracks[1].clips.push(makeClip('sequence', { name: 'Nest & Co', sequenceId: nested.id, start: 1, duration: 2 }));
  const xml = exportFcpxml(p, seq);
  const root = parseXml(xml);
  const seqs = findAll(root, 'sequence');
  assert.equal(seqs.length, 2);
  const main = seqs.find((s) => s.attrs.tcFormat === 'DF' && findAll(s, 'ref-clip').length)!;
  assert.ok(main);
  assert.equal(findAll(root, 'project')[0].attrs.name, 'Q&A <final> "cut"');
  const media = findAll(root, 'media')[0];
  assert.equal(media.attrs.name, 'Nest & Co');
  const ref = findAll(root, 'ref-clip')[0];
  assert.equal(ref.attrs.ref, media.attrs.id);
  assert.equal(ref.attrs.lane, '1');
  assert.equal(findAll(root, 'format')[0].attrs.frameDuration, '1001/30000s');
});

test('XML checker rejects malformed documents', () => {
  assert.throws(() => parseXml('<a><b></a></b>'));
  assert.throws(() => parseXml('<a x="1" x="2"/>'));
  assert.throws(() => parseXml('<a>Q & A</a>'));
  assert.throws(() => parseXml('<a/><b/>'));
  assert.equal(parseXml('<?xml version="1.0"?><!DOCTYPE a><a t="&amp;&lt;"><!-- c --><b/>x</a>').attrs.t, '&<');
});

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

function chapterSeq(times: [number, string][], duration: number): Sequence {
  const seq = makeSequence({ width: 1920, height: 1080, fps: 25, dropFrame: false, sampleRate: 48000, colorSpace: 'rec709' }, 'Ch');
  seq.tracks[2].clips.push(makeClip('solid', { start: 0, duration }));
  for (const [t, label] of times) seq.markers.push(makeMarker(t, { kind: 'chapter', label }));
  seq.markers.push(makeMarker(40, { kind: 'marker', label: 'not a chapter' }));
  return seq;
}

test('chapters: valid list', () => {
  const seq = chapterSeq(
    [
      [0, 'Intro'],
      [65.4, 'Setup'],
      [130, 'Grading  \n tips'],
    ],
    300,
  );
  const r = exportChaptersDetailed(seq);
  assert.equal(r.text, '00:00 Intro\n01:05 Setup\n02:10 Grading tips');
  assert.deepEqual(r.warnings, []);
  assert.equal(exportChapters(seq), r.text);
});

test('chapters: fix-ups with warnings', () => {
  const r = exportChaptersDetailed(
    chapterSeq(
      [
        [3, 'Hello'],
        [15, 'Part 1'],
        [20, 'Too close'],
        [60, 'Part 2'],
        [119, 'Credits'],
      ],
      125,
    ),
  );
  assert.equal(r.text, '00:00 Hello\n00:15 Part 1\n01:00 Part 2');
  assert.equal(r.warnings.length, 3);
  assert.match(r.warnings[0], /moved/);
  assert.match(r.warnings[1], /Too close/);
  assert.match(r.warnings[2], /Credits/);

  const intro = exportChaptersDetailed(chapterSeq([[30, 'Main']], 100));
  assert.equal(intro.text, '00:00 Intro\n00:30 Main');
  assert.ok(intro.warnings.some((w) => /Added "Intro"/.test(w)));
  assert.ok(intro.warnings.some((w) => /at least 3/.test(w)));

  const long = exportChaptersDetailed(
    chapterSeq(
      [
        [0, 'A'],
        [1800, 'B'],
        [3725, 'C'],
      ],
      4000,
    ),
  );
  assert.equal(long.text, '0:00:00 A\n0:30:00 B\n1:02:05 C');

  const none = exportChaptersDetailed(chapterSeq([], 100));
  assert.equal(none.text, '');
  assert.equal(none.warnings.length, 1);
});

test('EDL A3/A4 use NONE + AUD; FCPXML puts audio-only media on negative lanes', () => {
  const { project: p, seq } = fixture2398();
  const a3 = makeTrack('audio', 'A3x');
  a3.clips.push(makeClip('media', { name: 'score.wav', assetId: music.id, start: 0, duration: fromFrames(48, 23.976) }));
  seq.tracks.splice(5, 1, a3);
  const edl = exportEdl(p, seq);
  const lines = edl.split('\n');
  const i = lines.findIndex((l) => /^\d{3}  SCORE    NONE  C /.test(l));
  assert.ok(i > 0, edl);
  assert.equal(lines[i + 1], 'AUD  3');
  const root = parseXml(exportFcpxml(p, seq));
  const scoreAsset = findAll(root, 'asset').find((a) => a.attrs.name === 'score.wav')!;
  assert.equal(scoreAsset.attrs.hasVideo, '0');
  assert.equal(scoreAsset.attrs.format, undefined);
  assert.equal(scoreAsset.attrs.duration, '120s');
  const clip = findAll(root, 'asset-clip').find((c) => c.attrs.ref === scoreAsset.attrs.id)!;
  assert.equal(clip.attrs.lane, '-3');
  assert.equal(clip.attrs.srcEnable, undefined);
});
