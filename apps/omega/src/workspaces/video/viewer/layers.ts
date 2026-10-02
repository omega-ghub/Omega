// Where each layer of a frame graph sits on screen, for the direct
// manipulation overlay, click-to-select and the inline text editor. Uses the
// shared geometry in engine/playback/geometry.ts.
import type { FrameGraph, GraphItem, LayerNode } from '../../../engine/render/graph';
import { measureText as measureTitle } from '../../../engine/render/text';
import type { TextProps } from '../../../state/types';
import {
  apply,
  contentMatrix,
  croppedRect,
  intersectRect,
  invert,
  layerMatrix,
  layerRect,
  rectContains,
  textBox,
  type Affine,
  type Rect,
  type TextMeasurer,
  type Vec,
} from '../../../engine/playback/geometry';

export interface LayerInfo {
  node: LayerNode;
  /** Layer pixel size (source size for media, frame size for generated layers). */
  sw: number;
  sh: number;
  /** Layer (texture) space → sequence pixels, exactly as the renderer places the layer. */
  m: Affine;
  /** The same map, named for crop and mask drawing. */
  content: Affine;
  /** Visible content box in layer space (text block, shape, or the cropped picture). */
  box: Rect;
}

let measureCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

/** Canvas-based text measurer (same engine the rasterizer uses). */
export const measureText: TextMeasurer = (font, text) => {
  if (!measureCtx) {
    measureCtx = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8).getContext('2d') : document.createElement('canvas').getContext('2d');
  }
  if (!measureCtx) return text.length * 10;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
};

/** A title's box in layer pixels: the rasterizer's own ink bounds (plus background padding). */
export function titleBox(t: TextProps): Rect {
  try {
    const b = measureTitle(t);
    if ([b.left, b.right, b.top, b.bottom].every(Number.isFinite) && b.right > b.left) {
      const px = t.background?.enabled ? t.background.paddingX : 0;
      const py = t.background?.enabled ? t.background.paddingY : 0;
      const minH = t.size * t.lineHeight;
      const top = b.bottom - b.top < minH ? -minH / 2 : b.top;
      const bottom = b.bottom - b.top < minH ? minH / 2 : b.bottom;
      return { x: b.left - px, y: top - py, w: b.right - b.left + 2 * px, h: bottom - top + 2 * py };
    }
  } catch {
    /* fall back to our own layout */
  }
  return textBox(t, measureText);
}

export function layerInfo(node: LayerNode, W: number, H: number): LayerInfo | null {
  const src = node.source;
  if (!src) return null;
  const sw = src.width || W;
  const sh = src.height || H;
  const tf = node.transform;
  const m = layerMatrix(tf, sw, sh, W, H);
  const content = contentMatrix(tf, sw, sh, W, H);
  // Generated layers are frame-sized rasters with the content at their center.
  let box: Rect = layerRect(sw, sh);
  if (src.kind === 'text') box = titleBox(src.text);
  else if (src.kind === 'shape') box = { x: -src.shape.width / 2, y: -src.shape.height / 2, w: src.shape.width, h: src.shape.height };
  box = intersectRect(box, croppedRect(sw, sh, node.crop));
  return { node, sw, sh, m, content, box };
}

function layersOf(item: GraphItem): LayerNode[] {
  if (item.type === 'layer') return [item];
  return [item.to, item.from].filter((n): n is LayerNode => !!n);
}

/** The layer node for a clip in a graph (also inside transitions). */
export function findLayer(graph: FrameGraph, clipId: string): LayerNode | null {
  for (const it of graph.items) for (const n of layersOf(it)) if (n.clipId === clipId) return n;
  return null;
}

/** Topmost visible layer under a point (sequence pixels), optionally only text layers. */
export function hitTest(graph: FrameGraph, p: Vec, opts: { textOnly?: boolean } = {}): LayerInfo | null {
  for (let i = graph.items.length - 1; i >= 0; i--) {
    for (const n of layersOf(graph.items[i])) {
      if (n.adjustment || !n.source || n.opacity <= 0.001) continue;
      if (opts.textOnly && n.source.kind !== 'text') continue;
      const info = layerInfo(n, graph.width, graph.height);
      if (!info || info.box.w <= 0 || info.box.h <= 0) continue;
      if (rectContains(info.box, apply(invert(info.m), p))) return info;
    }
  }
  return null;
}
