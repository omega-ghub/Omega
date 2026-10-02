import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  animPhases,
  breakLines,
  colorWithAlpha,
  cssFont,
  cssFontFamily,
  easeOutBack,
  gradientLine,
  revealCount,
  stackCaptionBlocks,
  textAnimState,
  wordAlpha,
} from './text';
import type { TextAnimation } from '../../state/types';

// Monospace measure: every character is 10px wide.
const mono = (s: string) => s.length * 10;

test('breakLines: no wrapping keeps hard breaks only', () => {
  assert.deepEqual(breakLines('Hello world\nSecond line', 0, mono), ['Hello world', 'Second line']);
  assert.deepEqual(breakLines('a\r\nb', 0, mono), ['a', 'b']);
  assert.deepEqual(breakLines('', 0, mono), ['']);
});

test('breakLines: greedy word wrap at maxWidth', () => {
  // 'the quick' = 90px, 'the quick brown' = 150px
  assert.deepEqual(breakLines('the quick brown fox jumps', 100, mono), ['the quick', 'brown fox', 'jumps']);
  assert.deepEqual(breakLines('one two', 70, mono), ['one two']);
  assert.deepEqual(breakLines('one two', 60, mono), ['one', 'two']);
});

test('breakLines: over-long words break by characters', () => {
  assert.deepEqual(breakLines('abcdefghij', 40, mono), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(breakLines('hi abcdefghij x', 40, mono), ['hi', 'abcd', 'efgh', 'ij x']);
});

test('breakLines: empty paragraphs survive wrapping', () => {
  assert.deepEqual(breakLines('a\n\nb', 100, mono), ['a', '', 'b']);
});

const anim = (p: Partial<TextAnimation>): TextAnimation => ({ in: 'none', out: 'none', inDuration: 1, outDuration: 1, ...p });

test('animPhases: in/out progress and fitting to short clips', () => {
  const a = animPhases(anim({ in: 'fade', out: 'fade' }), 0.5, 10);
  assert.equal(a.pin, 0.5);
  assert.equal(a.pout, 1);
  const b = animPhases(anim({ in: 'fade', out: 'fade' }), 9.75, 10);
  assert.equal(b.pin, 1);
  assert.equal(b.pout, 0.25);
  // 1s + 1s on a 1s clip: both scaled to 0.5s
  const c = animPhases(anim({ in: 'fade', out: 'fade' }), 0.25, 1);
  assert.equal(c.inDur, 0.5);
  assert.equal(c.outDur, 0.5);
  assert.equal(c.pin, 0.5);
  // 'none' means no phase
  const d = animPhases(anim({}), 0, 10);
  assert.equal(d.pin, 1);
  assert.equal(d.pout, 1);
});

test('textAnimState: fade in and out', () => {
  const a = anim({ in: 'fade', out: 'fade' });
  assert.equal(textAnimState(a, 0, 5, 100, 1080).opacity, 0);
  assert.equal(textAnimState(a, 2.5, 5, 100, 1080).opacity, 1);
  assert.ok(Math.abs(textAnimState(a, 0.5, 5, 100, 1080).opacity - 0.5) < 1e-9);
  assert.equal(textAnimState(a, 5, 5, 100, 1080).opacity, 0);
});

test('textAnimState: slides move toward their resting place', () => {
  const up = textAnimState(anim({ in: 'slideUp' }), 0, 5, 100, 1080);
  assert.ok(up.dy > 0, 'slide up starts below');
  assert.equal(textAnimState(anim({ in: 'slideUp' }), 1, 5, 100, 1080).dy, 0);
  assert.ok(textAnimState(anim({ in: 'slideDown' }), 0, 5, 100, 1080).dy < 0);
  assert.ok(textAnimState(anim({ in: 'slideLeft' }), 0, 5, 100, 1080).dx > 0);
  assert.ok(textAnimState(anim({ in: 'slideRight' }), 0, 5, 100, 1080).dx < 0);
  const outUp = textAnimState(anim({ out: 'slideUp' }), 4.9, 5, 100, 1080);
  assert.ok(outUp.dy < 0 && outUp.opacity < 1);
});

test('textAnimState: typewriter reveals progressively with a caret', () => {
  const a = anim({ in: 'typewriter', inDuration: 2 });
  const s = textAnimState(a, 1, 5, 100, 1080);
  assert.equal(s.reveal, 0.5);
  assert.equal(s.caret, true);
  const done = textAnimState(a, 3, 5, 100, 1080);
  assert.equal(done.reveal, null);
  assert.equal(done.caret, false);
  assert.equal(revealCount(0.5, 11), 5);
  assert.equal(revealCount(1, 11), 11);
  assert.equal(revealCount(0, 11), 0);
});

test('textAnimState: pop overshoots, blur and tracking settle to zero', () => {
  const a = anim({ in: 'pop', inDuration: 1 });
  const samples = [0.2, 0.4, 0.6, 0.8].map((t) => textAnimState(a, t, 5, 100, 1080).scale);
  assert.ok(Math.max(...samples) > 1, 'overshoot above 1');
  assert.equal(textAnimState(a, 1, 5, 100, 1080).scale, 1);
  assert.ok(easeOutBack(1) === 1);
  assert.ok(textAnimState(anim({ in: 'blur' }), 0.1, 5, 100, 1080).blur > 0);
  assert.equal(textAnimState(anim({ in: 'blur' }), 1, 5, 100, 1080).blur, 0);
  assert.ok(textAnimState(anim({ in: 'tracking' }), 0.1, 5, 100, 1080).letterSpacing > 0);
  assert.ok(textAnimState(anim({ out: 'tracking' }), 4.9, 5, 100, 1080).letterSpacing > 0);
});

test('wordAlpha: words appear in order and all are visible at the end', () => {
  const n = 5;
  assert.equal(wordAlpha(0, n, 0), 0);
  assert.ok(wordAlpha(0, n, 0.3) > wordAlpha(3, n, 0.3));
  for (let i = 0; i < n; i++) assert.equal(wordAlpha(i, n, 1), 1);
  assert.equal(textAnimState(anim({ in: 'wordByWord' }), 0.5, 5, 100, 1080).words, 0.5);
});

test('gradientLine follows CSS angle conventions', () => {
  const r = gradientLine(90, 200, 100); // to the right
  assert.ok(Math.abs(r.x0 - 0) < 1e-9 && Math.abs(r.x1 - 200) < 1e-9);
  assert.ok(Math.abs(r.y0 - 50) < 1e-9 && Math.abs(r.y1 - 50) < 1e-9);
  const t = gradientLine(0, 200, 100); // to the top
  assert.ok(Math.abs(t.y0 - 100) < 1e-9 && Math.abs(t.y1 - 0) < 1e-9);
});

test('stackCaptionBlocks: tracks at the same position never overlap', () => {
  const tops = stackCaptionBlocks(
    [
      { position: 'bottom', margin: 50, height: 100, gap: 10 },
      { position: 'bottom', margin: 50, height: 60, gap: 10 },
      { position: 'top', margin: 40, height: 50, gap: 10 },
      { position: 'top', margin: 40, height: 50, gap: 10 },
    ],
    1000,
  );
  assert.equal(tops[0], 850); // bottom edge at 950
  assert.equal(tops[1], 850 - 10 - 60);
  assert.equal(tops[2], 40);
  assert.equal(tops[3], 100);
  const mid = stackCaptionBlocks(
    [
      { position: 'middle', margin: 0, height: 100, gap: 20 },
      { position: 'middle', margin: 0, height: 100, gap: 20 },
    ],
    1000,
  );
  assert.equal(mid[0], 390);
  assert.equal(mid[1], 510);
});

test('font helpers quote families and clamp weights', () => {
  assert.equal(cssFontFamily('Inter Variable, Inter, system-ui, sans-serif'), '"Inter Variable", "Inter", system-ui, sans-serif');
  assert.equal(cssFontFamily(''), 'sans-serif');
  assert.equal(cssFont({ italic: true, weight: 650.4, size: 48, font: 'Georgia' }), 'italic 650 48px "Georgia"');
  assert.equal(colorWithAlpha('#ff000080', 0.5), 'rgba(255,0,0,0.251)');
  assert.equal(colorWithAlpha('#fff', 1), 'rgba(255,255,255,1)');
});
