import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  audioChunks,
  audioKbps,
  estimateBytes,
  even,
  ExportRangeError,
  fpsLabel,
  frameCount,
  frameTime,
  resolveFps,
  resolveOutputSize,
  resolveRange,
  resolveVideoKbps,
  sampleCount,
  sequenceFrameAt,
} from './plan';
import { BUILTIN_PRESETS, findPreset } from './presets';
import type { Sequence, Track } from '../../state/types';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

function seq(duration: number, fps = 30, marks: { inPoint?: number | null; outPoint?: number | null } = {}): Pick<Sequence, 'fps' | 'inPoint' | 'outPoint' | 'tracks'> {
  const track = { id: 't', kind: 'video', clips: [{ start: 0, duration }], cues: [] } as unknown as Track;
  return { fps, inPoint: marks.inPoint ?? null, outPoint: marks.outPoint ?? null, tracks: [track] };
}

// ---------------- resolution policy ----------------

test('even() rounds to even sizes ≥ 2', () => {
  assert.equal(even(1079), 1080);
  assert.equal(even(1081), 1082);
  assert.equal(even(0.4), 2);
});

test('sequence policy matches the sequence, with scale %', () => {
  assert.deepEqual(resolveOutputSize({ mode: 'sequence' }, { width: 4096, height: 2160 }), { width: 4096, height: 2160, innerWidth: 4096, innerHeight: 2160, padded: false });
  const half = resolveOutputSize({ mode: 'sequence', scale: 50 }, { width: 3840, height: 2160 });
  assert.equal(half.width, 1920);
  assert.equal(half.height, 1080);
  const odd = resolveOutputSize({ mode: 'sequence', scale: 33 }, { width: 1920, height: 1080 });
  assert.equal(odd.width % 2, 0);
  assert.equal(odd.height % 2, 0);
});

test('fixed policy: same aspect is exact, different aspect is letterboxed', () => {
  const same = resolveOutputSize({ mode: 'fixed', width: 1920, height: 1080 }, { width: 3840, height: 2160 });
  assert.deepEqual([same.width, same.height, same.padded], [1920, 1080, false]);
  const vert = resolveOutputSize({ mode: 'fixed', width: 1080, height: 1920 }, { width: 1920, height: 1080 });
  assert.equal(vert.width, 1080);
  assert.equal(vert.height, 1920);
  assert.equal(vert.padded, true);
  assert.equal(vert.innerWidth, 1080);
  assert.equal(vert.innerHeight, 608);
});

test('max policy fits inside, never upscales, and follows orientation', () => {
  assert.deepEqual(pick(resolveOutputSize({ mode: 'max', width: 1920, height: 1080 }, { width: 3840, height: 2160 })), [1920, 1080]);
  assert.deepEqual(pick(resolveOutputSize({ mode: 'max', width: 1920, height: 1080 }, { width: 1280, height: 720 })), [1280, 720]);
  // DCI 4K into a UHD box keeps 1.896:1
  assert.deepEqual(pick(resolveOutputSize({ mode: 'max', width: 3840, height: 2160 }, { width: 4096, height: 2160 })), [3840, 2026]);
  // vertical sequence keeps its orientation inside a landscape box
  assert.deepEqual(pick(resolveOutputSize({ mode: 'max', width: 1920, height: 1080 }, { width: 2160, height: 3840 })), [1080, 1920]);
});

function pick(s: { width: number; height: number }) {
  return [s.width, s.height];
}

// ---------------- frame rate ----------------

test('fps policy: sequence rate, cap by whole divisors, allowed lists, fixed', () => {
  near(resolveFps({ mode: 'sequence' }, 23.976), 24000 / 1001);
  near(resolveFps({ mode: 'sequence', max: 60 }, 119.88), 60000 / 1001);
  near(resolveFps({ mode: 'sequence', max: 60 }, 120), 60);
  near(resolveFps({ mode: 'sequence', max: 60 }, 100), 50);
  near(resolveFps({ mode: 'sequence', max: 60 }, 59.94), 60000 / 1001);
  // 23.976 is within 0.5% of 24 → kept; 48 is far from all → nearest (50)
  near(resolveFps({ mode: 'sequence', allowed: [24, 25, 30, 50, 60] }, 23.976), 24000 / 1001);
  near(resolveFps({ mode: 'sequence', allowed: [24, 25, 30, 50, 60] }, 48), 50);
  near(resolveFps({ mode: 'fixed', fps: 29.97 }, 24), 30000 / 1001);
  assert.equal(fpsLabel(23.976), '23.976');
  assert.equal(fpsLabel(29.97), '29.97');
  assert.equal(fpsLabel(25), '25');
});

// ---------------- bitrate ----------------

test('bitrate follows the platform table, HFR, size and codec', () => {
  const yt = findPreset('yt-1080')!.settings.video.bitrate;
  assert.equal(resolveVideoKbps(yt, 1920, 1080, 30, 'avc'), 16000);
  assert.equal(resolveVideoKbps(yt, 1920, 1080, 60, 'avc'), 24000);
  assert.equal(resolveVideoKbps(yt, 1920, 1080, 24000 / 1001, 'avc'), 16000);
  assert.equal(resolveVideoKbps(yt, 1280, 720, 30, 'avc'), Math.round((16000 * 1280 * 720) / (1920 * 1080)));
  const yt4k = findPreset('yt-4k')!.settings.video.bitrate;
  assert.equal(resolveVideoKbps(yt4k, 3840, 2160, 30, 'hevc'), 45000);
  // X caps at 25 Mbps even at 60 fps (15 × 1.5 = 22.5 stays under)
  const x = findPreset('x-1080')!.settings.video.bitrate;
  assert.equal(resolveVideoKbps(x, 1920, 1080, 60, 'avc'), 22500);
  assert.equal(resolveVideoKbps({ ...x, hfrKbps: 40000 }, 1920, 1080, 60, 'avc'), 25000);
  // manual override wins
  assert.equal(resolveVideoKbps(yt, 1920, 1080, 30, 'avc', 5000), 5000);
  // master caps at 160 Mbps for UHD 60
  const master = findPreset('master-avc')!.settings.video.bitrate;
  assert.equal(resolveVideoKbps(master, 3840, 2160, 60, 'avc'), 160000);
});

test('size estimate: video, PCM, image sequence', () => {
  const yt = findPreset('yt-1080')!.settings;
  const bytes = estimateBytes({ settings: yt, duration: 60, frames: 1800, width: 1920, height: 1080, videoKbps: 16000, audioCodec: 'aac', hasAudio: true });
  const expected = ((16000 + 384) * 1000 * 60) / 8;
  assert.ok(bytes > expected && bytes < expected * 1.03, `${bytes} vs ${expected}`);
  // no audio in the sequence → video only
  const silent = estimateBytes({ settings: yt, duration: 60, frames: 1800, width: 1920, height: 1080, videoKbps: 16000, audioCodec: 'aac', hasAudio: false });
  assert.ok(silent < bytes);
  const wav = findPreset('audio-wav')!.settings;
  assert.equal(audioKbps(wav.audio, 'pcm-s24'), 2304);
  const wavBytes = estimateBytes({ settings: wav, duration: 10, frames: 0, width: 0, height: 0, videoKbps: 0, audioCodec: 'pcm-s24', hasAudio: true });
  near(wavBytes, 48000 * 2 * 3 * 10 + 4096, 1);
  const png = findPreset('png-sequence')!.settings;
  assert.ok(estimateBytes({ settings: png, duration: 1, frames: 24, width: 1920, height: 1080, videoKbps: 0, audioCodec: null, hasAudio: false }) > 24 * 1920 * 1080);
});

// ---------------- ranges ----------------

test('range: entire, in/out, custom, frame and errors', () => {
  assert.deepEqual(resolveRange({ mode: 'entire' }, seq(10)), { start: 0, end: 10 });
  assert.deepEqual(resolveRange({ mode: 'inout' }, seq(10, 30, { inPoint: 2, outPoint: 5 })), { start: 2, end: 5 });
  // only an in point: out defaults to the end
  assert.deepEqual(resolveRange({ mode: 'inout' }, seq(10, 30, { inPoint: 4 })), { start: 4, end: 10 });
  assert.throws(() => resolveRange({ mode: 'inout' }, seq(10)), ExportRangeError);
  // custom snaps to frames and clamps at 0
  const r = resolveRange({ mode: 'custom', start: -1, end: 1.01 }, seq(10, 25));
  assert.equal(r.start, 0);
  near(r.end, 1.0);
  assert.throws(() => resolveRange({ mode: 'custom', start: 5, end: 5 }, seq(10)), /empty/);
  assert.throws(() => resolveRange({ mode: 'entire' }, seq(0)), /empty/);
  const f = resolveRange({ mode: 'frame', time: 2.5 }, seq(10, 25));
  near(f.start, 2.5);
  near(f.end - f.start, 1 / 25);
  // a frame past the end clamps to the last frame
  const last = resolveRange({ mode: 'frame', time: 99 }, seq(10, 25));
  near(last.start, 10 - 1 / 25);
});

// ---------------- frame sampling ----------------

test('frame counts and times at the output rate', () => {
  assert.equal(frameCount({ start: 0, end: 10 }, 30), 300);
  assert.equal(frameCount({ start: 0, end: 10 }, 30000 / 1001), 300); // 299.7 → 300
  assert.equal(frameCount({ start: 1, end: 1 + 1001 / 30000 }, 30000 / 1001), 1);
  near(frameTime({ start: 2, end: 4 }, 24, 12), 2.5);
});

test('fps conversion samples the timeline at output times (24 → 30 gives a 3:2-style cadence)', () => {
  const range = { start: 0, end: 1 };
  const frames = Array.from({ length: frameCount(range, 30) }, (_, i) => sequenceFrameAt(frameTime(range, 30, i), 24));
  assert.equal(frames.length, 30);
  assert.deepEqual(frames.slice(0, 10), [0, 0, 1, 2, 3, 4, 4, 5, 6, 7]);
  // every source frame appears, none skipped
  assert.deepEqual([...new Set(frames)], Array.from({ length: 24 }, (_, i) => i));
  // 60 → 30 takes every other frame
  const down = Array.from({ length: 30 }, (_, i) => sequenceFrameAt(frameTime(range, 30, i), 60));
  assert.deepEqual(down.slice(0, 5), [0, 2, 4, 6, 8]);
  // 23.976 timeline sampled at 23.976 maps 1:1
  const ntsc = 24000 / 1001;
  const same = Array.from({ length: 48 }, (_, i) => sequenceFrameAt(frameTime({ start: 0, end: 2 }, ntsc, i), 23.976));
  assert.deepEqual(same, Array.from({ length: 48 }, (_, i) => i));
});

test('audio chunks cover the range exactly on the sample grid', () => {
  const total = sampleCount({ start: 1001 / 30000, end: 61 }, 48000);
  const chunks = audioChunks(total, 48000, 20);
  assert.equal(chunks[0].from, 0);
  assert.equal(chunks[chunks.length - 1].to, total);
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i].from, chunks[i - 1].to);
  assert.ok(chunks.every((c) => c.to - c.from <= 20 * 48000));
});

test('every built-in preset has a sane setup', () => {
  const ids = new Set<string>();
  for (const p of BUILTIN_PRESETS) {
    assert.ok(!ids.has(p.id), `duplicate ${p.id}`);
    ids.add(p.id);
    if (p.settings.kind === 'video') {
      assert.ok(p.settings.video.codecs.length > 0, p.id);
      assert.ok(p.settings.video.bitrate.kbps > 0, p.id);
      assert.ok(p.settings.video.keyframeInterval > 0, p.id);
    }
  }
  for (const id of ['yt-1080', 'yt-1440', 'yt-4k', 'yt-shorts', 'tiktok', 'ig-reels', 'ig-feed-4x5', 'ig-story', 'fb-landscape', 'x-1080', 'x-vertical', 'linkedin-1080', 'vimeo-1080', 'vimeo-4k', 'spotify-video', 'master-hevc', 'web-vp9', 'web-av1', 'audio-wav', 'podcast-aac', 'audio-flac', 'broadcast-ebu', 'png-sequence', 'png-still', 'handoff-edl', 'handoff-otio', 'handoff-fcpxml', 'handoff-srt', 'handoff-vtt', 'handoff-chapters'])
    assert.ok(ids.has(id), `missing preset ${id}`);
  assert.equal(findPreset('broadcast-ebu')!.settings.loudness.targetLufs, -23);
  assert.equal(findPreset('podcast-aac')!.settings.loudness.targetLufs, -16);
  assert.equal(findPreset('podcast-aac')!.settings.loudness.normalize, true);
  assert.equal(findPreset('spotify-video')!.settings.video.bitrateMode, 'cbr');
  assert.ok(!BUILTIN_PRESETS.some((p) => /hdr/i.test(p.id)), 'HDR is not possible from a canvas');
});
