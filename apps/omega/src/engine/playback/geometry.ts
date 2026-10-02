// Layer geometry shared by the program viewer's direct-manipulation overlay
// (transform gizmo, crop and mask handles, text editing, click-to-select)
// and anything else that needs to know where a layer lands in the frame.
// Pure math, no DOM. OWNED BY THE VIEWER PACKAGE.
//
// Conventions (state/types.ts, matched by the GPU renderer):
//   * Sequence space: pixels of the rendered frame (W × H), origin top-left,
//     +x right, +y down.
//   * Layer space: the layer's own pixels (a media layer's source pixels; a
//     generated layer is frame-sized), origin at the layer CENTER, +y down.
//   * `fit` maps layer pixels to "fitted" pixels (fit / fill / stretch / none).
//   * `x`/`y` offset the layer center from the frame center, in sequence pixels.
//   * `anchorX`/`anchorY` offset the anchor (the pivot of scale and rotation)
//     from the layer center, in layer pixels.
//   * `rotation` is in degrees, clockwise on screen.
//   * flipH / flipV mirror the picture about the layer center (texture space);
//     crop and masks are defined in that same texture space.
//
//   seq = C + xy + F·A + R · S · (F·u − F·A)      (u in layer pixels)
//
// where C is the frame center, F = diag(fx, fy) the fit factors, A the anchor,
// S = diag(scale·scaleX, scale·scaleY) and R the rotation. With scale 1 and no
// rotation the layer center sits exactly at C + xy whatever the anchor is, and
// the anchor stays put on screen when scale or rotation change.

import type { Crop, FitMode, Mask, TextProps, Transform } from '../../state/types';

export interface Vec {
  x: number;
  y: number;
}

/** 2D affine map in canvas/SVG order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LayerTransform = Pick<Transform, 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotation' | 'anchorX' | 'anchorY' | 'fit' | 'flipH' | 'flipV'>;

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Affine basics
// ---------------------------------------------------------------------------

export function apply(m: Affine, p: Vec): Vec {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** Applies only the linear part (for direction vectors / deltas). */
export function applyLinear(m: Affine, v: Vec): Vec {
  return { x: m.a * v.x + m.c * v.y, y: m.b * v.x + m.d * v.y };
}

/** m1 ∘ m2: apply m2 first, then m1. */
export function multiply(m1: Affine, m2: Affine): Affine {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function compose(...ms: Affine[]): Affine {
  return ms.reduce((acc, m) => multiply(acc, m), IDENTITY);
}

export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return IDENTITY;
  const a = m.d / det;
  const b = -m.b / det;
  const c = -m.c / det;
  const d = m.a / det;
  return { a, b, c, d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) };
}

export const translate = (x: number, y: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });
export const scaling = (sx: number, sy: number): Affine => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
/** Clockwise on screen (y points down). */
export function rotation(deg: number): Affine {
  const r = deg * DEG;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function toSvgMatrix(m: Affine): string {
  return `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`;
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------------------------------------------------------------------------
// Layer placement
// ---------------------------------------------------------------------------

/** Scale factors from layer pixels to fitted pixels for a fit mode. */
export function fitFactors(fit: FitMode, sw: number, sh: number, W: number, H: number): { fx: number; fy: number } {
  if (!(sw > 0) || !(sh > 0)) return { fx: 1, fy: 1 };
  switch (fit) {
    case 'fit': {
      const s = Math.min(W / sw, H / sh);
      return { fx: s, fy: s };
    }
    case 'fill': {
      const s = Math.max(W / sw, H / sh);
      return { fx: s, fy: s };
    }
    case 'stretch':
      return { fx: W / sw, fy: H / sh };
    default:
      return { fx: 1, fy: 1 };
  }
}

/** Layer pixels (origin at the layer center) → sequence pixels. Flips are not included (see contentMatrix). */
export function layerMatrix(tf: LayerTransform, sw: number, sh: number, W: number, H: number): Affine {
  const { fx, fy } = fitFactors(tf.fit, sw, sh, W, H);
  const ax = tf.anchorX * fx;
  const ay = tf.anchorY * fy;
  return compose(
    translate(W / 2 + tf.x + ax, H / 2 + tf.y + ay),
    rotation(tf.rotation),
    scaling(tf.scale * tf.scaleX, tf.scale * tf.scaleY),
    translate(-ax, -ay),
    scaling(fx, fy),
  );
}

/** Texture space (where crop and masks live, before the flips) → sequence pixels. */
export function contentMatrix(tf: LayerTransform, sw: number, sh: number, W: number, H: number): Affine {
  return multiply(layerMatrix(tf, sw, sh, W, H), scaling(tf.flipH ? -1 : 1, tf.flipV ? -1 : 1));
}

/** Where the anchor (pivot) lands in sequence pixels. */
export function anchorPoint(tf: LayerTransform, sw: number, sh: number, W: number, H: number): Vec {
  return apply(layerMatrix(tf, sw, sh, W, H), { x: tf.anchorX, y: tf.anchorY });
}

export function rectCorners(r: Rect): Vec[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

/** Corners (TL, TR, BR, BL in layer orientation) of a layer-space rect, in sequence pixels. */
export function quad(m: Affine, r: Rect): Vec[] {
  return rectCorners(r).map((p) => apply(m, p));
}

export function boundsOf(points: Vec[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

export function rectContains(r: Rect, p: Vec, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

/** The full layer rect in layer pixels. */
export function layerRect(sw: number, sh: number): Rect {
  return { x: -sw / 2, y: -sh / 2, w: sw, h: sh };
}

/** The part of the layer left visible by the crop, in texture-space layer pixels. */
export function croppedRect(sw: number, sh: number, crop: Pick<Crop, 'left' | 'top' | 'right' | 'bottom'>): Rect {
  const l = clamp01(crop.left);
  const t = clamp01(crop.top);
  const r = clamp01(crop.right);
  const b = clamp01(crop.bottom);
  return { x: -sw / 2 + l * sw, y: -sh / 2 + t * sh, w: Math.max(0, (1 - l - r) * sw), h: Math.max(0, (1 - t - b) * sh) };
}

export function intersectRect(a: Rect, b: Rect): Rect {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Mirrors a texture-space rect into layer space (the flips). */
export function flipRect(r: Rect, flipH: boolean, flipV: boolean): Rect {
  return { x: flipH ? -(r.x + r.w) : r.x, y: flipV ? -(r.y + r.h) : r.y, w: r.w, h: r.h };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v || 0));
}

// ---------------------------------------------------------------------------
// Content boxes of generated layers
// ---------------------------------------------------------------------------

/** Measures a string in a CSS font (injected so this stays DOM-free). */
export type TextMeasurer = (font: string, text: string) => number;

export function cssFont(t: Pick<TextProps, 'italic' | 'weight' | 'size' | 'font'>, size = t.size): string {
  return `${t.italic ? 'italic ' : ''}${Math.round(t.weight)} ${size}px ${t.font}`;
}

/** Splits text into the lines the rasterizer draws (explicit breaks + greedy wrapping at maxWidth). */
export function layoutTextLines(t: Pick<TextProps, 'content' | 'uppercase' | 'maxWidth' | 'letterSpacing' | 'italic' | 'weight' | 'size' | 'font'>, measure: TextMeasurer): { text: string; width: number }[] {
  const font = cssFont(t);
  const content = t.uppercase ? t.content.toUpperCase() : t.content;
  const width = (s: string) => measure(font, s) + Math.max(0, s.length - 1) * t.letterSpacing;
  const out: { text: string; width: number }[] = [];
  for (const para of content.split('\n')) {
    if (!(t.maxWidth > 0)) {
      out.push({ text: para, width: width(para) });
      continue;
    }
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const next = line + w;
      if (line.trim() && width(next.trimEnd()) > t.maxWidth) {
        out.push({ text: line.trimEnd(), width: width(line.trimEnd()) });
        line = w.trimStart();
      } else line = next;
    }
    out.push({ text: line.trimEnd(), width: width(line.trimEnd()) });
  }
  return out;
}

/** The text block's box in layer pixels (the rasterizer centers the block in the frame). */
export function textBox(t: TextProps, measure: TextMeasurer): Rect {
  const lines = layoutTextLines(t, measure);
  let w = Math.max(t.size * 0.3, ...lines.map((l) => l.width));
  let h = Math.max(1, lines.length) * t.size * t.lineHeight;
  if (t.background?.enabled) {
    w += t.background.paddingX * 2;
    h += t.background.paddingY * 2;
  }
  return { x: -w / 2, y: -h / 2, w, h };
}

// ---------------------------------------------------------------------------
// Direct manipulation
// ---------------------------------------------------------------------------

/**
 * Moves the anchor to the layer point under `p` (sequence pixels) without
 * moving the picture: x/y are compensated so the layer matrix is unchanged.
 */
export function moveAnchorTo(tf: LayerTransform, sw: number, sh: number, W: number, H: number, p: Vec): { anchorX: number; anchorY: number; x: number; y: number } {
  const m = layerMatrix(tf, sw, sh, W, H);
  const u = apply(invert(m), p);
  const { fx, fy } = fitFactors(tf.fit, sw, sh, W, H);
  // xy' = xy + (I − R·S)(A − A'), all in fitted pixels
  const dA = { x: (tf.anchorX - u.x) * fx, y: (tf.anchorY - u.y) * fy };
  const rs = multiply(rotation(tf.rotation), scaling(tf.scale * tf.scaleX, tf.scale * tf.scaleY));
  const rsd = applyLinear(rs, dA);
  return { anchorX: u.x, anchorY: u.y, x: tf.x + dA.x - rsd.x, y: tf.y + dA.y - rsd.y };
}

/** Uniform scale factor from dragging a corner away from / toward the pivot. */
export function uniformScaleFactor(pivot: Vec, start: Vec, current: Vec): number {
  const d0 = dist(pivot, start);
  if (d0 < 1e-6) return 1;
  const dir = { x: (start.x - pivot.x) / d0, y: (start.y - pivot.y) / d0 };
  const along = (current.x - pivot.x) * dir.x + (current.y - pivot.y) * dir.y;
  return Math.max(0.001, along / d0);
}

/**
 * Per-axis scale factors from a handle drag, measured in the layer's rotated
 * frame around the pivot (so edges stretch along the layer's own axes).
 */
export function axisScaleFactors(pivot: Vec, rotationDeg: number, start: Vec, current: Vec): { kx: number; ky: number } {
  const inv = rotation(-rotationDeg);
  const v0 = applyLinear(inv, { x: start.x - pivot.x, y: start.y - pivot.y });
  const v1 = applyLinear(inv, { x: current.x - pivot.x, y: current.y - pivot.y });
  const k = (a: number, b: number) => (Math.abs(a) < 1e-6 ? 1 : Math.max(0.001, b / a));
  return { kx: k(v0.x, v1.x), ky: k(v0.y, v1.y) };
}

/** Rotation (degrees) after dragging the rotation handle around the pivot. */
export function dragRotation(r0: number, pivot: Vec, start: Vec, current: Vec, snapDeg = 0): number {
  const a0 = Math.atan2(start.y - pivot.y, start.x - pivot.x);
  const a1 = Math.atan2(current.y - pivot.y, current.x - pivot.x);
  let delta = (a1 - a0) / DEG;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  let r = r0 + delta;
  if (snapDeg > 0) r = Math.round(r / snapDeg) * snapDeg;
  return Math.round(r * 100) / 100;
}

export interface SnapResult {
  dx: number;
  dy: number;
  /** Guide lines to draw (sequence pixels). */
  guidesX: number[];
  guidesY: number[];
}

/**
 * Snaps a moving box (its axis-aligned bounds after the move) to the frame's
 * edges and center. Returns the corrected delta and the guides that engaged.
 */
export function snapMove(bounds: { x0: number; y0: number; x1: number; y1: number }, dx: number, dy: number, W: number, H: number, threshold: number): SnapResult {
  const pick = (edges: number[], targets: number[], d: number) => {
    let best: { off: number; at: number } | null = null;
    for (const e of edges)
      for (const t of targets) {
        const off = t - (e + d);
        if (Math.abs(off) <= threshold && (!best || Math.abs(off) < Math.abs(best.off))) best = { off, at: t };
      }
    return best;
  };
  const sx = pick([bounds.x0, (bounds.x0 + bounds.x1) / 2, bounds.x1], [0, W / 2, W], dx);
  const sy = pick([bounds.y0, (bounds.y0 + bounds.y1) / 2, bounds.y1], [0, H / 2, H], dy);
  return {
    dx: dx + (sx?.off ?? 0),
    dy: dy + (sy?.off ?? 0),
    guidesX: sx ? [sx.at] : [],
    guidesY: sy ? [sy.at] : [],
  };
}

/** Snaps a single value to targets within a threshold. */
export function snapValue(v: number, targets: number[], threshold: number): { v: number; at: number | null } {
  let best: number | null = null;
  for (const t of targets) if (Math.abs(t - v) <= threshold && (best === null || Math.abs(t - v) < Math.abs(best - v))) best = t;
  return { v: best ?? v, at: best };
}

// ---------------------------------------------------------------------------
// Masks (texture space)
// ---------------------------------------------------------------------------

type MaskShape = Pick<Mask, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

/** Mask unit square (−0.5..0.5, origin at the mask center) → texture-space layer pixels. */
export function maskMatrix(mask: MaskShape, sw: number, sh: number): Affine {
  return compose(translate((mask.x - 0.5) * sw, (mask.y - 0.5) * sh), rotation(mask.rotation), scaling(mask.width * sw, mask.height * sh));
}

export function maskCenter(mask: MaskShape, sw: number, sh: number): Vec {
  return { x: (mask.x - 0.5) * sw, y: (mask.y - 0.5) * sh };
}

/** A texture-space point expressed in the mask's own rotated frame, relative to its center (layer pixels). */
export function maskLocal(mask: MaskShape, sw: number, sh: number, u: Vec): Vec {
  const c = maskCenter(mask, sw, sh);
  return applyLinear(rotation(-mask.rotation), { x: u.x - c.x, y: u.y - c.y });
}

/** New normalized size from dragging a mask handle (symmetric about the center). */
export function maskResize(mask: MaskShape, sw: number, sh: number, u: Vec, axis: 'x' | 'y' | 'both'): { width: number; height: number } {
  const v = maskLocal(mask, sw, sh, u);
  return {
    width: axis === 'y' ? mask.width : Math.max(0.005, (2 * Math.abs(v.x)) / sw),
    height: axis === 'x' ? mask.height : Math.max(0.005, (2 * Math.abs(v.y)) / sh),
  };
}

/** Points along a mask outline (texture-space layer pixels), grown outward by `grow` layer pixels. */
export function maskOutline(mask: MaskShape & Pick<Mask, 'shape'>, sw: number, sh: number, grow = 0, segments = 64): Vec[] {
  const hw = Math.max(0.5, (mask.width * sw) / 2 + grow);
  const hh = Math.max(0.5, (mask.height * sh) / 2 + grow);
  const c = maskCenter(mask, sw, sh);
  const rot = rotation(mask.rotation);
  const pts: Vec[] = [];
  if (mask.shape === 'ellipse') {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push({ x: Math.cos(a) * hw, y: Math.sin(a) * hh });
    }
  } else {
    pts.push({ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh });
  }
  return pts.map((p) => {
    const r = applyLinear(rot, p);
    return { x: r.x + c.x, y: r.y + c.y };
  });
}
