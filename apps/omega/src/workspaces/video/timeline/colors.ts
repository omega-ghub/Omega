// Clip colors: muted tints derived from the label colors, plus small color
// math helpers for the canvas renderer.

import { LABEL_COLORS } from '../../../state/defaults';
import type { Clip, LabelColor, TrackKind } from '../../../state/types';

export type RGB = [number, number, number];

const hexCache = new Map<string, RGB>();

export function hexToRgb(hex: string): RGB {
  const hit = hexCache.get(hex);
  if (hit) return hit;
  let h = hex.trim().replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  const rgb: RGB = Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [128, 128, 128];
  hexCache.set(hex, rgb);
  return rgb;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function css(c: RGB, alpha = 1): string {
  const r = Math.round(c[0]);
  const g = Math.round(c[1]);
  const b = Math.round(c[2]);
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

/** Desaturates toward the color's own luminance. */
export function desaturate(c: RGB, amount: number): RGB {
  const l = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  return mix(c, [l, l, l], amount);
}

const BASE_DARK: RGB = [22, 22, 26];

/** Default hue by clip kind when the label is 'none'. */
const KIND_DEFAULT: Record<string, string> = {
  video: '#5a6a9a', // slate blue
  audio: '#4c8a74', // muted green
  text: '#8a6bb8', // violet
  shape: '#b07a5a', // clay
  solid: '#6f7380', // neutral
  gradient: '#9a6488', // plum
  adjustment: '#7d7f8c', // grey
  sequence: '#4f9a96', // teal
  caption: '#b39a4c', // sand
};

export interface ClipPalette {
  body: string;
  bodySel: string;
  band: string;
  wave: string;
  text: string;
  base: RGB;
}

const paletteCache = new Map<string, ClipPalette>();

export function kindKey(clip: Clip, trackKind: TrackKind): string {
  if (clip.kind === 'media') return trackKind === 'audio' ? 'audio' : 'video';
  return clip.kind;
}

export function clipPalette(label: LabelColor | undefined, key: string): ClipPalette {
  const k = `${label ?? 'none'}|${key}`;
  const hit = paletteCache.get(k);
  if (hit) return hit;
  const src = !label || label === 'none' ? (KIND_DEFAULT[key] ?? LABEL_COLORS.none) : LABEL_COLORS[label] ?? LABEL_COLORS.none;
  const base = desaturate(hexToRgb(src), 0.28);
  const p: ClipPalette = {
    base,
    body: css(mix(base, BASE_DARK, 0.58)),
    bodySel: css(mix(base, BASE_DARK, 0.3)),
    band: css(mix(base, BASE_DARK, 0.12)),
    wave: css(mix(base, [235, 238, 240], 0.55), 0.92),
    text: 'rgba(255,255,255,0.92)',
  };
  paletteCache.set(k, p);
  return p;
}

/** Label swatch color for menus. */
export function labelHex(label: LabelColor): string {
  return LABEL_COLORS[label] ?? LABEL_COLORS.none;
}

export const LABEL_LIST: LabelColor[] = ['none', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'grey'];
