// The bins tree (left of the media browser): open, nest by drag, rename
// inline, and drop clips or files onto a bin.
import { memo, useMemo, type ReactNode } from 'react';
import { useEditor } from '../../../state/store';
import type { Bin, MediaAsset } from '../../../state/types';
import { I } from '../../../ui/Icons';
import { useContextMenu } from '../../../ui/Menu';
import { newBin, openBin, renameBin } from './commands';
import { DT_BIN } from './dnd';
import { MdIcons } from './icons';
import { binMenu } from './menus';
import { childBins } from './model';
import { RenameInput } from './RenameInput';
import { useMediaUi } from './uiStore';

export const ROOT_DROP = '__root';
const NO_BINS: Bin[] = [];
const NO_ASSETS: MediaAsset[] = [];

export const BinTree = memo(function BinTree({ width }: { width: number }) {
  const bins = useEditor((s) => s.project?.bins ?? NO_BINS);
  const assets = useEditor((s) => s.project?.assets ?? NO_ASSETS);
  const openBinId = useMediaUi((s) => s.openBinId);
  const expanded = useMediaUi((s) => s.expanded);
  const renaming = useMediaUi((s) => s.renaming);
  const dropBin = useMediaUi((s) => s.dropBin);
  const menu = useContextMenu();

  const counts = useMemo(() => {
    const valid = new Set(bins.map((b) => b.id));
    const m = new Map<string, number>();
    for (const a of assets) {
      const k = a.binId && valid.has(a.binId) ? a.binId : ROOT_DROP;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [assets, bins]);

  const toggle = (id: string) => {
    const ui = useMediaUi.getState();
    ui.set({ expanded: { ...ui.expanded, [id]: !ui.expanded[id] } });
  };

  const rows: ReactNode[] = [];
  const walk = (parent: string | null, depth: number, seen: Set<string>) => {
    for (const b of childBins(bins, parent)) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      const kids = bins.some((x) => x.parentId === b.id);
      const isOpen = !!expanded[b.id];
      rows.push(
        <TreeRow
          key={b.id}
          bin={b}
          depth={depth}
          count={counts.get(b.id) ?? 0}
          hasChildren={kids}
          expanded={isOpen}
          current={openBinId === b.id}
          renaming={renaming?.kind === 'bin' && renaming.id === b.id && renaming.where === 'tree'}
          dropping={dropBin === b.id}
          onToggle={() => toggle(b.id)}
          onMenu={(e) => menu.open(e, binMenu(b, 'tree'))}
        />,
      );
      if (kids && isOpen) walk(b.id, depth + 1, seen);
    }
  };
  walk(null, 1, new Set());

  return (
    <nav className="md-tree" style={{ width }} data-testid="md-tree" aria-label="Bins" role="tree">
      <div
        className={`md-tree__row md-tree__row--root ${openBinId === null ? 'is-current' : ''} ${dropBin === ROOT_DROP ? 'is-drop' : ''}`}
        data-testid="md-bin-root"
        data-drop-bin={ROOT_DROP}
        role="treeitem"
        aria-selected={openBinId === null}
        onClick={() => openBin(null)}
        onContextMenu={(e) =>
          menu.open(e, [{ label: 'New Bin', icon: <MdIcons.FolderPlus size={15} />, action: 'media.newBin', onSelect: () => newBin(null) }])
        }
        style={{ paddingLeft: 6 }}
      >
        <span className="md-tree__twisty" />
        <I.Bin size={15} className="md-tree__icon" />
        <span className="md-tree__name">Project</span>
        <span className="md-tree__count">{assets.length || ''}</span>
      </div>
      {rows}
      {menu.element}
    </nav>
  );
});

const TreeRow = memo(function TreeRow({
  bin,
  depth,
  count,
  hasChildren,
  expanded,
  current,
  renaming,
  dropping,
  onToggle,
  onMenu,
}: {
  bin: Bin;
  depth: number;
  count: number;
  hasChildren: boolean;
  expanded: boolean;
  current: boolean;
  renaming: boolean;
  dropping: boolean;
  onToggle: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const Icon = current ? MdIcons.FolderOpen : I.Folder;
  return (
    <div
      className={`md-tree__row ${current ? 'is-current' : ''} ${dropping ? 'is-drop' : ''}`}
      style={{ paddingLeft: 6 + depth * 12 }}
      data-testid="md-bin"
      data-bin-id={bin.id}
      data-drop-bin={bin.id}
      role="treeitem"
      aria-selected={current}
      aria-expanded={hasChildren ? expanded : undefined}
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(DT_BIN, bin.id);
      }}
      onClick={() => openBin(bin.id)}
      onDoubleClick={() => useMediaUi.getState().set({ renaming: { kind: 'bin', id: bin.id, where: 'tree' } })}
      onContextMenu={onMenu}
      title={bin.name}
    >
      <button
        className="md-tree__twisty"
        style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
        aria-label={expanded ? 'Collapse' : 'Expand'}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <I.ChevronRight size={12} className={expanded ? 'is-open' : ''} />
      </button>
      <Icon size={15} className="md-tree__icon" />
      {renaming ? (
        <RenameInput initial={bin.name} onCommit={(v) => renameBin(bin.id, v)} onDone={() => useMediaUi.getState().set({ renaming: null })} />
      ) : (
        <span className="md-tree__name">{bin.name}</span>
      )}
      <span className="md-tree__count">{count || ''}</span>
    </div>
  );
});
