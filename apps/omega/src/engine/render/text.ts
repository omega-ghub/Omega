// Rasterizers for synthetic layers (text, shapes, solids, gradients) and
// caption cues. OWNED BY THE INSPECTOR/TEXT PACKAGE; the renderer uploads the
// returned canvases as textures (sRGB-encoded, straight alpha).
//
// Contract: each function returns a canvas exactly `width`×`height` (the
// sequence frame) with the content positioned at the frame center; the
// layer transform is applied afterwards by the renderer. Results may be
// cached by the implementation; callers must not mutate them.
//
// Caching: rasters are cached by a content key (identical inputs return the
// SAME canvas, so a static title costs nothing per frame). Canvases evicted
// from the cache are recycled for new content; `rasterVersion(canvas)`
// changes every time a canvas is (re)drawn, so a texture cache keyed by
// canvas identity should also compare the version.
//
// Fonts: the first use of a family/weight/style calls document.fonts.load();
// when a face finishes loading the cache is flushed and `onFontsLoaded`
// listeners fire so the viewer can re-render the frame.
//
// The pure layout helpers (breakLines, textAnimState, wordAlpha, easing,
// gradientLine, stackCaptionBlocks) have no DOM dependencies and are unit-tested.

import type { CaptionNode, LayerSource } from './graph';
import type { CaptionStyle, GradientProps, ShapeProps, TextAnimation, TextProps } from '../../state/types';

type Raster = OffscreenCanvas;
type Ctx = OffscreenCanvasRenderingContext2D & { letterSpacing?: string };

// ===========================================================================
// Pure helpers (unit-tested in Node)
// ===========================================================================

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const easeOutCubic = (p: number) => 1 - (1 - clamp01(p)) ** 3;
export const easeInCubic = (p: number) => clamp01(p) ** 3;
export const smoothstep = (p: number) => {
  const x = clamp01(p);
  return x * x * (3 - 2 * x);
};
/** Overshoots past 1 before settling (pop). */
export const easeOutBack = (p: number) => {
  const x = clamp01(p);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};
/** Pulls back below 0 before accelerating (pop out). */
export const easeInBack = (p: number) => {
  const x = clamp01(p);
  const c1 = 1.70158;
  return (c1 + 1) * x ** 3 - c1 * x ** 2;
};

/**
 * Line breaking: hard breaks at '\n', then greedy word wrap at `maxWidth`
 * (0 = no wrapping). Words wider than the line are broken between characters.
 */
export function breakLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  const paras = text.replace(/\r\n?/g, '\n').split('\n');
  for (const para of paras) {
    if (!(maxWidth > 0)) {
      out.push(para);
      continue;
    }
    const words = para.split(/ +/).filter((w, i, a) => w !== '' || a.length === 1);
    let line = '';
    const pushLong = (word: string) => {
      // break an over-long word by characters; the remainder continues the line
      let chunk = '';
      for (const ch of word) {
        if (chunk && measure(chunk + ch) > maxWidth) {
          out.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    };
    for (const w of words) {
      if (!line) {
        if (measure(w) > maxWidth) pushLong(w);
        else line = w;
        continue;
      }
      const candidate = `${line} ${w}`;
      if (measure(candidate) <= maxWidth) line = candidate;
      else {
        out.push(line);
        line = '';
        if (measure(w) > maxWidth) pushLong(w);
        else line = w;
      }
    }
    out.push(line);
  }
  return out;
}

export interface TextAnimState {
  opacity: number;
  /** Offsets in frame pixels. */
  dx: number;
  dy: number;
  scale: number;
  /** Gaussian blur radius in px. */
  blur: number;
  /** Added to the letter spacing (px). */
  letterSpacing: number;
  /** Typewriter: fraction of characters revealed (null = all). */
  reveal: number | null;
  /** Word-by-word: progress 0..1 across the words (null = all). */
  words: number | null;
  /** Draw the typewriter caret. */
  caret: boolean;
}

/** In/out progress (0..1 each; 1 = fully on screen) with durations fitted to the clip. */
export function animPhases(anim: TextAnimation, local: number, duration: number): { pin: number; pout: number; inDur: number; outDur: number } {
  let inDur = anim.in !== 'none' ? Math.max(0, anim.inDuration) : 0;
  let outDur = anim.out !== 'none' ? Math.max(0, anim.outDuration) : 0;
  if (duration > 0 && inDur + outDur > duration) {
    const k = duration / (inDur + outDur);
    inDur *= k;
    outDur *= k;
  }
  const pin = inDur > 0 ? clamp01(local / inDur) : 1;
  const pout = outDur > 0 ? clamp01((duration - local) / outDur) : 1;
  return { pin, pout, inDur, outDur };
}

/** The animated look of a title at clip-local time `local`. */
export function textAnimState(anim: TextAnimation, local: number, duration: number, size: number, frameHeight: number): TextAnimState {
  const s: TextAnimState = { opacity: 1, dx: 0, dy: 0, scale: 1, blur: 0, letterSpacing: 0, reveal: null, words: null, caret: false };
  const { pin, pout } = animPhases(anim, local, duration);
  const D = Math.max(size * 1.1, frameHeight * 0.05);
  if (anim.in !== 'none' && pin < 1) {
    const p = pin;
    const eo = easeOutCubic(p);
    switch (anim.in) {
      case 'fade':
        s.opacity *= smoothstep(p);
        break;
      case 'slideUp':
        s.dy += (1 - eo) * D;
        s.opacity *= easeOutCubic(Math.min(1, p * 1.6));
        break;
      case 'slideDown':
        s.dy -= (1 - eo) * D;
        s.opacity *= easeOutCubic(Math.min(1, p * 1.6));
        break;
      case 'slideLeft':
        s.dx += (1 - eo) * D;
        s.opacity *= easeOutCubic(Math.min(1, p * 1.6));
        break;
      case 'slideRight':
        s.dx -= (1 - eo) * D;
        s.opacity *= easeOutCubic(Math.min(1, p * 1.6));
        break;
      case 'typewriter':
        s.reveal = p;
        s.caret = true;
        break;
      case 'pop':
        s.scale *= Math.max(0, easeOutBack(p));
        s.opacity *= Math.min(1, p * 4);
        break;
      case 'blur':
        s.blur += (1 - eo) * size * 0.35;
        s.opacity *= smoothstep(Math.min(1, p * 1.25));
        break;
      case 'wordByWord':
        s.words = p;
        break;
      case 'tracking':
        s.letterSpacing += (1 - eo) * size * 0.6;
        s.opacity *= smoothstep(p);
        break;
    }
  }
  if (anim.out !== 'none' && pout < 1) {
    const q = 1 - pout; // exit progress
    const ei = easeInCubic(q);
    const fadeOut = 1 - smoothstep(q);
    switch (anim.out) {
      case 'fade':
        s.opacity *= fadeOut;
        break;
      case 'slideUp':
        s.dy -= ei * D;
        s.opacity *= fadeOut;
        break;
      case 'slideDown':
        s.dy += ei * D;
        s.opacity *= fadeOut;
        break;
      case 'slideLeft':
        s.dx -= ei * D;
        s.opacity *= fadeOut;
        break;
      case 'slideRight':
        s.dx += ei * D;
        s.opacity *= fadeOut;
        break;
      case 'pop':
        s.scale *= Math.max(0, 1 - easeInBack(q));
        s.opacity *= q < 0.75 ? 1 : 1 - (q - 0.75) / 0.25;
        break;
      case 'blur':
        s.blur += ei * size * 0.35;
        s.opacity *= fadeOut;
        break;
      case 'tracking':
        s.letterSpacing += ei * size * 0.6;
        s.opacity *= fadeOut;
        break;
    }
  }
  s.opacity = clamp01(s.opacity);
  return s;
}

/** Opacity of word `i` of `n` at word-by-word progress `p` (words overlap by ~1.6 slots). */
export function wordAlpha(i: number, n: number, p: number): number {
  if (n <= 0) return 1;
  const k = 1.6;
  const v = (clamp01(p) * (n + k - 1) - i) / k;
  return v >= 1 - 1e-9 ? 1 : clamp01(v);
}

/** Number of characters a typewriter shows at reveal fraction `p` of `total`. */
export function revealCount(p: number, total: number): number {
  return Math.max(0, Math.min(total, Math.floor(clamp01(p) * total + 1e-6)));
}

/**
 * CSS-style linear gradient line for an angle (0° = to top, 90° = to right)
 * across a w×h box: start and end points.
 */
export function gradientLine(angleDeg: number, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const len = Math.abs(w * dx) + Math.abs(h * dy);
  const cx = w / 2;
  const cy = h / 2;
  return { x0: cx - (dx * len) / 2, y0: cy - (dy * len) / 2, x1: cx + (dx * len) / 2, y1: cy + (dy * len) / 2 };
}

/**
 * Vertical placement of caption blocks so several caption tracks never
 * overlap: blocks sharing a position stack away from the edge (bottom: the
 * first block sits lowest; top: highest; middle: centered as a group).
 * Returns the top y of each block.
 */
export function stackCaptionBlocks(blocks: { position: CaptionStyle['position']; margin: number; height: number; gap: number }[], frameHeight: number): number[] {
  const tops = new Array<number>(blocks.length).fill(0);
  let bottomCursor: number | null = null;
  let topCursor: number | null = null;
  const middle: number[] = [];
  blocks.forEach((b, i) => {
    if (b.position === 'bottom') {
      const cur: number = bottomCursor ?? frameHeight - b.margin;
      tops[i] = cur - b.height;
      bottomCursor = tops[i] - b.gap;
    } else if (b.position === 'top') {
      const cur: number = topCursor ?? b.margin;
      tops[i] = cur;
      topCursor = cur + b.height + b.gap;
    } else middle.push(i);
  });
  if (middle.length) {
    const total = middle.reduce((acc, i, k) => acc + blocks[i].height + (k ? blocks[i].gap : 0), 0);
    let y = (frameHeight - total) / 2;
    middle.forEach((i, k) => {
      if (k) y += blocks[i].gap;
      tops[i] = y;
      y += blocks[i].height;
    });
  }
  return tops;
}

const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);

/** Quotes family names so any user-provided list is a valid CSS font-family. */
export function cssFontFamily(family: string): string {
  const parts = family
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((f) => (/^["']/.test(f) || GENERIC_FAMILIES.has(f.toLowerCase()) ? f : `"${f.replace(/["\\]/g, '')}"`));
  return parts.length ? parts.join(', ') : 'sans-serif';
}

/** Canvas `font` shorthand. */
export function cssFont(t: { italic?: boolean; weight: number; size: number; font: string }): string {
  const w = Math.round(Math.min(1000, Math.max(1, t.weight || 400)));
  return `${t.italic ? 'italic ' : ''}${w} ${Math.max(0.5, t.size)}px ${cssFontFamily(t.font)}`;
}

/** '#rgb' / '#rrggbb' / '#rrggbbaa' → rgba() with an extra alpha multiplier. */
export function colorWithAlpha(hex: string, alpha: number): string {
  let s = (hex || '#000000').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(s)) return hex;
  if (s.length === 3 || s.length === 4) s = [...s].map((c) => c + c).join('');
  if (s.length !== 6 && s.length !== 8) return hex;
  const n = parseInt(s.slice(0, 6), 16);
  const a = (s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1) * clamp01(alpha);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(a * 1000) / 1000})`;
}

// ===========================================================================
// Canvas cache and pool
// ===========================================================================

/** Pixel budget for cached rasters (~256 MB of RGBA). */
const CACHE_PIXELS = 64e6;
const POOL_PER_SIZE = 3;
const cache = new Map<string, Raster>();
let cachedPixels = 0;
const pool = new Map<string, Raster[]>();
const versions = new WeakMap<Raster, number>();
let versionSeq = 0;

/** Changes every time the canvas is (re)drawn (for identity-keyed texture caches). */
export function rasterVersion(c: OffscreenCanvas): number {
  return versions.get(c) ?? 0;
}

function sizeKey(w: number, h: number) {
  return `${w}x${h}`;
}

function newCanvas(w: number, h: number): Raster {
  return new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

function acquire(w: number, h: number): Raster {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  const free = pool.get(sizeKey(W, H));
  return free?.pop() ?? newCanvas(W, H);
}

function release(c: Raster) {
  const k = sizeKey(c.width, c.height);
  const list = pool.get(k) ?? [];
  if (list.length < POOL_PER_SIZE) {
    list.push(c);
    pool.set(k, list);
  }
}

function resetCtx(ctx: Ctx, w: number, h: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.letterSpacing = '0px';
  ctx.clearRect(0, 0, w, h);
}

function cachedRaster(key: string, w: number, h: number, draw: (ctx: Ctx, c: Raster) => void): Raster {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // most recently used
    return hit;
  }
  const c = acquire(w, h);
  const ctx = c.getContext('2d') as Ctx;
  resetCtx(ctx, c.width, c.height);
  ctx.save();
  try {
    draw(ctx, c);
  } finally {
    ctx.restore();
  }
  versions.set(c, ++versionSeq);
  cache.set(key, c);
  cachedPixels += c.width * c.height;
  while (cachedPixels > CACHE_PIXELS && cache.size > 1) {
    const [k, old] = cache.entries().next().value as [string, Raster];
    cache.delete(k);
    cachedPixels -= old.width * old.height;
    release(old);
  }
  return c;
}

/** Drops every cached raster (fonts changed, memory pressure). */
export function clearRasterCache(): void {
  for (const c of cache.values()) release(c);
  cache.clear();
  cachedPixels = 0;
}

// Scratch canvases for text layers (small, reused).
let scratch: Raster | null = null;
function scratchCanvas(w: number, h: number): Raster {
  const W = Math.max(1, Math.ceil(w / 64) * 64);
  const H = Math.max(1, Math.ceil(h / 64) * 64);
  if (!scratch || scratch.width < W || scratch.height < H) scratch = newCanvas(Math.max(W, scratch?.width ?? 0), Math.max(H, scratch?.height ?? 0));
  return scratch;
}

// Shared measuring context.
let measureCtx: Ctx | null = null;
function measurer(): Ctx {
  if (!measureCtx) measureCtx = newCanvas(8, 8).getContext('2d') as Ctx;
  return measureCtx;
}

// ===========================================================================
// Fonts
// ===========================================================================

type FontSetLike = {
  check(font: string, text?: string): boolean;
  load(font: string, text?: string): Promise<unknown[]>;
  addEventListener?(type: string, cb: () => void): void;
};

const fontRequests = new Set<string>();
const fontListeners = new Set<() => void>();
let fontEpoch = 0;
let fontEventsHooked = false;

function fontSet(): FontSetLike | null {
  const g = globalThis as unknown as { document?: { fonts?: FontSetLike }; fonts?: FontSetLike };
  return g.document?.fonts ?? g.fonts ?? null;
}

function fontsChanged() {
  fontEpoch++;
  clearRasterCache();
  for (const cb of [...fontListeners]) {
    try {
      cb();
    } catch {
      /* listener errors must not break rendering */
    }
  }
}

/** Called whenever a font used by a title or caption finishes loading. Returns an unsubscribe function. */
export function onFontsLoaded(cb: () => void): () => void {
  fontListeners.add(cb);
  return () => fontListeners.delete(cb);
}

/** Makes sure a font (CSS shorthand) is loading; triggers a re-render when it arrives. */
export function ensureFont(font: string, sample = 'AaBb'): void {
  const fs = fontSet();
  if (!fs) return;
  if (!fontEventsHooked && fs.addEventListener) {
    fontEventsHooked = true;
    // The browser may lazily load more faces (other unicode ranges) on its own.
    fs.addEventListener('loadingdone', () => fontsChanged());
  }
  const key = font;
  if (fontRequests.has(key)) return;
  fontRequests.add(key);
  let ready = false;
  try {
    ready = fs.check(font, sample);
  } catch {
    ready = true;
  }
  if (ready) return;
  fs.load(font, sample).then(
    (faces) => {
      if (faces.length) fontsChanged();
    },
    () => {
      /* unknown family: the fallback is used */
    },
  );
}

// ===========================================================================
// Text
// ===========================================================================

interface LaidLine {
  text: string;
  width: number;
  /** Left x relative to the block center. */
  x: number;
  /** Baseline y relative to the block center. */
  baseline: number;
}

interface TextLayout {
  lines: LaidLine[];
  /** Ink bounds relative to the block center. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  ascent: number;
  descent: number;
}

function layoutText(ctx: Ctx, t: TextProps, content: string, letterSpacing: number): TextLayout {
  ctx.font = cssFont(t);
  ctx.letterSpacing = `${letterSpacing}px`;
  const trail = letterSpacing;
  const measure = (s: string) => (s ? ctx.measureText(s).width - trail : 0);
  const rawLines = breakLines(content, t.maxWidth, measure);
  const m = ctx.measureText('Hg');
  const ascent = m.fontBoundingBoxAscent || t.size * 0.9;
  const descent = m.fontBoundingBoxDescent || t.size * 0.24;
  const lineH = t.size * t.lineHeight;
  const widths = rawLines.map(measure);
  const widest = Math.max(0, ...widths);
  const boxW = t.maxWidth > 0 ? Math.max(t.maxWidth, widest) : widest;
  const blockH = (rawLines.length - 1) * lineH + ascent + descent;
  const top = -blockH / 2;
  const lines = rawLines.map((text, i) => {
    const w = widths[i];
    const x = t.align === 'left' ? -boxW / 2 : t.align === 'right' ? boxW / 2 - w : -w / 2;
    return { text, width: w, x, baseline: top + ascent + i * lineH };
  });
  const nonEmpty = lines.filter((l) => l.width > 0);
  const left = nonEmpty.length ? Math.min(...nonEmpty.map((l) => l.x)) : 0;
  const right = nonEmpty.length ? Math.max(...nonEmpty.map((l) => l.x + l.width)) : 0;
  return { lines, left, right, top, bottom: top + blockH, ascent, descent };
}

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function q(v: number, step: number) {
  return Math.round(v / step) * step;
}

/** Draws a laid-out title (stroke behind fill, typewriter / word reveal) into `ctx` at (ox, oy) = block center. */
function drawGlyphs(ctx: Ctx, t: TextProps, layout: TextLayout, st: TextAnimState, ox: number, oy: number) {
  const totalChars = layout.lines.reduce((n, l) => n + [...l.text].length, 0);
  const shown = st.reveal !== null ? revealCount(st.reveal, totalChars) : Infinity;
  const allWords = layout.lines.flatMap((l) => l.text.split(' ').filter(Boolean));
  const nWords = allWords.length;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const passes: ('stroke' | 'fill')[] = t.stroke.enabled && t.stroke.width > 0 ? ['stroke', 'fill'] : ['fill'];
  let caret: { x: number; y: number } | null = null;
  for (const pass of passes) {
    if (pass === 'stroke') {
      ctx.strokeStyle = t.stroke.color;
      ctx.lineWidth = t.stroke.width * 2; // the inner half is covered by the fill
    } else ctx.fillStyle = t.color;
    let charIndex = 0;
    let wordIndex = 0;
    for (const line of layout.lines) {
      const x = ox + line.x;
      const y = oy + line.baseline;
      if (st.words !== null) {
        let cursor = 0;
        for (const part of line.text.split(' ')) {
          if (part) {
            const a = wordAlpha(wordIndex, nWords, st.words);
            if (a > 0.001) {
              const px = x + (cursor ? ctx.measureText(line.text.slice(0, cursor)).width : 0);
              const py = y + (1 - a) * t.size * 0.25;
              ctx.globalAlpha = a;
              if (pass === 'stroke') ctx.strokeText(part, px, py);
              else ctx.fillText(part, px, py);
            }
            wordIndex++;
          }
          cursor += part.length + 1;
        }
        ctx.globalAlpha = 1;
        continue;
      }
      const chars = [...line.text];
      let text = line.text;
      if (charIndex + chars.length > shown) {
        const n = Math.max(0, shown - charIndex);
        text = chars.slice(0, n).join('');
        if (!caret) caret = { x: x + (text ? ctx.measureText(text).width : 0), y };
      }
      charIndex += chars.length;
      if (text) {
        if (pass === 'stroke') ctx.strokeText(text, x, y);
        else ctx.fillText(text, x, y);
      }
    }
    if (st.caret && st.reveal !== null && !caret && layout.lines.length) {
      const last = layout.lines[layout.lines.length - 1];
      caret = { x: ox + last.x + last.width, y: oy + last.baseline };
    }
  }
  if (st.caret && caret) {
    const w = Math.max(2, t.size * 0.06);
    ctx.fillStyle = t.color;
    ctx.fillRect(caret.x + t.size * 0.04, caret.y - layout.ascent * 0.78, w, layout.ascent * 0.78 + layout.descent * 0.35);
  }
}

export function rasterizeText(src: Extract<LayerSource, { kind: 'text' }>): Raster {
  const t = src.text;
  const W = Math.max(1, Math.round(src.width));
  const H = Math.max(1, Math.round(src.height));
  const st = textAnimState(t.animation, src.local, src.duration, t.size, H);
  const content = t.uppercase ? t.content.toUpperCase() : t.content;
  const font = cssFont(t);
  ensureFont(font, content.slice(0, 64) || 'Aa');
  const key = [
    'text',
    W,
    H,
    fontEpoch,
    JSON.stringify({ ...t, content, animation: undefined }),
    q(st.opacity, 1 / 512),
    q(st.dx, 0.25),
    q(st.dy, 0.25),
    q(st.scale, 1 / 2048),
    q(st.blur, 0.1),
    q(st.letterSpacing, 0.05),
    st.reveal === null ? '' : revealCount(st.reveal, [...content.replace(/\n/g, '')].length),
    st.words === null ? '' : q(st.words, 1 / 600),
    st.caret ? 1 : 0,
  ].join('|');
  return cachedRaster(key, W, H, (ctx) => {
    if (st.opacity <= 0.001 || st.scale <= 0.0001) return;
    const m = measurer();
    const layout = layoutText(m, t, content, t.letterSpacing + st.letterSpacing);
    const bg = t.background;
    // Text layer: glyphs at full opacity, composited once (so stroke/fill overlap never shows through a fade).
    const margin = Math.ceil((t.stroke.enabled ? t.stroke.width : 0) + t.size * 0.35 + 4);
    const inkW = Math.max(1, layout.right - layout.left);
    const inkH = Math.max(1, layout.bottom - layout.top);
    const lw = Math.ceil(inkW + margin * 2);
    const lh = Math.ceil(inkH + margin * 2);
    const layer = scratchCanvas(lw, lh);
    const lctx = layer.getContext('2d') as Ctx;
    resetCtx(lctx, Math.min(layer.width, lw + 64), Math.min(layer.height, lh + 64));
    lctx.font = font;
    lctx.letterSpacing = `${t.letterSpacing + st.letterSpacing}px`;
    const ox = margin - layout.left;
    const oy = margin - layout.top;
    drawGlyphs(lctx, t, layout, st, ox, oy);

    ctx.translate(W / 2 + st.dx, H / 2 + st.dy);
    if (st.scale !== 1) ctx.scale(st.scale, st.scale);
    ctx.globalAlpha = st.opacity;
    if (st.blur > 0.05) ctx.filter = `blur(${st.blur.toFixed(2)}px)`;
    if (bg.enabled) {
      ctx.fillStyle = colorWithAlpha(bg.color, bg.opacity);
      const x0 = layout.left - bg.paddingX;
      const y0 = layout.top - bg.paddingY;
      roundRectPath(ctx, x0, y0, layout.right - layout.left + bg.paddingX * 2, layout.bottom - layout.top + bg.paddingY * 2, bg.radius);
      ctx.fill();
    }
    if (t.shadow.enabled) {
      ctx.shadowColor = colorWithAlpha(t.shadow.color, t.shadow.opacity);
      ctx.shadowBlur = Math.max(0, t.shadow.blur) * Math.max(0.05, st.scale);
      ctx.shadowOffsetX = t.shadow.x * st.scale;
      ctx.shadowOffsetY = t.shadow.y * st.scale;
    }
    ctx.drawImage(layer, 0, 0, lw, lh, layout.left - margin, layout.top - margin, lw, lh);
  });
}

/** Ink bounds of a title at full reveal, in frame pixels relative to the frame center (for overlays / snapping). */
export function measureText(t: TextProps): { left: number; right: number; top: number; bottom: number } {
  const m = measurer();
  const layout = layoutText(m, t, t.uppercase ? t.content.toUpperCase() : t.content, t.letterSpacing);
  return { left: layout.left, right: layout.right, top: layout.top, bottom: layout.bottom };
}

// ===========================================================================
// Shapes, solids, gradients
// ===========================================================================

function shapePath(ctx: Ctx, s: ShapeProps, cx: number, cy: number) {
  const w = Math.max(0, s.width);
  const h = Math.max(0, s.height);
  const x = cx - w / 2;
  const y = cy - h / 2;
  switch (s.kind) {
    case 'rect':
      roundRectPath(ctx, x, y, w, h, s.radius);
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.closePath();
      break;
    case 'triangle': {
      const pts: [number, number][] = [
        [cx, y],
        [x + w, y + h],
        [x, y + h],
      ];
      const r = Math.max(0, Math.min(s.radius, Math.min(w, h) / 3));
      ctx.beginPath();
      if (r <= 0) {
        ctx.moveTo(pts[0][0], pts[0][1]);
        ctx.lineTo(pts[1][0], pts[1][1]);
        ctx.lineTo(pts[2][0], pts[2][1]);
      } else {
        // rounded corners: start mid-edge, arcTo through each vertex
        const mid = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as [number, number];
        const start = mid(pts[2], pts[0]);
        ctx.moveTo(start[0], start[1]);
        for (let i = 0; i < 3; i++) {
          const p = pts[i];
          const n = pts[(i + 1) % 3];
          ctx.arcTo(p[0], p[1], n[0], n[1], r);
        }
      }
      ctx.closePath();
      break;
    }
    case 'line':
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h);
      break;
  }
}

export function rasterizeShape(src: Extract<LayerSource, { kind: 'shape' }>): Raster {
  const W = Math.max(1, Math.round(src.width));
  const H = Math.max(1, Math.round(src.height));
  const s = src.shape;
  const key = `shape|${W}x${H}|${JSON.stringify(s)}`;
  return cachedRaster(key, W, H, (ctx) => {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (s.kind === 'line') {
      // A line is drawn with the stroke when enabled, otherwise with the fill color; thickness = stroke width.
      shapePath(ctx, s, W / 2, H / 2);
      ctx.strokeStyle = s.stroke.enabled ? s.stroke.color : s.fill.color;
      ctx.lineWidth = Math.max(1, s.stroke.width);
      ctx.stroke();
      return;
    }
    shapePath(ctx, s, W / 2, H / 2);
    if (s.fill.enabled) {
      ctx.fillStyle = s.fill.color;
      ctx.fill();
    }
    if (s.stroke.enabled && s.stroke.width > 0) {
      ctx.strokeStyle = s.stroke.color;
      ctx.lineWidth = s.stroke.width;
      ctx.stroke();
    }
  });
}

export function rasterizeSolid(src: Extract<LayerSource, { kind: 'solid' }>): Raster {
  const W = Math.max(1, Math.round(src.width));
  const H = Math.max(1, Math.round(src.height));
  return cachedRaster(`solid|${W}x${H}|${src.color}`, W, H, (ctx) => {
    ctx.fillStyle = src.color;
    ctx.fillRect(0, 0, W, H);
  });
}

function sortedStops(g: GradientProps) {
  const stops = [...g.stops].map((s) => ({ pos: clamp01(s.pos), color: s.color })).sort((a, b) => a.pos - b.pos);
  return stops.length ? stops : [{ pos: 0, color: '#000000' }];
}

export function rasterizeGradient(src: Extract<LayerSource, { kind: 'gradient' }>): Raster {
  const W = Math.max(1, Math.round(src.width));
  const H = Math.max(1, Math.round(src.height));
  const g = src.gradient;
  return cachedRaster(`gradient|${W}x${H}|${JSON.stringify(g)}`, W, H, (ctx) => {
    let grad: CanvasGradient;
    if (g.kind === 'radial') {
      grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
    } else {
      const l = gradientLine(g.angle, W, H);
      grad = ctx.createLinearGradient(l.x0, l.y0, l.x1, l.y1);
    }
    for (const s of sortedStops(g)) {
      try {
        grad.addColorStop(s.pos, s.color);
      } catch {
        /* invalid color string: skip the stop */
      }
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  });
}

// ===========================================================================
// Captions
// ===========================================================================

interface CaptionBlock {
  cap: CaptionNode;
  lines: { text: string; width: number }[];
  lineH: number;
  ascent: number;
  descent: number;
  padX: number;
  padY: number;
  height: number;
}

/** All captions active at this frame, drawn into one frame-sized overlay. */
export function rasterizeCaptions(captions: CaptionNode[], width: number, height: number): Raster | null {
  if (!captions.length) return null;
  const W = Math.max(1, Math.round(width));
  const H = Math.max(1, Math.round(height));
  for (const c of captions) ensureFont(cssFont({ ...c.style, italic: false }), c.cue.text.slice(0, 64) || 'Aa');
  const key = `captions|${W}x${H}|${fontEpoch}|${captions.map((c) => `${c.trackId}:${c.cue.id}:${c.cue.text}:${JSON.stringify(c.style)}`).join('|')}`;
  return cachedRaster(key, W, H, (ctx) => {
    const m = measurer();
    const blocks: CaptionBlock[] = captions.map((cap) => {
      const st = cap.style;
      m.font = cssFont({ ...st, italic: false });
      m.letterSpacing = '0px';
      const measure = (s: string) => (s ? m.measureText(s).width : 0);
      const wrap = Math.max(st.size * 2, (st.maxWidth > 0 ? st.maxWidth : 0.9) * W);
      const lines = breakLines(cap.cue.text.trim(), wrap, measure).map((text) => ({ text, width: measure(text) }));
      const mm = m.measureText('Hg');
      const ascent = mm.fontBoundingBoxAscent || st.size * 0.9;
      const descent = mm.fontBoundingBoxDescent || st.size * 0.24;
      const padX = st.size * 0.38;
      const padY = st.size * 0.12;
      const lineH = ascent + descent + padY * 2;
      return { cap, lines, lineH, ascent, descent, padX, padY, height: lineH * lines.length };
    });
    const tops = stackCaptionBlocks(
      blocks.map((b) => ({ position: b.cap.style.position, margin: b.cap.style.margin, height: b.height, gap: b.cap.style.size * 0.35 })),
      H,
    );
    blocks.forEach((b, bi) => {
      const st = b.cap.style;
      const areaW = (st.maxWidth > 0 ? st.maxWidth : 0.9) * W;
      const areaLeft = (W - areaW) / 2;
      ctx.font = cssFont({ ...st, italic: false });
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.lineJoin = 'round';
      b.lines.forEach((line, i) => {
        if (!line.text) return;
        const x = st.align === 'left' ? areaLeft + b.padX : st.align === 'right' ? areaLeft + areaW - b.padX - line.width : (W - line.width) / 2;
        const top = tops[bi] + i * b.lineH;
        const baseline = top + b.padY + b.ascent;
        if (st.background) {
          ctx.fillStyle = st.background;
          roundRectPath(ctx, x - b.padX, top, line.width + b.padX * 2, b.lineH, Math.min(st.size * 0.14, b.lineH / 2));
          ctx.fill();
        }
        if (st.outline > 0) {
          ctx.strokeStyle = st.outlineColor;
          ctx.lineWidth = st.outline * 2;
          ctx.strokeText(line.text, x, baseline);
        }
        ctx.fillStyle = st.color;
        ctx.fillText(line.text, x, baseline);
      });
    });
  });
}
