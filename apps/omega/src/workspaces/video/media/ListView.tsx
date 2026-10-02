// List view: sortable, resizable metadata columns with inline editing.
import { memo, useRef, useState } from 'react';
import { codecLabel, INPUT_TRANSFORM_LABELS } from '../../../engine/media/mediaMath';
import { LABEL_COLORS } from '../../../state/defaults';
import type { Bin, InputTransform, MediaAsset } from '../../../state/types';
import { I } from '../../../ui/Icons';
import { useContextMenu } from '../../../ui/Menu';
import { formatBytes } from '../../../ui/format';
import { renameAsset, renameBin, setInputTransform, setNotes, setRating } from './commands';
import { MdIcons } from './icons';
import { labelItems } from './menus';
import { AssetBadges, audioText, fpsText, fullTc, resolutionText, type ItemHandlers } from './parts';
import { RenameInput } from './RenameInput';
import { COLUMNS, colWidth, useMediaUi, type ColumnId } from './uiStore';

const TRANSFORMS = Object.keys(INPUT_TRANSFORM_LABELS) as InputTransform[];

export function ListView({
  bins,
  assets,
  selected,
  handlers,
  seqFps,
  binCounts,
}: {
  bins: Bin[];
  assets: MediaAsset[];
  selected: Set<string>;
  handlers: ItemHandlers;
  seqFps: number;
  binCounts: Map<string, number>;
}) {
  const widths = useMediaUi((s) => s.colWidths);
  const sortKey = useMediaUi((s) => s.sortKey);
  const sortDir = useMediaUi((s) => s.sortDir);
  const renaming = useMediaUi((s) => s.renaming);
  const dropBin = useMediaUi((s) => s.dropBin);
  const [live, setLive] = useState<Partial<Record<ColumnId, number>> | null>(null);
  const eff = live ?? widths;
  const template = COLUMNS.map((c) => `${colWidth(c.id, eff)}px`).join(' ');
  const total = COLUMNS.reduce((s, c) => s + colWidth(c.id, eff), 0);
  const labelMenu = useContextMenu();

  const startResize = (id: ColumnId, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const start = colWidth(id, widths);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let latest = { ...widths };
    const move = (ev: PointerEvent) => {
      latest = { ...widths, [id]: Math.max(COLUMNS.find((c) => c.id === id)!.min, Math.round(start + ev.clientX - startX)) };
      setLive(latest);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setLive(null);
      useMediaUi.getState().setPrefs({ colWidths: latest });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const sortBy = (key: (typeof COLUMNS)[number]['sort']) => {
    const ui = useMediaUi.getState();
    ui.setPrefs(ui.sortKey === key ? { sortDir: ui.sortDir === 'asc' ? 'desc' : 'asc' } : { sortKey: key, sortDir: key === 'importedAt' || key === 'rating' || key === 'size' ? 'desc' : 'asc' });
  };

  return (
    <div className="md-list" data-testid="md-list" style={{ '--md-cols': template, minWidth: total } as React.CSSProperties} role="grid" aria-multiselectable="true">
      <div className="md-list__head" role="row">
        {COLUMNS.map((c) => (
          <div
            key={c.id}
            className={`md-th ${c.align === 'right' ? 'md-th--right' : ''} ${sortKey === c.sort ? 'is-sorted' : ''}`}
            role="columnheader"
            aria-sort={sortKey === c.sort ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
            data-testid={`md-col-${c.id}`}
            onClick={() => sortBy(c.sort)}
          >
            <span className="md-th__label">{c.label}</span>
            {sortKey === c.sort && <I.ChevronDown size={11} className={`md-th__arrow ${sortDir === 'asc' ? 'is-asc' : ''}`} />}
            <span className="md-th__grip" onPointerDown={(e) => startResize(c.id, e)} onClick={(e) => e.stopPropagation()} data-testid={`md-col-resize-${c.id}`} />
          </div>
        ))}
      </div>
      {bins.map((b) => (
        <div
          key={b.id}
          className={`md-row md-row--bin ${dropBin === b.id ? 'is-drop' : ''}`}
          role="row"
          data-testid="md-bin-row"
          data-bin-id={b.id}
          data-drop-bin={b.id}
          draggable={!(renaming?.kind === 'bin' && renaming.id === b.id && renaming.where !== 'tree')}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('omega/bin', b.id);
          }}
          onDoubleClick={() => handlers.binOpen(b.id)}
          onContextMenu={(e) => handlers.binMenu(b, e)}
        >
          <div className="md-cell md-cell--name">
            <MdIcons.FolderOpen size={14} className="md-cell__icon" />
            {renaming?.kind === 'bin' && renaming.id === b.id && renaming.where !== 'tree' ? (
              <RenameInput initial={b.name} onCommit={(v) => renameBin(b.id, v)} onDone={() => useMediaUi.getState().set({ renaming: null })} />
            ) : (
              <span className="md-cell__text">{b.name}</span>
            )}
          </div>
          <div className="md-cell md-cell--muted" style={{ gridColumn: '2 / -1' }}>
            {binCounts.get(b.id) ?? 0} items
          </div>
        </div>
      ))}
      {assets.map((a) => (
        <Row
          key={a.id}
          asset={a}
          selected={selected.has(a.id)}
          renaming={renaming?.kind === 'asset' && renaming.id === a.id}
          handlers={handlers}
          seqFps={seqFps}
          onLabel={(el) => labelMenu.openAt(el, labelItems([a.id], a.label))}
        />
      ))}
      {labelMenu.element}
    </div>
  );
}

const Row = memo(function Row({
  asset: a,
  selected,
  renaming,
  handlers,
  seqFps,
  onLabel,
}: {
  asset: MediaAsset;
  selected: boolean;
  renaming: boolean;
  handlers: ItemHandlers;
  seqFps: number;
  onLabel: (el: HTMLElement) => void;
}) {
  const Icon = a.kind === 'audio' ? I.Music : a.kind === 'image' ? I.Image : I.Film;
  const rowRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={rowRef}
      className={`md-row ${selected ? 'is-selected' : ''} ${a.offline ? 'is-offline' : ''}`}
      role="row"
      aria-selected={selected}
      data-testid="md-item"
      data-asset-id={a.id}
      draggable={!renaming}
      onMouseDown={(e) => {
        // fields inside the row must not start a drag
        const interactive = (e.target as HTMLElement).closest('input, select, textarea, button');
        if (rowRef.current) rowRef.current.draggable = !interactive && !renaming;
        if (!interactive) handlers.down(a.id, e);
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('input, select, textarea, button')) return;
        handlers.click(a.id, e);
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('input, select, textarea, button')) return;
        handlers.dbl(a.id);
      }}
      onContextMenu={(e) => handlers.menu(a.id, e)}
      onDragStart={(e) => handlers.drag(a.id, e)}
      title={a.path}
    >
      <div className="md-cell md-cell--name">
        <Icon size={14} className="md-cell__icon" />
        {renaming ? (
          <RenameInput initial={a.name} onCommit={(v) => renameAsset(a.id, v)} onDone={() => useMediaUi.getState().set({ renaming: null })} />
        ) : (
          <span className="md-cell__text" data-testid="md-item-name">
            {a.name}
          </span>
        )}
        <span className="md-cell__badges">
          <AssetBadges asset={a} />
        </span>
      </div>
      <div className="md-cell md-cell--num">{fullTc(a, seqFps)}</div>
      <div className="md-cell md-cell--num">{resolutionText(a) || '—'}</div>
      <div className="md-cell md-cell--num">{fpsText(a) || '—'}</div>
      <div className="md-cell">{a.kind === 'image' ? (a.codec ?? '').toUpperCase() : codecLabel(a.codec) || '—'}</div>
      <div className="md-cell md-cell--muted">{audioText(a, codecLabel) || '—'}</div>
      <div className="md-cell md-cell--num">{a.size ? formatBytes(a.size) : '—'}</div>
      <div className="md-cell">
        <button className="md-label-btn" aria-label={`Label: ${a.label ?? 'none'}`} data-testid="md-label" onClick={(e) => onLabel(e.currentTarget)}>
          <span className={`md-dot ${!a.label || a.label === 'none' ? 'md-dot--none' : ''}`} style={a.label && a.label !== 'none' ? { background: LABEL_COLORS[a.label] } : undefined} />
        </button>
      </div>
      <div className="md-cell">
        <Stars value={a.rating ?? 0} onChange={(r) => setRating([a.id], r)} />
      </div>
      <div className="md-cell md-cell--edit">
        <NotesField id={a.id} value={a.notes ?? ''} />
      </div>
      <div className="md-cell md-cell--edit">
        {a.kind === 'audio' ? (
          <span className="md-cell__muted">—</span>
        ) : (
          <select
            className="md-select"
            value={a.inputTransform}
            data-testid="md-input-transform"
            aria-label="Input transform"
            onChange={(e) => setInputTransform([a.id], e.target.value as InputTransform)}
          >
            {TRANSFORMS.map((t) => (
              <option key={t} value={t}>
                {INPUT_TRANSFORM_LABELS[t]}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
});

function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <span className="md-stars" data-testid="md-rating" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          className={`md-star ${n <= shown ? 'is-on' : ''}`}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          data-testid={`md-star-${n}`}
          onMouseEnter={() => setHover(n)}
          onClick={(e) => {
            e.stopPropagation();
            onChange(n === value ? 0 : n);
          }}
        >
          {n <= shown ? <I.StarFilled size={11} /> : <I.Star size={11} />}
        </button>
      ))}
    </span>
  );
}

function NotesField({ id, value }: { id: string; value: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <input
      key={value}
      ref={ref}
      className="md-notes"
      defaultValue={value}
      placeholder="Add note"
      data-testid="md-notes"
      spellCheck={false}
      aria-label="Notes"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') ref.current?.blur();
        else if (e.key === 'Escape') {
          if (ref.current) ref.current.value = value;
          ref.current?.blur();
        }
      }}
      onBlur={(e) => setNotes(id, e.currentTarget.value.trim())}
    />
  );
}
