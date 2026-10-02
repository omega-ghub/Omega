// Direct manipulation in the program monitor for the selected visual clip:
// transform gizmo (move, scale, stretch, rotate, anchor), crop handles and
// mask handles (move, resize, rotate, feather). Values go through setParam at
// the clip-local playhead time, so animated params get keyframes. With an
// alternate format active, position and scale go to that format's override.
import { useMemo, useRef, useState } from 'react';
import { setParam } from '../../../engine/keyframes';
import {
  anchorPoint,
  apply,
  axisScaleFactors,
  boundsOf,
  dragRotation,
  invert,
  layerRect,
  maskLocal,
  maskMatrix,
  maskOutline,
  maskResize,
  moveAnchorTo,
  multiply,
  quad,
  snapMove,
  uniformScaleFactor,
  type Vec,
} from '../../../engine/playback/geometry';
import { croppedRect } from '../../../engine/playback/geometry';
import { getPlayer } from '../../../engine/playback/player';
import type { FrameGraph, LayerNode } from '../../../engine/render/graph';
import { useEditor } from '../../../state/store';
import type { Mask } from '../../../state/types';
import { activeSequence, findClip } from '../../../state/types';
import { findLayer, layerInfo, type LayerInfo } from './layers';
import { useViewerUi } from './uiState';

interface Props {
  graph: FrameGraph;
  /** CSS pixels per sequence pixel. */
  k: number;
  frame: React.RefObject<HTMLDivElement | null>;
}

type Drag =
  | { kind: 'move' }
  | { kind: 'scale'; free: boolean }
  | { kind: 'edgeX' }
  | { kind: 'edgeY' }
  | { kind: 'rotate' }
  | { kind: 'anchor' }
  | { kind: 'crop'; side: 'left' | 'right' | 'top' | 'bottom' }
  | { kind: 'maskMove'; mask: Mask }
  | { kind: 'maskSize'; mask: Mask; axis: 'x' | 'y' | 'both' }
  | { kind: 'maskRotate'; mask: Mask }
  | { kind: 'maskFeather'; mask: Mask };

const LABELS: Record<Drag['kind'], string> = {
  move: 'Move',
  scale: 'Scale',
  edgeX: 'Scale width',
  edgeY: 'Scale height',
  rotate: 'Rotate',
  anchor: 'Move anchor point',
  crop: 'Crop',
  maskMove: 'Move mask',
  maskSize: 'Resize mask',
  maskRotate: 'Rotate mask',
  maskFeather: 'Mask feather',
};

let gestureSeq = 0;
const CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];

function cursorFor(center: Vec, p: Vec): string {
  const a = (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI;
  return CURSORS[((Math.round(a / 45) % 4) + 4) % 4];
}

const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const pts = (list: Vec[]) => list.map((p) => `${p.x},${p.y}`).join(' ');

/** Writes params of one clip at the playhead (keyframe-aware), as one coalesced undo step per gesture. */
export function writeClipParams(clipId: string, values: Record<string, number>, label: string, coalesceKey: string): void {
  const t = getPlayer().time;
  useEditor.getState().mutate(
    label,
    (d) => {
      const seq = activeSequence(d);
      const hit = findClip(seq, clipId);
      if (!hit) return;
      const clip = hit.clip;
      const local = Math.max(0, Math.min(t - clip.start, clip.duration));
      const fid = seq.activeFormatId;
      for (const [path, raw] of Object.entries(values)) {
        if (!Number.isFinite(raw)) continue;
        const v = Math.round(raw * 1e4) / 1e4;
        const m = /^transform\.(x|y|scale)$/.exec(path);
        if (fid && m && seq.formats.some((f) => f.id === fid)) {
          const o = (clip.formatOverrides ??= {});
          (o[fid] ??= {})[m[1] as 'x' | 'y' | 'scale'] = v;
          continue;
        }
        setParam(clip, path, local, v);
      }
    },
    { coalesceKey },
  );
}

export function Gizmo({ graph, k, frame }: Props) {
  const selection = useEditor((s) => s.selection.clipIds);
  const snapping = useEditor((s) => s.snapping);
  const cropMode = useViewerUi((s) => s.cropMode);
  const activeMask = useViewerUi((s) => s.activeMask);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const dragging = useRef(false);
  const W = graph.width;
  const H = graph.height;

  const target: LayerInfo | null = useMemo(() => {
    for (const id of selection) {
      const n: LayerNode | null = findLayer(graph, id);
      if (n && n.source && !n.adjustment) return layerInfo(n, W, H);
    }
    return null;
  }, [graph, selection, W, H]);

  if (!target) return null;
  const info = target;
  const { node, sw, sh } = info;
  const tf = node.transform;
  const px = 1 / Math.max(1e-6, k); // one CSS pixel in sequence units
  const hs = 9 * px; // handle size
  const corners = quad(info.m, info.box);
  const center = apply(info.m, { x: info.box.x + info.box.w / 2, y: info.box.y + info.box.h / 2 });
  const edges = [mid(corners[0], corners[1]), mid(corners[1], corners[2]), mid(corners[2], corners[3]), mid(corners[3], corners[0])];
  const up = edges[0];
  const dir = { x: up.x - center.x, y: up.y - center.y };
  const dl = Math.hypot(dir.x, dir.y) || 1;
  const knob = { x: up.x + (dir.x / dl) * 26 * px, y: up.y + (dir.y / dl) * 26 * px };
  const pivot = anchorPoint(tf, sw, sh, W, H);
  const mask = activeMask && activeMask.clipId === node.clipId ? node.masks.find((m) => m.id === activeMask.maskId) ?? null : null;

  const toSeq = (e: { clientX: number; clientY: number }): Vec => {
    const r = frame.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / Math.max(1, r.width)) * W, y: ((e.clientY - r.top) / Math.max(1, r.height)) * H };
  };

  const begin = (e: React.PointerEvent, drag: Drag) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const clipId = node.clipId;
    const key = `vw-${drag.kind}-${clipId}-${++gestureSeq}`;
    const label = LABELS[drag.kind];
    const p0 = toSeq(e);
    const tf0 = { ...tf };
    const crop0 = { ...node.crop };
    const bounds0 = boundsOf(corners);
    const pivot0 = pivot;
    const content0 = info.content;
    const inv0 = invert(content0);
    const u0 = apply(inv0, p0);
    const snapPx = 8 * px;
    dragging.current = true;
    const move = (ev: PointerEvent) => {
      const p = toSeq(ev);
      const snap = snapping !== (ev.ctrlKey || ev.metaKey);
      const write = (values: Record<string, number>) => writeClipParams(clipId, values, label, key);
      switch (drag.kind) {
        case 'move': {
          let dx = p.x - p0.x;
          let dy = p.y - p0.y;
          if (ev.shiftKey) {
            if (Math.abs(dx) > Math.abs(dy)) dy = 0;
            else dx = 0;
          }
          let g = { x: [] as number[], y: [] as number[] };
          if (snap) {
            const r = snapMove(bounds0, dx, dy, W, H, snapPx);
            dx = r.dx;
            dy = r.dy;
            g = { x: r.guidesX, y: r.guidesY };
          }
          setGuides(g);
          write({ 'transform.x': tf0.x + dx, 'transform.y': tf0.y + dy });
          break;
        }
        case 'scale': {
          if (drag.free || ev.shiftKey) {
            const f = axisScaleFactors(pivot0, tf0.rotation, p0, p);
            write({ 'transform.scaleX': tf0.scaleX * f.kx, 'transform.scaleY': tf0.scaleY * f.ky });
          } else write({ 'transform.scale': tf0.scale * uniformScaleFactor(pivot0, p0, p) });
          break;
        }
        case 'edgeX':
          write({ 'transform.scaleX': tf0.scaleX * axisScaleFactors(pivot0, tf0.rotation, p0, p).kx });
          break;
        case 'edgeY':
          write({ 'transform.scaleY': tf0.scaleY * axisScaleFactors(pivot0, tf0.rotation, p0, p).ky });
          break;
        case 'rotate':
          write({ 'transform.rotation': dragRotation(tf0.rotation, pivot0, p0, p, ev.shiftKey ? 15 : 0) });
          break;
        case 'anchor': {
          let q = p;
          if (snap) {
            const m0 = info.m;
            const targets = [apply(m0, { x: 0, y: 0 }), ...quad(m0, layerRect(sw, sh)), apply(m0, { x: info.box.x + info.box.w / 2, y: info.box.y + info.box.h / 2 })];
            let best: Vec | null = null;
            for (const t of targets) if (Math.hypot(t.x - p.x, t.y - p.y) <= snapPx && (!best || Math.hypot(t.x - p.x, t.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y))) best = t;
            if (best) q = best;
            setGuides(best ? { x: [best.x], y: [best.y] } : { x: [], y: [] });
          }
          const r = moveAnchorTo(tf0, sw, sh, W, H, q);
          write({ 'transform.anchorX': r.anchorX, 'transform.anchorY': r.anchorY, 'transform.x': r.x, 'transform.y': r.y });
          break;
        }
        case 'crop': {
          const u = apply(inv0, p);
          const minGap = 0.01;
          const c = crop0;
          if (drag.side === 'left') write({ 'crop.left': clamp((u.x + sw / 2) / sw, 0, 1 - c.right - minGap) });
          else if (drag.side === 'right') write({ 'crop.right': clamp((sw / 2 - u.x) / sw, 0, 1 - c.left - minGap) });
          else if (drag.side === 'top') write({ 'crop.top': clamp((u.y + sh / 2) / sh, 0, 1 - c.bottom - minGap) });
          else write({ 'crop.bottom': clamp((sh / 2 - u.y) / sh, 0, 1 - c.top - minGap) });
          break;
        }
        case 'maskMove': {
          const u = apply(inv0, p);
          const m = drag.mask;
          write({ [`masks.${m.id}.x`]: m.x + (u.x - u0.x) / sw, [`masks.${m.id}.y`]: m.y + (u.y - u0.y) / sh });
          break;
        }
        case 'maskSize': {
          const m = drag.mask;
          const s = maskResize(m, sw, sh, apply(inv0, p), drag.axis);
          write({ [`masks.${m.id}.width`]: s.width, [`masks.${m.id}.height`]: s.height });
          break;
        }
        case 'maskRotate': {
          const m = drag.mask;
          const c = { x: (m.x - 0.5) * sw, y: (m.y - 0.5) * sh };
          write({ [`masks.${m.id}.rotation`]: dragRotation(m.rotation, c, u0, apply(inv0, p), ev.shiftKey ? 15 : 0) });
          break;
        }
        case 'maskFeather': {
          const m = drag.mask;
          const v = maskLocal(m, sw, sh, apply(inv0, p));
          write({ [`masks.${m.id}.feather`]: Math.max(0, Math.round(v.x - ((m.width * sw) / 2 + m.expansion))) });
          break;
        }
      }
    };
    const end = () => {
      dragging.current = false;
      setGuides({ x: [], y: [] });
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const handle = (p: Vec, drag: Drag, testId: string, cursor: string, shape: 'square' | 'circle' = 'square') =>
    shape === 'square' ? (
      <rect key={testId} x={p.x - hs / 2} y={p.y - hs / 2} width={hs} height={hs} className="vw-gz__handle" style={{ cursor }} data-testid={testId} onPointerDown={(e) => begin(e, drag)} />
    ) : (
      <circle key={testId} cx={p.x} cy={p.y} r={hs / 2} className="vw-gz__handle" style={{ cursor }} data-testid={testId} onPointerDown={(e) => begin(e, drag)} />
    );

  // ---- masks ----
  const masks = node.masks.map((m) => {
    const outline = maskOutline(m, sw, sh, m.expansion).map((q) => apply(info.content, q));
    return { m, outline };
  });
  let maskUi: React.ReactNode = null;
  if (mask) {
    const mm = multiply(info.content, maskMatrix(mask, sw, sh));
    const at = (x: number, y: number) => apply(mm, { x, y });
    const c = at(0, 0);
    const topMid = at(0, -0.5);
    const d = { x: topMid.x - c.x, y: topMid.y - c.y };
    const len = Math.hypot(d.x, d.y) || 1;
    const rot = { x: topMid.x + (d.x / len) * 26 * px, y: topMid.y + (d.y / len) * 26 * px };
    const ring = maskOutline(mask, sw, sh, mask.expansion + mask.feather).map((q) => apply(info.content, q));
    const fRot = { x: Math.cos((mask.rotation * Math.PI) / 180), y: Math.sin((mask.rotation * Math.PI) / 180) };
    const fr = (mask.width * sw) / 2 + mask.expansion + mask.feather;
    const fh = apply(info.content, { x: (mask.x - 0.5) * sw + fRot.x * fr, y: (mask.y - 0.5) * sh + fRot.y * fr });
    maskUi = (
      <g className="vw-gz__mask is-active" data-testid="vw-mask-handles">
        <polygon points={pts(ring)} className="vw-gz__feather" />
        <line x1={topMid.x} y1={topMid.y} x2={rot.x} y2={rot.y} className="vw-gz__stem" />
        {handle(at(-0.5, 0), { kind: 'maskSize', mask, axis: 'x' }, 'vw-mask-w', cursorFor(c, at(-0.5, 0)))}
        {handle(at(0.5, 0), { kind: 'maskSize', mask, axis: 'x' }, 'vw-mask-e', cursorFor(c, at(0.5, 0)))}
        {handle(at(0, -0.5), { kind: 'maskSize', mask, axis: 'y' }, 'vw-mask-n', cursorFor(c, at(0, -0.5)))}
        {handle(at(0, 0.5), { kind: 'maskSize', mask, axis: 'y' }, 'vw-mask-s', cursorFor(c, at(0, 0.5)))}
        {[
          [-0.5, -0.5],
          [0.5, -0.5],
          [0.5, 0.5],
          [-0.5, 0.5],
        ].map(([x, y], i) => handle(at(x, y), { kind: 'maskSize', mask, axis: 'both' }, `vw-mask-corner-${i}`, cursorFor(c, at(x, y))))}
        {handle(rot, { kind: 'maskRotate', mask }, 'vw-mask-rotate', 'grab', 'circle')}
        <circle cx={fh.x} cy={fh.y} r={hs * 0.42} className="vw-gz__handle vw-gz__handle--feather" style={{ cursor: 'ew-resize' }} data-testid="vw-mask-feather" onPointerDown={(e) => begin(e, { kind: 'maskFeather', mask })} />
      </g>
    );
  }

  // ---- crop ----
  let cropUi: React.ReactNode = null;
  if (cropMode && !mask) {
    const full = quad(info.content, layerRect(sw, sh));
    const cr = quad(info.content, croppedRect(sw, sh, node.crop));
    const cMid = (a: number, b: number) => mid(cr[a], cr[b]);
    const sides: { side: 'left' | 'right' | 'top' | 'bottom'; p: Vec }[] = [
      { side: 'top', p: cMid(0, 1) },
      { side: 'right', p: cMid(1, 2) },
      { side: 'bottom', p: cMid(2, 3) },
      { side: 'left', p: cMid(3, 0) },
    ];
    const cc = apply(info.content, { x: 0, y: 0 });
    cropUi = (
      <g className="vw-gz__crop" data-testid="vw-crop-handles">
        <polygon points={pts(full)} className="vw-gz__full" />
        <polygon points={pts(cr)} className="vw-gz__cropbox" />
        {sides.map(({ side, p }) => handle(p, { kind: 'crop', side }, `vw-crop-${side}`, cursorFor(cc, p)))}
      </g>
    );
  }

  const showTransform = !cropMode && !mask;
  return (
    <svg className="vw-gz" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" data-testid="vw-gizmo">
      {guides.x.map((x, i) => (
        <line key={`gx${i}`} x1={x} y1={0} x2={x} y2={H} className="vw-gz__guide" />
      ))}
      {guides.y.map((y, i) => (
        <line key={`gy${i}`} x1={0} y1={y} x2={W} y2={y} className="vw-gz__guide" />
      ))}
      <polygon
        points={pts(corners)}
        className={`vw-gz__box ${showTransform ? 'is-live' : ''}`}
        data-testid="vw-gizmo-box"
        onPointerDown={showTransform ? (e) => begin(e, { kind: 'move' }) : undefined}
      />
      {masks.map(({ m, outline }) => (
        <polygon
          key={m.id}
          points={pts(outline)}
          className={`vw-gz__maskline ${mask?.id === m.id ? 'is-active' : ''} ${m.invert ? 'is-invert' : ''}`}
          data-testid={`vw-mask-${m.id}`}
          onPointerDown={(e) => {
            if (mask?.id === m.id) begin(e, { kind: 'maskMove', mask: m });
            else {
              e.stopPropagation();
              useViewerUi.getState().setActiveMask({ clipId: node.clipId, maskId: m.id });
            }
          }}
        />
      ))}
      {maskUi}
      {cropUi}
      {showTransform && (
        <g className="vw-gz__xf">
          <line x1={up.x} y1={up.y} x2={knob.x} y2={knob.y} className="vw-gz__stem" />
          {corners.map((p, i) => handle(p, { kind: 'scale', free: false }, `vw-gizmo-corner-${i}`, cursorFor(center, p)))}
          {handle(edges[1], { kind: 'edgeX' }, 'vw-gizmo-edge-e', cursorFor(center, edges[1]))}
          {handle(edges[3], { kind: 'edgeX' }, 'vw-gizmo-edge-w', cursorFor(center, edges[3]))}
          {handle(edges[0], { kind: 'edgeY' }, 'vw-gizmo-edge-n', cursorFor(center, edges[0]))}
          {handle(edges[2], { kind: 'edgeY' }, 'vw-gizmo-edge-s', cursorFor(center, edges[2]))}
          {handle(knob, { kind: 'rotate' }, 'vw-gizmo-rotate', 'grab', 'circle')}
          <g
            className="vw-gz__anchor"
            data-testid="vw-gizmo-anchor"
            onPointerDown={(e) => begin(e, { kind: 'anchor' })}
            onDoubleClick={(e) => {
              e.stopPropagation();
              const r = moveAnchorTo(tf, sw, sh, W, H, apply(info.m, { x: 0, y: 0 }));
              writeClipParams(node.clipId, { 'transform.anchorX': r.anchorX, 'transform.anchorY': r.anchorY, 'transform.x': r.x, 'transform.y': r.y }, 'Reset anchor point', `vw-anchor-reset-${++gestureSeq}`);
            }}
          >
            <circle cx={pivot.x} cy={pivot.y} r={hs * 0.75} className="vw-gz__anchor-ring" />
            <line x1={pivot.x - hs * 1.2} y1={pivot.y} x2={pivot.x + hs * 1.2} y2={pivot.y} />
            <line x1={pivot.x} y1={pivot.y - hs * 1.2} x2={pivot.x} y2={pivot.y + hs * 1.2} />
          </g>
        </g>
      )}
    </svg>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
