// Generated layers: shape (kind, size, radius, fill, stroke), solid (color)
// and gradient (kind, angle, stop editor).

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Clip, GradientProps, ShapeProps } from '../../../../state/types';
import { ColorField, editField, IconButton, ParamRow, ScrubNumber, Section, Segmented, Toggle } from '../controls';
import { NumParam, PointParam } from '../fields';
import { II } from '../icons';
import { clamp } from '../util';

function setShape(clip: Clip, key: string, label: string, fn: (s: ShapeProps) => void) {
  editField(clip.id, `shape.${key}`, label, (c) => {
    if (c.shape) fn(c.shape);
  });
}

export function ShapeSection({ clip }: { clip: Clip }) {
  const s = clip.shape!;
  const isLine = s.kind === 'line';
  return (
    <Section id="shape" title="Shape" data-testid="ins-sec-shape">
      <ParamRow label="Kind">
        <Segmented
          value={s.kind}
          aria-label="Shape kind"
          data-testid="ins-shape-kind"
          options={[
            { value: 'rect', icon: <II.Rect size={14} />, title: 'Rectangle', 'data-testid': 'ins-shape-kind-rect' },
            { value: 'ellipse', icon: <II.Ellipse size={14} />, title: 'Ellipse', 'data-testid': 'ins-shape-kind-ellipse' },
            {
              value: 'triangle',
              icon: (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5l8 14H4z" />
                </svg>
              ),
              title: 'Triangle',
              'data-testid': 'ins-shape-kind-triangle',
            },
            {
              value: 'line',
              icon: (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
                  <path d="M5 19L19 5" />
                </svg>
              ),
              title: 'Line',
              'data-testid': 'ins-shape-kind-line',
            },
          ]}
          onChange={(k) => setShape(clip, 'kind', 'Change shape', (x) => void (x.kind = k))}
        />
      </ParamRow>
      <PointParam clip={clip} paths={['shape.width', 'shape.height']} label="Size" labels={['W', 'H']} min={0} step={1} precision={0} unit="px" testid="ins-shape-size" />
      {(s.kind === 'rect' || s.kind === 'triangle') && (
        <NumParam clip={clip} path="shape.radius" label="Corner radius" min={0} max={5000} step={1} precision={0} unit="px" defaultValue={0} testid="ins-shape-radius" />
      )}
      {isLine ? (
        <>
          <ParamRow label="Color">
            <ColorField
              value={s.stroke.enabled ? s.stroke.color : s.fill.color}
              alpha
              aria-label="Line color"
              data-testid="ins-shape-line-color"
              onChange={(c) =>
                setShape(clip, 'stroke.color', 'Line color', (x) => {
                  x.stroke.enabled = true;
                  x.stroke.color = c;
                })
              }
            />
          </ParamRow>
          <ParamRow label="Thickness">
            <ScrubNumber value={s.stroke.width} min={1} max={500} step={1} precision={0} unit="px" defaultValue={6} aria-label="Line thickness" data-testid="ins-shape-line-width" onChange={(v) => setShape(clip, 'stroke.width', 'Line thickness', (x) => void (x.stroke.width = v))} />
          </ParamRow>
        </>
      ) : (
        <>
          <ParamRow label="Fill">
            <Toggle checked={s.fill.enabled} aria-label="Fill" data-testid="ins-shape-fill" onChange={(on) => setShape(clip, 'fill.enabled', on ? 'Fill on' : 'Fill off', (x) => void (x.fill.enabled = on))} />
            {s.fill.enabled && <ColorField value={s.fill.color} alpha aria-label="Fill color" data-testid="ins-shape-fill-color" onChange={(c) => setShape(clip, 'fill.color', 'Fill color', (x) => void (x.fill.color = c))} />}
          </ParamRow>
          <ParamRow label="Stroke">
            <Toggle checked={s.stroke.enabled} aria-label="Stroke" data-testid="ins-shape-stroke" onChange={(on) => setShape(clip, 'stroke.enabled', on ? 'Stroke on' : 'Stroke off', (x) => void (x.stroke.enabled = on))} />
            {s.stroke.enabled && (
              <>
                <ColorField compact value={s.stroke.color} alpha aria-label="Stroke color" data-testid="ins-shape-stroke-color" onChange={(c) => setShape(clip, 'stroke.color', 'Stroke color', (x) => void (x.stroke.color = c))} />
                <ScrubNumber value={s.stroke.width} min={0} max={500} step={0.5} precision={1} unit="px" defaultValue={6} aria-label="Stroke width" data-testid="ins-shape-stroke-width" onChange={(v) => setShape(clip, 'stroke.width', 'Stroke width', (x) => void (x.stroke.width = v))} />
              </>
            )}
          </ParamRow>
        </>
      )}
    </Section>
  );
}

export function SolidSection({ clip }: { clip: Clip }) {
  return (
    <Section id="solid" title="Solid" data-testid="ins-sec-solid">
      <ParamRow label="Color">
        <ColorField
          value={clip.solid!.color}
          alpha
          aria-label="Solid color"
          data-testid="ins-solid-color"
          onChange={(c) =>
            editField(clip.id, 'solid.color', 'Solid color', (x) => {
              if (x.solid) x.solid.color = c;
            })
          }
        />
      </ParamRow>
    </Section>
  );
}

function gradientCss(g: GradientProps): string {
  const stops = [...g.stops].sort((a, b) => a.pos - b.pos).map((s) => `${s.color} ${(clamp(s.pos, 0, 1) * 100).toFixed(2)}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Interpolated '#rrggbb' at `pos` along the stops (for inserting a new stop). */
function colorAt(g: GradientProps, pos: number): string {
  const stops = [...g.stops].sort((a, b) => a.pos - b.pos);
  const hex = (c: string) => {
    const s = c.replace('#', '');
    const n = parseInt((s.length === 3 ? [...s].map((x) => x + x).join('') : s).slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  if (!stops.length) return '#ffffff';
  if (pos <= stops[0].pos) return stops[0].color.slice(0, 7);
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (pos <= b.pos) {
      const k = (pos - a.pos) / Math.max(1e-6, b.pos - a.pos);
      const ca = hex(a.color);
      const cb = hex(b.color);
      return `#${ca.map((v, j) => Math.round(v + (cb[j] - v) * k).toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return stops[stops.length - 1].color.slice(0, 7);
}

function GradientStops({ clip }: { clip: Clip }) {
  const g = clip.gradient!;
  const [sel, setSel] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; moved: boolean } | null>(null);
  const index = Math.min(sel, g.stops.length - 1);
  const stop = g.stops[index];
  const setStops = (label: string, fn: (stops: GradientProps['stops']) => void, key = 'stops') =>
    editField(clip.id, `gradient.${key}`, label, (c) => {
      if (c.gradient) fn(c.gradient.stops);
    });
  const posAt = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return clamp((clientX - r.left) / Math.max(1, r.width), 0, 1);
  };
  const onHandleDown = (e: ReactPointerEvent<HTMLButtonElement>, i: number) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSel(i);
    drag.current = { index: i, moved: false };
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    d.moved = true;
    const pos = Math.round(posAt(e.clientX) * 1000) / 1000;
    setStops('Move gradient stop', (stops) => void (stops[d.index].pos = pos), `stop${d.index}.pos`);
  };
  return (
    <div className="ins-grad" data-testid="ins-grad-stops">
      <div
        ref={barRef}
        className="ins-grad__bar"
        style={{ background: gradientCss(g) }}
        title="Double-click to add a stop"
        data-testid="ins-grad-bar"
        onDoubleClick={(e) => {
          const pos = Math.round(posAt(e.clientX) * 1000) / 1000;
          const color = colorAt(g, pos);
          setStops('Add gradient stop', (stops) => void stops.push({ pos, color }));
          setSel(g.stops.length);
        }}
      >
        {g.stops.map((s, i) => (
          <button
            key={i}
            type="button"
            className={`ins-grad__stop ${i === index ? 'ins-grad__stop--on' : ''}`}
            style={{ left: `${clamp(s.pos, 0, 1) * 100}%`, ['--stop' as string]: s.color }}
            aria-label={`Stop ${i + 1} at ${Math.round(s.pos * 100)}%`}
            data-testid={`ins-grad-stop-${i}`}
            onPointerDown={(e) => onHandleDown(e, i)}
            onPointerMove={onHandleMove}
            onPointerUp={() => (drag.current = null)}
            onKeyDown={(e) => {
              if ((e.key === 'Delete' || e.key === 'Backspace') && g.stops.length > 2) {
                e.stopPropagation();
                setStops('Delete gradient stop', (stops) => void stops.splice(i, 1));
                setSel(0);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.stopPropagation();
                e.preventDefault();
                const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01);
                setStops('Move gradient stop', (stops) => void (stops[i].pos = clamp(Math.round((stops[i].pos + d) * 1000) / 1000, 0, 1)), `stop${i}.pos`);
              }
            }}
          />
        ))}
      </div>
      {stop && (
        <div className="ins-grad__edit">
          <ColorField value={stop.color} alpha aria-label="Stop color" data-testid="ins-grad-stop-color" onChange={(c) => setStops('Gradient stop color', (stops) => void (stops[index].color = c), `stop${index}.color`)} />
          <ScrubNumber
            value={stop.pos}
            min={0}
            max={1}
            step={0.01}
            dragStep={0.002}
            displayScale={100}
            precision={0}
            unit="%"
            width={58}
            aria-label="Stop position"
            data-testid="ins-grad-stop-pos"
            onChange={(v) => setStops('Move gradient stop', (stops) => void (stops[index].pos = v), `stop${index}.pos`)}
          />
          <IconButton
            title="Delete stop"
            disabled={g.stops.length <= 2}
            data-testid="ins-grad-stop-delete"
            onClick={() => {
              setStops('Delete gradient stop', (stops) => void stops.splice(index, 1));
              setSel(0);
            }}
          >
            <II.Trash size={14} />
          </IconButton>
          <IconButton title="Reverse stops" data-testid="ins-grad-reverse" onClick={() => setStops('Reverse gradient', (stops) => stops.forEach((s) => (s.pos = Math.round((1 - s.pos) * 1000) / 1000)))}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 8h14l-3-3M20 16H6l3 3" />
            </svg>
          </IconButton>
        </div>
      )}
    </div>
  );
}

export function GradientSection({ clip }: { clip: Clip }) {
  const g = clip.gradient!;
  return (
    <Section id="gradient" title="Gradient" data-testid="ins-sec-gradient">
      <ParamRow label="Kind">
        <Segmented
          value={g.kind}
          aria-label="Gradient kind"
          data-testid="ins-grad-kind"
          options={[
            { value: 'linear', label: 'Linear', 'data-testid': 'ins-grad-kind-linear' },
            { value: 'radial', label: 'Radial', 'data-testid': 'ins-grad-kind-radial' },
          ]}
          onChange={(k) =>
            editField(clip.id, 'gradient.kind', 'Gradient kind', (c) => {
              if (c.gradient) c.gradient.kind = k;
            })
          }
        />
      </ParamRow>
      {g.kind === 'linear' && (
        <ParamRow label="Angle">
          <ScrubNumber
            value={g.angle}
            step={1}
            dragStep={0.5}
            precision={0}
            unit="°"
            defaultValue={90}
            aria-label="Gradient angle"
            data-testid="ins-grad-angle"
            onChange={(v) =>
              editField(clip.id, 'gradient.angle', 'Gradient angle', (c) => {
                if (c.gradient) c.gradient.angle = ((v % 360) + 360) % 360;
              })
            }
          />
        </ParamRow>
      )}
      <GradientStops clip={clip} />
    </Section>
  );
}
