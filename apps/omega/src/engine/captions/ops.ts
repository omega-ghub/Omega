// Pure caption-cue operations: timing fixes, line wrapping, splitting,
// merging and quality checks. OWNED BY THE CAPTIONS PACKAGE.
//
// Every function returns new cue objects and never mutates its input, so the
// results can be written into an immer draft or used in tests directly.

import type { CaptionCue } from '../../state/types';
import { newId } from '../../state/types';
import { EPS, fromFrames, toFrames } from '../time';

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface QualityRules {
  /** Reading speed limit, characters per second (line breaks not counted). */
  maxCps: number;
  maxCharsPerLine: number;
  maxLines: number;
  /** Seconds. 0.83 s = 20 frames at 24 fps (Netflix minimum). */
  minDuration: number;
  maxDuration: number;
}

export const DEFAULT_RULES: QualityRules = { maxCps: 20, maxCharsPerLine: 42, maxLines: 2, minDuration: 0.83, maxDuration: 7 };

export type CueIssueKind = 'cps' | 'lineLength' | 'lines' | 'short' | 'long' | 'overlap' | 'empty';

export interface CueIssue {
  kind: CueIssueKind;
  message: string;
}

export interface CueStats {
  duration: number;
  /** Characters excluding line breaks (spaces and punctuation count). */
  chars: number;
  /** Characters per second. */
  cps: number;
  lines: number;
  lineLengths: number[];
  maxLineLength: number;
}

/** Visible length of a string in code points (emoji and accents count once). */
export function textLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export function cueStats(cue: CaptionCue): CueStats {
  const lines = cue.text.split('\n').filter((l) => l.length > 0);
  const lineLengths = lines.map(textLength);
  const chars = lineLengths.reduce((a, b) => a + b, 0);
  const duration = Math.max(0, cue.end - cue.start);
  return {
    duration,
    chars,
    cps: duration > 0 ? chars / duration : chars > 0 ? Infinity : 0,
    lines: lines.length,
    lineLengths,
    maxLineLength: lineLengths.length ? Math.max(...lineLengths) : 0,
  };
}

/** Sorted copy (by start, then end). */
export function sortCues(cues: CaptionCue[]): CaptionCue[] {
  return cues.slice().sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Quality issues per cue id. Cues are checked in time order; overlaps are
 * reported on both cues.
 */
export function checkCues(cues: CaptionCue[], rules: Partial<QualityRules> = {}): Map<string, CueIssue[]> {
  const r = { ...DEFAULT_RULES, ...rules };
  const out = new Map<string, CueIssue[]>();
  const add = (id: string, issue: CueIssue) => {
    const list = out.get(id);
    if (list) {
      if (!list.some((x) => x.kind === issue.kind)) list.push(issue);
    } else out.set(id, [issue]);
  };
  const sorted = sortCues(cues);
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const s = cueStats(c);
    if (s.chars === 0) add(c.id, { kind: 'empty', message: 'Empty caption' });
    if (s.chars > 0 && s.cps > r.maxCps) add(c.id, { kind: 'cps', message: `Reading speed ${Number.isFinite(s.cps) ? s.cps.toFixed(1) : '∞'} cps (max ${r.maxCps})` });
    if (s.maxLineLength > r.maxCharsPerLine) add(c.id, { kind: 'lineLength', message: `Line of ${s.maxLineLength} characters (max ${r.maxCharsPerLine})` });
    if (s.lines > r.maxLines) add(c.id, { kind: 'lines', message: `${s.lines} lines (max ${r.maxLines})` });
    if (s.duration < r.minDuration - EPS) add(c.id, { kind: 'short', message: `Shown for ${s.duration.toFixed(2)} s (min ${r.minDuration} s)` });
    if (s.duration > r.maxDuration + EPS) add(c.id, { kind: 'long', message: `Shown for ${s.duration.toFixed(2)} s (max ${r.maxDuration} s)` });
    // Overlap with any later cue that starts before this one ends.
    for (let j = i + 1; j < sorted.length && sorted[j].start < c.end - EPS; j++) {
      add(c.id, { kind: 'overlap', message: 'Overlaps the next caption' });
      add(sorted[j].id, { kind: 'overlap', message: 'Overlaps the previous caption' });
    }
  }
  return out;
}

/** Number of cues with at least one issue. */
export function countIssues(issues: Map<string, CueIssue[]>): number {
  let n = 0;
  for (const v of issues.values()) if (v.length) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/** Index of the cue showing at time t in a start-sorted list, or -1. */
export function cueIndexAt(sorted: CaptionCue[], t: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  let found = -1;
  // last cue with start <= t
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].start <= t + EPS) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  // walk back over overlapping cues to find one that contains t
  for (let i = found; i >= 0 && i > found - 8; i--) {
    if (t >= sorted[i].start - EPS && t < sorted[i].end - EPS) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** Moves every cue by `delta` seconds; cues pushed entirely before 0 are dropped, partial ones clipped. */
export function shiftCues(cues: CaptionCue[], delta: number): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const c of cues) {
    const start = c.start + delta;
    const end = c.end + delta;
    if (end <= EPS) continue;
    out.push({ ...c, start: Math.max(0, start), end });
  }
  return out;
}

/** Rounds every edge to the frame grid; keeps each cue at least one frame long. */
export function snapCuesToFrames(cues: CaptionCue[], fps: number): CaptionCue[] {
  return cues.map((c) => {
    const s = Math.max(0, toFrames(c.start, fps));
    const e = Math.max(s + 1, toFrames(c.end, fps));
    return { ...c, start: fromFrames(s, fps), end: fromFrames(e, fps) };
  });
}

/**
 * Snaps to frames, then removes overlaps and enforces a minimum gap between
 * consecutive cues (default 2 frames) by pulling the earlier cue's out point
 * back. If that would leave it shorter than a frame, the later cue moves
 * instead. Returns cues in time order.
 */
export function fitCuesToGaps(cues: CaptionCue[], fps: number, minGapFrames = 2): CaptionCue[] {
  const f = sortCues(cues).map((c) => {
    const s = Math.max(0, toFrames(c.start, fps));
    return { cue: c, s, e: Math.max(s + 1, toFrames(c.end, fps)) };
  });
  for (let i = 0; i < f.length - 1; i++) {
    const cur = f[i];
    const next = f[i + 1];
    if (next.s - cur.e >= minGapFrames) continue;
    const newEnd = next.s - minGapFrames;
    if (newEnd - cur.s >= 1) {
      cur.e = newEnd;
    } else {
      cur.e = cur.s + 1;
      const shift = cur.e + minGapFrames - next.s;
      next.s += shift;
      next.e = Math.max(next.e, next.s + 1);
    }
  }
  return f.map(({ cue, s, e }) => ({ ...cue, start: fromFrames(s, fps), end: fromFrames(e, fps) }));
}

// ---------------------------------------------------------------------------
// Line wrapping
// ---------------------------------------------------------------------------

function greedyLines(words: string[], maxChars: number): number {
  let lines = 0;
  let len = -1;
  for (const w of words) {
    const wl = textLength(w);
    if (len >= 0 && len + 1 + wl <= maxChars) len += 1 + wl;
    else {
      lines++;
      len = wl;
    }
  }
  return lines;
}

/**
 * Wraps text into balanced lines of at most `maxChars` characters (words
 * longer than that get a line of their own). Uses the fewest lines a greedy
 * fill needs, then balances them: the longest line is minimized, breaks after
 * punctuation are preferred, and a bottom-heavy shape wins ties.
 */
export function wrapCaptionText(text: string, maxChars = 42): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const k = greedyLines(words, maxChars);
  if (k <= 1) return [words.join(' ')];
  const n = words.length;
  const wl = words.map(textLength);
  const lineLen = (a: number, b: number) => {
    // words a..b-1
    let s = b - a - 1;
    for (let i = a; i < b; i++) s += wl[i];
    return s;
  };
  // dp[j][i]: best cost splitting the first i words into j lines.
  type Cell = { max: number; sq: number; pen: number; prev: number };
  const INF: Cell = { max: Infinity, sq: Infinity, pen: Infinity, prev: -1 };
  const dp: Cell[][] = Array.from({ length: k + 1 }, () => Array.from({ length: n + 1 }, () => INF));
  dp[0][0] = { max: 0, sq: 0, pen: 0, prev: -1 };
  const better = (a: Cell, b: Cell) => (a.max !== b.max ? a.max < b.max : a.pen !== b.pen ? a.pen < b.pen : a.sq < b.sq);
  for (let j = 1; j <= k; j++) {
    for (let i = j; i <= n; i++) {
      for (let p = j - 1; p < i; p++) {
        const base = dp[j - 1][p];
        if (base.max === Infinity) continue;
        const len = lineLen(p, i);
        const over = len > maxChars && i - p > 1; // only single long words may overflow
        if (over) continue;
        // Prefer breaking after punctuation; mildly prefer a top line not longer than the next.
        const lastWord = words[i - 1];
        const punct = i < n && /[.,;:!?)\]]$/.test(lastWord) ? -1 : 0;
        const cell: Cell = {
          max: Math.max(base.max, len),
          sq: base.sq + len * len,
          pen: base.pen + punct + (j > 1 && len < lineLen(base.prev < 0 ? 0 : base.prev, p) ? 0.01 : 0),
          prev: p,
        };
        if (better(cell, dp[j][i])) dp[j][i] = cell;
      }
    }
  }
  if (dp[k][n].max === Infinity) return [words.join(' ')];
  const lines: string[] = [];
  let i = n;
  for (let j = k; j > 0; j--) {
    const p = dp[j][i].prev;
    lines.unshift(words.slice(p, i).join(' '));
    i = p;
  }
  return lines;
}

/**
 * Re-wraps long lines and splits cues that need more than `maxLines` lines
 * into consecutive cues. Time is shared in proportion to characters; each new
 * cue gets at least `minDuration` when the original is long enough (otherwise
 * fewer, fuller cues are made). With `fps`, new edges land on frames.
 */
export function splitLongCues(cues: CaptionCue[], maxCharsPerLine = 42, maxLines = 2, minDuration = DEFAULT_RULES.minDuration, fps?: number): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const cue of sortCues(cues)) {
    const lines = cue.text.split('\n').filter((l) => l.trim());
    const fits = lines.length <= maxLines && lines.every((l) => textLength(l) <= maxCharsPerLine);
    if (fits) {
      out.push({ ...cue });
      continue;
    }
    const words = cue.text.split(/\s+/).filter(Boolean);
    const wrapped = wrapCaptionText(cue.text, maxCharsPerLine);
    if (wrapped.length <= maxLines) {
      out.push({ ...cue, text: wrapped.join('\n') });
      continue;
    }
    const duration = cue.end - cue.start;
    let parts = Math.ceil(wrapped.length / maxLines);
    if (minDuration > 0 && duration / parts < minDuration) parts = Math.max(1, Math.floor(duration / minDuration));
    if (parts <= 1) {
      out.push({ ...cue, text: wrapped.join('\n') });
      continue;
    }
    const chunks = chunkWords(words, parts, maxCharsPerLine, maxLines);
    const total = chunks.reduce((a, c) => a + textLength(c.join(' ')), 0) || 1;
    let t = cue.start;
    chunks.forEach((chunk, idx) => {
      const text = wrapCaptionText(chunk.join(' '), maxCharsPerLine).join('\n');
      let end = idx === chunks.length - 1 ? cue.end : t + (duration * textLength(chunk.join(' '))) / total;
      if (fps && idx < chunks.length - 1) end = fromFrames(toFrames(end, fps), fps);
      const piece: CaptionCue = { id: idx === 0 ? cue.id : newId('cue'), start: t, end, text };
      if (cue.speaker) piece.speaker = cue.speaker;
      out.push(piece);
      t = end;
    });
  }
  return out;
}

/** Splits words into `parts` groups of similar length, preferring sentence and clause ends. */
function chunkWords(words: string[], parts: number, maxChars: number, maxLines: number): string[][] {
  const lens = words.map(textLength);
  const total = lens.reduce((a, b) => a + b, 0) + Math.max(0, words.length - 1);
  const cuts: number[] = [];
  let from = 1;
  for (let k = 1; k < parts; k++) {
    const target = (total * k) / parts;
    let best = -1;
    let bestScore = Infinity;
    let pos = 0;
    for (let i = 0; i < words.length - 1; i++) {
      pos += lens[i] + 1;
      if (i + 1 < from || i + 1 > words.length - (parts - k)) continue;
      const dist = Math.abs(pos - target) / Math.max(1, total / parts);
      const bonus = /[.!?]["')\]]?$/.test(words[i]) ? 0.45 : /[,;:]$/.test(words[i]) ? 0.25 : 0;
      const score = dist - bonus;
      if (score < bestScore) {
        bestScore = score;
        best = i + 1;
      }
    }
    if (best < 0) break;
    cuts.push(best);
    from = best + 1;
  }
  const chunks: string[][] = [];
  let a = 0;
  for (const c of cuts) {
    chunks.push(words.slice(a, c));
    a = c;
  }
  chunks.push(words.slice(a));
  // If a chunk still needs too many lines, fall back to greedy filling.
  if (chunks.some((c) => greedyLines(c, maxChars) > maxLines) && parts * maxLines >= greedyLines(words, maxChars)) {
    const greedy: string[][] = [];
    let cur: string[] = [];
    for (const w of words) {
      const trial = [...cur, w];
      if (cur.length && greedyLines(trial, maxChars) > maxLines) {
        greedy.push(cur);
        cur = [w];
      } else cur = trial;
    }
    if (cur.length) greedy.push(cur);
    if (greedy.length <= parts) return greedy;
  }
  return chunks.filter((c) => c.length);
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/**
 * Merges cues into one spanning all of them. Same (or no) speaker: text is
 * joined and re-wrapped. Different speakers: one dialogue line per cue ("- …").
 */
export function mergeCues(cues: CaptionCue[], maxCharsPerLine = 42): CaptionCue | null {
  if (!cues.length) return null;
  const s = sortCues(cues);
  const speakers = new Set(s.map((c) => c.speaker ?? ''));
  let text: string;
  let speaker: string | undefined;
  if (speakers.size > 1) {
    text = s
      .filter((c) => c.text.trim())
      .map((c) => `- ${c.speaker ? `${c.speaker}: ` : ''}${c.text.replace(/\s*\n\s*/g, ' ').trim()}`)
      .join('\n');
  } else {
    speaker = s[0].speaker;
    text = wrapCaptionText(
      s
        .map((c) => c.text.trim())
        .filter(Boolean)
        .join(' '),
      maxCharsPerLine,
    ).join('\n');
  }
  const merged: CaptionCue = { id: s[0].id, start: s[0].start, end: Math.max(...s.map((c) => c.end)), text };
  if (speaker) merged.speaker = speaker;
  return merged;
}

/**
 * Splits a cue at time t. The text divides at the line or word boundary
 * closest to the time ratio. Returns null if t is not strictly inside the cue
 * (by at least one frame on each side when fps is given).
 */
export function splitCueAt(cue: CaptionCue, t: number, fps?: number): [CaptionCue, CaptionCue] | null {
  const at = fps ? fromFrames(toFrames(t, fps), fps) : t;
  const minLen = fps ? 1 / fps - EPS : EPS;
  if (at - cue.start < minLen || cue.end - at < minLen) return null;
  const ratio = (at - cue.start) / (cue.end - cue.start);
  const lines = cue.text.split('\n').filter((l) => l.trim());
  let a = '';
  let b = '';
  if (lines.length >= 2) {
    const k = Math.min(lines.length - 1, Math.max(1, Math.round(lines.length * ratio)));
    a = lines.slice(0, k).join('\n');
    b = lines.slice(k).join('\n');
  } else {
    const words = cue.text.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const total = textLength(words.join(' '));
      let best = 1;
      let bestDist = Infinity;
      let pos = 0;
      for (let i = 0; i < words.length - 1; i++) {
        pos += textLength(words[i]) + (i ? 1 : 0);
        const d = Math.abs(pos / total - ratio);
        if (d < bestDist) {
          bestDist = d;
          best = i + 1;
        }
      }
      a = words.slice(0, best).join(' ');
      b = words.slice(best).join(' ');
    } else {
      a = cue.text;
    }
  }
  const first: CaptionCue = { ...cue, end: at, text: a };
  const second: CaptionCue = { id: newId('cue'), start: at, end: cue.end, text: b };
  if (cue.speaker) second.speaker = cue.speaker;
  return [first, second];
}

/**
 * A new empty cue at time t: two seconds long, or shorter so it ends
 * `gapFrames` before the next cue. Returns null when t is inside a cue or
 * there is less than a frame of room.
 */
export function newCueAt(cues: CaptionCue[], t: number, fps: number, duration = 2, gapFrames = 2): CaptionCue | null {
  const startF = Math.max(0, toFrames(t, fps));
  const start = fromFrames(startF, fps);
  if (cues.some((c) => start >= c.start - EPS && start < c.end - EPS)) return null;
  const next = sortCues(cues).find((c) => c.start > start + EPS);
  let endF = toFrames(start + duration, fps);
  if (next) endF = Math.min(endF, toFrames(next.start, fps) - gapFrames);
  if (endF - startF < 1) {
    if (next && toFrames(next.start, fps) - startF >= 1) endF = toFrames(next.start, fps);
    else if (!next) endF = startF + 1;
    else return null;
  }
  return { id: newId('cue'), start, end: fromFrames(endF, fps), text: '' };
}

export interface ReplaceOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

export function searchRegex(find: string, opts: ReplaceOptions = {}): RegExp | null {
  if (!find) return null;
  const esc = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(opts.wholeWord ? `(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])` : esc, opts.caseSensitive ? 'gu' : 'giu');
}

/** Cue ids whose text (or speaker) contains `find`. */
export function findInCues(cues: CaptionCue[], find: string, opts: ReplaceOptions = {}): string[] {
  const re = searchRegex(find, opts);
  if (!re) return [];
  const hit = (s: string | undefined) => {
    if (!s) return false;
    re.lastIndex = 0;
    return re.test(s);
  };
  return cues.filter((c) => hit(c.text) || hit(c.speaker)).map((c) => c.id);
}

/** Replaces every match in cue text. Returns new cues and the number of replacements. */
export function replaceInCues(cues: CaptionCue[], find: string, replace: string, opts: ReplaceOptions = {}): { cues: CaptionCue[]; count: number } {
  const re = searchRegex(find, opts);
  if (!re) return { cues, count: 0 };
  let count = 0;
  const out = cues.map((c) => {
    const text = c.text.replace(re, () => {
      count++;
      return replace;
    });
    return text === c.text ? c : { ...c, text };
  });
  return { cues: out, count };
}
