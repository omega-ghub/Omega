// Rasterizers for synthetic layers (text, shapes, solids, gradients) and
// caption cues. OWNED BY THE INSPECTOR/TEXT PACKAGE; the renderer uploads the
// returned canvases as textures (sRGB-encoded, straight alpha).
//
// Contract: each function returns a canvas exactly `width`×`height` (the
// sequence frame) with the content positioned at the frame center; the
// layer transform is applied afterwards by the renderer. Results may be
// cached by the implementation; callers must not mutate them.

import type { CaptionNode, LayerSource } from './graph';

type Raster = OffscreenCanvas;

function canvas(w: number, h: number): Raster {
  return new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

export function rasterizeText(src: Extract<LayerSource, { kind: 'text' }>): Raster {
  const c = canvas(src.width, src.height);
  const ctx = c.getContext('2d')!;
  const t = src.text;
  ctx.font = `${t.italic ? 'italic ' : ''}${t.weight} ${t.size}px ${t.font}`;
  ctx.fillStyle = t.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t.uppercase ? t.content.toUpperCase() : t.content, src.width / 2, src.height / 2);
  return c;
}

export function rasterizeShape(src: Extract<LayerSource, { kind: 'shape' }>): Raster {
  const c = canvas(src.width, src.height);
  const ctx = c.getContext('2d')!;
  const s = src.shape;
  ctx.fillStyle = s.fill.color;
  ctx.fillRect((src.width - s.width) / 2, (src.height - s.height) / 2, s.width, s.height);
  return c;
}

export function rasterizeSolid(src: Extract<LayerSource, { kind: 'solid' }>): Raster {
  const c = canvas(src.width, src.height);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = src.color;
  ctx.fillRect(0, 0, src.width, src.height);
  return c;
}

export function rasterizeGradient(src: Extract<LayerSource, { kind: 'gradient' }>): Raster {
  const c = canvas(src.width, src.height);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, src.width, 0);
  for (const s of src.gradient.stops) g.addColorStop(s.pos, s.color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, src.width, src.height);
  return c;
}

/** All captions active at this frame, drawn into one frame-sized overlay. */
export function rasterizeCaptions(captions: CaptionNode[], width: number, height: number): Raster | null {
  if (!captions.length) return null;
  const c = canvas(width, height);
  const ctx = c.getContext('2d')!;
  for (const cap of captions) {
    const st = cap.style;
    ctx.font = `${st.weight} ${st.size}px ${st.font}`;
    ctx.fillStyle = st.color;
    ctx.textAlign = 'center';
    ctx.fillText(cap.cue.text, width / 2, height - st.margin);
  }
  return c;
}
