// Keyframe lane: a mini timeline under the inspector spanning the selected
// clip. One row per animated param with draggable diamonds, marquee and
// multi-selection (store.selection.keyframes), delete / copy / paste, a
// right-click interpolation menu with a custom bezier editor, the playhead
// (click or drag the ruler to seek) and a graph view of one param's value
// curve with draggable keys and bezier handles.

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useEditor, useSequence } from '../../../state/store';
import type { Clip, Ease, Keyframe, KeyframeMap } from '../../../state/types';
import { applyEase, KEY_TOLERANCE } from '../../../engine/keyframes';
import { transport } from '../../../engine/playback/transport';
import { isMac } from '../actions';
import { editClip, IconButton, ScrubNumber, Segmented } from './controls';
import { II } from './icons';
import {
  copySelectedKeys,
  deleteKeyRefs,
  hasKeyClipboard,
  pasteKeysAtPlayhead,
  selectAllKeys,
  setEase,
  setKeySelection,
  type KeyRef,
} from './keyframeActions';
import { seekKeyframe, toggleKeyframeAtPlayhead } from './controls';
import { easeControlPoints, moveKeys, snapLocal, valueRange, type Bez } from './keyframeOps';
import { paramInfo } from './paths';
import { clamp, formatNumber } from './util';

// ---------------------------------------------------------------------------
// Prefs
// ---------------------------------------------------------------------------

type LaneView = 'lanes' | 'graph';
interface LanePrefs {
  open: boolean;
  height: number;
  view: LaneView;
}
const PREF_KEY = 'delta.ins.lane';

function loadPrefs(): LanePrefs {
  const def: LanePrefs = { open: true, height: 150, view: 'lanes' };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') };
  } catch {
    return def;
  }
}
function savePrefs(p: LanePrefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAD = 8;
const ROW_H = 20;
const RULER_H = 18;

const GROUP_ORDER = ['text', 'shape', 'transform', 'crop', 'masks', 'time', 'effects', 'grade', 'audio'];
function orderPaths(paths: string[]): string[] {
  const rank = (p: string) => {
    const i = GROUP_ORDER.indexOf(p.split('.')[0]);
    return i < 0 ? 99 : i;
  };
  return [...paths].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

const sameKey = (a: { path: string; t: number }, b: { path: string; t: number }) => a.path === b.path && Math.abs(a.t - b.t) <= KEY_TOLERANCE;

function tickStep(pxPerSec: number): number {
  for (const s of [1 / 30, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) if (s * pxPerSec >= 46) return s;
  return 1200;
}

function fmtSec(t: number): string {
  if (t >= 60) {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${String(Math.round(s)).padStart(2, '0')}`;
  }
  return Number.isInteger(Math.round(t * 1000) / 1000) ? `${Math.round(t)}s` : `${(Math.round(t * 100) / 100).toString()}s`;
}

interface Geom {
  width: number;
  duration: number;
  x: (t: number) => number;
  t: (x: number) => number;
  pxPerSec: number;
}

function makeGeom(width: number, duration: number): Geom {
  const span = Math.max(1, width - PAD * 2);
  const d = Math.max(1e-6, duration);
  return { width, duration, x: (t) => PAD + (t / d) * span, t: (x) => clamp(((x - PAD) / span) * d, 0, d), pxPerSec: span / d };
}

interface DragState {
  startX: number;
  startY: number;
  anchorT: number;
  snapshot: KeyframeMap;
  sel: KeyRef[];
  pxPerSec: number;
  /** graph view: value units per pixel (upwards) and the graphed path */
  valuePerPx?: number;
  graphPath?: string;
  moved: boolean;
  coalesce: string;
}

/** Shared keyframe drag: moves the selection in time (snapped to frames unless Alt) and, in the graph, in value. */
function useKeyDrag(clip: Clip) {
  const fps = useSequence().fps;
  const drag = useRef<DragState | null>(null);
  const begin = (e: ReactPointerEvent, anchorT: number, sel: KeyRef[], pxPerSec: number, graph?: { path: string; valuePerPx: number }) => {
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      anchorT,
      snapshot: clip.keyframes,
      sel,
      pxPerSec,
      valuePerPx: graph?.valuePerPx,
      graphPath: graph?.path,
      moved: false,
      coalesce: `ins:kfdrag:${clip.id}:${Date.now()}`,
    };
  };
  const move = (e: ReactPointerEvent | PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    let dx = e.clientX - d.startX;
    let dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    if (d.graphPath && e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    let dt = dx / d.pxPerSec;
    if (!e.altKey) dt = snapLocal(d.anchorT + dt, clip.start, fps) - d.anchorT;
    const ts = d.sel.map((s) => s.t);
    dt = clamp(dt, -Math.min(...ts), clip.duration - Math.max(...ts));
    const dv = d.valuePerPx ? -dy * d.valuePerPx : 0;
    const groups = new Map<string, number[]>();
    for (const s of d.sel) groups.set(s.path, [...(groups.get(s.path) ?? []), s.t]);
    editClip(
      clip.id,
      dv ? 'Move keyframes' : d.sel.length === 1 ? 'Move keyframe' : 'Move keyframes',
      (c) => {
        for (const [path, times] of groups) {
          const base = d.snapshot[path];
          if (base) c.keyframes[path] = moveKeys(base, times, dt, path === d.graphPath ? dv : 0, 0, c.duration);
        }
      },
      { coalesceKey: d.coalesce },
    );
    setKeySelection(d.sel.map((s) => ({ ...s, t: clamp(s.t + dt, 0, clip.duration) })));
  };
  const end = () => {
    const moved = drag.current?.moved ?? false;
    drag.current = null;
    return moved;
  };
  return { begin, move, end, active: () => drag.current !== null };
}

// ---------------------------------------------------------------------------
// Playhead + ruler
// ---------------------------------------------------------------------------

function LanePlayhead({ clip, geom, top }: { clip: Clip; geom: Geom; top: number }) {
  const local = useEditor((s) => s.playhead - clip.start);
  if (local < -1e-6 || local > clip.duration + 1e-6 || geom.width <= 0) return null;
  return <div className="ins-lane__playhead" style={{ left: geom.x(local), top }} data-testid="ins-lane-playhead" />;
}

function Ruler({ clip, geom }: { clip: Clip; geom: Geom }) {
  const scrubbing = useRef(false);
  const seekAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    transport.seek(clip.start + geom.t(e.clientX - r.left));
  };
  const step = tickStep(geom.pxPerSec);
  const ticks: number[] = [];
  if (geom.width > 0) for (let t = 0; t <= clip.duration + 1e-6 && ticks.length < 400; t += step) ticks.push(t);
  return (
    <div
      className="ins-lane__ruler"
      data-testid="ins-lane-ruler"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        scrubbing.current = true;
        seekAt(e);
      }}
      onPointerMove={(e) => scrubbing.current && seekAt(e)}
      onPointerUp={() => (scrubbing.current = false)}
    >
      {ticks.map((t) => (
        <span key={t} className="ins-lane__tick" style={{ left: geom.x(t) }}>
          {fmtSec(t)}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lanes view
// ---------------------------------------------------------------------------

function easeClass(ease: Ease) {
  return ease === 'hold' ? 'ins-key--hold' : ease === 'linear' ? '' : 'ins-key--eased';
}

function LanesView({ clip, paths, sel, onContext }: { clip: Clip; paths: string[]; sel: KeyRef[]; onContext: (e: ReactMouseEvent, key: KeyRef) => void }) {
  const [areaRef, size] = useElementSize<HTMLDivElement>();
  const geom = useMemo(() => makeGeom(size.width, clip.duration), [size.width, clip.duration]);
  const kd = useKeyDrag(clip);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const area = useRef<{ x: number; y: number; additive: boolean; base: KeyRef[]; moved: boolean } | null>(null);

  const isSel = (path: string, t: number) => sel.some((s) => sameKey(s, { path, t }));

  const onKeyDown = (e: ReactPointerEvent<HTMLDivElement>, path: string, k: Keyframe) => {
    e.stopPropagation();
    if (e.button === 2) return;
    (e.currentTarget.closest('[tabindex]') as HTMLElement | null)?.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    const ref: KeyRef = { clipId: clip.id, path, t: k.t };
    let next = sel;
    if (e.shiftKey || e.metaKey || e.ctrlKey) next = isSel(path, k.t) ? sel.filter((s) => !sameKey(s, ref)) : [...sel, ref];
    else if (!isSel(path, k.t)) next = [ref];
    setKeySelection(next);
    if (next.some((s) => sameKey(s, ref))) kd.begin(e, k.t, next, geom.pxPerSec);
  };

  const rowTop = (i: number) => RULER_H + i * ROW_H;

  const onAreaDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    (e.currentTarget.closest('[tabindex]') as HTMLElement | null)?.focus();
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    area.current = { x: e.clientX - r.left, y: e.clientY - r.top, additive: e.shiftKey || e.metaKey || e.ctrlKey, base: sel, moved: false };
  };
  const onAreaMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const a = area.current;
    if (!a) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (!a.moved && Math.hypot(x - a.x, y - a.y) < 3) return;
    a.moved = true;
    const m = { x0: Math.min(a.x, x), y0: Math.min(a.y, y), x1: Math.max(a.x, x), y1: Math.max(a.y, y) };
    setMarquee(m);
    const hits: KeyRef[] = [];
    paths.forEach((path, i) => {
      const cy = rowTop(i) + ROW_H / 2;
      if (cy < m.y0 || cy > m.y1) return;
      for (const k of clip.keyframes[path] ?? []) {
        const kx = geom.x(k.t);
        if (kx >= m.x0 && kx <= m.x1) hits.push({ clipId: clip.id, path, t: k.t });
      }
    });
    setKeySelection(a.additive ? [...a.base.filter((b) => !hits.some((h) => sameKey(h, b))), ...hits] : hits);
  };
  const onAreaUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const a = area.current;
    area.current = null;
    setMarquee(null);
    if (!a || a.moved) return;
    if (!a.additive) setKeySelection([]);
    const r = e.currentTarget.getBoundingClientRect();
    transport.seek(clip.start + geom.t(e.clientX - r.left));
  };

  return (
    <div className="ins-lanes">
      <div className="ins-lanes__names">
        <div className="ins-lanes__corner" style={{ height: RULER_H }} />
        {paths.map((p) => (
          <button
            key={p}
            type="button"
            className="ins-lanes__name"
            style={{ height: ROW_H }}
            title={`${paramInfo(p, clip).label}: click to select its keyframes`}
            data-testid={`ins-lane-name-${p}`}
            onClick={(e) => {
              const keys = (clip.keyframes[p] ?? []).map((k) => ({ clipId: clip.id, path: p, t: k.t }));
              setKeySelection(e.shiftKey ? [...sel.filter((s) => s.path !== p), ...keys] : keys);
            }}
          >
            {paramInfo(p, clip).label}
          </button>
        ))}
      </div>
      <div
        ref={areaRef}
        className="ins-lanes__area"
        style={{ height: RULER_H + paths.length * ROW_H + 6 }}
        data-testid="ins-lane-area"
        onPointerDown={onAreaDown} onPointerMove={onAreaMove} onPointerUp={onAreaUp} onPointerCancel={onAreaUp}>
        <Ruler clip={clip} geom={geom} />
        {paths.map((path, i) => {
          const list = clip.keyframes[path] ?? [];
          return (
            <div key={path} className="ins-lanes__row" style={{ top: rowTop(i), height: ROW_H }}>
              {list.length > 1 && <div className="ins-lanes__span" style={{ left: geom.x(list[0].t), width: Math.max(0, geom.x(list[list.length - 1].t) - geom.x(list[0].t)) }} />}
              {geom.width > 0 &&
                list.map((k, ki) => (
                  <div
                    key={`${ki}:${k.t}`}
                    role="button"
                    aria-label={`${paramInfo(path, clip).label} keyframe at ${fmtSec(k.t)}`}
                    aria-pressed={isSel(path, k.t)}
                    className={`ins-key ${easeClass(k.ease)} ${isSel(path, k.t) ? 'ins-key--sel' : ''}`}
                    style={{ left: geom.x(k.t) }}
                    data-testid={`ins-lane-key-${path}-${ki}`}
                    title={`${fmtSec(k.t)} · ${formatNumber(k.v * paramInfo(path, clip).scale, paramInfo(path, clip).decimals)}${paramInfo(path, clip).unit}`}
                    onPointerDown={(e) => onKeyDown(e, path, k)}
                    onPointerMove={(e) => kd.move(e)}
                    onPointerUp={() => kd.end()}
                    onPointerCancel={() => kd.end()}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      transport.seek(clip.start + k.t);
                    }}
                    onContextMenu={(e) => onContext(e, { clipId: clip.id, path, t: k.t })}
                  />
                ))}
            </div>
          );
        })}
        <LanePlayhead clip={clip} geom={geom} top={0} />
        {marquee && <div className="ins-lanes__marquee" style={{ left: marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0 }} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graph view
// ---------------------------------------------------------------------------

function curvePath(keys: Keyframe[], x: (t: number) => number, y: (v: number) => number, duration: number): string {
  if (!keys.length) return '';
  const parts: string[] = [`M${x(0).toFixed(2)},${y(keys[0].v).toFixed(2)}`, `L${x(keys[0].t).toFixed(2)},${y(keys[0].v).toFixed(2)}`];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (a.ease === 'hold') {
      parts.push(`L${x(b.t).toFixed(2)},${y(a.v).toFixed(2)}`, `L${x(b.t).toFixed(2)},${y(b.v).toFixed(2)}`);
      continue;
    }
    const n = a.ease === 'linear' ? 1 : Math.max(8, Math.min(64, Math.round((x(b.t) - x(a.t)) / 3)));
    for (let j = 1; j <= n; j++) {
      const p = j / n;
      const v = a.v + (b.v - a.v) * applyEase(a.ease, p, a.bez as Bez | undefined);
      parts.push(`L${x(a.t + (b.t - a.t) * p).toFixed(2)},${y(v).toFixed(2)}`);
    }
  }
  const last = keys[keys.length - 1];
  parts.push(`L${x(duration).toFixed(2)},${y(last.v).toFixed(2)}`);
  return parts.join(' ');
}

function GraphView({
  clip,
  path,
  paths,
  onPick,
  sel,
  onContext,
}: {
  clip: Clip;
  path: string;
  paths: string[];
  onPick: (p: string) => void;
  sel: KeyRef[];
  onContext: (e: ReactMouseEvent, key: KeyRef) => void;
}) {
  const [areaRef, size] = useElementSize<HTMLDivElement>();
  const geom = useMemo(() => makeGeom(size.width, clip.duration), [size.width, clip.duration]);
  const keys = clip.keyframes[path] ?? [];
  const info = paramInfo(path, clip);
  const kd = useKeyDrag(clip);
  const frozen = useRef<{ min: number; max: number } | null>(null);
  const handleDrag = useRef<{ index: number; which: 1 | 2; coalesce: string } | null>(null);

  const samples: number[] = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (a.ease === 'bezier') for (let j = 1; j < 16; j++) samples.push(a.v + (b.v - a.v) * applyEase('bezier', j / 16, a.bez as Bez | undefined));
  }
  const live = valueRange(keys, samples);
  const range = frozen.current ?? live;
  const top = RULER_H + 8;
  const plotH = Math.max(20, size.height - top - 8);
  const y = (v: number) => top + (1 - (v - range.min) / (range.max - range.min)) * plotH;
  const vAt = (py: number) => range.min + (1 - (py - top) / plotH) * (range.max - range.min);
  const isSel = (t: number) => sel.some((s) => sameKey(s, { path, t }));
  const fmt = (v: number) => `${formatNumber(v * info.scale, info.decimals)}${info.unit}`;

  const onDotDown = (e: ReactPointerEvent<SVGElement>, k: Keyframe) => {
    e.stopPropagation();
    if (e.button === 2) return;
    (e.currentTarget.closest('[tabindex]') as HTMLElement | null)?.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    const ref: KeyRef = { clipId: clip.id, path, t: k.t };
    const mine = sel.filter((s) => s.path === path);
    let next = mine;
    if (e.shiftKey || e.metaKey || e.ctrlKey) next = isSel(k.t) ? mine.filter((s) => !sameKey(s, ref)) : [...mine, ref];
    else if (!isSel(k.t)) next = [ref];
    setKeySelection(next);
    frozen.current = live;
    if (next.some((s) => sameKey(s, ref))) kd.begin(e, k.t, next, geom.pxPerSec, { path, valuePerPx: (live.max - live.min) / plotH });
  };
  const endDot = () => {
    kd.end();
    frozen.current = null;
  };

  // Bezier handles for segments touching a selected key.
  const handles: { index: number; which: 1 | 2; hx: number; hy: number; ax: number; ay: number }[] = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (!isSel(a.t) && !isSel(b.t)) continue;
    const cps = easeControlPoints(a.ease, a.bez as Bez | undefined);
    if (!cps || a.ease === 'linear' || Math.abs(b.v - a.v) < 1e-9) continue;
    const dt = b.t - a.t;
    const dv = b.v - a.v;
    handles.push({ index: i, which: 1, hx: geom.x(a.t + cps[0] * dt), hy: y(a.v + cps[1] * dv), ax: geom.x(a.t), ay: y(a.v) });
    handles.push({ index: i, which: 2, hx: geom.x(a.t + cps[2] * dt), hy: y(a.v + cps[3] * dv), ax: geom.x(b.t), ay: y(b.v) });
  }

  const onHandleDown = (e: ReactPointerEvent<SVGElement>, index: number, which: 1 | 2) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    frozen.current = live;
    handleDrag.current = { index, which, coalesce: `ins:kfbez:${clip.id}:${Date.now()}` };
  };
  const onHandleMove = (e: ReactPointerEvent<SVGElement>) => {
    const h = handleDrag.current;
    if (!h) return;
    const svg = (e.currentTarget as SVGElement).ownerSVGElement;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const a = keys[h.index];
    const b = keys[h.index + 1];
    if (!a || !b) return;
    const t = geom.t(e.clientX - r.left);
    const v = vAt(e.clientY - r.top);
    const u = clamp((t - a.t) / (b.t - a.t), 0, 1);
    const w = clamp((v - a.v) / (b.v - a.v), -2, 3);
    const cur = easeControlPoints(a.ease, a.bez as Bez | undefined) ?? [0.25, 0.1, 0.25, 1];
    const bez: Bez = h.which === 1 ? [u, w, cur[2], cur[3]] : [cur[0], cur[1], u, w];
    const r4 = bez.map((n) => Math.round(n * 1000) / 1000) as Bez;
    setEase('bezier', r4, { clipId: clip.id, keys: [{ path, t: a.t }] }, { coalesceKey: h.coalesce });
  };
  const onHandleUp = () => {
    handleDrag.current = null;
    frozen.current = null;
  };

  return (
    <div className="ins-lanes">
      <div className="ins-lanes__names">
        <div className="ins-lanes__corner" style={{ height: RULER_H }} />
        {paths.map((p) => (
          <button key={p} type="button" className={`ins-lanes__name ${p === path ? 'ins-lanes__name--on' : ''}`} style={{ height: ROW_H }} data-testid={`ins-graph-pick-${p}`} onClick={() => onPick(p)}>
            {paramInfo(p, clip).label}
          </button>
        ))}
      </div>
      <div
        ref={areaRef}
        className="ins-lanes__area ins-graph"
        data-testid="ins-graph"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          (e.currentTarget.closest('[tabindex]') as HTMLElement | null)?.focus();
          setKeySelection([]);
          const r = e.currentTarget.getBoundingClientRect();
          transport.seek(clip.start + geom.t(e.clientX - r.left));
        }}
      >
        <Ruler clip={clip} geom={geom} />
        {size.width > 0 && size.height > 0 && (
          <svg className="ins-graph__svg" width={size.width} height={size.height}>
            <line className="ins-graph__grid" x1={PAD} x2={size.width - PAD} y1={y(range.max)} y2={y(range.max)} />
            <line className="ins-graph__grid" x1={PAD} x2={size.width - PAD} y1={y(range.min)} y2={y(range.min)} />
            {range.min < 0 && range.max > 0 && <line className="ins-graph__zero" x1={PAD} x2={size.width - PAD} y1={y(0)} y2={y(0)} />}
            <text className="ins-graph__label" x={PAD + 2} y={y(range.max) + 11}>
              {fmt(range.max)}
            </text>
            <text className="ins-graph__label" x={PAD + 2} y={y(range.min) - 4}>
              {fmt(range.min)}
            </text>
            <path className="ins-graph__curve" d={curvePath(keys, geom.x, y, clip.duration)} data-testid="ins-graph-curve" />
            {handles.map((h) => (
              <g key={`${h.index}-${h.which}`}>
                <line className="ins-graph__arm" x1={h.ax} y1={h.ay} x2={h.hx} y2={h.hy} />
                <circle
                  className="ins-graph__handle"
                  cx={h.hx}
                  cy={h.hy}
                  r={4}
                  data-testid={`ins-graph-handle-${h.index}-${h.which}`}
                  onPointerDown={(e) => onHandleDown(e, h.index, h.which)}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={onHandleUp}
                />
              </g>
            ))}
            {keys.map((k, i) => (
              <rect
                key={`${i}:${k.t}`}
                className={`ins-graph__key ${isSel(k.t) ? 'ins-graph__key--sel' : ''}`}
                x={geom.x(k.t) - 4.5}
                y={y(k.v) - 4.5}
                width={9}
                height={9}
                transform={k.ease === 'hold' ? undefined : `rotate(45 ${geom.x(k.t)} ${y(k.v)})`}
                data-testid={`ins-graph-key-${i}`}
                onPointerDown={(e) => onDotDown(e, k)}
                onPointerMove={(e) => kd.move(e)}
                onPointerUp={endDot}
                onPointerCancel={endDot}
                onContextMenu={(e) => onContext(e, { clipId: clip.id, path, t: k.t })}
              >
                <title>{`${fmtSec(k.t)} · ${fmt(k.v)}`}</title>
              </rect>
            ))}
          </svg>
        )}
        <LanePlayhead clip={clip} geom={geom} top={0} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context menu and bezier editor
// ---------------------------------------------------------------------------

function Popover({ x, y, onClose, children, testid, width = 180 }: { x: number; y: number; onClose: () => void; children: ReactNode; testid: string; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
  }, [x, y]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className="ins-pop" style={{ left: pos.x, top: pos.y, minWidth: width }} data-testid={testid} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </div>,
    document.body,
  );
}

const EASE_ITEMS: { ease: Ease; label: string; key?: string }[] = [
  { ease: 'linear', label: 'Linear' },
  { ease: 'hold', label: 'Hold', key: isMac ? '⌘⌥H' : 'Ctrl+Alt+H' },
  { ease: 'easeIn', label: 'Ease in', key: isMac ? '⇧F9' : 'Shift+F9' },
  { ease: 'easeOut', label: 'Ease out', key: isMac ? '⌘⇧F9' : 'Ctrl+Shift+F9' },
  { ease: 'easeInOut', label: 'Ease in-out', key: 'F9' },
];

function EaseMenu({ x, y, keys, current, onClose, onCustom }: { x: number; y: number; keys: KeyRef[]; current: Ease | null; onClose: () => void; onCustom: () => void }) {
  const target = keys.length ? { clipId: keys[0].clipId, keys } : null;
  const item = (label: string, run: () => void, opts: { on?: boolean; key?: string; testid: string; disabled?: boolean }) => (
    <button
      type="button"
      className={`ins-pop__item ${opts.on ? 'ins-pop__item--on' : ''}`}
      disabled={opts.disabled}
      data-testid={opts.testid}
      onClick={() => {
        run();
        onClose();
      }}
    >
      <span className="ins-pop__check">{opts.on ? <II.Diamond size={9} filled /> : null}</span>
      <span className="ins-pop__label">{label}</span>
      {opts.key && <span className="ins-pop__key">{opts.key}</span>}
    </button>
  );
  return (
    <Popover x={x} y={y} onClose={onClose} testid="ins-ease-menu">
      <div className="ins-pop__title">Interpolation</div>
      {EASE_ITEMS.map((it) => item(it.label, () => setEase(it.ease, undefined, target), { on: current === it.ease, key: it.key, testid: `ins-ease-${it.ease}` }))}
      <button type="button" className={`ins-pop__item ${current === 'bezier' ? 'ins-pop__item--on' : ''}`} data-testid="ins-ease-bezier" onClick={onCustom}>
        <span className="ins-pop__check">{current === 'bezier' ? <II.Diamond size={9} filled /> : null}</span>
        <span className="ins-pop__label">Custom bezier…</span>
      </button>
      <div className="ins-pop__sep" />
      {item('Copy', () => copySelectedKeys(), { testid: 'ins-key-copy', key: isMac ? '⌘C' : 'Ctrl+C' })}
      {item('Paste at playhead', () => pasteKeysAtPlayhead(), { testid: 'ins-key-paste', key: isMac ? '⌘V' : 'Ctrl+V', disabled: !hasKeyClipboard() })}
      {item('Delete', () => target && deleteKeyRefs(target.clipId, target.keys), { testid: 'ins-key-delete', key: isMac ? '⌫' : 'Del' })}
    </Popover>
  );
}

const BEZ_PRESETS: { label: string; bez: Bez }[] = [
  { label: 'Ease', bez: [0.25, 0.1, 0.25, 1] },
  { label: 'In', bez: [0.42, 0, 1, 1] },
  { label: 'Out', bez: [0, 0, 0.58, 1] },
  { label: 'In-out', bez: [0.42, 0, 0.58, 1] },
  { label: 'Expo', bez: [0.16, 1, 0.3, 1] },
  { label: 'Back', bez: [0.34, 1.56, 0.64, 1] },
];

/** Small cubic-bezier curve editor (x in 0..1, y free) applied live to the target keys. */
export function CurveEditor({ x, y, initial, keys, onClose }: { x: number; y: number; initial: Bez; keys: KeyRef[]; onClose: () => void }) {
  const [bez, setBez] = useState<Bez>(initial);
  const coalesce = useRef(`ins:kfcurve:${Date.now()}`);
  const S = 140;
  const P = 14;
  const Y0 = -0.35;
  const Y1 = 1.35;
  const H = S * (Y1 - Y0);
  const px = (u: number) => P + u * S;
  const py = (v: number) => P + ((Y1 - v) / (Y1 - Y0)) * H;
  const drag = useRef<1 | 2 | null>(null);
  const apply = (b: Bez) => {
    setBez(b);
    if (keys.length) setEase('bezier', b, { clipId: keys[0].clipId, keys }, { coalesceKey: coalesce.current });
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const u = clamp((e.clientX - r.left - P) / S, 0, 1);
    const v = clamp(Y1 - ((e.clientY - r.top - P) / H) * (Y1 - Y0), Y0, Y1);
    const rr = (n: number) => Math.round(n * 100) / 100;
    apply(drag.current === 1 ? [rr(u), rr(v), bez[2], bez[3]] : [bez[0], bez[1], rr(u), rr(v)]);
  };
  const field = (i: 0 | 1 | 2 | 3, label: string) => (
    <label className="ins-curve__field">
      <span>{label}</span>
      <ScrubNumber
        value={bez[i]}
        step={0.01}
        min={i % 2 === 0 ? 0 : -2}
        max={i % 2 === 0 ? 1 : 3}
        precision={2}
        aria-label={label}
        data-testid={`ins-curve-${label.toLowerCase()}`}
        onChange={(v) => {
          const n = [...bez] as Bez;
          n[i] = v;
          apply(n);
        }}
      />
    </label>
  );
  return (
    <Popover x={x} y={y} onClose={onClose} testid="ins-curve-editor" width={P * 2 + S + 16}>
      <div className="ins-pop__title">Custom bezier</div>
      <svg
        className="ins-curve"
        width={P * 2 + S}
        height={P * 2 + H}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <rect className="ins-curve__frame" x={px(0)} y={py(1)} width={S} height={py(0) - py(1)} />
        <line className="ins-curve__diag" x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} />
        <line className="ins-curve__arm" x1={px(0)} y1={py(0)} x2={px(bez[0])} y2={py(bez[1])} />
        <line className="ins-curve__arm" x1={px(1)} y1={py(1)} x2={px(bez[2])} y2={py(bez[3])} />
        <path className="ins-curve__path" d={`M${px(0)},${py(0)} C${px(bez[0])},${py(bez[1])} ${px(bez[2])},${py(bez[3])} ${px(1)},${py(1)}`} />
        {([1, 2] as const).map((h) => (
          <circle
            key={h}
            className="ins-curve__handle"
            cx={px(h === 1 ? bez[0] : bez[2])}
            cy={py(h === 1 ? bez[1] : bez[3])}
            r={5}
            data-testid={`ins-curve-handle-${h}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
              drag.current = h;
            }}
          />
        ))}
      </svg>
      <div className="ins-curve__fields">
        {field(0, 'X1')}
        {field(1, 'Y1')}
        {field(2, 'X2')}
        {field(3, 'Y2')}
      </div>
      <div className="ins-curve__presets">
        {BEZ_PRESETS.map((p) => (
          <button key={p.label} type="button" className="ins-chip" onClick={() => apply(p.bez)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="ins-curve__foot">
        <button type="button" className="ins-btn ins-btn--primary" data-testid="ins-curve-done" onClick={onClose}>
          Done
        </button>
      </div>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// The lane
// ---------------------------------------------------------------------------

export function KeyframeLane({ clip }: { clip: Clip }) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const update = (patch: Partial<LanePrefs>) =>
    setPrefs((p) => {
      const n = { ...p, ...patch };
      savePrefs(n);
      return n;
    });
  const fps = useSequence().fps;
  const allSel = useEditor((s) => s.selection.keyframes);
  const sel = useMemo(() => allSel.filter((k) => k.clipId === clip.id), [allSel, clip.id]);
  const paths = useMemo(() => orderPaths(Object.keys(clip.keyframes).filter((p) => clip.keyframes[p]?.length)), [clip.keyframes]);
  const [graphPath, setGraphPath] = useState<string | null>(null);
  const activePath = graphPath && paths.includes(graphPath) ? graphPath : sel[0] && paths.includes(sel[0].path) ? sel[0].path : (paths[0] ?? null);
  const [menu, setMenu] = useState<{ x: number; y: number; keys: KeyRef[] } | null>(null);
  const [curve, setCurve] = useState<{ x: number; y: number; keys: KeyRef[]; bez: Bez } | null>(null);
  const resize = useRef<{ y: number; h: number } | null>(null);
  const total = paths.reduce((n, p) => n + (clip.keyframes[p]?.length ?? 0), 0);

  const onContext = (e: ReactMouseEvent, key: KeyRef) => {
    e.preventDefault();
    e.stopPropagation();
    let keys = sel;
    if (!sel.some((s) => sameKey(s, key))) {
      keys = [key];
      setKeySelection(keys);
    }
    setMenu({ x: e.clientX, y: e.clientY, keys });
  };
  const currentEase = (keys: KeyRef[]): Ease | null => {
    const eases = keys.map((k) => clip.keyframes[k.path]?.find((x) => Math.abs(x.t - k.t) <= KEY_TOLERANCE)?.ease);
    return eases.length && eases.every((e) => e === eases[0]) ? (eases[0] ?? null) : null;
  };

  const nudge = (frames: number) => {
    if (!sel.length) return;
    const frame = 1 / fps;
    const ts = sel.map((s) => s.t);
    const dt = clamp(frames * frame, -Math.min(...ts), clip.duration - Math.max(...ts));
    if (!dt) return;
    const groups = new Map<string, number[]>();
    for (const s of sel) groups.set(s.path, [...(groups.get(s.path) ?? []), s.t]);
    editClip(
      clip.id,
      'Nudge keyframes',
      (c) => {
        for (const [p, times] of groups) if (c.keyframes[p]) c.keyframes[p] = moveKeys(c.keyframes[p], times, dt, 0, 0, c.duration);
      },
      { coalesceKey: `ins:kfnudge:${clip.id}` },
    );
    setKeySelection(sel.map((s) => ({ ...s, t: clamp(s.t + dt, 0, clip.duration) })));
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    let handled = true;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) deleteKeyRefs(clip.id, sel);
    else if (mod && e.key.toLowerCase() === 'c' && sel.length) copySelectedKeys();
    else if (mod && e.key.toLowerCase() === 'v' && hasKeyClipboard()) pasteKeysAtPlayhead();
    else if (mod && e.key.toLowerCase() === 'a') selectAllKeys(clip.id);
    else if (e.key === 'Escape' && sel.length) setKeySelection([]);
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && sel.length && !mod) nudge((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div
      className={`ins-lane ${prefs.open && paths.length ? '' : 'ins-lane--closed'}`}
      style={prefs.open && paths.length ? { height: prefs.height } : undefined}
      data-testid="ins-lane"
    >
      {prefs.open && paths.length > 0 && (
        <div
          className="ins-lane__resize"
          title="Drag to resize"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            resize.current = { y: e.clientY, h: prefs.height };
          }}
          onPointerMove={(e) => {
            if (!resize.current) return;
            setPrefs((p) => ({ ...p, height: clamp(resize.current!.h - (e.clientY - resize.current!.y), 90, 520) }));
          }}
          onPointerUp={() => {
            resize.current = null;
            setPrefs((p) => {
              savePrefs(p);
              return p;
            });
          }}
        />
      )}
      <div className="ins-lane__head">
        <button type="button" className="ins-lane__toggle" aria-expanded={prefs.open} data-testid="ins-lane-toggle" onClick={() => update({ open: !prefs.open })}>
          <II.Chevron size={12} className="ins-section__chev" />
          <span>Keyframes</span>
          {total > 0 ? <span className="ins-section__badge">{total}</span> : <span className="ins-lane__none">None · use a stopwatch to animate</span>}
        </button>
        {prefs.open && paths.length > 0 && (
          <div className="ins-lane__tools">
            <IconButton title="Previous keyframe (Alt+[)" data-testid="ins-lane-prev" onClick={() => seekKeyframe(clip.id, -1)}>
              <II.TriLeft size={11} />
            </IconButton>
            <IconButton
              title="Add or remove keyframes at the playhead"
              disabled={!activePath}
              data-testid="ins-lane-add"
              onClick={() => activePath && toggleKeyframeAtPlayhead(clip.id, paths.length ? paths : activePath)}
            >
              <II.Diamond size={11} />
            </IconButton>
            <IconButton title="Next keyframe (Alt+])" data-testid="ins-lane-next" onClick={() => seekKeyframe(clip.id, 1)}>
              <II.TriRight size={11} />
            </IconButton>
            <span className="ins-lane__sep" />
            <IconButton title="Copy keyframes" disabled={!sel.length} data-testid="ins-lane-copy" onClick={() => copySelectedKeys()}>
              <II.Copy size={13} />
            </IconButton>
            <IconButton title="Paste keyframes at the playhead" disabled={!hasKeyClipboard()} data-testid="ins-lane-paste" onClick={() => pasteKeysAtPlayhead()}>
              <II.Paste size={13} />
            </IconButton>
            <IconButton title="Delete selected keyframes" disabled={!sel.length} data-testid="ins-lane-delete" onClick={() => deleteKeyRefs(clip.id, sel)}>
              <II.Trash size={13} />
            </IconButton>
            <span className="ins-lane__sep" />
            <Segmented
              value={prefs.view}
              aria-label="Keyframe view"
              data-testid="ins-lane-view"
              options={[
                { value: 'lanes', icon: <II.Lanes size={13} />, title: 'Keyframe lanes', 'data-testid': 'ins-lane-view-lanes' },
                { value: 'graph', icon: <II.Graph size={13} />, title: 'Value graph', 'data-testid': 'ins-lane-view-graph' },
              ]}
              onChange={(view) => update({ view })}
            />
          </div>
        )}
      </div>
      {prefs.open && paths.length > 0 && (
        <div className="ins-lane__body" tabIndex={0} onKeyDown={onKeyDown} data-testid="ins-lane-body" aria-label="Keyframes">
          {prefs.view === 'graph' && activePath ? (
            <GraphView clip={clip} path={activePath} paths={paths} onPick={setGraphPath} sel={sel} onContext={onContext} />
          ) : (
            <LanesView clip={clip} paths={paths} sel={sel} onContext={onContext} />
          )}
        </div>
      )}
      {menu && (
        <EaseMenu
          x={menu.x}
          y={menu.y}
          keys={menu.keys}
          current={currentEase(menu.keys)}
          onClose={() => setMenu(null)}
          onCustom={() => {
            const k = menu.keys[0];
            const kf = clip.keyframes[k.path]?.find((x) => Math.abs(x.t - k.t) <= KEY_TOLERANCE);
            const bez = (kf && easeControlPoints(kf.ease === 'hold' || kf.ease === 'linear' ? 'easeInOut' : kf.ease, kf.bez as Bez | undefined)) ?? [0.42, 0, 0.58, 1];
            setCurve({ x: menu.x, y: menu.y, keys: menu.keys, bez });
            setMenu(null);
          }}
        />
      )}
      {curve && <CurveEditor x={curve.x} y={curve.y} initial={curve.bez} keys={curve.keys} onClose={() => setCurve(null)} />}
    </div>
  );
}
