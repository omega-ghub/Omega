// Pure media-browser logic: search, filters, sorting, selection ranges and
// bin-tree operations. No DOM, no store: unit-tested in Node.

import type { Bin, MediaAsset, Project } from '../../../state/types';
import { codecLabel } from '../../../engine/media/mediaMath';

export type SortKey = 'name' | 'importedAt' | 'duration' | 'kind' | 'resolution' | 'fps' | 'codec' | 'audio' | 'size' | 'label' | 'rating' | 'notes' | 'inputTransform';
export type SortDir = 'asc' | 'desc';
export type KindFilter = 'all' | 'video' | 'audio' | 'image' | 'offline' | 'unused';

const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;
export const compareText = (a: string, b: string): number => (collator ? collator.compare(a, b) : a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------------------
// Search & filter
// ---------------------------------------------------------------------------

/** Every whitespace-separated term must appear in the name, notes or codecs. */
export function matchesQuery(a: MediaAsset, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = [a.name, a.notes ?? '', a.codec ?? '', codecLabel(a.codec), a.audioCodec ?? '', codecLabel(a.audioCodec)].join(' ').toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export function matchesFilter(a: MediaAsset, filter: KindFilter, used: Set<string>): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'video':
    case 'audio':
    case 'image':
      return a.kind === filter;
    case 'offline':
      return !!a.offline;
    case 'unused':
      return !used.has(a.id);
  }
}

export function filterAssets(assets: MediaAsset[], opts: { query: string; filter: KindFilter; used: Set<string> }): MediaAsset[] {
  return assets.filter((a) => matchesFilter(a, opts.filter, opts.used) && matchesQuery(a, opts.query));
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

const KIND_ORDER: Record<MediaAsset['kind'], number> = { video: 0, audio: 1, image: 2 };
const LABEL_ORDER = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'grey', 'none'];

function sortValue(a: MediaAsset, key: SortKey): number | string {
  switch (key) {
    case 'name':
      return a.name;
    case 'importedAt':
      return a.importedAt ?? 0;
    case 'duration':
      return a.kind === 'image' ? -1 : a.duration;
    case 'kind':
      return KIND_ORDER[a.kind];
    case 'resolution':
      return (a.width ?? 0) * (a.height ?? 0);
    case 'fps':
      return a.fps ?? 0;
    case 'codec':
      return codecLabel(a.codec);
    case 'audio':
      return a.hasAudio ? `${codecLabel(a.audioCodec)} ${String(a.channels ?? 0).padStart(2, '0')} ${a.sampleRate ?? 0}` : '';
    case 'size':
      return a.size ?? 0;
    case 'label':
      return LABEL_ORDER.indexOf(a.label ?? 'none');
    case 'rating':
      return a.rating ?? 0;
    case 'notes':
      return a.notes ?? '';
    case 'inputTransform':
      return a.inputTransform;
  }
}

/** Stable sort; ties fall back to the name (ascending), then the id. */
export function sortAssets(assets: MediaAsset[], key: SortKey, dir: SortDir): MediaAsset[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...assets].sort((x, y) => {
    const a = sortValue(x, key);
    const b = sortValue(y, key);
    let c = typeof a === 'number' && typeof b === 'number' ? a - b : compareText(String(a), String(b));
    if (c !== 0) return c * sign;
    c = compareText(x.name, y.name);
    return c !== 0 ? c : x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Ids between anchor and target (inclusive) in display order; just the target if the anchor is not shown. */
export function rangeSelect(ordered: string[], anchorId: string | null, targetId: string): string[] {
  const t = ordered.indexOf(targetId);
  if (t < 0) return [];
  const a = anchorId ? ordered.indexOf(anchorId) : -1;
  if (a < 0) return [targetId];
  const [lo, hi] = a < t ? [a, t] : [t, a];
  return ordered.slice(lo, hi + 1);
}

/** Click semantics: plain = only this, toggle (Ctrl/Cmd) = flip it, range (Shift) = anchor..target. */
export function clickSelect(current: string[], ordered: string[], anchorId: string | null, id: string, mode: 'replace' | 'toggle' | 'range'): string[] {
  if (mode === 'toggle') return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  if (mode === 'range') return rangeSelect(ordered, anchorId, id);
  return [id];
}

// ---------------------------------------------------------------------------
// Bin tree
// ---------------------------------------------------------------------------

export function childBins(bins: Bin[], parentId: string | null): Bin[] {
  return bins.filter((b) => b.parentId === parentId).sort((a, b) => compareText(a.name, b.name));
}

/** Root → bin, inclusive (empty for the project root or a missing bin). Cycle-safe. */
export function binAncestors(bins: Bin[], binId: string | null): Bin[] {
  const out: Bin[] = [];
  const seen = new Set<string>();
  let cur = binId ? bins.find((b) => b.id === binId) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parentId ? bins.find((b) => b.id === cur!.parentId) : undefined;
  }
  return out;
}

/** The bin and everything nested in it. */
export function descendantBinIds(bins: Bin[], binId: string): Set<string> {
  const out = new Set<string>([binId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of bins) {
      if (b.parentId && out.has(b.parentId) && !out.has(b.id)) {
        out.add(b.id);
        grew = true;
      }
    }
  }
  return out;
}

/** A bin may move anywhere except into itself or its own descendants. */
export function canMoveBin(bins: Bin[], binId: string, newParentId: string | null): boolean {
  if (newParentId === null) return true;
  return !descendantBinIds(bins, binId).has(newParentId);
}

export function uniqueBinName(bins: Bin[], parentId: string | null, base = 'New Bin'): string {
  const names = new Set(bins.filter((b) => b.parentId === parentId).map((b) => b.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** Deletes a bin on a project draft; its assets and child bins move up to its parent. */
export function deleteBinInPlace(project: Project, binId: string): void {
  const bin = project.bins.find((b) => b.id === binId);
  if (!bin) return;
  const parent = bin.parentId && project.bins.some((b) => b.id === bin.parentId) ? bin.parentId : null;
  for (const a of project.assets) if (a.binId === binId) a.binId = parent;
  for (const b of project.bins) if (b.parentId === binId) b.parentId = parent;
  project.bins = project.bins.filter((b) => b.id !== binId);
}

/** Assets visible in a bin: directly in it, or anywhere below it when `recursive` (root + recursive = all). */
export function assetsInScope(project: Pick<Project, 'assets' | 'bins'>, binId: string | null, recursive: boolean): MediaAsset[] {
  const valid = new Set(project.bins.map((b) => b.id));
  const binOf = (a: MediaAsset) => (a.binId && valid.has(a.binId) ? a.binId : null);
  if (!recursive) return project.assets.filter((a) => binOf(a) === binId);
  if (binId === null) return project.assets;
  const scope = descendantBinIds(project.bins, binId);
  return project.assets.filter((a) => {
    const b = binOf(a);
    return b !== null && scope.has(b);
  });
}

/** Number of assets and bins directly inside a bin. */
export function binItemCount(project: Pick<Project, 'assets' | 'bins'>, binId: string): number {
  return project.assets.filter((a) => a.binId === binId).length + project.bins.filter((b) => b.parentId === binId).length;
}

/** Total duration of time-based items (images excluded). */
export function totalDuration(assets: MediaAsset[]): number {
  return assets.reduce((s, a) => s + (a.kind === 'image' ? 0 : Math.max(0, a.duration || 0)), 0);
}
