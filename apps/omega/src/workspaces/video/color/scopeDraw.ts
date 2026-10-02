// Canvas drawing of the scopes: thin graticules, labels in the mono face,
// and the phosphor trace images composited additively on top.
import { skinToneLine, vectorPos, vectorTargets, VECTOR_RANGE, type HistogramCurves, type ScopeImage } from '../../../engine/scopes/scopes';

export type ScopeKind = 'waveform' | 'parade' | 'vectorscope' | 'histogram';
export type ScopeScale = 'ire' | 'code10';

export const SCOPE_LABEL: Record<ScopeKind, string> = {
  waveform: 'Waveform',
  parade: 'RGB Parade',
  vectorscope: 'Vectorscope',
  histogram: 'Histogram',
};

export interface DrawOpts {
  scale: ScopeScale;
  zoom: number;
  dpr: number;
  mono: string;
}

const BG = '#060708';
const GRID = 'rgba(214, 228, 220, 0.075)';
const GRID_STRONG = 'rgba(214, 228, 220, 0.17)';
const LABEL = 'rgba(214, 228, 220, 0.38)';

// One scratch canvas per image size for putImageData → drawImage scaling.
const scratch = new Map<string, OffscreenCanvas | HTMLCanvasElement>();
function toCanvas(img: ScopeImage): OffscreenCanvas | HTMLCanvasElement {
  const key = `${img.width}x${img.height}`;
  let c = scratch.get(key);
  if (!c) {
    if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(img.width, img.height);
    else {
      c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
    }
    scratch.set(key, c);
  }
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
  return c;
}

function blit(ctx: CanvasRenderingContext2D, img: ScopeImage, sx: number, sw: number, x: number, y: number, w: number, h: number, alpha = 1) {
  const src = toCanvas(img);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src as CanvasImageSource, sx, 0, sw, img.height, x, y, w, h);
  ctx.restore();
}

export function clear(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
}

function label(ctx: CanvasRenderingContext2D, o: DrawOpts, text: string, x: number, y: number, align: CanvasTextAlign = 'right', color = LABEL) {
  ctx.font = `${9 * o.dpr}px ${o.mono}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function hline(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, color: string, dpr: number, dash?: number[]) {
  ctx.strokeStyle = color;
  ctx.lineWidth = dpr;
  ctx.setLineDash(dash ? dash.map((d) => d * dpr) : []);
  ctx.beginPath();
  const yy = Math.round(y) + 0.5 * (dpr % 2);
  ctx.moveTo(x0, yy);
  ctx.lineTo(x1, yy);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Level (0..1) graticule lines and labels for the waveform family. */
function levelGraticule(ctx: CanvasRenderingContext2D, o: DrawOpts, x: number, y: number, w: number, h: number) {
  const at = (level: number) => y + (1 - level) * h;
  if (o.scale === 'ire') {
    for (let ire = 0; ire <= 100; ire += 10) {
      const strong = ire === 0 || ire === 100 || ire === 50;
      hline(ctx, x, x + w, at(ire / 100), strong ? GRID_STRONG : GRID, o.dpr);
      if (ire % 20 === 0 || ire === 100) label(ctx, o, String(ire), x - 5 * o.dpr, at(ire / 100));
    }
  } else {
    for (const code of [0, 128, 256, 384, 512, 640, 768, 896, 1023]) {
      const strong = code === 0 || code === 1023 || code === 512;
      hline(ctx, x, x + w, at(code / 1023), strong ? GRID_STRONG : GRID, o.dpr);
      if (code % 256 === 0 || code === 1023) label(ctx, o, String(code), x - 5 * o.dpr, at(code / 1023));
    }
    // SMPTE legal range
    for (const code of [64, 940]) hline(ctx, x, x + w, at(code / 1023), 'rgba(255, 196, 120, 0.22)', o.dpr, [2, 3]);
  }
}

function plotRect(w: number, h: number, dpr: number) {
  const left = 30 * dpr;
  const top = 10 * dpr;
  return { x: left, y: top, w: Math.max(10, w - left - 8 * dpr), h: Math.max(10, h - top - 10 * dpr) };
}

export function drawWaveform(ctx: CanvasRenderingContext2D, w: number, h: number, o: DrawOpts, img: ScopeImage | undefined, ref?: ScopeImage) {
  clear(ctx, w, h);
  const r = plotRect(w, h, o.dpr);
  levelGraticule(ctx, o, r.x, r.y, r.w, r.h);
  if (ref) blit(ctx, ref, 0, ref.width, r.x, r.y, r.w, r.h, 0.75);
  if (img) blit(ctx, img, 0, img.width, r.x, r.y, r.w, r.h);
}

export function drawParade(ctx: CanvasRenderingContext2D, w: number, h: number, o: DrawOpts, img: ScopeImage | undefined, ref?: ScopeImage) {
  clear(ctx, w, h);
  const r = plotRect(w, h, o.dpr);
  levelGraticule(ctx, o, r.x, r.y, r.w, r.h);
  const gap = 6 * o.dpr;
  const cw = (r.w - gap * 2) / 3;
  const names = ['R', 'G', 'B'];
  const tints = ['rgba(255,120,120,0.55)', 'rgba(120,240,150,0.55)', 'rgba(130,160,255,0.6)'];
  for (let k = 0; k < 3; k++) {
    const x = r.x + k * (cw + gap);
    if (k > 0) {
      ctx.fillStyle = '#060708';
      ctx.fillRect(x - gap, r.y - 2 * o.dpr, gap, r.h + 4 * o.dpr);
    }
    if (ref) {
      const c = ref.width / 3;
      blit(ctx, ref, k * c, c, x, r.y, cw, r.h, 0.75);
    }
    if (img) {
      const c = img.width / 3;
      blit(ctx, img, k * c, c, x, r.y, cw, r.h);
    }
    label(ctx, o, names[k], x + cw - 3 * o.dpr, r.y + 6 * o.dpr, 'right', tints[k]);
  }
}

export function drawVectorscope(ctx: CanvasRenderingContext2D, w: number, h: number, o: DrawOpts, img: ScopeImage | undefined, ref?: ScopeImage) {
  clear(ctx, w, h);
  const d = o.dpr;
  const size = Math.max(20, Math.min(w, h) - 16 * d);
  const x0 = (w - size) / 2;
  const y0 = (h - size) / 2;
  const cx = x0 + size / 2;
  const cy = y0 + size / 2;
  const R = size / 2;
  ctx.lineWidth = d;
  // circle, crosshair and 10° ticks
  ctx.strokeStyle = GRID_STRONG;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = GRID;
  ctx.beginPath();
  ctx.moveTo(cx - R, cy);
  ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R);
  ctx.lineTo(cx, cy + R);
  for (let a = 0; a < 360; a += 10) {
    const t = (a * Math.PI) / 180;
    const len = a % 30 === 0 ? 7 * d : 4 * d;
    ctx.moveTo(cx + Math.cos(t) * R, cy - Math.sin(t) * R);
    ctx.lineTo(cx + Math.cos(t) * (R - len), cy - Math.sin(t) * (R - len));
  }
  ctx.stroke();
  // inner rings: 25 % and 50 % chroma at 1×
  ctx.setLineDash([2 * d, 4 * d]);
  for (const c of [0.25, 0.5]) {
    const rr = (c * o.zoom * R) / VECTOR_RANGE;
    if (rr >= R) continue;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // skin-tone line
  const s = skinToneLine(VECTOR_RANGE / o.zoom);
  const sp = vectorPos(s.cb, s.cr, size, o.zoom);
  ctx.strokeStyle = 'rgba(255, 196, 150, 0.35)';
  ctx.setLineDash([3 * d, 3 * d]);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(x0 + sp.x, y0 + sp.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // traces
  if (ref) blit(ctx, ref, 0, ref.width, x0, y0, size, size, 0.75);
  if (img) blit(ctx, img, 0, img.width, x0, y0, size, size);
  // 75 % target boxes and 100 % dots
  const box = Math.max(6 * d, size * 0.045);
  for (const t of vectorTargets(0.75)) {
    const p = vectorPos(t.cb, t.cr, size, o.zoom);
    const px = x0 + p.x;
    const py = y0 + p.y;
    if (Math.hypot(px - cx, py - cy) > R + 1) continue;
    ctx.strokeStyle = 'rgba(214, 228, 220, 0.42)';
    ctx.strokeRect(px - box / 2, py - box / 2, box, box);
    const dist = Math.hypot(px - cx, py - cy) || 1;
    const lx = px + ((px - cx) / dist) * box * 1.45;
    const ly = py + ((py - cy) / dist) * box * 1.45;
    label(ctx, o, t.name, lx, ly, 'center', t.color + '99');
  }
  for (const t of vectorTargets(1)) {
    const p = vectorPos(t.cb, t.cr, size, o.zoom);
    if (Math.hypot(x0 + p.x - cx, y0 + p.y - cy) > R + 1) continue;
    ctx.fillStyle = 'rgba(214, 228, 220, 0.4)';
    ctx.fillRect(x0 + p.x - d, y0 + p.y - d, 2 * d, 2 * d);
  }
  if (o.zoom !== 1) label(ctx, o, `${o.zoom}×`, 8 * d, 12 * d, 'left');
}

export function drawHistogram(ctx: CanvasRenderingContext2D, w: number, h: number, o: DrawOpts, hist: HistogramCurves | undefined, ref?: HistogramCurves) {
  clear(ctx, w, h);
  const d = o.dpr;
  const r = { x: 10 * d, y: 10 * d, w: w - 20 * d, h: h - 26 * d };
  // vertical graticule: quarters of the code range
  const ticks = o.scale === 'ire' ? [0, 25, 50, 75, 100] : [0, 256, 512, 768, 1023];
  const max = o.scale === 'ire' ? 100 : 1023;
  ctx.strokeStyle = GRID;
  ctx.lineWidth = d;
  for (const t of ticks) {
    const x = Math.round(r.x + (t / max) * r.w) + 0.5;
    ctx.strokeStyle = t === 0 || t === max ? GRID_STRONG : GRID;
    ctx.beginPath();
    ctx.moveTo(x, r.y);
    ctx.lineTo(x, r.y + r.h);
    ctx.stroke();
    label(ctx, o, String(t), x, r.y + r.h + 8 * d, t === 0 ? 'left' : t === max ? 'right' : 'center');
  }
  hline(ctx, r.x, r.x + r.w, r.y + r.h, GRID_STRONG, d);
  const area = (curve: Float32Array, fill: string, stroke: string | null) => {
    const n = curve.length;
    ctx.beginPath();
    ctx.moveTo(r.x, r.y + r.h);
    for (let i = 0; i < n; i++) ctx.lineTo(r.x + (i / (n - 1)) * r.w, r.y + r.h - curve[i] * r.h);
    ctx.lineTo(r.x + r.w, r.y + r.h);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = r.x + (i / (n - 1)) * r.w;
        const y = r.y + r.h - curve[i] * r.h;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = d;
      ctx.stroke();
    }
  };
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (ref) area(ref.y, 'rgba(255, 170, 70, 0.12)', 'rgba(255, 170, 70, 0.55)');
  if (hist) {
    area(hist.r, 'rgba(255, 70, 70, 0.30)', 'rgba(255, 110, 110, 0.55)');
    area(hist.g, 'rgba(60, 230, 110, 0.26)', 'rgba(110, 240, 150, 0.5)');
    area(hist.b, 'rgba(70, 110, 255, 0.34)', 'rgba(120, 150, 255, 0.55)');
    area(hist.y, '', 'rgba(235, 240, 236, 0.75)');
  }
  ctx.restore();
}

export function drawNoSignal(ctx: CanvasRenderingContext2D, w: number, h: number, o: DrawOpts, text = 'No signal') {
  clear(ctx, w, h);
  ctx.font = `${11 * o.dpr}px ${o.mono}`;
  ctx.fillStyle = 'rgba(214, 228, 220, 0.28)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
}
