// Relinking, replacing and housekeeping of project media. OWNED BY THE MEDIA PACKAGE.

import { useEditor } from '../../state/store';
import type { MediaAsset } from '../../state/types';
import { invalidateDecodeCache } from './decode';
import { MEDIA_EXTENSIONS, basename, mapLimit } from './mediaMath';
import { probeFile } from './probe';
import { cancelProxy, isProxyJobActive } from './proxies';
import { applyPrefixMap, inferPrefixMap, matchCandidates, type Candidate, type OfflineRef } from './relinkMatch';
import { fileExists } from './source';
import { invalidateThumbnails } from './thumbnails';
import { assetUsage, usedAssetIds, type AssetUsage } from './usage';

export type { AssetUsage } from './usage';

function state() {
  return useEditor.getState();
}

function findAsset(id: string): MediaAsset | undefined {
  return state().project?.assets.find((a) => a.id === id);
}

function forget(ids: Iterable<string>) {
  for (const id of ids) {
    invalidateDecodeCache(id);
    invalidateThumbnails(id);
  }
}

/** Sequences and clips that use an asset. */
export function findAssetUsage(assetId: string): AssetUsage[] {
  const p = state().project;
  return p ? assetUsage(p, assetId) : [];
}

/** Re-checks which assets are offline (e.g. when the window regains focus). */
export async function refreshOffline(): Promise<number> {
  const p = state().project;
  if (!p || !p.assets.length) return 0;
  const status = await mapLimit(p.assets, 8, async (a) => ({ id: a.id, path: a.path, offline: !(await fileExists(a.path)) }));
  const cur = state().project;
  if (!cur) return 0;
  const changed = status.filter((s) => {
    const a = cur.assets.find((x) => x.id === s.id);
    return a && a.path === s.path && !!a.offline !== s.offline;
  });
  if (changed.length) {
    const map = new Map(changed.map((c) => [c.id, c.offline]));
    const wentOffline = changed.filter((c) => c.offline).length;
    state().mutate(wentOffline ? `${wentOffline} file${wentOffline === 1 ? '' : 's'} went offline` : 'Media back online', (d) => {
      for (const a of d.assets) if (map.has(a.id)) a.offline = map.get(a.id);
    });
    forget(map.keys());
  }
  return cur.assets.filter((a) => a.offline).length;
}

interface RelinkPlan {
  id: string;
  path: string;
  probe?: MediaAsset;
}

function applyRelinks(plans: RelinkPlan[], label: string) {
  if (!plans.length) return;
  const byId = new Map(plans.map((p) => [p.id, p]));
  state().mutate(label, (d) => {
    for (const a of d.assets) {
      const plan = byId.get(a.id);
      if (!plan) continue;
      a.path = plan.path;
      a.offline = false;
      const pr = plan.probe;
      if (pr) {
        if (!(a.duration > 0)) a.duration = pr.duration;
        a.width ??= pr.width;
        a.height ??= pr.height;
        a.fps ??= pr.fps;
        a.codec ??= pr.codec;
        a.audioCodec ??= pr.audioCodec;
        a.channels ??= pr.channels;
        a.sampleRate ??= pr.sampleRate;
        a.size = pr.size ?? a.size;
      }
    }
  });
  forget(byId.keys());
}

/**
 * Relink offline media: the user picks files; offline assets are matched by
 * file name (and duration), then the folder move implied by each match is
 * tried for the remaining ones. Returns the number of assets relinked.
 */
export async function relinkOffline(assetIds?: string[]): Promise<number> {
  const p = state().project;
  if (!p) return 0;
  const offline = p.assets.filter((a) => a.offline && (!assetIds || assetIds.includes(a.id)));
  if (!offline.length) {
    state().showToast('No offline media', 'info');
    return 0;
  }
  const picked = await window.omega.dialogs.pickFiles(offline.length === 1 ? `Locate ${offline[0].name}` : `Locate ${offline.length} offline files`, [...MEDIA_EXTENSIONS]);
  if (!picked?.length) return 0;

  const refs: OfflineRef[] = offline.map((a) => ({ id: a.id, path: a.path, duration: a.duration }));
  // probe only the candidates whose name could match something, to compare durations
  const names = new Set(refs.flatMap((r) => [basename(r.path).toLowerCase(), basename(r.path).toLowerCase().replace(/\.[^.]+$/, '')]));
  const relevant = picked.filter((c) => names.has(basename(c).toLowerCase()) || names.has(basename(c).toLowerCase().replace(/\.[^.]+$/, '')));
  const probes = new Map<string, MediaAsset>();
  const candidates: Candidate[] = await mapLimit(relevant, 3, async (path) => {
    const r = await probeFile(path);
    if (r.ok) probes.set(path, r.asset);
    return { path, duration: r.ok ? r.asset.duration : undefined };
  });
  const usable = candidates.filter((c) => probes.has(c.path));
  const matches = matchCandidates(refs, usable);
  const plans: RelinkPlan[] = [...matches.entries()].map(([id, path]) => ({ id, path, probe: probes.get(path) }));

  // whole-folder relink: apply the implied moves to the rest
  const maps = plans
    .map((pl) => inferPrefixMap(offline.find((a) => a.id === pl.id)!.path, pl.path))
    .filter((m): m is NonNullable<typeof m> => !!m);
  const remaining = offline.filter((a) => !matches.has(a.id));
  for (const a of remaining) {
    for (const m of maps) {
      const guess = applyPrefixMap(a.path, m);
      if (guess && (await fileExists(guess))) {
        plans.push({ id: a.id, path: guess });
        break;
      }
    }
  }

  const n = plans.length;
  applyRelinks(plans, n === 1 ? 'Relink media' : `Relink ${n} files`);
  const left = offline.length - n;
  if (n) state().showToast(`Relinked ${n} of ${offline.length} offline file${offline.length === 1 ? '' : 's'}${left ? `; ${left} still offline` : ''}`, left ? 'info' : 'success');
  else state().showToast('None of the chosen files match the offline media (name and duration)', 'error');
  return n;
}

/**
 * Points an asset at a different file, keeping every clip that uses it.
 * Without a path, asks for one. The metadata is re-read from the new file.
 */
export async function replaceFootage(assetId: string, path?: string): Promise<boolean> {
  const a = findAsset(assetId);
  if (!a) return false;
  let target = path;
  if (!target) {
    const picked = await window.omega.dialogs.pickFiles(`Replace ${a.name}`, [...MEDIA_EXTENSIONS]);
    target = picked?.[0];
  }
  if (!target) return false;
  const r = await probeFile(target);
  if (!r.ok) {
    state().showToast(`Cannot use ${r.name}: ${r.error}`, 'error');
    return false;
  }
  const n = r.asset;
  if (isProxyJobActive(assetId)) cancelProxy(assetId);
  state().mutate('Replace footage', (d) => {
    const x = d.assets.find((y) => y.id === assetId);
    if (!x) return;
    // keep the user's name unless it was just the old file name
    if (x.name === basename(x.path)) x.name = n.name;
    x.path = n.path;
    x.kind = n.kind;
    x.duration = n.duration;
    x.width = n.width;
    x.height = n.height;
    x.fps = n.fps;
    x.codec = n.codec;
    x.audioCodec = n.audioCodec;
    x.channels = n.channels;
    x.sampleRate = n.sampleRate;
    x.size = n.size;
    x.hasAudio = n.hasAudio;
    x.hasVideo = n.hasVideo;
    x.offline = false;
    x.proxyPath = null;
    x.proxyStatus = 'none';
    if (x.markIn != null && x.markIn >= n.duration) x.markIn = null;
    if (x.markOut != null && x.markOut > n.duration) x.markOut = null;
    if (x.inputTransform === 'auto' || x.inputTransform === 'pq' || x.inputTransform === 'hlg') x.inputTransform = n.inputTransform;
  });
  forget([assetId]);
  state().showToast(`Replaced with ${n.name}`, 'success');
  return true;
}

/** Shows the asset's file in the OS file manager. */
export function revealInFolder(assetId: string): void {
  const a = findAsset(assetId);
  if (!a) return;
  if (a.offline) {
    state().showToast(`${a.name} is offline`, 'error');
    return;
  }
  window.omega.files.showInFolder(a.path);
}

/** Removes every asset that no clip in any sequence uses. Returns how many were removed. */
export function removeUnused(): number {
  const p = state().project;
  if (!p) return 0;
  const used = usedAssetIds(p);
  const unused = p.assets.filter((a) => !used.has(a.id)).map((a) => a.id);
  if (!unused.length) {
    state().showToast('Every item is used in a sequence', 'info');
    return 0;
  }
  removeAssets(unused, `Remove ${unused.length} unused item${unused.length === 1 ? '' : 's'}`);
  state().showToast(`Removed ${unused.length} unused item${unused.length === 1 ? '' : 's'}`, 'success');
  return unused.length;
}

/** Removes assets (and, with removeClips, every clip that uses them) in one undo step. */
export function removeAssets(ids: string[], label: string, removeClips = false): void {
  const set = new Set(ids);
  if (!set.size) return;
  for (const id of set) if (isProxyJobActive(id)) cancelProxy(id);
  state().mutate(label, (d) => {
    d.assets = d.assets.filter((a) => !set.has(a.id));
    if (removeClips) {
      for (const seq of d.sequences) for (const t of seq.tracks) t.clips = t.clips.filter((c) => !(c.assetId && set.has(c.assetId)));
    }
  });
  const s = state();
  if (s.source.assetId && set.has(s.source.assetId)) s.setSource({ assetId: null, time: 0 });
  const clipIds = new Set((s.project?.sequences ?? []).flatMap((q) => q.tracks.flatMap((t) => t.clips.map((c) => c.id))));
  s.select({ assetIds: s.selection.assetIds.filter((id) => !set.has(id)), clipIds: s.selection.clipIds.filter((id) => clipIds.has(id)) });
  forget(set);
}
