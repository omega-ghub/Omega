// Context menus of the media browser (items for ui/Menu's ContextMenu).
import { canBuildProxy, cancelProxy, buildProxies, deleteProxy, effectiveProxyStatus } from '../../../engine/media/proxies';
import { INPUT_TRANSFORM_LABELS } from '../../../engine/media/mediaMath';
import { relinkOffline, removeUnused, replaceFootage, revealInFolder } from '../../../engine/media/relink';
import { LABEL_COLORS } from '../../../state/defaults';
import { useEditor } from '../../../state/store';
import type { Bin, InputTransform, LabelColor, MediaAsset } from '../../../state/types';
import { I } from '../../../ui/Icons';
import type { MenuItem } from '../../../ui/Menu';
import { isMac } from '../actions';
import {
  deleteBin,
  editIntoTimeline,
  importOtherFiles,
  importViaDialog,
  matchSequenceTo,
  newBin,
  openBin,
  openInSource,
  requestRemove,
  selectUsageInTimeline,
  setInputTransform,
  setLabel,
  setRating,
} from './commands';
import { MdIcons } from './icons';
import { useMediaUi } from './uiStore';

const LABEL_NAMES: [LabelColor, string][] = [
  ['none', 'None'],
  ['red', 'Red'],
  ['orange', 'Orange'],
  ['yellow', 'Yellow'],
  ['green', 'Green'],
  ['teal', 'Teal'],
  ['blue', 'Blue'],
  ['violet', 'Violet'],
  ['pink', 'Pink'],
  ['grey', 'Grey'],
];

export const REVEAL_LABEL = isMac ? 'Reveal in Finder' : 'Show in Folder';

function dot(color: string) {
  return <span className="md-menu-dot" style={{ background: color }} />;
}

export function labelItems(ids: string[], current: LabelColor | undefined): MenuItem[] {
  return LABEL_NAMES.map(([id, name]) => ({
    label: name,
    icon: id === 'none' ? <span className="md-menu-dot md-menu-dot--none" /> : dot(LABEL_COLORS[id]),
    checked: (current ?? 'none') === id,
    testId: `md-label-${id}`,
    onSelect: () => setLabel(ids, id),
  }));
}

export function ratingItems(ids: string[], current: number | undefined): MenuItem[] {
  return [0, 1, 2, 3, 4, 5].map((r) => ({
    label: r === 0 ? 'No rating' : '★'.repeat(r) + '☆'.repeat(5 - r),
    checked: (current ?? 0) === r,
    testId: `md-rate-${r}`,
    onSelect: () => setRating(ids, r),
  }));
}

export function inputTransformItems(ids: string[], current: InputTransform): MenuItem[] {
  const groups: InputTransform[][] = [['auto', 'rec709', 'srgb', 'linear'], ['slog3', 'logc3', 'vlog', 'clog3', 'flog'], ['hlg', 'pq']];
  const out: MenuItem[] = [];
  groups.forEach((g, i) => {
    if (i) out.push({ type: 'separator' });
    for (const t of g) out.push({ label: INPUT_TRANSFORM_LABELS[t], checked: current === t, testId: `md-input-${t}`, onSelect: () => setInputTransform(ids, t) });
  });
  return out;
}

export function assetMenu(ids: string[], primary: MediaAsset): MenuItem[] {
  const all = useEditor.getState().project?.assets.filter((a) => ids.includes(a.id)) ?? [primary];
  const single = all.length === 1;
  const anyOffline = all.some((a) => a.offline);
  const visual = all.filter((a) => a.kind !== 'audio');
  const buildable = all.filter((a) => canBuildProxy(a));
  const building = all.filter((a) => effectiveProxyStatus(a) === 'building');
  const withProxy = all.filter((a) => a.proxyPath && effectiveProxyStatus(a) !== 'building');
  const items: MenuItem[] = [
    { label: 'Open in Source', icon: <I.Monitor size={15} />, shortcut: 'Enter', disabled: !single || primary.offline, testId: 'md-ctx-open', onSelect: () => openInSource(primary.id) },
    { label: 'Insert at Playhead', icon: <I.Insert size={15} />, shortcut: ',', disabled: anyOffline, testId: 'md-ctx-insert', onSelect: () => editIntoTimeline(ids, 'insert') },
    { label: 'Overwrite at Playhead', icon: <I.Overwrite size={15} />, shortcut: '.', disabled: anyOffline, testId: 'md-ctx-overwrite', onSelect: () => editIntoTimeline(ids, 'overwrite') },
    ...(single ? [{ label: 'Select in Timeline', icon: <I.Sequence size={15} />, testId: 'md-ctx-usage', onSelect: () => selectUsageInTimeline(primary.id) } as MenuItem] : []),
    { type: 'separator' },
    { label: 'Rename', icon: <I.Text size={15} />, shortcut: 'F2', disabled: !single, testId: 'md-ctx-rename', onSelect: () => useMediaUi.getState().set({ renaming: { kind: 'asset', id: primary.id } }) },
    { label: 'Label', icon: <I.Label size={15} />, testId: 'md-ctx-label', submenu: labelItems(ids, single ? primary.label : undefined) },
    { label: 'Rating', icon: <I.Star size={15} />, testId: 'md-ctx-rating', submenu: ratingItems(ids, single ? primary.rating : undefined) },
    ...(visual.length
      ? [{ label: 'Input Transform', icon: <I.Lut size={15} />, testId: 'md-ctx-input', submenu: inputTransformItems(visual.map((a) => a.id), single ? primary.inputTransform : ('' as InputTransform)) } as MenuItem]
      : []),
    { type: 'separator' },
  ];
  if (building.length) items.push({ label: building.length > 1 ? `Cancel ${building.length} Proxies` : 'Cancel Proxy', icon: <I.Close size={15} />, testId: 'md-ctx-cancel-proxy', onSelect: () => building.forEach((a) => cancelProxy(a.id)) });
  else
    items.push({
      label: withProxy.length && withProxy.length === buildable.length ? (buildable.length > 1 ? 'Rebuild Proxies' : 'Rebuild Proxy') : buildable.length > 1 ? `Build ${buildable.length} Proxies` : 'Build Proxy',
      icon: <I.Proxy size={15} />,
      disabled: !buildable.length,
      testId: 'md-ctx-build-proxy',
      onSelect: () => buildProxies(buildable.map((a) => a.id)),
    });
  if (withProxy.length) items.push({ label: withProxy.length > 1 ? `Detach ${withProxy.length} Proxies` : 'Detach Proxy', icon: <I.Unlink size={15} />, testId: 'md-ctx-delete-proxy', onSelect: () => deleteProxy(withProxy.map((a) => a.id)) });
  items.push({ type: 'separator' });
  if (anyOffline) items.push({ label: 'Relink…', icon: <I.Link size={15} />, testId: 'md-ctx-relink', onSelect: () => void relinkOffline(all.filter((a) => a.offline).map((a) => a.id)) });
  items.push(
    { label: 'Replace Footage…', icon: <I.Refresh size={15} />, disabled: !single, testId: 'md-ctx-replace', onSelect: () => void replaceFootage(primary.id) },
    { label: REVEAL_LABEL, icon: <I.Folder size={15} />, disabled: !single || primary.offline, testId: 'md-ctx-reveal', onSelect: () => revealInFolder(primary.id) },
    { label: 'Set as Sequence Format', icon: <I.Sequence size={15} />, disabled: !single || !primary.width || !primary.height, testId: 'md-ctx-match', onSelect: () => matchSequenceTo(primary.id) },
    { label: 'New Bin from Selection', icon: <MdIcons.FolderPlus size={15} />, testId: 'md-ctx-bin-from-selection', onSelect: () => newBin(useMediaUi.getState().openBinId, ids) },
    { type: 'separator' },
    { label: single ? 'Remove' : `Remove ${all.length} Items`, icon: <I.Trash size={15} />, shortcut: 'Delete', danger: true, testId: 'md-ctx-remove', onSelect: () => requestRemove(ids) },
  );
  return items;
}

export function binMenu(bin: Bin, where: 'tree' | 'content' = 'content'): MenuItem[] {
  return [
    { label: 'Open', icon: <MdIcons.FolderOpen size={15} />, testId: 'md-ctx-bin-open', onSelect: () => openBin(bin.id) },
    { label: 'New Bin Inside', icon: <MdIcons.FolderPlus size={15} />, testId: 'md-ctx-bin-new', onSelect: () => newBin(bin.id) },
    { label: 'Rename', icon: <I.Text size={15} />, shortcut: 'F2', testId: 'md-ctx-bin-rename', onSelect: () => useMediaUi.getState().set({ renaming: { kind: 'bin', id: bin.id, where } }) },
    { type: 'separator' },
    { label: 'Delete Bin', icon: <I.Trash size={15} />, danger: true, testId: 'md-ctx-bin-delete', onSelect: () => deleteBin(bin.id) },
  ];
}

export function backgroundMenu(): MenuItem[] {
  const p = useEditor.getState().project;
  const offline = p?.assets.filter((a) => a.offline).length ?? 0;
  const ui = useMediaUi.getState();
  return [
    { label: 'Import Media…', icon: <I.Import size={15} />, action: 'media.import', testId: 'md-ctx-import', onSelect: () => void importViaDialog() },
    { label: 'Import LUTs and Captions…', icon: <I.Lut size={15} />, testId: 'md-ctx-import-other', onSelect: () => void importOtherFiles() },
    { label: 'New Bin', icon: <MdIcons.FolderPlus size={15} />, action: 'media.newBin', testId: 'md-ctx-new-bin', onSelect: () => newBin() },
    { type: 'separator' },
    { label: ui.view === 'grid' ? 'View as List' : 'View as Grid', icon: ui.view === 'grid' ? <I.ListView size={15} /> : <I.GridView size={15} />, onSelect: () => ui.setPrefs({ view: ui.view === 'grid' ? 'list' : 'grid' }) },
    { type: 'separator' },
    { label: offline ? `Relink ${offline} Offline…` : 'Relink Offline Media…', icon: <I.Link size={15} />, disabled: !offline, action: 'media.relink', onSelect: () => void relinkOffline() },
    { label: 'Remove Unused', icon: <I.Trash size={15} />, disabled: !p?.assets.length, action: 'media.removeUnused', onSelect: () => removeUnused() },
  ];
}
