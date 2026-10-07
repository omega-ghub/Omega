// Effects browser: Effects / Transitions tabs, keyword search, collapsible
// categories, favorites, drag onto timeline clips ('omega/effect',
// 'omega/transition'), double-click or Enter to apply to the selection.

import { useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';
import { listEffects, listTransitions } from '../../../engine/effects/registry';
import type { EffectCategory } from '../../../engine/effects/types';
import { FxI } from './icons';
import { groupByCategory, searchItems, type FavKind, favKey } from './logic';
import { applyEffect, applyTransition, setUi, toggleFavoriteItem, useFavorites, useUi } from './ops';
import { swatchFor } from './swatch';
import './effects.css';

const EFFECT_ORDER: EffectCategory[] = ['Blur & Sharpen', 'Color', 'Stylize', 'Distort', 'Keying', 'Light', 'Film', 'Generate', 'Utility'];
const TRANSITION_ORDER = ['Dissolve', 'Wipe', 'Motion', 'Stylized'];

interface Row {
  kind: FavKind;
  type: string;
  name: string;
  category: string;
  description: string;
  keywords?: string[];
}

function Item({ row, fav, onHover }: { row: Row; fav: boolean; onHover: (r: Row | null) => void }) {
  const apply = () => (row.kind === 'effect' ? applyEffect(row.type) : applyTransition(row.type));
  const onDrag = (e: DragEvent) => {
    e.dataTransfer.setData(row.kind === 'effect' ? 'omega/effect' : 'omega/transition', row.type);
    e.dataTransfer.setData('text/plain', row.name);
    e.dataTransfer.effectAllowed = 'copy';
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      apply();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const all = Array.from(e.currentTarget.closest('.fx-list')?.querySelectorAll<HTMLElement>('.fx-item') ?? []);
      const i = all.indexOf(e.currentTarget as HTMLElement);
      all[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
    }
  };
  return (
    <div
      className="fx-item"
      role="option"
      tabIndex={0}
      draggable
      title={`${row.name}: double-click or press Enter to apply, or drag onto a clip`}
      data-testid={`fx-${row.kind === 'effect' ? 'add' : 'transition'}-${row.type}`}
      onDragStart={onDrag}
      onDoubleClick={apply}
      onKeyDown={onKey}
      onMouseEnter={() => onHover(row)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(row)}
    >
      <img className="fx-item__swatch" src={swatchFor(row.category, row.type)} alt="" draggable={false} />
      <span className="fx-item__name">{row.name}</span>
      <button
        type="button"
        className={`fx-item__fav${fav ? ' is-on' : ''}`}
        aria-pressed={fav}
        aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
        title={fav ? 'Remove from favorites' : 'Add to favorites'}
        data-testid={`fx-fav-${row.type}`}
        onClick={(e) => {
          e.stopPropagation();
          toggleFavoriteItem(row.kind, row.type);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <FxI.Star size={13} filled={fav} />
      </button>
    </div>
  );
}

export function EffectsBrowser(_props: Record<string, unknown> = {}) {
  const ui = useUi();
  const favs = useFavorites();
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<Row | null>(null);
  const tab = ui.tab;

  const rows = useMemo<Row[]>(() => {
    if (tab === 'effects') return listEffects().map((d) => ({ kind: 'effect', type: d.type, name: d.name, category: d.category, description: d.description, keywords: d.keywords }));
    return listTransitions().map((d) => ({ kind: 'transition', type: d.type, name: d.name, category: d.category, description: d.description }));
  }, [tab]);

  const found = useMemo(() => searchItems(rows, query), [rows, query]);
  const searching = query.trim().length > 0;
  const favRows = useMemo(() => favs.map((k) => rows.find((r) => favKey(r.kind, r.type) === k)).filter((r): r is Row => !!r), [favs, rows]);
  const groups = useMemo(() => (searching ? [{ category: `Results (${found.length})`, items: found }] : groupByCategory(found, tab === 'effects' ? EFFECT_ORDER : TRANSITION_ORDER)), [found, searching, tab]);
  const collapsed = new Set(ui.collapsed);
  const toggle = (id: string) => setUi({ collapsed: collapsed.has(id) ? ui.collapsed.filter((c) => c !== id) : [...ui.collapsed, id] });
  const shown = hover;

  const section = (id: string, title: string, items: Row[], forceOpen = false) => {
    const key = `${tab}:${id}`;
    const open = forceOpen || !collapsed.has(key);
    return (
      <div className="fx-cat" key={id} data-testid={`fx-cat-${id}`}>
        <button type="button" className="fx-cat__head" aria-expanded={open} onClick={() => !forceOpen && toggle(key)}>
          <FxI.Chevron size={12} className={`fx-cat__chev${open ? ' is-open' : ''}`} />
          <span>{title}</span>
          <span className="fx-cat__count">{items.length}</span>
        </button>
        {open && items.map((r) => <Item key={`${r.kind}:${r.type}`} row={r} fav={favs.includes(favKey(r.kind, r.type))} onHover={setHover} />)}
      </div>
    );
  };

  return (
    <div className="fx-browser" data-testid="fx-browser">
      <div className="fx-tabs" role="tablist">
        {(['effects', 'transitions'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`fx-tab${tab === t ? ' is-on' : ''}`} data-testid={`fx-tab-${t}`} onClick={() => setUi({ tab: t })}>
            {t === 'effects' ? 'Effects' : 'Transitions'}
          </button>
        ))}
      </div>
      <div className="fx-search">
        <FxI.Search size={14} />
        <input
          value={query}
          placeholder={tab === 'effects' ? 'Search effects' : 'Search transitions'}
          aria-label="Search"
          spellCheck={false}
          data-testid="fx-search"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') setQuery('');
            if (e.key === 'ArrowDown') document.querySelector<HTMLElement>('.fx-browser .fx-item')?.focus();
          }}
        />
        {query && (
          <button type="button" className="fx-search__clear" aria-label="Clear search" onClick={() => setQuery('')}>
            <FxI.Close size={12} />
          </button>
        )}
      </div>
      <div className="fx-list" role="listbox" data-testid="fx-list">
        {!searching && favRows.length > 0 && section('favorites', 'Favorites', favRows)}
        {groups.map((g) => section(g.category, g.category, g.items, searching))}
        {!groups.length && <div className="fx-empty">No matches for “{query}”</div>}
      </div>
      <div className="fx-desc" data-testid="fx-description">
        {shown ? (
          <>
            <div className="fx-desc__title">
              {shown.name}
              <span>{shown.category}</span>
            </div>
            <p>{shown.description}</p>
          </>
        ) : (
          <p className="fx-desc__hint">Double-click or press Enter to apply to the selected clips, or drag onto a clip{tab === 'transitions' ? ' edge' : ''}.</p>
        )}
      </div>
    </div>
  );
}
