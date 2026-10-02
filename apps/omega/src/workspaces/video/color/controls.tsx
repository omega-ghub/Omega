// Controls used by the color panel: the shared kit from the inspector
// package (one look across Delta), plus a range slider and a compact
// slider+number row built on it.
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { displayKey, keysFor } from '../actions';
import { KeyframeButton, ParamRow, ScrubNumber, Select, Slider, Toggle, type ChangeMeta } from '../inspector/controls';

/** " (Ctrl+Alt+C)" — the action's current binding for tooltips, or ''. */
export function kbd(actionId: string): string {
  const k = keysFor(actionId)[0];
  return k ? ` (${displayKey(k)})` : '';
}

export { KeyframeButton, ParamRow, ScrubNumber, Select, Slider, Toggle };
export type { ChangeMeta };

export interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  precision?: number;
  unit?: string;
  displayScale?: number;
  /** Hard limits for typed / scrubbed values (default: min..max). */
  hardMin?: number;
  hardMax?: number;
  trackBackground?: string;
  onChange: (v: number, meta: ChangeMeta) => void;
  /** Keyframe button for {clipId, path}. */
  clipId?: string;
  path?: string;
  hint?: string;
  testid: string;
  signed?: boolean;
}

/** label · slider · number · keyframe stopwatch — double-click the label or number to reset. */
export function SliderRow(p: SliderRowProps) {
  const fmt = p.signed ? (v: number) => `${v * (p.displayScale ?? 1) > 0 ? '+' : ''}${(v * (p.displayScale ?? 1)).toFixed(p.precision ?? 2)}` : undefined;
  return (
    <ParamRow label={p.label} clipId={p.clipId} path={p.path} hint={p.hint ?? 'Double-click to reset'} onReset={() => p.onChange(p.defaultValue, { final: true })} data-testid={p.testid} className="cl-row">
      <div className="cl-row__ctl">
        <Slider
          value={p.value}
          min={p.min}
          max={p.max}
          step={p.step}
          defaultValue={p.defaultValue}
          origin={p.defaultValue}
          trackBackground={p.trackBackground}
          onChange={p.onChange}
          aria-label={p.label}
          data-testid={`${p.testid}-slider`}
        />
        <ScrubNumber
          value={p.value}
          min={p.hardMin ?? p.min}
          max={p.hardMax ?? p.max}
          step={p.step}
          precision={p.precision}
          displayScale={p.displayScale}
          unit={p.unit}
          defaultValue={p.defaultValue}
          format={fmt}
          width={58}
          onChange={p.onChange}
          aria-label={p.label}
          data-testid={`${p.testid}-value`}
        />
      </div>
    </ParamRow>
  );
}

export interface RangeSliderProps {
  low: number;
  high: number;
  min?: number;
  max?: number;
  onChange: (low: number, high: number, meta: ChangeMeta) => void;
  trackBackground?: string;
  testid: string;
  label: string;
}

/** Two-thumb range slider (0..1 by default). Drag a thumb, or the band between them. */
export function RangeSlider(p: RangeSliderProps) {
  const min = p.min ?? 0;
  const max = p.max ?? 1;
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ which: 'low' | 'high' | 'band'; x0: number; low: number; high: number } | null>(null);
  const pos = (v: number) => ((v - min) / (max - min)) * 100;
  const valAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return min + Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) * (max - min);
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = valAt(e.clientX);
    const dl = Math.abs(v - p.low);
    const dh = Math.abs(v - p.high);
    const inBand = v > p.low && v < p.high && Math.min(dl, dh) > (max - min) * 0.06;
    drag.current = { which: inBand ? 'band' : dl <= dh ? 'low' : 'high', x0: v, low: p.low, high: p.high };
    if (!inBand) move(e.clientX, false);
  };
  const move = (clientX: number, fromMove = true) => {
    const d = drag.current;
    if (!d) return;
    const v = valAt(clientX);
    let lo = d.low;
    let hi = d.high;
    if (d.which === 'low') lo = Math.min(v, hi);
    else if (d.which === 'high') hi = Math.max(v, lo);
    else {
      const dv = Math.max(min - d.low, Math.min(max - d.high, v - d.x0));
      lo = d.low + dv;
      hi = d.high + dv;
    }
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    if (fromMove || d.which !== 'band') p.onChange(r3(lo), r3(hi), { final: false });
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    p.onChange(p.low, p.high, { final: true });
  };
  return (
    <div
      ref={ref}
      className="cl-range"
      role="group"
      aria-label={p.label}
      data-testid={p.testid}
      onPointerDown={onDown}
      onPointerMove={(e) => move(e.clientX)}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div className="cl-range__track" style={p.trackBackground ? { background: p.trackBackground } : undefined} />
      <div className="cl-range__band" style={{ left: `${pos(p.low)}%`, width: `${pos(p.high) - pos(p.low)}%` }} />
      <div className="cl-range__thumb" style={{ left: `${pos(p.low)}%` }} data-testid={`${p.testid}-low`} />
      <div className="cl-range__thumb" style={{ left: `${pos(p.high)}%` }} data-testid={`${p.testid}-high`} />
    </div>
  );
}

/** A small text+icon button in the color panel's toolbar. */
export function ToolButton(p: { icon: ReactNode; label: string; title: string; onClick: () => void; active?: boolean; disabled?: boolean; testid: string; iconOnly?: boolean }) {
  return (
    <button
      type="button"
      className={`cl-tool ${p.active ? 'is-on' : ''} ${p.iconOnly ? 'cl-tool--icon' : ''}`}
      title={p.title}
      aria-label={p.iconOnly ? p.label : undefined}
      aria-pressed={p.active}
      disabled={p.disabled}
      data-testid={p.testid}
      onClick={p.onClick}
    >
      {p.icon}
      {!p.iconOnly && <span>{p.label}</span>}
    </button>
  );
}
