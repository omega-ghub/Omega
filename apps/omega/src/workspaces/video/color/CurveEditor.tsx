// Custom curves (master / R / G / B): click to add a point, drag to move,
// double-click or drag out of the box to delete. Monotone cubic spline,
// the live histogram behind it, and a reset per channel.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { subscribeScopes, type ScopeFeedFrame } from '../../../engine/scopes/feed';
import type { HistogramCurves } from '../../../engine/scopes/scopes';
import type { Clip, CurvePoint, Curves } from '../../../state/types';
import { compileCurve, isIdentityCurve, normalizeCurve, withEndpoints } from './curves';
import { editGradeClip } from './grade';
import { CI } from './icons';

type Channel = keyof Curves;
const CHANNELS: { id: Channel; label: string; color: string }[] = [
  { id: 'master', label: 'Master', color: '#e8e8ee' },
  { id: 'r', label: 'R', color: '#ff6b6b' },
  { id: 'g', label: 'G', color: '#5be08a' },
  { id: 'b', label: 'B', color: '#6f95ff' },
];
const HIT_PX = 9;
const OUT = 0.07;

export function CurveEditor({ clip }: { clip: Clip }) {
  const [channel, setChannel] = useState<Channel>(() => {
    try {
      const v = localStorage.getItem('delta.color.curveTab') as Channel | null;
      return v && CHANNELS.some((c) => c.id === v) ? v : 'master';
    } catch {
      return 'master';
    }
  });
  const pickChannel = (c: Channel) => {
    setChannel(c);
    try {
      localStorage.setItem('delta.color.curveTab', c);
    } catch {
      /* ignore */
    }
  };
  const hist = useHistogram();
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(240);
  const [drag, setDrag] = useState<{ index: number; out: boolean } | null>(null);
  const dragRef = useRef<{ index: number; out: boolean; pts: CurvePoint[] } | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setSize(Math.max(120, Math.round(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stored = clip.grade.curves[channel];
  const pts = dragRef.current?.pts ?? withEndpoints(stored);
  const key = `cl:${clip.id}:curve:${channel}`;
  const chInfo = CHANNELS.find((c) => c.id === channel)!;

  const commit = (list: CurvePoint[], label = 'Adjust curve') => {
    const next = normalizeCurve(list);
    editGradeClip(
      clip.id,
      label,
      (c) => {
        c.grade.curves[channel] = next;
      },
      key,
    );
  };

  const toUnit = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height };
  };

  const hitIndex = (x: number, y: number, list: CurvePoint[]) => {
    let best = -1;
    let bd = HIT_PX / size;
    list.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const { x, y } = toUnit(e);
    const list = withEndpoints(stored).map((p) => ({ ...p }));
    let index = hitIndex(x, y, list);
    if (index < 0) {
      // add a point: at the pointer, on the curve if the click was close to it
      const cx = Math.min(0.99, Math.max(0.01, x));
      const onCurve = compileCurve(list)(cx);
      const cy = Math.abs(onCurve - y) < 0.06 ? onCurve : Math.min(1, Math.max(0, y));
      if (list.some((p) => Math.abs(p.x - cx) < 0.012)) return;
      list.push({ x: cx, y: cy });
      list.sort((a, b) => a.x - b.x);
      index = list.findIndex((p) => p.x === cx);
      commit(list, 'Add curve point');
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { index, out: false, pts: list };
    setDrag({ index, out: false });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const { x, y } = toUnit(e);
    const list = d.pts.map((p) => ({ ...p }));
    const i = d.index;
    const last = list.length - 1;
    const endpoint = i === 0 || i === last;
    const out = !endpoint && (x < -OUT || x > 1 + OUT || y < -OUT || y > 1 + OUT);
    if (endpoint) {
      list[i] = { x: list[i].x, y: Math.min(1, Math.max(0, y)) };
    } else {
      const lo = list[i - 1].x + 0.01;
      const hi = list[i + 1].x - 0.01;
      list[i] = { x: Math.min(hi, Math.max(lo, x)), y: Math.min(1, Math.max(0, y)) };
    }
    d.pts = list;
    d.out = out;
    setDrag({ index: i, out });
    if (!out) commit(list);
    else commit(list.filter((_, k) => k !== i), 'Remove curve point');
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d?.out) commit(d.pts.filter((_, k) => k !== d.index), 'Remove curve point');
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const { x, y } = toUnit(e);
    const list = withEndpoints(stored).map((p) => ({ ...p }));
    const i = hitIndex(x, y, list);
    if (i < 0) return;
    if (i === 0) list[0] = { x: 0, y: 0 };
    else if (i === list.length - 1) list[i] = { x: 1, y: 1 };
    else list.splice(i, 1);
    commit(list, 'Remove curve point');
  };

  const resetChannel = (c: Channel) =>
    editGradeClip(clip.id, `Reset ${c === 'master' ? 'master' : c.toUpperCase()} curve`, (cl) => {
      cl.grade.curves[c] = [];
    });
  const resetAll = () =>
    editGradeClip(clip.id, 'Reset curves', (cl) => {
      cl.grade.curves = { master: [], r: [], g: [], b: [] };
    });

  // geometry (SVG in px so strokes stay hairline and points round)
  const S = size;
  const path = useMemo(() => curvePath(pts, S), [pts, S]);
  const others = CHANNELS.filter((c) => c.id !== channel && !isIdentityCurve(clip.grade.curves[c.id]));
  const histCurve = hist ? (channel === 'master' ? hist.y : hist[channel]) : null;
  const anyCurve = CHANNELS.some((c) => clip.grade.curves[c.id].length);

  return (
    <div className="cl-curves" data-testid="cl-curves">
      <div className="cl-curves__tabs" role="tablist">
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={channel === c.id}
            className={`cl-curves__tab ${channel === c.id ? 'is-on' : ''}`}
            data-testid={`cl-curve-tab-${c.id}`}
            onClick={() => pickChannel(c.id)}
          >
            <span className="cl-curves__dot" style={{ background: c.color, opacity: clip.grade.curves[c.id].length ? 1 : 0.35 }} />
            {c.label}
          </button>
        ))}
        <span className="cl-spacer" />
        <button type="button" className="cl-icon-btn" title={`Reset ${chInfo.label} curve`} aria-label={`Reset ${chInfo.label} curve`} disabled={!stored.length} data-testid="cl-curve-reset" onClick={() => resetChannel(channel)}>
          <CI.Reset size={14} />
        </button>
        <button type="button" className="cl-chip" title="Reset all four curves" disabled={!anyCurve} data-testid="cl-curve-reset-all" onClick={resetAll}>
          All
        </button>
      </div>
      <div
        ref={boxRef}
        className={`cl-curves__box ${drag ? 'is-dragging' : ''}`}
        style={{ height: S }}
        data-testid="cl-curve-editor"
        data-channel={channel}
        data-points={stored.length}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        title="Click to add a point · Drag to move · Double-click or drag out to delete"
      >
        <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} className="cl-curves__svg">
          {histCurve && <path d={histPath(histCurve, S)} className="cl-curves__hist" style={{ fill: channel === 'master' ? undefined : chInfo.color }} />}
          {[1, 2, 3].map((k) => (
            <g key={k} className="cl-curves__grid">
              <line x1={(k * S) / 4} y1={0} x2={(k * S) / 4} y2={S} />
              <line x1={0} y1={(k * S) / 4} x2={S} y2={(k * S) / 4} />
            </g>
          ))}
          <line x1={0} y1={S} x2={S} y2={0} className="cl-curves__diag" />
          {others.map((c) => (
            <path key={c.id} d={curvePath(withEndpoints(clip.grade.curves[c.id]), S)} className="cl-curves__other" style={{ stroke: c.color }} />
          ))}
          <path d={path} className="cl-curves__line" style={{ stroke: chInfo.color }} />
          {pts.map((p, i) => (
            <circle
              key={i}
              cx={p.x * S}
              cy={(1 - p.y) * S}
              r={drag?.index === i ? 5 : 4}
              className={`cl-curves__pt ${drag?.index === i ? 'is-active' : ''} ${drag?.index === i && drag.out ? 'is-out' : ''}`}
              style={{ stroke: chInfo.color }}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

function curvePath(pts: CurvePoint[], S: number): string {
  const f = compileCurve(pts);
  const n = 96;
  let d = '';
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    d += `${i ? 'L' : 'M'}${(x * S).toFixed(1)},${((1 - f(x)) * S).toFixed(1)}`;
  }
  return d;
}

function histPath(curve: Float32Array, S: number): string {
  const n = curve.length;
  let d = `M0,${S}`;
  for (let i = 0; i < n; i++) d += `L${((i / (n - 1)) * S).toFixed(1)},${((1 - curve[i] * 0.92) * S).toFixed(1)}`;
  return `${d}L${S},${S}Z`;
}

/** Live histogram of the program frame (shared scope feed). */
function useHistogram(): HistogramCurves | null {
  const [h, setH] = useState<HistogramCurves | null>(null);
  useEffect(() => subscribeScopes({ histogram: true }, (f: ScopeFeedFrame) => setH(f.result?.histogram ?? null)), []);
  return h;
}
