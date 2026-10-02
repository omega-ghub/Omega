// Title-bar content (save state, workspace switcher, right-side actions) and
// the status bar. OWNED BY THE SHELL PACKAGE.

import { useEffect, useState } from 'react';
import { formatTimecode } from '../../../engine/time';
import { useEditor } from '../../../state/store';
import { activeSequence } from '../../../state/types';
import { I } from '../../../ui/Icons';
import { Keys } from '../../../ui/controls';
import { keysFor, runAction } from '../actions';
import { WORKSPACES } from './actions';
import { useDeliverStatus, type QueueStatus } from './packages';

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function savedLabel(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 45) return 'Saved just now';
  return `Saved ${new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export function SaveState() {
  const saving = useEditor((s) => s.saving);
  const dirty = useEditor((s) => s.dirty);
  const readOnly = useEditor((s) => s.readOnly);
  const lastSavedAt = useEditor((s) => s.lastSavedAt);
  const path = useEditor((s) => s.handle?.filePath);
  useTick(20_000);

  let state: 'readonly' | 'saving' | 'dirty' | 'saved';
  let text: string;
  if (readOnly) [state, text] = ['readonly', 'Read-only'];
  else if (saving) [state, text] = ['saving', 'Saving…'];
  else if (dirty) [state, text] = ['dirty', 'Unsaved changes'];
  else [state, text] = ['saved', lastSavedAt ? savedLabel(lastSavedAt) : 'Saved'];

  return (
    <span className={`sh-save sh-save--${state}`} data-testid="sh-save-state" data-state={state} data-tip={path ? `${path} · saves automatically` : undefined} data-tip-side="bottom">
      {state === 'saving' ? <span className="sh-save__spin" /> : state === 'readonly' ? <I.Lock size={12} /> : <span className="sh-save__dot" />}
      {text}
    </span>
  );
}

export function WorkspaceSwitcher() {
  const ws = useEditor((s) => s.workspace);
  return (
    <div className="seg sh-ws" role="tablist" aria-label="Workspaces" data-testid="sh-workspaces">
      {WORKSPACES.map((w) => (
        <button
          key={w.id}
          role="tab"
          aria-selected={ws === w.id}
          className={ws === w.id ? 'is-active' : ''}
          data-testid={`sh-ws-${w.id}`}
          data-tip={`${w.label} workspace`}
          data-tip-action={`workspace.${w.id}`}
          onClick={() => runAction(`workspace.${w.id}`)}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
}

export function TitleActions() {
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const readOnly = useEditor((s) => s.readOnly);
  const undoLabel = past.length ? `Undo ${past[past.length - 1].label}` : 'Nothing to undo';
  const redoLabel = future.length ? `Redo ${future[0].label}` : 'Nothing to redo';
  const paletteKey = keysFor('shell.palette')[0];
  return (
    <div className="sh-actions">
      <button className="icon-btn icon-btn--sm" disabled={!past.length || readOnly} onClick={() => runAction('edit.undo')} data-tip={undoLabel} data-tip-keys={keysFor('edit.undo')[0]} aria-label={undoLabel} data-testid="sh-undo">
        <I.Undo size={16} />
      </button>
      <button className="icon-btn icon-btn--sm" disabled={!future.length || readOnly} onClick={() => runAction('edit.redo')} data-tip={redoLabel} data-tip-keys={keysFor('edit.redo')[0]} aria-label={redoLabel} data-testid="sh-redo">
        <I.Redo size={16} />
      </button>
      <span className="sh-actions__sep" />
      <button className="sh-search" onClick={() => runAction('shell.palette')} data-tip="Command palette" data-tip-action="shell.palette" data-testid="sh-palette-btn">
        <I.Search size={14} />
        <span>Search</span>
        {paletteKey && <Keys binding={paletteKey} />}
      </button>
      <button className="icon-btn icon-btn--sm" onClick={() => runAction('shell.shortcuts')} data-tip="Keyboard shortcuts" data-tip-action="shell.shortcuts" aria-label="Keyboard shortcuts" data-testid="sh-shortcuts-btn">
        <I.Keyboard size={16} />
      </button>
      <button className="icon-btn icon-btn--sm" onClick={() => runAction('shell.preferences')} data-tip="Preferences" data-tip-action="shell.preferences" aria-label="Preferences" data-testid="sh-settings-btn">
        <I.Settings size={16} />
      </button>
    </div>
  );
}

const COLOR_SPACE: Record<string, string> = { rec709: 'Rec. 709', srgb: 'sRGB', p3: 'Display P3', 'rec2020-hlg': 'Rec. 2020 HLG', 'rec2020-pq': 'Rec. 2020 PQ' };

function fpsLabel(fps: number) {
  return Number.isInteger(fps) ? String(fps) : fps.toFixed(3).replace(/0+$/, '');
}

const useNoStatus = (): QueueStatus | null => null;
const useQueue = useDeliverStatus ?? useNoStatus;

export function StatusBar() {
  const seq = useEditor((s) => (s.project ? activeSequence(s.project) : null));
  const playhead = useEditor((s) => s.playhead);
  const assets = useEditor((s) => s.project?.assets.length ?? 0);
  const offline = useEditor((s) => s.project?.assets.filter((a) => a.offline).length ?? 0);
  const queue = useQueue();
  if (!seq) return null;
  const clips = seq.tracks.reduce((n, t) => n + t.clips.length, 0);
  return (
    <footer className="sh-status" data-testid="sh-statusbar">
      <span className="sh-status__item sh-status__seq" data-tip="Active sequence">
        <I.Sequence size={12} />
        {seq.name}
      </span>
      <span className="sh-status__item mono" data-testid="sh-status-format">
        {seq.width}×{seq.height}
      </span>
      <span className="sh-status__item mono">
        {fpsLabel(seq.fps)} fps{seq.dropFrame ? ' DF' : ''}
      </span>
      <span className="sh-status__item">{COLOR_SPACE[seq.colorSpace] ?? seq.colorSpace}</span>
      <span className="sh-status__item">
        {clips} {clips === 1 ? 'clip' : 'clips'} · {assets} media
      </span>
      {offline > 0 && (
        <span className="sh-status__item sh-status__warn" data-tip="Media files that can't be found on disk">
          <I.Warning size={12} />
          {offline} offline
        </span>
      )}
      <span className="sh-status__spacer" />
      {queue && queue.progress !== null && (
        <span className="sh-status__item sh-status__queue" data-testid="sh-status-queue" data-tip={queue.label ?? 'Rendering'}>
          <I.Render size={12} />
          <span className="sh-status__bar">
            <span style={{ width: `${Math.round(queue.progress * 100)}%` }} />
          </span>
          <span className="mono">{Math.round(queue.progress * 100)}%</span>
          {queue.pending && queue.pending > 1 ? <span className="muted">+{queue.pending - 1}</span> : null}
        </span>
      )}
      <span className="sh-status__item sh-status__tc mono" data-testid="sh-status-tc">
        {formatTimecode(playhead, seq.fps, seq.dropFrame, seq.startTimecode)}
      </span>
    </footer>
  );
}
