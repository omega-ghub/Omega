// Drag and drop payloads of the media browser.
//   'omega/asset'  = one asset id (always set: the dragged item)
//   'omega/assets' = JSON array of ids (set when several are dragged)
//   'omega/bin'    = a bin id (moving bins in the tree)
// OS files arrive as 'Files' and are imported through importPaths.

import { importMedia } from '../../../engine/media/import';
import { moveAssetsToBin, moveBin } from './commands';

export const DT_ASSET = 'omega/asset';
export const DT_ASSETS = 'omega/assets';
export const DT_BIN = 'omega/bin';

export function setAssetDrag(dt: DataTransfer, ids: string[], primary: string) {
  dt.effectAllowed = 'copyMove';
  dt.setData(DT_ASSET, primary);
  if (ids.length > 1) dt.setData(DT_ASSETS, JSON.stringify(ids));
  dt.setData('text/plain', ids.length > 1 ? `${ids.length} clips` : primary);
}

export function hasAssets(dt: DataTransfer | null): boolean {
  return !!dt && (dt.types.includes(DT_ASSET) || dt.types.includes(DT_ASSETS));
}

export function hasBin(dt: DataTransfer | null): boolean {
  return !!dt && dt.types.includes(DT_BIN);
}

export function hasFiles(dt: DataTransfer | null): boolean {
  return !!dt && dt.types.includes('Files');
}

export function readAssets(dt: DataTransfer): string[] {
  try {
    const many = dt.getData(DT_ASSETS);
    if (many) {
      const ids = JSON.parse(many);
      if (Array.isArray(ids)) return ids.filter((x) => typeof x === 'string');
    }
  } catch {
    /* fall through */
  }
  const one = dt.getData(DT_ASSET);
  return one ? [one] : [];
}

/** Absolute paths of OS files in a drop. */
export function droppedPaths(dt: DataTransfer): string[] {
  const out: string[] = [];
  for (const f of Array.from(dt.files ?? [])) {
    try {
      const p = window.omega.files.pathForFile(f);
      if (p) out.push(p);
    } catch {
      /* not a real file */
    }
  }
  return out;
}

/** Whether a drag over a bin target is something it accepts. */
export function acceptsDrop(dt: DataTransfer | null): boolean {
  return hasAssets(dt) || hasBin(dt) || hasFiles(dt);
}

/** Drop onto a bin (null = project root): moves assets or bins, imports files into it. */
export function dropOnBin(dt: DataTransfer, binId: string | null): boolean {
  if (hasFiles(dt)) {
    const paths = droppedPaths(dt);
    if (paths.length) void importMedia(paths, { binId });
    return paths.length > 0;
  }
  if (hasBin(dt)) {
    const id = dt.getData(DT_BIN);
    if (id && id !== binId) moveBin(id, binId);
    return true;
  }
  if (hasAssets(dt)) {
    moveAssetsToBin(readAssets(dt), binId);
    return true;
  }
  return false;
}
