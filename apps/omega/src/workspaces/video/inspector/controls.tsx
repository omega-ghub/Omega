// ============================================================================
// Delta shared control kit. OWNED BY THE INSPECTOR PACKAGE; the effects, color
// and audio packages import it. Every control is keyboard-accessible, uses the
// design tokens only, and reports edits as `onChange(value, { final })`:
// `final: false` while a drag is in progress, `final: true` when the gesture
// ends (pointer up, Enter, arrow key, reset). Pass a stable `coalesceKey` to
// `mutate` so one drag becomes one undo step (see `editParam` in ./model).
//
//   ScrubNumber   drag-to-scrub number (Shift ×10, Alt ×0.1), click to type
//                 (arithmetic allowed: "1/3", "*2", "+=10"), ↑/↓ keys, units,
//                 min/max, double-click (or Delete) resets to `defaultValue`.
//   Slider        thin track with a hairline thumb, optional log scale and
//                 bipolar fill from `origin`.
//   ColorField    swatch + native picker + hex input (#rgb/#rrggbb/#rrggbbaa),
//                 optional alpha.
//   Select        styled native <select>, options may be grouped.
//   Toggle        switch.
//   Segmented     radio group of short labels or icons.
//   Section       collapsible section; open state remembered per `id`.
//   KeyframeButton stopwatch + ◀ ◆ ▶ for {clipId, path} (reads store.playhead).
//   PointField    x / y pair of ScrubNumbers.
//   TimecodeField SMPTE timecode entry (typing, +/- relative, ↑/↓, drag).
//   ParamRow      label | control | keyframe button, the standard row.
//
// Store helpers re-exported for convenience: useClip, getClip, useParam,
// useLocalTime, editClip, editClips, editParam, editField, localTime.
// ============================================================================

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useEditor } from '../../../state/store';
import { activeSequence, findClip } from '../../../state/types';
import type { Clip } from '../../../state/types';
import { clearKeyframes, KEY_TOLERANCE, paramAt, removeKeyframeAt, setKeyframe } from '../../../engine/keyframes';
import { formatTimecode, fromFrames, parseTimecode, toFrames } from '../../../engine/time';
import { transport } from '../../../engine/playback/transport';
import { II } from './icons';
import { editClip, getClip, localTime } from './model';
import { paramLabel } from './paths';
import { clamp, decimalsOf, evalNumberInput, formatNumber, parseHexColor, roundTo, toHexColor } from './util';
import './controls.css';

export { useClip, getClip, useParam, useLocalTime, useClipTrack, editClip, editClips, editParam, editField, localTime } from './model';
export { paramInfo, paramLabel } from './paths';

/** Second argument of every control's onChange. */
export interface ChangeMeta {
  /** true when the gesture is complete (pointer up, Enter, key press, reset). */
  final: boolean;
}

export type ChangeHandler<T> = (value: T, meta: ChangeMeta) => void;

const FINAL: ChangeMeta = { final: true };
const LIVE: ChangeMeta = { final: false };

function modMul(e: { shiftKey: boolean; altKey: boolean }): number {
  return e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
}

function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

// ============================================================================
// ScrubNumber
// ============================================================================

export interface ScrubNumberProps {
  value: number;
  onChange: ChangeHandler<number>;
  min?: number;
  max?: number;
  /** Arrow-key increment, in value units (default 1). */
  step?: number;
  /** Value change per pixel dragged (default = step). */
  dragStep?: number;
  /** Decimals shown (default: derived from step × displayScale). */
  precision?: number;
  /** Suffix shown after the number, e.g. 'px', '%', '°'. */
  unit?: string;
  /** Shown = value × displayScale (e.g. 100 to show 0..1 as %). Typing uses display units. */
  displayScale?: number;
  /** Double-click / Delete resets to this. */
  defaultValue?: number;
  /** Batch editing: values differ; shows an em dash until edited. */
  mixed?: boolean;
  disabled?: boolean;
  /** Fixed width of the control (CSS length). Default: fits content, min 52px. */
  width?: number | string;
  /** Optional custom formatter for the display (value units in, text out). */
  format?: (value: number) => string;
  'aria-label'?: string;
  'data-testid'?: string;
  className?: string;
  title?: string;
}

export function ScrubNumber(props: ScrubNumberProps) {
  const { value, onChange, min = -Infinity, max = Infinity, step = 1, unit, displayScale = 1, defaultValue, mixed, disabled, width, format, className } = props;
  const dragStep = props.dragStep ?? step;
  const precision = props.precision ?? decimalsOf(step * displayScale);
  const valueDecimals = clamp(precision + Math.round(Math.log10(Math.max(1e-9, displayScale))) + 2, 0, 10);
  const [editing, setEditing] = useState<string | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ startX: number; lastX: number; v: number; moved: boolean } | null>(null);
  const clickTimer = useRef<number>(0);
  const committed = useRef(false);
  const refocus = useRef(false);

  const fit = (v: number) => clamp(v, min, max);
  const emit = (v: number, meta: ChangeMeta) => onChange(roundTo(fit(v), valueDecimals), meta);

  useEffect(() => () => window.clearTimeout(clickTimer.current), []);
  useLayoutEffect(() => {
    if (editing !== null && inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    if (editing === null && refocus.current) {
      refocus.current = false;
      rootRef.current?.focus();
    }
  }, [editing]);

  const shown = live ?? value;
  const text = mixed && live === null ? '—' : format ? format(shown) : formatNumber(shown * displayScale, precision);

  const startEdit = (initial?: string) => {
    if (disabled) return;
    committed.current = false;
    setEditing(initial ?? (mixed ? '' : formatNumber(value * displayScale, precision)));
  };

  const commit = (txt: string, back: boolean) => {
    if (committed.current) return;
    committed.current = true;
    const parsed = evalNumberInput(txt, mixed ? 0 : value * displayScale);
    if (parsed !== null) emit(parsed / displayScale, FINAL);
    refocus.current = back;
    setEditing(null);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || editing !== null || e.button !== 0) return;
    e.preventDefault();
    rootRef.current?.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, lastX: e.clientX, v: mixed ? (defaultValue ?? 0) : value, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.startX) < 3) return;
      d.moved = true;
      d.lastX = e.clientX;
      window.clearTimeout(clickTimer.current);
      return;
    }
    const dx = e.clientX - d.lastX;
    d.lastX = e.clientX;
    d.v = fit(d.v + dx * dragStep * modMul(e));
    setLive(d.v);
    emit(d.v, LIVE);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.moved) {
      setLive(null);
      emit(d.v, FINAL);
      return;
    }
    // A click: type a value. Wait briefly when a double-click could reset instead.
    if (defaultValue === undefined) startEdit();
    else {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = window.setTimeout(() => startEdit(), 220);
    }
  };
  const onDoubleClick = () => {
    window.clearTimeout(clickTimer.current);
    if (defaultValue !== undefined && !disabled) emit(defaultValue, FINAL);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled || editing !== null) return;
    const base = mixed ? (defaultValue ?? 0) : value;
    let handled = true;
    if (e.key === 'ArrowUp') emit(base + step * modMul(e), FINAL);
    else if (e.key === 'ArrowDown') emit(base - step * modMul(e), FINAL);
    else if (e.key === 'PageUp') emit(base + step * 10, FINAL);
    else if (e.key === 'PageDown') emit(base - step * 10, FINAL);
    else if (e.key === 'Home' && Number.isFinite(min)) emit(min, FINAL);
    else if (e.key === 'End' && Number.isFinite(max)) emit(max, FINAL);
    else if (e.key === 'Enter' || e.key === 'F2') startEdit();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && defaultValue !== undefined) emit(defaultValue, FINAL);
    else if (/^[\d.\-*/(]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) startEdit(e.key);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const style: CSSProperties | undefined = width !== undefined ? { width } : undefined;

  if (editing !== null) {
    return (
      <div className={cx('ins-num', 'ins-num--editing', className)} style={style} data-testid={props['data-testid']}>
        <input
          ref={inputRef}
          className="ins-num__input"
          value={editing}
          aria-label={props['aria-label']}
          spellCheck={false}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={(e) => commit(e.target.value, false)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(e.currentTarget.value, true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              committed.current = true;
              refocus.current = true;
              setEditing(null);
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const cur = evalNumberInput(e.currentTarget.value, value * displayScale);
              const next = fit((cur ?? value * displayScale) / displayScale + (e.key === 'ArrowUp' ? 1 : -1) * step * modMul(e));
              setEditing(formatNumber(next * displayScale, precision));
              emit(next, FINAL);
            }
          }}
        />
        {unit && <span className="ins-num__unit">{unit}</span>}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={cx('ins-num', live !== null && 'ins-num--scrubbing', disabled && 'ins-num--disabled', mixed && live === null && 'ins-num--mixed', className)}
      style={style}
      role="spinbutton"
      tabIndex={disabled ? -1 : 0}
      aria-label={props['aria-label']}
      aria-valuenow={Number.isFinite(value) ? roundTo(value * displayScale, precision) : undefined}
      aria-valuemin={Number.isFinite(min) ? min * displayScale : undefined}
      aria-valuemax={Number.isFinite(max) ? max * displayScale : undefined}
      aria-disabled={disabled || undefined}
      data-testid={props['data-testid']}
      title={props.title ?? (defaultValue !== undefined ? 'Drag to scrub · Click to type · Double-click to reset' : 'Drag to scrub · Click to type')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      <span className="ins-num__value">{text}</span>
      {unit && <span className="ins-num__unit">{unit}</span>}
    </div>
  );
}

// ============================================================================
// Slider
// ============================================================================

export interface SliderProps {
  value: number;
  onChange: ChangeHandler<number>;
  min: number;
  max: number;
  /** Keyboard increment (default (max-min)/100). */
  step?: number;
  /** Double-click resets to this. */
  defaultValue?: number;
  /** Fill starts here (default: 0 when inside the range, else min). */
  origin?: number;
  /** 'log' for frequencies and other exponential ranges (min must be > 0). */
  scale?: 'linear' | 'log';
  /** Optional CSS background for the track (e.g. a hue ramp). Hides the fill. */
  trackBackground?: string;
  disabled?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
  className?: string;
}

export function Slider(props: SliderProps) {
  const { value, onChange, min, max, defaultValue, scale = 'linear', trackBackground, disabled, className } = props;
  const step = props.step ?? (max - min) / 100;
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ lastX: number; v: number } | null>(null);
  const isLog = scale === 'log' && min > 0;
  const toPos = useCallback(
    (v: number) => (isLog ? Math.log(clamp(v, min, max) / min) / Math.log(max / min) : (clamp(v, min, max) - min) / (max - min || 1)),
    [isLog, min, max],
  );
  const fromPos = useCallback((p: number) => (isLog ? min * (max / min) ** clamp(p, 0, 1) : min + clamp(p, 0, 1) * (max - min)), [isLog, min, max]);
  const origin = props.origin ?? (min < 0 && max > 0 ? 0 : min);
  const pos = toPos(value);
  const o = toPos(origin);
  const decimals = decimalsOf(step) + 2;

  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return fromPos((clientX - r.left) / Math.max(1, r.width));
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    ref.current?.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = e.altKey ? value : at(e.clientX);
    drag.current = { lastX: e.clientX, v };
    onChange(roundTo(v, decimals), LIVE);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (e.altKey) {
      // fine adjust: relative, a tenth of the pointer motion
      const r = ref.current!.getBoundingClientRect();
      d.v = fromPos(toPos(d.v) + ((e.clientX - d.lastX) / Math.max(1, r.width)) * 0.1);
    } else d.v = at(e.clientX);
    d.lastX = e.clientX;
    onChange(roundTo(d.v, decimals), LIVE);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onChange(roundTo(d.v, decimals), FINAL);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const inc = (dir: number, mul: number) => {
      const next = isLog ? fromPos(toPos(value) + dir * 0.01 * mul) : clamp(value + dir * step * mul, min, max);
      onChange(roundTo(next, decimals), FINAL);
    };
    let handled = true;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') inc(1, modMul(e));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') inc(-1, modMul(e));
    else if (e.key === 'PageUp') inc(1, 10);
    else if (e.key === 'PageDown') inc(-1, 10);
    else if (e.key === 'Home') onChange(min, FINAL);
    else if (e.key === 'End') onChange(max, FINAL);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && defaultValue !== undefined) onChange(defaultValue, FINAL);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div
      ref={ref}
      className={cx('ins-slider', disabled && 'ins-slider--disabled', className)}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={props['aria-label']}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={roundTo(value, decimals)}
      aria-disabled={disabled || undefined}
      data-testid={props['data-testid']}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => defaultValue !== undefined && !disabled && onChange(defaultValue, FINAL)}
      onKeyDown={onKeyDown}
    >
      <div className="ins-slider__track" style={trackBackground ? { background: trackBackground, height: 4 } : undefined}>
        {!trackBackground && <div className="ins-slider__fill" style={{ left: `${Math.min(o, pos) * 100}%`, width: `${Math.abs(pos - o) * 100}%` }} />}
      </div>
      <div className="ins-slider__thumb" style={{ left: `${pos * 100}%` }} />
    </div>
  );
}

// ============================================================================
// ColorField
// ============================================================================

export interface ColorFieldProps {
  /** '#rrggbb' or '#rrggbbaa'. */
  value: string;
  onChange: ChangeHandler<string>;
  /** Show an alpha (%) field and keep alpha in the hex. */
  alpha?: boolean;
  /** Hide the hex text field (swatch only). */
  compact?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
  className?: string;
}

export function ColorField(props: ColorFieldProps) {
  const { value, onChange, alpha, compact, disabled, className } = props;
  const parsed = parseHexColor(value) ?? { rgb: '#000000', a: 1 };
  const [text, setText] = useState<string | null>(null);
  const withAlpha = (rgb: string, a: number) => toHexColor(rgb, alpha ? a : 1, false);
  const commitText = (s: string) => {
    const p = parseHexColor(s);
    setText(null);
    if (p) onChange(withAlpha(p.rgb, alpha && s.replace('#', '').length > 6 ? p.a : parsed.a), FINAL);
  };
  return (
    <div className={cx('ins-color', disabled && 'ins-color--disabled', className)} data-testid={props['data-testid']}>
      <label className="ins-color__swatch" title="Pick a color">
        <span className="ins-color__chip" style={{ background: value || 'transparent' }} />
        <input
          type="color"
          className="ins-color__native"
          value={parsed.rgb}
          disabled={disabled}
          aria-label={props['aria-label'] ?? 'Color'}
          data-testid={props['data-testid'] ? `${props['data-testid']}-picker` : undefined}
          onInput={(e) => onChange(withAlpha((e.target as HTMLInputElement).value, parsed.a), LIVE)}
          onChange={(e) => onChange(withAlpha(e.target.value, parsed.a), FINAL)}
        />
      </label>
      {!compact && (
        <input
          className="ins-color__hex"
          value={text ?? (alpha && parsed.a < 1 ? toHexColor(parsed.rgb, parsed.a, true) : parsed.rgb).toUpperCase()}
          disabled={disabled}
          spellCheck={false}
          aria-label={`${props['aria-label'] ?? 'Color'} hex`}
          data-testid={props['data-testid'] ? `${props['data-testid']}-hex` : undefined}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => text !== null && commitText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitText(e.currentTarget.value);
            if (e.key === 'Escape') setText(null);
          }}
        />
      )}
      {alpha && (
        <ScrubNumber
          className="ins-color__alpha"
          value={parsed.a}
          min={0}
          max={1}
          step={0.01}
          displayScale={100}
          precision={0}
          unit="%"
          defaultValue={1}
          disabled={disabled}
          aria-label="Opacity"
          data-testid={props['data-testid'] ? `${props['data-testid']}-alpha` : undefined}
          onChange={(a, meta) => onChange(toHexColor(parsed.rgb, a, false), meta)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Select
// ============================================================================

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Options with the same group render inside one <optgroup>. */
  group?: string;
}

export interface SelectProps<T extends string | number> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Shown (and selected) when the value matches no option, e.g. 'Mixed'. */
  placeholder?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  className?: string;
  style?: CSSProperties;
}

export function Select<T extends string | number>(props: SelectProps<T>) {
  const { value, options, onChange, disabled, placeholder, className, style } = props;
  const idx = options.findIndex((o) => o.value === value);
  const groups: { name: string | undefined; items: { o: SelectOption<T>; i: number }[] }[] = [];
  options.forEach((o, i) => {
    const last = groups[groups.length - 1];
    if (last && last.name === o.group) last.items.push({ o, i });
    else groups.push({ name: o.group, items: [{ o, i }] });
  });
  const renderItems = (items: { o: SelectOption<T>; i: number }[]) =>
    items.map(({ o, i }) => (
      <option key={i} value={i} disabled={o.disabled}>
        {o.label}
      </option>
    ));
  return (
    <div className={cx('ins-select', disabled && 'ins-select--disabled', className)} style={style}>
      <select
        value={idx < 0 ? '' : String(idx)}
        disabled={disabled}
        aria-label={props['aria-label']}
        data-testid={props['data-testid']}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const i = Number(e.target.value);
          if (options[i]) onChange(options[i].value);
        }}
      >
        {idx < 0 && (
          <option value="" disabled>
            {placeholder ?? '—'}
          </option>
        )}
        {groups.map((g, gi) =>
          g.name ? (
            <optgroup key={gi} label={g.name}>
              {renderItems(g.items)}
            </optgroup>
          ) : (
            renderItems(g.items)
          ),
        )}
      </select>
      <svg className="ins-select__chev" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 10l5 5 5-5" />
      </svg>
    </div>
  );
}

// ============================================================================
// Toggle
// ============================================================================

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Optional text label after the switch. */
  label?: ReactNode;
  disabled?: boolean;
  /** Batch editing: some on, some off. */
  mixed?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
  className?: string;
  title?: string;
}

export function Toggle(props: ToggleProps) {
  const { checked, onChange, label, disabled, mixed, className } = props;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={mixed ? 'mixed' : checked}
      aria-label={props['aria-label']}
      disabled={disabled}
      title={props.title}
      data-testid={props['data-testid']}
      className={cx('ins-toggle', checked && !mixed && 'ins-toggle--on', mixed && 'ins-toggle--mixed', className)}
      onClick={() => onChange(mixed ? true : !checked)}
    >
      <span className="ins-toggle__track">
        <span className="ins-toggle__knob" />
      </span>
      {label !== undefined && <span className="ins-toggle__label">{label}</span>}
    </button>
  );
}

// ============================================================================
// Segmented
// ============================================================================

export interface SegmentedOption<T extends string | number> {
  value: T;
  label?: ReactNode;
  /** Icon element shown instead of (or before) the label. */
  icon?: ReactNode;
  title?: string;
  'data-testid'?: string;
}

export interface SegmentedProps<T extends string | number> {
  value: T | null;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Stretch items to fill the row. */
  stretch?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
  className?: string;
}

export function Segmented<T extends string | number>(props: SegmentedProps<T>) {
  const { value, options, onChange, disabled, stretch, className } = props;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const cur = options.findIndex((o) => o.value === value);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const n = options.length;
    const next = ((cur < 0 ? 0 : cur) + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div
      className={cx('ins-seg', stretch && 'ins-seg--stretch', disabled && 'ins-seg--disabled', className)}
      role="radiogroup"
      aria-label={props['aria-label']}
      data-testid={props['data-testid']}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === cur}
          tabIndex={i === cur || (cur < 0 && i === 0) ? 0 : -1}
          disabled={disabled}
          title={o.title}
          aria-label={o.title}
          data-testid={o['data-testid']}
          className={cx('ins-seg__item', i === cur && 'ins-seg__item--on')}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label !== undefined && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// Section
// ============================================================================

const SECTION_KEY = 'delta.ins.sections';
let sectionState: Record<string, boolean> = {};
try {
  sectionState = JSON.parse(localStorage.getItem(SECTION_KEY) ?? '{}') ?? {};
} catch {
  sectionState = {};
}

function rememberSection(id: string, open: boolean) {
  sectionState = { ...sectionState, [id]: open };
  try {
    localStorage.setItem(SECTION_KEY, JSON.stringify(sectionState));
  } catch {
    /* storage unavailable */
  }
}

export interface SectionProps {
  /** Stable id: the open/closed state is remembered per id. */
  id: string;
  title: ReactNode;
  /** Right-side header actions (buttons); clicks don't toggle the section. */
  actions?: ReactNode;
  defaultOpen?: boolean;
  /** Optional enable switch in the header (e.g. bypass an effect or the grade). */
  enabled?: boolean;
  onEnabledChange?: (on: boolean) => void;
  /** Small badge after the title (e.g. a count). */
  badge?: ReactNode;
  children?: ReactNode;
  'data-testid'?: string;
  className?: string;
}

export function Section(props: SectionProps) {
  const { id, title, actions, defaultOpen = true, enabled, onEnabledChange, badge, children, className } = props;
  const [open, setOpen] = useState<boolean>(() => sectionState[id] ?? defaultOpen);
  const bodyId = useId();
  const toggle = () => {
    setOpen(!open);
    rememberSection(id, !open);
  };
  return (
    <section className={cx('ins-section', !open && 'ins-section--closed', enabled === false && 'ins-section--off', className)} data-testid={props['data-testid']}>
      <div className="ins-section__head">
        <button type="button" className="ins-section__toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle} data-testid={props['data-testid'] ? `${props['data-testid']}-toggle` : undefined}>
          <II.Chevron size={12} className="ins-section__chev" />
          <span className="ins-section__title">{title}</span>
          {badge !== undefined && <span className="ins-section__badge">{badge}</span>}
        </button>
        <div className="ins-section__actions" onClick={(e) => e.stopPropagation()}>
          {actions}
          {onEnabledChange && enabled !== undefined && (
            <Toggle checked={enabled} onChange={onEnabledChange} aria-label={`${typeof title === 'string' ? title : 'Section'} enabled`} title={enabled ? 'Disable' : 'Enable'} />
          )}
        </div>
      </div>
      {open && (
        <div className="ins-section__body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// KeyframeButton
// ============================================================================

const KF_ANIM = 1;
const KF_AT = 2;
const KF_PREV = 4;
const KF_NEXT = 8;
const KF_OUTSIDE = 16;
const KF_NOCLIP = -1;

type EditorSnapshot = ReturnType<typeof useEditor.getState>;

/** One param path, or a group animated together (e.g. position x + y, a color wheel's r/g/b/y). */
export type ParamPaths = string | readonly string[];

const asList = (p: ParamPaths): readonly string[] => (typeof p === 'string' ? [p] : p);

function kfBits(s: EditorSnapshot, clipId: string, paths: ParamPaths): number {
  if (!s.project) return KF_NOCLIP;
  const clip = findClip(activeSequence(s.project), clipId)?.clip;
  if (!clip) return KF_NOCLIP;
  const raw = s.playhead - clip.start;
  let bits = raw < -KEY_TOLERANCE || raw > clip.duration + KEY_TOLERANCE ? KF_OUTSIDE : 0;
  for (const path of asList(paths)) {
    const list = clip.keyframes[path];
    if (!list?.length) continue;
    bits |= KF_ANIM;
    for (const k of list) {
      if (Math.abs(k.t - raw) <= KEY_TOLERANCE) bits |= KF_AT;
      else if (k.t < raw) bits |= KF_PREV;
      else bits |= KF_NEXT;
    }
  }
  return bits;
}

function groupLabel(paths: ParamPaths, clip: Clip): string {
  const list = asList(paths);
  if (list.length === 1) return paramLabel(list[0], clip);
  // 'Position X' + 'Position Y' → 'Position'
  const names = list.map((p) => paramLabel(p, clip));
  const words = names[0].split(' ');
  while (words.length > 1 && !names.every((n) => n.startsWith(words.join(' ')))) words.pop();
  const common = words.join(' ');
  return names.every((n) => n.startsWith(common)) && common ? common.replace(/\s+(X|Y|width|height)$/i, '') : names.join(', ');
}

/** Toggles animation of a param (or group) at the playhead (stopwatch). */
export function toggleAnimation(clipId: string, paths: ParamPaths): void {
  const clip = getClip(clipId);
  if (!clip) return;
  const list = asList(paths);
  const playhead = useEditor.getState().playhead;
  const name = groupLabel(paths, clip);
  const animated = list.some((p) => !!clip.keyframes[p]?.length);
  editClip(clipId, animated ? `Stop animating ${name}` : `Animate ${name}`, (c) => {
    const local = localTime(c, playhead);
    for (const path of list) {
      if (animated) clearKeyframes(c, path, local);
      else setKeyframe(c, path, local, paramAt(c, path, local));
    }
  });
}

/** Adds a keyframe at the playhead (current value), or removes the one there. */
export function toggleKeyframeAtPlayhead(clipId: string, paths: ParamPaths): void {
  const clip = getClip(clipId);
  if (!clip) return;
  const list = asList(paths);
  const playhead = useEditor.getState().playhead;
  const local = localTime(clip, playhead);
  const hit = list.some((p) => (clip.keyframes[p] ?? []).some((k) => Math.abs(k.t - local) <= KEY_TOLERANCE));
  const name = groupLabel(paths, clip);
  editClip(clipId, hit ? `Remove ${name} keyframe` : `Add ${name} keyframe`, (c) => {
    for (const path of list) {
      if (!hit) {
        setKeyframe(c, path, local, paramAt(c, path, local));
        continue;
      }
      const keys = c.keyframes[path] ?? [];
      if (!keys.some((k) => Math.abs(k.t - local) <= KEY_TOLERANCE)) continue;
      // Removing the last keyframe stops animation but keeps its value.
      if (keys.length <= 1) clearKeyframes(c, path, local);
      else removeKeyframeAt(c, path, local);
    }
  });
}

/** Seeks to the previous/next keyframe of a param (or of every param when paths is omitted). */
export function seekKeyframe(clipId: string, dir: -1 | 1, paths?: ParamPaths): boolean {
  const clip = getClip(clipId);
  if (!clip) return false;
  const local = useEditor.getState().playhead - clip.start;
  const times = paths
    ? asList(paths).flatMap((p) => (clip.keyframes[p] ?? []).map((k) => k.t))
    : Object.values(clip.keyframes).flatMap((l) => l.map((k) => k.t));
  let best: number | null = null;
  for (const t of times) {
    if (dir > 0 && t > local + KEY_TOLERANCE && (best === null || t < best)) best = t;
    if (dir < 0 && t < local - KEY_TOLERANCE && (best === null || t > best)) best = t;
  }
  if (best === null) return false;
  transport.seek(clip.start + best);
  return true;
}

export interface KeyframeButtonProps {
  clipId: string;
  /** Param path, e.g. 'transform.opacity' or 'effects.<id>.<key>'; an array animates the group together. */
  path: ParamPaths;
  /** Hide the ◀ ▶ navigation arrows (stopwatch + diamond only). */
  compact?: boolean;
  'data-testid'?: string;
  className?: string;
}

/** Stopwatch (animate on/off) and ◀ ◆ ▶ (previous / add-remove at playhead / next). */
export function KeyframeButton(props: KeyframeButtonProps) {
  const { clipId, path, compact, className } = props;
  const bits = useEditor((s) => kfBits(s, clipId, path));
  const pathKey = asList(path).join('+');
  if (bits === KF_NOCLIP) return <span className={cx('ins-kf', className)} />;
  const animated = !!(bits & KF_ANIM);
  const at = !!(bits & KF_AT);
  const outside = !!(bits & KF_OUTSIDE);
  const tid = props['data-testid'] ?? `ins-kf-${pathKey}`;
  return (
    <span className={cx('ins-kf', animated && 'ins-kf--on', className)} data-testid={tid}>
      <button
        type="button"
        className="ins-kf__watch"
        aria-pressed={animated}
        aria-label={animated ? 'Stop animating' : 'Animate'}
        title={animated ? 'Animation on: click to remove all keyframes' : 'Animate this parameter'}
        data-testid={`${tid}-watch`}
        onClick={() => toggleAnimation(clipId, path)}
      >
        <II.Stopwatch size={13} />
      </button>
      {!compact && (
        <button
          type="button"
          className="ins-kf__nav"
          aria-label="Previous keyframe"
          title="Previous keyframe"
          disabled={!(bits & KF_PREV)}
          data-testid={`${tid}-prev`}
          onClick={() => seekKeyframe(clipId, -1, path)}
        >
          <II.TriLeft size={10} />
        </button>
      )}
      <button
        type="button"
        className={cx('ins-kf__diamond', at && 'ins-kf__diamond--at')}
        aria-pressed={at}
        aria-label={at ? 'Remove keyframe' : 'Add keyframe'}
        title={outside ? 'Move the playhead over the clip to add keyframes' : at ? 'Remove keyframe at playhead' : 'Add keyframe at playhead'}
        disabled={outside}
        data-testid={`${tid}-diamond`}
        onClick={() => toggleKeyframeAtPlayhead(clipId, path)}
      >
        <II.Diamond size={11} filled={at} />
      </button>
      {!compact && (
        <button
          type="button"
          className="ins-kf__nav"
          aria-label="Next keyframe"
          title="Next keyframe"
          disabled={!(bits & KF_NEXT)}
          data-testid={`${tid}-next`}
          onClick={() => seekKeyframe(clipId, 1, path)}
        >
          <II.TriRight size={10} />
        </button>
      )}
    </span>
  );
}

// ============================================================================
// PointField
// ============================================================================

export interface Point {
  x: number;
  y: number;
}

export interface PointFieldProps {
  value: Point;
  onChange: ChangeHandler<Point>;
  /** Per-axis change, when the caller writes x and y to different param paths. */
  onAxisChange?: (axis: 'x' | 'y', value: number, meta: ChangeMeta) => void;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  unit?: string;
  displayScale?: number;
  defaultValue?: Point;
  labels?: [string, string];
  mixed?: boolean;
  disabled?: boolean;
  'data-testid'?: string;
  className?: string;
}

export function PointField(props: PointFieldProps) {
  const { value, onChange, onAxisChange, labels = ['X', 'Y'], defaultValue, className, ...rest } = props;
  const tid = props['data-testid'];
  const common = {
    step: rest.step,
    min: rest.min,
    max: rest.max,
    precision: rest.precision,
    unit: rest.unit,
    displayScale: rest.displayScale,
    mixed: rest.mixed,
    disabled: rest.disabled,
  };
  return (
    <div className={cx('ins-point', className)} data-testid={tid}>
      <span className="ins-point__axis">{labels[0]}</span>
      <ScrubNumber
        {...common}
        value={value.x}
        defaultValue={defaultValue?.x}
        aria-label={labels[0]}
        data-testid={tid ? `${tid}-x` : undefined}
        onChange={(x, meta) => (onAxisChange ? onAxisChange('x', x, meta) : onChange({ x, y: value.y }, meta))}
      />
      <span className="ins-point__axis">{labels[1]}</span>
      <ScrubNumber
        {...common}
        value={value.y}
        defaultValue={defaultValue?.y}
        aria-label={labels[1]}
        data-testid={tid ? `${tid}-y` : undefined}
        onChange={(y, meta) => (onAxisChange ? onAxisChange('y', y, meta) : onChange({ x: value.x, y }, meta))}
      />
    </div>
  );
}

// ============================================================================
// TimecodeField
// ============================================================================

export interface TimecodeFieldProps {
  /** Seconds. */
  value: number;
  /** Called with the new time in seconds (frame-snapped) when the user commits. */
  onCommit: (seconds: number) => void;
  /** Defaults to the active sequence's rate / drop-frame setting. */
  fps?: number;
  dropFrame?: boolean;
  /** Added to the display (pass seq.startTimecode for record times, 0 for durations). */
  startTimecode?: number;
  min?: number;
  max?: number;
  /** Drag horizontally to change by frames (commits on release). Default true. */
  scrub?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
  className?: string;
}

export function TimecodeField(props: TimecodeFieldProps) {
  const { value, onCommit, startTimecode = 0, min = -Infinity, max = Infinity, scrub = true, disabled, className } = props;
  const seqFps = useEditor((s) => (s.project ? activeSequence(s.project).fps : 30));
  const seqDf = useEditor((s) => (s.project ? activeSequence(s.project).dropFrame : false));
  const fps = props.fps ?? seqFps;
  const df = props.dropFrame ?? seqDf;
  const [editing, setEditing] = useState<string | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const drag = useRef<{ startX: number; frames0: number; moved: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const refocus = useRef(false);
  const fit = (t: number) => clamp(t, min, max);

  useLayoutEffect(() => {
    if (editing !== null && inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    if (editing === null && refocus.current) {
      refocus.current = false;
      rootRef.current?.focus();
    }
  }, [editing]);

  const display = formatTimecode(live ?? value, fps, df, startTimecode);
  const commitText = (txt: string, back: boolean) => {
    if (done.current) return;
    done.current = true;
    const t = parseTimecode(txt, fps, value, startTimecode, df);
    if (t !== null) onCommit(fit(fromFrames(toFrames(t, fps), fps)));
    refocus.current = back;
    setEditing(null);
  };
  const stepFrames = (n: number) => onCommit(fit(fromFrames(toFrames(value, fps) + n, fps)));

  if (editing !== null) {
    return (
      <div className={cx('ins-tc', 'ins-tc--editing', className)} data-testid={props['data-testid']}>
        <input
          ref={inputRef}
          className="ins-tc__input"
          value={editing}
          spellCheck={false}
          aria-label={props['aria-label']}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={(e) => commitText(e.target.value, false)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              commitText(e.currentTarget.value, true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              done.current = true;
              refocus.current = true;
              setEditing(null);
            }
          }}
        />
      </div>
    );
  }
  return (
    <div
      ref={rootRef}
      className={cx('ins-tc', disabled && 'ins-tc--disabled', live !== null && 'ins-tc--scrubbing', className)}
      role="textbox"
      tabIndex={disabled ? -1 : 0}
      aria-label={props['aria-label']}
      aria-readonly={disabled || undefined}
      data-testid={props['data-testid']}
      title="Click to type a timecode (+/- for relative) · Drag to change · ↑/↓ by frame"
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        rootRef.current?.focus();
        if (scrub) e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, frames0: toFrames(value, fps), moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !scrub) return;
        const dx = e.clientX - d.startX;
        if (!d.moved && Math.abs(dx) < 3) return;
        d.moved = true;
        const perFrame = e.shiftKey ? 0.5 : 4;
        setLive(fit(fromFrames(d.frames0 + Math.round(dx / perFrame), fps)));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        if (d.moved) {
          if (live !== null && Math.abs(live - value) > 1e-9) onCommit(live);
          setLive(null);
        } else {
          done.current = false;
          setEditing(display);
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
        setLive(null);
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        let handled = true;
        if (e.key === 'ArrowUp') stepFrames(e.shiftKey ? 10 : 1);
        else if (e.key === 'ArrowDown') stepFrames(e.shiftKey ? -10 : -1);
        else if (e.key === 'Enter' || e.key === 'F2') {
          done.current = false;
          setEditing(display);
        } else if (/^[\d+\-:;.]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
          done.current = false;
          setEditing(e.key);
        } else handled = false;
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {display}
    </div>
  );
}

// ============================================================================
// ParamRow
// ============================================================================

export interface ParamRowProps {
  label: ReactNode;
  children?: ReactNode;
  /** With `path`, shows a KeyframeButton for {clipId, path}. */
  clipId?: string;
  path?: ParamPaths;
  /** Tooltip on the label. */
  hint?: string;
  /** Double-clicking the label calls this (e.g. reset to default). */
  onReset?: () => void;
  /** Indent the label (sub-params). */
  indent?: boolean;
  /** Reserve the keyframe column even without a path (keeps controls aligned). Default true. */
  reserveKeyframe?: boolean;
  'data-testid'?: string;
  className?: string;
}

/** The standard inspector row: label · control · keyframe button. */
export function ParamRow(props: ParamRowProps) {
  const { label, children, clipId, path, hint, onReset, indent, reserveKeyframe = true, className } = props;
  const showKf = !!(clipId && path);
  return (
    <div className={cx('ins-row', indent && 'ins-row--indent', !showKf && !reserveKeyframe && 'ins-row--nokf', className)} data-testid={props['data-testid']}>
      <span className="ins-row__label" title={hint ?? (onReset ? 'Double-click to reset' : undefined)} onDoubleClick={onReset}>
        {label}
      </span>
      <div className="ins-row__control">{children}</div>
      {showKf ? <KeyframeButton clipId={clipId!} path={path!} /> : reserveKeyframe ? <span className="ins-kf" aria-hidden="true" /> : null}
    </div>
  );
}

/** A small square icon button in the kit's style. */
export function IconButton(props: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  'data-testid'?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cx('ins-ibtn', props.active && 'ins-ibtn--on', props.className)}
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.active}
      disabled={props.disabled}
      data-testid={props['data-testid']}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
