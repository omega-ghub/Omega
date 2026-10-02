// Pure helpers shared by the inspector's controls (no DOM, unit-tested).

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Number of decimals in a step value: 1 → 0, 0.1 → 1, 0.005 → 3. */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  for (let d = 0; d < 8; d++) {
    const s = step * 10 ** d;
    if (Math.abs(s - Math.round(s)) < 1e-9 * Math.max(1, s)) return d;
  }
  return 8;
}

export function roundTo(v: number, decimals: number): number {
  const f = 10 ** clamp(Math.round(decimals), 0, 10);
  return Math.round(v * f) / f;
}

/** Formats a number for display: fixed decimals, no "-0". */
export function formatNumber(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return '—';
  const s = v.toFixed(clamp(decimals, 0, 8));
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

// ---------------------------------------------------------------------------
// Typed numeric input: plain numbers, arithmetic, and relative operators.
//   "12.5"  "1/3"  "(2+3)*4"  "*2" (× current)  "/2"  "+=5"  "-=5"
// ---------------------------------------------------------------------------

function parseExpression(src: string): number | null {
  let i = 0;
  const s = src.replace(/\s+/g, '');
  const peek = () => s[i];
  function num(): number | null {
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  }
  function factor(): number | null {
    const c = peek();
    if (c === '-') {
      i++;
      const v = factor();
      return v === null ? null : -v;
    }
    if (c === '+') {
      i++;
      return factor();
    }
    if (c === '(') {
      i++;
      const v = expr();
      if (v === null || peek() !== ')') return null;
      i++;
      return v;
    }
    return num();
  }
  function term(): number | null {
    let v = factor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = s[i++];
      const r = factor();
      if (r === null) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr(): number | null {
    let v = term();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = s[i++];
      const r = term();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const v = expr();
  return v !== null && i === s.length && Number.isFinite(v) ? v : null;
}

/** Evaluates what a user typed into a number field (see above). `current` is in display units. */
export function evalNumberInput(text: string, current: number): number | null {
  const s = text.trim().replace(/,/g, '.').replace(/[%°a-z]+$/i, '').trim();
  if (!s) return null;
  if (s.startsWith('+=') || s.startsWith('-=')) {
    const v = parseExpression(s.slice(2));
    return v === null ? null : s[0] === '+' ? current + v : current - v;
  }
  if (s[0] === '*' || s[0] === '/') {
    const v = parseExpression(s.slice(1));
    if (v === null) return null;
    return s[0] === '*' ? current * v : v === 0 ? null : current / v;
  }
  return parseExpression(s);
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export interface ParsedColor {
  /** '#rrggbb' lowercase */
  rgb: string;
  /** 0..1 */
  a: number;
}

/** Parses #rgb, #rgba, #rrggbb, #rrggbbaa (with or without '#'). */
export function parseHexColor(input: string): ParsedColor | null {
  let s = input.trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(s)) return null;
  if (s.length === 3 || s.length === 4) s = [...s].map((c) => c + c).join('');
  if (s.length !== 6 && s.length !== 8) return null;
  const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
  return { rgb: `#${s.slice(0, 6)}`, a };
}

/** '#rrggbb' or '#rrggbbaa' (alpha only when < 1 or `forceAlpha`). */
export function toHexColor(rgb: string, a = 1, forceAlpha = false): string {
  const base = parseHexColor(rgb)?.rgb ?? '#000000';
  const aa = Math.round(clamp(a, 0, 1) * 255);
  return aa >= 255 && !forceAlpha ? base : `${base}${aa.toString(16).padStart(2, '0')}`;
}

/** 'r,g,b,a' with a in 0..1, for CSS rgba(). */
export function hexToRgba(hex: string, alphaMul = 1): string {
  const p = parseHexColor(hex) ?? { rgb: '#000000', a: 1 };
  const n = parseInt(p.rgb.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${roundTo(p.a * alphaMul, 4)})`;
}
