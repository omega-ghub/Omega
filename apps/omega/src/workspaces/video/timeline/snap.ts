// Snapping: a sorted list of candidate times (clip edges, playhead, markers,
// in/out, keyframes) and a nearest-point lookup within a pixel threshold.

import type { Sequence } from '../../../state/types';

export const SNAP_PX = 9;

export interface SnapPoint {
  t: number;
  kind: 'edge' | 'playhead' | 'marker' | 'inout' | 'keyframe' | 'start' | 'cue';
}

export interface Snapper {
  points: SnapPoint[];
  /** Nearest point within `maxDist` seconds of t, or null. */
  nearest(t: number, maxDist: number): SnapPoint | null;
}

export function makeSnapper(points: SnapPoint[]): Snapper {
  const sorted = points.filter((p) => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  return {
    points: sorted,
    nearest(t, maxDist) {
      if (!sorted.length) return null;
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid].t < t) lo = mid + 1;
        else hi = mid;
      }
      let best: SnapPoint | null = null;
      let bestD = maxDist;
      for (let i = Math.max(0, lo - 2); i < Math.min(sorted.length, lo + 2); i++) {
        const d = Math.abs(sorted[i].t - t);
        // ties prefer the playhead (it is what editors aim for)
        if (d < bestD || (best && d === bestD && sorted[i].kind === 'playhead')) {
          bestD = d;
          best = sorted[i];
        }
      }
      return best;
    },
  };
}

export interface SnapSources {
  playhead?: number;
  /** Clip ids whose edges must be ignored (the ones being dragged). */
  excludeClipIds?: Set<string>;
  excludeCueIds?: Set<string>;
  excludeMarkerIds?: Set<string>;
  keyframes?: boolean;
}

/** Collects every snap candidate of a sequence. */
export function snapPointsFor(seq: Sequence, src: SnapSources = {}): SnapPoint[] {
  const pts: SnapPoint[] = [{ t: 0, kind: 'start' }];
  if (src.playhead !== undefined) pts.push({ t: src.playhead, kind: 'playhead' });
  if (seq.inPoint !== null) pts.push({ t: seq.inPoint, kind: 'inout' });
  if (seq.outPoint !== null) pts.push({ t: seq.outPoint, kind: 'inout' });
  for (const m of seq.markers) {
    if (src.excludeMarkerIds?.has(m.id)) continue;
    pts.push({ t: m.time, kind: 'marker' });
    if (m.duration > 0) pts.push({ t: m.time + m.duration, kind: 'marker' });
  }
  for (const tr of seq.tracks) {
    for (const c of tr.clips) {
      if (src.excludeClipIds?.has(c.id)) continue;
      pts.push({ t: c.start, kind: 'edge' }, { t: c.start + c.duration, kind: 'edge' });
      if (src.keyframes) {
        for (const list of Object.values(c.keyframes)) {
          for (const k of list) if (k.t > 0 && k.t < c.duration) pts.push({ t: c.start + k.t, kind: 'keyframe' });
        }
      }
    }
    for (const q of tr.cues) {
      if (src.excludeCueIds?.has(q.id)) continue;
      pts.push({ t: q.start, kind: 'cue' }, { t: q.end, kind: 'cue' });
    }
  }
  return pts;
}

/**
 * Snaps a block [start, end] moved by `delta`: tries both edges and returns
 * the adjusted delta and the time that snapped (or null).
 */
export function snapBlock(snapper: Snapper, start: number, end: number, delta: number, maxDist: number): { delta: number; at: number | null } {
  const a = snapper.nearest(start + delta, maxDist);
  const b = snapper.nearest(end + delta, maxDist);
  const da = a ? a.t - (start + delta) : Infinity;
  const db = b ? b.t - (end + delta) : Infinity;
  if (!a && !b) return { delta, at: null };
  if (Math.abs(da) <= Math.abs(db)) return { delta: delta + da, at: a!.t };
  return { delta: delta + db, at: b!.t };
}
