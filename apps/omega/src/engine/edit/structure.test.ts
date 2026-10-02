import { test } from 'node:test';
import assert from 'node:assert/strict';
import { produce, setAutoFreeze } from 'immer';
import {
  addMarker,
  addTrack,
  addTransition,
  clipAt,
  deleteClips,
  duplicateClips,
  editPoints,
  groupClips,
  linkClips,
  matchFrame,
  moveClips,
  moveMarker,
  nestClips,
  nextEditPoint,
  normalizeTrack,
  pasteClips,
  placeMedia,
  prevEditPoint,
  removeMarker,
  removeTrack,
  removeTransition,
  replaceClipMedia,
  selectBackward,
  selectForward,
  setClipsEnabled,
  setLabel,
  splitAt,
  trimClip,
  ungroupClips,
  unlinkClips,
  unnestClip,
} from './ops';
import type { Clip, Project, Sequence } from '../../state/types';
import { findClip } from '../../state/types';
import { makeClip, makeTransition } from '../../state/defaults';
import { assertClean, fixture, framesOf, layout } from './testkit';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const snapshotClip = (c: Clip) => ({ id: c.id, start: c.start, duration: c.duration, inPoint: c.inPoint, linkId: c.linkId });

// ---- nest / unnest ----------------------------------------------------------

test('nest: new sequence (same format) holds the clips from 0 with relative tracks; one linked A/V nest clip replaces them', () => {
  const fx = fixture(24);
  const [A, a] = fx.av(24, 48, { inPoint: 1 });
  const T = fx.clip(fx.V2, 36, 24, { kind: 'text' });
  const keep = fx.clip(fx.V1, 100, 24);
  const nid = nestClips(fx.project, fx.seq, [A.id, T.id], 'Scene 1');
  const nested = fx.project.sequences.find((s) => s.id === nid)!;
  assert.ok(nested);
  assert.equal(nested.name, 'Scene 1');
  assert.equal(nested.fps, 24);
  assert.equal(nested.width, 1920);
  assert.deepEqual(nested.tracks.map((t) => t.name), ['V2', 'V1', 'A1']);
  const [nV2, nV1, nA1] = nested.tracks;
  assert.deepEqual(layout(nV1, 24), [[0, 48]]);
  assert.deepEqual(layout(nV2, 24), [[12, 36]]);
  assert.deepEqual(layout(nA1, 24), [[0, 48]]);
  assert.equal(nV1.clips[0].id, A.id);
  assert.equal(nA1.clips[0].id, a.id);
  // parent
  assert.equal(fx.V2.clips.length, 0);
  const nv = fx.V1.clips.find((c) => c.kind === 'sequence')!;
  const na = fx.A1.clips.find((c) => c.kind === 'sequence')!;
  assert.deepEqual(framesOf(nv, 24), [24, 72]);
  assert.equal(nv.sequenceId, nid);
  assert.equal(na.sequenceId, nid);
  assert.equal(nv.linkId, na.linkId);
  assert.ok(nv.linkId);
  assert.ok(fx.V1.clips.includes(keep));
  assertClean(fx.seq);
  assertClean(nested);
});

test('nest → unnest round-trips clips, ids, timing, tracks and links; the nest sequence is removed', () => {
  const fx = fixture(24);
  const [A, a] = fx.av(24, 48, { inPoint: 1 });
  const T = fx.clip(fx.V2, 36, 24, { kind: 'text' });
  const before = [A, a, T].map(snapshotClip);
  const nid = nestClips(fx.project, fx.seq, [A.id, T.id]);
  const nv = fx.V1.clips.find((c) => c.kind === 'sequence')!;
  const ids = unnestClip(fx.project, fx.seq, nv.id);
  assert.equal(ids.length, 3);
  assert.equal(fx.project.sequences.find((s) => s.id === nid), undefined);
  assert.equal(fx.project.sequences.length, 1);
  const after = [findClip(fx.seq, A.id)!, findClip(fx.seq, a.id)!, findClip(fx.seq, T.id)!];
  assert.equal(after[0].track, fx.V1);
  assert.equal(after[1].track, fx.A1);
  assert.equal(after[2].track, fx.V2);
  assert.deepEqual(after.map((x) => snapshotClip(x.clip)), before);
  assert.equal(fx.seq.tracks.flatMap((t) => t.clips).filter((c) => c.kind === 'sequence').length, 0);
});

test('nest: audio-only nests get just an audio nest clip; tracks above V1 map relative to the lowest one', () => {
  const fx = fixture(24);
  const m = fx.clip(fx.A2, 0, 48);
  nestClips(fx.project, fx.seq, [m.id]);
  assert.equal(fx.V1.clips.length, 0);
  assert.equal(fx.A2.clips[0].kind, 'sequence');
  const fx2 = fixture(24);
  const x = fx2.clip(fx2.V2, 0, 24);
  const y = fx2.clip(fx2.V3, 0, 24);
  const nid = nestClips(fx2.project, fx2.seq, [x.id, y.id]);
  const nested = fx2.project.sequences.find((s) => s.id === nid)!;
  assert.deepEqual(nested.tracks.filter((t) => t.kind === 'video').map((t) => t.clips[0]?.id), [y.id, x.id]);
  assert.equal(fx2.V2.clips[0].kind, 'sequence');
});

test('unnest: a trimmed nest clip restores only the range it used', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 96, { inPoint: 2 });
  nestClips(fx.project, fx.seq, [A.id]);
  const nv = fx.V1.clips[0];
  trimClip(fx.project, fx.seq, nv.id, 'start', fx.f(24), 'normal');
  trimClip(fx.project, fx.seq, nv.id, 'end', fx.f(72), 'normal');
  unnestClip(fx.project, fx.seq, nv.id);
  const r = fx.V1.clips[0];
  assert.equal(r.id, A.id);
  assert.deepEqual(framesOf(r, 24), [24, 72]);
  assert.equal(r.inPoint, 3);
});

test('unnest: refuses reversed nest clips; keeps the sequence when used elsewhere (fresh ids)', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 48);
  const nid = nestClips(fx.project, fx.seq, [A.id]);
  const nv = fx.V1.clips[0];
  nv.reverse = true;
  assert.deepEqual(unnestClip(fx.project, fx.seq, nv.id), []);
  nv.reverse = false;
  const ids = duplicateClips(fx.seq, [nv.id], fx.f(100));
  const restored = unnestClip(fx.project, fx.seq, ids[0]);
  assert.equal(restored.length, 1);
  assert.notEqual(restored[0], A.id);
  assert.ok(fx.project.sequences.some((s) => s.id === nid));
});

// ---- paste / duplicate -------------------------------------------------------

function copy(seq: Sequence, ids: string[]) {
  const t0 = Math.min(...seq.tracks.flatMap((t) => t.clips.filter((c) => ids.includes(c.id)).map((c) => c.start)));
  const out: { clip: Clip; trackIndex: number; trackKind: Sequence['tracks'][number]['kind'] }[] = [];
  for (const tr of seq.tracks) {
    const idx = seq.tracks.filter((x) => x.kind === tr.kind).indexOf(tr);
    for (const c of tr.clips) if (ids.includes(c.id)) out.push({ clip: { ...structuredClone(c), start: c.start - t0 }, trackIndex: idx, trackKind: tr.kind });
  }
  return out;
}

test('paste overwrite: fresh ids and a fresh link pair on the targeted tracks', () => {
  const fx = fixture(24);
  const [v, s] = fx.av(0, 24);
  const under = fx.clip(fx.V1, 90, 30);
  const ids = pasteClips(fx.seq, copy(fx.seq, [v.id, s.id]), fx.f(100), 'overwrite');
  assert.equal(ids.length, 2);
  const pv = fx.V1.clips.find((c) => c.id === ids[0] || c.id === ids[1])!;
  const ps = fx.A1.clips.find((c) => c.id === ids[0] || c.id === ids[1])!;
  assert.ok(pv && ps);
  assert.equal(pv.linkId, ps.linkId);
  assert.notEqual(pv.linkId, v.linkId);
  assert.deepEqual(framesOf(pv, 24), [100, 124]);
  assert.deepEqual(framesOf(under, 24), [90, 100]);
  assert.deepEqual(layout(fx.V1, 24), [[0, 24], [90, 100], [100, 124]]);
  assertClean(fx.seq);
});

test('paste insert: pushes later clips on every unlocked track', () => {
  const fx = fixture(24);
  const [v, s] = fx.av(0, 24);
  const later = fx.clip(fx.A2, 30, 10);
  pasteClips(fx.seq, copy(fx.seq, [v.id, s.id]), fx.f(24), 'insert');
  assert.deepEqual(layout(fx.V1, 24), [[0, 24], [24, 48]]);
  assert.deepEqual(framesOf(later, 24), [54, 64]);
});

test('paste keeps relative tracks from the lowest targeted video track, creating tracks if needed', () => {
  const fx = fixture(24);
  const x = fx.clip(fx.V1, 0, 24);
  const y = fx.clip(fx.V2, 0, 24);
  const z = fx.clip(fx.V3, 0, 24);
  const cb = copy(fx.seq, [x.id, y.id, z.id]);
  fx.V1.targeted = false;
  pasteClips(fx.seq, cb, fx.f(100), 'overwrite');
  assert.equal(fx.seq.tracks[0].name, 'V4');
  assert.deepEqual(layout(fx.seq.tracks[0], 24), [[100, 124]]);
  assert.deepEqual(layout(fx.V3, 24), [[0, 24], [100, 124]]);
  assert.deepEqual(layout(fx.V2, 24), [[0, 24], [100, 124]]);
  assert.deepEqual(layout(fx.V1, 24), [[0, 24]]);
});

test('duplicate: offset copies with fresh ids and links, overwriting underneath', () => {
  const fx = fixture(24);
  const [v, s] = fx.av(0, 24, { groupId: 'g' });
  const under = fx.clip(fx.V1, 30, 30);
  const ids = duplicateClips(fx.seq, [v.id], fx.f(24));
  assert.equal(ids.length, 2);
  const dv = fx.V1.clips.find((c) => ids.includes(c.id))!;
  const ds = fx.A1.clips.find((c) => ids.includes(c.id))!;
  assert.equal(dv.linkId, ds.linkId);
  assert.notEqual(dv.linkId, v.linkId);
  assert.equal(dv.groupId, ds.groupId);
  assert.notEqual(dv.groupId, v.groupId);
  assert.deepEqual(framesOf(dv, 24), [24, 48]);
  assert.deepEqual(framesOf(under, 24), [48, 60]);
  assert.ok(s);
});

// ---- links & groups -----------------------------------------------------------

test('link / unlink / group / ungroup', () => {
  const fx = fixture(24);
  const a = fx.clip(fx.V1, 0, 24);
  const b = fx.clip(fx.A1, 0, 24);
  const c = fx.clip(fx.V2, 0, 24);
  linkClips(fx.seq, [a.id, b.id]);
  assert.ok(a.linkId && a.linkId === b.linkId);
  linkClips(fx.seq, [c.id]);
  assert.equal(c.linkId, undefined, 'needs two clips');
  unlinkClips(fx.seq, [a.id]);
  assert.equal(a.linkId, undefined);
  assert.equal(b.linkId, undefined, 'the whole linked set unlinks');
  groupClips(fx.seq, [a.id, c.id]);
  assert.ok(a.groupId && a.groupId === c.groupId);
  ungroupClips(fx.seq, [c.id]);
  assert.equal(a.groupId, undefined);
});

test('a link left with one member is dropped', () => {
  const fx = fixture(24);
  const [v, s] = fx.av(0, 24);
  deleteClips(fx.seq, [s.id], false, { unlinked: true });
  assert.equal(v.linkId, undefined);
});

// ---- transitions ----------------------------------------------------------------

test('addTransition at a cut: transitionIn on the incoming clip, clamped to half on each side', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 12);
  const B = fx.clip(fx.V1, 12, 48);
  addTransition(fx.seq, B.id, 'start', 'crossDissolve', 2);
  assert.equal(B.transitionIn?.type, 'crossDissolve');
  assert.equal(B.transitionIn?.duration, fx.f(24), 'prev has 12 frames → at most 24');
  // 'end' of A at an adjacent cut lands on B's head
  addTransition(fx.seq, A.id, 'end', 'wipe', fx.f(10));
  assert.equal(B.transitionIn?.type, 'wipe');
  assert.equal(B.transitionIn?.duration, fx.f(10));
  assert.equal(A.transitionOut, null);
});

test('addTransition: to/from nothing, audio crossfades, removal', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 12);
  addTransition(fx.seq, A.id, 'end', 'dipToBlack', 5);
  assert.equal(A.transitionOut?.type, 'dipToBlack');
  assert.equal(A.transitionOut?.duration, fx.f(24), 'half of it fills the 12-frame clip');
  addTransition(fx.seq, A.id, 'start', 'crossDissolve', fx.f(6));
  assert.equal(A.transitionIn?.duration, fx.f(1), 'no room left next to the tail transition');
  addTransition(fx.seq, A.id, 'end', 'dipToBlack', fx.f(6));
  addTransition(fx.seq, A.id, 'start', 'crossDissolve', fx.f(6));
  assert.equal(A.transitionIn?.duration, fx.f(6));
  addTransition(fx.seq, A.id, 'start', 'crossDissolve', 10);
  assert.equal(A.transitionIn?.duration, fx.f(18), 'clip minus the tail half, times two');
  const s = fx.clip(fx.A1, 0, 48);
  addTransition(fx.seq, s.id, 'start', 'crossDissolve', 1);
  assert.equal(s.transitionIn?.type, 'audioCrossfade');
  addTransition(fx.seq, A.id, 'end', 'dipToBlack', 0);
  assert.equal(A.transitionOut, null);
  removeTransition(fx.seq, A.id, 'start');
  assert.equal(A.transitionIn, null);
});

test('transitions: removed when the neighbour goes away, kept through rolls and splits of the neighbour', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 48);
  const B = fx.clip(fx.V1, 48, 48, { inPoint: 2 });
  addTransition(fx.seq, B.id, 'start', 'crossDissolve', 1);
  trimClip(fx.project, fx.seq, A.id, 'end', fx.f(60), 'roll');
  assert.ok(B.transitionIn, 'kept through a roll');
  splitAt(fx.seq, [A.id], fx.f(20));
  assert.ok(B.transitionIn, 'kept when the outgoing clip is split');
  moveClips(fx.seq, [B.id], fx.f(10), 0, 'overwrite');
  assert.equal(B.transitionIn, null, 'removed when no longer adjacent');
  // a fade from nothing survives moves
  const C = fx.clip(fx.V2, 0, 48, { transitionIn: makeTransition('dipToBlack', 0.5) });
  moveClips(fx.seq, [C.id], 1, 0, 'overwrite');
  assert.ok(C.transitionIn);
  // deleting the previous clip removes the cross transition
  const fx2 = fixture(24);
  const P = fx2.clip(fx2.V1, 0, 24);
  const Q = fx2.clip(fx2.V1, 24, 24, { transitionIn: makeTransition('crossDissolve', 0.5) });
  deleteClips(fx2.seq, [P.id], true);
  assert.equal(Q.transitionIn, null);
  assert.deepEqual(framesOf(Q, 24), [0, 24]);
});

test('transitions are clamped when a clip gets shorter', () => {
  const fx = fixture(24);
  const A = fx.clip(fx.V1, 0, 48);
  const B = fx.clip(fx.V1, 48, 48, { inPoint: 5, transitionIn: makeTransition('crossDissolve', 2) });
  trimClip(fx.project, fx.seq, A.id, 'end', fx.f(12), 'roll');
  assert.deepEqual(framesOf(A, 24), [0, 12]);
  assert.ok(B.transitionIn);
  assert.equal(B.transitionIn!.duration, fx.f(24));
});

// ---- tracks & markers --------------------------------------------------------

test('addTrack: unique names, video on top, audio below the audio, captions with a style', () => {
  const fx = fixture(24);
  const v = addTrack(fx.seq, 'video');
  assert.equal(v.name, 'V4');
  assert.equal(fx.seq.tracks[0].id, v.id);
  const a = addTrack(fx.seq, 'audio');
  assert.equal(a.name, 'A4');
  assert.equal(fx.seq.tracks[7].id, a.id);
  const c = addTrack(fx.seq, 'caption');
  assert.equal(c.name, 'C1');
  assert.ok(c.captionStyle);
  assert.equal(fx.seq.tracks[fx.seq.tracks.length - 1].id, c.id);
  const v5 = addTrack(fx.seq, 'video', 99);
  assert.equal(v5.name, 'V5');
  assert.equal(fx.seq.tracks.indexOf(v5), 4, 'clamped into the video group');
  assert.deepEqual(fx.seq.tracks.map((t) => t.kind), ['video', 'video', 'video', 'video', 'video', 'audio', 'audio', 'audio', 'audio', 'caption']);
});

test('removeTrack: not locked tracks, not the last of a kind; links to it are dropped', () => {
  const fx = fixture(24);
  const [v] = fx.av(0, 24);
  removeTrack(fx.seq, fx.A1.id);
  assert.equal(fx.seq.tracks.length, 5);
  assert.equal(v.linkId, undefined);
  fx.V2.locked = true;
  removeTrack(fx.seq, fx.V2.id);
  assert.equal(fx.seq.tracks.length, 5);
  removeTrack(fx.seq, fx.A2.id);
  removeTrack(fx.seq, fx.A3.id);
  assert.equal(fx.seq.tracks.filter((t) => t.kind === 'audio').length, 1);
});

test('markers: frame-snapped, sorted, movable, removable', () => {
  const fx = fixture(24);
  const m1 = addMarker(fx.seq, 2.01);
  const m2 = addMarker(fx.seq, 1, { label: 'Chapter', kind: 'chapter', duration: 0.51 });
  assert.deepEqual(fx.seq.markers.map((m) => m.id), [m2, m1]);
  assert.equal(fx.seq.markers[1].time, 2);
  assert.equal(fx.seq.markers[0].duration, 0.5);
  assert.equal(fx.seq.markers[0].kind, 'chapter');
  moveMarker(fx.seq, m2, 3.02);
  assert.deepEqual(fx.seq.markers.map((m) => m.id), [m1, m2]);
  assert.equal(fx.seq.markers[1].time, 3);
  removeMarker(fx.seq, m1);
  assert.deepEqual(fx.seq.markers.map((m) => m.id), [m2]);
});

// ---- queries ------------------------------------------------------------------

test('editPoints: sorted, unique, frame-exact; options', () => {
  const fx = fixture(24);
  const a = fx.clip(fx.V1, 0, 24);
  fx.clip(fx.V1, 24, 24);
  fx.clip(fx.A1, 12, 36);
  addMarker(fx.seq, fx.f(30));
  fx.seq.inPoint = fx.f(5);
  const pts = editPoints(fx.seq);
  assert.deepEqual(pts.map(fx.F), [0, 5, 12, 24, 30, 48]);
  assert.deepEqual(editPoints(fx.seq, { includeMarkers: false, includeInOut: false, excludeClipIds: [a.id] }).map(fx.F), [0, 12, 24, 48]);
  fx.A1.targeted = false;
  assert.deepEqual(editPoints(fx.seq, { targetedOnly: true, includeMarkers: false, includeInOut: false, playhead: fx.f(40) }).map(fx.F), [0, 24, 40, 48]);
  assert.equal(nextEditPoint(fx.seq, fx.f(12))!, fx.f(24));
  assert.equal(prevEditPoint(fx.seq, fx.f(12))!, fx.f(5));
  assert.equal(nextEditPoint(fx.seq, fx.f(48)), null);
});

test('clipAt / selectForward / selectBackward', () => {
  const fx = fixture(24);
  const a = fx.clip(fx.V1, 0, 24);
  const b = fx.clip(fx.V1, 24, 24);
  const c = fx.clip(fx.A1, 30, 10);
  fx.clip(fx.A2, 30, 10);
  fx.A2.locked = true;
  assert.equal(clipAt(fx.V1, fx.f(24)), b);
  assert.equal(clipAt(fx.V1, fx.f(23)), a);
  assert.equal(clipAt(fx.V1, fx.f(48)), undefined);
  assert.deepEqual(selectForward(fx.seq, fx.f(10), null), [a.id, b.id, c.id]);
  assert.deepEqual(selectForward(fx.seq, fx.f(25), fx.V1.id), [b.id]);
  assert.deepEqual(selectBackward(fx.seq, fx.f(24), null), [a.id, b.id]);
});

test('matchFrame: topmost visible video clip, through nests, with source In/Out', () => {
  const fx = fixture(24);
  const a1 = fx.asset({ name: 'a' });
  const a2 = fx.asset({ name: 'b' });
  fx.clip(fx.V1, 0, 96, { assetId: a1.id, inPoint: 10 });
  const top = fx.clip(fx.V2, 24, 24, { assetId: a2.id, inPoint: 3 });
  fx.clip(fx.V3, 0, 96, { kind: 'text' });
  const r = matchFrame(fx.project, fx.seq, fx.f(36))!;
  assert.equal(r.assetId, a2.id);
  close(r.sourceTime, 3.5);
  assert.equal(r.clipId, top.id);
  assert.equal(r.sourceIn, 3);
  close(r.sourceOut, 4);
  fx.V2.muted = true;
  assert.equal(matchFrame(fx.project, fx.seq, fx.f(36))!.assetId, a1.id);
  fx.V2.muted = false;
  nestClips(fx.project, fx.seq, [top.id]);
  const n = matchFrame(fx.project, fx.seq, fx.f(36))!;
  assert.equal(n.assetId, a2.id);
  close(n.sourceTime, 3.5);
});

// ---- helpers ------------------------------------------------------------------

test('replaceClipMedia: keeps place and length; pulls the in point back when the new media is short', () => {
  const fx = fixture(24);
  const [v, s] = fx.av(0, 48, { inPoint: 8 });
  const b = fx.asset({ name: 'take2.mp4', duration: 9 });
  assert.ok(replaceClipMedia(fx.project, fx.seq, v.id, b.id));
  assert.equal(v.assetId, b.id);
  assert.equal(s.assetId, b.id);
  assert.equal(v.inPoint, 7);
  assert.equal(v.name, 'take2.mp4');
  assert.deepEqual(framesOf(v, 24), [0, 48]);
  const tiny = fx.asset({ duration: 1, hasAudio: false });
  replaceClipMedia(fx.project, fx.seq, v.id, tiny.id);
  assert.deepEqual(framesOf(v, 24), [0, 24], 'shortened to the media');
  assert.equal(v.linkId, undefined, 'audio could not follow: unlinked');
  const music = fx.asset({ kind: 'audio', hasVideo: false });
  assert.ok(!replaceClipMedia(fx.project, fx.seq, v.id, music.id), 'no picture to put on a video track');
});

test('setClipsEnabled / setLabel skip locked tracks', () => {
  const fx = fixture(24);
  const a = fx.clip(fx.V1, 0, 24);
  const b = fx.clip(fx.V2, 0, 24);
  setClipsEnabled(fx.seq, [a.id, b.id], 'toggle');
  assert.equal(a.enabled, false);
  setClipsEnabled(fx.seq, [a.id, b.id], 'toggle');
  assert.equal(a.enabled, true);
  fx.V2.locked = true;
  setLabel(fx.seq, [a.id, b.id], 'violet');
  assert.equal(a.label, 'violet');
  assert.equal(b.label, 'none');
  setClipsEnabled(fx.seq, [b.id], false);
  assert.equal(b.enabled, true);
});

test('normalizeTrack sorts and drops zero-length clips', () => {
  const fx = fixture(24);
  const tr = fx.V1;
  tr.clips.push(makeClip('media', { start: 2, duration: 1 }), makeClip('media', { start: 0, duration: 1 }), makeClip('media', { start: 1, duration: 0.001 }));
  normalizeTrack(tr, 24);
  assert.deepEqual(tr.clips.map((c) => c.start), [0, 2]);
});

// ---- immer drafts ---------------------------------------------------------------

test('ops work on immer drafts (auto-frozen state) and no-ops keep the same object', () => {
  setAutoFreeze(true);
  try {
    const fx = fixture(23.976);
    const a = fx.asset({ duration: 20 });
    let p: Project = produce(fx.project, (d) => {
      placeMedia(d, d.sequences[0], a.id, { start: 0 });
      placeMedia(d, d.sequences[0], a.id, { start: 2, mode: 'insert' });
    });
    const seq0 = p.sequences[0];
    assert.equal(seq0.tracks[2].clips.length, 3);
    assert.ok(Object.isFrozen(seq0));
    let created: string[] = [];
    p = produce(p, (d) => {
      created = splitAt(d.sequences[0], null, 1);
      moveClips(d.sequences[0], [created[0]], 0.5, -1, 'overwrite');
    });
    assert.equal(created.length, 2);
    assertClean(p.sequences[0]);
    const nid = { v: '' };
    p = produce(p, (d) => {
      nid.v = nestClips(d, d.sequences[0], [d.sequences[0].tracks[2].clips[0].id]);
    });
    assert.equal(p.sequences.length, 2);
    assert.ok(p.sequences.some((s) => s.id === nid.v));
    const same = produce(p, (d) => {
      const c = d.sequences[0].tracks[2].clips[0];
      trimClip(d, d.sequences[0], c.id, 'start', c.start, 'normal');
      moveClips(d.sequences[0], [c.id], 0, 0, 'overwrite');
    });
    assert.equal(same, p, 'a no-op edit produces no new state');
    const nv = p.sequences[0].tracks.flatMap((t) => t.clips).find((c) => c.kind === 'sequence')!;
    p = produce(p, (d) => {
      unnestClip(d, d.sequences[0], nv.id);
    });
    assert.equal(p.sequences.length, 1);
    assertClean(p.sequences[0]);
  } finally {
    setAutoFreeze(false);
  }
});
