import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CaptionCue } from '../../state/types';
import { parseXml } from '../interchange/xml';
import { detectCaptionFormat, extractSpeaker, formatSrtTime, formatVttTime, parseCaptions, parseCaptionsDetailed, parseCueTime, writeSrt, writeTtml, writeVtt } from './format';

const strip = (cues: CaptionCue[]) => cues.map(({ start, end, text, speaker }) => (speaker ? { start, end, text, speaker } : { start, end, text }));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('cue timestamps: separators, optional hours, colon milliseconds', () => {
  assert.equal(parseCueTime('00:00:01,500'), 1.5);
  assert.equal(parseCueTime('00:00:01.500'), 1.5);
  assert.equal(parseCueTime('01:02.250'), 62.25);
  assert.equal(parseCueTime('1:00:00.000'), 3600);
  assert.equal(parseCueTime('00:00:01:500'), 1.5);
  assert.equal(parseCueTime('00:01:02'), 62);
  assert.ok(near(parseCueTime('00:00:01,5')!, 1.5));
  assert.equal(parseCueTime('nope'), null);
  assert.equal(formatSrtTime(3723.456), '01:02:03,456');
  assert.equal(formatVttTime(0.0004), '00:00:00.000');
  assert.equal(formatVttTime(59.9996), '00:01:00.000');
});

test('SRT: the test-media file', () => {
  const srt = ['1', '00:00:00,500 --> 00:00:02,000', 'Welcome to Omega.', '', '2', '00:00:02,200 --> 00:00:04,500', 'Cinema-grade editing,\nwithout the subscription trap.', '', '3', '00:00:05,000 --> 00:00:06,000', 'Cut.', ''].join('\n');
  const cues = parseCaptions(srt, 'srt');
  assert.deepEqual(strip(cues), [
    { start: 0.5, end: 2, text: 'Welcome to Omega.' },
    { start: 2.2, end: 4.5, text: 'Cinema-grade editing,\nwithout the subscription trap.' },
    { start: 5, end: 6, text: 'Cut.' },
  ]);
  assert.ok(cues.every((c) => typeof c.id === 'string' && c.id.startsWith('cue_')));
});

test('SRT: BOM, CRLF, missing and garbled indices, dot milliseconds, tags', () => {
  const srt =
    '﻿1\r\n00:00:01,000 --> 00:00:02,000\r\n<i>Hello</i> <b>there</b>\r\n\r\n' +
    '00:00:03.000 --> 00:00:04.000\r\n{\\an8}<font color="#ff0000">Top line</font>\r\n\r\n' +
    '7b\r\n00:00:05,000 --> 00:00:06,250 X1:100 X2:200 Y1:10 Y2:20\r\nTom &amp; Jerry &lt;3\r\nsecond line\r\n';
  const cues = parseCaptions(srt, 'srt');
  assert.deepEqual(strip(cues), [
    { start: 1, end: 2, text: 'Hello there' },
    { start: 3, end: 4, text: 'Top line' },
    { start: 5, end: 6.25, text: 'Tom & Jerry <3\nsecond line' },
  ]);
});

test('SRT: missing blank line between cues and bare CR line endings', () => {
  const srt = '1\r00:00:01,000 --> 00:00:02,000\rOne\r2\r00:00:02,500 --> 00:00:03,000\rTwo\r00:00:04,000 --> 00:00:05,000\rThree';
  assert.deepEqual(
    parseCaptions(srt, 'srt').map((c) => c.text),
    ['One', 'Two', 'Three'],
  );
});

test('SRT: invalid timings and stray text are skipped with warnings', () => {
  const srt = 'garbage line\nmore garbage\n\n1\n00:00:05,000 --> 00:00:04,000\nBackwards\n\n2\n00:00:06,000 --> 00:00:07,000\nGood\n';
  const r = parseCaptionsDetailed(srt, 'srt');
  assert.deepEqual(
    r.cues.map((c) => c.text),
    ['Good'],
  );
  assert.equal(r.warnings.length, 2);
  assert.deepEqual(parseCaptions('', 'srt'), []);
  assert.deepEqual(parseCaptions('   \n\n', 'vtt'), []);
});

test('VTT: header, NOTE/STYLE/REGION blocks, identifiers, optional hours, cue settings, voices', () => {
  const vtt = [
    'WEBVTT - Some title',
    'X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000',
    '',
    'STYLE',
    '::cue { color: yellow }',
    '',
    'NOTE This is a comment',
    'that spans lines',
    '',
    'REGION',
    'id:fred width:40%',
    '',
    'intro',
    '00:01.000 --> 00:02.500 align:start position:10% line:0',
    '<v Roger Bingham>We are in New York City',
    '',
    '00:00:03,000 --> 00:00:04,000',
    '<c.yellow>Comma</c> <00:00:03.500>karaoke',
    '',
    '3',
    '00:05.000 --> 00:06.000',
    '- MARY: Ready?',
    '',
  ].join('\n');
  assert.equal(detectCaptionFormat(vtt), 'vtt');
  const cues = parseCaptions(vtt, 'vtt');
  assert.deepEqual(strip(cues), [
    { start: 1, end: 2.5, text: 'We are in New York City', speaker: 'Roger Bingham' },
    { start: 3, end: 4, text: 'Comma karaoke' },
    { start: 5, end: 6, text: 'Ready?', speaker: 'MARY' },
  ]);
});

test('speaker prefixes', () => {
  assert.deepEqual(extractSpeaker('[JOHN] Hello there'), { speaker: 'JOHN', text: 'Hello there' });
  assert.deepEqual(extractSpeaker('[Dr. Kim]\nWe begin.'), { speaker: 'Dr. Kim', text: 'We begin.' });
  assert.deepEqual(extractSpeaker('ANNA: Hi.\nHow are you?'), { speaker: 'ANNA', text: 'Hi.\nHow are you?' });
  assert.deepEqual(extractSpeaker('>> NARRATOR: Long ago'), { speaker: 'NARRATOR', text: 'Long ago' });
  assert.deepEqual(extractSpeaker('- JOHN: Wait!'), { speaker: 'JOHN', text: 'Wait!' });
  // Sound descriptions and plain dialogue dashes are not speakers.
  assert.deepEqual(extractSpeaker('[laughs] That is funny'), { text: '[laughs] That is funny' });
  assert.deepEqual(extractSpeaker('[MUSIC PLAYING]'), { text: '[MUSIC PLAYING]' });
  assert.deepEqual(extractSpeaker('- Are you coming?\n- Yes.'), { text: '- Are you coming?\n- Yes.' });
  assert.deepEqual(extractSpeaker('Note: lower case word'), { text: 'Note: lower case word' });
});

const sample: CaptionCue[] = [
  { id: 'a', start: 0.5, end: 2, text: 'Welcome to Omega.' },
  { id: 'b', start: 2.2, end: 4.5, text: 'Two lines\nof text', speaker: 'ANNA' },
  { id: 'c', start: 3661.001, end: 3662.999, text: 'Late cue' },
];

test('writeSrt exact format', () => {
  assert.equal(
    writeSrt(sample),
    '1\n00:00:00,500 --> 00:00:02,000\nWelcome to Omega.\n\n' +
      '2\n00:00:02,200 --> 00:00:04,500\n[ANNA] Two lines\nof text\n\n' +
      '3\n01:01:01,001 --> 01:01:02,999\nLate cue\n',
  );
  assert.equal(writeSrt([sample[0]], { eol: '\r\n' }), '1\r\n00:00:00,500 --> 00:00:02,000\r\nWelcome to Omega.\r\n');
  assert.equal(writeSrt([]), '');
});

test('writeVtt exact format and escaping', () => {
  assert.equal(
    writeVtt(sample),
    'WEBVTT\n\n' +
      '1\n00:00:00.500 --> 00:00:02.000\nWelcome to Omega.\n\n' +
      '2\n00:00:02.200 --> 00:00:04.500\n<v ANNA>Two lines\nof text\n\n' +
      '3\n01:01:01.001 --> 01:01:02.999\nLate cue\n',
  );
  const esc = writeVtt([{ id: 'x', start: 0, end: 1, text: 'a < b & c --> d' }]);
  assert.ok(esc.includes('a &lt; b &amp; c ‐‐&gt; d'));
  assert.equal(parseCaptions(esc, 'vtt')[0].text, 'a < b & c ‐‐> d');
  assert.equal(writeVtt([]), 'WEBVTT\n');
});

test('writers skip empty / invalid cues, sort, and collapse blank lines', () => {
  const out = writeSrt([
    { id: '1', start: 5, end: 6, text: 'Second' },
    { id: '2', start: 1, end: 2, text: 'First\n\n\nstill first' },
    { id: '3', start: 3, end: 3, text: 'zero length' },
    { id: '4', start: 4, end: 5, text: '   ' },
  ]);
  assert.equal(out, '1\n00:00:01,000 --> 00:00:02,000\nFirst\nstill first\n\n2\n00:00:05,000 --> 00:00:06,000\nSecond\n');
});

test('round trip SRT and VTT', () => {
  for (const [write, fmt] of [
    [writeSrt, 'srt'],
    [writeVtt, 'vtt'],
  ] as const) {
    const back = parseCaptions(write(sample), fmt);
    assert.deepEqual(strip(back), strip(sample), fmt);
  }
});

test('TTML is well-formed SMPTE-TT', () => {
  const xml = writeTtml(sample, { fps: 23.976, lang: 'en', title: 'A & B' });
  const root = parseXml(xml);
  assert.equal(root.name, 'tt');
  assert.equal(root.attrs['ttp:frameRate'], '24');
  assert.equal(root.attrs['ttp:frameRateMultiplier'], '1000 1001');
  const body = root.children.find((c) => c.name === 'body')!;
  const ps = body.children[0].children;
  assert.equal(ps.length, 3);
  assert.equal(ps[1].attrs.begin, '00:00:02.200');
  assert.equal(ps[1].children[0].name, 'br');
});
