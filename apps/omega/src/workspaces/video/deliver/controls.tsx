// Small form controls for the Deliver panel (native elements, dl- styles).
// OWNED BY THE DELIVER PACKAGE.

import { useEffect, useState, type ReactNode } from 'react';
import { formatTimecode, parseTimecode } from '../../../engine/time';

export function Row({ label, hint, children, wide, testId }: { label: ReactNode; hint?: ReactNode; children: ReactNode; wide?: boolean; testId?: string }) {
  return (
    <div className={`dl-row ${wide ? 'dl-row--wide' : ''}`} data-testid={testId}>
      <div className="dl-row__label">
        {label}
        {hint && <span className="dl-row__hint">{hint}</span>}
      </div>
      <div className="dl-row__control">{children}</div>
    </div>
  );
}

export function Section({ title, aside, children, testId }: { title: string; aside?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="dl-section" data-testid={testId}>
      <header className="dl-section__head">
        <h3 className="dl-section__title">{title}</h3>
        {aside && <div className="dl-section__aside">{aside}</div>}
      </header>
      <div className="dl-section__body">{children}</div>
    </section>
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
  group?: string;
  disabled?: boolean;
}

export function Select<T extends string>({ value, options, onChange, testId, disabled, ariaLabel }: { value: T; options: Option<T>[]; onChange: (v: T) => void; testId?: string; disabled?: boolean; ariaLabel?: string }) {
  const groups = [...new Set(options.map((o) => o.group ?? ''))];
  const render = (o: Option<T>) => (
    <option key={o.value} value={o.value} disabled={o.disabled}>
      {o.label}
    </option>
  );
  return (
    <select className="dl-select" value={value} disabled={disabled} aria-label={ariaLabel} data-testid={testId} onChange={(e) => onChange(e.target.value as T)}>
      {groups.length > 1
        ? groups.map((g) => (
            <optgroup key={g} label={g}>
              {options.filter((o) => (o.group ?? '') === g).map(render)}
            </optgroup>
          ))
        : options.map(render)}
    </select>
  );
}

/** Number input that commits on blur / Enter; empty text commits null when `allowEmpty`. */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  placeholder,
  allowEmpty,
  testId,
  width,
  ariaLabel,
  disabled,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  testId?: string;
  width?: number;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  const commit = () => {
    const t = text.trim();
    if (!t) {
      if (allowEmpty) onChange(null);
      else setText(value === null ? '' : String(value));
      return;
    }
    let n = Number(t.replace(',', '.'));
    if (!Number.isFinite(n)) {
      setText(value === null ? '' : String(value));
      return;
    }
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setText(String(n));
    if (n !== value) onChange(n);
  };
  return (
    <span className="dl-num" style={width ? { width } : undefined}>
      <input
        className="dl-input dl-input--num"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = Number(text) || value || 0;
            let n = Math.round((base + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1)) * 1000) / 1000;
            if (min !== undefined) n = Math.max(min, n);
            if (max !== undefined) n = Math.min(max, n);
            setText(String(n));
            onChange(n);
          }
        }}
      />
      {unit && <span className="dl-num__unit">{unit}</span>}
    </span>
  );
}

/** SMPTE timecode entry (frame-accurate, drop-frame aware). */
export function TimecodeInput({ value, onChange, fps, dropFrame, startTimecode, testId, ariaLabel }: { value: number; onChange: (t: number) => void; fps: number; dropFrame: boolean; startTimecode: number; testId?: string; ariaLabel?: string }) {
  const shown = formatTimecode(value, fps, dropFrame, startTimecode);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const t = parseTimecode(text, fps, value, startTimecode, dropFrame);
    if (t === null) setText(shown);
    else onChange(Math.max(0, t));
  };
  return (
    <input
      className="dl-input dl-input--tc"
      value={text}
      spellCheck={false}
      aria-label={ariaLabel}
      data-testid={testId}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') setText(shown);
      }}
    />
  );
}

export function Pill({ tone = 'neutral', children, testId, title }: { tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'; children: ReactNode; testId?: string; title?: string }) {
  return (
    <span className={`dl-pill dl-pill--${tone}`} data-testid={testId} title={title}>
      {children}
    </span>
  );
}

export function Progress({ value, tone = 'accent', testId }: { value: number; tone?: 'accent' | 'ok' | 'danger' | 'muted'; testId?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={`dl-progress dl-progress--${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} data-testid={testId}>
      <div className="dl-progress__bar" style={{ width: `${pct}%` }} />
    </div>
  );
}
