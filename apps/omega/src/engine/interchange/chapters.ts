// YouTube chapter list from chapter markers. OWNED BY THE CAPTIONS/INTERCHANGE PACKAGE.
//
// YouTube's rules: the first timestamp must be 0:00, there must be at least
// three chapters, and each chapter must last at least 10 seconds. The writer
// repairs what it can (moves an early first chapter to 0:00 or inserts an
// "Intro", drops chapters that are too close together or too close to the
// end) and reports every repair as a warning.

import type { Sequence } from '../../state/types';
import { sequenceDuration } from '../../state/types';

export interface Chapter {
  time: number; // whole seconds
  title: string;
}

export interface ChaptersResult {
  text: string;
  chapters: Chapter[];
  warnings: string[];
}

export interface ChapterOptions {
  /** Minimum chapter length in seconds (YouTube: 10). */
  minLength?: number;
  /** Title for an inserted first chapter (default 'Intro'). */
  introTitle?: string;
  /** Timeline time that becomes 0:00 (e.g. the export in point). Default 0. */
  offset?: number;
  /** Video length in seconds; defaults to the sequence duration. */
  duration?: number;
}

function stamp(seconds: number, long: boolean): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return long ? `${h}:${p(m)}:${p(sec)}` : `${p(Math.floor(s / 60))}:${p(sec)}`;
}

/** Chapters with repairs and warnings. */
export function exportChaptersDetailed(seq: Sequence, opts: ChapterOptions = {}): ChaptersResult {
  const minLen = opts.minLength ?? 10;
  const offset = opts.offset ?? 0;
  const warnings: string[] = [];
  const duration = Math.max(0, (opts.duration ?? sequenceDuration(seq)) - offset);
  const marks = seq.markers
    .filter((m) => m.kind === 'chapter')
    .map((m) => ({ time: m.time - offset, title: (m.label || m.note || '').replace(/\s+/g, ' ').trim() }))
    .filter((m) => m.time > -1e-6 && (duration <= 0 || m.time < duration))
    .sort((a, b) => a.time - b.time);
  if (!marks.length) {
    return { text: '', chapters: [], warnings: ['There are no chapter markers. Add markers of kind "Chapter" on the timeline.'] };
  }
  let chapters: Chapter[] = marks.map((m, i) => ({ time: Math.floor(m.time + 1e-6), title: m.title || `Chapter ${i + 1}` }));

  // First chapter at 0:00.
  if (chapters[0].time !== 0) {
    if (chapters[0].time < minLen) {
      warnings.push(`"${chapters[0].title}" moved from ${stamp(chapters[0].time, false)} to 00:00 (the first chapter must start at 0:00).`);
      chapters[0] = { ...chapters[0], time: 0 };
    } else {
      const intro = opts.introTitle ?? 'Intro';
      warnings.push(`Added "${intro}" at 00:00 (the first chapter must start at 0:00).`);
      chapters.unshift({ time: 0, title: intro });
    }
  }

  // At least minLen seconds apart.
  const spaced: Chapter[] = [];
  for (const c of chapters) {
    const prev = spaced[spaced.length - 1];
    if (prev && c.time - prev.time < minLen) {
      warnings.push(`Dropped "${c.title}" at ${stamp(c.time, false)}: chapters must be at least ${minLen} s apart.`);
      continue;
    }
    spaced.push(c);
  }
  chapters = spaced;

  // The last chapter must also last minLen seconds.
  while (chapters.length > 1 && duration > 0 && duration - chapters[chapters.length - 1].time < minLen) {
    const last = chapters.pop()!;
    warnings.push(`Dropped "${last.title}" at ${stamp(last.time, false)}: it is shorter than ${minLen} s before the end.`);
  }

  if (chapters.length < 3) warnings.push(`YouTube needs at least 3 chapters; this list has ${chapters.length}.`);
  const long = chapters.some((c) => c.time >= 3600) || duration >= 3600;
  const text = chapters.map((c) => `${stamp(c.time, long)} ${c.title}`).join('\n');
  return { text, chapters, warnings };
}

/** YouTube chapter list from chapter markers ("00:00 Intro"). */
export function exportChapters(seq: Sequence): string {
  return exportChaptersDetailed(seq).text;
}
