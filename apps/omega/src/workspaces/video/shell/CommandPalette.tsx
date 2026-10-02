// Command palette (Mod+Shift+P / Mod+P): fuzzy search over every registered
// action, plus sequences and clips. Recent commands first. ↑/↓ to move,
// Enter to run, Escape to close. OWNED BY THE SHELL PACKAGE.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { transport } from '../../../engine/playback/transport';
import { formatTimecode } from '../../../engine/time';
import { useEditor } from '../../../state/store';
import { activeSequence } from '../../../state/types';
import { I } from '../../../ui/Icons';
import { Modal } from '../../../ui/Modal';
import { Keys } from '../../../ui/controls';
import { keysFor, listActions, onActionsChanged, type Action } from '../actions';
import { searchScore } from './fuzzy';
import { useShell } from './state';

interface Item {
  key: string;
  kind: 'action' | 'sequence' | 'clip';
  label: string;
  group: string;
  hint?: string;
  binding?: string;
  icon: ReactNode;
  run: () => void;
  extra: { text: string; weight: number }[];
  recentRank?: number;
}

const GROUP_ICON: Record<string, ReactNode> = {
  Playback: <I.Play size={14} />,
  Edit: <I.Razor size={14} />,
  Timeline: <I.Sequence size={14} />,
  Marking: <I.MarkIn size={14} />,
  Tools: <I.Select size={14} />,
  Clip: <I.Film size={14} />,
  Sequence: <I.Sequence size={14} />,
  Color: <I.Wheel size={14} />,
  Audio: <I.Waveform size={14} />,
  Captions: <I.Captions size={14} />,
  Export: <I.Export size={14} />,
  View: <I.Layout size={14} />,
  Project: <I.Folder size={14} />,
  Help: <I.Help size={14} />,
  Media: <I.Bin size={14} />,
  Effects: <I.Fx size={14} />,
};

function useActionsVersion() {
  const [v, setV] = useState(0);
  useEffect(() => onActionsChanged(() => setV((x) => x + 1)), []);
  return v;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const version = useActionsVersion();
  const project = useEditor((s) => s.project);
  const recent = useShell((s) => s.recentActions);
  const noteRecent = useShell((s) => s.noteRecentAction);

  const all = useMemo<Item[]>(() => {
    void version;
    const items: Item[] = [];
    const usable = (a: Action) => {
      if (a.id === 'shell.palette') return false;
      try {
        return !a.enabled || a.enabled();
      } catch {
        return false;
      }
    };
    for (const a of listActions()) {
      if (!usable(a)) continue;
      const r = recent.indexOf(a.id);
      items.push({
        key: `a:${a.id}`,
        kind: 'action',
        label: a.label,
        group: a.group,
        hint: a.hint,
        binding: keysFor(a.id)[0],
        icon: GROUP_ICON[a.group] ?? <I.Command size={14} />,
        run: () => {
          noteRecent(a.id);
          a.run();
        },
        extra: [
          { text: a.group, weight: 0.55 },
          { text: a.id, weight: 0.5 },
          ...(a.hint ? [{ text: a.hint, weight: 0.4 }] : []),
        ],
        recentRank: r >= 0 ? r : undefined,
      });
    }
    if (project) {
      const ed = useEditor.getState();
      for (const s of project.sequences) {
        const current = s.id === project.activeSequenceId;
        items.push({
          key: `s:${s.id}`,
          kind: 'sequence',
          label: `Go to sequence ${s.name}`,
          group: 'Sequence',
          hint: `${s.width}×${s.height} · ${s.fps} fps${current ? ' · open' : ''}`,
          icon: <I.Sequence size={14} />,
          run: () => ed.setActiveSequence(s.id),
          extra: [{ text: s.name, weight: 0.9 }],
        });
      }
      const seq = activeSequence(project);
      for (const t of seq.tracks) {
        for (const c of t.clips) {
          items.push({
            key: `c:${c.id}`,
            kind: 'clip',
            label: `Select clip ${c.name}`,
            group: 'Clip',
            hint: `${t.name} · ${formatTimecode(c.start, seq.fps, seq.dropFrame, seq.startTimecode)}`,
            icon: c.kind === 'text' ? <I.Text size={14} /> : t.kind === 'audio' ? <I.Waveform size={14} /> : <I.Film size={14} />,
            run: () => {
              const e = useEditor.getState();
              e.selectClips([c.id]);
              transport.seek(c.start);
            },
            extra: [{ text: c.name, weight: 0.9 }],
          });
        }
      }
    }
    return items;
  }, [version, project, recent, noteRecent]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) {
      const recents = all.filter((i) => i.recentRank !== undefined).sort((a, b) => a.recentRank! - b.recentRank!);
      const rest = all
        .filter((i) => i.kind === 'action' && i.recentRank === undefined)
        .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
      return [
        ...recents.map((item) => ({ item, positions: [] as number[], section: 'Recent' })),
        ...rest.map((item) => ({ item, positions: [] as number[], section: item.group })),
      ];
    }
    const scored: { item: Item; positions: number[]; score: number; section: string }[] = [];
    for (const item of all) {
      const m = searchScore(q, { label: item.label, extra: item.extra });
      if (!m) continue;
      let score = m.score;
      if (item.recentRank !== undefined) score += 18 - item.recentRank;
      if (item.kind === 'clip') score -= 8;
      scored.push({ item, positions: m.positions, score, section: '' });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 80);
  }, [all, query]);

  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (i: number) => {
    const r = results[i];
    if (!r) return;
    onClose();
    // after the palette unmounts, so dialogs opened by the action get focus
    setTimeout(() => {
      try {
        r.item.run();
      } catch (err) {
        useEditor.getState().showToast(`${r.item.label} failed: ${(err as Error).message}`, 'error');
      }
    }, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      setIndex((i) => Math.min(results.length - 1, i + 8));
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 8));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(index);
    }
  };

  let lastSection = '';
  return (
    <Modal onClose={onClose} width={620} className="sh-palette" testId="sh-palette" label="Command palette">
      <div className="sh-palette__search">
        <I.Search size={16} />
        <input
          ref={inputRef}
          autoFocus
          className="sh-palette__input"
          placeholder="Search commands, sequences and clips…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          data-testid="sh-palette-input"
          aria-controls="sh-palette-list"
          aria-activedescendant={`sh-palette-opt-${index}`}
        />
        <kbd>Esc</kbd>
      </div>
      <div className="sh-palette__list" ref={listRef} id="sh-palette-list" role="listbox">
        {results.length === 0 && <div className="sh-palette__empty">No commands match “{query}”.</div>}
        {results.map((r, i) => {
          const header = r.section && r.section !== lastSection ? r.section : null;
          lastSection = r.section;
          return (
            <div key={r.item.key}>
              {header && <div className="sh-palette__section">{header}</div>}
              <div
                id={`sh-palette-opt-${i}`}
                role="option"
                aria-selected={i === index}
                data-index={i}
                data-testid="sh-palette-item"
                data-action={r.item.kind === 'action' ? r.item.key.slice(2) : undefined}
                className={`sh-palette__item ${i === index ? 'is-active' : ''}`}
                onMouseMove={() => i !== index && setIndex(i)}
                onClick={() => run(i)}
              >
                <span className="sh-palette__icon">{r.item.icon}</span>
                <span className="sh-palette__label">
                  <Highlight text={r.item.label} positions={r.positions} />
                  {r.item.hint && <span className="sh-palette__hint">{r.item.hint}</span>}
                </span>
                {!query.trim() || r.item.kind !== 'action' ? null : <span className="sh-palette__group">{r.item.group}</span>}
                {r.item.binding && <Keys binding={r.item.binding} className="sh-palette__keys" />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="sh-palette__foot">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> to navigate
        </span>
        <span>
          <kbd>↵</kbd> to run
        </span>
        <span className="sh-palette__count">{results.length} results</span>
      </div>
    </Modal>
  );
}

function Highlight({ text, positions }: { text: string; positions: number[] }) {
  if (!positions.length) return <span className="sh-palette__text">{text}</span>;
  const set = new Set(positions);
  const out: ReactNode[] = [];
  let buf = '';
  let on = false;
  const flush = (k: number) => {
    if (!buf) return;
    out.push(on ? <mark key={k}>{buf}</mark> : <span key={k}>{buf}</span>);
    buf = '';
  };
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit !== on) {
      flush(i);
      on = hit;
    }
    buf += text[i];
  }
  flush(text.length);
  return <span className="sh-palette__text">{out}</span>;
}
