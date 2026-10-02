// Fixtures for the edit-op tests (not a test file itself).

import assert from 'node:assert/strict';
import type { Clip, MediaAsset, Project, Sequence, Track } from '../../state/types';
import { FORMAT_VERSION } from '../../state/types';
import { makeAsset, makeClip, makeSequence } from '../../state/defaults';
import { exactRate, fromFrames, toFrames } from '../time';

export interface Fixture {
  project: Project;
  seq: Sequence;
  V1: Track;
  V2: Track;
  V3: Track;
  A1: Track;
  A2: Track;
  A3: Track;
  fps: number;
  /** frames → seconds */
  f(n: number): number;
  /** seconds → frames */
  F(t: number): number;
  asset(init?: Partial<MediaAsset>): MediaAsset;
  clip(track: Track, start: number, dur: number, init?: Partial<Clip>): Clip;
  /** A linked V1/A1 pair (frames). */
  av(start: number, dur: number, init?: Partial<Clip>, tracks?: [Track, Track]): [Clip, Clip];
}

export function fixture(fps = 24): Fixture {
  const seq = makeSequence({ width: 1920, height: 1080, fps, dropFrame: false, sampleRate: 48000, colorSpace: 'rec709' });
  const project: Project = {
    formatVersion: FORMAT_VERSION,
    id: 'proj',
    name: 'Test',
    app: 'video',
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, fps, dropFrame: false, sampleRate: 48000, colorSpace: 'rec709', matchFirstClip: false, stillDuration: 5, defaultTransitionDuration: 1 },
    assets: [],
    bins: [],
    luts: [],
    sequences: [seq],
    activeSequenceId: seq.id,
  };
  const [V3, V2, V1, A1, A2, A3] = seq.tracks;
  const f = (n: number) => fromFrames(n, fps);
  const F = (t: number) => toFrames(t, fps);
  let defaultAsset: MediaAsset | null = null;
  const asset = (init: Partial<MediaAsset> = {}) => {
    const a = makeAsset({ name: 'shot.mp4', path: '/media/shot.mp4', kind: 'video', duration: 600, hasAudio: true, hasVideo: true, fps, ...init });
    project.assets.push(a);
    return a;
  };
  const clip = (track: Track, start: number, dur: number, init: Partial<Clip> = {}) => {
    if (!init.assetId && (init.kind ?? 'media') === 'media') {
      defaultAsset ??= asset();
      init = { assetId: defaultAsset.id, ...init };
    }
    const c = makeClip(init.kind ?? 'media', { ...init, start: f(start), duration: f(dur) });
    track.clips.push(c);
    track.clips.sort((a, b) => a.start - b.start);
    return c;
  };
  const av = (start: number, dur: number, init: Partial<Clip> = {}, tracks: [Track, Track] = [V1, A1]): [Clip, Clip] => {
    const linkId = `link_${Math.random().toString(36).slice(2, 10)}`;
    return [clip(tracks[0], start, dur, { ...init, linkId }), clip(tracks[1], start, dur, { ...init, linkId })];
  };
  return { project, seq, V1, V2, V3, A1, A2, A3, fps, f, F, asset, clip, av };
}

/** [startFrame, endFrame] of every clip on a track, sorted. */
export function layout(track: Track, fps: number): [number, number][] {
  return [...track.clips].sort((a, b) => a.start - b.start).map((c) => [toFrames(c.start, fps), toFrames(c.start + c.duration, fps)]);
}

export function framesOf(c: Clip, fps: number): [number, number] {
  return [toFrames(c.start, fps), toFrames(c.start + c.duration, fps)];
}

function isOnGrid(t: number, fps: number): boolean {
  const x = t * exactRate(fps);
  return Math.abs(x - Math.round(x)) < 1e-9;
}

/** Every clip edge sits on the frame grid, durations ≥ 1 frame, no overlaps, tracks sorted. */
export function assertClean(seq: Sequence): void {
  for (const tr of seq.tracks) {
    let lastEnd = -Infinity;
    let lastStart = -Infinity;
    for (const c of tr.clips) {
      assert.ok(isOnGrid(c.start, seq.fps), `${tr.name} ${c.name} start ${c.start} off the frame grid`);
      assert.ok(isOnGrid(c.duration, seq.fps), `${tr.name} ${c.name} duration ${c.duration} off the frame grid`);
      assert.ok(isOnGrid(c.start + c.duration, seq.fps) || Math.abs((c.start + c.duration) * exactRate(seq.fps) - Math.round((c.start + c.duration) * exactRate(seq.fps))) < 1e-6, `${tr.name} end off grid`);
      const s = toFrames(c.start, seq.fps);
      const e = toFrames(c.start + c.duration, seq.fps);
      assert.ok(e - s >= 1, `${tr.name} clip shorter than a frame`);
      assert.ok(c.start >= lastStart, `${tr.name} not sorted`);
      assert.ok(s >= lastEnd, `${tr.name} overlap at frame ${s} (previous ends ${lastEnd})`);
      lastEnd = e;
      lastStart = c.start;
    }
  }
}

export function ids(track: Track): string[] {
  return [...track.clips].sort((a, b) => a.start - b.start).map((c) => c.id);
}
