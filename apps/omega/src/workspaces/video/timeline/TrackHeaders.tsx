// Track headers (DOM, sticky left of the canvas): name, target, visibility /
// mute / solo, lock, audio volume and pan, height resize, context menu.
import { memo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useEditor } from '../../../state/store';
import type { Track } from '../../../state/types';
import { activeSequence } from '../../../state/types';
import { labelHex } from './colors';
import * as cmd from './commands';
import { layoutTracks, MAX_TRACK_H, MIN_TRACK_H, type TrackRow } from './geometry';
import { TI } from './icons';
import { trackHeaderMenu } from './menus';
import { useTLView } from './view';

function codeOf(row: TrackRow, countOfKind: number): string {
  const letter = row.track.kind === 'video' ? 'V' : row.track.kind === 'audio' ? 'A' : 'C';
  // video tracks count from the bottom (V1 is the base layer), audio/caption from the top
  const n = row.track.kind === 'video' ? countOfKind - row.kindIndex : row.kindIndex + 1;
  return `${letter}${n}`;
}

function MiniFader({
  value,
  min,
  max,
  center = 0,
  onChange,
  onReset,
  format,
  testId,
  label,
}: {
  value: number;
  min: number;
  max: number;
  center?: number;
  onChange: (v: number) => void;
  onReset: () => void;
  format: (v: number) => string;
  testId: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const pos = (v: number) => (Math.max(min, Math.min(max, v)) - min) / (max - min);
  const p = pos(value);
  const c = pos(center);
  const set = (e: RPointerEvent | PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    onChange(min + f * (max - min));
  };
  return (
    <div
      ref={ref}
      className={`tl-fader ${drag ? 'is-drag' : ''}`}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value * 10) / 10}
      aria-valuetext={format(value)}
      tabIndex={0}
      title={`${label}: ${format(value)} (double-click to reset)`}
      data-testid={testId}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(true);
        set(e);
      }}
      onPointerMove={(e) => drag && set(e)}
      onPointerUp={() => setDrag(false)}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = (max - min) / 100;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          onChange(Math.max(min, value - step));
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          onChange(Math.min(max, value + step));
        }
      }}
    >
      <div className="tl-fader__track" />
      <div className="tl-fader__fill" style={{ left: `${Math.min(p, c) * 100}%`, width: `${Math.abs(p - c) * 100}%` }} />
      <div className="tl-fader__thumb" style={{ left: `${p * 100}%` }} />
      {drag && <div className="tl-fader__value">{format(value)}</div>}
    </div>
  );
}

const Header = memo(function Header({ row, code, top }: { row: TrackRow; code: string; top: number }) {
  const t = row.track;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(t.name);
  const selectedTrack = useEditor((s) => s.selection.trackId === t.id);
  const h = row.h;
  const patch = (label: string, fn: (x: Track) => void, key?: string) => cmd.patchTrack(t.id, label, fn, key);
  const startResize = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const y0 = e.clientY;
    const h0 = t.height;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const nh = Math.round(Math.max(MIN_TRACK_H, Math.min(MAX_TRACK_H, h0 + ev.clientY - y0)));
      patch('Track height', (x) => void (x.height = nh), `tl-height-${t.id}`);
      useTLView.getState().setHeightPreset(null);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const isAudio = t.kind === 'audio';
  const compact = h < 30;
  return (
    <div
      className={`tl-th tl-th--${t.kind} ${t.locked ? 'is-locked' : ''} ${selectedTrack ? 'is-selected' : ''} ${compact ? 'is-compact' : ''}`}
      style={{ top, height: h }}
      data-testid={`tl-track-header-${t.name}`}
      data-track-id={t.id}
      onMouseDown={(e) => e.button === 0 && useEditor.getState().select({ trackId: t.id })}
      onContextMenu={(e) => {
        e.preventDefault();
        useTLView.getState().openMenu({ x: e.clientX, y: e.clientY, items: trackHeaderMenu(t), testId: 'tl-track-menu' });
      }}
    >
      <div className="tl-th__color" style={{ background: t.color ? labelHex(t.color) : 'transparent' }} />
      <div className="tl-th__main">
        <button
          className={`tl-th__target ${t.targeted ? 'is-on' : ''}`}
          title={t.targeted ? 'Targeted for insert, overwrite and paste (click to untarget)' : 'Not targeted (click to target)'}
          aria-pressed={t.targeted}
          data-testid={`tl-target-${t.name}`}
          onClick={() => patch(t.targeted ? 'Untarget track' : 'Target track', (x) => void (x.targeted = !x.targeted))}
        >
          {code}
        </button>
        {renaming ? (
          <input
            className="tl-th__input"
            autoFocus
            value={name}
            data-testid={`tl-track-name-input-${t.name}`}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => {
              setRenaming(false);
              if (name.trim() && name.trim() !== t.name) patch('Rename track', (x) => void (x.name = name.trim()));
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setName(t.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <span
            className="tl-th__name"
            title="Double-click to rename"
            onDoubleClick={() => {
              setName(t.name);
              setRenaming(true);
            }}
          >
            {t.name}
          </span>
        )}
        <span className="tl-th__btns">
          {isAudio ? (
            <>
              <button className={`tl-th__btn tl-th__btn--m ${t.muted ? 'is-on' : ''}`} title={t.muted ? 'Unmute track' : 'Mute track'} aria-pressed={t.muted} data-testid={`tl-mute-${t.name}`} onClick={() => patch(t.muted ? 'Unmute track' : 'Mute track', (x) => void (x.muted = !x.muted))}>
                M
              </button>
              <button className={`tl-th__btn tl-th__btn--s ${t.solo ? 'is-on' : ''}`} title={t.solo ? 'Unsolo track' : 'Solo track'} aria-pressed={t.solo} data-testid={`tl-solo-${t.name}`} onClick={() => patch(t.solo ? 'Unsolo track' : 'Solo track', (x) => void (x.solo = !x.solo))}>
                S
              </button>
            </>
          ) : (
            <button
              className={`tl-th__btn ${t.muted ? 'is-on' : ''}`}
              title={t.muted ? 'Show track' : 'Hide track'}
              aria-pressed={t.muted}
              data-testid={`tl-eye-${t.name}`}
              onClick={() => patch(t.muted ? 'Show track' : 'Hide track', (x) => void (x.muted = !x.muted))}
            >
              {t.muted ? <TI.EyeOff size={14} /> : <TI.Eye size={14} />}
            </button>
          )}
          <button className={`tl-th__btn ${t.locked ? 'is-on' : ''}`} title={t.locked ? 'Unlock track' : 'Lock track'} aria-pressed={t.locked} data-testid={`tl-lock-${t.name}`} onClick={() => patch(t.locked ? 'Unlock track' : 'Lock track', (x) => void (x.locked = !x.locked))}>
            {t.locked ? <TI.Lock size={14} /> : <TI.Unlock size={14} />}
          </button>
        </span>
      </div>
      {isAudio && h >= 44 && (
        <div className="tl-th__mix">
          <MiniFader
            label={`${t.name} volume`}
            value={t.volume}
            min={-60}
            max={12}
            center={-60}
            testId={`tl-volume-${t.name}`}
            format={(v) => (v <= -59.9 ? '−∞ dB' : `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`)}
            onChange={(v) => patch('Track volume', (x) => void (x.volume = Math.round(v * 10) / 10), `tl-vol-${t.id}`)}
            onReset={() => patch('Track volume', (x) => void (x.volume = 0))}
          />
          <MiniFader
            label={`${t.name} pan`}
            value={t.pan}
            min={-1}
            max={1}
            center={0}
            testId={`tl-pan-${t.name}`}
            format={(v) => (Math.abs(v) < 0.005 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)}
            onChange={(v) => patch('Track pan', (x) => void (x.pan = Math.abs(v) < 0.03 ? 0 : Math.round(v * 100) / 100), `tl-pan-${t.id}`)}
            onReset={() => patch('Track pan', (x) => void (x.pan = 0))}
          />
        </div>
      )}
      <div className="tl-th__resize" onPointerDown={startResize} title="Drag to resize" data-testid={`tl-track-resize-${t.name}`} />
    </div>
  );
});

export function TrackHeaders() {
  const tracks = useEditor((s) => activeSequence(s.project!).tracks);
  const scrollY = useTLView((s) => s.scrollY);
  const layout = layoutTracks(tracks);
  const counts = { video: 0, audio: 0, caption: 0 };
  for (const t of tracks) counts[t.kind]++;
  return (
    <div
      className="tl-headers"
      onWheel={(e) => {
        const v = useTLView.getState();
        const maxY = Math.max(0, layout.height - v.viewH + 40);
        v.setScrollY(Math.min(maxY, v.scrollY + e.deltaY));
      }}
    >
      {layout.dividerY !== null && <div className="tl-headers__divider" style={{ top: layout.dividerY - scrollY }} />}
      {layout.rows.map((row) => (
        <Header key={row.track.id} row={row} code={codeOf(row, counts[row.track.kind])} top={row.y - scrollY} />
      ))}
    </div>
  );
}

export function AddTrackButtons() {
  return (
    <div className="tl-addtracks">
      <button className="tl-addtrack" title="Add video track" data-testid="tl-add-video" onClick={() => cmd.addTrack('video', 0)}>
        <TI.Plus size={11} /> Video
      </button>
      <button className="tl-addtrack" title="Add audio track" data-testid="tl-add-audio" onClick={() => cmd.addTrack('audio')}>
        <TI.Plus size={11} /> Audio
      </button>
      <button className="tl-addtrack" title="Add caption track" data-testid="tl-add-caption" onClick={() => cmd.addTrack('caption')}>
        <TI.Plus size={11} /> Caption
      </button>
    </div>
  );
}
