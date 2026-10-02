// Caption style presets, scaled to the sequence frame. OWNED BY THE CAPTIONS PACKAGE.
import type { CaptionStyle } from '../../state/types';

export interface CaptionPreset {
  id: string;
  name: string;
  hint: string;
  /** Style for a frame of width × height (sizes scale with the short side). */
  style(width: number, height: number): CaptionStyle;
}

const SANS = 'Inter Variable, Inter, system-ui, sans-serif';

/** Short side in px; 1080 for HD, 2160 for UHD/DCI 4K, 1080 for 9:16 vertical. */
const unit = (w: number, h: number) => Math.max(120, Math.min(w, h));
const px = (u: number, f: number) => Math.max(8, Math.round(u * f));

export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    id: 'netflix',
    name: 'Netflix-like',
    hint: 'White text, no box, thin black outline',
    style: (w, h) => {
      const u = unit(w, h);
      return { font: SANS, size: px(u, 0.046), weight: 500, color: '#ffffff', background: '', outline: px(u, 0.0028), outlineColor: '#000000', position: 'bottom', margin: px(u, 0.075), maxWidth: 0.8, align: 'center' };
    },
  },
  {
    id: 'youtube',
    name: 'YouTube',
    hint: 'White on 75% black',
    style: (w, h) => {
      const u = unit(w, h);
      return { font: `Roboto, ${SANS}`, size: px(u, 0.042), weight: 500, color: '#ffffff', background: '#000000bf', outline: 0, outlineColor: '#000000', position: 'bottom', margin: px(u, 0.06), maxWidth: 0.8, align: 'center' };
    },
  },
  {
    id: 'social',
    name: 'Bold Social',
    hint: 'Large, centered, heavy weight',
    style: (w, h) => {
      const u = unit(w, h);
      return { font: SANS, size: px(u, 0.075), weight: 800, color: '#ffffff', background: '', outline: px(u, 0.006), outlineColor: '#000000', position: 'middle', margin: px(u, 0.06), maxWidth: 0.85, align: 'center' };
    },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    hint: 'Small, light box, quiet',
    style: (w, h) => {
      const u = unit(w, h);
      return { font: SANS, size: px(u, 0.034), weight: 400, color: '#f5f5f5', background: '#00000066', outline: 0, outlineColor: '#000000', position: 'bottom', margin: px(u, 0.07), maxWidth: 0.7, align: 'center' };
    },
  },
  {
    id: 'cinema',
    name: 'Cinema',
    hint: 'Smaller and lower, inside the safe area',
    style: (w, h) => {
      const u = unit(w, h);
      return { font: SANS, size: px(u, 0.036), weight: 400, color: '#f2f2f2', background: '', outline: px(u, 0.0019), outlineColor: '#000000', position: 'bottom', margin: px(u, 0.04), maxWidth: 0.7, align: 'center' };
    },
  },
];

/** Splits '#rrggbbaa' / '#rrggbb' / '' into an opaque color and alpha 0..1. */
export function splitAlpha(hex: string): { color: string; alpha: number } {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return { color: '#000000', alpha: 0 };
  return { color: `#${m[1].toLowerCase()}`, alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}

/** '#rrggbb' + alpha → '#rrggbbaa' ('' when fully transparent). */
export function joinAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (a <= 0) return '';
  const base = /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#000000';
  return a >= 1 ? base : base + Math.round(a * 255).toString(16).padStart(2, '0');
}
