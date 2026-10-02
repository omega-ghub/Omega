// Font families offered by the text inspector: the two bundled variable
// fonts, then system fonts (window.queryLocalFonts when the platform allows
// it, else a curated list filtered to the families that are installed).

import { useEffect, useMemo, useSyncExternalStore } from 'react';

export interface FontChoice {
  /** CSS font-family list stored in TextProps.font. */
  family: string;
  label: string;
  group: 'Bundled' | 'System';
}

export const BUNDLED_FONTS: FontChoice[] = [
  { family: 'Inter Variable, Inter, system-ui, sans-serif', label: 'Inter', group: 'Bundled' },
  { family: 'JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace', label: 'JetBrains Mono', group: 'Bundled' },
];

const CURATED = [
  'Arial',
  'Helvetica Neue',
  'Helvetica',
  'Avenir Next',
  'Futura',
  'Gill Sans',
  'Segoe UI',
  'Roboto',
  'Open Sans',
  'Montserrat',
  'Lato',
  'Noto Sans',
  'DejaVu Sans',
  'Liberation Sans',
  'Ubuntu',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Impact',
  'Georgia',
  'Times New Roman',
  'Palatino',
  'Garamond',
  'Baskerville',
  'Didot',
  'Noto Serif',
  'DejaVu Serif',
  'Liberation Serif',
  'Courier New',
  'Menlo',
  'Consolas',
  'DejaVu Sans Mono',
];

const SERIF = /georgia|times|palatino|garamond|baskerville|didot|serif/i;
const MONO = /courier|menlo|consolas|mono/i;

function systemChoice(name: string): FontChoice {
  const generic = MONO.test(name) ? 'monospace' : SERIF.test(name) && !/sans/i.test(name) ? 'serif' : 'sans-serif';
  return { family: `${name}, ${generic}`, label: name, group: 'System' };
}

/** Classic width-difference test: is `name` installed? */
function isInstalled(name: string): boolean {
  try {
    const c = new OffscreenCanvas(8, 8).getContext('2d');
    if (!c) return false;
    const sample = 'mmmmmmmmmmlliWW@#0O';
    for (const base of ['monospace', 'serif', 'sans-serif']) {
      c.font = `72px ${base}`;
      const w0 = c.measureText(sample).width;
      c.font = `72px "${name}", ${base}`;
      if (Math.abs(c.measureText(sample).width - w0) > 0.5) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

let systemFonts: FontChoice[] | null = null;
let queried = false;
const listeners = new Set<() => void>();

function setSystem(list: FontChoice[]) {
  systemFonts = list;
  for (const l of listeners) l();
}

function curated(): FontChoice[] {
  return CURATED.filter(isInstalled).map(systemChoice);
}

/**
 * Asks the platform for every installed family. Needs a user gesture the
 * first time in Chromium; call from a pointer/focus handler. Safe to call often.
 */
export async function requestLocalFonts(): Promise<void> {
  if (queried) return;
  const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
  if (!q) return;
  try {
    const fonts = await q();
    const families = [...new Set(fonts.map((f) => f.family))].filter((f) => f && !/^\./.test(f)).sort((a, b) => a.localeCompare(b));
    if (families.length) {
      queried = true;
      setSystem(families.map(systemChoice));
    }
  } catch {
    /* permission denied or no activation: keep the curated list */
  }
}

function snapshot(): FontChoice[] | null {
  return systemFonts;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive list of font choices (bundled first). */
export function useFontChoices(): FontChoice[] {
  // first use: cheap curated detection now, a full platform query when allowed
  if (!systemFonts) systemFonts = curated();
  const sys = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    void requestLocalFonts();
  }, []);
  return useMemo(() => [...BUNDLED_FONTS, ...(sys ?? [])], [sys]);
}

/** First family name of a CSS family list, unquoted. */
export function primaryFamily(css: string): string {
  return (css.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
}

/** The choice matching a stored family list (by primary family). */
export function matchFont(choices: FontChoice[], css: string): FontChoice | undefined {
  const p = primaryFamily(css).toLowerCase();
  return choices.find((c) => primaryFamily(c.family).toLowerCase() === p);
}

export const WEIGHTS: { value: number; label: string }[] = [
  { value: 100, label: 'Thin' },
  { value: 200, label: 'Extra light' },
  { value: 300, label: 'Light' },
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Medium' },
  { value: 600, label: 'Semibold' },
  { value: 700, label: 'Bold' },
  { value: 800, label: 'Extra bold' },
  { value: 900, label: 'Black' },
];
