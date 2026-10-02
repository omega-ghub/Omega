// GPU compositor. OWNED BY THE RENDERER PACKAGE.
// This file defines the public API every other package uses; the stub below
// draws with Canvas 2D so the app runs while the WebGL2 renderer is built.

import type { FrameGraph } from '../render/graph';
import type { FrameProvider } from '../render/frames';
import { frameSize } from '../render/frames';

export interface RenderOptions {
  /** Before/after comparison in the viewer: 'split' draws ungraded pixels left of `position` (0..1). */
  compare?: { mode: 'off' | 'split' | 'bypass'; position: number };
  /** Show the qualifier matte of this clip instead of the image. */
  matteClipId?: string | null;
}

export interface PixelReadback {
  width: number;
  height: number;
  /** RGBA8, display-referred (what the viewer shows), top row first. */
  data: Uint8ClampedArray;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  static isSupported(): boolean {
    return true;
  }

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  /** Output size in device pixels (the graph is scaled to fit). */
  setSize(width: number, height: number): void {
    this.canvas.width = Math.max(1, Math.round(width));
    this.canvas.height = Math.max(1, Math.round(height));
  }

  render(graph: FrameGraph, frames: FrameProvider, _opts: RenderOptions = {}): void {
    const { ctx, canvas } = this;
    ctx.fillStyle = graph.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const sx = canvas.width / graph.width;
    const sy = canvas.height / graph.height;
    for (const item of graph.items) {
      const layer = item.type === 'layer' ? item : (item.to ?? item.from);
      if (!layer?.source || layer.source.kind !== 'media') continue;
      const img = frames.frame(layer.source.assetId, layer.source.sourceTime, layer.clipId);
      if (!img) continue;
      const { w, h } = frameSize(img);
      if (!w || !h) continue;
      const s = Math.min(graph.width / w, graph.height / h) * layer.transform.scale;
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(img as CanvasImageSource, ((graph.width - w * s) / 2 + layer.transform.x) * sx, ((graph.height - h * s) / 2 + layer.transform.y) * sy, w * s * sx, h * s * sy);
      ctx.globalAlpha = 1;
    }
  }

  /** Downscaled readback of the last rendered frame (for scopes). */
  readPixels(maxWidth = 320): PixelReadback {
    const w = Math.min(maxWidth, this.canvas.width);
    const h = Math.max(1, Math.round((w / this.canvas.width) * this.canvas.height));
    const c = new OffscreenCanvas(w, h);
    const x = c.getContext('2d')!;
    x.drawImage(this.canvas as CanvasImageSource, 0, 0, w, h);
    return { width: w, height: h, data: x.getImageData(0, 0, w, h).data };
  }

  dispose(): void {}
}
