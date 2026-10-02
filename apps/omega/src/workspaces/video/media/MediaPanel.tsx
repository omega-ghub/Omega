// The media browser (left column of the Edit workspace). OWNED BY THE MEDIA PACKAGE.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { mediaJobs } from '../../../engine/media/jobs';
import { cancelProxy } from '../../../engine/media/proxies';
import { refreshOffline, relinkOffline } from '../../../engine/media/relink';
import { usedAssetIds } from '../../../engine/media/usage';
import { useEditor } from '../../../state/store';
import type { Bin, MediaAsset } from '../../../state/types';
import { activeSequence } from '../../../state/types';
import { I } from '../../../ui/Icons';
import { MenuButton, useContextMenu, type MenuItem } from '../../../ui/Menu';
import { displayKey, isMac, keysFor } from '../actions';
import { ROOT_DROP, BinTree } from './BinTree';
import { importViaDialog, newBin, openBin, openInSource, requestRemove, selectAssets, SUPPORTED_SUMMARY } from './commands';
import { acceptsDrop, dropOnBin, droppedPaths, hasAssets, hasBin, hasFiles, setAssetDrag } from './dnd';
import { GridView } from './GridView';
import { MdIcons } from './icons';
import { ListView } from './ListView';
import { assetMenu, backgroundMenu, binMenu } from './menus';
import { ProxySuggestion } from './Modals';
import { assetsInScope, binAncestors, childBins, clickSelect, filterAssets, sortAssets, totalDuration, type KindFilter, type SortKey } from './model';
import { tcLabel, type ItemHandlers } from './parts';
import { useMediaUi } from './uiStore';
import { importMedia } from '../../../engine/media/import';
import './media.css';

const NO_ASSETS: MediaAsset[] = [];
const NO_BINS: Bin[] = [];
const NO_IDS: string[] = [];
const NO_USED = new Set<string>();

const FILTERS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All Media' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'image', label: 'Images' },
  { id: 'offline', label: 'Offline' },
  { id: 'unused', label: 'Unused' },
];

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'name', label: 'Name' },
  { id: 'importedAt', label: 'Date Imported' },
  { id: 'duration', label: 'Duration' },
  { id: 'kind', label: 'Type' },
  { id: 'resolution', label: 'Resolution' },
];

const mod = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey);

export function MediaPanel({ className = '' }: { className?: string } = {}) {
  const hasProject = useEditor((s) => !!s.project);
  if (!hasProject) return <section className={`panel md ${className}`} data-testid="md-panel" />;
  return <Browser className={className} />;
}

function Browser({ className }: { className: string }) {
  const assets = useEditor((s) => s.project?.assets ?? NO_ASSETS);
  const bins = useEditor((s) => s.project?.bins ?? NO_BINS);
  const ui = useMediaUi();
  // clip usage is only needed for the Unused filter: do not re-render on every timeline edit otherwise
  const sequences = useEditor((s) => (ui.filter === 'unused' ? s.project?.sequences : undefined));
  const seqFps = useEditor((s) => (s.project ? activeSequence(s.project).fps : 30));
  const selectedIds = useEditor((s) => s.selection.assetIds ?? NO_IDS);
  const importing = useStore(mediaJobs, (s) => s.importing);
  const proxyJobs = useStore(mediaJobs, (s) => s.proxies);
  const rootRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  const menu = useContextMenu();

  // ---- derived lists ----
  const openBinId = ui.openBinId && bins.some((b) => b.id === ui.openBinId) ? ui.openBinId : null;
  const used = useMemo(() => (sequences ? usedAssetIds({ sequences }) : NO_USED), [sequences]);
  const flat = ui.query.trim() !== '' || ui.filter !== 'all';
  const visible = useMemo(() => {
    const scope = assetsInScope({ assets, bins }, openBinId, flat);
    return sortAssets(filterAssets(scope, { query: ui.query, filter: ui.filter, used }), ui.sortKey, ui.sortDir);
  }, [assets, bins, openBinId, flat, ui.query, ui.filter, used, ui.sortKey, ui.sortDir]);
  const visibleBins = useMemo(() => (flat ? [] : childBins(bins, openBinId)), [bins, openBinId, flat]);
  const ordered = useMemo(() => visible.map((a) => a.id), [visible]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const binCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assets) if (a.binId) m.set(a.binId, (m.get(a.binId) ?? 0) + 1);
    for (const b of bins) if (b.parentId) m.set(b.parentId, (m.get(b.parentId) ?? 0) + 1);
    return m;
  }, [assets, bins]);
  const crumbs = binAncestors(bins, openBinId);
  const offlineCount = useMemo(() => assets.filter((a) => a.offline).length, [assets]);

  // ---- latest values for stable handlers ----
  const live = useRef({ ordered, selectedIds, visible });
  live.current = { ordered, selectedIds, visible };

  // ---- layout: hide the tree when the panel is narrow ----
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const showTree = ui.treeOpen && width >= 360;

  // ---- focus the search field on request (media.find) ----
  useEffect(() => {
    if (!ui.focusSearchTick) return;
    requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  }, [ui.focusSearchTick]);

  // ---- offline check when the window regains focus (files moved in Finder) ----
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const onFocus = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void refreshOffline().catch(() => undefined), 400);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      if (t) clearTimeout(t);
    };
  }, []);

  // keep the opened bin's ancestors expanded in the tree
  useEffect(() => {
    if (!openBinId) return;
    const anc = binAncestors(bins, openBinId).slice(0, -1);
    const exp = useMediaUi.getState().expanded;
    if (anc.some((b) => !exp[b.id])) useMediaUi.getState().set({ expanded: { ...exp, ...Object.fromEntries(anc.map((b) => [b.id, true])) } });
  }, [openBinId, bins]);

  // ---- item handlers (stable) ----
  const handlers = useMemo<ItemHandlers>(() => {
    const assetById = (id: string) => live.current.visible.find((a) => a.id === id) ?? useEditor.getState().project?.assets.find((a) => a.id === id);
    return {
      down(id, e) {
        if (e.button !== 0) return;
        const { selectedIds: sel } = live.current;
        if (!sel.includes(id) && !e.shiftKey && !mod(e)) selectAssets([id], id);
      },
      click(id, e) {
        const { selectedIds: sel, ordered: ord } = live.current;
        const m = e.shiftKey ? 'range' : mod(e) ? 'toggle' : 'replace';
        const anchor = useMediaUi.getState().anchorId;
        selectAssets(clickSelect(sel, ord, anchor, id, m), m === 'range' ? anchor : id);
        rootRef.current?.focus({ preventScroll: true });
      },
      dbl(id) {
        const a = assetById(id);
        if (a && !a.offline) openInSource(id);
      },
      menu(id, e) {
        const { selectedIds: sel, ordered: ord } = live.current;
        const ids = sel.includes(id) ? ord.filter((x) => sel.includes(x)) : [id];
        if (!sel.includes(id)) selectAssets([id], id);
        const a = assetById(id);
        if (a) menu.open(e, assetMenu(ids.length ? ids : [id], a));
      },
      drag(id, e) {
        const { selectedIds: sel, ordered: ord } = live.current;
        const ids = sel.includes(id) ? ord.filter((x) => sel.includes(x)) : [id];
        if (!sel.includes(id)) selectAssets([id], id);
        setAssetDrag(e.dataTransfer, ids.length ? ids : [id], id);
      },
      binOpen(id) {
        openBin(id);
      },
      binMenu(bin, e) {
        menu.open(e, binMenu(bin));
      },
    };
  }, [menu.open]);

  // ---- keyboard ----
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select')) return;
    const { ordered: ord, selectedIds: sel } = live.current;
    const last = sel.length ? sel[sel.length - 1] : null;
    const idx = last ? ord.indexOf(last) : -1;
    const step = (delta: number) => {
      if (!ord.length) return;
      const next = ord[Math.max(0, Math.min(ord.length - 1, idx < 0 ? 0 : idx + delta))];
      if (e.shiftKey) {
        const anchor = useMediaUi.getState().anchorId ?? last ?? next;
        selectAssets(clickSelect(sel, ord, anchor, next, 'range'), anchor);
      } else selectAssets([next], next);
      contentRef.current?.querySelector(`[data-asset-id="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    const cols = () => {
      if (ui.view !== 'grid') return 1;
      const grid = contentRef.current?.querySelector('.md-grid') as HTMLElement | null;
      if (!grid) return 1;
      return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    };
    let handled = true;
    if (e.key === 'ArrowRight' && ui.view === 'grid') step(1);
    else if (e.key === 'ArrowLeft' && ui.view === 'grid') step(-1);
    else if (e.key === 'ArrowDown') step(cols());
    else if (e.key === 'ArrowUp') step(-cols());
    else if (e.key === 'Home') step(-ord.length);
    else if (e.key === 'End') step(ord.length);
    else if (e.key === 'Enter' && sel.length === 1) openInSource(sel[0]);
    else if (e.key === 'F2' && sel.length === 1) ui.set({ renaming: { kind: 'asset', id: sel[0] } });
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) requestRemove(ord.filter((x) => sel.includes(x)).concat(sel.filter((x) => !ord.includes(x))));
    else if (mod(e) && !e.shiftKey && e.key.toLowerCase() === 'a') selectAssets(ord, ord[0] ?? null);
    else if (e.key === 'Escape' && sel.length) selectAssets([], null);
    else if (e.key === 'Backspace' && !sel.length && openBinId) openBin(bins.find((b) => b.id === openBinId)?.parentId ?? null);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ---- drag & drop (OS files import; clips and bins move between bins) ----
  const dropTargetOf = (e: React.DragEvent): string | null => {
    const el = (e.target as HTMLElement).closest?.('[data-drop-bin]') as HTMLElement | null;
    return el ? el.dataset.dropBin ?? null : null;
  };
  const clearDrag = useCallback(() => useMediaUi.getState().set({ dropBin: null, fileDrag: false }), []);
  const onDragOver = (e: React.DragEvent) => {
    const dt = e.dataTransfer;
    if (!acceptsDrop(dt)) return;
    const target = dropTargetOf(e);
    const files = hasFiles(dt);
    if (!files && !target) {
      // clips over empty space: nothing to do
      if (hasAssets(dt) || hasBin(dt)) useMediaUi.getState().dropBin !== null && useMediaUi.getState().set({ dropBin: null });
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    dt.dropEffect = files ? 'copy' : 'move';
    const s = useMediaUi.getState();
    if (s.dropBin !== target || s.fileDrag !== files) s.set({ dropBin: target, fileDrag: files });
  };
  const onDragLeave = (e: React.DragEvent) => {
    const next = e.relatedTarget as Node | null;
    if (!next || !rootRef.current?.contains(next)) clearDrag();
  };
  const onDrop = (e: React.DragEvent) => {
    const dt = e.dataTransfer;
    const target = dropTargetOf(e);
    clearDrag();
    if (!acceptsDrop(dt)) return;
    e.preventDefault();
    e.stopPropagation();
    const binId = target === ROOT_DROP ? null : target;
    if (hasFiles(dt)) {
      const paths = droppedPaths(dt);
      if (paths.length) void importMedia(paths, { binId: target ? binId : openBinId });
      return;
    }
    if (target) dropOnBin(dt, binId);
  };
  useEffect(() => {
    window.addEventListener('dragend', clearDrag);
    window.addEventListener('drop', clearDrag);
    return () => {
      window.removeEventListener('dragend', clearDrag);
      window.removeEventListener('drop', clearDrag);
    };
  }, [clearDrag]);

  // ---- toolbar menus ----
  const filterItems = (): MenuItem[] =>
    FILTERS.map((f) => ({
      label: f.label,
      checked: ui.filter === f.id,
      testId: `md-filter-${f.id}`,
      onSelect: () => ui.set({ filter: f.id }),
    }));
  const sortItems = (): MenuItem[] => [
    { type: 'header', label: 'Sort By' },
    ...SORTS.map((s) => ({ label: s.label, checked: ui.sortKey === s.id, testId: `md-sort-${s.id}`, onSelect: () => ui.setPrefs({ sortKey: s.id, sortDir: s.id === 'importedAt' ? 'desc' : 'asc' }) }) as MenuItem),
    { type: 'separator' },
    { label: 'Ascending', checked: ui.sortDir === 'asc', testId: 'md-sort-asc', onSelect: () => ui.setPrefs({ sortDir: 'asc' }) },
    { label: 'Descending', checked: ui.sortDir === 'desc', testId: 'md-sort-desc', onSelect: () => ui.setPrefs({ sortDir: 'desc' }) },
  ];

  const empty = assets.length === 0 && bins.length === 0;
  const total = totalDuration(visible);
  const runningProxy = proxyJobs.find((j) => j.status !== 'queued') ?? proxyJobs[0];
  const importKey = keysFor('media.import')[0];

  const startTreeResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = ui.treeWidth;
    const move = (ev: PointerEvent) => useMediaUi.getState().set({ treeWidth: Math.max(120, Math.min(320, w0 + ev.clientX - x0)) });
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      useMediaUi.getState().setPrefs({ treeWidth: useMediaUi.getState().treeWidth });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <section
      ref={rootRef}
      className={`panel md ${ui.fileDrag ? 'is-file-drag' : ''} ${className}`}
      data-testid="md-panel"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="panel__head md-head">
        <span className="panel__title">Media</span>
        <nav className="md-crumbs" aria-label="Bin path" data-testid="md-breadcrumbs">
          <button
            className={`md-crumb ${ui.dropBin === ROOT_DROP ? 'is-drop' : ''}`}
            data-testid="md-breadcrumb"
            data-drop-bin={ROOT_DROP}
            onClick={() => openBin(null)}
            disabled={!openBinId}
          >
            Project
          </button>
          {crumbs.map((b) => (
            <span key={b.id} className="md-crumbs__seg">
              <I.ChevronRight size={11} className="md-crumbs__sep" />
              <button
                className={`md-crumb ${ui.dropBin === b.id ? 'is-drop' : ''}`}
                data-testid="md-breadcrumb"
                data-drop-bin={b.id}
                onClick={() => openBin(b.id)}
                disabled={b.id === openBinId}
                title={b.name}
              >
                {b.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="panel__actions">
          <button className="btn btn--xs md-import" data-testid="md-import" aria-label="Import" data-tip="Import media" data-tip-action="media.import" onClick={() => void importViaDialog()}>
            <I.Import size={14} />
            <span className="md-import__label">Import</span>
          </button>
          <button className="icon-btn icon-btn--sm" data-testid="md-new-bin" aria-label="New bin" data-tip="New bin" data-tip-action="media.newBin" onClick={() => newBin()}>
            <MdIcons.FolderPlus size={16} />
          </button>
        </div>
      </header>

      <div className="md-toolbar">
        <button
          className={`icon-btn icon-btn--xs ${showTree ? 'is-on' : ''}`}
          aria-pressed={showTree}
          aria-label="Bins"
          data-tip={width < 360 ? 'Widen the panel to show bins' : 'Show bins'}
          data-testid="md-tree-toggle"
          disabled={width < 360}
          onClick={() => ui.setPrefs({ treeOpen: !ui.treeOpen })}
        >
          <I.PanelLeft size={14} />
        </button>
        <label className="md-search">
          <I.Search size={13} />
          <input
            ref={searchRef}
            className="md-search__input"
            data-testid="md-search"
            type="search"
            placeholder="Search name, notes, codec"
            value={ui.query}
            spellCheck={false}
            onChange={(e) => ui.set({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                if (ui.query) ui.set({ query: '' });
                else rootRef.current?.focus();
              } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
                e.preventDefault();
                rootRef.current?.focus();
                if (live.current.ordered[0]) selectAssets([live.current.ordered[0]], live.current.ordered[0]);
              }
            }}
          />
          {ui.query && (
            <button className="md-search__clear" aria-label="Clear search" onClick={() => ui.set({ query: '' })}>
              <I.Close size={12} />
            </button>
          )}
        </label>
        {ui.filter !== 'all' && (
          <span className="badge badge--accent md-filter-chip" data-testid="md-filter-chip">
            {FILTERS.find((f) => f.id === ui.filter)?.label}
            <button aria-label="Clear filter" onClick={() => ui.set({ filter: 'all' })}>
              <I.Close size={10} />
            </button>
          </span>
        )}
        <MenuButton className={`icon-btn icon-btn--xs ${ui.filter !== 'all' ? 'is-on' : ''}`} testId="md-filter" tip="Filter" items={filterItems}>
          <I.Filter size={14} />
        </MenuButton>
        <MenuButton className="icon-btn icon-btn--xs" testId="md-sort" tip="Sort" items={sortItems}>
          <I.Sort size={14} />
        </MenuButton>
        <div className="seg seg--sm md-view" role="group" aria-label="View">
          <button className={ui.view === 'grid' ? 'is-active' : ''} aria-pressed={ui.view === 'grid'} aria-label="Grid view" data-tip="Grid" data-testid="md-view-grid" onClick={() => ui.setPrefs({ view: 'grid' })}>
            <I.GridView size={13} />
          </button>
          <button className={ui.view === 'list' ? 'is-active' : ''} aria-pressed={ui.view === 'list'} aria-label="List view" data-tip="List" data-testid="md-view-list" onClick={() => ui.setPrefs({ view: 'list' })}>
            <I.ListView size={13} />
          </button>
        </div>
      </div>

      <div className="md-body">
        {showTree && !empty && (
          <>
            <BinTree width={ui.treeWidth} />
            <div className="md-tree-resize" onPointerDown={startTreeResize} role="separator" aria-orientation="vertical" />
          </>
        )}
        <div
          ref={contentRef}
          className="md-content"
          data-testid="md-content"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('md-grid') || (e.target as HTMLElement).classList.contains('md-list')) {
              if (e.button === 0 && !e.shiftKey && !mod(e)) selectAssets([], null);
              rootRef.current?.focus({ preventScroll: true });
            }
          }}
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest('[data-asset-id], [data-bin-id]')) return;
            menu.open(e, backgroundMenu());
          }}
        >
          {empty ? (
            <EmptyState importKey={importKey} />
          ) : visible.length === 0 && visibleBins.length === 0 ? (
            <div className="empty-state md-none" data-testid="md-no-results">
              {flat ? (
                <>
                  <div className="empty-state__title">No matching media</div>
                  <div className="empty-state__sub">{ui.query ? `Nothing matches “${ui.query}”` : 'Nothing matches this filter'}</div>
                  <div className="empty-state__actions">
                    <button className="btn btn--xs btn--ghost" onClick={() => ui.set({ query: '', filter: 'all' })}>
                      Clear Search
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="empty-state__title">This bin is empty</div>
                  <div className="empty-state__sub">Drag clips here, or drop files to import them into this bin.</div>
                </>
              )}
            </div>
          ) : ui.view === 'grid' ? (
            <GridView bins={visibleBins} assets={visible} selected={selected} handlers={handlers} seqFps={seqFps} binCounts={binCounts} />
          ) : (
            <ListView bins={visibleBins} assets={visible} selected={selected} handlers={handlers} seqFps={seqFps} binCounts={binCounts} />
          )}
        </div>
      </div>

      <ProxySuggestion />

      <footer className="md-foot" data-testid="md-footer">
        <span className="md-foot__count">
          {visible.length} {visible.length === 1 ? 'item' : 'items'}
          {total > 0 && <span className="md-foot__dur"> · {tcLabel(total, seqFps)}</span>}
          {selectedIds.length > 1 && <span className="md-foot__sel"> · {selectedIds.length} selected</span>}
        </span>
        {offlineCount > 0 && (
          <button className="md-foot__offline" data-testid="md-relink" data-tip="Locate the missing files" onClick={() => void relinkOffline()}>
            <MdIcons.Offline size={12} />
            {offlineCount} offline · Relink
          </button>
        )}
        <span className="md-foot__spacer" />
        {importing && (
          <span className="md-job" data-testid="md-progress-import" title={importing.current}>
            <span className="md-job__label">
              Importing {Math.min(importing.done + 1, importing.total)}/{importing.total}
            </span>
            <span className="progress__bar md-job__bar">
              <span className="progress__fill" style={{ width: `${(importing.done / Math.max(1, importing.total)) * 100}%` }} />
            </span>
          </span>
        )}
        {runningProxy && (
          <span className="md-job" data-testid="md-progress-proxy" title={`${runningProxy.name}${runningProxy.codec ? ` → ${runningProxy.codec.toUpperCase()}` : ''}`}>
            <I.Proxy size={12} />
            <span className="md-job__label">
              {runningProxy.status === 'paused' ? 'Paused' : runningProxy.status === 'queued' ? 'Queued' : `${Math.round(runningProxy.progress * 100)}%`}
              {proxyJobs.length > 1 ? ` · ${proxyJobs.length - 1} more` : ''}
            </span>
            <span className="progress__bar md-job__bar">
              <span className="progress__fill" style={{ width: `${runningProxy.progress * 100}%` }} />
            </span>
            <button className="md-job__cancel" aria-label="Cancel proxy" data-tip="Cancel proxy" data-testid="md-proxy-cancel" onClick={() => cancelProxy(runningProxy.assetId)}>
              <I.Close size={11} />
            </button>
          </span>
        )}
        {ui.view === 'grid' && !empty && (
          <label className="md-size" data-tip="Thumbnail size">
            <I.GridView size={11} />
            <input
              type="range"
              min={96}
              max={280}
              step={4}
              value={ui.thumbWidth}
              data-testid="md-thumb-size"
              aria-label="Thumbnail size"
              onChange={(e) => ui.setPrefs({ thumbWidth: Number(e.target.value) })}
            />
          </label>
        )}
      </footer>

      {ui.fileDrag && (
        <div className="md-drop" data-testid="md-drop-overlay" aria-hidden="true">
          <div className="md-drop__card">
            <MdIcons.DropIn size={22} />
            <span>
              Import into <b>{ui.dropBin && ui.dropBin !== ROOT_DROP ? (bins.find((b) => b.id === ui.dropBin)?.name ?? 'bin') : ui.dropBin === ROOT_DROP ? 'Project' : (crumbs[crumbs.length - 1]?.name ?? 'Project')}</b>
            </span>
          </div>
        </div>
      )}
      {menu.element}
    </section>
  );
}

function EmptyState({ importKey }: { importKey?: string }) {
  return (
    <div className="empty-state md-empty" data-testid="md-empty">
      <div className="empty-state__icon">
        <I.Import size={20} />
      </div>
      <div className="empty-state__title">Import media to get started</div>
      <div className="empty-state__sub">
        Drop files here{importKey ? (
          <>
            {' '}
            or press <kbd className="kbd">{displayKey(importKey)}</kbd>
          </>
        ) : null}
        .
      </div>
      <div className="empty-state__actions">
        <button className="btn btn--sm btn--primary" data-testid="md-empty-import" onClick={() => void importViaDialog()}>
          <I.Import size={14} />
          Import Media
        </button>
      </div>
      <dl className="md-formats">
        <dt>Video</dt>
        <dd>{SUPPORTED_SUMMARY.video}</dd>
        <dt>Audio</dt>
        <dd>{SUPPORTED_SUMMARY.audio}</dd>
        <dt>Images</dt>
        <dd>{SUPPORTED_SUMMARY.image}</dd>
        <dt>Also</dt>
        <dd>{SUPPORTED_SUMMARY.other}</dd>
      </dl>
    </div>
  );
}
