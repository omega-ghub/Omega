import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAsset, makeClip, makeSequence, makeTransition } from '../../state/defaults';
import type { Clip, Project, Sequence } from '../../state/types';
import { detectRegions, duckAmount, duckKeyframes, mergeForRamps } from './ducking';
import { PeakBuilder, pickLevel, peakRange } from './peaks';
import { automation, crossfadeSplit, envAt, gainAt, handles, planMix, sourceAt, trackPlans } from './plan';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ±${tol}, got ${a}`);

function project(build: (seq: Sequence, assetId: string) => void): Project {
  const seq = makeSequence({ width: 1920, height: 1080, fps: 24, dropFrame: false, sampleRate: 48000, colorSpace: 'rec709' });
  const asset = makeAsset({ name: 'a.wav', path: '/a.wav', kind: 'audio', duration: 60, hasAudio: true, hasVideo: false });
  build(seq, asset.id);
  return {
    formatVersion: '0.2.0-json',
    id: 'p',
    name: 'p',
    app: 'video',
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, fps: 24, dropFrame: false, sampleRate: 48000, colorSpace: 'rec709', matchFirstClip: false, stillDuration: 5, defaultTransitionDuration: 1 },
    assets: [asset],
    bins: [],
    luts: [],
    sequences: [seq],
    activeSequenceId: seq.id,
  } as Project;
}

const audioTrack = (seq: Sequence, i = 0) => seq.tracks.filter((t) => t.kind === 'audio')[i];

test('solo mutes every non-soloed audio track; mute always wins', () => {
  const seq = makeSequence({ width: 1, height: 1, fps: 24, dropFrame: false, sampleRate: 48000, colorSpace: 'rec709' });
  const [a1, a2, a3] = seq.tracks.filter((t) => t.kind === 'audio');
  a2.solo = true;
  a3.solo = true;
  a3.muted = true;
  const tp = Object.fromEntries(trackPlans(seq).map((t) => [t.id, t.audible]));
  assert.deepEqual([tp[a1.id], tp[a2.id], tp[a3.id]], [false, true, false]);
});

test('source mapping: speed and reverse', () => {
  const p = project((seq, id) => {
    audioTrack(seq).clips.push(makeClip('media', { assetId: id, start: 10, duration: 4, inPoint: 2, speed: 2 }));
    audioTrack(seq, 1).clips.push(makeClip('media', { assetId: id, start: 0, duration: 4, inPoint: 2, speed: 1, reverse: true }));
  });
  const plan = planMix(p, p.sequences[0]);
  const fwd = plan.clips.find((c) => c.start === 10)!;
  near(sourceAt(fwd, 10), 2, 1e-12);
  near(sourceAt(fwd, 12), 6, 1e-12);
  near(fwd.src1, 10, 1e-12);
  const rev = plan.clips.find((c) => c.start === 0)!;
  near(sourceAt(rev, 0), 6, 1e-12);
  near(sourceAt(rev, 4), 2, 1e-12);
  assert.deepEqual(handles(rev), { head: 54, tail: 2 });
});

test('audio crossfade is centered on the cut, uses handles, and is equal-power', () => {
  let a!: Clip;
  let b!: Clip;
  const p = project((seq, id) => {
    a = makeClip('media', { assetId: id, start: 0, duration: 5, inPoint: 0 });
    b = makeClip('media', { assetId: id, start: 5, duration: 5, inPoint: 20, transitionIn: makeTransition('audioCrossfade', 1) });
    audioTrack(seq).clips.push(a, b);
  });
  const plan = planMix(p, p.sequences[0]);
  const pa = plan.clips.find((c) => c.id === a.id)!;
  const pb = plan.clips.find((c) => c.id === b.id)!;
  near(pa.t1, 5.5, 1e-9, 'outgoing extends into its tail handle');
  near(pb.t0, 4.5, 1e-9, 'incoming starts in its head handle');
  near(sourceAt(pb, 4.5), 19.5, 1e-9);
  for (const t of [4.5, 4.75, 5, 5.25, 5.5]) near(envAt(pa, t) ** 2 + envAt(pb, t) ** 2, 1, 1e-9, `power at ${t}`);
  near(envAt(pa, 5), Math.SQRT1_2, 1e-9);
});

test('crossfade shifts to the side that has media', () => {
  assert.deepEqual(crossfadeSplit(1, 0, 10), { pre: 0, post: 1 });
  assert.deepEqual(crossfadeSplit(1, 10, 0), { pre: 1, post: 0 });
  assert.deepEqual(crossfadeSplit(1, 0.2, 10), { pre: 0.2, post: 0.8 });
  // clip whose source starts at inPoint 0 has no head handle
  let b!: Clip;
  const p = project((seq, id) => {
    audioTrack(seq).clips.push(makeClip('media', { assetId: id, start: 0, duration: 5, inPoint: 0 }));
    b = makeClip('media', { assetId: id, start: 5, duration: 5, inPoint: 0, transitionIn: makeTransition('audioCrossfade', 2) });
    audioTrack(seq).clips.push(b);
  });
  const pb = planMix(p, p.sequences[0]).clips.find((c) => c.id === b.id)!;
  near(pb.t0, 5, 1e-9);
  assert.ok(sourceAt(pb, pb.t0) >= 0);
});

test('fades, clip gain keyframes, muted clips', () => {
  let c!: Clip;
  const p = project((seq, id) => {
    c = makeClip('media', { assetId: id, start: 2, duration: 4 });
    c.audio.fadeIn = 1;
    c.audio.fadeOut = 2;
    c.keyframes['audio.gain'] = [
      { t: 0, v: 0, ease: 'linear' },
      { t: 4, v: -20, ease: 'linear' },
    ];
    const muted = makeClip('media', { assetId: id, start: 10, duration: 1 });
    muted.audio.mute = true;
    audioTrack(seq).clips.push(c, muted);
  });
  const plan = planMix(p, p.sequences[0]);
  assert.equal(plan.clips.length, 1);
  const cp = plan.clips[0];
  near(envAt(cp, 2.5), 0.5, 1e-9);
  near(envAt(cp, 3.5), 1, 1e-9);
  near(envAt(cp, 5), 0.5, 1e-9);
  near(gainAt(cp, 4), Math.pow(10, -10 / 20), 1e-9);
});

test('automation: flat and linear spans are two points, curves are sampled, jumps are kept', () => {
  assert.deepEqual(automation(() => 1, 0, 10, []), [0, 1, 10, 1]);
  assert.deepEqual(automation((t) => t / 10, 0, 10, []), [0, 0, 10, 1]);
  const curve = automation((t) => Math.sin(t), 0, 1, [], 0.01);
  assert.ok(curve.length / 2 >= 100);
  const step = automation((t) => (t < 5 ? 0 : 1), 0, 10, [5]);
  assert.deepEqual(step, [0, 0, 5, 0, 5, 1, 10, 1]);
});

test('ducking: regions, hold, ramps, keyframes', () => {
  const hop = 0.01;
  const env = new Float32Array(1000).fill(-80);
  env.fill(-20, 100, 300); // speech 1..3 s
  env.fill(-20, 320, 400); // short pause (0.2 s) bridged by hold
  env.fill(-20, 700, 703); // 30 ms blip dropped
  const regions = detectRegions(env, hop, 0, -40);
  assert.equal(regions.length, 1);
  near(regions[0][0], 1, 1e-9);
  near(regions[0][1], 4, 1e-9);
  assert.equal(mergeForRamps([[0, 1], [1.5, 2]], 0.3, 0.3).length, 1);
  assert.equal(duckAmount(regions, 0.5, 0.5, 1), 0);
  near(duckAmount(regions, 0.75, 0.5, 1), 0.5, 1e-9);
  near(duckAmount(regions, 4.5, 0.5, 1), 0.5, 1e-9);
  const music = makeClip('media', { start: 0, duration: 10 });
  music.audio.gain = -3;
  const kfs = duckKeyframes(music, regions, 12, 0.5, 1)!;
  assert.deepEqual(
    kfs.map((k) => [k.t, k.v]),
    [
      [0.5, -3],
      [1, -15],
      [4, -15],
      [5, -3],
    ],
  );
  assert.equal(duckKeyframes(makeClip('media', { start: 20, duration: 5 }), regions, 12, 0.5, 1), null);
});

test('peaks: multi-resolution min/max', () => {
  const sr = 48000;
  const b = new PeakBuilder(sr, sr);
  const x = new Float32Array(sr);
  for (let i = 0; i < sr; i++) x[i] = Math.sin(i / 10) * (i < sr / 2 ? 0.5 : 1);
  const y = x.map((v) => -v * 0.25);
  for (let o = 0; o < sr; o += 1000) b.push([x, y], o, Math.min(1000, sr - o));
  const levels = b.finish();
  assert.deepEqual(
    levels.map((l) => l.bucket),
    [256, 2048, 16384],
  );
  assert.equal(levels[0].data.length, Math.ceil(sr / 256) * 2);
  assert.equal(pickLevel(levels, 5000)!.bucket, 2048);
  assert.equal(pickLevel(levels, 100)!.bucket, 256);
  const first = peakRange(levels, 0, 0.4);
  near(first.max, 0.5, 0.01);
  const all = peakRange(levels, 0, 1);
  near(all.max, 1, 0.01);
  near(all.min, -1, 0.01);
});
