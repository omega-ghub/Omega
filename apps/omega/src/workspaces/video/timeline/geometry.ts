// Pure layout and lookup helpers for the canvas timeline (no DOM, no React).
// Clip lookups are virtualized: every track gets a cached index (clips sorted
// by start plus a running max of clip ends) keyed on the immutable clips
// array, so finding the clips in a visible time range is a binary search,
// not a scan, even with thousands of clips.

import type { CaptionCue, Clip, Sequence, Track, TrackKind } from '../../../state/types';

/** Height of the ruler (marker row + tick labels). */
export const RULER_H = 36;
/** Marker row at the top of the ruler. */
export const MARKER_ROW_H = 13;
/** Width of the track header column. */
export const HEADER_W = 188;
/** Space between the video and the audio track groups. */
export const GROUP_GAP = 5;
export const MIN_TRACK_H = 22;
export const MAX_TRACK_H = 240;

export const HEIGHT_PRESETS: Record<'S' | 'M' | 'L', Record<TrackKind, number>> = {
  S: { video: 38, audio: 34, caption: 26 },
  M: { video: 64, audio: 52, caption: 36 },
  L: { video: 104, audio: 84, caption: 48 },
};

export interface TrackRow {
  track: Track;
  /** Index in seq.tracks */
  index: number;
  /** Index among tracks of the same kind (0 = first of that kind in document order). */
  kindIndex: number;
  /** Content y (before vertical scroll). */
  y: number;
  h: number;
}

export interface Layout {
  rows: TrackRow[];
  /** Total content height. */
  height: number;
  /** Content y where the audio group starts (for the divider), or null. */
  dividerY: number | null;
}

const layoutCache = new WeakMap<Track[], Layout>();

export function trackHeight(t: Track): number {
  return Math.max(MIN_TRACK_H, Math.min(MAX_TRACK_H, t.height || 48));
}

export function layoutTracks(tracks: Track[]): Layout {
  const cached = layoutCache.get(tracks);
  if (cached) return cached;
  const rows: TrackRow[] = [];
  const kindCount: Record<TrackKind, number> = { video: 0, audio: 0, caption: 0 };
  let y = 0;
  let dividerY: number | null = null;
  let prevKind: TrackKind | null = null;
  tracks.forEach((track, index) => {
    if (prevKind && prevKind !== track.kind) {
      if (dividerY === null) dividerY = y;
      y += GROUP_GAP;
    }
    const h = trackHeight(track);
    rows.push({ track, index, kindIndex: kindCount[track.kind]++, y, h });
    y += h;
    prevKind = track.kind;
  });
  const layout = { rows, height: y, dividerY };
  layoutCache.set(tracks, layout);
  return layout;
}

/** The row under content y (null in gaps / outside). */
export function rowAtY(layout: Layout, y: number): TrackRow | null {
  const rows = layout.rows;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = rows[mid];
    if (y < r.y) hi = mid - 1;
    else if (y >= r.y + r.h) lo = mid + 1;
    else return r;
  }
  return null;
}

/** Nearest row to content y (clamped), used while dragging between tracks. */
export function nearestRow(layout: Layout, y: number): TrackRow | null {
  const rows = layout.rows;
  if (!rows.length) return null;
  const hit = rowAtY(layout, y);
  if (hit) return hit;
  let best = rows[0];
  let bestD = Infinity;
  for (const r of rows) {
    const d = y < r.y ? r.y - y : y - (r.y + r.h);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

export function rowsOfKind(layout: Layout, kind: TrackKind): TrackRow[] {
  return layout.rows.filter((r) => r.track.kind === kind);
}

// ---------------------------------------------------------------------------
// Per-track clip index
// ---------------------------------------------------------------------------

export interface ClipIndex {
  sorted: Clip[];
  /** maxEnd[i] = max end of sorted[0..i] (for range queries with overlaps). */
  maxEnd: Float64Array;
}

const clipIndexCache = new WeakMap<Clip[], ClipIndex>();

export function clipIndex(track: Track): ClipIndex {
  const cached = clipIndexCache.get(track.clips);
  if (cached) return cached;
  const sorted = [...track.clips].sort((a, b) => a.start - b.start);
  const maxEnd = new Float64Array(sorted.length);
  let m = -Infinity;
  for (let i = 0; i < sorted.length; i++) {
    m = Math.max(m, sorted[i].start + sorted[i].duration);
    maxEnd[i] = m;
  }
  const idx = { sorted, maxEnd };
  clipIndexCache.set(track.clips, idx);
  return idx;
}

/** First index whose start >= t. */
function lowerBoundStart(sorted: { start: number }[], t: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].start < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose running max end > t. */
function firstEndingAfter(maxEnd: Float64Array, t: number): number {
  let lo = 0;
  let hi = maxEnd.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (maxEnd[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Clips overlapping [t0, t1), in start order. */
export function clipsInRange(track: Track, t0: number, t1: number): Clip[] {
  const { sorted, maxEnd } = clipIndex(track);
  if (!sorted.length) return [];
  const from = firstEndingAfter(maxEnd, t0);
  const to = lowerBoundStart(sorted, t1);
  const out: Clip[] = [];
  for (let i = from; i < to; i++) {
    const c = sorted[i];
    if (c.start + c.duration > t0) out.push(c);
  }
  return out;
}

/** The top-most (last-started) clip covering t on the track. */
export function clipAtTime(track: Track, t: number): Clip | undefined {
  const { sorted } = clipIndex(track);
  const i = lowerBoundStart(sorted, t + 1e-9) - 1;
  for (let k = i; k >= 0 && k >= i - 8; k--) {
    const c = sorted[k];
    if (t >= c.start - 1e-9 && t < c.start + c.duration - 1e-9) return c;
  }
  return undefined;
}

/** Previous and next clips around a time (for gaps). */
export function neighbours(track: Track, t: number): { prev: Clip | null; next: Clip | null } {
  const { sorted } = clipIndex(track);
  const i = lowerBoundStart(sorted, t);
  let prev: Clip | null = null;
  for (let k = i - 1; k >= 0; k--) {
    if (sorted[k].start + sorted[k].duration <= t + 1e-9) {
      if (!prev || sorted[k].start + sorted[k].duration > prev.start + prev.duration) prev = sorted[k];
    }
    if (k < i - 16) break;
  }
  return { prev, next: sorted[i] ?? null };
}

const cueIndexCache = new WeakMap<CaptionCue[], CaptionCue[]>();
export function sortedCues(track: Track): CaptionCue[] {
  let s = cueIndexCache.get(track.cues);
  if (!s) {
    s = [...track.cues].sort((a, b) => a.start - b.start);
    cueIndexCache.set(track.cues, s);
  }
  return s;
}

export function cuesInRange(track: Track, t0: number, t1: number): CaptionCue[] {
  const s = sortedCues(track);
  const out: CaptionCue[] = [];
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid].start < t1) lo = mid + 1;
    else hi = mid;
  }
  // cues do not overlap much; walk back from the last starting before t1
  for (let i = lo - 1; i >= 0; i--) {
    const q = s[i];
    if (q.end > t0) out.push(q);
    else if (q.end < t0 - 3600) break;
  }
  return out.reverse();
}

// ---------------------------------------------------------------------------
// Sequence helpers
// ---------------------------------------------------------------------------

export function allClips(seq: Sequence): Clip[] {
  const out: Clip[] = [];
  for (const t of seq.tracks) for (const c of t.clips) out.push(c);
  return out;
}

export function trackOfClip(seq: Sequence, clipId: string): Track | null {
  for (const t of seq.tracks) if (t.clips.some((c) => c.id === clipId)) return t;
  return null;
}

/** Edit times (clip starts/ends) on the given tracks, sorted and de-duplicated. */
export function editTimes(seq: Sequence, filter: (t: Track) => boolean): number[] {
  const set: number[] = [0];
  for (const t of seq.tracks) {
    if (!filter(t)) continue;
    for (const c of t.clips) set.push(c.start, c.start + c.duration);
    for (const q of t.cues) set.push(q.start, q.end);
  }
  set.sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of set) if (!out.length || Math.abs(out[out.length - 1] - v) > 1e-6) out.push(v);
  return out;
}

/** Visible content duration: the sequence plus breathing room. */
export function contentDuration(seqDur: number, viewSeconds: number): number {
  return Math.max(seqDur + viewSeconds * 0.5, viewSeconds, 10);
}
