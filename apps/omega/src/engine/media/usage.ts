// Where assets are used (pure; no DOM). OWNED BY THE MEDIA PACKAGE.
import type { Project } from '../../state/types';

export interface AssetUsage {
  sequenceId: string;
  sequenceName: string;
  clipIds: string[];
}

/** Every sequence that uses the asset, with the clip ids (empty array = unused). */
export function assetUsage(project: Project, assetId: string): AssetUsage[] {
  const out: AssetUsage[] = [];
  for (const seq of project.sequences) {
    const clipIds: string[] = [];
    for (const t of seq.tracks) for (const c of t.clips) if (c.assetId === assetId) clipIds.push(c.id);
    if (clipIds.length) out.push({ sequenceId: seq.id, sequenceName: seq.name, clipIds });
  }
  return out;
}

/** Ids of every asset referenced by at least one clip in any sequence. */
export function usedAssetIds(project: Project): Set<string> {
  const used = new Set<string>();
  for (const seq of project.sequences) for (const t of seq.tracks) for (const c of t.clips) if (c.assetId) used.add(c.assetId);
  return used;
}

/** Number of clips (all sequences) that use each asset. */
export function clipCountByAsset(project: Project): Map<string, number> {
  const m = new Map<string, number>();
  for (const seq of project.sequences) for (const t of seq.tracks) for (const c of t.clips) if (c.assetId) m.set(c.assetId, (m.get(c.assetId) ?? 0) + 1);
  return m;
}

/** Removes every clip that uses one of the assets (lift: leaves gaps). Call on a draft. */
export function removeClipsOfAssets(project: Project, assetIds: Set<string>): number {
  let n = 0;
  for (const seq of project.sequences) {
    for (const t of seq.tracks) {
      const before = t.clips.length;
      t.clips = t.clips.filter((c) => !(c.assetId && assetIds.has(c.assetId)));
      n += before - t.clips.length;
    }
  }
  return n;
}
