// Mixer controls: a console-style fader (−∞ … +12 dB on a quartic taper) and
// a pan knob. Both report onChange(value, {final}) like the shared kit, so
// one drag is one undo step.

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clamp, dbFromFaderPos, faderPosFromDb, FADER_MAX_DB, FADER_MIN_DB, formatDb } from '../../../engine/audio/dsp';

export interface ChangeMeta {
  final: boolean;
}

const FADER_MARKS = [12, 6, 0, -6, -12, -20, -30, -40, -60];

export function Fader(props: {
  value: number;
  onChange: (db: number, meta: ChangeMeta) => void;
  label: string;
  disabled?: boolean;
  'data-testid'?: string;
}) {
  const { value, onChange, label, disabled } = props;
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; pos: number; pointer: number } | null>(null);
  const [active, setActive] = useState(false);
  const pos = faderPosFromDb(value);

  const posFromEvent = (e: PointerEvent) => {
    const r = trackRef.current!.getBoundingClientRect();
    return clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
  };
  const emit = (p: number, final: boolean) => {
    let db = dbFromFaderPos(p);
    if (db > FADER_MIN_DB) db = Math.round(db * 10) / 10;
    // detent at 0 dB
    if (Math.abs(db) < 0.25) db = 0;
    onChange(clamp(db, FADER_MIN_DB, FADER_MAX_DB), { final });
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const onCap = (e.target as HTMLElement).closest('.au-fader__cap');
    // Click on the track jumps the cap there; grabbing the cap keeps relative motion.
    const start = onCap ? pos : posFromEvent(e);
    drag.current = { y: e.clientY, pos: start, pointer: e.pointerId };
    setActive(true);
    if (!onCap) emit(start, false);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const h = trackRef.current!.getBoundingClientRect().height || 1;
    // incremental, so toggling Shift (fine) mid-drag never jumps
    d.pos = clamp(d.pos - ((e.clientY - d.y) / h) * (e.shiftKey ? 0.1 : 1), 0, 1);
    d.y = e.clientY;
    emit(d.pos, false);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointer !== e.pointerId) return;
    drag.current = null;
    setActive(false);
    onChange(value, { final: true });
  };
  const nudge = (deltaDb: number) => {
    const base = value <= FADER_MIN_DB ? -60 : value;
    onChange(clamp(Math.round((base + deltaDb) * 10) / 10, FADER_MIN_DB, FADER_MAX_DB), { final: true });
  };
  const onKey = (e: KeyboardEvent) => {
    if (disabled) return;
    const step = e.shiftKey ? 0.1 : e.altKey ? 3 : 0.5;
    if (e.key === 'ArrowUp') nudge(step);
    else if (e.key === 'ArrowDown') nudge(-step);
    else if (e.key === 'Home') onChange(FADER_MAX_DB, { final: true });
    else if (e.key === 'End') onChange(FADER_MIN_DB, { final: true });
    else if (e.key === '0' || e.key === 'Delete' || e.key === 'Backspace') onChange(0, { final: true });
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className={`au-fader ${active ? 'au-fader--active' : ''} ${disabled ? 'au-fader--disabled' : ''}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={FADER_MIN_DB}
      aria-valuemax={FADER_MAX_DB}
      aria-valuenow={Math.round(value * 10) / 10}
      aria-valuetext={`${formatDb(value)} dB`}
      title={`${label}: ${formatDb(value)} dB. Drag (Shift for fine), double-click for 0 dB, wheel or arrow keys to nudge.`}
      data-testid={props['data-testid']}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={() => !disabled && onChange(0, { final: true })}
      onWheel={(e) => {
        if (disabled) return;
        nudge(e.deltaY < 0 ? 0.5 : -0.5);
      }}
      onKeyDown={onKey}
    >
      <div className="au-fader__scale" aria-hidden="true">
        {FADER_MARKS.map((m) => (
          <span key={m} className={`au-fader__mark ${m === 0 ? 'au-fader__mark--unity' : ''}`} style={{ bottom: `${faderPosFromDb(m) * 100}%` }}>
            {m > 0 ? `+${m}` : m}
          </span>
        ))}
        <span className="au-fader__mark" style={{ bottom: 0 }}>
          −∞
        </span>
      </div>
      <div className="au-fader__track" ref={trackRef}>
        <div className="au-fader__slot" />
        <div className="au-fader__unity" style={{ bottom: `${faderPosFromDb(0) * 100}%` }} />
        <div className="au-fader__cap" style={{ bottom: `${pos * 100}%` }} />
      </div>
    </div>
  );
}

export function formatPan(p: number): string {
  const v = Math.round(p * 100);
  if (v === 0) return 'C';
  return v < 0 ? `L${-v}` : `R${v}`;
}

/** Rotary pan control (−1 … +1). Drag vertically; double-click centers. */
export function PanKnob(props: { value: number; onChange: (v: number, meta: ChangeMeta) => void; label: string; disabled?: boolean; size?: number; 'data-testid'?: string }) {
  const { value, onChange, label, disabled, size = 26 } = props;
  const drag = useRef<{ y: number; v: number } | null>(null);
  const angle = clamp(value, -1, 1) * 135;
  const r = size / 2 - 2;
  const c = size / 2;
  const arc = (a0: number, a1: number) => {
    const rad = (a: number) => ((a - 90) * Math.PI) / 180;
    const x0 = c + r * Math.cos(rad(a0));
    const y0 = c + r * Math.sin(rad(a0));
    const x1 = c + r * Math.cos(rad(a1));
    const y1 = c + r * Math.sin(rad(a1));
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    const sweep = a1 > a0 ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} ${sweep} ${x1} ${y1}`;
  };
  const set = (v: number, final: boolean) => {
    let n = clamp(Math.round(v * 100) / 100, -1, 1);
    if (Math.abs(n) < 0.02) n = 0;
    onChange(n, { final });
  };
  return (
    <div
      className={`au-knob ${disabled ? 'au-knob--disabled' : ''}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={value}
      aria-valuetext={formatPan(value)}
      title={`${label}: ${formatPan(value)}. Drag up/down, double-click to center.`}
      data-testid={props['data-testid']}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, v: value };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        set(d.v + ((d.y - e.clientY) / 120) * (e.shiftKey ? 0.2 : 1), false);
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = null;
        onChange(value, { final: true });
      }}
      onDoubleClick={() => !disabled && set(0, true)}
      onWheel={(e) => !disabled && set(value + (e.deltaY < 0 ? 0.05 : -0.05), true)}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(value + 0.05, true);
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(value - 0.05, true);
        else if (e.key === '0' || e.key === 'Delete') set(0, true);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <path d={arc(-135, 135)} className="au-knob__ring" />
        {Math.abs(angle) > 0.5 && <path d={angle > 0 ? arc(0, angle) : arc(angle, 0)} className="au-knob__value" />}
        <line
          x1={c}
          y1={c}
          x2={c + (r - 3) * Math.cos(((angle - 90) * Math.PI) / 180)}
          y2={c + (r - 3) * Math.sin(((angle - 90) * Math.PI) / 180)}
          className="au-knob__pointer"
        />
      </svg>
    </div>
  );
}
