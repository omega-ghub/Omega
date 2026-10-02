import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTimecode, parseTimecode, snapToFrame, toFrames } from './time';

test('non-drop timecode at 24 fps', () => {
  assert.equal(formatTimecode(3661.5, 24), '01:01:01:12');
});
test('drop-frame skips ;00 and ;01 at minute 1', () => {
  // 1800 frames at 29.97 → 00:01:00;02
  assert.equal(formatTimecode(1800 / (30000 / 1001), 29.97, true), '00:01:00;02');
  // 17982 frames = 10 minutes exactly in DF
  assert.equal(formatTimecode(17982 / (30000 / 1001), 29.97, true), '00:10:00;00');
});
test('parse round-trips', () => {
  for (const fps of [23.976, 24, 25, 29.97, 59.94]) {
    for (const s of [0, 1.5, 61.25, 3599.9]) {
      const tc = formatTimecode(s, fps, false);
      const back = parseTimecode(tc, fps);
      assert.ok(back !== null && Math.abs(toFrames(back, fps) - toFrames(s, fps)) <= 0, `${fps} ${s} ${tc}`);
    }
  }
});
test('snap to 23.976 grid', () => {
  const f = snapToFrame(1.0, 23.976);
  assert.equal(toFrames(f, 23.976), 24);
});
