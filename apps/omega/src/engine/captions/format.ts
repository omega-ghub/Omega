// Caption files: SRT / WebVTT parsing and writing, plus a SMPTE-TT (TTML)
// writer for broadcast deliverables. OWNED BY THE CAPTIONS PACKAGE.
//
// The parser is deliberately forgiving because caption files in the wild are
// messy: BOMs, CRLF or bare CR line endings, missing or garbled cue numbers,
// ',' or '.' millisecond separators (either format), optional hours, cue
// settings after the timing, NOTE / STYLE / REGION blocks, inline markup
// (<b>, <i>, <font>, <c.x>, <v Name>, karaoke timestamps, {\an8} ASS tags) and
// HTML entities. Cue text keeps its line breaks. Speaker labels at the start of
// a cue ("[NAME] …", "NAME: …", "- NAME: …", ">> NAME: …", <v NAME>) move to
// `cue.speaker`; writers put them back ("[NAME] " in SRT, <v NAME> in VTT).

import type { CaptionCue } from '../../state/types';
import { newId } from '../../state/types';

export type CaptionFormat = 'srt' | 'vtt';

export interface ParseResult {
  cues: CaptionCue[];
  /** Human-readable notes about lines that were skipped or repaired. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

/** One timestamp: [hh:]mm:ss[,.:]fff (also tolerates a missing fraction). */
const TS = String.raw`(?:\d+:)?\d{1,2}:\d{1,2}(?:[,.:]\d{1,3})?`;
const TIMING_RE = new RegExp(String.raw`^\s*(${TS})\s*-{1,2}>\s*(${TS})(.*)$`);

/**
 * Parses an SRT / VTT timestamp to seconds. Accepts "01:02:03,456",
 * "02:03.456", "1:02:03.4" (fraction digits are decimal places),
 * "00:00:01:500" (colon before milliseconds) and "00:01:02".
 */
export function parseCueTime(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  let frac = 0;
  let body = s;
  const m = /^(.*?)[,.](\d{1,3})$/.exec(s);
  if (m) {
    body = m[1];
    frac = Number(`0.${m[2]}`);
  }
  const parts = body.split(':').map((p) => (p === '' ? NaN : Number(p)));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  let h = 0;
  let mi = 0;
  let se = 0;
  if (parts.length === 4 && !m) {
    // hh:mm:ss:fff (colon before milliseconds, seen in broken exports)
    [h, mi, se] = parts;
    frac = Number(`0.${String(parts[3]).padStart(3, '0').slice(0, 3)}`);
  } else if (parts.length === 3) [h, mi, se] = parts;
  else if (parts.length === 2) [mi, se] = parts;
  else if (parts.length === 1) se = parts[0];
  else return null;
  return h * 3600 + mi * 60 + se + frac;
}

function splitMs(seconds: number): { h: number; m: number; s: number; ms: number } {
  const total = Math.max(0, Math.round(seconds * 1000));
  return {
    h: Math.floor(total / 3_600_000),
    m: Math.floor(total / 60_000) % 60,
    s: Math.floor(total / 1000) % 60,
    ms: total % 1000,
  };
}

const p2 = (n: number) => String(n).padStart(2, '0');
const p3 = (n: number) => String(n).padStart(3, '0');

/** "00:01:02,345" */
export function formatSrtTime(seconds: number): string {
  const { h, m, s, ms } = splitMs(seconds);
  return `${p2(h)}:${p2(m)}:${p2(s)},${p3(ms)}`;
}

/** "00:01:02.345" (hours always written; valid WebVTT). */
export function formatVttTime(seconds: number): string {
  const { h, m, s, ms } = splitMs(seconds);
  return `${p2(h)}:${p2(m)}:${p2(s)}.${p3(ms)}`;
}

// ---------------------------------------------------------------------------
// Text cleanup
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  lrm: '‎',
  rlm: '‏',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  shy: '',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    const v = NAMED_ENTITIES[body.toLowerCase()];
    return v === undefined ? all : v;
  });
}

/**
 * Strips markup from one cue's raw text. Returns the plain text and the first
 * WebVTT voice (<v Name>) if any.
 */
function stripMarkup(raw: string): { text: string; voice?: string } {
  let voice: string | undefined;
  let s = raw
    // ASS / SSA override blocks: {\an8}, {\i1}, {\pos(10,20)}
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\\N/g, '\n')
    .replace(/\\h/g, ' ');
  s = s.replace(/<v(?:\.[\w.-]+)?\s+([^>]*)>/gi, (_all, name: string) => {
    if (!voice && name.trim()) voice = name.trim();
    return '';
  });
  // Any other tag: <b>, </i>, <font color="…">, <c.yellow>, <00:00:01.000>, <ruby>, <rt>, <lang en>
  s = s.replace(/<\/?[a-z0-9][^<>]*>|<\d[\d:.]*>/gi, '');
  s = decodeEntities(s);
  const lines = s
    .split('\n')
    .map((l) => l.replace(/[\t ]+/g, ' ').trim())
    .filter((l) => l.length > 0);
  return { text: lines.join('\n'), voice };
}

const SPEAKER_BRACKET = /^(?:-|–|—|>>)?\s*\[([^\]\n]{1,40})\]\s*(.*)$/;
const SPEAKER_COLON = /^(?:-|–|—|>>)?\s*([A-Z][A-Z0-9 .'&-]{0,30}[A-Z0-9.]|[A-Z]):\s+(.*)$/;

/**
 * Detects a speaker label at the start of a cue. "[laughs] …" (an all-lower-case
 * sound description) is not a speaker; "[JOHN] …", "[Dr. Kim] …", "JOHN: …",
 * "- JOHN: …" and ">> ANNA: …" are.
 */
export function extractSpeaker(text: string): { speaker?: string; text: string } {
  const nl = text.indexOf('\n');
  const first = nl < 0 ? text : text.slice(0, nl);
  const rest = nl < 0 ? '' : text.slice(nl);
  const b = SPEAKER_BRACKET.exec(first);
  if (b) {
    const name = b[1].trim();
    const body = b[2].trim();
    const isSound = name === name.toLowerCase() || /^(music|applause|laughter|silence|inaudible|indistinct|crosstalk)\b/i.test(name);
    if (!isSound && (body || rest.trim())) {
      return { speaker: name, text: (body + rest).replace(/^\n/, '').trim() };
    }
  }
  const c = SPEAKER_COLON.exec(first);
  if (c && /[A-Z]/.test(c[1]) && c[2].trim()) {
    return { speaker: c[1].trim(), text: (c[2].trim() + rest).trim() };
  }
  return { text };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Guesses the format from the content (and optionally the file name). */
export function detectCaptionFormat(text: string, fileName?: string): CaptionFormat {
  const head = text.replace(/^﻿/, '').trimStart();
  if (/^WEBVTT/.test(head)) return 'vtt';
  if (fileName && /\.vtt$/i.test(fileName)) return 'vtt';
  return 'srt';
}

/** Full parse with warnings. `format` only affects header handling; both syntaxes are accepted. */
export function parseCaptionsDetailed(text: string, format: CaptionFormat = 'srt'): ParseResult {
  const warnings: string[] = [];
  const src = String(text ?? '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const out: CaptionCue[] = [];
  let i = 0;
  let skippedBlocks = 0;
  let badTimings = 0;
  const isVtt = format === 'vtt' || /^\s*WEBVTT/.test(src);

  const skipBlock = () => {
    while (i < lines.length && lines[i].trim() !== '') i++;
  };

  // WebVTT header block (WEBVTT line plus header metadata such as X-TIMESTAMP-MAP).
  if (isVtt) {
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i < lines.length && /^\s*WEBVTT/.test(lines[i])) skipBlock();
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') {
      i++;
      continue;
    }
    // VTT non-cue blocks.
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(trimmed) && !TIMING_RE.test(trimmed)) {
      skipBlock();
      continue;
    }
    const timing = TIMING_RE.exec(line);
    if (!timing) {
      // Identifier / index line: only meaningful if the next line is a timing line.
      const next = lines[i + 1];
      if (next !== undefined && TIMING_RE.test(next)) {
        i++;
        continue;
      }
      // Stray text with no timing (garbled file): skip the block.
      skippedBlocks++;
      skipBlock();
      continue;
    }
    const start = parseCueTime(timing[1]);
    const end = parseCueTime(timing[2]);
    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      // Missing blank line between cues: a timing line (optionally preceded by an index) starts the next cue.
      if (TIMING_RE.test(lines[i])) break;
      if (/^\s*\d+\s*$/.test(lines[i]) && lines[i + 1] !== undefined && TIMING_RE.test(lines[i + 1])) break;
      textLines.push(lines[i]);
      i++;
    }
    if (start === null || end === null || !(end > start)) {
      badTimings++;
      continue;
    }
    const { text: plain, voice } = stripMarkup(textLines.join('\n'));
    if (!plain) continue;
    let speaker = voice;
    let body = plain;
    if (!speaker) {
      const sp = extractSpeaker(plain);
      speaker = sp.speaker;
      body = sp.text;
    }
    const cue: CaptionCue = { id: newId('cue'), start, end, text: body };
    if (speaker) cue.speaker = speaker;
    out.push(cue);
  }

  if (skippedBlocks) warnings.push(`${skippedBlocks} block${skippedBlocks === 1 ? '' : 's'} without a timing line skipped`);
  if (badTimings) warnings.push(`${badTimings} cue${badTimings === 1 ? '' : 's'} with an invalid time range skipped`);
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return { cues: out, warnings };
}

/** Parses SRT or WebVTT text into cues (sorted by start). Never throws. */
export function parseCaptions(text: string, format: 'srt' | 'vtt'): CaptionCue[] {
  return parseCaptionsDetailed(text, format).cues;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface WriteOptions {
  /** Line ending; default '\n'. Some broadcast tools want '\r\n'. */
  eol?: '\n' | '\r\n';
  /** Include speaker labels (default true). */
  speakers?: boolean;
}

function cleanCueText(text: string): string {
  // A blank line would end the cue early; collapse it.
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0)
    .join('\n');
}

function sortedValid(cues: CaptionCue[]): CaptionCue[] {
  return cues
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start && cleanCueText(c.text).length > 0)
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/** SubRip (.srt). */
export function writeSrt(cues: CaptionCue[], opts: WriteOptions = {}): string {
  const eol = opts.eol ?? '\n';
  const blocks = sortedValid(cues).map((c, i) => {
    let text = cleanCueText(c.text);
    if (c.speaker && opts.speakers !== false) text = `[${c.speaker}] ${text}`;
    return [String(i + 1), `${formatSrtTime(c.start)} --> ${formatSrtTime(Math.max(c.end, c.start + 0.001))}`, ...text.split('\n')].join(eol);
  });
  return blocks.length ? blocks.join(eol + eol) + eol : '';
}

function escapeVtt(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** WebVTT (.vtt). Speakers become voice spans (<v Name>). */
export function writeVtt(cues: CaptionCue[], opts: WriteOptions = {}): string {
  const eol = opts.eol ?? '\n';
  const blocks = sortedValid(cues).map((c, i) => {
    // "-->" may not appear in cue text.
    let text = escapeVtt(cleanCueText(c.text)).replace(/--&gt;/g, '‐‐&gt;');
    if (c.speaker && opts.speakers !== false) text = `<v ${escapeVtt(c.speaker).replace(/[\n\r]/g, ' ')}>${text}`;
    return [String(i + 1), `${formatVttTime(c.start)} --> ${formatVttTime(Math.max(c.end, c.start + 0.001))}`, ...text.split('\n')].join(eol);
  });
  return ['WEBVTT', ...blocks].join(eol + eol) + eol;
}

export interface TtmlOptions {
  /** Sequence frame rate (used for ttp:frameRate and frame-exact times). */
  fps?: number;
  /** BCP-47 language tag (default 'en'). */
  lang?: string;
  title?: string;
  /** Region for all cues (default 'bottom'). */
  position?: 'bottom' | 'top' | 'middle';
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * SMPTE-TT / TTML1 (IMSC1 text-profile compatible) document. Times are
 * media-time clock values with milliseconds, which every TTML reader
 * accepts; ttp:frameRate is declared so frame-based tools can conform them.
 */
export function writeTtml(cues: CaptionCue[], opts: TtmlOptions = {}): string {
  const fps = opts.fps ?? 25;
  const nominal = Math.round(fps);
  const ntsc = Math.abs(fps - nominal) > 0.001;
  const lang = opts.lang ?? 'en';
  const regionId = opts.position ?? 'bottom';
  const region =
    regionId === 'top'
      ? '<region xml:id="top" tts:origin="10% 5%" tts:extent="80% 20%" tts:displayAlign="before" tts:textAlign="center"/>'
      : regionId === 'middle'
        ? '<region xml:id="middle" tts:origin="10% 40%" tts:extent="80% 20%" tts:displayAlign="center" tts:textAlign="center"/>'
        : '<region xml:id="bottom" tts:origin="10% 75%" tts:extent="80% 20%" tts:displayAlign="after" tts:textAlign="center"/>';
  const ps = sortedValid(cues).map((c) => {
    let text = cleanCueText(c.text);
    if (c.speaker) text = `[${c.speaker}] ${text}`;
    const body = text.split('\n').map(xmlEscape).join('<br/>');
    return `      <p begin="${formatVttTime(c.start)}" end="${formatVttTime(c.end)}">${body}</p>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:smpte="http://www.smpte-ra.org/schemas/2052-1/2010/smpte-tt" xml:lang="${xmlEscape(lang)}" ttp:timeBase="media" ttp:frameRate="${nominal}"${ntsc ? ' ttp:frameRateMultiplier="1000 1001"' : ''}>`,
    '  <head>',
    '    <metadata>',
    `      <ttm:title>${xmlEscape(opts.title ?? 'Captions')}</ttm:title>`,
    '    </metadata>',
    '    <styling>',
    '      <style xml:id="base" tts:fontFamily="proportionalSansSerif" tts:fontSize="100%" tts:color="white" tts:backgroundColor="transparent" tts:textAlign="center"/>',
    '    </styling>',
    '    <layout>',
    `      ${region}`,
    '    </layout>',
    '  </head>',
    `  <body style="base" region="${regionId}">`,
    '    <div>',
    ...ps,
    '    </div>',
    '  </body>',
    '</tt>',
    '',
  ].join('\n');
}
