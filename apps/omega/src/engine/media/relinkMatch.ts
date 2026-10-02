// Matching offline assets to candidate files (pure; unit-tested).
//
// A candidate matches by file name (case-insensitive), or by name stem with a
// different extension when both durations are known and agree. When several
// candidates share a name, the closest duration and the same parent folder
// name win. After one asset is found, the folder move it implies (old prefix
// → new prefix) is tried for the others, which relinks whole folders at once.

import { basename, dirname, stem } from './mediaMath';

export interface OfflineRef {
  id: string;
  path: string;
  /** Known duration of the asset (seconds); 0 / undefined when unknown. */
  duration?: number;
}

export interface Candidate {
  path: string;
  /** Duration if the candidate was probed. */
  duration?: number;
}

export function durationsAgree(a?: number, b?: number): boolean {
  if (!(a && a > 0) || !(b && b > 0)) return true;
  return Math.abs(a - b) <= Math.max(0.25, 0.005 * Math.max(a, b));
}

const folderName = (p: string) => basename(dirname(p)).toLowerCase();

/** Match score of a candidate for an asset (higher is better), or -1 when it does not match. */
export function matchScore(asset: OfflineRef, cand: Candidate): number {
  const sameName = basename(asset.path).toLowerCase() === basename(cand.path).toLowerCase();
  const sameStem = stem(asset.path).toLowerCase() === stem(cand.path).toLowerCase();
  const bothDur = !!(asset.duration && asset.duration > 0 && cand.duration && cand.duration > 0);
  if (!sameName && !(sameStem && bothDur)) return -1;
  if (!durationsAgree(asset.duration, cand.duration)) return -1;
  let score = sameName ? 100 : 50;
  if (bothDur) score += 30 - Math.min(29, Math.abs(asset.duration! - cand.duration!) * 10);
  if (folderName(asset.path) && folderName(asset.path) === folderName(cand.path)) score += 10;
  return score;
}

/** Best one-to-one assignment of candidates to offline assets: asset id → new path. */
export function matchCandidates(offline: OfflineRef[], candidates: Candidate[]): Map<string, string> {
  const pairs: { id: string; path: string; score: number }[] = [];
  for (const a of offline) {
    for (const c of candidates) {
      const score = matchScore(a, c);
      if (score >= 0) pairs.push({ id: a.id, path: c.path, score });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const p of pairs) {
    if (out.has(p.id) || used.has(p.path)) continue;
    out.set(p.id, p.path);
    used.add(p.path);
  }
  return out;
}

function split(p: string): string[] {
  return p.split(/[\\/]/);
}

export interface PrefixMap {
  from: string;
  to: string;
}

/**
 * The folder move implied by one relink: strips the longest common trailing
 * path components. '/A/Proj/Day1/c.mp4' → '/B/Proj/Day1/c.mp4' gives
 * { from: '/A', to: '/B' }. Null when even the file names differ.
 */
export function inferPrefixMap(oldPath: string, newPath: string): PrefixMap | null {
  const a = split(oldPath);
  const b = split(newPath);
  let k = 0;
  while (k < a.length - 1 && k < b.length - 1 && a[a.length - 1 - k] === b[b.length - 1 - k]) k++;
  if (k === 0) return null;
  const sepA = oldPath.includes('\\') && !oldPath.includes('/') ? '\\' : '/';
  const sepB = newPath.includes('\\') && !newPath.includes('/') ? '\\' : '/';
  const from = a.slice(0, a.length - k).join(sepA);
  const to = b.slice(0, b.length - k).join(sepB);
  if (from === to) return null;
  return { from, to };
}

/** Rewrites a path under `map.from` to live under `map.to` (null when it is not under it). */
export function applyPrefixMap(path: string, map: PrefixMap): string | null {
  const parts = split(path);
  const from = split(map.from);
  if (parts.length <= from.length) return null;
  for (let i = 0; i < from.length; i++) if (parts[i] !== from[i]) return null;
  const sep = map.to.includes('\\') && !map.to.includes('/') ? '\\' : '/';
  return [map.to, ...parts.slice(from.length)].join(sep);
}
