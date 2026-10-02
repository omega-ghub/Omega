// Keyboard shortcuts editor (Mod+Alt+K): every registered action, grouped and
// searchable. Click a binding and press keys to rebind; conflicts offer a swap.
// Presets for Premiere Pro, Final Cut Pro and DaVinci Resolve; a printable
// cheat sheet. OWNED BY THE SHELL PACKAGE.

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../../../state/store';
import { I } from '../../../ui/Icons';
import { Dialog } from '../../../ui/Modal';
import { MenuButton } from '../../../ui/Menu';
import { Keys, Segmented } from '../../../ui/controls';
import { displayKey, eventToKey, getAction, keysFor, listActions, onActionsChanged, setKeys } from '../actions';
import { searchScore } from './fuzzy';
import { conflictsFor, isModifierOnly, presetOverrides, PRESETS, type PresetId } from './keymap';

const GROUP_ORDER = ['Playback', 'Marking', 'Tools', 'Edit', 'Timeline', 'Clip', 'Sequence', 'Media', 'Effects', 'Color', 'Audio', 'Captions', 'Export', 'View', 'Project', 'Help'];
const STATIC_LABEL: Record<string, string> = { 'edit.undo': 'Undo', 'edit.redo': 'Redo' };

interface Row {
  id: string;
  label: string;
  group: string;
  keys: string[];
  defaults: string[];
}

function useRows(): Row[] {
  const [v, setV] = useState(0);
  useEffect(() => onActionsChanged(() => setV((x) => x + 1)), []);
  return useMemo(() => {
    void v;
    return listActions().map((a) => ({ id: a.id, label: STATIC_LABEL[a.id] ?? a.label, group: a.group, keys: keysFor(a.id), defaults: a.keys ?? [] }));
  }, [v]);
}

function groupRows(rows: Row[]): [string, Row[]][] {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    if (!map.has(r.group)) map.set(r.group, []);
    map.get(r.group)!.push(r);
  }
  const rank = (g: string) => {
    const i = GROUP_ORDER.indexOf(g);
    return i < 0 ? 100 : i;
  };
  return [...map.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])).map(([g, list]) => [g, list.sort((a, b) => a.label.localeCompare(b.label))]);
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

export function ShortcutsEditor({ onClose, initialView = 'edit' }: { onClose: () => void; initialView?: 'edit' | 'sheet' }) {
  const rows = useRows();
  const [view, setView] = useState<'edit' | 'sheet'>(initialView);
  const [query, setQuery] = useState('');
  const [capture, setCapture] = useState<{ id: string; index: number } | null>(null);
  const [pending, setPending] = useState<{ id: string; index: number; key: string; others: string[] } | null>(null);
  const [printing, setPrinting] = useState(false);
  const showToast = useEditor((s) => s.showToast);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return rows;
    return rows.filter((r) => {
      if (
        searchScore(q, {
          label: r.label,
          extra: [
            { text: r.group, weight: 0.6 },
            { text: r.id, weight: 0.5 },
          ],
        })
      )
        return true;
      // also find by key: "ctrl k", "B"
      const keyText = r.keys.map((k) => `${k} ${displayKey(k)}`).join(' ');
      return keyText.toLowerCase().includes(q.toLowerCase());
    });
  }, [rows, query]);
  const groups = useMemo(() => groupRows(filtered), [filtered]);

  const currentPreset: PresetId | null = useMemo(() => {
    const infos = rows.map((r) => ({ id: r.id, label: r.label, keys: r.defaults }));
    for (const p of PRESETS) {
      const o = presetOverrides(p.id, infos);
      if (rows.every((r) => same(r.keys, o[r.id] ?? r.defaults))) return p.id;
    }
    return null;
  }, [rows]);
  const customized = rows.filter((r) => !same(r.keys, r.defaults)).length;

  // Capture the next key combination.
  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapture(null);
        return;
      }
      if (isModifierOnly(e.key)) return;
      const key = eventToKey(e);
      const bindings = rows.map((r) => ({ id: r.id, keys: r.keys }));
      const others = conflictsFor(key, capture.id, bindings);
      setCapture(null);
      if (others.length) setPending({ ...capture, key, others });
      else assign(capture.id, capture.index, key);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture, rows]);

  const assign = (id: string, index: number, key: string) => {
    const cur = keysFor(id);
    const next = [...cur];
    if (index >= next.length) next.push(key);
    else next[index] = key;
    setKeys(id, dedupe(next));
  };

  const resolve = (mode: 'swap' | 'steal') => {
    if (!pending) return;
    const { id, index, key, others } = pending;
    const old = keysFor(id)[index];
    for (const o of others) {
      const ks = keysFor(o);
      const next = mode === 'swap' && old ? ks.map((k) => (k === key ? old : k)) : ks.filter((k) => k !== key);
      setKeys(o, dedupe(next));
    }
    assign(id, index, key);
    setPending(null);
  };

  const remove = (id: string, index: number) => {
    const next = keysFor(id).filter((_, i) => i !== index);
    setKeys(id, next);
  };

  const applyPreset = (p: PresetId) => {
    const infos = rows.map((r) => ({ id: r.id, label: r.label, keys: r.defaults }));
    const o = presetOverrides(p, infos);
    for (const r of rows) setKeys(r.id, o[r.id] ?? null);
    setPending(null);
    showToast(`${PRESETS.find((x) => x.id === p)!.name.replace(' (default)', '')} shortcuts applied`, 'success');
  };

  const resetAll = () => {
    for (const r of rows) setKeys(r.id, null);
    setPending(null);
  };

  const print = () => {
    setPrinting(true);
    document.body.classList.add('is-printing');
    const done = () => {
      document.body.classList.remove('is-printing');
      setPrinting(false);
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    // let the print portal render first
    setTimeout(() => {
      window.print();
      setTimeout(done, 400);
    }, 50);
  };

  const presetName = currentPreset ? PRESETS.find((p) => p.id === currentPreset)!.name.replace(' (default)', '') : 'Custom';

  return (
    <Dialog
      title="Keyboard shortcuts"
      subtitle={customized ? `${presetName} layout · ${customized} customized` : `${presetName} layout`}
      icon={<I.Keyboard size={17} />}
      onClose={onClose}
      width={880}
      height={560}
      flush
      testId="sh-shortcuts"
      footerLeft={
        <>
          <I.Info size={14} /> Click a shortcut, then press the new keys. Esc cancels.
        </>
      }
      footer={
        <>
          {view === 'sheet' && (
            <button className="btn btn--sm" onClick={print} data-testid="sh-shortcuts-print">
              <I.Export size={14} /> Print
            </button>
          )}
          <button className="btn btn--sm btn--primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="sh-keys__bar">
        <div className="input-group sh-keys__search">
          <I.Search size={14} />
          <input
            className="input input--sm"
            placeholder="Search actions or keys"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            data-testid="sh-shortcuts-search"
            spellCheck={false}
          />
        </div>
        <MenuButton
          className="btn btn--sm"
          testId="sh-shortcuts-preset"
          items={PRESETS.map((p) => ({ label: p.name, checked: currentPreset === p.id, onSelect: () => applyPreset(p.id), testId: `sh-preset-${p.id}` }))}
        >
          <I.Layout size={14} /> {presetName}
          <I.ChevronDown size={13} />
        </MenuButton>
        <button className="btn btn--sm btn--ghost" onClick={resetAll} disabled={!customized} data-testid="sh-shortcuts-reset-all">
          <I.Refresh size={14} /> Reset all
        </button>
        <div style={{ marginLeft: 'auto' }}>
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'edit', label: 'Editor', testId: 'sh-shortcuts-view-edit' },
              { value: 'sheet', label: 'Cheat sheet', testId: 'sh-shortcuts-view-sheet' },
            ]}
          />
        </div>
      </div>

      {view === 'sheet' ? (
        <div className="sh-sheet" data-testid="sh-cheatsheet">
          <CheatSheet groups={groups} />
        </div>
      ) : (
        <div className="sh-keys__list" data-testid="sh-shortcuts-list">
          {groups.length === 0 && <div className="sh-keys__empty">No actions match “{query}”.</div>}
          {groups.map(([group, list]) => (
            <section key={group} className="sh-keys__group">
              <div className="sh-keys__group-title">{group}</div>
              {list.map((r) => {
                const changed = !same(r.keys, r.defaults);
                const pend = pending?.id === r.id ? pending : null;
                return (
                  <div key={r.id} className={`sh-keys__row ${pend ? 'has-conflict' : ''}`} data-testid="sh-shortcut-row" data-action={r.id}>
                    <div className="sh-keys__main">
                      <div className="sh-keys__label">
                        <span>{r.label}</span>
                        {changed && <span className="sh-keys__changed" title="Customized" />}
                      </div>
                      <div className="sh-keys__binds">
                        {r.keys.map((k, i) =>
                          capture?.id === r.id && capture.index === i ? (
                            <span key={i} className="sh-keys__capture">
                              Press keys…
                            </span>
                          ) : (
                            <span key={i} className="sh-keys__chip">
                              <button className="sh-keys__chip-btn" onClick={() => setCapture({ id: r.id, index: i })} data-tip="Click to change" data-testid="sh-shortcut-chip">
                                <Keys binding={k} />
                              </button>
                              <button className="sh-keys__chip-x" aria-label={`Remove ${displayKey(k)}`} onClick={() => remove(r.id, i)}>
                                <I.Close size={11} />
                              </button>
                            </span>
                          ),
                        )}
                        {capture?.id === r.id && capture.index >= r.keys.length ? (
                          <span className="sh-keys__capture">Press keys…</span>
                        ) : (
                          <button
                            className="icon-btn icon-btn--xs sh-keys__add"
                            data-tip="Add shortcut"
                            aria-label="Add shortcut"
                            data-testid="sh-shortcut-add"
                            onClick={() => setCapture({ id: r.id, index: r.keys.length })}
                          >
                            <I.Plus size={13} />
                          </button>
                        )}
                        <button
                          className="icon-btn icon-btn--xs sh-keys__reset"
                          data-tip="Reset to default"
                          aria-label="Reset to default"
                          style={{ visibility: changed ? 'visible' : 'hidden' }}
                          onClick={() => setKeys(r.id, null)}
                        >
                          <I.Undo size={13} />
                        </button>
                      </div>
                    </div>
                    {pend && (
                      <div className="sh-keys__conflict" role="alert" data-testid="sh-shortcut-conflict">
                        <I.Warning size={14} />
                        <span>
                          <Keys binding={pend.key} /> is used by <b>{pend.others.map((o) => STATIC_LABEL[o] ?? getAction(o)?.label ?? o).join(', ')}</b>.
                        </span>
                        <span className="sh-keys__conflict-actions">
                          {keysFor(r.id)[pend.index] && (
                            <button className="btn btn--xs" onClick={() => resolve('swap')} data-testid="sh-conflict-swap">
                              Swap
                            </button>
                          )}
                          <button className="btn btn--xs" onClick={() => resolve('steal')} data-testid="sh-conflict-replace">
                            Reassign
                          </button>
                          <button className="btn btn--xs btn--ghost" onClick={() => setPending(null)}>
                            Cancel
                          </button>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
      {printing &&
        createPortal(
          <div className="print-portal sh-print">
            <h1>Delta keyboard shortcuts</h1>
            <p>{presetName} layout</p>
            <CheatSheet groups={groupRows(rows)} />
          </div>,
          document.body,
        )}
    </Dialog>
  );
}

function dedupe(keys: string[]): string[] {
  return [...new Set(keys)];
}

function CheatSheet({ groups }: { groups: [string, Row[]][] }) {
  return (
    <div className="sh-sheet__cols">
      {groups.map(([group, list]) => {
        const bound = list.filter((r) => r.keys.length);
        if (!bound.length) return null;
        return (
          <section key={group} className="sh-sheet__group">
            <h3>{group}</h3>
            <table>
              <tbody>
                {bound.map((r) => (
                  <tr key={r.id}>
                    <td>{r.label}</td>
                    <td>
                      {r.keys.map((k) => (
                        <Keys key={k} binding={k} />
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
