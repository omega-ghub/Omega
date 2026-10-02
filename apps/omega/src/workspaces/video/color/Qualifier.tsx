// HSL qualifier (secondary): pick a hue range on a strip (drag the band to
// move it, its edges to resize), saturation and luminance ranges, softness,
// invert; then adjust hue, saturation and exposure inside the key.
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useEditor } from '../../../state/store';
import type { Clip, Qualifier } from '../../../state/types';
import { RangeSlider, SliderRow, Toggle } from './controls';
import { editGradeClip } from './grade';
import { toggleMatte } from './colorActions';

const mod = (a: number, n = 360) => ((a % n) + n) % n;
const r2 = (v: number) => Math.round(v * 100) / 100;
const AUTO_ENABLE = new Set(['hue', 'sat', 'lum']);

export function QualifierSection({ clip }: { clip: Clip }) {
  const q = clip.grade.qualifier;
  const showMatte = useEditor((s) => s.viewer.showMatte);
  const set = (patch: Partial<Qualifier>, keySuffix: string, label = 'Adjust qualifier') =>
    editGradeClip(
      clip.id,
      label,
      (c) => {
        Object.assign(c.grade.qualifier, patch);
        // picking a range is the intent to key: switch the qualifier on
        if (AUTO_ENABLE.has(keySuffix)) c.grade.qualifier.enabled = true;
      },
      `cl:${clip.id}:qual:${keySuffix}`,
    );

  return (
    <div className={`cl-qual ${q.enabled ? '' : 'cl-qual--off'}`} data-testid="cl-qualifier">
      <div className="cl-qual__toggles">
        <Toggle checked={q.enabled} onChange={(on) => set({ enabled: on }, 'enabled', on ? 'Enable qualifier' : 'Disable qualifier')} label="Qualifier" data-testid="cl-qual-enable" />
        <Toggle checked={showMatte} onChange={() => toggleMatte()} label="Show matte" data-testid="cl-qual-matte" title="Show the key as a black-and-white matte in the viewer" />
        <Toggle checked={q.invert} onChange={(on) => set({ invert: on }, 'invert', on ? 'Invert qualifier' : 'Un-invert qualifier')} label="Invert" data-testid="cl-qual-invert" />
      </div>

      <div className="cl-qual__label">
        <span>Hue</span>
        <span className="cl-num cl-dim">
          {Math.round(q.hueCenter)}° ± {Math.round(q.hueWidth / 2)}°
        </span>
      </div>
      <HueStrip q={q} onChange={(hueCenter, hueWidth) => set({ hueCenter, hueWidth }, 'hue')} />

      <div className="cl-qual__label">
        <span>Saturation</span>
        <span className="cl-num cl-dim">
          {Math.round(q.satLow * 100)}–{Math.round(q.satHigh * 100)}%
        </span>
      </div>
      <RangeSlider
        low={q.satLow}
        high={q.satHigh}
        label="Saturation range"
        testid="cl-qual-sat"
        trackBackground={`linear-gradient(to right, hsl(${q.hueCenter} 0% 50%), hsl(${q.hueCenter} 90% 50%))`}
        onChange={(satLow, satHigh) => set({ satLow, satHigh }, 'sat')}
      />
      <div className="cl-qual__label">
        <span>Luminance</span>
        <span className="cl-num cl-dim">
          {Math.round(q.lumLow * 100)}–{Math.round(q.lumHigh * 100)}%
        </span>
      </div>
      <RangeSlider low={q.lumLow} high={q.lumHigh} label="Luminance range" testid="cl-qual-lum" trackBackground="linear-gradient(to right, #000, #fff)" onChange={(lumLow, lumHigh) => set({ lumLow, lumHigh }, 'lum')} />

      <div className="cl-rows">
        <SliderRow label="Softness" value={q.softness} min={0} max={1} step={0.01} defaultValue={0.2} precision={0} displayScale={100} unit="%" testid="cl-qual-softness" onChange={(v) => set({ softness: r2(v) }, 'softness')} />
      </div>

      <div className="cl-subhead">Inside the key</div>
      <div className="cl-rows">
        <SliderRow label="Hue shift" value={q.hueShift} min={-180} max={180} step={1} defaultValue={0} precision={0} unit="°" signed testid="cl-qual-hueshift" onChange={(v) => set({ hueShift: Math.round(v) }, 'adjust:hue')} />
        <SliderRow label="Saturation" value={q.saturation} min={0} max={2} step={0.01} defaultValue={1} precision={2} testid="cl-qual-saturation" onChange={(v) => set({ saturation: r2(v) }, 'adjust:sat')} />
        <SliderRow label="Exposure" value={q.exposure} min={-4} max={4} step={0.01} defaultValue={0} precision={2} unit="st" signed testid="cl-qual-exposure" onChange={(v) => set({ exposure: r2(v) }, 'adjust:exp')} />
      </div>
    </div>
  );
}

/** The selection's membership at a hue (1 inside, soft falloff outside). */
function membership(h: number, center: number, width: number, softness: number): number {
  const half = width / 2;
  const d = Math.abs(mod(h - center + 180) - 180);
  if (d <= half) return 1;
  const soft = Math.max(1, softness * 40);
  return Math.max(0, 1 - (d - half) / soft);
}

function HueStrip({ q, onChange }: { q: Qualifier; onChange: (center: number, width: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'lo' | 'hi' | 'body'; h0: number; c0: number; w0: number } | null>(null);
  const lo = mod(q.hueCenter - q.hueWidth / 2);
  const hi = mod(q.hueCenter + q.hueWidth / 2);

  const hueAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(360, ((clientX - r.left) / Math.max(1, r.width)) * 360));
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const h = hueAt(e.clientX);
    const r = ref.current!.getBoundingClientRect();
    const tol = (8 / Math.max(1, r.width)) * 360;
    const near = (a: number) => Math.abs(mod(h - a + 180) - 180) <= tol;
    let mode: 'lo' | 'hi' | 'body';
    let c0 = q.hueCenter;
    if (near(lo)) mode = 'lo';
    else if (near(hi)) mode = 'hi';
    else {
      mode = 'body';
      if (membership(h, q.hueCenter, q.hueWidth, 0) < 1) {
        c0 = h;
        onChange(Math.round(h), q.hueWidth);
      }
    }
    drag.current = { mode, h0: h, c0, w0: q.hueWidth };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const h = hueAt(e.clientX);
    if (d.mode === 'body') {
      onChange(Math.round(mod(d.c0 + (h - d.h0))), d.w0);
      return;
    }
    const fixed = d.mode === 'lo' ? mod(d.c0 + d.w0 / 2) : mod(d.c0 - d.w0 / 2);
    let width = d.mode === 'lo' ? mod(fixed - h) : mod(h - fixed);
    width = Math.max(4, Math.min(356, width));
    const center = d.mode === 'lo' ? mod(fixed - width / 2) : mod(fixed + width / 2);
    onChange(Math.round(center), Math.round(width));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // scrim outside the selection, with the softness as a ramp
  const stops: string[] = [];
  for (let h = 0; h <= 360; h += 4) stops.push(`rgba(11, 11, 13, ${(0.78 * (1 - membership(h, q.hueCenter, q.hueWidth, q.softness))).toFixed(3)}) ${((h / 360) * 100).toFixed(2)}%`);

  return (
    <div
      ref={ref}
      className="cl-hue"
      data-testid="cl-qual-hue"
      role="group"
      aria-label={`Hue range ${Math.round(q.hueCenter)}° ± ${Math.round(q.hueWidth / 2)}°`}
      title="Drag the band to move it, its edges to widen or narrow it"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div className="cl-hue__scrim" style={{ background: `linear-gradient(to right, ${stops.join(', ')})` }} />
      <div className="cl-hue__edge" style={{ left: `${(lo / 360) * 100}%` }} data-testid="cl-qual-hue-lo" />
      <div className="cl-hue__edge" style={{ left: `${(hi / 360) * 100}%` }} data-testid="cl-qual-hue-hi" />
      <div className="cl-hue__center" style={{ left: `${(mod(q.hueCenter) / 360) * 100}%` }} />
    </div>
  );
}
