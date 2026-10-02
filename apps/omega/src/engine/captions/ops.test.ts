import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CaptionCue } from '../../state/types';
import { fromFrames, toFrames } from '../time';
import {
  checkCues,
  countIssues,
  cueIndexAt,
  cueStats,
  findInCues,
  fitCuesToGaps,
  mergeCues,
  newCueAt,
  replaceInCues,
  shiftCues,
  snapCuesToFrames,
  splitCueAt,
  splitLongCues,
  textLength,
  wrapCaptionText,
} from './ops';
import { CAPTION_PRESETS, joinAlpha, splitAlpha } from './presets';

const cue = (id: string, start: number, end: number, text = id, speaker?: string): CaptionCue => (speaker ? { id, start, end, text, speaker } : { id, start, end, text });

test('cueStats counts characters without line breaks', () => {
  const s = cueStats(cue('a', 1, 3, 'Hello\nworld!'));
  assert.equal(s.chars, 11);
  assert.equal(s.cps, 5.5);
  assert.equal(s.lines, 2);
  assert.deepEqual(s.lineLengths, [5, 6]);
  assert.equal(s.maxLineLength, 6);
  assert.equal(textLength('héllo 👋'), 7);
});

test('checkCues flags every rule', () => {
  const cues = [
    cue('fast', 0, 1, 'This line is far too much to read in one second'),
    cue('wide', 2, 6, 'This single line is definitely longer than forty-two characters'),
    cue('tall', 7, 11, 'one\ntwo\nthree'),
    cue('short', 12, 12.5, 'Hi'),
    cue('long', 13, 21, 'Lingering'),
    cue('o1', 22, 24, 'Overlap A'),
    cue('o2', 23.5, 25, 'Overlap B'),
    cue('ok', 30, 32, 'Fine.'),
  ];
  const issues = checkCues(cues);
  const kinds = (id: string) => (issues.get(id) ?? []).map((i) => i.kind).sort();
  assert.deepEqual(kinds('fast'), ['cps', 'lineLength']);
  assert.deepEqual(kinds('wide'), ['lineLength']);
  assert.deepEqual(kinds('tall'), ['lines']);
  assert.deepEqual(kinds('short'), ['short']);
  assert.deepEqual(kinds('long'), ['long']);
  assert.deepEqual(kinds('o1'), ['overlap']);
  assert.deepEqual(kinds('o2'), ['overlap']);
  assert.deepEqual(kinds('ok'), []);
  assert.equal(countIssues(issues), 7);
  assert.ok(issues.get('fast')![0].message.includes('cps'));
});

test('cueIndexAt finds the active cue', () => {
  const cues = [cue('a', 0, 1), cue('b', 1, 2), cue('c', 3, 4)];
  assert.equal(cueIndexAt(cues, 0), 0);
  assert.equal(cueIndexAt(cues, 1), 1);
  assert.equal(cueIndexAt(cues, 2.5), -1);
  assert.equal(cueIndexAt(cues, 3.99), 2);
  assert.equal(cueIndexAt(cues, 4), -1);
  assert.equal(cueIndexAt([], 1), -1);
});

test('shiftCues moves, clips and drops', () => {
  const out = shiftCues([cue('a', 0, 1), cue('b', 1, 3), cue('c', 5, 6)], -2);
  assert.deepEqual(
    out.map((c) => [c.id, c.start, c.end]),
    [
      ['b', 0, 1],
      ['c', 3, 4],
    ],
  );
  assert.deepEqual(shiftCues([cue('a', 1, 2)], 10)[0].start, 11);
});

test('snapCuesToFrames lands every edge on the 23.976 grid', () => {
  const out = snapCuesToFrames([cue('a', 0.51, 2.003), cue('b', 4, 4.001)], 23.976);
  for (const c of out) {
    const s = c.start * (24000 / 1001);
    const e = c.end * (24000 / 1001);
    assert.ok(Math.abs(s - Math.round(s)) < 1e-6 && Math.abs(e - Math.round(e)) < 1e-6);
    assert.ok(c.end > c.start);
  }
  assert.equal(toFrames(out[1].end, 23.976) - toFrames(out[1].start, 23.976), 1);
});

test('fitCuesToGaps removes overlaps and keeps a 2-frame gap', () => {
  const fps = 25;
  const out = fitCuesToGaps([cue('b', 1.9, 3), cue('a', 0, 2), cue('c', 3, 4), cue('d', 3.02, 3.04)], fps);
  assert.deepEqual(
    out.map((c) => c.id),
    ['a', 'b', 'c', 'd'],
  );
  for (let i = 0; i < out.length - 1; i++) {
    const gap = toFrames(out[i + 1].start, fps) - toFrames(out[i].end, fps);
    assert.ok(gap >= 2, `gap ${i} = ${gap}`);
    assert.ok(out[i].end > out[i].start);
  }
  // a was pulled back to 2 frames before b
  assert.equal(toFrames(out[0].end, fps), toFrames(1.9, fps) - 2);
});

test('wrapCaptionText balances lines and respects the limit', () => {
  const lines = wrapCaptionText('The quick brown fox jumps over the lazy dog and keeps on running far away', 42);
  assert.equal(lines.length, 2);
  for (const l of lines) assert.ok(l.length <= 42, l);
  assert.ok(Math.abs(lines[0].length - lines[1].length) <= 10);
  assert.deepEqual(wrapCaptionText('Short one', 42), ['Short one']);
  assert.deepEqual(wrapCaptionText('', 42), []);
  // break after a comma when it doesn't make the longest line longer
  assert.deepEqual(wrapCaptionText('Well, I suppose we could try again tomorrow morning', 30), ['Well, I suppose we could', 'try again tomorrow morning']);
});

test('splitLongCues rewraps and splits into readable cues', () => {
  const long = 'This is a very long caption that somebody pasted from a transcript. It goes on and on, well past what two lines of forty-two characters can hold on screen.';
  const out = splitLongCues([cue('x', 10, 22, long, 'ANNA')], 42, 2, 0.83, 25);
  assert.ok(out.length >= 2);
  assert.equal(out[0].id, 'x');
  assert.equal(out[0].start, 10);
  assert.equal(out[out.length - 1].end, 22);
  for (let i = 0; i < out.length; i++) {
    const lines = out[i].text.split('\n');
    assert.ok(lines.length <= 2, out[i].text);
    for (const l of lines) assert.ok(l.length <= 42, l);
    assert.ok(out[i].end - out[i].start >= 0.83);
    assert.equal(out[i].speaker, 'ANNA');
    if (i) assert.equal(out[i].start, out[i - 1].end);
  }
  assert.equal(out.map((c) => c.text.replace(/\n/g, ' ')).join(' '), long);
  // A cue that already fits is untouched; a short one that is too long only gets fewer splits.
  assert.deepEqual(splitLongCues([cue('ok', 0, 2, 'Fine\nlines')]), [cue('ok', 0, 2, 'Fine\nlines')]);
  const tight = splitLongCues([cue('t', 0, 1, long)], 42, 2, 0.83);
  assert.equal(tight.length, 1);
});

test('mergeCues joins text or builds dialogue', () => {
  const same = mergeCues([cue('b', 2, 3, 'over the lazy dog.'), cue('a', 0, 1.5, 'The quick brown fox jumps')]);
  // 44 characters: re-wrapped into a balanced, bottom-heavy pair of lines.
  assert.deepEqual(same, { id: 'a', start: 0, end: 3, text: 'The quick brown fox\njumps over the lazy dog.' });
  assert.equal(mergeCues([cue('a', 0, 1, 'Short'), cue('b', 1, 2, 'and sweet.')])!.text, 'Short and sweet.');
  const dialog = mergeCues([cue('a', 0, 1, 'Ready?', 'ANNA'), cue('b', 1, 2, 'Go.', 'BEN')]);
  assert.equal(dialog!.text, '- ANNA: Ready?\n- BEN: Go.');
  assert.equal(dialog!.speaker, undefined);
  assert.equal(mergeCues([]), null);
});

test('splitCueAt divides time and text', () => {
  const [a, b] = splitCueAt(cue('x', 0, 4, 'one two three four'), 2)!;
  assert.deepEqual([a.start, a.end, a.text], [0, 2, 'one two']);
  assert.deepEqual([b.start, b.end, b.text], [2, 4, 'three four']);
  assert.notEqual(b.id, 'x');
  const [c, d] = splitCueAt(cue('y', 0, 4, 'Line one\nLine two', 'ANNA'), 1)!;
  assert.equal(c.text, 'Line one');
  assert.equal(d.text, 'Line two');
  assert.equal(d.speaker, 'ANNA');
  assert.equal(splitCueAt(cue('z', 0, 4), 0), null);
  assert.equal(splitCueAt(cue('z', 0, 4), 4.01), null);
  assert.equal(splitCueAt(cue('z', 0, 1), 0.01, 25), null);
});

test('newCueAt: 2 s, or up to 2 frames before the next cue', () => {
  const fps = 25;
  const a = newCueAt([], 1, fps)!;
  assert.deepEqual([a.start, a.end, a.text], [1, 3, '']);
  const b = newCueAt([cue('n', 2, 3)], 1, fps)!;
  assert.equal(toFrames(b.end, fps), toFrames(2, fps) - 2);
  assert.equal(newCueAt([cue('n', 0, 3)], 1, fps), null);
  // too little room for the gap: run up to the next cue
  const c = newCueAt([cue('n', fromFrames(26, fps), 3)], 1, fps)!;
  assert.equal(toFrames(c.end, fps), 26);
});

test('search and replace', () => {
  const cues = [cue('a', 0, 1, 'The cat sat.'), cue('b', 1, 2, 'Concatenate CAT', 'Cathy'), cue('c', 2, 3, 'dog')];
  assert.deepEqual(findInCues(cues, 'cat'), ['a', 'b']);
  assert.deepEqual(findInCues(cues, 'cat', { wholeWord: true }), ['a', 'b']);
  assert.deepEqual(findInCues(cues, 'cat', { wholeWord: true, caseSensitive: true }), ['a']);
  const r = replaceInCues(cues, 'cat', 'dog', { wholeWord: true });
  assert.equal(r.count, 2);
  assert.deepEqual(
    r.cues.map((c) => c.text),
    ['The dog sat.', 'Concatenate dog', 'dog'],
  );
  assert.equal(r.cues[2], cues[2]);
  assert.equal(replaceInCues(cues, '', 'x').count, 0);
  assert.equal(replaceInCues(cues, '.', '!').count, 1);
});

test('presets scale with the frame and alpha helpers round-trip', () => {
  const yt = CAPTION_PRESETS.find((p) => p.id === 'youtube')!.style(1920, 1080);
  assert.equal(yt.background, '#000000bf');
  const hd = CAPTION_PRESETS.find((p) => p.id === 'social')!.style(1920, 1080);
  const uhd = CAPTION_PRESETS.find((p) => p.id === 'social')!.style(3840, 2160);
  assert.equal(uhd.size, hd.size * 2);
  assert.equal(hd.position, 'middle');
  assert.deepEqual(splitAlpha('#000000bf'), { color: '#000000', alpha: 191 / 255 });
  assert.deepEqual(splitAlpha(''), { color: '#000000', alpha: 0 });
  assert.equal(joinAlpha('#000000', 0.75), '#000000bf');
  assert.equal(joinAlpha('#FFFFFF', 1), '#ffffff');
  assert.equal(joinAlpha('#ffffff', 0), '');
});
