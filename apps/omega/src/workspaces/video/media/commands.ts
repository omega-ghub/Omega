// Media-browser commands: everything the toolbar, context menus, keyboard
// and actions do. Each document change is one labelled undo step.

import { placeMedia, type EditMode } from '../../../engine/edit/ops';
import { importMedia, type ImportResult } from '../../../engine/media/import';
import { defaultDropFrame, evenDim, MEDIA_EXTENSIONS, IMPORT_EXTENSIONS } from '../../../engine/media/mediaMath';
import { removeAssets } from '../../../engine/media/relink';
import { assetUsage } from '../../../engine/media/usage';
import { useEditor } from '../../../state/store';
import type { InputTransform, LabelColor, MediaAsset } from '../../../state/types';
import { activeSequence, newId } from '../../../state/types';
import { getAction, runAction } from '../actions';
import { canMoveBin, deleteBinInPlace, uniqueBinName } from './model';
import { useMediaUi } from './uiStore';

const ed = () => useEditor.getState();
const ui = () => useMediaUi.getState();

function assets(ids: string[]): MediaAsset[] {
  const p = ed().project;
  if (!p) return [];
  const set = new Set(ids);
  return p.assets.filter((a) => set.has(a.id));
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** The bin new imports land in: the open bin, if it still exists. */
export function currentImportBin(): string | null {
  const id = ui().openBinId;
  return id && ed().project?.bins.some((b) => b.id === id) ? id : null;
}

/** Import entry point (shell drops, the Import button): files land in the open bin. */
export function importPaths(paths: string[], sizes?: Record<string, number>): Promise<ImportResult> {
  return importMedia(paths, { binId: currentImportBin(), sizes });
}

export async function importViaDialog(): Promise<void> {
  if (!ed().project) return;
  try {
    const files = await window.omega.dialogs.pickMedia();
    if (!files?.length) return;
    const sizes: Record<string, number> = {};
    for (const f of files) if (f.size) sizes[f.path] = f.size;
    await importPaths(
      files.map((f) => f.path),
      sizes,
    );
  } catch (err) {
    ed().showToast(`Import failed: ${(err as Error).message}`, 'error');
  }
}

/** LUTs and captions are not in the media dialog's filter: offer them through the generic picker. */
export async function importOtherFiles(): Promise<void> {
  const paths = await window.omega.dialogs.pickFiles('Import LUTs and captions', ['cube', 'srt', 'vtt']);
  if (paths?.length) await importPaths(paths);
}

export const SUPPORTED_SUMMARY = {
  video: 'MP4, MOV, WebM, MKV',
  audio: 'WAV, MP3, AAC, M4A, FLAC, Ogg, Opus',
  image: 'PNG, JPEG, WebP, AVIF, GIF, SVG',
  other: '.cube LUTs, .srt and .vtt captions',
};

export function isImportablePath(p: string): boolean {
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  return IMPORT_EXTENSIONS.includes(ext) || MEDIA_EXTENSIONS.includes(ext);
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export function selectAssets(ids: string[], anchorId?: string | null) {
  ed().select({ assetIds: ids });
  if (anchorId !== undefined) ui().set({ anchorId });
}

export function openInSource(assetId: string) {
  const a = assets([assetId])[0];
  if (!a) return;
  ed().setSource({ assetId: a.id, time: a.markIn ?? 0 });
}

/** Insert / overwrite at the playhead: the timeline's action when it exists, else placeMedia directly. */
export function editIntoTimeline(ids: string[], mode: EditMode) {
  const list = assets(ids);
  if (!list.length) return;
  ed().select({ assetIds: list.map((a) => a.id) });
  const actionId = mode === 'insert' ? 'timeline.insert' : 'timeline.overwrite';
  if (getAction(actionId) && runAction(actionId)) return;
  const label = `${mode === 'insert' ? 'Insert' : 'Overwrite'} ${list.length === 1 ? list[0].name : `${list.length} clips`}`;
  try {
    let t = ed().playhead;
    ed().mutateSequence(label, (seq, project) => {
      for (const a of list) {
        const created = new Set(placeMedia(project, seq, a.id, { start: t, mode }) ?? []);
        for (const tr of seq.tracks) for (const c of tr.clips) if (created.has(c.id)) t = Math.max(t, c.start + c.duration);
      }
    });
  } catch (err) {
    ed().showToast(`Could not edit into the timeline: ${(err as Error).message}`, 'error');
  }
}

export function renameAsset(id: string, name: string) {
  const n = name.trim();
  const a = assets([id])[0];
  if (!a || !n || n === a.name) return;
  ed().mutate(`Rename ${a.name}`, (d) => {
    const x = d.assets.find((y) => y.id === id);
    if (x) x.name = n;
  });
}

export function setLabel(ids: string[], label: LabelColor) {
  if (!ids.length) return;
  const set = new Set(ids);
  ed().mutate(`Label ${ids.length} ${plural(ids.length, 'item')}`, (d) => {
    for (const a of d.assets) if (set.has(a.id)) a.label = label;
  });
}

export function setRating(ids: string[], rating: number) {
  if (!ids.length) return;
  const set = new Set(ids);
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  ed().mutate(r ? `Rate ${r} ${plural(r, 'star')}` : 'Clear rating', (d) => {
    for (const a of d.assets) if (set.has(a.id)) a.rating = r;
  });
}

export function setNotes(id: string, notes: string) {
  const a = assets([id])[0];
  if (!a || (a.notes ?? '') === notes) return;
  ed().mutate('Edit notes', (d) => {
    const x = d.assets.find((y) => y.id === id);
    if (x) x.notes = notes;
  });
}

export function setInputTransform(ids: string[], t: InputTransform) {
  if (!ids.length) return;
  const set = new Set(ids);
  ed().mutate('Set input transform', (d) => {
    for (const a of d.assets) if (set.has(a.id)) a.inputTransform = t;
  });
}

/** Match the active sequence's frame size and rate to a clip. */
export function matchSequenceTo(id: string) {
  const a = assets([id])[0];
  if (!a || !a.width || !a.height) return;
  const p = ed().project;
  if (!p) return;
  const seq = activeSequence(p);
  const w = evenDim(a.width);
  const h = evenDim(a.height);
  const fps = a.kind === 'video' && a.fps ? a.fps : seq.fps;
  if (seq.width === w && seq.height === h && seq.fps === fps) {
    ed().showToast(`${seq.name} already matches ${a.name}`, 'info');
    return;
  }
  ed().mutateSequence(`Match sequence to ${a.name}`, (s) => {
    s.width = w;
    s.height = h;
    if (fps !== s.fps) {
      s.fps = fps;
      s.dropFrame = defaultDropFrame(fps);
    }
  });
  ed().showToast(`${seq.name}: ${w}×${h} at ${fps} fps`, 'success');
}

/** Removes assets; if clips use them, asks first (offering to remove those clips too). */
export function requestRemove(ids: string[]) {
  const p = ed().project;
  if (!p || !ids.length) return;
  const inUse = ids.filter((id) => assetUsage(p, id).length > 0);
  if (inUse.length) {
    ed().openModal('media.removeInUse', { assetIds: ids });
    return;
  }
  const one = ids.length === 1 ? assets(ids)[0]?.name : null;
  removeAssets(ids, one ? `Remove ${one}` : `Remove ${ids.length} items`);
}

/** Selects every clip that uses the asset (active sequence). */
export function selectUsageInTimeline(id: string) {
  const p = ed().project;
  if (!p) return;
  const seq = activeSequence(p);
  const use = assetUsage(p, id).find((u) => u.sequenceId === seq.id);
  if (!use) {
    ed().showToast('Not used in this sequence', 'info');
    return;
  }
  ed().selectClips(use.clipIds, 'replace');
}

// ---------------------------------------------------------------------------
// Bins
// ---------------------------------------------------------------------------

export function newBin(parentId: string | null = currentImportBin(), moveAssetIds: string[] = []): string | null {
  const p = ed().project;
  if (!p) return null;
  const parent = parentId && p.bins.some((b) => b.id === parentId) ? parentId : null;
  const id = newId('bin');
  const name = uniqueBinName(p.bins, parent);
  const move = new Set(moveAssetIds);
  ed().mutate(move.size ? `New bin from ${move.size} ${plural(move.size, 'item')}` : 'New bin', (d) => {
    d.bins.push({ id, name, parentId: parent });
    for (const a of d.assets) if (move.has(a.id)) a.binId = id;
  });
  // rename where the new bin is visible: in the content when it opens there, else in the tree
  const where = parent === (ui().openBinId ?? null) && !ui().query && ui().filter === 'all' ? 'content' : 'tree';
  ui().set({ renaming: { kind: 'bin', id, where }, expanded: { ...ui().expanded, ...(parent ? { [parent]: true } : {}) } });
  return id;
}

export function renameBin(id: string, name: string) {
  const n = name.trim();
  const b = ed().project?.bins.find((x) => x.id === id);
  if (!b || !n || n === b.name) return;
  ed().mutate(`Rename bin ${b.name}`, (d) => {
    const x = d.bins.find((y) => y.id === id);
    if (x) x.name = n;
  });
}

export function deleteBin(id: string) {
  const b = ed().project?.bins.find((x) => x.id === id);
  if (!b) return;
  ed().mutate(`Delete bin ${b.name}`, (d) => deleteBinInPlace(d, id));
  if (ui().openBinId === id) ui().set({ openBinId: b.parentId });
}

export function moveAssetsToBin(ids: string[], binId: string | null) {
  const p = ed().project;
  if (!p || !ids.length) return;
  const target = binId && p.bins.some((b) => b.id === binId) ? binId : null;
  const set = new Set(ids.filter((id) => p.assets.find((a) => a.id === id && (a.binId ?? null) !== target)));
  if (!set.size) return;
  const name = target ? p.bins.find((b) => b.id === target)!.name : 'Project';
  ed().mutate(`Move ${set.size} ${plural(set.size, 'item')} to ${name}`, (d) => {
    for (const a of d.assets) if (set.has(a.id)) a.binId = target;
  });
}

export function moveBin(id: string, parentId: string | null) {
  const p = ed().project;
  if (!p || id === parentId) return;
  const b = p.bins.find((x) => x.id === id);
  if (!b || (b.parentId ?? null) === parentId || !canMoveBin(p.bins, id, parentId)) return;
  ed().mutate(`Move bin ${b.name}`, (d) => {
    const x = d.bins.find((y) => y.id === id);
    if (x) x.parentId = parentId;
  });
  if (parentId) ui().set({ expanded: { ...ui().expanded, [parentId]: true } });
}

export function openBin(id: string | null) {
  ui().set({ openBinId: id, renaming: null });
}

export function focusSearch() {
  if (ed().workspace !== 'edit') ed().setWorkspace('edit');
  ui().set({ focusSearchTick: ui().focusSearchTick + 1 });
}
