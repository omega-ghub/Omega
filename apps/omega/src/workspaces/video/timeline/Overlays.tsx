// DOM overlays over the canvas: inline clip rename, inline caption editing,
// the transition popover and the hidden accessible clip list.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { listTransitions } from '../../../engine/effects/registry';
import { exactRate } from '../../../engine/time';
import { useEditor } from '../../../state/store';
import type { Ease, TransitionType } from '../../../state/types';
import { activeSequence, findClip } from '../../../state/types';
import * as cmd from './commands';
import { transitionName } from './draw';
import { VIDEO_TRANSITIONS } from './menus';
import { TimecodeInput } from './TimecodeInput';
import { useTLView } from './view';

export function InlineEditor() {
  const inline = useTLView((s) => s.inline);
  const seq = useEditor((s) => (s.project ? activeSequence(s.project) : null));
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const initial = (() => {
    if (!inline || !seq) return '';
    if (inline.kind === 'clipName') return findClip(seq, inline.clipId)?.clip.name ?? '';
    return seq.tracks.find((t) => t.id === inline.trackId)?.cues.find((q) => q.id === inline.cueId)?.text ?? '';
  })();
  useLayoutEffect(() => {
    setText(initial);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inline]);
  if (!inline || !seq) return null;
  const done = (save: boolean) => {
    const cur = useTLView.getState().inline;
    if (cur !== inline) return;
    useTLView.getState().setInline(null);
    if (!save || text === initial) return;
    if (inline.kind === 'clipName') cmd.renameClip(inline.clipId, text);
    else
      cmd.editSeq('Edit caption', (s) => {
        const q = s.tracks.find((t) => t.id === inline.trackId)?.cues.find((x) => x.id === inline.cueId);
        if (q) q.text = text;
      });
  };
  const common = {
    ref,
    value: text,
    spellCheck: inline.kind === 'cue',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    onBlur: () => done(true),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter' && !(inline.kind === 'cue' && e.shiftKey)) {
        e.preventDefault();
        done(true);
      }
    },
  };
  const style = { left: inline.x, top: inline.y, width: inline.w, minHeight: inline.h };
  return inline.kind === 'clipName' ? (
    <input className="tl-inline-edit" style={style} data-testid="tl-inline-rename" {...common} />
  ) : (
    <textarea className="tl-inline-edit tl-inline-edit--cue" style={style} rows={2} data-testid="tl-inline-cue" {...common} />
  );
}

const EASES: { value: Ease; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeIn', label: 'Ease in' },
  { value: 'easeOut', label: 'Ease out' },
  { value: 'easeInOut', label: 'Ease in and out' },
];

export function TransitionPopover() {
  const pop = useTLView((s) => s.transitionPop);
  const project = useEditor((s) => s.project);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    if (!pop || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(pop.x - r.width / 2, window.innerWidth - r.width - 8)), y: pop.y - r.height - 14 < 8 ? pop.y + 14 : pop.y - r.height - 14 });
  }, [pop]);
  useEffect(() => {
    if (!pop) return;
    const close = (e: Event) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      if ((e.target as Element)?.closest?.('.tl-menu')) return;
      useTLView.getState().setTransitionPop(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useTLView.getState().setTransitionPop(null);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [pop]);
  if (!pop || !project) return null;
  const seq = activeSequence(project);
  const f = findClip(seq, pop.clipId);
  const tr = f ? (pop.edge === 'in' ? f.clip.transitionIn : f.clip.transitionOut) : null;
  if (!f || !tr) return null;
  const isAudio = f.track.kind === 'audio';
  const registered = listTransitions().map((t) => t.type as TransitionType);
  const types = isAudio ? (['audioCrossfade'] as TransitionType[]) : [...new Set([...VIDEO_TRANSITIONS, ...registered.filter((t) => t !== 'audioCrossfade')])];
  const fr = 1 / exactRate(seq.fps);
  const set = (label: string, fn: (t: NonNullable<typeof tr>) => void, key?: string) =>
    cmd.editSeq(
      label,
      (s) => {
        const g = findClip(s, pop.clipId);
        const t = g && (pop.edge === 'in' ? g.clip.transitionIn : g.clip.transitionOut);
        if (t) fn(t);
      },
      key ? { coalesceKey: key } : undefined,
    );
  const def = listTransitions().find((d) => d.type === tr.type);
  return (
    <div ref={ref} className="tl-pop tl-pop--transition" style={{ left: pos.x, top: pos.y }} data-testid="tl-transition-pop" onKeyDown={(e) => e.stopPropagation()}>
      <div className="tl-pop__title">{transitionName(tr.type)}</div>
      <label className="tl-row tl-row--compact">
        <span className="tl-row__label">Type</span>
        <select
          className="tl-input"
          value={tr.type}
          disabled={f.track.locked}
          data-testid="tl-transition-type"
          onChange={(e) =>
            set('Transition type', (t) => {
              t.type = e.target.value as TransitionType;
              t.params = {};
            })
          }
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {listTransitions().find((d) => d.type === t)?.name ?? transitionName(t)}
            </option>
          ))}
        </select>
      </label>
      <label className="tl-row tl-row--compact">
        <span className="tl-row__label">Duration</span>
        <span className="tl-inline">
          <TimecodeInput value={tr.duration} fps={seq.fps} dropFrame={seq.dropFrame} testId="tl-transition-duration" onChange={(d) => set('Transition duration', (t) => void (t.duration = Math.max(2 * fr, d)))} />
          <span className="tl-muted tl-mono">{Math.round(tr.duration / fr)}f</span>
        </span>
      </label>
      <label className="tl-row tl-row--compact">
        <span className="tl-row__label">Easing</span>
        <select className="tl-input" value={tr.ease} disabled={f.track.locked} onChange={(e) => set('Transition easing', (t) => void (t.ease = e.target.value as Ease))}>
          {EASES.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
      </label>
      {def?.params
        .filter((p) => p.type === 'number' || p.type === 'angle')
        .slice(0, 4)
        .map((p) => {
          const v = Number(tr.params[p.key] ?? p.default);
          return (
            <label key={p.key} className="tl-row tl-row--compact">
              <span className="tl-row__label">{p.label}</span>
              <input
                className="tl-input tl-input--num"
                type="number"
                step={p.step ?? 0.01}
                min={p.min}
                max={p.max}
                value={v}
                onChange={(e) => set(`Transition ${p.label}`, (t) => void (t.params[p.key] = Number(e.target.value)), `tl-tr-${pop.clipId}-${p.key}`)}
              />
            </label>
          );
        })}
      <div className="tl-pop__foot">
        <button
          className="tl-btn tl-btn--danger"
          data-testid="tl-transition-remove"
          disabled={f.track.locked}
          onClick={() => {
            cmd.editSeq('Remove transition', (s) => {
              const g = findClip(s, pop.clipId);
              if (!g) return;
              if (pop.edge === 'in') g.clip.transitionIn = null;
              else g.clip.transitionOut = null;
            });
            useTLView.getState().setTransitionPop(null);
          }}
        >
          Remove
        </button>
        <button className="tl-btn tl-btn--primary" onClick={() => useTLView.getState().setTransitionPop(null)}>
          Done
        </button>
      </div>
    </div>
  );
}

/** Visually hidden list of the clips currently drawn (accessibility + tests). */
export function ClipList() {
  const visible = useTLView((s) => s.visible);
  return (
    <ul className="tl-sr" aria-label="Visible clips" data-testid="tl-clip-list">
      {visible.map((c) => (
        <li
          key={c.id}
          data-testid="tl-clip"
          data-clip-id={c.id}
          data-track-id={c.trackId}
          data-kind={c.kind}
          data-selected={c.selected ? 'true' : 'false'}
          data-x={c.x}
          data-y={c.y}
          data-w={c.w}
          data-h={c.h}
          data-start={c.start}
          data-end={c.end}
        >
          <button tabIndex={-1} aria-pressed={c.selected} onClick={() => useEditor.getState().selectClips([c.id])}>
            {c.name}
          </button>
        </li>
      ))}
    </ul>
  );
}
