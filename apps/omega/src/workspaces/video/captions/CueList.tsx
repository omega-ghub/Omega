// Virtualized cue list: fixed-height rows, only the visible window renders,
// so tracks with thousands of cues stay fast while the playhead moves.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import type { CaptionCue, Sequence, Track } from '../../../state/types';
import { useEditor } from '../../../state/store';
import { formatTimecode, fromFrames, parseTimecode, snapToFrame } from '../../../engine/time';
import { transport } from '../../../engine/playback/transport';
import { cueIndexAt, cueStats, DEFAULT_RULES, type CueIssue } from '../../../engine/captions';
import { mutateTrack, seekToCue } from './commands';
import { useCaptionsUi } from './uiState';
import { CI } from './icons';

export const ROW_H = 80;
const OVERSCAN = 6;

interface TcFormat {
  fps: number;
  df: boolean;
  start: number;
}

interface Props {
  track: Track;
  seq: Sequence;
  /** Cues in time order. */
  cues: CaptionCue[];
  /** When searching: the ids to show. */
  filter: Set<string> | null;
  issues: Map<string, CueIssue[]>;
}

export function CueList({ track, seq, cues, filter, issues }: Props) {
  const visible = useMemo(() => (filter ? cues.filter((c) => filter.has(c.id)) : cues), [cues, filter]);
  const indexOf = useMemo(() => new Map(cues.map((c, i) => [c.id, i])), [cues]);
  const activeIdx = useEditor((s) => cueIndexAt(cues, s.playhead));
  const activeId = activeIdx >= 0 ? cues[activeIdx].id : null;
  const selected = useEditor((s) => s.selection.cueIds);
  const playing = useEditor((s) => s.playing);
  const follow = useCaptionsUi((s) => s.follow);
  const focusCueId = useCaptionsUi((s) => s.focusCueId);
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const tc: TcFormat = useMemo(() => ({ fps: seq.fps, df: seq.dropFrame, start: seq.startTimecode }), [seq.fps, seq.dropFrame, seq.startTimecode]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setHeight(el.clientHeight || 600);
    const ro = new ResizeObserver(() => setHeight(el.clientHeight || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scrollToRow = (i: number, mode: 'nearest' | 'center') => {
    const el = ref.current;
    if (!el || i < 0) return;
    const top = i * ROW_H;
    if (mode === 'center') {
      if (top < el.scrollTop || top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, top - el.clientHeight / 3);
    } else if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
    setScrollTop(el.scrollTop);
  };

  // Follow the playhead (never while the user is typing in the list).
  useEffect(() => {
    if (!follow || !activeId) return;
    const el = ref.current;
    if (el && el.contains(document.activeElement) && document.activeElement !== el) return;
    scrollToRow(
      visible.findIndex((c) => c.id === activeId),
      'center',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, follow]);

  // Focus requests (new cue, keyboard navigation between rows).
  useEffect(() => {
    if (!focusCueId) return;
    const i = visible.findIndex((c) => c.id === focusCueId);
    if (i < 0) return;
    scrollToRow(i, 'nearest');
    const id = focusCueId;
    let tries = 0;
    let raf = 0;
    // The row renders after the scroll state update; retry for a few frames.
    const attempt = () => {
      const ta = ref.current?.querySelector<HTMLTextAreaElement>(`textarea[data-cue="${id}"]`);
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
      if (ta || ++tries > 8) useCaptionsUi.getState().set({ focusCueId: null });
      else raf = requestAnimationFrame(attempt);
    };
    raf = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCueId, visible]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(visible.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN);

  const onSelect = (cue: CaptionCue, e: ReactMouseEvent) => {
    const st = useEditor.getState();
    const cur = st.selection.cueIds;
    if (e.shiftKey && cur.length) {
      // range select in list order
      const anchor = visible.findIndex((c) => c.id === cur[cur.length - 1]);
      const here = visible.findIndex((c) => c.id === cue.id);
      if (anchor >= 0 && here >= 0) {
        const [a, b] = anchor < here ? [anchor, here] : [here, anchor];
        st.select({ cueIds: visible.slice(a, b + 1).map((c) => c.id) });
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      st.select({ cueIds: cur.includes(cue.id) ? cur.filter((x) => x !== cue.id) : [...cur, cue.id] });
      return;
    }
    if (!(cur.length === 1 && cur[0] === cue.id)) st.select({ cueIds: [cue.id] });
  };

  const moveFocus = (cue: CaptionCue, dir: 1 | -1) => {
    const i = visible.findIndex((c) => c.id === cue.id);
    const next = visible[i + dir];
    if (!next) return;
    useEditor.getState().select({ cueIds: [next.id] });
    if (!useEditor.getState().playing) seekToCue(next);
    useCaptionsUi.getState().set({ focusCueId: next.id });
  };

  return (
    <div className="cap-list" ref={ref} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} data-testid="cap-list" role="list" aria-label="Captions">
      <div className="cap-list__inner" style={{ height: visible.length * ROW_H }}>
        {visible.slice(first, last).map((cue, k) => (
          <CueRow
            key={cue.id}
            cue={cue}
            index={indexOf.get(cue.id) ?? 0}
            top={(first + k) * ROW_H}
            active={cue.id === activeId}
            selected={selectedSet.has(cue.id)}
            issues={issues.get(cue.id)}
            trackId={track.id}
            locked={track.locked}
            tc={tc}
            playing={playing}
            onSelect={onSelect}
            onMove={moveFocus}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface RowProps {
  cue: CaptionCue;
  index: number;
  top: number;
  active: boolean;
  selected: boolean;
  issues: CueIssue[] | undefined;
  trackId: string;
  locked: boolean;
  tc: TcFormat;
  playing: boolean;
  onSelect(cue: CaptionCue, e: ReactMouseEvent): void;
  onMove(cue: CaptionCue, dir: 1 | -1): void;
}

const TIMING_KINDS = new Set(['short', 'long', 'overlap']);

/** Plain typing stays in the field; Mod shortcuts (save, undo, palette) still reach the app. */
function keepTyping(e: { ctrlKey: boolean; metaKey: boolean; stopPropagation(): void }) {
  if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
}

const CueRow = memo(function CueRow({ cue, index, top, active, selected, issues, trackId, locked, tc, playing, onSelect, onMove }: RowProps) {
  const stats = cueStats(cue);
  const timingWarn = !!issues?.some((i) => TIMING_KINDS.has(i.kind));
  const cpsWarn = stats.chars > 0 && stats.cps > DEFAULT_RULES.maxCps;

  const editText = (text: string) =>
    mutateTrack(
      'Edit caption text',
      trackId,
      (t) => {
        const c = t.cues.find((x) => x.id === cue.id);
        if (c) c.text = text;
      },
      `cap-text-${cue.id}`,
    );
  const editSpeaker = (speaker: string) =>
    mutateTrack(
      'Edit caption speaker',
      trackId,
      (t) => {
        const c = t.cues.find((x) => x.id === cue.id);
        if (!c) return;
        if (speaker.trim()) c.speaker = speaker;
        else delete c.speaker;
      },
      `cap-speaker-${cue.id}`,
    );
  const setEdge = (edge: 'start' | 'end', value: number) => {
    const frame = fromFrames(1, tc.fps);
    const v = Math.max(0, snapToFrame(value, tc.fps));
    if (edge === 'start' && v > cue.end - frame + 1e-9) return useEditor.getState().showToast('In point must be before the out point', 'error');
    if (edge === 'end' && v < cue.start + frame - 1e-9) return useEditor.getState().showToast('Out point must be after the in point', 'error');
    mutateTrack(edge === 'start' ? 'Change caption in' : 'Change caption out', trackId, (t) => {
      const c = t.cues.find((x) => x.id === cue.id);
      if (c) c[edge] = v;
    });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      onMove(cue, e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Escape') {
      (e.target as HTMLTextAreaElement).blur();
    }
    keepTyping(e);
  };

  const cls = `cap-row${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}`;
  return (
    <div className={cls} style={{ top, height: ROW_H }} role="listitem" data-testid="cap-cue" data-cue-id={cue.id} data-active={active || undefined} onMouseDown={(e) => onSelect(cue, e)}>
      <div className="cap-row__meta">
        <span className="cap-idx">{index + 1}</span>
        <TimecodeCell value={cue.start} tc={tc} warn={timingWarn} label="In" testid="cap-cue-in" disabled={locked} onSeek={() => seekToCue(cue)} onCommit={(v) => setEdge('start', v)} />
        <span className="cap-arrow">→</span>
        <TimecodeCell value={cue.end} tc={tc} warn={timingWarn} label="Out" testid="cap-cue-out" disabled={locked} onSeek={() => transport.seek(cue.end)} onCommit={(v) => setEdge('end', v)} />
        <span className="cap-stat" title="Duration">
          {stats.duration.toFixed(2)}s
        </span>
        <span className={`cap-stat${cpsWarn ? ' is-warn' : ''}`} title="Reading speed (characters per second)">
          {Number.isFinite(stats.cps) ? Math.round(stats.cps) : '–'} cps
        </span>
        {issues && issues.length > 0 && (
          <span className="cap-warn" title={issues.map((i) => i.message).join('\n')} data-testid="cap-cue-warning" aria-label={issues.map((i) => i.message).join('. ')}>
            <CI.Warn size={13} />
          </span>
        )}
        <input
          className="cap-speaker"
          value={cue.speaker ?? ''}
          placeholder="Speaker"
          spellCheck={false}
          disabled={locked}
          onChange={(e) => editSpeaker(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
            keepTyping(e);
          }}
          aria-label="Speaker"
          data-testid="cap-cue-speaker"
        />
      </div>
      <textarea
        className="cap-text"
        value={cue.text}
        data-cue={cue.id}
        rows={2}
        spellCheck
        disabled={locked}
        placeholder="Type the caption…"
        onChange={(e) => editText(e.target.value)}
        onFocus={() => {
          const st = useEditor.getState();
          if (!(st.selection.cueIds.length === 1 && st.selection.cueIds[0] === cue.id)) st.select({ cueIds: [cue.id] });
          if (!playing && (st.playhead < cue.start - 1e-6 || st.playhead >= cue.end - 1e-6)) seekToCue(cue);
        }}
        onKeyDown={onKeyDown}
        aria-label={`Caption ${index + 1} text`}
        data-testid="cap-cue-text"
      />
    </div>
  );
});

// ---------------------------------------------------------------------------

function TimecodeCell({ value, tc, warn, label, testid, disabled, onSeek, onCommit }: { value: number; tc: TcFormat; warn: boolean; label: string; testid: string; disabled: boolean; onSeek(): void; onCommit(v: number): void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const text = formatTimecode(value, tc.fps, tc.df, tc.start);
  if (editing) {
    const commit = () => {
      setEditing(false);
      const v = parseTimecode(draft, tc.fps, value, tc.start, tc.df);
      if (v === null) {
        if (draft.trim() && draft.trim() !== text) useEditor.getState().showToast(`“${draft}” is not a timecode`, 'error');
        return;
      }
      if (Math.abs(v - value) > 1e-9) onCommit(v);
    };
    return (
      <input
        className="cap-tc-input"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          keepTyping(e);
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(text);
            setEditing(false);
          }
        }}
        onFocus={(e) => e.target.select()}
        aria-label={`${label} timecode`}
        data-testid={`${testid}-input`}
      />
    );
  }
  return (
    <button
      type="button"
      className={`cap-tc${warn ? ' is-warn' : ''}`}
      title={`${label}: click to go there${disabled ? '' : ', double-click to edit'}`}
      onClick={onSeek}
      onDoubleClick={() => {
        if (disabled) return;
        setDraft(text);
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !disabled) {
          e.preventDefault();
          e.stopPropagation();
          setDraft(text);
          setEditing(true);
        }
      }}
      data-testid={testid}
    >
      {text}
    </button>
  );
}
