// The timeline controller: owns the two canvases (ruler + clip area), turns
// pointer / wheel / drag-and-drop input into tool behaviour, and redraws on
// store changes (and every animation frame while playing or dragging).
//
// Every drag builds a `recipe` (draft project → void) from the edit ops. While
// dragging, the recipe is applied to a throw-away immer draft to draw an exact
// live preview (ripple, roll, slip, slide, insert all look exactly like the
// result); on release the same recipe is committed as ONE labelled mutate.
// If an op throws (e.g. not implemented yet) the preview falls back to simple
// ghost rectangles and the commit shows an error toast.

import { produce } from 'immer';
import { onPeaks, requestPeaks } from '../../../engine/audio/engine';
import { instantiateEffect } from '../../../engine/effects/registry';
import * as ops from '../../../engine/edit/ops';
import { allKeyTimes, KEY_TOLERANCE, paramAt, setKeyframe, setStatic } from '../../../engine/keyframes';
import { onThumbnails, requestThumbnails } from '../../../engine/media/thumbnails';
import { transport } from '../../../engine/playback/transport';
import { exactRate, formatTimecode, snapToFrame, sourceSpan, sourceTimeAt } from '../../../engine/time';
import { useEditor } from '../../../state/store';
import type { CaptionCue, Clip, MediaAsset, Project, Sequence, Track, TransitionType } from '../../../state/types';
import { activeSequence, findClip, sequenceDuration } from '../../../state/types';
import { isMac, runAction } from '../actions';
import * as cmd from './commands';
import { ctlRef, type TimelineHandle } from './ctlRef';
import { CURSORS } from './cursors';
import {
  bandArea,
  bandPath,
  bandPos,
  bandValue,
  EMPTY_OVERLAY,
  KF_LANE_H,
  readTheme,
  showsBand,
  showsKeyLane,
  TimelineRenderer,
  transitionSpans,
  videoFades,
  type ClipRect,
  type DrawState,
  type Ghost,
  type Overlay,
  type Theme,
  type TransitionSpan,
} from './draw';
import { clipAtTime, clipsInRange, cuesInRange, layoutTracks, MARKER_ROW_H, nearestRow, rowAtY, RULER_H, type TrackRow } from './geometry';
import { clipMenu, cueMenu, laneMenu, rulerMenu, transitionMenu } from './menus';
import { makeSnapper, snapBlock, snapPointsFor, SNAP_PX, type Snapper, type SnapSources } from './snap';
import { formatDelta } from './ticks';
import { revealTime, useTLView, zoomAround } from './view';

const S = () => useEditor.getState();
const V = () => useTLView.getState();

export interface Ptr {
  x: number;
  y: number;
  /** Content y (with vertical scroll). */
  cy: number;
  t: number;
  row: TrackRow | null;
  shift: boolean;
  alt: boolean;
  mod: boolean;
  clientX: number;
  clientY: number;
}

type Zone =
  | 'body'
  | 'trimStart'
  | 'trimEnd'
  | 'fadeIn'
  | 'fadeOut'
  | 'band'
  | 'bandKey'
  | 'keyLane'
  | 'transition'
  | 'transitionStart'
  | 'transitionEnd'
  | 'cue'
  | 'cueStart'
  | 'cueEnd';

interface Hit {
  row: TrackRow | null;
  t: number;
  zone?: Zone;
  clip?: Clip;
  rect?: { x: number; y: number; w: number; h: number };
  span?: TransitionSpan;
  cue?: CaptionCue;
  keyIndex?: number;
  laneKeyT?: number;
}

interface Drag {
  label: string;
  moved: boolean;
  autoscroll: boolean;
  cursor?: string;
  recipe: ((d: Project) => void) | null;
  version: number;
  ghosts: Ghost[];
  origins: Ghost[];
  snapAt: number | null;
  readout: string[] | null;
  /** Readout computed after the live preview ran (shows what the op really applied). */
  readoutFn?: (previewOk: boolean) => string[] | null;
  marquee?: Overlay['marquee'];
  zoomRange?: Overlay['zoomRange'];
  move(p: Ptr): void;
  up(p: Ptr): void;
  cancel?(): void;
}

function baseDrag(label: string, autoscroll = true): Omit<Drag, 'move' | 'up'> {
  return { label, moved: false, autoscroll, recipe: null, version: 0, ghosts: [], origins: [], snapAt: null, readout: null };
}

function activeSeqOf(d: Project): Sequence {
  return d.sequences.find((s) => s.id === d.activeSequenceId) ?? d.sequences[0];
}

const MOVE_THRESHOLD = 3;

export class TimelineController implements TimelineHandle {
  private canvas: HTMLCanvasElement;
  private ruler: HTMLCanvasElement;
  private wrap: HTMLElement;
  private rulerWrap: HTMLElement;
  private renderer: TimelineRenderer;
  private theme: Theme;
  private themeAt = 0;
  private raf = 0;
  private drag: Drag | null = null;
  private downPtr: Ptr | null = null;
  private lastPtr: Ptr | null = null;
  private hoverClipId: string | null = null;
  private razorAt: { t: number; trackIds: Set<string> | null } | null = null;
  private dropOverlay: Partial<Overlay> | null = null;
  private preview: { version: number; base: Project | null; drag: Drag | null; project: Project | null } = { version: -1, base: null, drag: null, project: null };
  private clipRects: ClipRect[] = [];
  private lastStats = { ms: 0, drawn: 0, frames: 0 };
  private thumbReq = new Map<string, number>();
  private peakReq = new Map<string, number>();
  private unsubs: (() => void)[] = [];
  private visibleTimer = 0;
  private visibleSig = '';
  private dpr = 1;
  private sizeW = 0;
  private sizeH = 0;
  private wasPlaying = false;

  constructor(canvas: HTMLCanvasElement, ruler: HTMLCanvasElement, wrap: HTMLElement, rulerWrap: HTMLElement) {
    this.canvas = canvas;
    this.ruler = ruler;
    this.wrap = wrap;
    this.rulerWrap = rulerWrap;
    this.theme = readTheme();
    this.renderer = new TimelineRenderer({
      thumbs: (asset, times) => this.requestThumbs(asset, times),
      peaks: (id) => this.requestPeaksFor(id),
    });
  }

  // ===================================================================== lifecycle
  attach() {
    const c = this.canvas;
    const r = this.ruler;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.unsubs.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on(c, 'pointerdown', (e) => this.onPointerDown(e));
    on(c, 'pointermove', (e) => this.onPointerMove(e));
    on(c, 'pointerup', (e) => this.onPointerUp(e));
    on(c, 'pointercancel', () => this.cancelDrag());
    on(c, 'pointerleave', () => this.onLeave());
    on(c, 'dblclick', (e) => this.onDblClick(e));
    on(c, 'contextmenu', (e) => this.onContextMenu(e));
    on(this.wrap, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(this.rulerWrap, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(this.wrap, 'dragover', (e) => this.onDragOver(e));
    on(this.wrap, 'dragleave', (e) => this.onDragLeave(e));
    on(this.wrap, 'drop', (e) => this.onDrop(e));
    on(r, 'pointerdown', (e) => this.onRulerDown(e));
    on(r, 'pointermove', (e) => this.onRulerMove(e));
    on(r, 'pointerup', (e) => this.onPointerUp(e));
    on(r, 'pointercancel', () => this.cancelDrag());
    on(r, 'dblclick', (e) => this.onRulerDblClick(e));
    on(r, 'contextmenu', (e) => this.onRulerContext(e));

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.wrap);
    ro.observe(this.rulerWrap);
    this.unsubs.push(() => ro.disconnect());

    let lastPlayhead = S().playhead;
    this.unsubs.push(
      useEditor.subscribe((s, prev) => {
        if (s.project !== prev.project || s.selection !== prev.selection) this.preview.version = -1;
        if (s.playhead !== lastPlayhead) {
          lastPlayhead = s.playhead;
          if (!this.drag && !s.playing) {
            const v = V();
            const span = v.viewW / s.zoom;
            if (s.playhead < v.t0 || s.playhead > v.t0 + span) revealTime(s.playhead);
          }
        }
        this.invalidate();
      }),
      useTLView.subscribe(() => this.invalidate()),
      onThumbnails(() => this.invalidate()),
      onPeaks(() => this.invalidate()),
    );
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    this.unsubs.push(() => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    });
    try {
      void document.fonts?.ready.then(() => this.invalidate());
    } catch {
      /* ignore */
    }
    ctlRef.current = this;
    this.installDebug();
    this.resize();
    this.invalidate();
  }

  detach() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.visibleTimer);
    if (ctlRef.current === this) ctlRef.current = null;
    const w = window as unknown as { __deltaTimeline?: unknown };
    if (w.__deltaTimeline && (w.__deltaTimeline as { _ctl?: unknown })._ctl === this) delete w.__deltaTimeline;
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(this.wrap.clientWidth));
    const h = Math.max(1, Math.floor(this.wrap.clientHeight));
    if (w === this.sizeW && h === this.sizeH && dpr === this.dpr) return;
    this.dpr = dpr;
    this.sizeW = w;
    this.sizeH = h;
    for (const [cv, ch] of [
      [this.canvas, h],
      [this.ruler, RULER_H],
    ] as const) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(ch * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${ch}px`;
    }
    V().setViewSize(w, h);
    this.invalidate();
  }

  invalidate = () => {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  };

  private frame = () => {
    this.raf = 0;
    const st = S();
    if (!st.project) return;
    let again = false;
    // follow the playhead with page-scroll while playing
    if (st.playing && !this.drag) {
      revealTime(st.playhead, 'page');
      again = true;
    }
    if (this.wasPlaying !== st.playing) this.wasPlaying = st.playing;
    // edge auto-scroll while dragging
    if (this.drag?.autoscroll && this.drag.moved && this.lastPtr) {
      const p = this.lastPtr;
      const W = this.sizeW;
      const edge = 28;
      let dx = 0;
      if (p.x < edge) dx = -(edge - p.x);
      else if (p.x > W - edge) dx = p.x - (W - edge);
      let dy = 0;
      if (p.y < 14) dy = -(14 - p.y);
      else if (p.y > this.sizeH - 14) dy = p.y - (this.sizeH - 14);
      if (dx || dy) {
        const v = V();
        if (dx) v.setT0(v.t0 + (dx * 0.6) / st.zoom);
        if (dy) {
          const layout = layoutTracks(activeSequence(st.project).tracks);
          v.setScrollY(Math.min(Math.max(0, layout.height - this.sizeH + 40), v.scrollY + dy * 0.6));
        }
        const np = this.ptrAt(p.x, p.y, p);
        this.lastPtr = np;
        this.drag.move(np);
        again = true;
      }
    }
    this.draw();
    if (again) this.invalidate();
  };

  // ===================================================================== drawing
  private theme_(): Theme {
    const now = performance.now();
    if (now - this.themeAt > 1500) {
      this.theme = readTheme();
      this.themeAt = now;
    }
    return this.theme;
  }

  private previewProject(project: Project): Project {
    const d = this.drag;
    if (!d?.recipe || !d.moved) return project;
    if (this.preview.drag !== d || this.preview.version !== d.version || this.preview.base !== project) {
      this.preview.drag = d;
      this.preview.version = d.version;
      this.preview.base = project;
      try {
        this.preview.project = produce(project, d.recipe);
      } catch {
        this.preview.project = null;
      }
    }
    return this.preview.project ?? project;
  }

  private draw() {
    const st = S();
    if (!st.project) return;
    const ctx = this.canvas.getContext('2d');
    const rctx = this.ruler.getContext('2d');
    if (!ctx || !rctx) return;
    const view = V();
    const project = this.previewProject(st.project);
    const previewOk = project !== st.project;
    const seq = activeSequence(project);
    const d = this.drag;
    const overlay: Overlay = {
      ...EMPTY_OVERLAY,
      ghosts: d ? (previewOk ? d.origins : d.ghosts) : [],
      snapAt: d?.snapAt ?? null,
      readout: null,
      marquee: d?.marquee ?? null,
      razor: d ? null : this.razorAt,
      zoomRange: d?.zoomRange ?? null,
      ...(this.dropOverlay ?? {}),
    };
    const ds: DrawState = {
      project,
      seq,
      zoom: st.zoom,
      t0: view.t0,
      scrollY: view.scrollY,
      W: this.sizeW,
      H: this.sizeH,
      playhead: st.playhead,
      selected: new Set(st.selection.clipIds),
      selectedMarkers: new Set(st.selection.markerIds),
      selectedCues: new Set(st.selection.cueIds),
      selectedKeys: st.selection.keyframes,
      tool: st.tool,
      hoverClipId: this.hoverClipId,
      gap: view.gap,
      transition: view.transition,
      overlay,
      theme: this.theme_(),
      playing: st.playing,
    };
    if (d && d.moved && this.lastPtr) {
      const lines = d.readoutFn ? d.readoutFn(previewOk) : d.readout;
      if (lines?.length) overlay.readout = { x: this.lastPtr.x, y: this.lastPtr.y, lines };
    }
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const res = this.renderer.drawTracks(ctx, ds);
    rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.renderer.drawRuler(rctx, ds, RULER_H);
    this.clipRects = res.clipRects;
    this.lastStats = { ms: res.ms, drawn: res.drawn, frames: this.lastStats.frames + 1 };
    this.scheduleVisible(seq);
  }

  /** Publishes the visible clips (hidden accessible list + tests), throttled. */
  private scheduleVisible(seq: Sequence) {
    if (this.visibleTimer) return;
    this.visibleTimer = window.setTimeout(() => {
      this.visibleTimer = 0;
      const box = this.canvas.getBoundingClientRect();
      const sel = new Set(S().selection.clipIds);
      const byId = new Map<string, { c: Clip; kind: string }>();
      for (const t of seq.tracks) for (const c of t.clips) byId.set(c.id, { c, kind: t.kind });
      const list = this.clipRects
        .filter((r) => byId.has(r.id))
        .map((r) => {
          const { c, kind } = byId.get(r.id)!;
          const x0 = Math.max(0, r.x);
          const x1 = Math.min(this.sizeW, r.x + r.w);
          return { id: r.id, name: c.name, trackId: r.trackId, kind, selected: sel.has(r.id), x: Math.round(box.left + x0), y: Math.round(box.top + r.y), w: Math.round(x1 - x0), h: Math.round(r.h), start: c.start, end: c.start + c.duration };
        })
        .filter((r) => r.w >= 2 && r.y + r.h > box.top && r.y < box.bottom)
        .slice(0, 600);
      const sig = list.map((r) => `${r.id}:${r.x}:${r.y}:${r.w}:${r.h}:${r.selected ? 1 : 0}:${r.name}`).join('|');
      if (sig !== this.visibleSig) {
        this.visibleSig = sig;
        V().setVisible(list);
      }
    }, 120);
  }

  private requestThumbs(asset: MediaAsset, times: number[]) {
    const now = performance.now();
    const fresh: number[] = [];
    for (const t of times) {
      const k = `${asset.id}@${t}`;
      const at = this.thumbReq.get(k);
      if (at && now - at < 4000) continue;
      this.thumbReq.set(k, now);
      fresh.push(t);
    }
    if (this.thumbReq.size > 20000) this.thumbReq.clear();
    if (!fresh.length) return;
    try {
      requestThumbnails(asset, fresh);
    } catch {
      /* provider not ready */
    }
  }

  private requestPeaksFor(assetId: string) {
    const now = performance.now();
    const at = this.peakReq.get(assetId);
    if (at && now - at < 10000) return;
    this.peakReq.set(assetId, now);
    const p = S().project;
    if (!p) return;
    void requestPeaks(p, assetId)
      .then((r) => r && this.invalidate())
      .catch(() => undefined);
  }

  // ===================================================================== geometry
  private seq(): Sequence {
    return activeSequence(S().project!);
  }

  private X(t: number): number {
    return (t - V().t0) * S().zoom;
  }

  private ptrAt(x: number, y: number, mods: { shift: boolean; alt: boolean; mod: boolean; clientX?: number; clientY?: number }): Ptr {
    const view = V();
    const zoom = S().zoom;
    const cy = y + view.scrollY;
    const layout = layoutTracks(this.seq().tracks);
    const box = this.canvas.getBoundingClientRect();
    return {
      x,
      y,
      cy,
      t: view.t0 + x / zoom,
      row: rowAtY(layout, cy),
      shift: mods.shift,
      alt: mods.alt,
      mod: mods.mod,
      clientX: box.left + x,
      clientY: box.top + y,
    };
  }

  private ptr(e: MouseEvent, el: HTMLElement = this.canvas): Ptr {
    const box = el.getBoundingClientRect();
    return this.ptrAt(e.clientX - box.left, e.clientY - box.top, { shift: e.shiftKey, alt: e.altKey, mod: isMac ? e.metaKey : e.ctrlKey });
  }

  clipClientRect(clipId: string): DOMRect | null {
    const r = this.clipRects.find((c) => c.id === clipId);
    if (!r) return null;
    const box = this.canvas.getBoundingClientRect();
    const x0 = Math.max(0, r.x);
    const x1 = Math.min(this.sizeW, r.x + r.w);
    return new DOMRect(box.left + x0, box.top + r.y, Math.max(0, x1 - x0), r.h);
  }

  timeToClientX(t: number): number {
    return this.canvas.getBoundingClientRect().left + this.X(t);
  }

  private snapper(src: SnapSources): Snapper | null {
    const st = S();
    if (!st.snapping) return null;
    return makeSnapper(snapPointsFor(this.seq(), { playhead: st.playhead, keyframes: true, ...src }));
  }

  private snapT(sn: Snapper | null, t: number): { t: number; at: number | null } {
    const seq = this.seq();
    if (sn) {
      const hit = sn.nearest(t, SNAP_PX / S().zoom);
      if (hit) return { t: hit.t, at: hit.t };
    }
    return { t: snapToFrame(t, seq.fps), at: null };
  }

  // ===================================================================== hit testing
  hitTest(x: number, y: number): Hit {
    const st = S();
    const seq = this.seq();
    const view = V();
    const zoom = st.zoom;
    const layout = layoutTracks(seq.tracks);
    const row = rowAtY(layout, y + view.scrollY);
    const t = view.t0 + x / zoom;
    if (!row) return { row: null, t };
    const tr = row.track;
    const ry = row.y - view.scrollY + 1;
    const rh = row.h - 3;
    const X = (tt: number) => (tt - view.t0) * zoom;
    if (tr.kind === 'caption') {
      for (const q of cuesInRange(tr, t - 8 / zoom, t + 8 / zoom)) {
        const a = X(q.start);
        const b = X(q.end);
        if (x < a - 5 || x > b + 5) continue;
        const zone: Zone = b - a > 14 && Math.abs(x - a) <= 5 ? 'cueStart' : b - a > 14 && Math.abs(x - b) <= 5 ? 'cueEnd' : x >= a && x <= b ? 'cue' : Math.abs(x - a) < Math.abs(x - b) ? 'cueStart' : 'cueEnd';
        return { row, t, zone, cue: q, rect: { x: a, y: ry, w: b - a, h: rh } };
      }
      return { row, t };
    }
    // transitions sit on top of the cut
    const near = clipsInRange(tr, t - 12 / zoom, t + 12 / zoom);
    for (const span of transitionSpans(tr, near)) {
      const a = X(span.a);
      const b = X(span.b);
      const th = Math.max(10, Math.min(rh, Math.round(rh * 0.62)));
      const ty = ry + rh - th;
      if (y < ty || x < a - 4 || x > b + 4) continue;
      const zone: Zone = Math.abs(x - a) <= 4 ? 'transitionStart' : Math.abs(x - b) <= 4 ? 'transitionEnd' : 'transition';
      const clip = near.find((c) => c.id === span.clipId);
      return { row, t, zone, span, clip, rect: { x: a, y: ty, w: b - a, h: th } };
    }
    const clip = clipAtTime(tr, t);
    if (clip) {
      const cx = X(clip.start);
      const cw = clip.duration * zoom;
      const rect = { x: cx, y: ry, w: cw, h: rh };
      const sel = st.selection.clipIds.includes(clip.id);
      const ew = Math.min(8, Math.max(2, cw / 4));
      // fade handles (top corners)
      if (cw > 26 && rh >= 22 && y <= ry + 12 && !tr.locked) {
        const { fin, fout } = videoFades(clip, tr.kind);
        const h1 = Math.max(cx + 4, Math.min(cx + cw - 4, cx + fin * zoom));
        const h2 = Math.max(cx + 4, Math.min(cx + cw - 4, cx + cw - fout * zoom));
        if (Math.abs(x - h1) <= 6 && (sel || this.hoverClipId === clip.id)) return { row, t, zone: 'fadeIn', clip, rect };
        if (Math.abs(x - h2) <= 6 && (sel || this.hoverClipId === clip.id)) return { row, t, zone: 'fadeOut', clip, rect };
      }
      // keyframe lane
      if (showsKeyLane(clip, sel, rh, cw) && y >= ry + rh - KF_LANE_H) {
        for (const k of allKeyTimes(clip)) if (Math.abs(cx + k * zoom - x) <= 5) return { row, t, zone: 'keyLane', clip, rect, laneKeyT: k };
      }
      // rubber band keyframe dots / line
      const tool = st.tool;
      if (showsBand(clip, tr.kind, sel, tool, rh) && cw > 8) {
        const path = bandPath(tr.kind);
        const { top, bottom } = bandArea(ry, rh);
        const Y = (v: number) => bottom - bandPos(path, v) * (bottom - top);
        const kfs = clip.keyframes[path];
        if (kfs) {
          for (let i = 0; i < kfs.length; i++) {
            const kx = cx + kfs[i].t * zoom;
            if (Math.abs(kx - x) <= 5 && Math.abs(Y(kfs[i].v) - y) <= 5) return { row, t, zone: 'bandKey', clip, rect, keyIndex: i };
          }
        }
        const local = (x - cx) / zoom;
        const by = Y(paramAt(clip, path, local));
        const nearEdge = x - cx < ew || cx + cw - x < ew;
        if (Math.abs(by - y) <= (tool === 'pen' ? 6 : 3.5) && (!nearEdge || tool === 'pen')) return { row, t, zone: 'band', clip, rect };
      }
      if (x - cx < ew) return { row, t, zone: 'trimStart', clip, rect };
      if (cx + cw - x < ew) return { row, t, zone: 'trimEnd', clip, rect };
      return { row, t, zone: 'body', clip, rect };
    }
    // just outside a clip edge: still trim it
    for (const c of near) {
      const cx = X(c.start);
      const ce = X(c.start + c.duration);
      if (x > ce && x - ce <= 6) return { row, t, zone: 'trimEnd', clip: c, rect: { x: cx, y: ry, w: ce - cx, h: rh } };
      if (x < cx && cx - x <= 6) return { row, t, zone: 'trimStart', clip: c, rect: { x: cx, y: ry, w: ce - cx, h: rh } };
    }
    return { row, t };
  }

  private cursorFor(h: Hit, p: Ptr): string {
    const st = S();
    const tool = st.tool;
    const locked = h.row?.track.locked;
    switch (tool) {
      case 'hand':
        return CURSORS.hand;
      case 'zoom':
        return p.alt ? CURSORS.zoomOut : CURSORS.zoomIn;
      case 'razor':
        return h.row && !locked ? CURSORS.razor : CURSORS.default;
      case 'trackForward':
        return p.shift ? CURSORS.trackForwardAll : CURSORS.trackForward;
      case 'pen':
        if (h.zone === 'bandKey') return p.mod || p.alt ? CURSORS.penRemove : CURSORS.move;
        if (h.zone === 'band') return CURSORS.penAdd;
        return CURSORS.pen;
      default:
        break;
    }
    if (!h.zone) return CURSORS.default;
    if (locked && h.zone !== 'body') return CURSORS.notAllowed;
    switch (h.zone) {
      case 'trimStart':
        return tool === 'ripple' ? CURSORS.rippleStart : tool === 'roll' ? CURSORS.roll : tool === 'rate' ? CURSORS.rate : CURSORS.trimStart;
      case 'trimEnd':
        return tool === 'ripple' ? CURSORS.rippleEnd : tool === 'roll' ? CURSORS.roll : tool === 'rate' ? CURSORS.rate : CURSORS.trimEnd;
      case 'fadeIn':
      case 'fadeOut':
      case 'transitionStart':
      case 'transitionEnd':
      case 'cueStart':
      case 'cueEnd':
        return CURSORS.ew;
      case 'band':
        return CURSORS.ns;
      case 'bandKey':
        return CURSORS.move;
      case 'keyLane':
        return CURSORS.ew;
      case 'body':
        if (tool === 'slip') return CURSORS.slip;
        if (tool === 'slide') return CURSORS.slide;
        if (tool === 'ripple' || tool === 'roll' || tool === 'rate') return CURSORS.default;
        return p.alt ? CURSORS.copy : CURSORS.default;
      default:
        return CURSORS.default;
    }
  }

  // ===================================================================== pointer input
  private onPointerDown(e: PointerEvent) {
    const st = S();
    if (!st.project) return;
    V().openMenu(null);
    V().setTransitionPop(null);
    if (e.button === 1) {
      // middle button: hand-scroll with any tool
      this.startDrag(this.handDrag(this.ptr(e)), e);
      return;
    }
    if (e.button !== 0) return;
    const p = this.ptr(e);
    this.downPtr = p;
    this.lastPtr = p;
    (document.activeElement as HTMLElement | null)?.blur?.();
    const drag = this.dragForDown(p);
    if (drag) this.startDrag(drag, e);
    this.invalidate();
  }

  private startDrag(d: Drag, e: PointerEvent) {
    this.drag = d;
    try {
      (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    if (d.cursor) this.canvas.style.cursor = d.cursor;
  }

  private onPointerMove(e: PointerEvent) {
    const p = this.ptr(e);
    this.lastPtr = p;
    if (this.drag) {
      const dp = this.downPtr;
      if (!this.drag.moved && dp && Math.hypot(p.x - dp.x, p.y - dp.y) < MOVE_THRESHOLD) return;
      this.drag.moved = true;
      this.drag.move(p);
      this.drag.version++;
      if (this.drag.cursor) this.canvas.style.cursor = this.drag.cursor;
      this.invalidate();
      return;
    }
    if (!S().project) return;
    const h = this.hitTest(p.x, p.y);
    this.canvas.style.cursor = this.cursorFor(h, p);
    const hover = h.clip?.id ?? null;
    let dirty = hover !== this.hoverClipId;
    this.hoverClipId = hover;
    if (S().tool === 'razor') {
      const next = this.razorPreview(p, h);
      if (next?.t !== this.razorAt?.t || (next === null) !== (this.razorAt === null)) dirty = true;
      this.razorAt = next;
    } else if (this.razorAt) {
      this.razorAt = null;
      dirty = true;
    }
    if (dirty) this.invalidate();
  }

  private onLeave() {
    if (this.drag) return;
    if (this.hoverClipId || this.razorAt) {
      this.hoverClipId = null;
      this.razorAt = null;
      this.invalidate();
    }
  }

  private onPointerUp(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    const p = this.ptr(e, e.currentTarget === this.ruler ? this.ruler : this.canvas);
    this.drag = null;
    try {
      (e.currentTarget as HTMLElement | null)?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    try {
      d.up(p);
    } catch (err) {
      cmd.toast(`${d.label} failed: ${cmd.errorText(err)}`, 'error');
    }
    this.preview = { version: -1, base: null, drag: null, project: null };
    this.canvas.style.cursor = this.cursorFor(this.hitTest(p.x, p.y), p);
    this.invalidate();
  }

  private cancelDrag() {
    if (!this.drag) return;
    this.drag.cancel?.();
    this.drag = null;
    this.preview = { version: -1, base: null, drag: null, project: null };
    this.invalidate();
  }

  private onKey(e: KeyboardEvent) {
    if (!this.drag) return;
    if (e.key === 'Escape' && e.type === 'keydown') {
      e.preventDefault();
      e.stopPropagation();
      this.cancelDrag();
      return;
    }
    if (['Shift', 'Alt', 'Control', 'Meta'].includes(e.key) && this.lastPtr && this.drag.moved) {
      const np = { ...this.lastPtr, shift: e.shiftKey, alt: e.altKey, mod: isMac ? e.metaKey : e.ctrlKey };
      this.lastPtr = np;
      this.drag.move(np);
      this.drag.version++;
      this.invalidate();
      if (e.key === 'Alt') e.preventDefault();
    }
  }

  private onWheel(e: WheelEvent) {
    const st = S();
    if (!st.project) return;
    e.preventDefault();
    const box = this.canvas.getBoundingClientRect();
    const x = e.clientX - box.left;
    const view = V();
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.sizeW : 1;
    if (e.ctrlKey || e.altKey || e.metaKey) {
      const anchor = view.t0 + x / st.zoom;
      zoomAround(anchor, st.zoom * Math.exp(-e.deltaY * scale * 0.0022));
      return;
    }
    if (e.shiftKey) {
      const layout = layoutTracks(this.seq().tracks);
      const maxY = Math.max(0, layout.height - this.sizeH + 40);
      view.setScrollY(Math.min(maxY, view.scrollY + (e.deltaY || e.deltaX) * scale));
      return;
    }
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    view.setT0(view.t0 + (dx * scale) / st.zoom);
  }

  // ===================================================================== tool dispatch
  private dragForDown(p: Ptr): Drag | null {
    const st = S();
    const tool = st.tool;
    if (tool === 'hand') return this.handDrag(p);
    if (tool === 'zoom') return this.zoomDrag(p);
    const h = this.hitTest(p.x, p.y);
    if (h.row?.track.kind === 'caption' || h.cue) return this.cueDown(p, h);
    if (tool === 'razor') {
      this.razorClick(p, h);
      return null;
    }
    if (tool === 'trackForward') return this.trackForwardDown(p, h);
    if (h.zone === 'transition' || h.zone === 'transitionStart' || h.zone === 'transitionEnd') return this.transitionDown(p, h);
    if (tool === 'pen') return this.penDown(p, h);
    if (!h.clip) return this.emptyDown(p, h);
    const clip = h.clip;
    const locked = !!h.row?.track.locked;
    V().setGap(null);
    V().setTransition(null);
    switch (h.zone) {
      case 'fadeIn':
      case 'fadeOut':
        if (locked) return null;
        this.ensureSelected(clip.id, p);
        return this.fadeDrag(p, clip, h.zone === 'fadeIn' ? 'in' : 'out', h.row!.track.kind === 'audio');
      case 'keyLane':
        return this.laneDrag(p, clip, h.laneKeyT!, locked);
      case 'bandKey':
        if (locked) return null;
        return this.keyDrag(p, clip, h.row!.track.kind, h.keyIndex!, false);
      case 'band':
        if (locked || tool !== 'select') break;
        this.ensureSelected(clip.id, p);
        return this.bandDrag(p, clip, h.row!.track.kind);
      default:
        break;
    }
    if ((h.zone === 'trimStart' || h.zone === 'trimEnd') && ['select', 'ripple', 'roll', 'rate', 'text'].includes(tool)) {
      if (locked) {
        this.ensureSelected(clip.id, p);
        return null;
      }
      const mode = tool === 'ripple' ? 'ripple' : tool === 'roll' ? 'roll' : tool === 'rate' ? 'rate' : 'normal';
      if (tool === 'select' || tool === 'text') this.ensureSelected(clip.id, p);
      return this.trimDrag(p, clip, h.zone === 'trimStart' ? 'start' : 'end', mode);
    }
    if (tool === 'slip') {
      this.ensureSelected(clip.id, p);
      return locked ? null : this.slipDrag(p, clip);
    }
    if (tool === 'slide') {
      this.ensureSelected(clip.id, p);
      return locked ? null : this.slideDrag(p, clip);
    }
    return this.selectDown(p, clip, locked);
  }

  private ensureSelected(id: string, p: Ptr) {
    const st = S();
    if (!st.selection.clipIds.includes(id)) st.selectClips([id], p.shift ? 'add' : 'replace');
  }

  // ---- select / move -----------------------------------------------------
  private selectDown(p: Ptr, clip: Clip, locked: boolean): Drag | null {
    const st = S();
    const wasSelected = st.selection.clipIds.includes(clip.id);
    let pending: 'collapse' | 'toggleSingle' | 'single' | null = null;
    if (p.shift) st.selectClips([clip.id], 'toggle');
    else if (p.mod) pending = 'toggleSingle';
    else if (p.alt && !wasSelected) pending = 'single';
    else if (!wasSelected) st.selectClips([clip.id], 'replace');
    else pending = 'collapse';
    st.select({ cueIds: [], keyframes: [] });
    const ids = () => {
      const sel = S().selection.clipIds;
      if (sel.includes(clip.id)) return sel;
      if (p.mod || p.alt) return [...sel, clip.id];
      return [clip.id];
    };
    const move = locked ? null : this.moveDrag(p, clip, ids);
    const moveUp = move?.up;
    const up = (q: Ptr) => {
      if (move && move.moved && moveUp) return moveUp(q);
      const s = S();
      if (pending === 'collapse') s.selectClips([clip.id], 'replace');
      else if (pending === 'toggleSingle') {
        const cur = s.selection.clipIds;
        s.select({ clipIds: cur.includes(clip.id) ? cur.filter((x) => x !== clip.id) : [...cur, clip.id], keyframes: [] });
      } else if (pending === 'single') s.select({ clipIds: [clip.id], keyframes: [] });
    };
    if (!move) return { ...baseDrag('Select', false), move: () => undefined, up };
    move.up = up;
    return move;
  }

  private moveDrag(p0: Ptr, anchor: Clip, idsFn: () => string[]): Drag {
    const seq = this.seq();
    const layout = layoutTracks(seq.tracks);
    const fr = 1 / exactRate(seq.fps);
    let blocks: { clip: Clip; track: Track; row: TrackRow }[] = [];
    let anchorRow: TrackRow | null = null;
    let sameKindRows: TrackRow[] = [];
    let sn: Snapper | null = null;
    let minStart = 0;
    let dt = 0;
    let dTracks = 0;
    let init = false;
    let created: string[] = [];
    const prepare = () => {
      const ids = new Set(cmd.editableIds(seq, idsFn()));
      blocks = [];
      for (const row of layout.rows) for (const c of row.track.clips) if (ids.has(c.id)) blocks.push({ clip: c, track: row.track, row });
      anchorRow = layout.rows.find((r) => r.track.clips.some((c) => c.id === anchor.id)) ?? null;
      sameKindRows = anchorRow ? layout.rows.filter((r) => r.track.kind === anchorRow!.track.kind) : [];
      sn = this.snapper({ excludeClipIds: ids });
      minStart = Math.min(...blocks.map((b) => b.clip.start));
      init = true;
    };
    const d: Drag = {
      ...baseDrag('Move clips'),
      move: (p) => {
        if (!init) prepare();
        if (!blocks.length || !anchorRow) return;
        let delta = p.t - p0.t;
        delta = Math.round(delta / fr) * fr;
        let snapAt: number | null = null;
        if (sn) {
          const r = snapBlock(sn, anchor.start, anchor.start + anchor.duration, delta, SNAP_PX / S().zoom);
          if (r.at !== null) {
            delta = r.delta;
            snapAt = r.at;
          } else {
            const g0 = minStart;
            const g1 = Math.max(...blocks.map((b) => b.clip.start + b.clip.duration));
            const r2 = snapBlock(sn, g0, g1, delta, SNAP_PX / S().zoom);
            if (r2.at !== null) {
              delta = r2.delta;
              snapAt = r2.at;
            }
          }
        }
        if (minStart + delta < 0) {
          delta = -minStart;
          snapAt = null;
        }
        dt = delta;
        // track delta, same kind only, every moved clip of that kind must stay in range and unlocked
        const over = nearestRow(layout, p.cy);
        if (over && over.track.kind === anchorRow.track.kind) {
          let want = over.kindIndex - anchorRow.kindIndex;
          const kindBlocks = blocks.filter((b) => b.track.kind === anchorRow!.track.kind);
          const lo = Math.min(...kindBlocks.map((b) => b.row.kindIndex));
          const hi = Math.max(...kindBlocks.map((b) => b.row.kindIndex));
          want = Math.max(-lo, Math.min(sameKindRows.length - 1 - hi, want));
          const ok = kindBlocks.every((b) => !sameKindRows[b.row.kindIndex + want]?.track.locked);
          if (ok) dTracks = want;
        }
        const dup = p.alt;
        const magnetic = S().magnetic;
        const mode: ops.EditMode = (magnetic ? !p.mod : p.mod) ? 'insert' : 'overwrite';
        const ids = blocks.map((b) => b.clip.id);
        const srcTracks = new Set(blocks.map((b) => b.track.id));
        const destTracks = new Set(
          blocks.map((b) => (b.track.kind === anchorRow!.track.kind ? (sameKindRows[b.row.kindIndex + dTracks]?.track.id ?? b.track.id) : b.track.id)),
        );
        const fdt = dt;
        const fdTracks = dTracks;
        const unlinked = !S().linkedSelection;
        const anchorKind = anchorRow.track.kind;
        d.recipe = (draft) => {
          const s = activeSeqOf(draft);
          if (dup) {
            // copy far past the end first so the copies never overwrite the originals, then move them into place
            const park = sequenceDuration(s) + 3600 - minStart;
            const nids = ops.duplicateClips(s, ids, park) ?? [];
            const anchorCopy = nids.find((id) => findClip(s, id)?.track.kind === anchorKind) ?? nids[0];
            if (nids.length) ops.moveClips(s, nids, fdt - park, fdTracks, mode, { anchorId: anchorCopy, unlinked: true });
            created = nids;
          } else {
            ops.moveClips(s, ids, fdt, fdTracks, mode, { anchorId: anchor.id, unlinked });
          }
          if (magnetic) cmd.closeGapsOn(s, [...srcTracks, ...destTracks]);
        };
        d.label = dup ? 'Duplicate clips' : mode === 'insert' ? 'Insert clips' : blocks.length > 1 ? 'Move clips' : 'Move clip';
        d.snapAt = snapAt;
        d.ghosts = blocks.map((b) => {
          const row = b.track.kind === anchorRow!.track.kind ? (sameKindRows[b.row.kindIndex + dTracks] ?? b.row) : b.row;
          return { trackId: row.track.id, start: b.clip.start + dt, end: b.clip.start + b.clip.duration + dt, label: b.clip.name, kind: 'move' as const };
        });
        d.origins = dup ? [] : blocks.map((b) => ({ trackId: b.track.id, start: b.clip.start, end: b.clip.start + b.clip.duration, kind: 'origin' as const }));
        const lines = [`${formatDelta(dt, seq.fps)}${dTracks ? `  track ${dTracks > 0 ? '+' : ''}${dTracks}` : ''}`];
        lines.push(`${dup ? 'Duplicate' : mode === 'insert' ? 'Insert' : 'Overwrite'} · ${formatTimecode(anchor.start + dt, seq.fps, seq.dropFrame, seq.startTimecode)}`);
        d.readout = lines;
        d.cursor = dup ? CURSORS.copy : CURSORS.default;
      },
      up: () => {
        if (!d.moved || !d.recipe) return;
        if (Math.abs(dt) < 1e-9 && dTracks === 0 && !(d.label === 'Duplicate clips')) return;
        if (cmd.editProject(d.label, d.recipe) && d.label === 'Duplicate clips' && created.length) S().selectClips(created);
      },
    };
    return d;
  }

  private trackForwardDown(p: Ptr, h: Hit): Drag | null {
    const st = S();
    const seq = this.seq();
    const t = p.t;
    const tracks = p.shift ? seq.tracks.filter((x) => !x.locked && x.kind !== 'caption') : h.row && !h.row.track.locked ? [h.row.track] : [];
    const clips = tracks.flatMap((tr) => tr.clips.filter((c) => c.start + c.duration > t + 1e-9));
    if (!clips.length) {
      st.clearSelection();
      return null;
    }
    st.selectClips(clips.map((c) => c.id), 'replace');
    const anchor = h.clip && clips.includes(h.clip) ? h.clip : clips.reduce((a, b) => (b.start < a.start ? b : a));
    return this.moveDrag(p, anchor, () => S().selection.clipIds);
  }

  // ---- empty area: gap select / marquee ---------------------------------------
  private emptyDown(p: Ptr, h: Hit): Drag {
    const st = S();
    const additive = p.shift || p.mod;
    const base = additive ? [...st.selection.clipIds] : [];
    if (!additive) {
      st.clearSelection();
      V().setTransition(null);
    }
    const d: Drag = {
      ...baseDrag('Select'),
      move: (q) => {
        V().setGap(null);
        d.marquee = { x0: p.x, y0: p.y, x1: q.x, y1: q.y };
        const view = V();
        const zoom = S().zoom;
        const ta = view.t0 + Math.min(p.x, q.x) / zoom;
        const tb = view.t0 + Math.max(p.x, q.x) / zoom;
        const ya = Math.min(p.cy, q.cy);
        const yb = Math.max(p.cy, q.cy);
        const seq = this.seq();
        const layout = layoutTracks(seq.tracks);
        const hits: string[] = [];
        const cues: string[] = [];
        for (const row of layout.rows) {
          if (row.y + row.h < ya || row.y > yb) continue;
          for (const c of clipsInRange(row.track, ta, tb)) hits.push(c.id);
          for (const q2 of cuesInRange(row.track, ta, tb)) cues.push(q2.id);
        }
        S().selectClips([...new Set([...base, ...hits])], 'replace');
        S().select({ cueIds: cues });
      },
      up: () => {
        if (d.moved) return;
        // click in an empty lane: select the gap up to the next clip
        const tr = h.row?.track;
        if (!tr || tr.kind === 'caption') return V().setGap(null);
        const t = h.t;
        let prevEnd = 0;
        let nextStart: number | null = null;
        for (const c of tr.clips) {
          const e = c.start + c.duration;
          if (e <= t + 1e-9) prevEnd = Math.max(prevEnd, e);
          if (c.start >= t - 1e-9) nextStart = nextStart === null ? c.start : Math.min(nextStart, c.start);
        }
        if (nextStart !== null && nextStart - prevEnd > 1e-6) V().setGap({ trackId: tr.id, start: prevEnd, end: nextStart });
        else V().setGap(null);
      },
    };
    return d;
  }

  // ---- trims ------------------------------------------------------------------
  private trimDrag(p0: Ptr, clip: Clip, edge: 'start' | 'end', mode: 'normal' | 'ripple' | 'roll' | 'rate'): Drag {
    const seq = this.seq();
    const project = S().project!;
    const track = seq.tracks.find((t) => t.clips.some((c) => c.id === clip.id))!;
    const fr = 1 / exactRate(seq.fps);
    const end0 = clip.start + clip.duration;
    const edgeT = edge === 'start' ? clip.start : end0;
    const grab = edgeT - p0.t;
    const exclude = new Set([clip.id]);
    if (mode === 'roll') {
      for (const o of track.clips) {
        if (edge === 'end' && Math.abs(o.start - end0) < 1e-4) exclude.add(o.id);
        if (edge === 'start' && Math.abs(o.start + o.duration - clip.start) < 1e-4) exclude.add(o.id);
      }
    }
    const sn = this.snapper({ excludeClipIds: exclude });
    const unlinked = !S().linkedSelection;
    let range: { min: number; max: number } | null = null;
    if (mode !== 'rate') {
      try {
        range = ops.trimRange(project, seq, clip.id, edge, mode, { unlinked });
      } catch {
        range = null;
      }
    }
    const labels = { normal: 'Trim', ripple: 'Ripple trim', roll: 'Roll edit', rate: 'Rate stretch' } as const;
    let newT = edgeT;
    const d: Drag = {
      ...baseDrag(labels[mode]),
      cursor: edge === 'start' ? (mode === 'ripple' ? CURSORS.rippleStart : mode === 'roll' ? CURSORS.roll : mode === 'rate' ? CURSORS.rate : CURSORS.trimStart) : mode === 'ripple' ? CURSORS.rippleEnd : mode === 'roll' ? CURSORS.roll : mode === 'rate' ? CURSORS.rate : CURSORS.trimEnd,
      move: (p) => {
        const r = this.snapT(sn, p.t + grab);
        let t = r.t;
        if (edge === 'start') t = Math.min(t, end0 - fr);
        else t = Math.max(t, clip.start + fr);
        t = Math.max(0, t);
        if (range) t = Math.max(range.min, Math.min(range.max, t));
        newT = t;
        d.snapAt = Math.abs(t - (r.at ?? NaN)) < 1e-9 ? r.at : null;
        const ft = t;
        let applied: number | null = null;
        d.recipe = (draft) => {
          const s = activeSeqOf(draft);
          applied = mode === 'rate' ? ops.rateStretch(draft, s, clip.id, edge, ft, { unlinked }) : ops.trimClip(draft, s, clip.id, edge, ft, mode, { unlinked });
        };
        const ns = edge === 'start' ? t : clip.start;
        const ne = edge === 'end' ? t : end0;
        d.ghosts = [{ trackId: track.id, start: ns, end: ne, kind: 'trim' }];
        d.origins = [{ trackId: track.id, start: clip.start, end: end0, kind: 'origin' }];
        const requested = t - edgeT;
        d.readoutFn = (ok) => {
          const delta = ok && applied !== null ? applied : requested;
          const dur = clip.duration + (edge === 'end' ? delta : -delta);
          const lines = [`${formatDelta(delta, seq.fps)}`, `Duration ${formatTimecode(dur, seq.fps, seq.dropFrame)}`];
          if (mode === 'rate') lines.push(`Speed ${Math.round(((clip.speed * clip.duration) / Math.max(fr, dur)) * 1000) / 10}%`);
          if (ok && applied === 0 && Math.abs(requested) > 1e-9) lines.push(blockedReason(mode));
          return lines;
        };
      },
      up: () => {
        if (!d.moved || !d.recipe || Math.abs(newT - edgeT) < 1e-9) return;
        const before = S().project;
        if (cmd.editProject(d.label, d.recipe) && S().project === before) cmd.toast(blockedReason(mode));
      },
    };
    return d;
  }

  private slipDrag(p0: Ptr, clip: Clip): Drag {
    const seq = this.seq();
    const project = S().project!;
    const asset = clip.assetId ? project.assets.find((a) => a.id === clip.assetId) : undefined;
    const fr = 1 / exactRate(seq.fps);
    const span = sourceSpan(clip);
    let delta = 0;
    const d: Drag = {
      ...baseDrag('Slip', false),
      cursor: CURSORS.slip,
      move: (p) => {
        const dt = Math.round((p.t - p0.t) / fr) * fr;
        let sd = -dt * clip.speed * (clip.reverse ? -1 : 1);
        if (asset && asset.kind !== 'image') sd = Math.max(-clip.inPoint, Math.min(asset.duration - (clip.inPoint + span), sd));
        else if (clip.kind === 'sequence') sd = Math.max(-clip.inPoint, sd);
        delta = sd;
        const fsd = sd;
        const unlinked = !S().linkedSelection;
        let applied: number | null = null;
        d.recipe = (draft) => void (applied = ops.slipClip(draft, activeSeqOf(draft), clip.id, fsd, { unlinked }));
        d.readoutFn = (ok) => {
          const a = ok && applied !== null ? applied : sd;
          const inT = clip.inPoint + a;
          return [`In ${formatTimecode(inT, seq.fps, seq.dropFrame)}`, `Out ${formatTimecode(inT + span, seq.fps, seq.dropFrame)}`, `${formatDelta(a, seq.fps)}`];
        };
      },
      up: () => {
        if (!d.moved || !d.recipe || Math.abs(delta) < 1e-9) return;
        cmd.editProject('Slip', d.recipe);
      },
    };
    return d;
  }

  private slideDrag(p0: Ptr, clip: Clip): Drag {
    const seq = this.seq();
    const track = seq.tracks.find((t) => t.clips.some((c) => c.id === clip.id))!;
    const fr = 1 / exactRate(seq.fps);
    const prev = track.clips.find((o) => Math.abs(o.start + o.duration - clip.start) < 1e-4);
    const next = track.clips.find((o) => Math.abs(o.start - (clip.start + clip.duration)) < 1e-4);
    const exclude = new Set([clip.id, ...(prev ? [prev.id] : []), ...(next ? [next.id] : [])]);
    const sn = this.snapper({ excludeClipIds: exclude });
    let delta = 0;
    const d: Drag = {
      ...baseDrag('Slide'),
      cursor: CURSORS.slide,
      move: (p) => {
        let dt = Math.round((p.t - p0.t) / fr) * fr;
        let snapAt: number | null = null;
        if (sn) {
          const r = snapBlock(sn, clip.start, clip.start + clip.duration, dt, SNAP_PX / S().zoom);
          dt = r.delta;
          snapAt = r.at;
        }
        // stay between the neighbours (each keeps at least one frame)
        const lo = prev ? prev.start + fr - clip.start : -clip.start;
        const hi = next ? next.start + next.duration - fr - (clip.start + clip.duration) : Infinity;
        dt = Math.max(lo, Math.min(hi, dt));
        delta = dt;
        const fdt = dt;
        d.snapAt = snapAt;
        const unlinked = !S().linkedSelection;
        let applied: number | null = null;
        d.recipe = (draft) => void (applied = ops.slideClip(draft, activeSeqOf(draft), clip.id, fdt, { unlinked }));
        d.ghosts = [{ trackId: track.id, start: clip.start + dt, end: clip.start + clip.duration + dt, label: clip.name, kind: 'move' }];
        d.origins = [{ trackId: track.id, start: clip.start, end: clip.start + clip.duration, kind: 'origin' }];
        d.readoutFn = (ok) => {
          const a = ok && applied !== null ? applied : fdt;
          const lines = [formatDelta(a, seq.fps)];
          if (prev) lines.push(`${prev.name}: ${formatTimecode(prev.duration + a, seq.fps, seq.dropFrame)}`);
          if (next) lines.push(`${next.name}: ${formatTimecode(next.duration - a, seq.fps, seq.dropFrame)}`);
          if (ok && applied === 0 && Math.abs(fdt) > 1e-9) lines.push('Blocked: the neighbours have no more media');
          return lines;
        };
      },
      up: () => {
        if (!d.moved || !d.recipe || Math.abs(delta) < 1e-9) return;
        cmd.editProject('Slide', d.recipe);
      },
    };
    return d;
  }

  // ---- fades, rubber band, keyframes -------------------------------------------
  private fadeDrag(_p0: Ptr, clip: Clip, side: 'in' | 'out', audio: boolean): Drag {
    const seq = this.seq();
    const fr = 1 / exactRate(seq.fps);
    const sn = this.snapper({ excludeClipIds: new Set([clip.id]) });
    const cur = audio ? { i: clip.audio.fadeIn, o: clip.audio.fadeOut } : { i: clip.fadeIn, o: clip.fadeOut };
    let v = side === 'in' ? cur.i : cur.o;
    const d: Drag = {
      ...baseDrag(side === 'in' ? 'Fade in' : 'Fade out'),
      cursor: CURSORS.ew,
      move: (p) => {
        const r = this.snapT(sn, p.t);
        const raw = side === 'in' ? r.t - clip.start : clip.start + clip.duration - r.t;
        const max = Math.max(0, clip.duration - (side === 'in' ? cur.o : cur.i));
        v = Math.max(0, Math.min(max, Math.round(raw / fr) * fr));
        d.snapAt = r.at;
        const fv = v;
        d.recipe = (draft) => {
          const f = findClip(activeSeqOf(draft), clip.id);
          if (!f) return;
          if (audio) f.clip.audio[side === 'in' ? 'fadeIn' : 'fadeOut'] = fv;
          else f.clip[side === 'in' ? 'fadeIn' : 'fadeOut'] = fv;
        };
        d.readout = [`Fade ${side} ${formatTimecode(v, seq.fps, seq.dropFrame)}`, `${Math.round(v / fr)} frames`];
      },
      up: () => {
        if (!d.moved || !d.recipe) return;
        cmd.editProject(d.label, d.recipe);
      },
    };
    return d;
  }

  private bandRowGeom(clip: Clip): { top: number; bottom: number } | null {
    const seq = this.seq();
    const layout = layoutTracks(seq.tracks);
    const row = layout.rows.find((r) => r.track.clips.some((c) => c.id === clip.id));
    if (!row) return null;
    const ry = row.y - V().scrollY + 1;
    return bandArea(ry, row.h - 3);
  }

  private bandDrag(p0: Ptr, clip: Clip, trackKind: string): Drag {
    const path = bandPath(trackKind);
    const geom = this.bandRowGeom(clip)!;
    const kfs = clip.keyframes[path];
    const local0 = p0.t - clip.start;
    const v0 = paramAt(clip, path, local0);
    // which keyframes the segment drag moves
    let seg: number[] = [];
    if (kfs?.length) {
      let i = kfs.findIndex((k) => k.t > local0);
      if (i === -1) seg = [kfs.length - 1];
      else if (i === 0) seg = [0];
      else seg = [i - 1, i];
    }
    const posAt = (y: number) => (geom.bottom - y) / (geom.bottom - geom.top);
    let value = v0;
    const d: Drag = {
      ...baseDrag(path === 'audio.gain' ? 'Clip volume' : 'Opacity', false),
      cursor: CURSORS.ns,
      move: (p) => {
        const dv = bandValue(path, posAt(p.y)) - bandValue(path, posAt(p0.y));
        value = v0 + dv;
        const fdv = dv;
        d.recipe = (draft) => {
          const f = findClip(activeSeqOf(draft), clip.id);
          if (!f) return;
          const c = f.clip;
          const clampV = (v: number) => (path === 'audio.gain' ? Math.round(Math.max(-96, Math.min(GAIN_LIMIT, v)) * 10) / 10 : Math.max(0, Math.min(1, v)));
          const list = c.keyframes[path];
          if (list?.length && seg.length) {
            for (const i of seg) if (list[i]) list[i].v = clampV(kfs![i].v + fdv);
          } else setStatic(c, path, clampV(v0 + fdv));
        };
        d.readout = [fmtBand(path, path === 'audio.gain' ? Math.min(GAIN_LIMIT, value) : Math.max(0, Math.min(1, value)))];
      },
      up: () => {
        if (!d.moved || !d.recipe) return;
        cmd.editProject(d.label, d.recipe);
      },
    };
    return d;
  }

  /** Drags one rubber-band keyframe (time + value). `adding` = pen click that creates it. */
  private keyDrag(p0: Ptr, clip: Clip, trackKind: string, index: number, adding: boolean, addAt?: { t: number; v: number }): Drag {
    const st = S();
    const seq = this.seq();
    const path = bandPath(trackKind);
    const geom = this.bandRowGeom(clip)!;
    const fr = 1 / exactRate(seq.fps);
    const kfs = clip.keyframes[path] ?? [];
    const k0 = adding ? addAt! : { t: kfs[index].t, v: kfs[index].v };
    const lo = adding ? 0 : index > 0 ? kfs[index - 1].t + fr : 0;
    const hi = adding ? clip.duration : index < kfs.length - 1 ? kfs[index + 1].t - fr : clip.duration;
    // pen Ctrl/Alt-click removes the keyframe
    if (!adding && st.tool === 'pen' && (p0.mod || p0.alt)) {
      cmd.editSeq('Delete keyframe', (s) => {
        const f = findClip(s, clip.id);
        const list = f?.clip.keyframes[path];
        if (!list) return;
        const i = list.findIndex((k) => Math.abs(k.t - k0.t) < 1e-6);
        if (i >= 0) list.splice(i, 1);
        if (!list.length) delete f!.clip.keyframes[path];
      });
      return { ...baseDrag('Delete keyframe', false), move: () => undefined, up: () => undefined };
    }
    let cur = { ...k0 };
    const write = (draft: Project, t: number, v: number) => {
      const f = findClip(activeSeqOf(draft), clip.id);
      if (!f) return;
      const c = f.clip;
      if (adding) {
        setKeyframe(c, path, t, v);
        return;
      }
      const list = c.keyframes[path];
      const k = list?.find((x) => Math.abs(x.t - k0.t) < 1e-6);
      if (!k) return;
      k.t = t;
      k.v = v;
      list!.sort((a, b) => a.t - b.t);
    };
    const clampV = (v: number) => (path === 'audio.gain' ? Math.round(Math.max(GAIN_MIN, Math.min(GAIN_LIMIT, v)) * 10) / 10 : Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000);
    const d: Drag = {
      ...baseDrag(adding ? 'Add keyframe' : 'Move keyframe', false),
      cursor: CURSORS.move,
      recipe: adding ? (draft) => write(draft, k0.t, k0.v) : null,
      move: (p) => {
        const pos = (geom.bottom - p.y) / (geom.bottom - geom.top);
        const v = clampV(p.shift ? k0.v : bandValue(path, pos));
        let t = p.t - clip.start;
        t = Math.round(t / fr) * fr;
        t = Math.max(lo, Math.min(hi, t));
        if (Math.abs(p.y - p0.y) > Math.abs(p.x - p0.x) * 2) t = k0.t; // mostly vertical: keep time
        cur = { t, v };
        d.recipe = (draft) => write(draft, cur.t, cur.v);
        d.readout = [fmtBand(path, v), `@ ${formatTimecode(clip.start + t, seq.fps, seq.dropFrame, seq.startTimecode)}`];
      },
      up: () => {
        if (!d.recipe) return;
        if (!adding && !d.moved) return;
        cmd.editProject(d.label, d.recipe);
      },
    };
    return d;
  }

  private laneDrag(p0: Ptr, clip: Clip, keyT: number, locked: boolean): Drag {
    const st = S();
    const seq = this.seq();
    const fr = 1 / exactRate(seq.fps);
    const paths = Object.entries(clip.keyframes)
      .filter(([, list]) => list.some((k) => Math.abs(k.t - keyT) < KEY_TOLERANCE / 4))
      .map(([path]) => path);
    st.select({ keyframes: paths.map((path) => ({ clipId: clip.id, path, t: keyT })) });
    const sn = this.snapper({ excludeClipIds: new Set() });
    let nt = keyT;
    const d: Drag = {
      ...baseDrag('Move keyframes'),
      cursor: CURSORS.ew,
      move: (p) => {
        if (locked) return;
        const r = this.snapT(sn, clip.start + keyT + (p.t - p0.t));
        nt = Math.max(0, Math.min(clip.duration, Math.round((r.t - clip.start) / fr) * fr));
        d.snapAt = r.at;
        const fnt = nt;
        d.recipe = (draft) => {
          const f = findClip(activeSeqOf(draft), clip.id);
          if (!f) return;
          for (const path of paths) {
            const list = f.clip.keyframes[path];
            const k = list?.find((x) => Math.abs(x.t - keyT) < KEY_TOLERANCE / 4);
            if (!k || !list) continue;
            // replace a keyframe already at the destination
            const clash = list.findIndex((x) => x !== k && Math.abs(x.t - fnt) < 1e-6);
            if (clash >= 0) list.splice(clash, 1);
            k.t = fnt;
            list.sort((a, b) => a.t - b.t);
          }
        };
        d.readout = [formatDelta(nt - keyT, seq.fps), `@ ${formatTimecode(clip.start + nt, seq.fps, seq.dropFrame, seq.startTimecode)}`];
      },
      up: () => {
        if (!d.moved) {
          transport.seek(clip.start + keyT);
          return;
        }
        if (!d.recipe || Math.abs(nt - keyT) < 1e-9) return;
        if (cmd.editProject('Move keyframes', d.recipe)) S().select({ keyframes: paths.map((path) => ({ clipId: clip.id, path, t: nt })) });
      },
    };
    return d;
  }

  private penDown(p: Ptr, h: Hit): Drag | null {
    if (!h.clip || !h.row) return this.emptyDown(p, h);
    const clip = h.clip;
    if (h.row.track.locked) return null;
    this.ensureSelected(clip.id, p);
    if (h.zone === 'bandKey') return this.keyDrag(p, clip, h.row.track.kind, h.keyIndex!, false);
    if (h.zone === 'band') {
      const path = bandPath(h.row.track.kind);
      const local = Math.max(0, Math.min(clip.duration, snapToFrame(p.t - clip.start, this.seq().fps)));
      return this.keyDrag(p, clip, h.row.track.kind, -1, true, { t: local, v: paramAt(clip, path, local) });
    }
    return null;
  }

  // ---- transitions ----------------------------------------------------------------
  private transitionDown(_p: Ptr, h: Hit): Drag | null {
    const span = h.span!;
    const st = S();
    st.select({ clipIds: [], keyframes: [] });
    V().setGap(null);
    V().setTransition({ clipId: span.clipId, edge: span.edge });
    if (h.row?.track.locked || h.zone === 'transition') return { ...baseDrag('Select transition', false), move: () => undefined, up: () => undefined };
    const seq = this.seq();
    const fr = 1 / exactRate(seq.fps);
    const track = h.row!.track;
    const owner = track.clips.find((c) => c.id === span.clipId)!;
    const prev = span.edge === 'in' ? track.clips.find((o) => Math.abs(o.start + o.duration - owner.start) < 1e-4) : undefined;
    const maxD = 2 * Math.min(owner.duration, prev ? prev.duration : owner.duration);
    let dur = span.tr.duration;
    const d: Drag = {
      ...baseDrag('Transition duration'),
      cursor: CURSORS.ew,
      move: (q) => {
        const half = Math.abs(q.t - span.cut);
        dur = Math.max(2 * fr, Math.min(maxD, Math.round((2 * half) / (2 * fr)) * 2 * fr));
        const fd = dur;
        d.recipe = (draft) => {
          const f = findClip(activeSeqOf(draft), span.clipId);
          const t = f && (span.edge === 'in' ? f.clip.transitionIn : f.clip.transitionOut);
          if (t) t.duration = fd;
        };
        d.readout = [`Duration ${formatTimecode(dur, seq.fps, seq.dropFrame)}`, `${Math.round(dur / fr)} frames`];
      },
      up: () => {
        if (!d.moved || !d.recipe) return;
        cmd.editProject(d.label, d.recipe);
      },
    };
    return d;
  }

  // ---- captions --------------------------------------------------------------------
  private cueDown(p: Ptr, h: Hit): Drag | null {
    const st = S();
    const track = h.row?.track;
    if (!track) return null;
    const tool = st.tool;
    if (!h.cue) return this.emptyDown(p, h);
    const q = h.cue;
    if (tool === 'razor') {
      const t = snapToFrame(p.t, this.seq().fps);
      if (t > q.start && t < q.end && !track.locked)
        cmd.editSeq('Split caption', (s) => {
          const tr = s.tracks.find((x) => x.id === track.id);
          const c = tr?.cues.find((x) => x.id === q.id);
          if (!tr || !c) return;
          tr.cues.push({ ...c, id: `cue_${crypto.randomUUID().slice(0, 8)}`, start: t });
          c.end = t;
        });
      return null;
    }
    const sel = st.selection.cueIds;
    if (p.shift || p.mod) st.select({ cueIds: sel.includes(q.id) ? sel.filter((x) => x !== q.id) : [...sel, q.id] });
    else if (!sel.includes(q.id)) st.select({ cueIds: [q.id], clipIds: [], keyframes: [] });
    if (track.locked) return null;
    const seq = this.seq();
    const fr = 1 / exactRate(seq.fps);
    const part = h.zone === 'cueStart' ? 'start' : h.zone === 'cueEnd' ? 'end' : 'move';
    const sn = this.snapper({ excludeCueIds: new Set([q.id]) });
    const sorted = [...track.cues].sort((a, b) => a.start - b.start);
    const i = sorted.findIndex((x) => x.id === q.id);
    const prevEnd = i > 0 ? sorted[i - 1].end : 0;
    const nextStart = i < sorted.length - 1 ? sorted[i + 1].start : Infinity;
    let ns = q.start;
    let ne = q.end;
    const d: Drag = {
      ...baseDrag(part === 'move' ? 'Move caption' : 'Trim caption'),
      cursor: part === 'move' ? CURSORS.default : CURSORS.ew,
      move: (pp) => {
        const delta = pp.t - p.t;
        if (part === 'move') {
          let dt = Math.round(delta / fr) * fr;
          let snapAt: number | null = null;
          if (sn) {
            const r = snapBlock(sn, q.start, q.end, dt, SNAP_PX / S().zoom);
            dt = r.delta;
            snapAt = r.at;
          }
          dt = Math.max(prevEnd - q.start, Math.min(nextStart - q.end, dt));
          ns = q.start + dt;
          ne = q.end + dt;
          d.snapAt = snapAt;
          d.readout = [formatDelta(dt, seq.fps), formatTimecode(ns, seq.fps, seq.dropFrame, seq.startTimecode)];
        } else if (part === 'start') {
          const r = this.snapT(sn, q.start + delta);
          ns = Math.max(prevEnd, Math.min(q.end - fr, r.t));
          d.snapAt = r.at;
          d.readout = [formatDelta(ns - q.start, seq.fps), `Duration ${formatTimecode(ne - ns, seq.fps, seq.dropFrame)}`];
        } else {
          const r = this.snapT(sn, q.end + delta);
          ne = Math.min(nextStart, Math.max(q.start + fr, r.t));
          d.snapAt = r.at;
          d.readout = [formatDelta(ne - q.end, seq.fps), `Duration ${formatTimecode(ne - ns, seq.fps, seq.dropFrame)}`];
        }
        const a = ns;
        const b = ne;
        d.recipe = (draft) => {
          const tr = activeSeqOf(draft).tracks.find((x) => x.id === track.id);
          const c = tr?.cues.find((x) => x.id === q.id);
          if (!c) return;
          c.start = a;
          c.end = b;
        };
      },
      up: () => {
        if (!d.moved || !d.recipe) return;
        cmd.editProject(d.label, d.recipe);
      },
    };
    return d;
  }

  // ---- razor, hand, zoom ------------------------------------------------------------
  private razorPreview(p: Ptr, h: Hit): { t: number; trackIds: Set<string> | null } | null {
    if (!h.row || h.row.track.locked) return null;
    const sn = this.snapper({});
    const t = this.snapT(sn, p.t).t;
    if (p.shift) return { t, trackIds: null };
    const ids = new Set([h.row.track.id]);
    const st = S();
    if (h.clip && st.linkedSelection && !p.alt && h.clip.linkId) {
      for (const tr of this.seq().tracks) if (tr.clips.some((c) => c.linkId === h.clip!.linkId)) ids.add(tr.id);
    }
    return { t, trackIds: ids };
  }

  private razorClick(p: Ptr, h: Hit) {
    const st = S();
    const seq = this.seq();
    const sn = this.snapper({});
    const t = this.snapT(sn, p.t).t;
    const inside = (c: Clip) => t > c.start + 1e-6 && t < c.start + c.duration - 1e-6;
    if (p.shift) {
      if (!seq.tracks.some((tr) => !tr.locked && tr.clips.some(inside))) return;
      cmd.editSeq('Razor all tracks', (s) => void ops.splitAllTracks(s, t));
      return;
    }
    if (!h.clip || h.row?.track.locked || !inside(h.clip)) return;
    cmd.splitClipsAt([h.clip.id], t, 'Razor', p.alt || !st.linkedSelection);
  }

  private handDrag(p0: Ptr): Drag {
    const v0 = { t0: V().t0, y: V().scrollY };
    const d: Drag = {
      ...baseDrag('Scroll', false),
      cursor: CURSORS.grabbing,
      move: (p) => {
        const zoom = S().zoom;
        V().setT0(v0.t0 - (p.x - p0.x) / zoom);
        const layout = layoutTracks(this.seq().tracks);
        V().setScrollY(Math.min(Math.max(0, layout.height - this.sizeH + 40), Math.max(0, v0.y - (p.y - p0.y))));
      },
      up: () => undefined,
    };
    return d;
  }

  private zoomDrag(p0: Ptr): Drag {
    const d: Drag = {
      ...baseDrag('Zoom', false),
      move: (p) => {
        d.zoomRange = { a: p0.t, b: V().t0 + p.x / S().zoom };
      },
      up: (p) => {
        const st = S();
        if (d.moved && Math.abs(p.x - p0.x) > 6) {
          const a = Math.min(p0.t, d.zoomRange!.b);
          const b = Math.max(p0.t, d.zoomRange!.b);
          st.setZoom((this.sizeW - 24) / Math.max(1e-3, b - a));
          V().setT0(a - 12 / S().zoom);
          return;
        }
        zoomAround(p0.t, st.zoom * (p0.alt ? 1 / 2 : 2));
      },
    };
    return d;
  }

  // ===================================================================== double-click / menus
  private onDblClick(e: MouseEvent) {
    const st = S();
    if (!st.project) return;
    const p = this.ptr(e);
    const h = this.hitTest(p.x, p.y);
    if (h.span && h.zone?.startsWith('transition')) {
      V().setTransitionPop({ clipId: h.span.clipId, edge: h.span.edge, x: e.clientX, y: e.clientY });
      return;
    }
    if (h.cue && h.row && h.rect) {
      this.editCue(h.row.track.id, h.cue.id);
      return;
    }
    const c = h.clip;
    if (!c || h.zone === 'band' || h.zone === 'bandKey' || h.zone === 'keyLane') return;
    if (c.kind === 'sequence') {
      cmd.openNested(c.id);
      return;
    }
    if (c.assetId && (st.tool === 'select' || st.tool === 'text')) {
      const local = Math.max(0, Math.min(p.t - c.start, c.duration));
      const asset = st.project.assets.find((a) => a.id === c.assetId);
      if (asset) st.setSource({ assetId: asset.id, time: Math.max(0, sourceTimeAt(c, local)) });
    }
  }

  editCue(trackId: string, cueId: string) {
    const seq = this.seq();
    const tr = seq.tracks.find((t) => t.id === trackId);
    const q = tr?.cues.find((x) => x.id === cueId);
    if (!tr || !q) return;
    const layout = layoutTracks(seq.tracks);
    const row = layout.rows.find((r) => r.track.id === trackId);
    if (!row) return;
    const box = this.canvas.getBoundingClientRect();
    const x0 = Math.max(0, this.X(q.start));
    const x1 = Math.min(this.sizeW, this.X(q.end));
    V().setInline({ kind: 'cue', trackId, cueId, x: box.left + x0, y: box.top + row.y - V().scrollY + 1, w: Math.max(200, x1 - x0), h: Math.max(28, row.h - 3) });
  }

  private onContextMenu(e: MouseEvent) {
    e.preventDefault();
    const st = S();
    if (!st.project) return;
    const p = this.ptr(e);
    const h = this.hitTest(p.x, p.y);
    const at = (items: ReturnType<typeof clipMenu>, testId?: string) => items.length && V().openMenu({ x: e.clientX, y: e.clientY, items, testId });
    if (h.span && h.zone?.startsWith('transition') && h.row) {
      V().setTransition({ clipId: h.span.clipId, edge: h.span.edge });
      at(transitionMenu(h.span.clipId, h.span.edge, h.row.track.kind === 'audio', e.clientX, e.clientY), 'tl-transition-menu');
      return;
    }
    if (h.cue && h.row) {
      st.select({ cueIds: [h.cue.id] });
      const tid = h.row.track.id;
      const qid = h.cue.id;
      at(cueMenu(tid, qid, () => this.editCue(tid, qid)), 'tl-cue-menu');
      return;
    }
    if (h.clip) {
      if (!st.selection.clipIds.includes(h.clip.id)) st.selectClips([h.clip.id]);
      at(clipMenu(h.clip.id, p.t), 'tl-clip-menu');
      return;
    }
    if (h.row) {
      if (h.row.track.kind !== 'caption') {
        // select the gap under the pointer so "Close Gap" applies to it
        this.emptyDown(p, h).up(p);
      }
      at(laneMenu(h.row.track, p.t), 'tl-lane-menu');
    }
  }

  // ===================================================================== ruler
  private rulerHit(x: number, y: number): { marker?: { id: string; part: 'move' | 'end' }; t: number } {
    const seq = this.seq();
    const t = V().t0 + x / S().zoom;
    if (y <= MARKER_ROW_H + 2) {
      let best: { id: string; part: 'move' | 'end'; d: number } | null = null;
      for (const m of seq.markers) {
        const mx = this.X(m.time);
        const off = m.kind === 'chapter' ? 3.5 : 0;
        const dx = Math.abs(x - (mx + off));
        if (dx <= 7 && (!best || dx < best.d)) best = { id: m.id, part: 'move', d: dx };
        if (m.duration > 0) {
          const ex = this.X(m.time + m.duration);
          const de = Math.abs(x - ex);
          if (de <= 4 && (!best || de < best.d)) best = { id: m.id, part: 'end', d: de };
          if (!best && x > mx && x < ex) best = { id: m.id, part: 'move', d: 99 };
        }
      }
      if (best) return { marker: { id: best.id, part: best.part }, t };
    }
    return { t };
  }

  private onRulerMove(e: PointerEvent) {
    if (this.drag) {
      const p = this.ptr(e, this.ruler);
      this.lastPtr = { ...p, y: Math.max(0, p.y) };
      if (!this.drag.moved && this.downPtr && Math.abs(p.x - this.downPtr.x) < 2) return;
      this.drag.moved = true;
      this.drag.move(p);
      this.drag.version++;
      this.invalidate();
      return;
    }
    const box = this.ruler.getBoundingClientRect();
    const h = this.rulerHit(e.clientX - box.left, e.clientY - box.top);
    this.ruler.style.cursor = h.marker ? (h.marker.part === 'end' ? 'ew-resize' : 'pointer') : 'text';
  }

  private onRulerDown(e: PointerEvent) {
    const st = S();
    if (!st.project || e.button !== 0) return;
    V().openMenu(null);
    const box = this.ruler.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const p = this.ptr(e, this.ruler);
    this.downPtr = p;
    this.lastPtr = p;
    const h = this.rulerHit(x, y);
    const seq = this.seq();
    if (h.marker) {
      const m = seq.markers.find((mm) => mm.id === h.marker!.id)!;
      const sel = st.selection.markerIds;
      if (e.shiftKey) st.select({ markerIds: sel.includes(m.id) ? sel.filter((i) => i !== m.id) : [...sel, m.id] });
      else if (!sel.includes(m.id)) st.select({ markerIds: [m.id] });
      const sn = this.snapper({ excludeMarkerIds: new Set([m.id]) });
      const part = h.marker.part;
      const fr = 1 / exactRate(seq.fps);
      let nt = m.time;
      let nd = m.duration;
      const d: Drag = {
        ...baseDrag(part === 'end' ? 'Marker duration' : 'Move marker'),
        move: (q) => {
          if (part === 'move') {
            const r = this.snapT(sn, m.time + (q.t - p.t));
            nt = Math.max(0, r.t);
            d.snapAt = r.at;
            d.readout = null;
          } else {
            const r = this.snapT(sn, m.time + m.duration + (q.t - p.t));
            nd = Math.max(fr, r.t - m.time);
            d.snapAt = r.at;
          }
          const a = nt;
          const b = nd;
          d.recipe = (draft) => {
            const mk = activeSeqOf(draft).markers.find((x) => x.id === m.id);
            if (!mk) return;
            mk.time = a;
            mk.duration = part === 'end' ? b : mk.duration;
          };
        },
        up: () => {
          if (!d.moved) {
            transport.seek(m.time);
            return;
          }
          if (d.recipe) cmd.editProject(d.label, d.recipe);
        },
      };
      this.startDrag(d, e);
      return;
    }
    // scrub
    if (transport.isPlaying()) transport.pause();
    st.select({ markerIds: [] });
    const sn = makeSnapper(snapPointsFor(seq, { keyframes: false }));
    const seekTo = (q: Ptr) => {
      let t = Math.max(0, q.t);
      if (q.shift) {
        const hit = sn.nearest(t, SNAP_PX / S().zoom);
        if (hit) t = hit.t;
      }
      const max = Math.max(sequenceDuration(this.seq()), 0);
      transport.seek(Math.min(snapToFrame(t, seq.fps), max > 0 ? max : t));
    };
    seekTo(p);
    const d: Drag = {
      ...baseDrag('Scrub'),
      move: (q) => seekTo(q),
      up: () => undefined,
    };
    this.startDrag(d, e);
  }

  private onRulerDblClick(e: MouseEvent) {
    const box = this.ruler.getBoundingClientRect();
    const h = this.rulerHit(e.clientX - box.left, e.clientY - box.top);
    if (h.marker) S().openModal('timeline.marker', { markerId: h.marker.id });
  }

  private onRulerContext(e: MouseEvent) {
    e.preventDefault();
    const box = this.ruler.getBoundingClientRect();
    const h = this.rulerHit(e.clientX - box.left, e.clientY - box.top);
    const seq = this.seq();
    const marker = h.marker ? (seq.markers.find((m) => m.id === h.marker!.id) ?? null) : null;
    if (marker) S().select({ markerIds: [marker.id] });
    V().openMenu({ x: e.clientX, y: e.clientY, items: rulerMenu(h.t, marker), testId: 'tl-ruler-menu' });
  }

  // ===================================================================== drag & drop
  private dropTypes(e: DragEvent): 'assets' | 'effect' | 'transition' | null {
    const types = Array.from(e.dataTransfer?.types ?? []);
    if (types.includes('omega/asset') || types.includes('omega/assets')) return 'assets';
    if (types.includes('omega/effect')) return 'effect';
    if (types.includes('omega/transition')) return 'transition';
    return null;
  }

  /** Video/audio destination tracks for a drop at a row (V1↔A1 pairing). */
  private dropTracks(row: TrackRow | null): { video: Track | null; audio: Track | null } {
    const seq = this.seq();
    const vids = seq.tracks.filter((t) => t.kind === 'video');
    const auds = seq.tracks.filter((t) => t.kind === 'audio');
    if (!row || row.track.kind === 'caption') return cmd.insertTargets(seq);
    if (row.track.kind === 'video') {
      const fromBottom = vids.length - 1 - row.kindIndex;
      return { video: row.track, audio: auds[Math.min(auds.length - 1, fromBottom)] ?? null };
    }
    const vi = vids.length - 1 - row.kindIndex;
    return { video: vids[Math.max(0, Math.min(vids.length - 1, vi))] ?? null, audio: row.track };
  }

  private dragAssets(e: DragEvent | null): MediaAsset[] {
    const st = S();
    const p = st.project!;
    let ids: string[] = [];
    if (e?.dataTransfer) {
      try {
        const many = e.dataTransfer.getData('omega/assets');
        if (many) ids = JSON.parse(many);
      } catch {
        ids = [];
      }
      const one = e.dataTransfer.getData('omega/asset');
      if (!ids.length && one) ids = [one];
    }
    // during dragover the payload is not readable: use the media selection as the preview
    if (!ids.length) ids = st.selection.assetIds;
    return ids.map((id) => p.assets.find((a) => a.id === id)).filter((a): a is MediaAsset => !!a);
  }

  private assetLength(a: MediaAsset): number {
    const p = S().project!;
    if (a.kind === 'image') return p.settings.stillDuration || 5;
    const i = a.markIn ?? 0;
    const o = a.markOut ?? a.duration;
    return Math.max(1 / 30, o - i);
  }

  private onDragOver(e: DragEvent) {
    const kind = this.dropTypes(e);
    if (!kind || !S().project) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    const p = this.ptr(e);
    this.lastPtr = p;
    if (kind === 'assets') {
      const { video, audio } = this.dropTracks(p.row);
      const sn = this.snapper({});
      const r = this.snapT(sn, Math.max(0, p.t));
      let t = r.t;
      const ghosts: Ghost[] = [];
      const assets = this.dragAssets(null);
      const list = assets.length ? assets : null;
      if (list) {
        for (const a of list) {
          const len = this.assetLength(a);
          if ((a.hasVideo || a.kind === 'image') && video) ghosts.push({ trackId: video.id, start: t, end: t + len, label: a.name, kind: 'drop' });
          if (a.hasAudio && audio) ghosts.push({ trackId: audio.id, start: t, end: t + len, label: a.name, kind: 'drop' });
          t += len;
        }
      } else if (p.row) {
        ghosts.push({ trackId: p.row.track.id, start: t, end: t + 5, label: 'Media', kind: 'drop' });
      }
      const mod = isMac ? e.metaKey : e.ctrlKey;
      this.dropOverlay = { ghosts, snapAt: r.at, readout: { x: p.x, y: p.y, lines: [`${mod ? 'Insert' : 'Overwrite'} · ${formatTimecode(r.t, this.seq().fps, this.seq().dropFrame, this.seq().startTimecode)}`] } };
    } else {
      const h = this.hitTest(p.x, p.y);
      if (kind === 'effect') this.dropOverlay = { dropClipId: h.clip && h.row?.track.kind === 'video' ? h.clip.id : null };
      else {
        const target = h.clip ? this.transitionEdge(h.clip, p.t) : null;
        this.dropOverlay = { dropEdge: target };
      }
    }
    this.invalidate();
  }

  private transitionEdge(clip: Clip, t: number): { clipId: string; edge: 'start' | 'end' } {
    return { clipId: clip.id, edge: t - clip.start < clip.start + clip.duration - t ? 'start' : 'end' };
  }

  private onDragLeave(e: DragEvent) {
    if (e.relatedTarget && this.wrap.contains(e.relatedTarget as Node)) return;
    this.dropOverlay = null;
    this.invalidate();
  }

  private onDrop(e: DragEvent) {
    const kind = this.dropTypes(e);
    if (!kind || !S().project) return;
    e.preventDefault();
    e.stopPropagation();
    this.dropOverlay = null;
    const p = this.ptr(e);
    const st = S();
    if (kind === 'assets') {
      const assets = this.dragAssets(e);
      if (!assets.length) return void cmd.toast('Nothing to place', 'error');
      const { video, audio } = this.dropTracks(p.row);
      const sn = this.snapper({});
      const start = this.snapT(sn, Math.max(0, p.t)).t;
      const mode: ops.EditMode = (isMac ? e.metaKey : e.ctrlKey) ? 'insert' : 'overwrite';
      let placed: string[] = [];
      const ok = cmd.editSeq(assets.length > 1 ? `${mode === 'insert' ? 'Insert' : 'Add'} ${assets.length} clips` : mode === 'insert' ? 'Insert clip' : 'Add clip', (s, proj) => {
        let t = start;
        for (const a of assets) {
          const ids = ops.placeMedia(proj, s, a.id, {
            start: t,
            mode,
            videoTrackId: a.hasVideo || a.kind === 'image' ? (video?.id ?? null) : null,
            audioTrackId: a.hasAudio ? (audio?.id ?? null) : null,
          });
          placed = placed.concat(ids ?? []);
          let end = t;
          for (const id of ids ?? []) {
            const f = findClip(s, id);
            if (f) end = Math.max(end, f.clip.start + f.clip.duration);
          }
          t = end > t ? end : t + this.assetLength(a);
        }
      });
      if (ok && placed.length) st.selectClips(placed);
    } else if (kind === 'effect') {
      const type = e.dataTransfer?.getData('omega/effect');
      const h = this.hitTest(p.x, p.y);
      if (!type || !h.clip) return;
      if (h.row?.track.kind !== 'video') return void cmd.toast('Video effects go on video clips');
      if (h.row.track.locked) return void cmd.toast('The track is locked');
      let fx;
      try {
        fx = instantiateEffect(type);
      } catch (err) {
        return void cmd.toast(cmd.errorText(err), 'error');
      }
      const id = h.clip.id;
      if (cmd.editSeq('Add effect', (s) => findClip(s, id)?.clip.effects.push(fx))) st.selectClips([id]);
    } else {
      const type = e.dataTransfer?.getData('omega/transition') as TransitionType;
      const h = this.hitTest(p.x, p.y);
      if (!type || !h.clip || !h.row) return;
      if (h.row.track.locked) return void cmd.toast('The track is locked');
      const isAudio = h.row.track.kind === 'audio';
      const edge = this.transitionEdge(h.clip, p.t);
      cmd.addTransitionAt(edge.clipId, edge.edge, isAudio ? 'audioCrossfade' : type === 'audioCrossfade' ? 'crossDissolve' : type);
    }
    this.invalidate();
  }

  // ===================================================================== debug API
  private installDebug() {
    const ctl = this;
    const api = {
      _ctl: ctl,
      /** Visible clip rectangles in client (viewport) coordinates. */
      clipRects() {
        const box = ctl.canvas.getBoundingClientRect();
        const seq = ctl.seq();
        return ctl.clipRects.map((r) => {
          const f = findClip(seq, r.id);
          const x0 = Math.max(0, r.x);
          const x1 = Math.min(ctl.sizeW, r.x + r.w);
          return {
            id: r.id,
            name: f?.clip.name ?? '',
            trackId: r.trackId,
            trackName: f?.track.name ?? '',
            start: f?.clip.start ?? 0,
            end: (f?.clip.start ?? 0) + (f?.clip.duration ?? 0),
            x: box.left + x0,
            y: box.top + r.y,
            width: Math.max(0, x1 - x0),
            height: r.h,
            fullX: box.left + r.x,
            fullWidth: r.w,
          };
        });
      },
      clipRect(id: string) {
        return api.clipRects().find((r) => r.id === id) ?? null;
      },
      /** Client x of a time, and the inverse. */
      timeToClientX: (t: number) => ctl.timeToClientX(t),
      clientXToTime: (x: number) => V().t0 + (x - ctl.canvas.getBoundingClientRect().left) / S().zoom,
      /** Client rect of a track lane (or null when scrolled out). */
      trackRect(trackId: string) {
        const seq = ctl.seq();
        const row = layoutTracks(seq.tracks).rows.find((r) => r.track.id === trackId || r.track.name === trackId);
        if (!row) return null;
        const box = ctl.canvas.getBoundingClientRect();
        return { x: box.left, y: box.top + row.y - V().scrollY, width: ctl.sizeW, height: row.h, name: row.track.name, id: row.track.id };
      },
      /** Client rects of the visible transitions. */
      transitionRects() {
        const seq = ctl.seq();
        const box = ctl.canvas.getBoundingClientRect();
        const out: { clipId: string; edge: 'in' | 'out'; type: string; x: number; y: number; width: number; height: number }[] = [];
        for (const row of layoutTracks(seq.tracks).rows) {
          for (const sp of transitionSpans(row.track, row.track.clips)) {
            const a = ctl.X(sp.a);
            const b = ctl.X(sp.b);
            const rh = row.h - 3;
            const th = Math.max(10, Math.min(rh, Math.round(rh * 0.62)));
            out.push({ clipId: sp.clipId, edge: sp.edge, type: sp.tr.type, x: box.left + a, y: box.top + row.y - V().scrollY + 1 + rh - th, width: b - a, height: th });
          }
        }
        return out;
      },
      /** Client rects of the visible caption cues. */
      cueRects() {
        const seq = ctl.seq();
        const box = ctl.canvas.getBoundingClientRect();
        const out: { id: string; trackId: string; text: string; x: number; y: number; width: number; height: number }[] = [];
        for (const row of layoutTracks(seq.tracks).rows) {
          if (row.track.kind !== 'caption') continue;
          for (const q of row.track.cues) {
            out.push({ id: q.id, trackId: row.track.id, text: q.text, x: box.left + ctl.X(q.start), y: box.top + row.y - V().scrollY + 2, width: (q.end - q.start) * S().zoom, height: row.h - 5 });
          }
        }
        return out;
      },
      /** Client x of each marker on the ruler. */
      markerRects() {
        const seq = ctl.seq();
        const box = ctl.ruler.getBoundingClientRect();
        return seq.markers.map((m) => ({ id: m.id, label: m.label, kind: m.kind, x: box.left + ctl.X(m.time), y: box.top + 6, endX: box.left + ctl.X(m.time + m.duration) }));
      },
      /** Ruler rect (for scrubbing). */
      rulerRect() {
        const r = ctl.ruler.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      },
      view() {
        const v = V();
        return { t0: v.t0, scrollY: v.scrollY, zoom: S().zoom, width: ctl.sizeW, height: ctl.sizeH };
      },
      stats: () => ({ ...ctl.lastStats }),
      redraw() {
        ctl.draw();
        return { ...ctl.lastStats };
      },
      run: (id: string) => runAction(id),
    };
    (window as unknown as { __deltaTimeline: typeof api }).__deltaTimeline = api;
  }
}

function blockedReason(mode: string): string {
  if (mode === 'ripple') return 'Blocked: another track can’t ripple here (sync lock)';
  if (mode === 'roll') return 'Blocked: no more media on one side of the edit';
  if (mode === 'rate') return 'Blocked: speed limit or a neighbouring clip';
  return 'Blocked: no more media, or a clip is in the way';
}

const GAIN_LIMIT = 12;
const GAIN_MIN = -96;

function fmtBand(path: string, v: number): string {
  if (path === 'audio.gain') return `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`;
  return `Opacity ${Math.round(v * 100)}%`;
}

