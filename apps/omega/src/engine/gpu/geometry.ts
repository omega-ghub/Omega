// Layer placement math (pure, unit-tested). OWNED BY THE RENDERER PACKAGE.
//
// Coordinates: "layer px" are the source's own pixels (top-left origin, y
// down). "Frame px" are sequence pixels (top-left origin, y down). The
// renderer multiplies frame px by the output scale for playback resolution.
//
// frame = C + (x, y) + R(rotation) · S · (F · (p − center) − anchor)
//   C        frame center
//   S        fit scale × scale × scaleX/scaleY
//   R        rotation, degrees clockwise (on screen, y down)
//   F        flipH / flipV about the layer center
//   anchor   anchor offset from the layer center, layer px: the anchor point
//            is the pivot for scale/rotation and lands at C + (x, y)

import type { FitMode, Transform } from '../../state/types';

/** 2D affine: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Affine = [number, number, number, number, number, number];

export const AFF_IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** A ∘ B (apply B first, then A). */
export function affMul(A: Affine, B: Affine): Affine {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}

export function affApply(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function affInvert(m: Affine): Affine {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return [0, 0, 0, 0, 0, 0];
  const k = 1 / det;
  const a = m[3] * k;
  const b = -m[1] * k;
  const c = -m[2] * k;
  const d = m[0] * k;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

const T = (x: number, y: number): Affine => [1, 0, 0, 1, x, y];
const S = (x: number, y: number): Affine => [x, 0, 0, y, 0, 0];
const R = (deg: number): Affine => {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, s, -s, c, 0, 0];
};

/** Scale that maps a w×h source into a W×H frame for a fit mode. */
export function fitScale(fit: FitMode, w: number, h: number, W: number, H: number): [number, number] {
  if (!(w > 0 && h > 0)) return [1, 1];
  switch (fit) {
    case 'fill': {
      const s = Math.max(W / w, H / h);
      return [s, s];
    }
    case 'stretch':
      return [W / w, H / h];
    case 'none':
      return [1, 1];
    case 'fit':
    default: {
      const s = Math.min(W / w, H / h);
      return [s, s];
    }
  }
}

/** Layer px → frame px for a layer of size w×h in a W×H frame. */
export function layerToFrame(t: Transform, w: number, h: number, W: number, H: number): Affine {
  const [fx, fy] = fitScale(t.fit, w, h, W, H);
  const sx = fx * t.scale * t.scaleX;
  const sy = fy * t.scale * t.scaleY;
  let m = T(-w / 2, -h / 2);
  m = affMul(S(t.flipH ? -1 : 1, t.flipV ? -1 : 1), m);
  m = affMul(T(-t.anchorX, -t.anchorY), m);
  m = affMul(S(sx, sy), m);
  m = affMul(R(t.rotation), m);
  m = affMul(T(W / 2 + t.x, H / 2 + t.y), m);
  return m;
}

/** On-screen pixels per layer pixel along the layer's x and y axes. */
export function axisScales(m: Affine): [number, number] {
  return [Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3])];
}

/**
 * Working resolution factor for a layer (texels per layer px), ≤ 1. Layers are
 * processed at about their on-screen size, rounded UP to quarter-octave steps
 * so animated scales reuse pooled textures.
 */
export function workingScale(onScreen: number, w: number, h: number, maxTex: number): number {
  let k = Math.min(1, Math.max(onScreen, 1e-4));
  k = Math.min(1, Math.pow(2, Math.ceil(Math.log2(k) * 4 - 1e-9) / 4));
  // never below one texel, never above the GPU's texture limit
  k = Math.max(k, 1 / Math.max(w, h, 1));
  k = Math.min(k, maxTex / Math.max(w, h, 1));
  return k;
}

/**
 * The four corners of a layer quad in frame px, padded by `pad` layer px on
 * each side (room for edge anti-aliasing), with matching GL-convention layer
 * uvs (v = 0 at the bottom of the layer image). Order: TL, TR, BL, BR.
 */
export function layerQuad(m: Affine, w: number, h: number, pad: number): { pos: [number, number][]; uv: [number, number][] } {
  const xs = [-pad, w + pad];
  const ys = [-pad, h + pad];
  const pos: [number, number][] = [];
  const uv: [number, number][] = [];
  for (const y of ys)
    for (const x of xs) {
      pos.push(affApply(m, x, y));
      uv.push([x / w, 1 - y / h]);
    }
  return { pos, uv };
}

/** Axis-aligned bounds of points, clamped to [0,W]×[0,H]; null when empty. */
export function boundsOf(pts: [number, number][], W: number, H: number): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  x0 = Math.max(0, Math.floor(x0));
  y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(W, Math.ceil(x1));
  y1 = Math.min(H, Math.ceil(y1));
  if (!(x1 > x0 && y1 > y0)) return null;
  return { x0, y0, x1, y1 };
}

/** Letterboxed frame rectangle inside an output canvas (aspect preserved). */
export function fitFrameInCanvas(W: number, H: number, cw: number, ch: number): { x: number; y: number; w: number; h: number } {
  if (!(W > 0 && H > 0)) return { x: 0, y: 0, w: cw, h: ch };
  let w = cw;
  let h = Math.round((cw * H) / W);
  if (h > ch) {
    h = ch;
    w = Math.round((ch * W) / H);
  }
  // Within a pixel of the canvas: use the whole canvas (no 1px bars).
  if (Math.abs(w - cw) <= 1 && Math.abs(h - ch) <= 1) return { x: 0, y: 0, w: cw, h: ch };
  w = Math.max(1, w);
  h = Math.max(1, h);
  return { x: Math.floor((cw - w) / 2), y: Math.floor((ch - h) / 2), w, h };
}
