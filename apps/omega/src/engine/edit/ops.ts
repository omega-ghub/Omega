// Editing operations: pure functions that change a DRAFT sequence/project
// (call them inside useEditor.getState().mutate/mutateSequence). OWNED BY THE
// EDITING-ENGINE PACKAGE, which implements every function below; the
// signatures are the contract used by the timeline, viewer, media browser,
// shortcuts and command palette.
//
// Conventions:
//  * Times are timeline seconds; every resulting position is computed in
//    whole frames of the sequence (seq.fps) and written back exactly on the
//    frame grid, so no edit leaves sub-frame gaps or overlaps.
//  * Locked tracks are never modified.
//  * Linked clips (same linkId) follow their partner unless `unlinked: true`
//    (move, trim, split, slip, slide, speed, delete). Grouped clips (groupId)
//    move together.
//  * "Overwrite" trims, splits or removes whatever is underneath on the
//    destination tracks; "insert" splits at the insertion point and pushes
//    everything later to the right.
//  * Sync lock: inserts and ripples move every unlocked track so picture,
//    sound and captions stay in sync. When another track can't make room
//    (a clip there would collide), the ripple is limited instead of breaking
//    sync. Options named `syncLock: false` restrict a ripple to the edited
//    tracks.
//  * Head trims move inPoint by the source delta (speed, reverse and ramps
//    respected) and shift keyframes so animation stays with the picture.
//    Trims never reveal media beyond the source (asset.duration; stills and
//    generated clips are unlimited) and never go below one frame.
//  * Sequence markers and In/Out stay where they are on ripples.
//  * After every op: head transitions whose neighbour went away are removed,
//    transition and fade lengths are clamped to the clips, link/group ids
//    that pair nothing are dropped and tracks are kept sorted.
//  * Functions return the ids of created clips where relevant.

import type { Clip, ClipKind, LabelColor, Marker, Project, Sequence, Track, TrackKind, TransitionType } from '../../state/types';
import { newId } from '../../state/types';
import { makeClip, makeMarker, makeSequence, makeTrack, makeTransition } from '../../state/defaults';
import { EPS, sourceTimeAt } from '../time';
import {
  MAX_SPEED,
  MIN_SPEED,
  SRC_TOL,
  addTrackImpl,
  adjacent,
  allClips,
  applyPlan,
  baseItem,
  clampSearch,
  cleanInPoint,
  clearRange,
  cloneClip,
  closeRange,
  editHead,
  editTail,
  endF,
  expand,
  finalize,
  framesFor,
  grid,
  gridOf,
  headInPoint,
  insertSpace,
  isSorted,
  isTimed,
  locate,
  occupied,
  ofKind,
  partnersOf,
  planValid,
  pullAvail,
  removeClip,
  rippleValid,
  scaleKfs,
  setSpan,
  shiftFrom,
  shiftKfs,
  snapshot,
  sortedClips,
  sourceLimit,
  spanFor,
  splitClip,
  speedKfs,
  startF,
  trimHeadTo,
  trimTailTo,
  unlockedTracks,
  runEdit,
  type Grid,
  type Located,
  type Plan,
} from './internal';

export type EditMode = 'overwrite' | 'insert';
export type TrimMode = 'normal' | 'ripple' | 'roll';

/** Options shared by ops that act on linked clips. */
export interface LinkOptions {
  /** Act on the given clips only, not their linked partners (Alt-drag). */
  unlinked?: boolean;
}

export { sourceLimit } from './internal';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** A finite number or the fallback (guards UI input such as NaN). */
const fin = (v: number | undefined | null, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function stillDuration(project: Project): number {
  const d = project.settings?.stillDuration;
  return d && d > 0 ? d : 5;
}

/** Destination track of a kind: the preferred one when usable, else the lowest targeted video / topmost targeted audio, else any unlocked, else a new track. */
function pickTrack(seq: Sequence, kind: TrackKind, preferId?: string | null): Track {
  if (preferId) {
    const t = seq.tracks.find((x) => x.id === preferId);
    if (t && t.kind === kind && !t.locked) return t;
  }
  const list = stackFromBase(seq, kind);
  return list.find((t) => t.targeted && !t.locked) ?? list.find((t) => !t.locked) ?? addTrackImpl(seq, kind);
}

/** Tracks of a kind ordered away from the video/audio divide: video V1 upwards, audio A1 downwards. */
function stackFromBase(seq: Sequence, kind: TrackKind): Track[] {
  const list = ofKind(seq, kind);
  return kind === 'video' ? list.reverse() : list;
}

/** The k-th unlocked track counting from stackFromBase()[baseIdx], creating tracks when the stack runs out. */
function nthTrackFrom(seq: Sequence, kind: TrackKind, baseIdx: number, k: number): Track {
  let list = stackFromBase(seq, kind);
  let i = Math.max(0, baseIdx);
  let n = 0;
  for (let guard = 0; guard < 1000; guard++) {
    while (i >= list.length) {
      addTrackImpl(seq, kind);
      list = stackFromBase(seq, kind);
    }
    if (!list[i].locked) {
      if (n >= k) return list[i];
      n++;
    }
    i++;
  }
  return addTrackImpl(seq, kind);
}

function remapIds(c: Clip, links: Map<string, string>, groups: Map<string, string>): void {
  if (c.linkId) {
    let n = links.get(c.linkId);
    if (!n) links.set(c.linkId, (n = newId('link')));
    c.linkId = n;
  }
  if (c.groupId) {
    let n = groups.get(c.groupId);
    if (!n) groups.set(c.groupId, (n = newId('group')));
    c.groupId = n;
  }
}

function participants(seq: Sequence, f: Located, unlinked?: boolean): Located[] {
  return [f, ...(unlinked ? [] : partnersOf(seq, f.clip))];
}

// ---- placing ----------------------------------------------------------------

export interface PlaceMediaOptions {
  start: number;
  mode?: EditMode;
  /** Destination video track; null/undefined = the lowest targeted video track. */
  videoTrackId?: string | null;
  /** Destination audio track; null/undefined = the topmost targeted audio track. */
  audioTrackId?: string | null;
  /** Source range; defaults to asset.markIn / markOut, then the whole media. */
  sourceIn?: number;
  sourceOut?: number;
  /** Timeline duration (four-point edit). Without fitToFill the source range is cut to fit. */
  duration?: number;
  /** With `duration`: set the speed so the whole source range fills it (Fit to Fill). */
  fitToFill?: boolean;
  /** false = place the sound only (default: picture when the asset has one). */
  video?: boolean;
  /** false = place the picture only (default: sound when the asset has it). */
  audio?: boolean;
}

/**
 * Places a media asset (video and/or audio, linked) at `start`. Uses
 * asset.markIn/markOut when set; stills last settings.stillDuration.
 * Overwrite clears the range on the destination tracks; insert opens it on
 * every unlocked track (sync lock). Returns [videoClipId?, audioClipId?].
 */
export function placeMedia(project: Project, seq: Sequence, assetId: string, opts: PlaceMediaOptions): string[] {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const asset = project.assets.find((a) => a.id === assetId);
    if (!asset) return [];
    const isStill = asset.kind === 'image';
    const wantVideo = opts.video !== false && (isStill || (asset.hasVideo && asset.kind !== 'audio'));
    const wantAudio = opts.audio !== false && !isStill && asset.hasAudio;
    if (!wantVideo && !wantAudio) return [];

    let srcIn = 0;
    let frames: number;
    let speed = 1;
    if (isStill) {
      const explicit = opts.sourceIn !== undefined && opts.sourceOut !== undefined && opts.sourceOut > opts.sourceIn ? opts.sourceOut - opts.sourceIn : undefined;
      frames = g.F(opts.duration && opts.duration > 0 ? opts.duration : (explicit ?? stillDuration(project)));
    } else {
      const limit = asset.duration > 0 ? asset.duration : Infinity;
      srcIn = clamp(opts.sourceIn ?? asset.markIn ?? 0, 0, limit === Infinity ? Number.MAX_VALUE : limit);
      let srcOut = opts.sourceOut ?? asset.markOut ?? limit;
      if (!(srcOut > srcIn)) srcOut = limit;
      srcOut = Math.min(srcOut, limit);
      const span = srcOut - srcIn;
      const finite = Number.isFinite(span) && span > 0;
      if (opts.duration !== undefined && opts.duration > 0) {
        const want = Math.max(1, g.F(opts.duration));
        if (opts.fitToFill && finite) {
          frames = want;
          speed = clamp(span / g.T(want), MIN_SPEED, MAX_SPEED);
        } else frames = finite ? Math.min(want, framesFor(g, span)) : want;
      } else frames = finite ? framesFor(g, span) : g.F(stillDuration(project));
    }
    frames = Math.max(1, frames);

    const vTrack = wantVideo ? pickTrack(seq, 'video', opts.videoTrackId) : null;
    const aTrack = wantAudio ? pickTrack(seq, 'audio', opts.audioTrackId) : null;
    const s = Math.max(0, g.F(fin(opts.start, 0)));
    if ((opts.mode ?? 'overwrite') === 'insert') insertSpace(g, project, unlockedTracks(seq), s, frames, { split: true });
    else for (const tr of [vTrack, aTrack]) if (tr) clearRange(g, project, tr, s, s + frames);

    const linkId = vTrack && aTrack ? newId('link') : undefined;
    const ids: string[] = [];
    for (const tr of [vTrack, aTrack]) {
      if (!tr) continue;
      const c = makeClip('media', {
        start: g.T(s),
        duration: g.T(frames),
        inPoint: srcIn,
        assetId: asset.id,
        name: asset.name,
        speed,
        ...(linkId ? { linkId } : {}),
        ...(asset.label && asset.label !== 'none' ? { label: asset.label } : {}),
      });
      tr.clips.push(c);
      ids.push(c.id);
    }
    return ids;
  });
}

/**
 * Adds a generated clip (text, shape, solid, gradient, adjustment) on a video
 * track. With trackId it overwrites there; otherwise it goes on the lowest
 * free unlocked track above everything at that time (a new top track when
 * none is free). Duration defaults to settings.stillDuration.
 */
export function addGeneratedClip(
  project: Project,
  seq: Sequence,
  kind: Exclude<ClipKind, 'media' | 'sequence'>,
  opts: { start: number; duration?: number; trackId?: string | null; init?: Partial<Clip> },
): string {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const s = Math.max(0, g.F(fin(opts.start, 0)));
    const dur = Math.max(1, g.F(fin(opts.duration ?? opts.init?.duration, stillDuration(project))));
    const e = s + dur;
    let track: Track | null = null;
    if (opts.trackId) {
      const t = seq.tracks.find((x) => x.id === opts.trackId);
      if (t && t.kind === 'video' && !t.locked) {
        track = t;
        clearRange(g, project, t, s, e);
      }
    }
    if (!track) {
      const vids = ofKind(seq, 'video'); // top first
      const topOccupied = vids.findIndex((t) => occupied(g, t, s, e));
      const above = topOccupied === -1 ? vids : vids.slice(0, topOccupied);
      for (let i = above.length - 1; i >= 0; i--) {
        if (!above[i].locked && !occupied(g, above[i], s, e)) {
          track = above[i];
          break;
        }
      }
      if (!track) track = addTrackImpl(seq, 'video');
    }
    const c = makeClip(kind, { ...(opts.init ?? {}), start: g.T(s), duration: g.T(dur) });
    track.clips.push(c);
    return c.id;
  });
}

// ---- moving & trimming --------------------------------------------------------

export interface MoveOptions extends LinkOptions {
  /** The clip being dragged (trackDelta is counted on its kind). Default clipIds[0]. */
  anchorId?: string;
}

/** Destination track per moving clip; linked clips of the other kind mirror the move (video up ⇒ audio down). */
function destTracks(seq: Sequence, moving: Located[], primaryKind: TrackKind, trackDelta: number): Map<Clip, Track> {
  const res = new Map<Clip, Track>();
  const kinds = [...new Set(moving.map((m) => m.track.kind))].sort((a, b) => (a === primaryKind ? -1 : b === primaryKind ? 1 : 0));
  let primaryMoves = true;
  for (const k of kinds) {
    const list = ofKind(seq, k);
    const mine = moving.filter((m) => m.track.kind === k);
    let kd = !trackDelta || !primaryMoves ? 0 : k === primaryKind ? trackDelta : -trackDelta;
    const ok = (d: number) =>
      mine.every((m) => {
        const i = list.indexOf(m.track) + d;
        return i >= 0 && i < list.length && !list[i].locked;
      });
    if (kd && !ok(kd)) {
      kd = 0;
      // the dragged kind can't go there: nothing changes tracks
      if (k === primaryKind) primaryMoves = false;
    }
    for (const m of mine) res.set(m.clip, list[list.indexOf(m.track) + kd]);
  }
  return res;
}

function moveImpl(seq: Sequence, clipIds: string[], delta: number, trackDelta: number, mode: EditMode | 'free', opts: MoveOptions): number {
  const g = gridOf(seq);
  const moving = expand(seq, clipIds, { links: !opts.unlinked, groups: !opts.unlinked });
  if (!moving.length) return 0;
  const minS = Math.min(...moving.map((m) => startF(g, m.clip)));
  let dF = Math.max(Number.isFinite(delta) ? g.F(delta) : 0, -minS);
  const anchor = locate(seq, opts.anchorId ?? clipIds[0]);
  const primaryKind = anchor?.track.kind ?? moving[0].track.kind;
  let dests = destTracks(seq, moving, primaryKind, Math.round(trackDelta || 0));
  const sameTracks = () => moving.every((m) => dests.get(m.clip) === m.track);

  if (mode === 'free') {
    const movingSet = new Set(moving.map((m) => m.clip));
    const build = (d: number, ds: Map<Clip, Track>): Plan => {
      const p: Plan = new Map();
      for (const m of moving) {
        const it = baseItem(g, m.clip, m.track);
        it.to = ds.get(m.clip)!;
        it.s += d;
        it.e += d;
        p.set(m.clip, it);
      }
      return p;
    };
    const ok = (d: number, ds: Map<Clip, Track>) => planValid(g, undefined, build(d, ds), { source: false });
    const attempt = (ds: Map<Clip, Track>): number | null => {
      if (ok(dF, ds)) return dF;
      // stop against the nearest neighbour in the direction of travel
      const cands = new Set<number>([0]);
      for (const m of moving) {
        const s = startF(g, m.clip);
        const e = endF(g, m.clip);
        for (const y of ds.get(m.clip)!.clips) {
          if (movingSet.has(y)) continue;
          cands.add(startF(g, y) - e);
          cands.add(endF(g, y) - s);
        }
      }
      const lo = Math.min(0, dF);
      const hi = Math.max(0, dF);
      const sorted = [...cands].filter((c) => c >= lo && c <= hi && c + minS >= 0).sort((a, b) => Math.abs(a - dF) - Math.abs(b - dF));
      for (const c of sorted) if (ok(c, ds)) return c;
      return null;
    };
    let d = attempt(dests);
    if (d === null && !sameTracks()) {
      dests = new Map(moving.map((m) => [m.clip, m.track]));
      d = attempt(dests);
    }
    if (d === null || (d === 0 && sameTracks())) return 0;
    applyPlan(g, build(d, dests));
    return g.T(d);
  }

  if (dF === 0 && sameTracks()) return 0;
  const items = moving.map((m) => ({ clip: m.clip, s: startF(g, m.clip) + dF, e: endF(g, m.clip) + dF, to: dests.get(m.clip)! }));
  for (const m of moving) removeClip(m.track, m.clip);
  if (mode === 'insert') {
    const P = Math.min(...items.map((i) => i.s));
    const W = Math.max(...items.map((i) => i.e)) - P;
    insertSpace(g, undefined, unlockedTracks(seq), P, W, { split: true });
  } else {
    for (const it of items) clearRange(g, undefined, it.to, it.s, it.e);
  }
  for (const it of items) {
    it.to.clips.push(it.clip);
    setSpan(g, it.clip, it.s, it.e);
  }
  return g.T(dF);
}

/**
 * Moves clips by `delta` seconds and `trackDelta` tracks (same kind only;
 * counted in seq.tracks order, negative = up). Linked and grouped clips come
 * along; linked clips of the other kind mirror the track move (video up ⇒
 * audio down, as in Premiere). Modes: 'overwrite' replaces what is under
 * the destination, 'insert' pushes everything at the destination right on
 * every unlocked track (the origin keeps its gap), 'free' never touches
 * other clips and stops against the nearest neighbour. Returns the applied
 * delta in seconds.
 */
export function moveClips(seq: Sequence, clipIds: string[], delta: number, trackDelta: number, mode: EditMode | 'free', opts: MoveOptions = {}): number {
  return runEdit([seq], () => moveImpl(seq, clipIds, delta, trackDelta, mode, opts));
}

export interface MoveToTimeOptions extends MoveOptions {
  mode?: EditMode | 'free';
  trackDelta?: number;
  /** Snap clip edges to edit points (default true). */
  snap?: boolean;
  /** Snap distance in seconds (default 5 frames). */
  threshold?: number;
  /** Also snap to the playhead. */
  playhead?: number;
}

/**
 * Drag helper: moves the clips so the anchor clip (clipIds[0]) starts at
 * `time`, snapping any moving edge to the nearest edit point within the
 * threshold. Returns the applied delta and the edit point snapped to.
 */
export function moveClipsToTime(seq: Sequence, clipIds: string[], time: number, opts: MoveToTimeOptions = {}): { delta: number; snappedTo: number | null } {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const anchor = locate(seq, opts.anchorId ?? clipIds[0]);
    if (!anchor) return { delta: 0, snappedTo: null };
    const moving = expand(seq, clipIds, { links: !opts.unlinked, groups: !opts.unlinked });
    let dF = g.F(time) - startF(g, anchor.clip);
    let snappedTo: number | null = null;
    if (opts.snap !== false) {
      const thr = Math.max(0, Math.round((opts.threshold ?? g.T(5)) * g.rate));
      const pts = editPoints(seq, { excludeClipIds: moving.map((m) => m.clip.id), playhead: opts.playhead }).map((t) => g.F(t));
      let best: { adj: number; p: number } | null = null;
      for (const m of moving) {
        for (const edge of [startF(g, m.clip) + dF, endF(g, m.clip) + dF]) {
          for (const p of pts) {
            const adj = p - edge;
            if (Math.abs(adj) <= thr && (!best || Math.abs(adj) < Math.abs(best.adj))) best = { adj, p };
          }
        }
      }
      if (best) {
        dF += best.adj;
        snappedTo = g.T(best.p);
      }
    }
    const delta = moveImpl(seq, clipIds, g.T(dF), opts.trackDelta ?? 0, opts.mode ?? 'overwrite', opts);
    return { delta, snappedTo };
  });
}

interface Planner {
  /** Current frame of the dragged edge. */
  edge: number;
  valid(d: number): boolean;
  apply(d: number): void;
}

export interface TrimOptions extends LinkOptions {
  /** Ripple only the edited tracks instead of every unlocked track. */
  syncLock?: boolean;
}

function trimPlanner(project: Project | undefined, seq: Sequence, clipId: string, edge: 'start' | 'end', mode: TrimMode, opts: TrimOptions): Planner | null {
  const g = gridOf(seq);
  const f = locate(seq, clipId);
  if (!f || f.track.locked) return null;
  const X = f.clip;
  const edgeF = edge === 'start' ? startF(g, X) : endF(g, X);

  if (mode === 'roll') {
    const nb = adjacent(g, f.track, X, edge);
    if (nb) return rollPlanner(g, project, seq, f, nb, edge, edgeF, opts);
    mode = 'normal';
  }

  const parts = participants(seq, f, opts.unlinked);

  if (mode === 'ripple') {
    const tracks = opts.syncLock === false ? [...new Set(parts.map((p) => p.track))] : unlockedTracks(seq);
    const build = (d: number): Plan => {
      const plan: Plan = new Map();
      for (const p of parts) {
        const it = baseItem(g, p.clip, p.track);
        if (edge === 'start') {
          // the clip stays where it is; its head material goes and everything later closes up
          it.inPoint = headInPoint(g, project, p.clip, d);
          it.e -= d;
          it.kfShift = -d;
        } else editTail(g, project, it, d);
        plan.set(p.clip, it);
      }
      return plan;
    };
    const shift = (d: number) => (edge === 'start' ? { from: edgeF + Math.max(0, d), delta: -d } : { from: edgeF, delta: d });
    return {
      edge: edgeF,
      valid: (d) => {
        const { from, delta } = shift(d);
        return rippleValid(g, project, build(d), tracks, from, delta);
      },
      apply: (d) => {
        const plan = build(d);
        const { from, delta } = shift(d);
        applyPlan(g, plan);
        shiftFrom(g, tracks, from, delta, new Set(plan.keys()));
      },
    };
  }

  const build = (d: number): Plan => {
    const plan: Plan = new Map();
    for (const p of parts) {
      const it = baseItem(g, p.clip, p.track);
      if (edge === 'start') editHead(g, project, it, d);
      else editTail(g, project, it, d);
      plan.set(p.clip, it);
    }
    return plan;
  };
  return { edge: edgeF, valid: (d) => planValid(g, project, build(d)), apply: (d) => applyPlan(g, build(d)) };
}

function rollPlanner(g: Grid, project: Project | undefined, seq: Sequence, f: Located, nb: Clip, edge: 'start' | 'end', edgeF: number, opts: TrimOptions): Planner {
  // L = clips whose tail moves, R = clips whose head moves.
  const L = new Map<Clip, Track>();
  const R = new Map<Clip, Track>();
  if (edge === 'end') {
    L.set(f.clip, f.track);
    R.set(nb, f.track);
  } else {
    R.set(f.clip, f.track);
    L.set(nb, f.track);
  }
  for (let pass = 0; pass < 8; pass++) {
    let grew = false;
    const add = (m: Map<Clip, Track>, c: Clip, t: Track) => {
      if (L.has(c) || R.has(c) || t.locked) return;
      m.set(c, t);
      grew = true;
    };
    for (const [c, t] of [...L]) {
      if (!opts.unlinked) for (const p of partnersOf(seq, c)) add(L, p.clip, p.track);
      const n = adjacent(g, t, c, 'end');
      if (n) add(R, n, t);
    }
    for (const [c, t] of [...R]) {
      if (!opts.unlinked) for (const p of partnersOf(seq, c)) add(R, p.clip, p.track);
      const n = adjacent(g, t, c, 'start');
      if (n) add(L, n, t);
    }
    if (!grew) break;
  }
  const build = (d: number): Plan => {
    const plan: Plan = new Map();
    for (const [c, t] of L) plan.set(c, editTail(g, project, baseItem(g, c, t), d));
    for (const [c, t] of R) plan.set(c, editHead(g, project, baseItem(g, c, t), d));
    return plan;
  };
  return { edge: edgeF, valid: (d) => planValid(g, project, build(d)), apply: (d) => applyPlan(g, build(d)) };
}

function trimImpl(project: Project | undefined, seq: Sequence, clipId: string, edge: 'start' | 'end', time: number, mode: TrimMode, opts: TrimOptions): number {
  const pl = trimPlanner(project, seq, clipId, edge, mode, opts);
  if (!pl || !Number.isFinite(time)) return 0;
  const g = gridOf(seq);
  const d = clampSearch(g.F(time) - pl.edge, pl.valid);
  if (d) pl.apply(d);
  return g.T(d);
}

/**
 * Trims one edge to `time`, clamped to what is allowed (≥ 1 frame, source
 * limits, neighbours, sync lock).
 *  - 'normal': the edge moves; it can't overlap a neighbour.
 *  - 'ripple': the clip keeps its start; its length changes and everything
 *    after the edit point moves on every unlocked track (sync lock).
 *  - 'roll': the edit point shared with the adjacent clip moves (both clips
 *    change); without an adjacent clip it is a normal trim.
 * Linked partners trim by the same amount. Returns the applied edge delta
 * in seconds (0 when blocked).
 *
 * For Q/W across several unlinked tracks prefer trimToPlayhead(), which
 * trims all targeted tracks in one sync-safe edit.
 */
export function trimClip(project: Project, seq: Sequence, clipId: string, edge: 'start' | 'end', time: number, mode: TrimMode, opts: TrimOptions = {}): number {
  return runEdit([seq], () => trimImpl(project, seq, clipId, edge, time, mode, opts));
}

/**
 * The range the edge can be trimmed to with this mode, as absolute times
 * (±Infinity when unlimited). For drawing trim limits while dragging.
 */
export function trimRange(project: Project, seq: Sequence, clipId: string, edge: 'start' | 'end', mode: TrimMode, opts: TrimOptions = {}): { min: number; max: number } | null {
  const pl = trimPlanner(project, seq, clipId, edge, mode, opts);
  if (!pl) return null;
  const g = gridOf(seq);
  const BIG = 1e7;
  const lo = clampSearch(-BIG, pl.valid);
  const hi = clampSearch(BIG, pl.valid);
  return { min: lo <= -BIG ? -Infinity : g.T(pl.edge + lo), max: hi >= BIG ? Infinity : g.T(pl.edge + hi) };
}

/**
 * Slip: changes the source in/out by `sourceDelta` source seconds without
 * moving the clip (linked partners too), clamped to the source. Keyframes
 * stay with the timeline. On a freeze frame it changes the held frame.
 * Returns the applied source delta.
 */
export function slipClip(project: Project, seq: Sequence, clipId: string, sourceDelta: number, opts: LinkOptions = {}): number {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const f = locate(seq, clipId);
    if (!f || f.track.locked || !Number.isFinite(sourceDelta)) return 0;
    const parts = participants(seq, f, opts.unlinked);
    // the dragged clip's new in point lands on the frame grid; partners move by the same amount
    const hold = f.clip.holdFrame !== null && f.clip.holdFrame !== undefined;
    const from = hold ? f.clip.holdFrame! : f.clip.inPoint;
    let d = g.T(g.F(from + sourceDelta)) - from;
    if (Math.abs(d) < 1e-9) return 0;
    let lo = -Infinity;
    let hi = Infinity;
    for (const p of parts) {
      const c = p.clip;
      if (c.holdFrame !== null && c.holdFrame !== undefined) {
        const lim = sourceLimit(project, { ...c, holdFrame: null } as Clip);
        lo = Math.max(lo, -c.holdFrame);
        if (lim !== Infinity) hi = Math.min(hi, lim - g.T(1) - c.holdFrame);
        continue;
      }
      if (!isTimed(project, c)) continue;
      const lim = sourceLimit(project, c);
      lo = Math.max(lo, -c.inPoint);
      if (lim !== Infinity) hi = Math.min(hi, lim - (c.inPoint + spanFor(c, c.duration)));
    }
    if (lo > hi + 1e-9) return 0;
    d = clamp(d, lo, hi);
    if (Math.sign(d) !== Math.sign(sourceDelta) || Math.abs(d) < 1e-9) return 0;
    for (const p of parts) {
      const c = p.clip;
      if (c.holdFrame !== null && c.holdFrame !== undefined) c.holdFrame = Math.max(0, c.holdFrame + d);
      else if (isTimed(project, c)) c.inPoint = cleanInPoint(g, c.inPoint + d);
    }
    return d;
  });
}

/**
 * Slide: moves the clip by `delta` between its neighbours, which give and
 * take frames at the adjacent edges (within their handles and ≥ 1 frame).
 * A side with a gap just changes the gap. Returns the applied delta.
 */
export function slideClip(project: Project, seq: Sequence, clipId: string, delta: number, opts: LinkOptions = {}): number {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const f = locate(seq, clipId);
    if (!f || f.track.locked || !Number.isFinite(delta)) return 0;
    const parts = participants(seq, f, opts.unlinked);
    const partSet = new Set(parts.map((p) => p.clip));
    const build = (d: number): Plan => {
      const plan: Plan = new Map();
      for (const p of parts) {
        const it = baseItem(g, p.clip, p.track);
        it.s += d;
        it.e += d;
        plan.set(p.clip, it);
        const prev = adjacent(g, p.track, p.clip, 'start');
        if (prev && !partSet.has(prev)) plan.set(prev, editTail(g, project, baseItem(g, prev, p.track), d));
        const next = adjacent(g, p.track, p.clip, 'end');
        if (next && !partSet.has(next)) plan.set(next, editHead(g, project, baseItem(g, next, p.track), d));
      }
      return plan;
    };
    const d = clampSearch(g.F(delta), (x) => planValid(g, project, build(x)));
    if (d) applyPlan(g, build(d));
    return g.T(d);
  });
}

/**
 * Rate stretch: drags an edge to `time` and changes the speed so the same
 * source range fills the new length (0.01–100×; keyframes scale with it).
 * Can't overlap neighbours. Linked partners stretch too. Returns the
 * applied edge delta.
 */
export function rateStretch(project: Project, seq: Sequence, clipId: string, edge: 'start' | 'end', time: number, opts: LinkOptions = {}): number {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const f = locate(seq, clipId);
    if (!f || f.track.locked || !Number.isFinite(time)) return 0;
    const parts = participants(seq, f, opts.unlinked);
    const spans = parts.map((p) => spanFor(p.clip, g.T(endF(g, p.clip) - startF(g, p.clip))));
    const edgeF = edge === 'start' ? startF(g, f.clip) : endF(g, f.clip);
    const build = (d: number): Plan => {
      const plan: Plan = new Map();
      for (const p of parts) {
        const it = baseItem(g, p.clip, p.track);
        if (edge === 'start') it.s += d;
        else it.e += d;
        plan.set(p.clip, it);
      }
      return plan;
    };
    const valid = (d: number) => {
      const plan = build(d);
      if (!planValid(g, project, plan, { source: false })) return false;
      return parts.every((p, i) => {
        if (!isTimed(project, p.clip) || !(spans[i] > 0)) return true;
        const it = plan.get(p.clip)!;
        const sp = spans[i] / g.T(it.e - it.s);
        return sp >= MIN_SPEED - 1e-9 && sp <= MAX_SPEED + 1e-9;
      });
    };
    const d = clampSearch(g.F(time) - edgeF, valid);
    if (!d) return 0;
    const plan = build(d);
    parts.forEach((p, i) => {
      const c = p.clip;
      const it = plan.get(c)!;
      const oldDur = g.T(endF(g, c) - startF(g, c));
      const newDur = g.T(it.e - it.s);
      const r = newDur / oldDur;
      scaleKfs(c, r);
      if (isTimed(project, c) && spans[i] > 0) c.speed = speedKfs(c) ? c.speed / r : spans[i] / newDur;
    });
    applyPlan(g, plan);
    return g.T(d);
  });
}

// ---- cutting & deleting ------------------------------------------------------

/**
 * Splits clips at `time`. clipIds null = every clip under the time on
 * targeted, unlocked tracks. Linked partners under the time split too; the
 * right halves of a linked pair share a fresh linkId. Returns the ids of
 * the new right halves.
 */
export function splitAt(seq: Sequence, clipIds: string[] | null, time: number, opts: LinkOptions = {}): string[] {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const t = g.F(time);
    const under = (l: Located) => !l.track.locked && startF(g, l.clip) < t && endF(g, l.clip) > t;
    let targets: Located[];
    if (clipIds === null) {
      const base = allClips(seq).filter((l) => l.track.targeted && under(l));
      targets = opts.unlinked ? base : expand(seq, base.map((l) => l.clip.id), { links: true, groups: false }).filter(under);
    } else {
      targets = expand(seq, clipIds, { links: !opts.unlinked, groups: false }).filter(under);
    }
    const ids: string[] = [];
    for (const l of targets) {
      const r = splitClip(g, undefined, l.track, l.clip, t);
      if (r) ids.push(r.id);
    }
    return ids;
  });
}

/** Add Edit Through All Tracks: splits every clip under `time` on every unlocked track. */
export function splitAllTracks(seq: Sequence, time: number): string[] {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const t = g.F(time);
    const ids: string[] = [];
    for (const l of allClips(seq)) {
      if (l.track.locked || startF(g, l.clip) >= t || endF(g, l.clip) <= t) continue;
      const r = splitClip(g, undefined, l.track, l.clip, t);
      if (r) ids.push(r.id);
    }
    return ids;
  });
}

function unionDesc(ranges: { a: number; b: number }[]): [number, number][] {
  const sorted = [...ranges].sort((x, y) => x.a - y.a);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.a <= last[1]) last[1] = Math.max(last[1], r.b);
    else out.push([r.a, r.b]);
  }
  return out.reverse();
}

export interface DeleteOptions extends LinkOptions {
  /** false = close the gaps only on the tracks the clips were on. */
  syncLock?: boolean;
}

/**
 * Deletes clips (and their linked partners). Ripple closes the time they
 * occupied on every unlocked track (sync lock), as far as other tracks
 * allow without collisions.
 */
export function deleteClips(seq: Sequence, clipIds: string[], ripple: boolean, opts: DeleteOptions = {}): void {
  runEdit([seq], () => {
    const g = gridOf(seq);
    const targets = expand(seq, clipIds, { links: !opts.unlinked, groups: false });
    if (!targets.length) return;
    const ranges = targets.map((l) => ({ track: l.track, a: startF(g, l.clip), b: endF(g, l.clip) }));
    for (const l of targets) removeClip(l.track, l.clip);
    if (!ripple) return;
    if (opts.syncLock === false) {
      for (const tr of new Set(ranges.map((r) => r.track))) for (const [a, b] of unionDesc(ranges.filter((r) => r.track === tr))) closeRange(g, [tr], a, b);
    } else {
      const tracks = unlockedTracks(seq);
      for (const [a, b] of unionDesc(ranges)) closeRange(g, tracks, a, b);
    }
  });
}

/**
 * Removes [inT,outT) from the given tracks (default: targeted, unlocked),
 * leaving a gap (lift) or closing it (extract). Extract closes on every
 * unlocked track (sync lock) unless opts.syncLock is false.
 */
export function removeRange(seq: Sequence, inT: number, outT: number, ripple: boolean, trackIds?: string[], opts: { syncLock?: boolean } = {}): void {
  runEdit([seq], () => {
    const g = gridOf(seq);
    const a = Math.max(0, g.F(Math.min(inT, outT)));
    const b = g.F(Math.max(inT, outT));
    if (!(b > a)) return;
    const tracks = (trackIds ? seq.tracks.filter((t) => trackIds.includes(t.id)) : seq.tracks.filter((t) => t.targeted)).filter((t) => !t.locked);
    if (!tracks.length) return;
    for (const tr of tracks) clearRange(g, undefined, tr, a, b);
    if (ripple) closeRange(g, opts.syncLock === false ? tracks : unlockedTracks(seq), a, b);
  });
}

/** Lift (;): removes the sequence In–Out on targeted tracks, leaving a gap; without In/Out, deletes the given clips. */
export function liftSelection(seq: Sequence, clipIds: string[] = []): boolean {
  return liftOrExtract(seq, clipIds, false);
}

/** Extract ('): like lift but closes the gap (sync lock). */
export function extractSelection(seq: Sequence, clipIds: string[] = []): boolean {
  return liftOrExtract(seq, clipIds, true);
}

function liftOrExtract(seq: Sequence, clipIds: string[], ripple: boolean): boolean {
  if (seq.inPoint !== null && seq.outPoint !== null && seq.outPoint > seq.inPoint) {
    removeRange(seq, seq.inPoint, seq.outPoint, ripple);
    return true;
  }
  if (clipIds.length) {
    deleteClips(seq, clipIds, ripple);
    return true;
  }
  return false;
}

/** Gaps of a track in frames, including the one before the first item. */
function gapsOf(g: Grid, tr: Track): [number, number][] {
  const iv = tr.kind === 'caption' ? tr.cues.map((q) => [g.F(q.start), g.F(q.end)] as [number, number]) : tr.clips.map((c) => [startF(g, c), endF(g, c)] as [number, number]);
  iv.sort((x, y) => x[0] - y[0]);
  const gaps: [number, number][] = [];
  let cursor = 0;
  for (const [s, e] of iv) {
    if (s > cursor) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  return gaps;
}

/**
 * Closes the gap at `time` on a track (or all gaps on the track when time
 * is null), moving later material on every unlocked track (sync lock; a
 * track that can't follow limits the close). Returns the seconds closed.
 */
export function closeGap(seq: Sequence, trackId: string, time: number | null, opts: { syncLock?: boolean } = {}): number {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const tr = seq.tracks.find((t) => t.id === trackId);
    if (!tr || tr.locked) return 0;
    const tracks = opts.syncLock === false ? [tr] : unlockedTracks(seq);
    const gaps = gapsOf(g, tr);
    let closed = 0;
    if (time === null || time === undefined) {
      for (const [a, b] of [...gaps].reverse()) closed += closeRange(g, tracks, a, b);
    } else {
      const t = g.F(time);
      const gap = gaps.find(([a, b]) => t >= a && t < b);
      if (gap) closed = closeRange(g, tracks, gap[0], gap[1]);
    }
    return g.T(closed);
  });
}

/** Ripple-deletes the gap under `time` on a track (sync lock). */
export function rippleDeleteGap(seq: Sequence, trackId: string, time: number): number {
  return closeGap(seq, trackId, time);
}

/**
 * Magnetic timeline: removes every gap that is empty on all of the given
 * tracks (one id, a list, or default every unlocked track), including the
 * gap before the first clip, so those tracks stay in sync with each other.
 * Returns the seconds removed.
 */
export function closeAllGaps(seq: Sequence, trackIds?: string | string[]): number {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const ids = trackIds === undefined || trackIds === null ? null : new Set(Array.isArray(trackIds) ? trackIds : [trackIds]);
    const tracks = seq.tracks.filter((t) => !t.locked && (!ids || ids.has(t.id)));
    if (!tracks.length) return 0;
    const iv: [number, number][] = [];
    for (const tr of tracks) {
      for (const c of tr.clips) iv.push([startF(g, c), endF(g, c)]);
      for (const q of tr.cues) iv.push([g.F(q.start), g.F(q.end)]);
    }
    iv.sort((x, y) => x[0] - y[0]);
    const gaps: [number, number][] = [];
    let cursor = 0;
    for (const [s, e] of iv) {
      if (s > cursor) gaps.push([cursor, s]);
      cursor = Math.max(cursor, e);
    }
    let total = 0;
    for (const [a, b] of gaps.reverse()) {
      shiftFrom(g, tracks, b, -(b - a));
      total += b - a;
    }
    return g.T(total);
  });
}

/** Inserts `duration` of empty time at `time` (split + push right) on the given tracks or every unlocked track. */
export function insertGap(seq: Sequence, time: number, duration: number, trackIds?: string[]): void {
  runEdit([seq], () => {
    const g = gridOf(seq);
    const P = Math.max(0, g.F(time));
    const W = g.F(duration);
    if (!(W > 0)) return;
    const tracks = trackIds ? seq.tracks.filter((t) => trackIds.includes(t.id) && !t.locked) : unlockedTracks(seq);
    insertSpace(g, undefined, tracks, P, W, { split: true });
  });
}

// ---- time ----------------------------------------------------------------------

export interface SpeedOptions extends LinkOptions {
  reverse?: boolean;
  ripple?: boolean;
  keepDuration?: boolean;
}

/**
 * Constant speed change (0.01–100×), optional reverse. Speed ramps are
 * removed. keepDuration keeps the length (the source range changes);
 * otherwise the length becomes span/speed. ripple pushes or pulls later
 * clips (sync lock); without it a longer clip stops at the next clip.
 * Linked partners change too.
 */
export function setSpeed(project: Project, seq: Sequence, clipId: string, speed: number, opts: SpeedOptions = {}): void {
  runEdit([seq], () => {
    const g = gridOf(seq);
    const f = locate(seq, clipId);
    if (!f || f.track.locked) return;
    const parts = participants(seq, f, opts.unlinked);
    const sp = clamp(Number.isFinite(speed) && speed > 0 ? speed : 1, MIN_SPEED, MAX_SPEED);
    const want = new Map<Clip, number>();
    for (const p of parts) {
      const c = p.clip;
      const s = startF(g, c);
      const d0 = endF(g, c) - s;
      let d = d0;
      if (isTimed(project, c)) {
        if (!opts.keepDuration) {
          const span = spanFor(c, g.T(d0));
          d = Math.max(1, Math.round(span * g.rate / sp - 1e-9));
        }
        const lim = sourceLimit(project, c);
        if (lim !== Infinity) {
          const maxF = Math.max(1, framesFor(g, (lim - c.inPoint) / sp));
          if (d > maxF) d = maxF;
        }
      }
      want.set(c, d);
    }
    const primaryEnd = endF(g, f.clip);
    const primaryDelta = (want.get(f.clip) ?? 0) - (primaryEnd - startF(g, f.clip));
    const buildPlan = (): Plan => {
      const plan: Plan = new Map();
      for (const p of parts) {
        const it = baseItem(g, p.clip, p.track);
        it.e = it.s + want.get(p.clip)!;
        plan.set(p.clip, it);
      }
      return plan;
    };
    const tracks = unlockedTracks(seq);
    let shift = 0;
    if (opts.ripple && primaryDelta) {
      shift = primaryDelta;
      if (!rippleValid(g, project, buildPlan(), tracks, primaryEnd, shift) && shift < 0) {
        const plan = buildPlan();
        const over = new Map([...plan].map(([c, it]) => [c, { s: it.s, e: it.e }]));
        shift = -Math.min(-shift, pullAvail(g, tracks, primaryEnd, new Set(plan.keys()), over));
      }
      if (!rippleValid(g, project, buildPlan(), tracks, primaryEnd, shift)) shift = 0;
    }
    if (!shift) {
      // no ripple: a longer clip stops at the next one on its track
      for (const p of parts) {
        const s = startF(g, p.clip);
        let next = Infinity;
        for (const o of p.track.clips) if (o !== p.clip && startF(g, o) >= s) next = Math.min(next, startF(g, o));
        const d0 = endF(g, p.clip) - s;
        const d = want.get(p.clip)!;
        if (d > d0 && s + d > next) want.set(p.clip, Math.max(d0, next - s));
      }
    }
    const plan = buildPlan();
    for (const p of parts) {
      const c = p.clip;
      const d0 = endF(g, c) - startF(g, c);
      const d = want.get(c)!;
      if (c.keyframes['time.speed']) delete c.keyframes['time.speed'];
      if (d !== d0) scaleKfs(c, d / d0);
      if (c.speed !== sp) c.speed = sp;
      if (opts.reverse !== undefined && c.reverse !== opts.reverse) c.reverse = opts.reverse;
    }
    applyPlan(g, plan);
    if (shift) shiftFrom(g, tracks, primaryEnd, shift, new Set(plan.keys()));
  });
}

/**
 * Inserts a freeze frame of the frame under `time` lasting `duration`: the
 * clip is split there and a hold segment (holdFrame) is inserted, pushing
 * everything later right on every unlocked track (its sound gets a gap).
 * Returns the hold clip's id ('' when nothing to freeze).
 */
export function freezeFrame(project: Project, seq: Sequence, clipId: string, time: number, duration: number): string {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    let f = locate(seq, clipId);
    if (!f || f.track.locked) return '';
    if (f.track.kind !== 'video') {
      const v = partnersOf(seq, f.clip).find((p) => p.track.kind === 'video');
      if (!v) return '';
      f = v;
    }
    const c = f.clip;
    const s = startF(g, c);
    const e = endF(g, c);
    const t = clamp(Number.isFinite(time) ? g.F(time) : s, s, e - 1);
    const src = sourceTimeAt(c, g.T(t - s));
    const d = Math.max(1, g.F(fin(duration, 2)));
    const hold = cloneClip(c);
    insertSpace(g, project, unlockedTracks(seq), t, d, { split: true });
    hold.id = newId('clip');
    setSpan(g, hold, t, t + d);
    hold.holdFrame = src;
    hold.inPoint = src;
    hold.speed = 1;
    hold.reverse = false;
    delete hold.keyframes['time.speed'];
    shiftKfs(g, hold, -(t - s));
    hold.transitionIn = null;
    hold.transitionOut = null;
    hold.fadeIn = 0;
    hold.fadeOut = 0;
    delete hold.linkId;
    f.track.clips.push(hold);
    return hold.id;
  });
}

// ---- structure -----------------------------------------------------------------

function uniqueSeqName(project: Project, name?: string): string {
  const names = new Set(project.sequences.map((s) => s.name));
  const base = name?.trim() || 'Nested Sequence';
  if (name?.trim() && !names.has(base)) return base;
  for (let n = 1; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** A track of `kind` free over [s,e): the preferred one, else the nearest one away from the divide, else any, else a new one. */
function freeTrack(g: Grid, seq: Sequence, kind: TrackKind, preferred: Track | undefined, s: number, e: number): Track {
  const list = stackFromBase(seq, kind);
  const from = preferred ? Math.max(0, list.indexOf(preferred)) : 0;
  for (let i = from; i < list.length; i++) if (!list[i].locked && !occupied(g, list[i], s, e)) return list[i];
  for (let i = from - 1; i >= 0; i--) if (!list[i].locked && !occupied(g, list[i], s, e)) return list[i];
  return addTrackImpl(seq, kind);
}

/**
 * Moves the clips (and their linked partners) into a new sequence of the
 * same format, shifted to start at 0 with their relative tracks kept, and
 * replaces them with one clip of kind 'sequence' (plus a linked 'sequence'
 * clip on an audio track when the nest has sound). Returns the new
 * sequence id ('' when nothing to nest).
 */
export function nestClips(project: Project, seq: Sequence, clipIds: string[], name?: string): string {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const items = expand(seq, clipIds, { links: true, groups: false });
    if (!items.length) return '';
    const snap = snapshot(seq);
    const t0 = Math.min(...items.map((i) => startF(g, i.clip)));
    const t1 = Math.max(...items.map((i) => endF(g, i.clip)));
    const vids = ofKind(seq, 'video');
    const auds = ofKind(seq, 'audio');
    const usedV = items.filter((i) => i.track.kind === 'video').map((i) => vids.indexOf(i.track));
    const usedA = items.filter((i) => i.track.kind === 'audio').map((i) => auds.indexOf(i.track));
    const vBottom = usedV.length ? Math.max(...usedV) : 0;
    const vTop = usedV.length ? Math.min(...usedV) : 0;
    const aTop = usedA.length ? Math.min(...usedA) : 0;
    const aBottom = usedA.length ? Math.max(...usedA) : 0;
    const nV = vBottom - vTop + 1;
    const nA = aBottom - aTop + 1;

    const nested = makeSequence({ width: seq.width, height: seq.height, fps: seq.fps, dropFrame: seq.dropFrame, sampleRate: seq.sampleRate, colorSpace: seq.colorSpace }, uniqueSeqName(project, name));
    nested.background = seq.background;
    const nVideo: Track[] = [];
    for (let j = nV; j >= 1; j--) nVideo.push(makeTrack('video', `V${j}`));
    const nAudio: Track[] = [];
    for (let j = 1; j <= nA; j++) nAudio.push(makeTrack('audio', `A${j}`));
    nested.tracks = [...nVideo, ...nAudio];

    for (const it of items) {
      const copy = cloneClip(it.clip);
      setSpan(g, copy, startF(g, it.clip) - t0, endF(g, it.clip) - t0);
      const dest = it.track.kind === 'video' ? nVideo[nVideo.length - 1 - (vBottom - vids.indexOf(it.track))] : nAudio[auds.indexOf(it.track) - aTop];
      dest.clips.push(copy);
      removeClip(it.track, it.clip);
    }
    for (const tr of nested.tracks) tr.clips.sort((a, b) => a.start - b.start);

    const mk = () => makeClip('sequence', { start: g.T(t0), duration: g.T(t1 - t0), inPoint: 0, sequenceId: nested.id, name: nested.name });
    let vClip: Clip | null = null;
    let aClip: Clip | null = null;
    if (usedV.length) {
      vClip = mk();
      freeTrack(g, seq, 'video', vids[vBottom], t0, t1).clips.push(vClip);
    }
    if (usedA.length) {
      aClip = mk();
      freeTrack(g, seq, 'audio', auds[aTop], t0, t1).clips.push(aClip);
    }
    if (vClip && aClip) vClip.linkId = aClip.linkId = newId('link');
    finalize(nested, snap);
    project.sequences.push(nested);
    return nested.id;
  });
}

/**
 * Un-nest: replaces a nested-sequence clip (and its linked audio nest clip)
 * with the clips of that sequence, trimmed to the range it used and placed
 * on the tracks it sits on (upwards for video, downwards for audio),
 * overwriting what is there. Constant speeds are carried into the clips;
 * reversed, ramped or frozen nest clips are refused. The nested sequence
 * is removed when nothing else uses it (clips then keep their ids, so
 * nest → unnest round-trips). Returns the restored clip ids.
 */
export function unnestClip(project: Project, seq: Sequence, clipId: string): string[] {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const f = locate(seq, clipId);
    if (!f || f.track.locked || f.clip.kind !== 'sequence' || !f.clip.sequenceId) return [];
    const nested = project.sequences.find((s) => s.id === f.clip.sequenceId);
    if (!nested || nested.id === seq.id) return [];
    const group = [f, ...partnersOf(seq, f.clip).filter((p) => p.clip.kind === 'sequence' && p.clip.sequenceId === nested.id)];
    if (group.some((p) => p.clip.reverse || (p.clip.holdFrame !== null && p.clip.holdFrame !== undefined) || speedKfs(p.clip))) return [];
    const vRef = group.find((p) => p.track.kind === 'video') ?? null;
    const aRef = group.find((p) => p.track.kind === 'audio') ?? null;
    const ng = gridOf(nested);
    const groupClips = new Set(group.map((p) => p.clip));
    const otherRefs = project.sequences.some((s) => s.tracks.some((t) => t.clips.some((c) => c.kind === 'sequence' && c.sequenceId === nested.id && !groupClips.has(c))));
    const dropNested = !otherRefs && project.activeSequenceId !== nested.id;
    const links = new Map<string, string>();
    const groups = new Map<string, string>();

    const nVids = ofKind(nested, 'video');
    const nAuds = ofKind(nested, 'audio');
    const pieces: { clip: Clip; kind: TrackKind; k: number; s: number; e: number }[] = [];
    for (const tr of [...nVids, ...nAuds]) {
      const ref = (tr.kind === 'video' ? (vRef ?? aRef) : (aRef ?? vRef))!;
      const rc = ref.clip;
      const sp = rc.speed > 0 ? rc.speed : 1;
      const w0 = rc.inPoint;
      const W0 = ng.F(w0);
      const W1 = ng.F(w0 + rc.duration * sp);
      const list = sortedClips(tr);
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        const ns = startF(ng, n);
        const ne = endF(ng, n);
        const lo = Math.max(ns, W0);
        const hi = Math.min(ne, W1);
        if (hi <= lo) continue;
        const piece = cloneClip(n);
        if (!dropNested) {
          piece.id = newId('clip');
          remapIds(piece, links, groups);
        }
        const prevAdj = i > 0 && endF(ng, list[i - 1]) === ns;
        if (lo > ns) trimHeadTo(ng, project, piece, lo);
        if (hi < ne) trimTailTo(ng, project, piece, hi);
        if (lo > ns || (prevAdj && endF(ng, list[i - 1]) <= W0)) piece.transitionIn = null;
        const ps = g.F(rc.start + (ng.T(lo) - w0) / sp);
        const pe = g.F(rc.start + (ng.T(hi) - w0) / sp);
        if (pe <= ps) continue;
        if (sp !== 1) {
          scaleKfs(piece, 1 / sp);
          piece.speed *= sp;
        }
        setSpan(g, piece, ps, pe);
        const k = tr.kind === 'video' ? nVids.length - 1 - nVids.indexOf(tr) : nAuds.indexOf(tr);
        pieces.push({ clip: piece, kind: tr.kind, k, s: ps, e: pe });
      }
    }

    const baseOf = (kind: TrackKind, ref: Located | null) => (ref && ref.track.kind === kind ? stackFromBase(seq, kind).indexOf(ref.track) : 0);
    const vBase = baseOf('video', vRef);
    const aBase = baseOf('audio', aRef);
    for (const p of group) removeClip(p.track, p.clip);
    const ids: string[] = [];
    for (const pc of pieces) {
      const dest = nthTrackFrom(seq, pc.kind, pc.kind === 'video' ? vBase : aBase, pc.k);
      clearRange(g, project, dest, pc.s, pc.e);
      dest.clips.push(pc.clip);
      ids.push(pc.clip.id);
    }
    if (dropNested) {
      const i = project.sequences.indexOf(nested);
      if (i >= 0) project.sequences.splice(i, 1);
    }
    return ids;
  });
}

/**
 * Duplicates clips (with their linked partners) `offset` seconds later on
 * the same tracks, overwriting what is there. Copies get fresh ids and
 * fresh shared link/group ids. Returns the new ids.
 */
export function duplicateClips(seq: Sequence, clipIds: string[], offset: number): string[] {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const src = expand(seq, clipIds, { links: true, groups: false });
    if (!src.length) return [];
    let dF = Number.isFinite(offset) ? g.F(offset) : 0;
    const minS = Math.min(...src.map((l) => startF(g, l.clip)));
    if (minS + dF < 0) dF = -minS;
    const links = new Map<string, string>();
    const groups = new Map<string, string>();
    const copies = src.map((l) => {
      const c = cloneClip(l.clip);
      c.id = newId('clip');
      remapIds(c, links, groups);
      setSpan(g, c, startF(g, l.clip) + dF, endF(g, l.clip) + dF);
      return { c, track: l.track };
    });
    for (const { c, track } of copies) clearRange(g, undefined, track, startF(g, c), endF(g, c));
    for (const { c, track } of copies) track.clips.push(c);
    return copies.map((x) => x.c.id);
  });
}

/**
 * Pastes clipboard clips (times relative to the earliest copied clip) at
 * `time`. Video lands from the lowest targeted video track upwards, audio
 * from the topmost targeted audio track downwards, keeping the clips'
 * relative tracks (trackIndex = index among tracks of that kind; tracks are
 * added when needed). Overwrite or insert (sync lock). Fresh ids, link and
 * group ids. Returns the new ids.
 */
export function pasteClips(seq: Sequence, clips: { clip: Clip; trackIndex: number; trackKind: TrackKind }[], time: number, mode: EditMode): string[] {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const entries = (clips ?? []).filter((e) => e && e.clip && (e.trackKind === 'video' || e.trackKind === 'audio'));
    if (!entries.length) return [];
    const base = Math.min(...entries.map((e) => g.F(e.clip.start)));
    const P = Math.max(0, g.F(fin(time, 0)));
    const dest = new Map<string, Track>();
    for (const kind of ['video', 'audio'] as const) {
      const es = entries.filter((e) => e.trackKind === kind);
      if (!es.length) continue;
      const idxs = [...new Set(es.map((e) => e.trackIndex))];
      const ref = kind === 'video' ? Math.max(...idxs) : Math.min(...idxs);
      const list = stackFromBase(seq, kind);
      let b = list.findIndex((t) => t.targeted && !t.locked);
      if (b < 0) b = list.findIndex((t) => !t.locked);
      if (b < 0) b = list.length;
      for (const idx of idxs) dest.set(`${kind}:${idx}`, nthTrackFrom(seq, kind, b, kind === 'video' ? ref - idx : idx - ref));
    }
    const links = new Map<string, string>();
    const groups = new Map<string, string>();
    const pieces = entries.map((e) => {
      const c = cloneClip(e.clip);
      c.id = newId('clip');
      remapIds(c, links, groups);
      const s = P + g.F(e.clip.start) - base;
      const d = Math.max(1, endF(g, e.clip) - startF(g, e.clip));
      return { c, s, e: s + d, track: dest.get(`${e.trackKind}:${e.trackIndex}`)! };
    });
    if (mode === 'insert') {
      const W = Math.max(...pieces.map((p) => p.e)) - P;
      insertSpace(g, undefined, unlockedTracks(seq), P, W, { split: true });
    } else {
      for (const p of pieces) clearRange(g, undefined, p.track, p.s, p.e);
    }
    for (const p of pieces) {
      setSpan(g, p.c, p.s, p.e);
      p.track.clips.push(p.c);
    }
    return pieces.map((p) => p.c.id);
  });
}

/** Links the clips (fresh shared linkId); needs two or more. */
export function linkClips(seq: Sequence, clipIds: string[]): void {
  runEdit([seq], () => {
    const list = expand(seq, clipIds, { links: false, groups: false });
    if (list.length < 2) return;
    const id = newId('link');
    for (const l of list) l.clip.linkId = id;
  });
}

/** Unlinks the clips (and the rest of their linked sets). */
export function unlinkClips(seq: Sequence, clipIds: string[]): void {
  runEdit([seq], () => {
    for (const l of expand(seq, clipIds, { links: true, groups: false })) if (l.clip.linkId) delete l.clip.linkId;
  });
}

/** Groups the clips (fresh shared groupId); needs two or more. */
export function groupClips(seq: Sequence, clipIds: string[]): void {
  runEdit([seq], () => {
    const list = expand(seq, clipIds, { links: false, groups: false });
    if (list.length < 2) return;
    const id = newId('group');
    for (const l of list) l.clip.groupId = id;
  });
}

/** Ungroups the clips' whole groups. */
export function ungroupClips(seq: Sequence, clipIds: string[]): void {
  runEdit([seq], () => {
    for (const l of expand(seq, clipIds, { links: false, groups: true })) if (l.clip.groupId) delete l.clip.groupId;
  });
}

/** Room for a transition in frames: half on each side of the cut, clear of the clips' other transitions. */
function maxTransitionFrames(g: Grid, track: Track, clip: Clip, field: 'transitionIn' | 'transitionOut'): number {
  const d = endF(g, clip) - startF(g, clip);
  const half = (t: { duration: number } | null | undefined) => (t ? g.F(t.duration) / 2 : 0);
  if (field === 'transitionIn') {
    const prev = adjacent(g, track, clip, 'start');
    const next = adjacent(g, track, clip, 'end');
    let room = d - (next ? half(next.transitionIn) : half(clip.transitionOut));
    if (prev) room = Math.min(room, endF(g, prev) - startF(g, prev) - half(prev.transitionIn));
    return Math.max(1, Math.floor(2 * room));
  }
  return Math.max(1, Math.floor(2 * (d - half(clip.transitionIn))));
}

/**
 * Adds a transition at a clip edge. 'start' sets transitionIn (a cross
 * transition when the previous clip is adjacent, else from nothing). 'end'
 * sets the next adjacent clip's transitionIn, or transitionOut (to nothing)
 * when nothing follows. The duration is clamped so each half fits inside
 * its clip; missing source handles are allowed (the renderer holds the edge
 * frame). Audio tracks always get 'audioCrossfade'. duration ≤ 0 removes it.
 */
export function addTransition(seq: Sequence, clipId: string, edge: 'start' | 'end', type: TransitionType, duration: number): void {
  runEdit([seq], () => {
    const g = gridOf(seq);
    const f = locate(seq, clipId);
    if (!f || f.track.locked) return;
    let target = f.clip;
    let field: 'transitionIn' | 'transitionOut' = 'transitionIn';
    if (edge === 'end') {
      const nx = adjacent(g, f.track, f.clip, 'end');
      if (nx) target = nx;
      else field = 'transitionOut';
    }
    let d = Number.isFinite(duration) ? g.F(duration) : 0;
    if (!(d > 0)) {
      if (target[field]) target[field] = null;
      return;
    }
    const ty: TransitionType = f.track.kind === 'audio' ? 'audioCrossfade' : type === 'audioCrossfade' ? 'crossDissolve' : type;
    d = Math.max(1, Math.min(d, maxTransitionFrames(g, f.track, target, field)));
    const prev = target[field];
    const tr = makeTransition(ty, g.T(d));
    if (prev && prev.type === ty) {
      tr.params = { ...prev.params };
      tr.ease = prev.ease;
    }
    target[field] = tr;
  });
}

/** Removes the transition at a clip edge (the follower's head transition for 'end' when one is adjacent). */
export function removeTransition(seq: Sequence, clipId: string, edge: 'start' | 'end'): void {
  runEdit([seq], () => {
    const g = gridOf(seq);
    const f = locate(seq, clipId);
    if (!f || f.track.locked) return;
    if (edge === 'start') {
      if (f.clip.transitionIn) f.clip.transitionIn = null;
      return;
    }
    const nx = adjacent(g, f.track, f.clip, 'end');
    if (nx?.transitionIn) nx.transitionIn = null;
    if (f.clip.transitionOut) f.clip.transitionOut = null;
  });
}

// ---- tracks & markers --------------------------------------------------------

/**
 * Adds a track with a unique name (V4, A4, C1…). Video goes on top of the
 * video tracks, audio below the audio tracks, captions at the end (with a
 * caption style). `index` (a position in seq.tracks) is kept inside the
 * kind's group.
 */
export function addTrack(seq: Sequence, kind: TrackKind, index?: number): Track {
  return addTrackImpl(seq, kind, index);
}

/** Removes a track (not locked ones, nor the last video or audio track). */
export function removeTrack(seq: Sequence, trackId: string): void {
  runEdit([seq], () => {
    const i = seq.tracks.findIndex((t) => t.id === trackId);
    if (i < 0) return;
    const t = seq.tracks[i];
    if (t.locked) return;
    if (t.kind !== 'caption' && ofKind(seq, t.kind).length <= 1) return;
    seq.tracks.splice(i, 1);
  });
}

function sortMarkers(seq: Sequence): void {
  if (!isSorted(seq.markers.map((m) => ({ start: m.time })))) seq.markers.sort((a, b) => a.time - b.time);
}

/** Adds a marker at `time` (on the frame grid). Returns its id. */
export function addMarker(seq: Sequence, time: number, init: Partial<Marker> = {}): string {
  const g = gridOf(seq);
  const m = makeMarker(0, init);
  m.time = g.T(Math.max(0, g.F(fin(init.time ?? time, 0))));
  m.duration = init.duration && init.duration > 0 ? g.T(g.F(init.duration)) : 0;
  seq.markers.push(m);
  sortMarkers(seq);
  return m.id;
}

export function removeMarker(seq: Sequence, markerId: string): void {
  const i = seq.markers.findIndex((m) => m.id === markerId);
  if (i >= 0) seq.markers.splice(i, 1);
}

/** Moves a marker to `time` (on the frame grid, ≥ 0). */
export function moveMarker(seq: Sequence, markerId: string, time: number): void {
  const m = seq.markers.find((x) => x.id === markerId);
  if (!m || !Number.isFinite(time)) return;
  const g = gridOf(seq);
  m.time = g.T(Math.max(0, g.F(time)));
  sortMarkers(seq);
}

// ---- queries (no mutation) -----------------------------------------------------

export interface EditPointOptions {
  /** Include markers (start and end of range markers). Default true. */
  includeMarkers?: boolean;
  excludeClipIds?: string[];
  /** Only clip edges on these tracks. */
  trackIds?: string[];
  /** Only clip edges on targeted tracks (Premiere ↑/↓). */
  targetedOnly?: boolean;
  /** Include the sequence In/Out. Default true. */
  includeInOut?: boolean;
  /** Include the sequence start (0). Default true. */
  includeZero?: boolean;
  playhead?: number;
}

/** Edit points for snapping / up-down navigation: clip edges, caption cues, markers, in/out, playhead. Sorted, unique, on the frame grid. */
export function editPoints(seq: Sequence, opts: EditPointOptions = {}): number[] {
  const g = gridOf(seq);
  const ex = new Set(opts.excludeClipIds ?? []);
  const only = opts.trackIds ? new Set(opts.trackIds) : null;
  const frames = new Set<number>();
  if (opts.includeZero !== false) frames.add(0);
  for (const tr of seq.tracks) {
    if (only && !only.has(tr.id)) continue;
    if (opts.targetedOnly && !tr.targeted) continue;
    for (const c of tr.clips) {
      if (ex.has(c.id)) continue;
      frames.add(startF(g, c));
      frames.add(endF(g, c));
    }
    for (const q of tr.cues) {
      frames.add(g.F(q.start));
      frames.add(g.F(q.end));
    }
  }
  if (opts.includeMarkers !== false) {
    for (const m of seq.markers) {
      frames.add(g.F(m.time));
      if (m.duration > 0) frames.add(g.F(m.time + m.duration));
    }
  }
  if (opts.includeInOut !== false) {
    if (seq.inPoint !== null && seq.inPoint !== undefined) frames.add(g.F(seq.inPoint));
    if (seq.outPoint !== null && seq.outPoint !== undefined) frames.add(g.F(seq.outPoint));
  }
  if (opts.playhead !== undefined && Number.isFinite(opts.playhead)) frames.add(g.F(opts.playhead));
  return [...frames].sort((a, b) => a - b).map((f) => g.T(f));
}

/** The nearest edit point before `time` (null when none). */
export function prevEditPoint(seq: Sequence, time: number, opts: EditPointOptions = {}): number | null {
  const g = gridOf(seq);
  const t = g.F(time);
  const pts = editPoints(seq, opts);
  for (let i = pts.length - 1; i >= 0; i--) if (g.F(pts[i]) < t) return pts[i];
  return null;
}

/** The nearest edit point after `time` (null when none). */
export function nextEditPoint(seq: Sequence, time: number, opts: EditPointOptions = {}): number | null {
  const g = gridOf(seq);
  const t = g.F(time);
  for (const p of editPoints(seq, opts)) if (g.F(p) > t) return p;
  return null;
}

/** The clip on a track at time t, if any. */
export function clipAt(track: Track, t: number): Clip | undefined {
  let best: Clip | undefined;
  for (const c of track.clips) {
    if (t >= c.start - EPS && t < c.start + c.duration - EPS && (!best || c.start > best.start)) best = c;
  }
  return best;
}

// ---- editing helpers ---------------------------------------------------------

/**
 * Premiere Q / W: ripple-trims the previous edit (edge 'start') or the next
 * edit ('end') to the playhead on the targeted tracks (or `trackIds`) and
 * the tracks of linked partners, as one range edit: [previous edit,
 * playhead) or [playhead, next edit) is removed there and, with ripple,
 * closed on every unlocked track (sync lock). Returns whether it trimmed.
 */
export function trimToPlayhead(seq: Sequence, time: number, edge: 'start' | 'end', ripple: boolean, opts: { trackIds?: string[] } = {}): boolean {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const t = g.F(time);
    const pick = opts.trackIds ? seq.tracks.filter((x) => opts.trackIds!.includes(x.id)) : seq.tracks.filter((x) => x.targeted);
    const tracks = pick.filter((x) => !x.locked && x.kind !== 'caption');
    const under = tracks.flatMap((tr) => tr.clips.filter((c) => startF(g, c) < t && endF(g, c) > t).map((clip) => ({ clip, track: tr })));
    if (!under.length) return false;
    const all = expand(seq, under.map((u) => u.clip.id), { links: true, groups: false });
    const clearTracks = [...new Set([...tracks, ...all.map((l) => l.track)])];
    let a = t;
    let b = t;
    if (edge === 'start') {
      a = 0;
      for (const tr of clearTracks) for (const c of tr.clips) for (const x of [startF(g, c), endF(g, c)]) if (x < t && x > a) a = x;
    } else {
      b = Infinity;
      for (const tr of clearTracks) for (const c of tr.clips) for (const x of [startF(g, c), endF(g, c)]) if (x > t && x < b) b = x;
    }
    if (!(b > a) || !Number.isFinite(b)) return false;
    for (const tr of clearTracks) clearRange(g, undefined, tr, a, b);
    if (ripple) closeRange(g, unlockedTracks(seq), a, b);
    return true;
  });
}

/**
 * E: extends edits to `time` with a roll (a normal trim when there is no
 * adjacent clip). With clipIds, each clip's nearer edge (or the edge on the
 * playhead's side) moves; without, the edit point nearest to `time` on the
 * targeted tracks moves. Pass `project` so source limits are respected.
 */
export function extendEdit(seq: Sequence, time: number, opts: { clipIds?: string[]; project?: Project } = {}): boolean {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const t = g.F(time);
    const T = g.T(t);
    let any = false;
    const done = new Set<string>();
    if (opts.clipIds?.length) {
      for (const l of expand(seq, opts.clipIds, { links: false, groups: false })) {
        if (done.has(l.clip.id)) continue;
        done.add(l.clip.id);
        for (const p of partnersOf(seq, l.clip)) done.add(p.clip.id);
        const s = startF(g, l.clip);
        const e = endF(g, l.clip);
        const edge: 'start' | 'end' = t >= e ? 'end' : t <= s ? 'start' : t - s < e - t ? 'start' : 'end';
        if (trimImpl(opts.project, seq, l.clip.id, edge, T, 'roll', {})) any = true;
      }
      return any;
    }
    const tracks = seq.tracks.filter((x) => x.targeted && !x.locked && x.kind !== 'caption');
    let best: number | null = null;
    for (const tr of tracks) {
      for (const c of tr.clips) {
        for (const x of [startF(g, c), endF(g, c)]) if (x !== t && (best === null || Math.abs(x - t) < Math.abs(best - t))) best = x;
      }
    }
    if (best === null) return false;
    for (const tr of tracks) {
      for (const c of [...tr.clips]) {
        if (done.has(c.id)) continue;
        const s = startF(g, c);
        const e = endF(g, c);
        let edge: 'start' | 'end' | null = null;
        if (e === best) edge = 'end';
        else if (s === best && !adjacent(g, tr, c, 'start')) edge = 'start';
        if (!edge) continue;
        done.add(c.id);
        for (const p of partnersOf(seq, c)) done.add(p.clip.id);
        if (trimImpl(opts.project, seq, c.id, edge, T, 'roll', {})) any = true;
      }
    }
    return any;
  });
}

/** Track Select Forward (A): ids of clips at or after `time` (including the one under it) on a track or every unlocked track. */
export function selectForward(seq: Sequence, time: number, trackId: string | null): string[] {
  const g = gridOf(seq);
  const t = g.F(time);
  return allClips(seq)
    .filter((l) => !l.track.locked && (!trackId || l.track.id === trackId) && endF(g, l.clip) > t)
    .sort((a, b) => a.clip.start - b.clip.start)
    .map((l) => l.clip.id);
}

/** Track Select Backward (Shift+A): ids of clips at or before `time` (including the one under it). */
export function selectBackward(seq: Sequence, time: number, trackId: string | null): string[] {
  const g = gridOf(seq);
  const t = g.F(time);
  return allClips(seq)
    .filter((l) => !l.track.locked && (!trackId || l.track.id === trackId) && startF(g, l.clip) <= t)
    .sort((a, b) => a.clip.start - b.clip.start)
    .map((l) => l.clip.id);
}

export interface MatchFrameResult {
  assetId: string;
  /** Source time of the frame under `time`. */
  sourceTime: number;
  /** The clip's source range (for the Source monitor's In/Out). */
  sourceIn: number;
  sourceOut: number;
  clipId: string;
}

/**
 * Match frame (F): the media under `time` on the topmost visible video
 * track (falling back to audio), looking through nested sequences.
 */
export function matchFrame(project: Project, seq: Sequence, time: number, depth = 0): MatchFrameResult | null {
  if (depth > 8) return null;
  const g = gridOf(seq);
  const t = g.F(time);
  const at = (tr: Track) => {
    const hits = tr.clips.filter((c) => startF(g, c) <= t && endF(g, c) > t);
    return hits.find((c) => c.enabled) ?? hits[0];
  };
  for (const kind of ['video', 'audio'] as const) {
    for (const tr of ofKind(seq, kind)) {
      if (kind === 'video' && tr.muted) continue;
      const c = at(tr);
      if (!c) continue;
      const src = sourceTimeAt(c, g.T(t - startF(g, c)));
      if (c.kind === 'media' && c.assetId) {
        return { assetId: c.assetId, sourceTime: src, sourceIn: c.inPoint, sourceOut: c.inPoint + spanFor(c, c.duration), clipId: c.id };
      }
      if (c.kind === 'sequence' && c.sequenceId) {
        const n = project.sequences.find((s) => s.id === c.sequenceId);
        if (n && n.id !== seq.id) {
          const r = matchFrame(project, n, src, depth + 1);
          if (r) return r;
        }
      }
    }
  }
  return null;
}

/**
 * Replace edit: swaps the clip's media for another asset, keeping its
 * place and length. The source in point is opts.sourceIn, else the asset's
 * markIn, else the clip's current one, pulled back (or the clip shortened)
 * when the new media is too short. Linked partners follow when the asset
 * has that kind of media (else they are unlinked).
 */
export function replaceClipMedia(project: Project, seq: Sequence, clipId: string, assetId: string, opts: { sourceIn?: number } & LinkOptions = {}): boolean {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const f = locate(seq, clipId);
    const asset = project.assets.find((a) => a.id === assetId);
    if (!f || !asset || f.track.locked) return false;
    const fits = (tr: Track) => (tr.kind === 'video' ? asset.kind === 'image' || (asset.hasVideo && asset.kind !== 'audio') : tr.kind === 'audio' && asset.hasAudio && asset.kind !== 'image');
    if (!fits(f.track)) return false;
    const parts = participants(seq, f, opts.unlinked);
    const misfit = parts.some((p) => !fits(p.track));
    for (const p of parts) {
      const c = p.clip;
      if (misfit && c.linkId) delete c.linkId;
      if (!fits(p.track)) continue;
      c.kind = 'media';
      c.assetId = asset.id;
      if (c.sequenceId) delete c.sequenceId;
      c.name = asset.name;
      c.holdFrame = null;
      if (asset.kind === 'image') {
        c.inPoint = 0;
        continue;
      }
      const s = startF(g, c);
      const e = endF(g, c);
      let inP = Math.max(0, opts.sourceIn ?? asset.markIn ?? c.inPoint);
      const lim = asset.duration > 0 ? asset.duration : Infinity;
      const span = spanFor(c, g.T(e - s));
      if (lim !== Infinity) {
        if (inP + span > lim + SRC_TOL) inP = Math.max(0, lim - span);
        if (inP + span > lim + SRC_TOL) {
          const sp = c.speed > 0 ? c.speed : 1;
          setSpan(g, c, s, s + Math.max(1, Math.min(e - s, framesFor(g, (lim - inP) / sp))));
        }
      }
      c.inPoint = cleanInPoint(g, inP);
    }
    return true;
  });
}

/** Enables / disables clips (exactly these ids). 'toggle' enables when all are disabled, else disables. */
export function setClipsEnabled(seq: Sequence, clipIds: string[], enabled: boolean | 'toggle'): void {
  const list = expand(seq, clipIds, { links: false, groups: false });
  if (!list.length) return;
  const v = enabled === 'toggle' ? list.every((l) => !l.clip.enabled) : enabled;
  for (const l of list) if (l.clip.enabled !== v) l.clip.enabled = v;
}

/** Sets the label color of clips (exactly these ids, unlocked tracks only). */
export function setLabel(seq: Sequence, clipIds: string[], label: LabelColor): void {
  for (const l of expand(seq, clipIds, { links: false, groups: false })) if (l.clip.label !== label) l.clip.label = label;
}

/**
 * Swaps a clip with its neighbour on the track (Premiere Alt+, / Alt+.),
 * keeping the gap between them; linked partners swap along when their
 * tracks allow it. Returns whether anything moved.
 */
export function swapWithNeighbor(seq: Sequence, clipId: string, direction: 'left' | 'right', opts: LinkOptions = {}): boolean {
  return runEdit([seq], () => {
    const g = gridOf(seq);
    const f = locate(seq, clipId);
    if (!f || f.track.locked) return false;
    const list = sortedClips(f.track);
    const i = list.indexOf(f.clip);
    const j = direction === 'right' ? i + 1 : i - 1;
    if (i < 0 || j < 0 || j >= list.length) return false;
    const [A, B] = direction === 'right' ? [f.clip, list[j]] : [list[j], f.clip];
    const aS = startF(g, A);
    const aE = endF(g, A);
    const bS = startF(g, B);
    const bE = endF(g, B);
    const dB = aS - bS;
    const dA = bE - (aE - aS) - aS;
    const plan: Plan = new Map();
    const add = (c: Clip, tr: Track, d: number) => {
      if (plan.has(c)) return;
      const it = baseItem(g, c, tr);
      it.s += d;
      it.e += d;
      plan.set(c, it);
    };
    add(A, f.track, dA);
    add(B, f.track, dB);
    if (!opts.unlinked) {
      for (const p of partnersOf(seq, A)) add(p.clip, p.track, dA);
      for (const p of partnersOf(seq, B)) add(p.clip, p.track, dB);
    }
    if (planValid(g, undefined, plan, { source: false })) {
      applyPlan(g, plan);
      return true;
    }
    const only: Plan = new Map([...plan].filter(([c]) => c === A || c === B));
    if (!planValid(g, undefined, only, { source: false })) return false;
    applyPlan(g, only);
    return true;
  });
}

/** Sorts clips (and cues) by start and removes zero-length ones (shorter than a frame when fps is given). */
export function normalizeTrack(track: Track, fps?: number): void {
  const g = fps ? grid(fps) : null;
  for (const c of [...track.clips]) {
    const zero = g ? endF(g, c) - startF(g, c) <= 0 : !(c.duration > 1e-9);
    if (zero) removeClip(track, c);
  }
  if (!isSorted(track.clips)) track.clips.sort((a, b) => a.start - b.start);
  for (const q of [...track.cues]) if (!(q.end > q.start)) track.cues.splice(track.cues.indexOf(q), 1);
  if (!isSorted(track.cues)) track.cues.sort((a, b) => a.start - b.start);
}
