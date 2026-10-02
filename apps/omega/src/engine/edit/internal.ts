// Internal machinery for the edit ops (engine/edit/ops.ts): the frame grid,
// source-time math (speed, reverse, ramps, holds), track primitives
// (overwrite, split, ripple shift), edit plans that are validated before
// they are applied, and the cleanup every op runs afterwards. Everything
// here works on plain objects and on immer drafts alike.
//
// All positions are computed as INTEGER FRAMES on the sequence grid and
// written back with fromFrames(), so an edited edge always lands exactly on
// a frame (no float drift at 23.976 / 29.97 / 59.94).

import type { CaptionCue, Clip, Keyframe, MediaAsset, Project, Sequence, Track, TrackKind } from '../../state/types';
import { newId, sequenceDuration } from '../../state/types';
import { makeTrack } from '../../state/defaults';
import { evaluate } from '../keyframes';
import { exactRate, fromFrames, toFrames } from '../time';

// ---------------------------------------------------------------------------
// Frame grid
// ---------------------------------------------------------------------------

export interface Grid {
  fps: number;
  /** Exact rate (24000/1001 for 23.976). */
  rate: number;
  /** Seconds → nearest frame index. */
  F(t: number): number;
  /** Frame index → seconds (exactly on the grid). */
  T(f: number): number;
}

export function grid(fps: number): Grid {
  const f = fps > 0 && Number.isFinite(fps) ? fps : 30;
  return { fps: f, rate: exactRate(f), F: (t) => toFrames(t, f), T: (n) => fromFrames(n, f) };
}

export function gridOf(seq: Sequence): Grid {
  return grid(seq.fps);
}

export function startF(g: Grid, c: { start: number }): number {
  return g.F(c.start);
}

export function endF(g: Grid, c: { start: number; duration: number }): number {
  return g.F(c.start + c.duration);
}

export function durF(g: Grid, c: { start: number; duration: number }): number {
  return endF(g, c) - startF(g, c);
}

/** Writes a clip's extent from frame indices (start and duration both on the grid). */
export function setSpan(g: Grid, c: Clip, s: number, e: number): void {
  c.start = g.T(s);
  c.duration = g.T(e - s);
}

/** True when `t` sits on the frame grid (within float noise). */
export function onGrid(g: Grid, t: number): boolean {
  const f = t * g.rate;
  return Math.abs(f - Math.round(f)) < 1e-6;
}

/** Removes float noise from a time that is meant to be on the grid. */
export function tidy(g: Grid, t: number): number {
  if (Math.abs(t) < 1e-9) return 0;
  return onGrid(g, t) ? g.T(Math.round(t * g.rate)) : t;
}

/** Shifts a time by whole frames, staying exactly on the grid when it was on it. */
export function shiftTime(g: Grid, t: number, dF: number): number {
  return onGrid(g, t) ? g.T(Math.round(t * g.rate) + dF) : t + g.T(dF);
}

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

/**
 * Shifts every keyframe of a clip by `dF` frames (same as keyframes.ts
 * shiftKeyframes, but frame exact). Used by head trims so animation stays
 * with the picture.
 */
export function shiftKfs(g: Grid, c: Clip, dF: number): void {
  if (!dF) return;
  for (const list of Object.values(c.keyframes)) for (const k of list) k.t = shiftTime(g, k.t, dF);
}

/** Scales keyframe times by `r` (rate stretch / speed change); speed ramp values scale by 1/r so the source span is unchanged. */
export function scaleKfs(c: Clip, r: number): void {
  if (r === 1 || !(r > 0)) return;
  for (const [path, list] of Object.entries(c.keyframes)) {
    for (const k of list) {
      k.t *= r;
      if (path === 'time.speed') k.v /= r;
    }
  }
}

// ---------------------------------------------------------------------------
// Source time (speed, reverse, ramps, holds)
// ---------------------------------------------------------------------------

const RAMP_STEP = 1 / 480; // same integration step as engine/time.ts
/** Tolerance when comparing source ranges with the media length (container rounding). */
export const SRC_TOL = 1e-3;
export const MIN_SPEED = 0.01;
export const MAX_SPEED = 100;

export function speedKfs(c: Clip): Keyframe[] | null {
  const k = c.keyframes['time.speed'];
  return k && k.length ? k : null;
}

/**
 * ∫ speed dt over [a,b] (a ≤ b) for a speed-ramp curve. Before the first and
 * after the last keyframe the curve is constant, so those parts are exact;
 * the ramp itself uses the midpoint rule of engine/time.ts.
 */
function integrate(kfs: Keyframe[], a: number, b: number): number {
  if (b <= a) return 0;
  const first = kfs[0];
  const last = kfs[kfs.length - 1];
  let acc = 0;
  if (a < first.t) {
    const end = Math.min(b, first.t);
    acc += (end - a) * first.v;
    a = end;
    if (a >= b) return acc;
  }
  if (b > last.t) {
    const st = Math.max(a, last.t);
    acc += (b - st) * last.v;
    b = st;
  }
  let t = a;
  while (t < b - 1e-12) {
    const dt = Math.min(RAMP_STEP, b - t);
    acc += evaluate(kfs, t + dt / 2) * dt;
    t += dt;
  }
  return acc;
}

/** Source seconds between clip-local times a and b (negative when b < a). */
export function srcBetween(c: Clip, a: number, b: number): number {
  if (a === b) return 0;
  const kfs = speedKfs(c);
  if (!kfs) return (b - a) * c.speed;
  return b > a ? integrate(kfs, a, b) : -integrate(kfs, b, a);
}

/** Source span of the clip if it lasted `dur` seconds with its keyframes shifted by `kfShift` seconds. */
export function spanFor(c: Clip, dur: number, kfShift = 0): number {
  const kfs = speedKfs(c);
  if (!kfs) return Math.max(0, dur) * c.speed;
  const list = kfShift ? kfs.map((k) => ({ ...k, t: k.t + kfShift })) : kfs;
  return Math.max(0, integrate(list, 0, Math.max(0, dur)));
}

function assetOfClip(project: Project | undefined, c: Clip): MediaAsset | undefined {
  return c.assetId && project ? project.assets.find((a) => a.id === c.assetId) : undefined;
}

/**
 * Whether the clip consumes source time (media with a time axis or a
 * nested sequence). Stills, generated clips and freeze frames don't: they
 * can be trimmed freely and their inPoint never changes.
 */
export function isTimed(project: Project | undefined, c: Clip): boolean {
  if (c.holdFrame !== null && c.holdFrame !== undefined) return false;
  if (c.kind === 'sequence') return true;
  if (c.kind !== 'media') return false;
  const a = assetOfClip(project, c);
  return !a || a.kind !== 'image';
}

/** Length of the clip's source in seconds; Infinity when unlimited or unknown. */
export function sourceLimit(project: Project | undefined, c: Clip): number {
  if (!isTimed(project, c)) return Infinity;
  if (c.kind === 'sequence') {
    const s = project?.sequences.find((x) => x.id === c.sequenceId);
    const d = s ? sequenceDuration(s) : 0;
    return d > 0 ? d : Infinity;
  }
  const a = assetOfClip(project, c);
  return a && a.duration > 0 ? a.duration : Infinity;
}

/** How far a hypothetical clip state reaches outside its source (0 = inside). */
export function sourceExcess(project: Project | undefined, c: Clip, inPoint: number, dur: number, kfShift = 0): number {
  if (!isTimed(project, c)) return 0;
  const lim = sourceLimit(project, c);
  const lo = inPoint;
  const under = Math.max(0, -lo - SRC_TOL);
  if (lim === Infinity) return under;
  const hi = inPoint + spanFor(c, dur, kfShift);
  return under + Math.max(0, hi - lim - SRC_TOL);
}

/** Largest whole number of frames that fits `span` source seconds at speed 1 (with container tolerance). */
export function framesFor(g: Grid, span: number): number {
  return Math.max(0, Math.floor(span * g.rate + SRC_TOL * g.rate + 1e-9));
}

/** inPoint after moving the head by dF frames (positive = later = shorter). */
export function headInPoint(g: Grid, project: Project | undefined, c: Clip, dF: number): number {
  if (!dF || !isTimed(project, c) || c.reverse) return c.inPoint;
  return c.inPoint + srcBetween(c, 0, g.T(dF));
}

/** inPoint after changing the duration from oldDurF to newDurF at the tail. */
export function tailInPoint(g: Grid, project: Project | undefined, c: Clip, oldDurF: number, newDurF: number): number {
  if (oldDurF === newDurF || !isTimed(project, c) || !c.reverse) return c.inPoint;
  // Reverse: the tail shows the low end of the source range.
  return c.inPoint + srcBetween(c, g.T(newDurF), g.T(oldDurF));
}

export function cleanInPoint(g: Grid, x: number): number {
  if (x < 0 && x > -SRC_TOL) return 0;
  return tidy(g, x);
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export interface Located {
  clip: Clip;
  track: Track;
}

export function ofKind(seq: Sequence, kind: TrackKind): Track[] {
  return seq.tracks.filter((t) => t.kind === kind);
}

export function unlockedTracks(seq: Sequence): Track[] {
  return seq.tracks.filter((t) => !t.locked);
}

export function locate(seq: Sequence, id: string): Located | null {
  for (const track of seq.tracks) {
    for (const clip of track.clips) if (clip.id === id) return { clip, track };
  }
  return null;
}

export function allClips(seq: Sequence): Located[] {
  const out: Located[] = [];
  for (const track of seq.tracks) for (const clip of track.clips) out.push({ clip, track });
  return out;
}

/**
 * Expands ids with linked partners (same linkId) and/or group members
 * (same groupId), transitively. Clips on locked tracks are dropped unless
 * `keepLocked`. Result keeps sequence order.
 */
export function expand(seq: Sequence, ids: Iterable<string>, opts: { links: boolean; groups: boolean; keepLocked?: boolean }): Located[] {
  const want = new Set(ids);
  if (!want.size) return [];
  const all = allClips(seq);
  if (opts.links || opts.groups) {
    for (let pass = 0; pass < 8; pass++) {
      const links = new Set<string>();
      const groups = new Set<string>();
      for (const { clip } of all) {
        if (!want.has(clip.id)) continue;
        if (opts.links && clip.linkId) links.add(clip.linkId);
        if (opts.groups && clip.groupId) groups.add(clip.groupId);
      }
      let grew = false;
      for (const { clip } of all) {
        if (want.has(clip.id)) continue;
        if ((clip.linkId && links.has(clip.linkId)) || (clip.groupId && groups.has(clip.groupId))) {
          want.add(clip.id);
          grew = true;
        }
      }
      if (!grew) break;
    }
  }
  return all.filter((l) => want.has(l.clip.id) && (opts.keepLocked || !l.track.locked));
}

/** Linked partners of a clip (not including it), on unlocked tracks. */
export function partnersOf(seq: Sequence, clip: Clip): Located[] {
  const link = clip.linkId;
  if (!link) return [];
  const out: Located[] = [];
  for (const track of seq.tracks) {
    if (track.locked) continue;
    for (const c of track.clips) if (c !== clip && c.linkId === link) out.push({ clip: c, track });
  }
  return out;
}

export function sortedClips(track: Track): Clip[] {
  return [...track.clips].sort((a, b) => a.start - b.start);
}

/** The clip that ends exactly where `clip` starts (edge 'start') or starts where it ends (edge 'end'). */
export function adjacent(g: Grid, track: Track, clip: Clip, edge: 'start' | 'end'): Clip | null {
  const s = startF(g, clip);
  const e = endF(g, clip);
  for (const o of track.clips) {
    if (o === clip) continue;
    if (edge === 'start' && endF(g, o) === s && startF(g, o) < s) return o;
    if (edge === 'end' && startF(g, o) === e && endF(g, o) > e) return o;
  }
  return null;
}

export function removeClip(track: Track, clip: Clip): void {
  const i = track.clips.indexOf(clip);
  if (i >= 0) track.clips.splice(i, 1);
}

/** Deep copy that also works on immer drafts. */
export function cloneClip(c: Clip): Clip {
  return JSON.parse(JSON.stringify(c)) as Clip;
}

/** True when [s,e) overlaps any clip on the track (excluding `skip`). */
export function occupied(g: Grid, track: Track, s: number, e: number, skip?: Set<Clip>): boolean {
  for (const c of track.clips) {
    if (skip?.has(c)) continue;
    if (startF(g, c) < e && endF(g, c) > s) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Op context: split aliases, fresh link ids, transition snapshot, cleanup
// ---------------------------------------------------------------------------

interface Ctx {
  /** right half id → id of the clip it was split from */
  aliases: Map<string, string>;
  /** old linkId → fresh linkId shared by right halves split in this op */
  links: Map<string, string>;
}

let ctx: Ctx | null = null;

function context(): Ctx {
  return ctx ?? { aliases: new Map(), links: new Map() };
}

export function recordAlias(newIdValue: string, oldId: string): void {
  context().aliases.set(newIdValue, oldId);
}

/** clipId → id of its adjacent previous clip, for clips that have a transitionIn. */
export type Snapshot = Map<string, string | null>;

export function snapshot(seq: Sequence): Snapshot {
  const g = gridOf(seq);
  const m: Snapshot = new Map();
  for (const tr of seq.tracks) {
    if (!tr.clips.some((c) => c.transitionIn)) continue;
    const list = sortedClips(tr);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.transitionIn) continue;
      const p = i > 0 ? list[i - 1] : null;
      m.set(c.id, p && endF(g, p) === startF(g, c) ? p.id : null);
    }
  }
  return m;
}

function sameIdentity(nowId: string, beforeId: string, aliases: Map<string, string>): boolean {
  let id: string | undefined = nowId;
  for (let i = 0; i < 64 && id; i++) {
    if (id === beforeId) return true;
    id = aliases.get(id);
  }
  return false;
}

export function isSorted(list: { start: number }[]): boolean {
  for (let i = 1; i < list.length; i++) if (list[i].start < list[i - 1].start) return false;
  return true;
}

/**
 * Post-edit cleanup for one sequence: drops zero-length clips, keeps tracks
 * sorted, removes head transitions whose neighbour went away (or changed),
 * clamps transition and fade lengths to the clips, and removes link/group
 * ids that no longer pair anything. Writes only what actually changes (so a
 * no-op edit stays a no-op under immer).
 */
export function finalize(seq: Sequence, snap: Snapshot): void {
  const g = gridOf(seq);
  const aliases = context().aliases;
  for (const tr of seq.tracks) {
    if (tr.locked) continue;
    for (const c of [...tr.clips]) if (endF(g, c) - startF(g, c) <= 0) removeClip(tr, c);
    if (!isSorted(tr.clips)) tr.clips.sort((a, b) => a.start - b.start);
    if (!isSorted(tr.cues)) tr.cues.sort((a, b) => a.start - b.start);
    const list = tr.clips;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const d = endF(g, c) - startF(g, c);
      const p = i > 0 && endF(g, list[i - 1]) === startF(g, c) ? list[i - 1] : null;
      if (c.transitionIn) {
        if (snap.has(c.id)) {
          const before = snap.get(c.id);
          if (before !== null && before !== undefined && (!p || !sameIdentity(p.id, before, aliases))) c.transitionIn = null;
        }
      }
      if (c.transitionIn) {
        const maxF = 2 * Math.min(d, p ? endF(g, p) - startF(g, p) : Infinity);
        if (g.F(c.transitionIn.duration) > maxF) c.transitionIn.duration = g.T(maxF);
      }
      if (c.transitionOut && g.F(c.transitionOut.duration) > 2 * d) c.transitionOut.duration = g.T(2 * d);
      if (c.fadeIn > c.duration) c.fadeIn = c.duration;
      if (c.fadeOut > c.duration) c.fadeOut = c.duration;
      if (c.audio && c.audio.fadeIn > c.duration) c.audio.fadeIn = c.duration;
      if (c.audio && c.audio.fadeOut > c.duration) c.audio.fadeOut = c.duration;
    }
  }
  pruneOrphanIds(seq);
}

/** Removes linkIds / groupIds that only one clip carries. */
export function pruneOrphanIds(seq: Sequence): void {
  const links = new Map<string, number>();
  const groups = new Map<string, number>();
  for (const tr of seq.tracks) {
    for (const c of tr.clips) {
      if (c.linkId) links.set(c.linkId, (links.get(c.linkId) ?? 0) + 1);
      if (c.groupId) groups.set(c.groupId, (groups.get(c.groupId) ?? 0) + 1);
    }
  }
  for (const tr of seq.tracks) {
    if (tr.locked) continue;
    for (const c of tr.clips) {
      if (c.linkId && links.get(c.linkId) === 1) delete c.linkId;
      if (c.groupId && groups.get(c.groupId) === 1) delete c.groupId;
    }
  }
}

/**
 * Runs an edit with cleanup. Nested calls (an op calling another op) run
 * inside the outer edit and share its context and cleanup.
 */
export function runEdit<T>(seqs: Sequence[], fn: () => T): T {
  if (ctx) return fn();
  ctx = { aliases: new Map(), links: new Map() };
  try {
    const snaps = seqs.map((s) => snapshot(s));
    const r = fn();
    seqs.forEach((s, i) => finalize(s, snaps[i]));
    return r;
  } finally {
    ctx = null;
  }
}

/** Fresh linkId shared by every right half split from clips that carried `old` in this op. */
function splitLink(old: string): string {
  const c = context();
  let n = c.links.get(old);
  if (!n) {
    n = newId('link');
    c.links.set(old, n);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Track primitives
// ---------------------------------------------------------------------------

/** Trims a clip's tail so it ends at frame `e` (shrink only; no validation). */
export function trimTailTo(g: Grid, project: Project | undefined, c: Clip, e: number): void {
  const s = startF(g, c);
  const old = endF(g, c) - s;
  c.inPoint = cleanInPoint(g, tailInPoint(g, project, c, old, e - s));
  setSpan(g, c, s, e);
}

/** Trims a clip's head so it starts at frame `s` (shrink only; no validation). */
export function trimHeadTo(g: Grid, project: Project | undefined, c: Clip, s: number): void {
  const s0 = startF(g, c);
  const e = endF(g, c);
  const d = s - s0;
  c.inPoint = cleanInPoint(g, headInPoint(g, project, c, d));
  setSpan(g, c, s, e);
  shiftKfs(g, c, -d);
}

/**
 * Splits `c` at frame t (strictly inside). The left half keeps the id,
 * head transition and fade-in; the right half gets a fresh id, the tail
 * transition and fade-out, keyframes shifted so animation stays put, and a
 * fresh linkId shared with the other right halves split in the same op.
 */
export function splitClip(g: Grid, project: Project | undefined, track: Track, c: Clip, t: number): Clip | null {
  const s = startF(g, c);
  const e = endF(g, c);
  if (t <= s || t >= e) return null;
  const L = t - s;
  const right = cloneClip(c);
  right.id = newId('clip');
  if (isTimed(project, c)) {
    if (c.reverse) {
      // reverse: the left half shows the high end of the source range
      const leftIn = c.inPoint + srcBetween(c, g.T(L), g.T(e - s));
      right.inPoint = c.inPoint;
      c.inPoint = cleanInPoint(g, leftIn);
    } else {
      right.inPoint = cleanInPoint(g, c.inPoint + srcBetween(c, 0, g.T(L)));
    }
  }
  setSpan(g, c, s, t);
  setSpan(g, right, t, e);
  shiftKfs(g, right, -L);
  if (c.fadeOut) c.fadeOut = 0;
  if (c.audio?.fadeOut) c.audio.fadeOut = 0;
  right.fadeIn = 0;
  if (right.audio) right.audio.fadeIn = 0;
  if (c.transitionOut) c.transitionOut = null;
  right.transitionIn = null;
  if (c.linkId) right.linkId = splitLink(c.linkId);
  track.clips.push(right);
  recordAlias(right.id, c.id);
  return right;
}

function clearCues(g: Grid, track: Track, a: number, b: number): void {
  const A = g.T(a);
  const B = g.T(b);
  const eps = 1e-6;
  for (const q of [...track.cues]) {
    if (q.end <= A + eps || q.start >= B - eps) continue;
    if (q.start >= A - eps && q.end <= B + eps) {
      track.cues.splice(track.cues.indexOf(q), 1);
    } else if (q.start < A && q.end > B) {
      const right: CaptionCue = { ...q, id: newId('cue'), start: B };
      q.end = A;
      track.cues.push(right);
    } else if (q.start < A) {
      q.end = A;
    } else {
      q.start = B;
    }
  }
}

/**
 * Overwrite: clears frames [a,b) on a track, trimming, splitting or removing
 * whatever lies there (clips in `keep` are left alone).
 */
export function clearRange(g: Grid, project: Project | undefined, track: Track, a: number, b: number, keep?: Set<Clip>): void {
  if (b <= a || track.locked) return;
  if (track.kind === 'caption') {
    clearCues(g, track, a, b);
    return;
  }
  for (const c of [...track.clips]) {
    if (keep?.has(c)) continue;
    const s = startF(g, c);
    const e = endF(g, c);
    if (e <= a || s >= b) continue;
    if (s >= a && e <= b) removeClip(track, c);
    else if (s < a && e > b) {
      splitClip(g, project, track, c, b);
      trimTailTo(g, project, c, a);
    } else if (s < a) trimTailTo(g, project, c, a);
    else trimHeadTo(g, project, c, b);
  }
}

/**
 * Insert: opens W frames at frame P on the given tracks. Clips crossing P
 * are split (when `split`), everything at or after P moves right, and so do
 * caption cues. Locked tracks are skipped.
 */
export function insertSpace(g: Grid, project: Project | undefined, tracks: Track[], P: number, W: number, opts: { split: boolean; exclude?: Set<Clip> } = { split: true }): void {
  if (W <= 0) return;
  for (const tr of tracks) {
    if (tr.locked) continue;
    if (opts.split) {
      for (const c of [...tr.clips]) {
        if (opts.exclude?.has(c)) continue;
        if (startF(g, c) < P && endF(g, c) > P) splitClip(g, project, tr, c, P);
      }
    }
    for (const c of tr.clips) {
      if (opts.exclude?.has(c)) continue;
      const s = startF(g, c);
      if (s >= P) setSpan(g, c, s + W, endF(g, c) + W);
    }
    for (const q of tr.cues) {
      if (g.F(q.start) >= P) {
        q.start = shiftTime(g, q.start, W);
        q.end = shiftTime(g, q.end, W);
      }
    }
  }
}

/** Moves everything that starts at or after frame `from` by dF frames on the given tracks. */
export function shiftFrom(g: Grid, tracks: Track[], from: number, dF: number, exclude?: Set<Clip>): void {
  if (!dF) return;
  for (const tr of tracks) {
    if (tr.locked) continue;
    for (const c of tr.clips) {
      if (exclude?.has(c)) continue;
      const s = startF(g, c);
      if (s >= from) setSpan(g, c, s + dF, endF(g, c) + dF);
    }
    for (const q of tr.cues) {
      if (g.F(q.start) >= from) {
        q.start = shiftTime(g, q.start, dF);
        q.end = shiftTime(g, q.end, dF);
      }
    }
  }
}

/**
 * How many frames everything at or after `from` can move left on the given
 * tracks without colliding with what stays (or crossing 0). Clips in
 * `exclude` stay where they are (with extents from `override` if given).
 */
export function pullAvail(g: Grid, tracks: Track[], from: number, exclude?: Set<Clip>, override?: Map<Clip, { s: number; e: number }>): number {
  let avail = Infinity;
  for (const tr of tracks) {
    if (tr.locked) continue;
    let minShift = Infinity;
    let maxEnd = 0;
    for (const c of tr.clips) {
      const o = override?.get(c);
      const s = o ? o.s : startF(g, c);
      const e = o ? o.e : endF(g, c);
      if (!exclude?.has(c) && s >= from) minShift = Math.min(minShift, s);
      else maxEnd = Math.max(maxEnd, e);
    }
    for (const q of tr.cues) {
      const s = g.F(q.start);
      if (s >= from) minShift = Math.min(minShift, s);
      else maxEnd = Math.max(maxEnd, g.F(q.end));
    }
    if (minShift !== Infinity) avail = Math.min(avail, minShift - maxEnd);
  }
  return Math.max(0, avail);
}

/** Closes frames [a,b) by pulling everything at ≥ b left on `tracks`, as far as they allow. Returns frames closed. */
export function closeRange(g: Grid, tracks: Track[], a: number, b: number): number {
  if (b <= a) return 0;
  const n = Math.min(b - a, pullAvail(g, tracks, b));
  if (n > 0) shiftFrom(g, tracks, b, -n);
  return n;
}

// ---------------------------------------------------------------------------
// Plans: computed edits that are validated before they are applied
// ---------------------------------------------------------------------------

export interface PlanItem {
  clip: Clip;
  from: Track;
  to: Track;
  s: number;
  e: number;
  inPoint: number;
  /** Keyframe shift in frames. */
  kfShift: number;
}

export type Plan = Map<Clip, PlanItem>;

export function baseItem(g: Grid, clip: Clip, track: Track): PlanItem {
  return { clip, from: track, to: track, s: startF(g, clip), e: endF(g, clip), inPoint: clip.inPoint, kfShift: 0 };
}

/** Moves the item's head by d frames (start moves, source and keyframes follow). */
export function editHead(g: Grid, project: Project | undefined, it: PlanItem, d: number): PlanItem {
  it.inPoint = headInPoint(g, project, it.clip, d);
  it.s += d;
  it.kfShift = -d;
  return it;
}

/** Moves the item's tail by d frames. */
export function editTail(g: Grid, project: Project | undefined, it: PlanItem, d: number): PlanItem {
  const old = it.e - it.s;
  it.e += d;
  it.inPoint = tailInPoint(g, project, it.clip, old, it.e - it.s);
  return it;
}

interface Interval {
  s: number;
  e: number;
  ch: boolean;
}

function sweepOk(iv: Interval[]): boolean {
  iv.sort((a, b) => a.s - b.s || a.e - b.e);
  let maxE = -Infinity;
  let maxCh = false;
  for (const x of iv) {
    if (x.s < maxE && (x.ch || maxCh)) return false;
    if (x.e > maxE) {
      maxE = x.e;
      maxCh = x.ch;
    }
  }
  return true;
}

/** Few changed clips: check each against the rest (linear); many: sort and sweep. */
const LINEAR_LIMIT = 48;

function trackOk(g: Grid, tr: Track, plan: Plan): boolean {
  const mine: PlanItem[] = [];
  for (const it of plan.values()) if (it.to === tr) mine.push(it);
  if (mine.length <= LINEAR_LIMIT) {
    for (let i = 0; i < mine.length; i++) {
      const a = mine[i];
      for (let j = i + 1; j < mine.length; j++) if (a.s < mine[j].e && mine[j].s < a.e) return false;
    }
    for (const c of tr.clips) {
      if (plan.has(c)) continue;
      const s = startF(g, c);
      const e = endF(g, c);
      for (const a of mine) if (a.s < e && s < a.e) return false;
    }
    return true;
  }
  const iv: Interval[] = [];
  for (const c of tr.clips) if (!plan.has(c)) iv.push({ s: startF(g, c), e: endF(g, c), ch: false });
  for (const it of mine) iv.push({ s: it.s, e: it.e, ch: true });
  return sweepOk(iv);
}

function itemSourceOk(g: Grid, project: Project | undefined, it: PlanItem): boolean {
  const c = it.clip;
  if (!isTimed(project, c)) return true;
  const ex = sourceExcess(project, c, it.inPoint, g.T(it.e - it.s), g.T(it.kfShift));
  if (ex <= 0) return true;
  // never make an already-invalid clip worse
  return ex <= sourceExcess(project, c, c.inPoint, c.duration) + 1e-9;
}

/** Checks durations (≥ 1 frame), start ≥ 0, unlocked destinations, source limits and (optionally) overlaps. */
export function planValid(g: Grid, project: Project | undefined, plan: Plan, opts: { overlap?: boolean; source?: boolean } = {}): boolean {
  for (const it of plan.values()) {
    if (it.e - it.s < 1 || it.s < 0 || it.to.locked) return false;
    if (opts.source !== false && !itemSourceOk(g, project, it)) return false;
  }
  if (opts.overlap === false) return true;
  const tracks = new Set<Track>();
  for (const it of plan.values()) tracks.add(it.to);
  for (const tr of tracks) if (!trackOk(g, tr, plan)) return false;
  return true;
}

/**
 * Validates a plan whose items stay put while everything else at or after
 * `from` on `tracks` moves by `delta` frames (ripple). Checks the whole
 * result for overlaps, so it also catches sync-lock collisions on other
 * tracks.
 */
export function rippleValid(g: Grid, project: Project | undefined, plan: Plan, tracks: Track[], from: number, delta: number): boolean {
  if (!planValid(g, project, plan, { overlap: false })) return false;
  const shifting = new Set(tracks.filter((t) => !t.locked));
  const touched = new Set<Track>(shifting);
  for (const it of plan.values()) touched.add(it.to);
  for (const tr of touched) {
    const moves = !!delta && shifting.has(tr);
    const mine: PlanItem[] = [];
    for (const it of plan.values()) if (it.to === tr) mine.push(it);
    // what stays ends before what moves left (no clip may jump over another)
    let maxStay = 0;
    let minMoved = Infinity;
    for (const it of mine) maxStay = Math.max(maxStay, it.e);
    for (const c of tr.clips) {
      if (plan.has(c)) continue;
      let s = startF(g, c);
      let e = endF(g, c);
      if (moves && s >= from) {
        s += delta;
        e += delta;
        if (s < 0) return false;
        minMoved = Math.min(minMoved, s);
      } else maxStay = Math.max(maxStay, e);
      for (const a of mine) if (a.s < e && s < a.e) return false;
    }
    if (delta < 0 && minMoved < maxStay) return false;
    for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) if (mine[i].s < mine[j].e && mine[j].s < mine[i].e) return false;
  }
  return true;
}

export function applyPlan(g: Grid, plan: Plan): void {
  for (const it of plan.values()) {
    const c = it.clip;
    if (it.to !== it.from) {
      removeClip(it.from, c);
      it.to.clips.push(c);
    }
    setSpan(g, c, it.s, it.e);
    if (it.inPoint !== c.inPoint) c.inPoint = cleanInPoint(g, it.inPoint);
    shiftKfs(g, c, it.kfShift);
  }
}

/**
 * Largest |d| ≤ |want| (same sign) for which `valid(d)` holds, assuming
 * validity is monotonic in |d| and d = 0 is valid.
 */
export function clampSearch(want: number, valid: (d: number) => boolean): number {
  if (!want) return 0;
  if (valid(want)) return want;
  const sign = want < 0 ? -1 : 1;
  let lo = 0;
  let hi = Math.abs(want);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (valid(sign * mid)) lo = mid;
    else hi = mid;
  }
  return sign * lo;
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

const PREFIX: Record<TrackKind, string> = { video: 'V', audio: 'A', caption: 'C' };

export function uniqueTrackName(seq: Sequence, kind: TrackKind): string {
  const p = PREFIX[kind];
  const names = new Set(seq.tracks.map((t) => t.name));
  let n = ofKind(seq, kind).length;
  for (const t of ofKind(seq, kind)) {
    const m = new RegExp(`^${p}(\\d+)$`).exec(t.name);
    if (m) n = Math.max(n, Number(m[1]));
  }
  n += 1;
  while (names.has(`${p}${n}`)) n++;
  return `${p}${n}`;
}

/**
 * Adds a track of `kind`, keeping the video → audio → caption order. With no
 * index: video goes on top of the video tracks, audio and captions below
 * their group. `index` is a position in seq.tracks, clamped into the group.
 */
export function addTrackImpl(seq: Sequence, kind: TrackKind, index?: number): Track {
  const t = makeTrack(kind, uniqueTrackName(seq, kind));
  const nV = ofKind(seq, 'video').length;
  const nA = ofKind(seq, 'audio').length;
  const lo = kind === 'video' ? 0 : kind === 'audio' ? nV : nV + nA;
  const hi = kind === 'video' ? nV : kind === 'audio' ? nV + nA : seq.tracks.length;
  let i = kind === 'video' ? 0 : hi;
  if (index !== undefined && Number.isFinite(index)) i = Math.max(lo, Math.min(hi, Math.round(index)));
  // keep kinds grouped even if the stored order is unusual
  seq.tracks.splice(i, 0, t);
  return seq.tracks[i] ?? t;
}
