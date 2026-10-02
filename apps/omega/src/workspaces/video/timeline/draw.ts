// Canvas renderer for the timeline: lanes, clips (filmstrips, waveforms,
// fades, rubber bands, keyframes, badges), transitions, caption cues, the
// ruler (ticks, in/out, markers), the playhead and live drag feedback.
//
// Only what is visible is drawn: the time range [t0, t0 + W/zoom] and the
// rows intersecting the viewport. Per-track clip lookups are binary searches
// (geometry.ts), so the cost is proportional to what is on screen.

import { getPeaks, type Peaks } from '../../../engine/audio/engine';
import { allKeyTimes, evaluate, paramAt } from '../../../engine/keyframes';
import { getThumbnail } from '../../../engine/media/thumbnails';
import { exactRate } from '../../../engine/time';
import { isGradeIdentity, LABEL_COLORS } from '../../../state/defaults';
import type { Clip, MediaAsset, Project, Sequence, Track, Transition } from '../../../state/types';
import { clipPalette, css, hexToRgb, kindKey, mix } from './colors';
import { clipsInRange, cuesInRange, layoutTracks, MARKER_ROW_H, type Layout, type TrackRow } from './geometry';
import { rulerTicks } from './ticks';

// ---------------------------------------------------------------------------
// Theme (CSS custom properties → canvas colors)
// ---------------------------------------------------------------------------

export interface Theme {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  surface4: string;
  border: string;
  borderStrong: string;
  text: string;
  text2: string;
  text3: string;
  accent: string;
  accentSoft: string;
  danger: string;
  font: string;
  mono: string;
}

export function readTheme(el: Element = document.documentElement): Theme {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--bg', '#0b0b0d'),
    surface: v('--surface', '#131316'),
    surface2: v('--surface-2', '#1a1a1f'),
    surface3: v('--surface-3', '#22222a'),
    surface4: v('--surface-4', '#2b2b34'),
    border: v('--border', '#26262e'),
    borderStrong: v('--border-strong', '#363640'),
    text: v('--text', '#f4f4f6'),
    text2: v('--text-2', '#a7a7b3'),
    text3: v('--text-3', '#6c6c78'),
    accent: v('--accent', '#9b6bff'),
    accentSoft: v('--accent-soft', 'rgba(155,107,255,0.14)'),
    danger: v('--danger', '#e5484d'),
    font: v('--font', 'Inter, system-ui, sans-serif'),
    mono: v('--mono', 'ui-monospace, monospace'),
  };
}

// ---------------------------------------------------------------------------
// Draw input
// ---------------------------------------------------------------------------

export interface Ghost {
  trackId: string;
  start: number;
  end: number;
  label?: string;
  kind?: 'move' | 'origin' | 'drop' | 'trim';
}

export interface Readout {
  x: number;
  y: number;
  lines: string[];
}

export interface Overlay {
  ghosts: Ghost[];
  snapAt: number | null;
  readout: Readout | null;
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  razor: { t: number; trackIds: Set<string> | null } | null;
  dropClipId: string | null;
  dropEdge: { clipId: string; edge: 'start' | 'end' } | null;
  zoomRange: { a: number; b: number } | null;
  /** Clip ids hidden from normal drawing (shown as origin ghosts instead). */
  dimIds: Set<string> | null;
}

export const EMPTY_OVERLAY: Overlay = { ghosts: [], snapAt: null, readout: null, marquee: null, razor: null, dropClipId: null, dropEdge: null, zoomRange: null, dimIds: null };

export interface DrawState {
  project: Project;
  /** The sequence to draw (a live preview during drags). */
  seq: Sequence;
  zoom: number;
  t0: number;
  scrollY: number;
  W: number;
  H: number;
  playhead: number;
  selected: Set<string>;
  selectedMarkers: Set<string>;
  selectedCues: Set<string>;
  selectedKeys: { clipId: string; path: string; t: number }[];
  tool: string;
  hoverClipId: string | null;
  gap: { trackId: string; start: number; end: number } | null;
  transition: { clipId: string; edge: 'in' | 'out' } | null;
  overlay: Overlay;
  theme: Theme;
  playing: boolean;
}

export interface ClipRect {
  id: string;
  trackId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DrawResult {
  clipRects: ClipRect[];
  drawn: number;
  ms: number;
}

/** Hooks the renderer calls for media that is not ready yet. */
export interface MediaRequests {
  thumbs(asset: MediaAsset, times: number[]): void;
  peaks(assetId: string): void;
}

// ---------------------------------------------------------------------------
// Value mappings shared with hit testing
// ---------------------------------------------------------------------------

export const GAIN_MIN_DB = -48;
export const GAIN_MAX_DB = 12;

/** Rubber band: parameter value → 0..1 position (1 = top). */
export function bandPos(path: string, v: number): number {
  if (path === 'audio.gain') return Math.max(0, Math.min(1, (v - GAIN_MIN_DB) / (GAIN_MAX_DB - GAIN_MIN_DB)));
  return Math.max(0, Math.min(1, v));
}
export function bandValue(path: string, pos: number): number {
  const p = Math.max(0, Math.min(1, pos));
  if (path === 'audio.gain') return GAIN_MIN_DB + p * (GAIN_MAX_DB - GAIN_MIN_DB);
  return p;
}
export function bandPath(trackKind: string): 'audio.gain' | 'transform.opacity' {
  return trackKind === 'audio' ? 'audio.gain' : 'transform.opacity';
}
/** Vertical extent used by the rubber band inside a clip body. */
export function bandArea(y: number, h: number): { top: number; bottom: number } {
  const pad = Math.min(5, h * 0.12);
  return { top: y + pad + 1, bottom: y + h - pad - 1 };
}
/** Whether the rubber band is drawn (and editable) on this clip. */
export function showsBand(clip: Clip, trackKind: string, selected: boolean, tool: string, h: number): boolean {
  if (h < 26 || trackKind === 'caption') return false;
  if (trackKind === 'audio') return true;
  if (tool === 'pen' || selected) return true;
  return !!clip.keyframes['transform.opacity']?.length || clip.transform.opacity < 0.999;
}

export const KF_LANE_H = 9;
export function showsKeyLane(clip: Clip, selected: boolean, h: number, w: number): boolean {
  return selected && h >= 30 && w > 16 && Object.keys(clip.keyframes).length > 0;
}

export function videoFades(clip: Clip, trackKind: string): { fin: number; fout: number } {
  return trackKind === 'audio' ? { fin: clip.audio.fadeIn, fout: clip.audio.fadeOut } : { fin: clip.fadeIn, fout: clip.fadeOut };
}

// ---------------------------------------------------------------------------
// Source time mapping (fast path for constant speed, table for ramps)
// ---------------------------------------------------------------------------

const rampCache = new WeakMap<Clip, { step: number; table: Float64Array }>();

export function sourceMapper(clip: Clip): (local: number) => number {
  if (clip.holdFrame !== null && clip.holdFrame !== undefined) {
    const h = clip.holdFrame;
    return () => h;
  }
  const kfs = clip.keyframes['time.speed'];
  if (!kfs || !kfs.length) {
    const sp = clip.speed;
    const inP = clip.inPoint;
    if (clip.reverse) {
      const span = clip.duration * sp;
      return (l) => inP + span - Math.max(0, Math.min(l, clip.duration)) * sp;
    }
    return (l) => inP + Math.max(0, Math.min(l, clip.duration)) * sp;
  }
  let r = rampCache.get(clip);
  if (!r) {
    const step = Math.max(1 / 240, clip.duration / 4000);
    const n = Math.ceil(clip.duration / step) + 1;
    const table = new Float64Array(n + 1);
    let acc = 0;
    for (let i = 1; i <= n; i++) {
      acc += Math.max(0, evaluate(kfs, (i - 0.5) * step)) * step;
      table[i] = acc;
    }
    r = { step, table };
    rampCache.set(clip, r);
  }
  const { step, table } = r;
  const elapsed = (l: number) => {
    const x = Math.max(0, Math.min(l, clip.duration)) / step;
    const i = Math.min(table.length - 2, Math.floor(x));
    return table[i] + (table[i + 1] - table[i]) * (x - i);
  };
  const span = elapsed(clip.duration);
  return clip.reverse ? (l) => clip.inPoint + span - elapsed(l) : (l) => clip.inPoint + elapsed(l);
}

// ---------------------------------------------------------------------------
// Waveform mip-maps
// ---------------------------------------------------------------------------

const mipCache = new WeakMap<Peaks, Float32Array[]>();

function mipsOf(p: Peaks): Float32Array[] {
  let levels = mipCache.get(p);
  if (levels) return levels;
  levels = [p.data];
  let cur = p.data;
  while (cur.length > 4) {
    const n = Math.ceil(cur.length / 4);
    const next = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = i * 4;
      const b = a + 2;
      let mn = cur[a];
      let mx = cur[a + 1];
      if (b + 1 < cur.length) {
        if (cur[b] < mn) mn = cur[b];
        if (cur[b + 1] > mx) mx = cur[b + 1];
      }
      next[i * 2] = mn;
      next[i * 2 + 1] = mx;
    }
    levels.push(next);
    cur = next;
    if (levels.length > 24) break;
  }
  mipCache.set(p, levels);
  return levels;
}

/** min/max of the peaks between two source times. */
function peakRange(p: Peaks, levels: Float32Array[], s0: number, s1: number): [number, number] {
  const a = Math.min(s0, s1);
  const b = Math.max(s0, s1);
  const perSec = p.sampleRate / p.bucket;
  const b0 = a * perSec;
  const b1 = b * perSec;
  const span = Math.max(1, b1 - b0);
  const L = Math.max(0, Math.min(levels.length - 1, Math.floor(Math.log2(span))));
  const data = levels[L];
  const scale = 2 ** L;
  const count = data.length / 2;
  let i0 = Math.floor(b0 / scale);
  let i1 = Math.max(i0 + 1, Math.ceil(b1 / scale));
  if (i0 >= count || i1 <= 0) return [0, 0];
  i0 = Math.max(0, i0);
  i1 = Math.min(count, i1);
  let mn = 1;
  let mx = -1;
  for (let i = i0; i < i1; i++) {
    const lo = data[i * 2];
    const hi = data[i * 2 + 1];
    if (lo < mn) mn = lo;
    if (hi > mx) mx = hi;
  }
  return mn > mx ? [0, 0] : [mn, mx];
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const patternCache = new Map<string, CanvasPattern | null>();

function hatch(ctx: CanvasRenderingContext2D, color: string, bg: string | null, size = 7, width = 1.2): CanvasPattern | null {
  const key = `${color}|${bg}|${size}|${width}`;
  if (patternCache.has(key)) return patternCache.get(key)!;
  const c = document.createElement('canvas');
  const s = size * 2;
  c.width = s;
  c.height = s;
  const g = c.getContext('2d')!;
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, s, s);
  }
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  for (let o = -s; o <= s; o += size) {
    g.moveTo(o, s);
    g.lineTo(o + s, 0);
  }
  g.stroke();
  const p = ctx.createPattern(c, 'repeat');
  patternCache.set(key, p);
  return p;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

const TRANSITION_NAMES: Record<string, string> = {
  crossDissolve: 'Cross Dissolve',
  filmDissolve: 'Film Dissolve',
  additiveDissolve: 'Additive Dissolve',
  dipToBlack: 'Dip to Black',
  dipToWhite: 'Dip to White',
  wipe: 'Wipe',
  slide: 'Slide',
  push: 'Push',
  zoom: 'Zoom',
  blurDissolve: 'Blur Dissolve',
  iris: 'Iris',
  clockWipe: 'Clock Wipe',
  whip: 'Whip Pan',
  glitch: 'Glitch',
  lightLeak: 'Light Leak',
  audioCrossfade: 'Crossfade',
};
export function transitionName(type: string): string {
  return TRANSITION_NAMES[type] ?? type;
}

/** Transition spans on a track: [a, b] in timeline seconds with owner info. */
export interface TransitionSpan {
  clipId: string;
  edge: 'in' | 'out';
  a: number;
  b: number;
  cut: number;
  tr: Transition;
}

export function transitionSpans(track: Track, clips: Clip[]): TransitionSpan[] {
  const out: TransitionSpan[] = [];
  for (const c of clips) {
    if (c.transitionIn && c.transitionIn.duration > 0) {
      const half = c.transitionIn.duration / 2;
      out.push({ clipId: c.id, edge: 'in', a: c.start - half, b: c.start + half, cut: c.start, tr: c.transitionIn });
    }
    if (c.transitionOut && c.transitionOut.duration > 0) {
      const end = c.start + c.duration;
      const followed = track.clips.some((o) => o.id !== c.id && Math.abs(o.start - end) < 1e-3);
      if (!followed) {
        const half = c.transitionOut.duration / 2;
        out.push({ clipId: c.id, edge: 'out', a: end - half, b: end + half, cut: end, tr: c.transitionOut });
      }
    }
  }
  return out;
}

export class TimelineRenderer {
  private requests: MediaRequests;
  private thumbWanted = new Map<string, { asset: MediaAsset; times: Set<number> }>();
  private peaksWanted = new Set<string>();

  constructor(requests: MediaRequests) {
    this.requests = requests;
  }

  // -------------------------------------------------------------------- tracks
  drawTracks(ctx: CanvasRenderingContext2D, s: DrawState): DrawResult {
    const t0p = performance.now();
    const { W, H, zoom, t0, scrollY, seq, theme } = s;
    const layout = layoutTracks(seq.tracks);
    const t1 = t0 + W / zoom;
    const X = (t: number) => (t - t0) * zoom;
    const result: DrawResult = { clipRects: [], drawn: 0, ms: 0 };
    this.thumbWanted.clear();
    this.peaksWanted.clear();

    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);

    // in/out tint behind everything
    if (seq.inPoint !== null || seq.outPoint !== null) {
      const a = X(seq.inPoint ?? 0);
      const b = seq.outPoint !== null ? X(seq.outPoint) : W;
      if (b > 0 && a < W) {
        ctx.fillStyle = theme.accentSoft;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(Math.max(0, a), 0, Math.min(W, b) - Math.max(0, a), H);
        ctx.globalAlpha = 1;
      }
    }

    const assets = new Map<string, MediaAsset>();
    for (const a of s.project.assets) assets.set(a.id, a);

    // lanes
    for (const row of layout.rows) {
      const y = row.y - scrollY;
      if (y > H || y + row.h < 0) continue;
      ctx.fillStyle = row.track.kind === 'caption' ? theme.surface : row.index % 2 ? theme.surface : mixCss(theme.surface, theme.bg, 0.35);
      ctx.fillRect(0, y, W, row.h);
      ctx.fillStyle = theme.border;
      ctx.fillRect(0, y + row.h - 1, W, 1);
      if (row.track.locked) {
        const p = hatch(ctx, 'rgba(255,255,255,0.045)', null, 8, 1);
        if (p) {
          ctx.fillStyle = p;
          ctx.fillRect(0, y, W, row.h - 1);
        }
      }
      if (s.gap && s.gap.trackId === row.track.id) {
        const a = X(s.gap.start);
        const b = X(s.gap.end);
        ctx.fillStyle = theme.accentSoft;
        ctx.fillRect(a, y + 2, b - a, row.h - 5);
        ctx.strokeStyle = theme.accent;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(a + 0.5, y + 2.5, b - a - 1, row.h - 6);
        ctx.setLineDash([]);
      }
    }
    if (layout.dividerY !== null) {
      const y = layout.dividerY - scrollY;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, y, W, 5);
      ctx.fillStyle = theme.borderStrong;
      ctx.fillRect(0, y + 2, W, 1);
    }

    // frame cells when zoomed to single frames
    const rate = exactRate(seq.fps);
    const pxPerFrame = zoom / rate;

    // clips
    for (const row of layout.rows) {
      const y = row.y - scrollY;
      if (y > H || y + row.h < 0) continue;
      const tr = row.track;
      if (tr.kind === 'caption') {
        this.drawCues(ctx, s, row, y, t0, t1, X);
        continue;
      }
      const clips = clipsInRange(tr, t0 - 1 / zoom, t1 + 1 / zoom);
      const trackDim = tr.muted;
      for (const c of clips) {
        if (s.overlay.dimIds?.has(c.id)) continue;
        const x = X(c.start);
        const w = c.duration * zoom;
        this.drawClip(ctx, s, row, c, x, y + 1, w, row.h - 3, assets, trackDim);
        result.drawn++;
        if (x + w > 0 && x < W) result.clipRects.push({ id: c.id, trackId: tr.id, x, y: y + 1, w, h: row.h - 3 });
      }
      // transitions over the cuts
      if (clips.length) {
        for (const span of transitionSpans(tr, clips)) {
          const a = X(span.a);
          const b = X(span.b);
          if (b < 0 || a > W) continue;
          this.drawTransition(ctx, s, span, a, b, y + 1, row.h - 3);
        }
      }
    }

    // ghosts (move/trim/drop previews)
    for (const g of s.overlay.ghosts) {
      const row = layout.rows.find((r) => r.track.id === g.trackId);
      if (!row) continue;
      const y = row.y - scrollY + 1;
      const x = X(g.start);
      const w = Math.max(1, (g.end - g.start) * zoom);
      if (x > W || x + w < 0) continue;
      ctx.save();
      if (g.kind === 'origin') {
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, row.h - 4);
      } else {
        ctx.fillStyle = g.kind === 'drop' ? theme.accentSoft : 'rgba(255,255,255,0.10)';
        roundRect(ctx, x, y, w, row.h - 3, 2);
        ctx.fill();
        ctx.strokeStyle = g.kind === 'drop' ? theme.accent : 'rgba(255,255,255,0.75)';
        ctx.setLineDash(g.kind === 'drop' ? [5, 3] : []);
        ctx.lineWidth = 1;
        roundRect(ctx, x + 0.5, y + 0.5, w - 1, row.h - 4, 2);
        ctx.stroke();
        if (g.label && w > 30) {
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.rect(x, y, w, row.h - 3);
          ctx.clip();
          ctx.fillStyle = theme.text;
          ctx.font = `500 11px ${theme.font}`;
          ctx.textBaseline = 'top';
          ctx.fillText(g.label, x + 6, y + 4);
        }
      }
      ctx.restore();
    }

    // selected markers: faint guide lines
    for (const m of seq.markers) {
      if (!s.selectedMarkers.has(m.id)) continue;
      const x = Math.round(X(m.time)) + 0.5;
      if (x < 0 || x > W) continue;
      ctx.strokeStyle = LABEL_COLORS[m.color] ?? theme.text3;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // razor preview
    if (s.overlay.razor) {
      const x = Math.round(X(s.overlay.razor.t)) + 0.5;
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 1;
      for (const row of layout.rows) {
        if (s.overlay.razor.trackIds && !s.overlay.razor.trackIds.has(row.track.id)) continue;
        const y = row.y - scrollY;
        ctx.beginPath();
        ctx.moveTo(x, y + 1);
        ctx.lineTo(x, y + row.h - 2);
        ctx.stroke();
      }
    }

    // zoom tool range
    if (s.overlay.zoomRange) {
      const a = X(Math.min(s.overlay.zoomRange.a, s.overlay.zoomRange.b));
      const b = X(Math.max(s.overlay.zoomRange.a, s.overlay.zoomRange.b));
      ctx.fillStyle = theme.accentSoft;
      ctx.fillRect(a, 0, b - a, H);
      ctx.strokeStyle = theme.accent;
      ctx.strokeRect(a + 0.5, 0.5, b - a - 1, H - 1);
    }

    // playhead (a frame-wide band when zoomed into frames)
    const px = X(s.playhead);
    if (pxPerFrame >= 14) {
      ctx.fillStyle = theme.accentSoft;
      ctx.fillRect(px, 0, pxPerFrame, H);
    }
    if (px >= -1 && px <= W + 1) {
      ctx.fillStyle = theme.accent;
      ctx.fillRect(Math.round(px), 0, 1, H);
    }

    // snap indicator
    if (s.overlay.snapAt !== null) {
      const x = Math.round(X(s.overlay.snapAt)) + 0.5;
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.fillStyle = theme.text;
      ctx.beginPath();
      ctx.moveTo(x - 4, 0);
      ctx.lineTo(x + 4, 0);
      ctx.lineTo(x, 5);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - 4, H);
      ctx.lineTo(x + 4, H);
      ctx.lineTo(x, H - 5);
      ctx.fill();
    }

    // marquee
    if (s.overlay.marquee) {
      const m = s.overlay.marquee;
      const x = Math.min(m.x0, m.x1);
      const y = Math.min(m.y0, m.y1);
      const w = Math.abs(m.x1 - m.x0);
      const h = Math.abs(m.y1 - m.y0);
      ctx.fillStyle = theme.accentSoft;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = theme.accent;
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    }

    // readout bubble
    if (s.overlay.readout) this.drawReadout(ctx, s, s.overlay.readout);

    this.flushRequests();
    result.ms = performance.now() - t0p;
    return result;
  }

  private flushRequests() {
    for (const { asset, times } of this.thumbWanted.values()) {
      if (times.size) this.requests.thumbs(asset, [...times].slice(0, 96));
    }
    for (const id of this.peaksWanted) this.requests.peaks(id);
  }

  // -------------------------------------------------------------------- clip
  private drawClip(ctx: CanvasRenderingContext2D, s: DrawState, row: TrackRow, c: Clip, x: number, y: number, w: number, h: number, assets: Map<string, MediaAsset>, trackDim: boolean) {
    const { W, theme, zoom } = s;
    const sel = s.selected.has(c.id);
    const tk = row.track.kind;
    const key = kindKey(c, tk);
    const pal = clipPalette(c.label, key);
    // LOD: tiny clips are a solid sliver
    if (w < 3) {
      ctx.fillStyle = sel ? pal.bodySel : pal.band;
      ctx.globalAlpha = c.enabled ? 1 : 0.4;
      ctx.fillRect(x, y, Math.max(1, w), h);
      ctx.globalAlpha = 1;
      return;
    }
    // Visible part (clamped, so huge clips at high zoom stay cheap)
    const vx0 = Math.max(x, -4);
    const vx1 = Math.min(x + w, W + 4);
    const vw = vx1 - vx0;
    const asset = c.assetId ? assets.get(c.assetId) : undefined;
    const offline = c.kind === 'media' && (!asset || asset.offline);
    const nestedMissing = c.kind === 'sequence' && !s.project.sequences.some((q) => q.id === c.sequenceId);

    ctx.save();
    ctx.globalAlpha = !c.enabled ? 0.4 : trackDim ? 0.55 : 1;
    roundRect(ctx, vx0, y, vw, h, 2);
    ctx.clip();

    // body
    ctx.fillStyle = sel ? pal.bodySel : pal.body;
    ctx.fillRect(vx0, y, vw, h);

    if (offline || nestedMissing) {
      const p = hatch(ctx, 'rgba(229,72,77,0.55)', '#2a1214', 7, 1.4);
      if (p) {
        ctx.fillStyle = p;
        ctx.fillRect(vx0, y, vw, h);
      }
    } else if (c.kind === 'media' && tk === 'video' && asset && (asset.hasVideo || asset.kind === 'image')) {
      this.drawFilmstrip(ctx, s, c, asset, x, y, w, h, vx0, vx1);
    } else if (c.kind === 'media' && tk === 'audio' && asset) {
      this.drawWaveform(ctx, s, c, asset, x, y, w, h, vx0, vx1, pal.wave);
    } else if (c.kind === 'adjustment') {
      const p = hatch(ctx, 'rgba(255,255,255,0.07)', null, 9, 1);
      if (p) {
        ctx.fillStyle = p;
        ctx.fillRect(vx0, y, vw, h);
      }
    } else if (c.kind === 'solid' && c.solid) {
      ctx.fillStyle = c.solid.color;
      ctx.fillRect(x + 1, y + h - 5, Math.max(0, w - 2), 4);
    } else if (c.kind === 'gradient' && c.gradient && c.gradient.stops.length) {
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      for (const st of c.gradient.stops) g.addColorStop(Math.max(0, Math.min(1, st.pos)), st.color);
      ctx.fillStyle = g;
      ctx.fillRect(vx0, y + h - 5, vw, 4);
    } else if (c.kind === 'sequence') {
      // stacked-card look: an inner frame line
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
    }

    // label band across the top
    ctx.fillStyle = pal.band;
    ctx.fillRect(vx0, y, vw, 2);

    // fades
    const { fin, fout } = videoFades(c, tk);
    const bodyTop = y + 2;
    if (fin > 0 || fout > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      if (fin > 0) {
        const fx = x + Math.min(fin, c.duration) * zoom;
        ctx.beginPath();
        ctx.moveTo(x, bodyTop);
        ctx.lineTo(fx, bodyTop);
        ctx.lineTo(x, y + h);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x, y + h);
        ctx.lineTo(fx, bodyTop);
        ctx.stroke();
      }
      if (fout > 0) {
        const fx = x + w - Math.min(fout, c.duration) * zoom;
        ctx.beginPath();
        ctx.moveTo(x + w, bodyTop);
        ctx.lineTo(fx, bodyTop);
        ctx.lineTo(x + w, y + h);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(fx, bodyTop);
        ctx.lineTo(x + w, y + h);
        ctx.stroke();
      }
    }

    // rubber band (opacity / volume)
    if (showsBand(c, tk, sel, s.tool, h) && w > 8) this.drawBand(ctx, s, c, tk, x, y, w, h, vx0, vx1);

    // name + badges
    if (w >= 22 && h >= 14) this.drawLabel(ctx, s, c, tk, x, y, w, h, vx0, vx1, offline || nestedMissing, asset);

    // keyframe lane on the selected clip
    if (showsKeyLane(c, sel, h, w)) this.drawKeyLane(ctx, s, c, x, y, w, h, vx0, vx1);

    // fade handles (hover / selected)
    if ((sel || s.hoverClipId === c.id) && w > 26 && h >= 22 && !row.track.locked) {
      const hx1 = x + Math.min(fin, c.duration) * zoom;
      const hx2 = x + w - Math.min(fout, c.duration) * zoom;
      ctx.fillStyle = theme.text;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      for (const hx of [hx1, hx2]) {
        const cx = Math.max(x + 4, Math.min(x + w - 4, hx));
        ctx.fillRect(cx - 3, bodyTop + 1, 6, 6);
        ctx.strokeRect(cx - 2.5, bodyTop + 1.5, 5, 5);
      }
    }
    ctx.restore();

    // selection outline (1px white inner) / drop target
    if (sel) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 1;
      roundRect(ctx, vx0 + 0.5, y + 0.5, vw - 1, h - 1, 2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + w - 0.5, y, 0, h);
    }
    if (s.overlay.dropClipId === c.id) {
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      roundRect(ctx, vx0 + 1, y + 1, vw - 2, h - 2, 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    if (s.overlay.dropEdge?.clipId === c.id) {
      const ex = s.overlay.dropEdge.edge === 'start' ? x : x + w;
      ctx.fillStyle = theme.accent;
      ctx.fillRect(ex - 2, y, 4, h);
    }
  }

  private drawFilmstrip(ctx: CanvasRenderingContext2D, s: DrawState, c: Clip, asset: MediaAsset, x: number, y: number, w: number, h: number, vx0: number, vx1: number) {
    if (h < 20 || w < 12) return;
    const stripY = y + 2;
    const stripH = h - 2;
    const aspect = asset.width && asset.height ? asset.width / asset.height : 16 / 9;
    const tw = Math.max(8, stripH * aspect);
    const map = sourceMapper(c);
    const kStart = Math.max(0, Math.floor((vx0 - x) / tw));
    const kEnd = Math.min(Math.ceil(w / tw), Math.ceil((vx1 - x) / tw));
    if (kEnd - kStart > 200) return;
    let wanted = this.thumbWanted.get(asset.id);
    ctx.globalAlpha *= 0.92;
    for (let k = kStart; k < kEnd; k++) {
      const local = (k * tw) / s.zoom;
      const src = Math.max(0, Math.min(map(local), Math.max(0, asset.duration - 1e-3)));
      const bmp = getThumbnail(asset.id, src);
      const dx = x + k * tw;
      if (bmp) {
        try {
          ctx.drawImage(bmp, dx, stripY, tw, stripH);
        } catch {
          /* closed bitmap */
        }
        // hairline between frames
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(dx + tw - 1, stripY, 1, stripH);
      } else {
        if (!wanted) {
          wanted = { asset, times: new Set() };
          this.thumbWanted.set(asset.id, wanted);
        }
        wanted.times.add(Math.round(src * 10) / 10);
      }
    }
    ctx.globalAlpha /= 0.92;
  }

  private drawWaveform(ctx: CanvasRenderingContext2D, s: DrawState, c: Clip, asset: MediaAsset, x: number, y: number, w: number, h: number, vx0: number, vx1: number, color: string) {
    const peaks = asset.hasAudio ? getPeaks(asset.id) : null;
    const mid = y + 2 + (h - 2) / 2;
    if (!peaks) {
      if (asset.hasAudio) this.peaksWanted.add(asset.id);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(vx0, Math.round(mid), vx1 - vx0, 1);
      return;
    }
    const levels = mipsOf(peaks);
    const map = sourceMapper(c);
    const amp = (h - 6) / 2;
    const gainKfs = c.keyframes['audio.gain'];
    const staticGain = Math.pow(10, c.audio.gain / 20);
    ctx.fillStyle = color;
    const a = Math.max(Math.floor(vx0), Math.floor(x));
    const b = Math.min(Math.ceil(vx1), Math.ceil(x + w));
    const zoom = s.zoom;
    let prevSrc = map((a - x) / zoom);
    for (let px = a; px < b; px++) {
      const l1 = (px + 1 - x) / zoom;
      const src1 = map(l1);
      const [mn, mx] = peakRange(peaks, levels, prevSrc, src1);
      prevSrc = src1;
      const g = gainKfs?.length ? Math.pow(10, evaluate(gainKfs, l1) / 20) : staticGain;
      const top = Math.max(-1, Math.min(1, mx * g));
      const bot = Math.max(-1, Math.min(1, mn * g));
      const yTop = mid - top * amp;
      const yBot = mid - bot * amp;
      ctx.fillRect(px, yTop, 1, Math.max(1, yBot - yTop));
    }
  }

  private drawBand(ctx: CanvasRenderingContext2D, s: DrawState, c: Clip, tk: string, x: number, y: number, w: number, h: number, vx0: number, vx1: number) {
    const path = bandPath(tk);
    const { top, bottom } = bandArea(y, h);
    const Y = (v: number) => bottom - bandPos(path, v) * (bottom - top);
    const kfs = c.keyframes[path];
    ctx.strokeStyle = s.tool === 'pen' ? '#ffd166' : 'rgba(255,214,102,0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (!kfs?.length) {
      const yy = Math.round(Y(paramAt(c, path, 0))) + 0.5;
      ctx.moveTo(Math.max(x, vx0), yy);
      ctx.lineTo(Math.min(x + w, vx1), yy);
      ctx.stroke();
      return;
    }
    const a = Math.max(x, vx0);
    const b = Math.min(x + w, vx1);
    const step = 3;
    let first = true;
    for (let px = a; px <= b + step; px += step) {
      const local = (Math.min(px, b) - x) / s.zoom;
      const yy = Y(evaluate(kfs, local));
      if (first) ctx.moveTo(Math.min(px, b), yy);
      else ctx.lineTo(Math.min(px, b), yy);
      first = false;
    }
    ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    for (const k of kfs) {
      const kx = x + k.t * s.zoom;
      if (kx < vx0 - 4 || kx > vx1 + 4) continue;
      const ky = Y(k.v);
      ctx.beginPath();
      ctx.arc(kx, ky, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawLabel(ctx: CanvasRenderingContext2D, s: DrawState, c: Clip, tk: string, x: number, y: number, w: number, h: number, vx0: number, vx1: number, offline: boolean, asset?: MediaAsset) {
    const { theme } = s;
    // the name sticks to the left edge when the clip starts off-screen
    let nx = Math.max(x, vx0, 0) + 5;
    const ny = y + 4;
    const maxX = Math.min(x + w, vx1) - 4;
    if (maxX - nx < 10) return;
    ctx.font = `500 11px ${theme.font}`;
    ctx.textBaseline = 'top';
    // kind glyphs
    if (c.kind !== 'media' && w > 40) {
      nx = this.drawKindGlyph(ctx, c, nx, ny) + 4;
    }
    let name = c.name;
    if (c.kind === 'text' && c.text && (name === 'Text' || !name)) name = c.text.content.split('\n')[0] || 'Text';
    if (offline) name = `${name}  · Offline`;
    // badges (right side)
    const badges: { text?: string; dot?: 'fx' | 'grade' }[] = [];
    const ramp = !!c.keyframes['time.speed']?.length;
    if (ramp) badges.push({ text: 'RAMP' });
    else if (Math.abs(c.speed - 1) > 1e-6) badges.push({ text: `${Math.round(c.speed * 1000) / 10}%` });
    if (c.reverse) badges.push({ text: 'REV' });
    if (c.holdFrame !== null && c.holdFrame !== undefined) badges.push({ text: 'FREEZE' });
    if (c.effects.length) badges.push({ dot: 'fx' });
    if (tk === 'video' && c.kind !== 'adjustment' && !isGradeIdentity(c.grade)) badges.push({ dot: 'grade' });
    else if (c.kind === 'adjustment' && !isGradeIdentity(c.grade)) badges.push({ dot: 'grade' });
    let bx = maxX;
    if (badges.length && w > 70) {
      ctx.font = `600 9px ${theme.font}`;
      for (let i = badges.length - 1; i >= 0; i--) {
        const b = badges[i];
        if (b.dot === 'fx') {
          const cx = bx - 5;
          ctx.fillStyle = theme.accent;
          ctx.beginPath();
          ctx.arc(cx, ny + 6, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = `700 6px ${theme.font}`;
          ctx.fillText('fx', cx - 3.2, ny + 3.2);
          ctx.font = `600 9px ${theme.font}`;
          bx -= 12;
        } else if (b.dot === 'grade') {
          const cx = bx - 5;
          const cols = ['#e5484d', '#30a46c', '#3e63dd'];
          for (let k = 0; k < 3; k++) {
            ctx.fillStyle = cols[k];
            ctx.beginPath();
            ctx.moveTo(cx, ny + 6);
            ctx.arc(cx, ny + 6, 4, (k * 2 * Math.PI) / 3 - Math.PI / 2, ((k + 1) * 2 * Math.PI) / 3 - Math.PI / 2);
            ctx.closePath();
            ctx.fill();
          }
          bx -= 12;
        } else if (b.text) {
          const tw = ctx.measureText(b.text).width + 8;
          if (bx - tw < nx + 24) break;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          roundRect(ctx, bx - tw, ny, tw, 12, 3);
          ctx.fill();
          ctx.fillStyle = b.text === 'REV' || b.text === 'FREEZE' ? '#ffd166' : theme.text;
          ctx.fillText(b.text, bx - tw + 4, ny + 1.5);
          bx -= tw + 3;
        }
      }
      ctx.font = `500 11px ${theme.font}`;
    }
    const textMax = bx - nx - 2;
    if (textMax < 8) return;
    // backdrop over filmstrips for legibility
    const tw = Math.min(ctx.measureText(name).width, textMax);
    if (c.kind === 'media' && tk === 'video') {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      roundRect(ctx, nx - 3, ny - 1.5, tw + 6, 15, 3);
      ctx.fill();
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(nx, ny - 2, textMax, 16);
    ctx.clip();
    ctx.fillStyle = offline ? '#ffb4b6' : theme.text;
    ctx.fillText(name, nx, ny + 0.5);
    ctx.restore();
    // source timecode under the name when zoomed in and tall enough
    if (h >= 48 && w > 140 && c.kind === 'media' && tk === 'audio' && asset) {
      ctx.font = `400 9px ${theme.mono}`;
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText(`${asset.channels ?? 2}ch`, nx, ny + 15);
    }
  }

  private drawKindGlyph(ctx: CanvasRenderingContext2D, c: Clip, x: number, y: number): number {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.2;
    const cy = y + 6;
    switch (c.kind) {
      case 'text':
        ctx.font = '700 11px serif';
        ctx.fillText('T', x, y);
        ctx.restore();
        return x + 8;
      case 'shape': {
        const k = c.shape?.kind ?? 'rect';
        ctx.beginPath();
        if (k === 'ellipse') ctx.arc(x + 5, cy, 4.2, 0, Math.PI * 2);
        else if (k === 'triangle') {
          ctx.moveTo(x + 5, cy - 4.5);
          ctx.lineTo(x + 10, cy + 4);
          ctx.lineTo(x, cy + 4);
          ctx.closePath();
        } else if (k === 'line') {
          ctx.moveTo(x, cy + 4);
          ctx.lineTo(x + 10, cy - 4);
        } else ctx.rect(x + 0.5, cy - 4, 9, 8);
        ctx.stroke();
        break;
      }
      case 'solid':
        ctx.fillStyle = c.solid?.color ?? '#000';
        ctx.fillRect(x, cy - 4, 10, 8);
        ctx.strokeRect(x + 0.5, cy - 3.5, 9, 7);
        break;
      case 'gradient': {
        const g = ctx.createLinearGradient(x, 0, x + 10, 0);
        const stops = c.gradient?.stops ?? [];
        stops.forEach((st) => g.addColorStop(Math.max(0, Math.min(1, st.pos)), st.color));
        ctx.fillStyle = stops.length ? g : '#888';
        ctx.fillRect(x, cy - 4, 10, 8);
        break;
      }
      case 'adjustment':
        ctx.beginPath();
        ctx.arc(x + 5, cy, 4.2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + 5, cy, 4.2, -Math.PI / 2, Math.PI / 2);
        ctx.closePath();
        ctx.fill();
        break;
      case 'sequence':
        ctx.strokeRect(x + 0.5, cy - 4.5, 7, 6);
        ctx.strokeRect(x + 3.5, cy - 1.5, 7, 6);
        break;
      default:
        break;
    }
    ctx.restore();
    return x + 11;
  }

  private drawKeyLane(ctx: CanvasRenderingContext2D, s: DrawState, c: Clip, x: number, y: number, w: number, h: number, vx0: number, vx1: number) {
    const ly = y + h - KF_LANE_H;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(Math.max(x, vx0), ly, Math.min(x + w, vx1) - Math.max(x, vx0), KF_LANE_H);
    const times = allKeyTimes(c);
    const selT = s.selectedKeys.filter((k) => k.clipId === c.id).map((k) => k.t);
    const cy = ly + KF_LANE_H / 2;
    for (const t of times) {
      const kx = x + t * s.zoom;
      if (kx < vx0 - 5 || kx > vx1 + 5) continue;
      const isSel = selT.some((q) => Math.abs(q - t) < 1e-4);
      ctx.fillStyle = isSel ? s.theme.accent : 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(kx, cy - 3.5);
      ctx.lineTo(kx + 3.5, cy);
      ctx.lineTo(kx, cy + 3.5);
      ctx.lineTo(kx - 3.5, cy);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawTransition(ctx: CanvasRenderingContext2D, s: DrawState, span: TransitionSpan, a: number, b: number, y: number, h: number) {
    const { theme } = s;
    const th = Math.max(10, Math.min(h, Math.round(h * 0.62)));
    const ty = y + h - th;
    const w = Math.max(3, b - a);
    const isSel = s.transition?.clipId === span.clipId && s.transition.edge === span.edge;
    ctx.save();
    ctx.fillStyle = 'rgba(16,16,20,0.62)';
    roundRect(ctx, a, ty, w, th, 3);
    ctx.fill();
    ctx.strokeStyle = isSel ? theme.accent : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = isSel ? 1.5 : 1;
    roundRect(ctx, a + 0.5, ty + 0.5, w - 1, th - 1, 3);
    ctx.stroke();
    // diagonal (A → B)
    ctx.beginPath();
    ctx.rect(a, ty, w, th);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a, ty + th);
    ctx.lineTo(a + w, ty);
    ctx.stroke();
    if (w > 70 && th >= 14) {
      ctx.fillStyle = theme.text;
      ctx.font = `500 10px ${theme.font}`;
      ctx.textBaseline = 'middle';
      const label = transitionName(span.tr.type);
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(16,16,20,0.75)';
      ctx.fillRect(a + (w - tw) / 2 - 3, ty + th / 2 - 7, tw + 6, 14);
      ctx.fillStyle = theme.text;
      ctx.fillText(label, a + (w - tw) / 2, ty + th / 2);
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------- captions
  private drawCues(ctx: CanvasRenderingContext2D, s: DrawState, row: TrackRow, y: number, t0: number, t1: number, X: (t: number) => number) {
    const { theme } = s;
    const cues = cuesInRange(row.track, t0, t1);
    const pal = clipPalette(row.track.color ?? 'none', 'caption');
    const h = row.h - 5;
    const cy = y + 2;
    ctx.font = `500 11px ${theme.font}`;
    ctx.textBaseline = 'middle';
    for (const q of cues) {
      const a = X(q.start);
      const b = X(q.end);
      const w = Math.max(2, b - a);
      const sel = s.selectedCues.has(q.id);
      ctx.globalAlpha = row.track.muted ? 0.5 : 1;
      ctx.fillStyle = sel ? pal.bodySel : pal.body;
      roundRect(ctx, a, cy, w, h, Math.min(h / 2, 8));
      ctx.fill();
      if (sel) {
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        roundRect(ctx, a + 0.5, cy + 0.5, w - 1, h - 1, Math.min(h / 2, 8));
        ctx.stroke();
      }
      if (w > 24) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(Math.max(a, 0) + 6, cy, Math.min(b, s.W) - Math.max(a, 0) - 12, h);
        ctx.clip();
        ctx.fillStyle = theme.text;
        const txt = q.speaker ? `${q.speaker}: ${q.text}` : q.text;
        ctx.fillText(txt.replace(/\s*\n\s*/g, ' '), Math.max(a, 0) + 7, cy + h / 2 + 0.5);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  // -------------------------------------------------------------------- readout
  private drawReadout(ctx: CanvasRenderingContext2D, s: DrawState, r: Readout) {
    const { theme } = s;
    ctx.font = `500 11px ${theme.mono}`;
    ctx.textBaseline = 'middle';
    const pad = 7;
    const lh = 15;
    const w = Math.max(...r.lines.map((l) => ctx.measureText(l).width)) + pad * 2;
    const h = r.lines.length * lh + 8;
    let x = r.x + 14;
    let y = r.y - h - 10;
    if (x + w > s.W - 4) x = r.x - w - 14;
    if (y < 4) y = r.y + 18;
    x = Math.max(4, x);
    ctx.fillStyle = 'rgba(12,12,15,0.92)';
    roundRect(ctx, x, y, w, h, 5);
    ctx.fill();
    ctx.strokeStyle = theme.borderStrong;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 5);
    ctx.stroke();
    r.lines.forEach((l, i) => {
      ctx.fillStyle = i === 0 ? theme.text : theme.text2;
      ctx.fillText(l, x + pad, y + 4 + lh * i + lh / 2);
    });
  }

  // -------------------------------------------------------------------- ruler
  drawRuler(ctx: CanvasRenderingContext2D, s: DrawState, h: number) {
    const { W, zoom, t0, seq, theme } = s;
    const X = (t: number) => (t - t0) * zoom;
    const t1 = t0 + W / zoom;
    ctx.fillStyle = theme.surface;
    ctx.fillRect(0, 0, W, h);
    ctx.fillStyle = theme.border;
    ctx.fillRect(0, h - 1, W, 1);
    ctx.fillRect(0, MARKER_ROW_H, W, 1);

    // in/out range
    if (seq.inPoint !== null || seq.outPoint !== null) {
      const a = X(seq.inPoint ?? 0);
      const b = seq.outPoint !== null ? X(seq.outPoint) : X(Math.max(t1, seq.inPoint ?? 0));
      ctx.fillStyle = theme.accentSoft;
      ctx.fillRect(a, MARKER_ROW_H + 1, b - a, h - MARKER_ROW_H - 2);
      ctx.fillStyle = theme.accent;
      if (seq.inPoint !== null) {
        ctx.fillRect(Math.round(a), MARKER_ROW_H + 1, 2, h - MARKER_ROW_H - 2);
        ctx.fillRect(Math.round(a), MARKER_ROW_H + 1, 5, 2);
      }
      if (seq.outPoint !== null) {
        ctx.fillRect(Math.round(b) - 2, MARKER_ROW_H + 1, 2, h - MARKER_ROW_H - 2);
        ctx.fillRect(Math.round(b) - 5, MARKER_ROW_H + 1, 5, 2);
      }
    }

    // ticks
    const ticks = rulerTicks(zoom, seq.fps, t0, t1, { dropFrame: seq.dropFrame, startTimecode: seq.startTimecode });
    if (ticks.frameCells) {
      // alternate frame cells
      const rate = exactRate(seq.fps);
      const f0 = Math.floor(t0 * rate);
      const f1 = Math.ceil(t1 * rate);
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      for (let f = f0; f <= f1; f++) if (f % 2 === 0) ctx.fillRect(X(f / rate), MARKER_ROW_H + 1, zoom / rate, h - MARKER_ROW_H - 2);
    }
    ctx.fillStyle = theme.borderStrong;
    for (const t of ticks.minor) ctx.fillRect(Math.round(X(t)), h - 5, 1, 4);
    ctx.fillStyle = theme.text3;
    for (const m of ticks.major) ctx.fillRect(Math.round(X(m.t)), h - 10, 1, 9);
    ctx.font = `400 10px ${theme.mono}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = theme.text3;
    for (const m of ticks.major) ctx.fillText(m.label, Math.round(X(m.t)) + 4, h - 8);

    // markers
    ctx.textBaseline = 'middle';
    const sorted = [...seq.markers].sort((a, b) => a.time - b.time);
    for (let i = 0; i < sorted.length; i++) {
      const m = sorted[i];
      const x = X(m.time);
      const xe = X(m.time + m.duration);
      if (xe < -60 || x > W + 10) continue;
      const col = LABEL_COLORS[m.color] ?? LABEL_COLORS.teal;
      const sel = s.selectedMarkers.has(m.id);
      if (m.duration > 0) {
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(x, 3, Math.max(2, xe - x), 7);
        ctx.globalAlpha = 1;
        ctx.fillRect(Math.round(xe) - 1, 2, 2, 9);
      }
      ctx.fillStyle = col;
      ctx.beginPath();
      if (m.kind === 'chapter') {
        // bookmark: rect with a V notch, plus a stem down the ruler
        ctx.moveTo(x - 1, 1);
        ctx.lineTo(x + 8, 1);
        ctx.lineTo(x + 8, 11);
        ctx.lineTo(x + 3.5, 8);
        ctx.lineTo(x - 1, 11);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(Math.round(x) - 1, 1, 2, h - 2);
      } else if (m.kind === 'todo') {
        ctx.rect(x - 4.5, 2.5, 9, 9);
        if (m.done) ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = col;
        ctx.stroke();
        ctx.lineWidth = 1;
      } else {
        ctx.moveTo(x - 5, 1);
        ctx.lineTo(x + 5, 1);
        ctx.lineTo(x + 5, 7);
        ctx.lineTo(x, 12);
        ctx.lineTo(x - 5, 7);
        ctx.closePath();
        ctx.fill();
      }
      if (sel) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 6.5, 0.5, 13 + (m.kind === 'chapter' ? 4 : 0), 12);
      }
      if (m.label) {
        const next = sorted[i + 1];
        const room = (next ? X(next.time) : W) - x - 14;
        if (room > 24) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x + 9, 0, room, MARKER_ROW_H);
          ctx.clip();
          ctx.font = `500 10px ${theme.font}`;
          ctx.fillStyle = sel ? theme.text : theme.text2;
          ctx.fillText(m.label, x + (m.kind === 'chapter' ? 12 : 9), 7);
          ctx.restore();
        }
      }
    }

    // snap tick
    if (s.overlay.snapAt !== null) {
      const x = Math.round(X(s.overlay.snapAt)) + 0.5;
      ctx.strokeStyle = theme.text;
      ctx.beginPath();
      ctx.moveTo(x, MARKER_ROW_H);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // playhead head
    const px = Math.round(X(s.playhead));
    if (px >= -8 && px <= W + 8) {
      ctx.fillStyle = theme.accent;
      ctx.fillRect(px, MARKER_ROW_H, 1, h - MARKER_ROW_H);
      ctx.beginPath();
      const top = MARKER_ROW_H + 1;
      ctx.moveTo(px - 5.5, top);
      ctx.lineTo(px + 6.5, top);
      ctx.lineTo(px + 6.5, top + 7);
      ctx.lineTo(px + 0.5, top + 13);
      ctx.lineTo(px - 5.5, top + 7);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function mixCss(a: string, b: string, t: number): string {
  if (!a.startsWith('#') || !b.startsWith('#')) return a;
  return css(mix(hexToRgb(a), hexToRgb(b), t));
}

export type { Layout };
