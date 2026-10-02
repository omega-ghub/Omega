// LUT files (.cube 1D/3D). OWNED BY THE RENDERER PACKAGE.
//
// Parser for the Adobe/Iridas .cube format with the common Resolve extensions
// (LUT_1D_INPUT_RANGE / LUT_3D_INPUT_RANGE, and a 1D shaper followed by a 3D
// LUT in one file). Untrusted input: every error is a CubeParseError with a
// line number, sizes are bounded, and parsing is linear in the input length.

export interface ParsedLut {
  title: string;
  /** 3D: size N, data N^3 RGB floats (r fastest). 1D: size N, data N RGB floats. */
  kind: '1d' | '3d';
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  data: Float32Array;
  /** Optional 1D shaper applied before a 3D LUT (Resolve-style combined .cube). */
  shaper?: { size: number; domainMin: [number, number, number]; domainMax: [number, number, number]; data: Float32Array };
}

export class CubeParseError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(line > 0 ? `Line ${line}: ${message}` : message);
    this.name = 'CubeParseError';
    this.line = line;
  }
}

export const MAX_3D_SIZE = 129;
export const MAX_1D_SIZE = 65536;
const MAX_TEXT = 64 * 1024 * 1024;

type Triple = [number, number, number];

function parseNum(tok: string, line: number): number {
  // Strict float syntax: no hex, no Infinity/NaN, no trailing junk.
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(tok)) throw new CubeParseError(line, `"${tok.slice(0, 32)}" is not a number`);
  const v = Number(tok);
  if (!Number.isFinite(v)) throw new CubeParseError(line, `"${tok.slice(0, 32)}" is out of range`);
  return v;
}

function parseSize(toks: string[], line: number, key: string, max: number): number {
  if (toks.length !== 2) throw new CubeParseError(line, `${key} needs exactly one value`);
  if (!/^\d+$/.test(toks[1])) throw new CubeParseError(line, `${key} must be a whole number`);
  const n = Number(toks[1]);
  if (n < 2 || n > max) throw new CubeParseError(line, `${key} ${n} is out of range (2–${max})`);
  return n;
}

function parseTriple(toks: string[], line: number, key: string): Triple {
  if (toks.length !== 4) throw new CubeParseError(line, `${key} needs three values`);
  return [parseNum(toks[1], line), parseNum(toks[2], line), parseNum(toks[3], line)];
}

function parseRange(toks: string[], line: number, key: string): [Triple, Triple] {
  if (toks.length !== 3) throw new CubeParseError(line, `${key} needs two values`);
  const a = parseNum(toks[1], line);
  const b = parseNum(toks[2], line);
  return [
    [a, a, a],
    [b, b, b],
  ];
}

function checkDomain(min: Triple, max: Triple, line: number) {
  for (let i = 0; i < 3; i++) if (!(max[i] > min[i])) throw new CubeParseError(line, 'DOMAIN_MAX must be greater than DOMAIN_MIN on every channel');
}

/** Parses a .cube file. Throws CubeParseError (with `line`) on invalid input. */
export function parseCube(text: string): ParsedLut {
  if (typeof text !== 'string') throw new CubeParseError(0, 'LUT file is not text');
  if (text.length > MAX_TEXT) throw new CubeParseError(0, 'LUT file is too large');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let title = '';
  let size1 = 0;
  let size3 = 0;
  let dom1: [Triple, Triple] | null = null;
  let dom3: [Triple, Triple] | null = null;
  let domain: [Triple, Triple] | null = null;
  let domainLine = 0;
  let data: Float32Array | null = null;
  let rows = 0;
  let expected = 0;
  let firstDataLine = 0;
  let lastContentLine = 0;

  const n = text.length;
  let pos = 0;
  let lineNo = 0;
  while (pos <= n) {
    let end = text.indexOf('\n', pos);
    if (end < 0) end = n;
    lineNo++;
    let raw = text.slice(pos, end);
    pos = end + 1;
    if (raw.endsWith('\r')) raw = raw.slice(0, -1);
    const hash = raw.indexOf('#');
    // TITLE may legitimately contain '#' inside quotes.
    const isTitle = /^\s*TITLE\b/.test(raw);
    const line = (hash >= 0 && !isTitle ? raw.slice(0, hash) : raw).trim();
    if (!line) {
      if (end === n) break;
      continue;
    }
    lastContentLine = lineNo;
    const c0 = line.charCodeAt(0);
    const isData = (c0 >= 48 && c0 <= 57) || c0 === 45 || c0 === 43 || c0 === 46;
    if (isData) {
      if (!data) {
        if (!size1 && !size3) throw new CubeParseError(lineNo, 'data before LUT_1D_SIZE or LUT_3D_SIZE');
        expected = size1 + (size3 ? size3 * size3 * size3 : 0);
        data = new Float32Array(expected * 3);
        firstDataLine = lineNo;
      }
      const toks = line.split(/\s+/);
      if (toks.length !== 3) throw new CubeParseError(lineNo, `expected 3 numbers, found ${toks.length}`);
      if (rows >= expected) throw new CubeParseError(lineNo, `too many data rows (expected ${expected})`);
      data[rows * 3] = parseNum(toks[0], lineNo);
      data[rows * 3 + 1] = parseNum(toks[1], lineNo);
      data[rows * 3 + 2] = parseNum(toks[2], lineNo);
      rows++;
    } else {
      const toks = line.split(/\s+/);
      const key = toks[0].toUpperCase();
      if (data) throw new CubeParseError(lineNo, `keyword ${toks[0].slice(0, 32)} after the data rows`);
      switch (key) {
        case 'TITLE': {
          const m = /^\s*TITLE\s+"(.*)"\s*$/i.exec(raw) ?? /^\s*TITLE\s+(.*?)\s*$/i.exec(raw);
          title = (m?.[1] ?? '').slice(0, 256);
          break;
        }
        case 'LUT_1D_SIZE':
          if (size1) throw new CubeParseError(lineNo, 'LUT_1D_SIZE given twice');
          size1 = parseSize(toks, lineNo, 'LUT_1D_SIZE', MAX_1D_SIZE);
          break;
        case 'LUT_3D_SIZE':
          if (size3) throw new CubeParseError(lineNo, 'LUT_3D_SIZE given twice');
          size3 = parseSize(toks, lineNo, 'LUT_3D_SIZE', MAX_3D_SIZE);
          break;
        case 'DOMAIN_MIN': {
          const v = parseTriple(toks, lineNo, 'DOMAIN_MIN');
          domain = [v, domain?.[1] ?? [1, 1, 1]];
          domainLine = lineNo;
          break;
        }
        case 'DOMAIN_MAX': {
          const v = parseTriple(toks, lineNo, 'DOMAIN_MAX');
          domain = [domain?.[0] ?? [0, 0, 0], v];
          domainLine = lineNo;
          break;
        }
        case 'LUT_1D_INPUT_RANGE':
          dom1 = parseRange(toks, lineNo, key);
          checkDomain(dom1[0], dom1[1], lineNo);
          break;
        case 'LUT_3D_INPUT_RANGE':
          dom3 = parseRange(toks, lineNo, key);
          checkDomain(dom3[0], dom3[1], lineNo);
          break;
        default:
          // Vendor keywords (LUT_IN_VIDEO_RANGE, LUT_OUT_VIDEO_RANGE, …) are ignored.
          if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new CubeParseError(lineNo, `unexpected text "${line.slice(0, 32)}"`);
      }
    }
    if (end === n) break;
  }

  if (!size1 && !size3) throw new CubeParseError(0, 'missing LUT_1D_SIZE or LUT_3D_SIZE');
  if (domain) checkDomain(domain[0], domain[1], domainLine);
  if (!data || rows !== expected) throw new CubeParseError(lastContentLine, `expected ${expected || (size3 ? size3 ** 3 : size1)} data rows, found ${rows}${firstDataLine ? ` (data starts at line ${firstDataLine})` : ''}`);

  if (size3 && size1) {
    // Resolve combined file: 1D shaper rows first, then the 3D cube.
    const d1 = dom1 ?? domain ?? [[0, 0, 0], [1, 1, 1]];
    const d3 = dom3 ?? [[0, 0, 0], [1, 1, 1]];
    return {
      title,
      kind: '3d',
      size: size3,
      domainMin: [...d3[0]],
      domainMax: [...d3[1]],
      data: data.slice(size1 * 3),
      shaper: { size: size1, domainMin: [...d1[0]], domainMax: [...d1[1]], data: data.slice(0, size1 * 3) },
    };
  }
  const d = (size3 ? dom3 : dom1) ?? domain ?? [[0, 0, 0], [1, 1, 1]];
  return { title, kind: size3 ? '3d' : '1d', size: size3 || size1, domainMin: [...d[0]], domainMax: [...d[1]], data };
}

/** Serializes a LUT back to .cube text (used by tests and LUT export). */
export function writeCube(lut: ParsedLut): string {
  const f = (v: number) => (Math.round(v * 1e6) / 1e6).toFixed(6);
  const lines: string[] = [];
  if (lut.title) lines.push(`TITLE "${lut.title.replace(/"/g, "'")}"`);
  lines.push(`${lut.kind === '3d' ? 'LUT_3D_SIZE' : 'LUT_1D_SIZE'} ${lut.size}`);
  lines.push(`DOMAIN_MIN ${lut.domainMin.map(f).join(' ')}`);
  lines.push(`DOMAIN_MAX ${lut.domainMax.map(f).join(' ')}`);
  for (let i = 0; i < lut.data.length; i += 3) lines.push(`${f(lut.data[i])} ${f(lut.data[i + 1])} ${f(lut.data[i + 2])}`);
  return lines.join('\n') + '\n';
}

/** An identity LUT (3D: N³, 1D: N). */
export function identityLut(kind: '1d' | '3d', size: number): ParsedLut {
  const n = kind === '3d' ? size * size * size : size;
  const data = new Float32Array(n * 3);
  if (kind === '3d') {
    let i = 0;
    for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
      data[i++] = r / (size - 1);
      data[i++] = g / (size - 1);
      data[i++] = b / (size - 1);
    }
  } else for (let i = 0; i < size; i++) data[i * 3] = data[i * 3 + 1] = data[i * 3 + 2] = i / (size - 1);
  return { title: 'Identity', kind, size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data };
}

// ---------------------------------------------------------------------------
// CPU application (reference for tests, LUT baking and pickers). The renderer
// does the same on the GPU: 1D linear, 3D tetrahedral.
// ---------------------------------------------------------------------------

function apply1D(size: number, data: Float32Array, dmin: Triple, dmax: Triple, rgb: Triple): Triple {
  const out: Triple = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const x = Math.min(Math.max((rgb[ch] - dmin[ch]) / (dmax[ch] - dmin[ch]), 0), 1) * (size - 1);
    const i = Math.min(Math.floor(x), size - 2);
    const t = x - i;
    out[ch] = data[i * 3 + ch] * (1 - t) + data[(i + 1) * 3 + ch] * t;
  }
  return out;
}

function apply3D(lut: ParsedLut, rgb: Triple): Triple {
  const N = lut.size;
  const p = [0, 1, 2].map((ch) => Math.min(Math.max((rgb[ch] - lut.domainMin[ch]) / (lut.domainMax[ch] - lut.domainMin[ch]), 0), 1) * (N - 1));
  const base = p.map((v) => Math.min(Math.floor(v), N - 2));
  const [fr, fg, fb] = p.map((v, i) => v - base[i]);
  const at = (r: number, g: number, b: number): Triple => {
    const i = ((base[2] + b) * N * N + (base[1] + g) * N + (base[0] + r)) * 3;
    return [lut.data[i], lut.data[i + 1], lut.data[i + 2]];
  };
  const c000 = at(0, 0, 0);
  const c111 = at(1, 1, 1);
  // Tetrahedral interpolation: pick the tetrahedron by the ordering of the fractions.
  let w: [number, Triple][];
  if (fr > fg) {
    if (fg > fb) w = [[1 - fr, c000], [fr - fg, at(1, 0, 0)], [fg - fb, at(1, 1, 0)], [fb, c111]];
    else if (fr > fb) w = [[1 - fr, c000], [fr - fb, at(1, 0, 0)], [fb - fg, at(1, 0, 1)], [fg, c111]];
    else w = [[1 - fb, c000], [fb - fr, at(0, 0, 1)], [fr - fg, at(1, 0, 1)], [fg, c111]];
  } else {
    if (fb > fg) w = [[1 - fb, c000], [fb - fg, at(0, 0, 1)], [fg - fr, at(0, 1, 1)], [fr, c111]];
    else if (fb > fr) w = [[1 - fg, c000], [fg - fb, at(0, 1, 0)], [fb - fr, at(0, 1, 1)], [fr, c111]];
    else w = [[1 - fg, c000], [fg - fr, at(0, 1, 0)], [fr - fb, at(1, 1, 0)], [fb, c111]];
  }
  const out: Triple = [0, 0, 0];
  for (const [k, c] of w) for (let ch = 0; ch < 3; ch++) out[ch] += k * c[ch];
  return out;
}

/** Applies a parsed LUT to one RGB triple (in the LUT's input domain). */
export function applyLut(lut: ParsedLut, rgb: Triple): Triple {
  let v = rgb;
  if (lut.shaper) v = apply1D(lut.shaper.size, lut.shaper.data, lut.shaper.domainMin, lut.shaper.domainMax, v);
  return lut.kind === '1d' ? apply1D(lut.size, lut.data, lut.domainMin, lut.domainMax, v) : apply3D(lut, v);
}

// ---------------------------------------------------------------------------
// Loading and cache
// ---------------------------------------------------------------------------

const loaded = new Map<string, ParsedLut>();
const loadedPaths = new Map<string, string>();
const pending = new Map<string, { path: string; promise: Promise<ParsedLut> }>();
const failed = new Map<string, string>();
const listeners = new Set<(id: string) => void>();

/** Loads (and caches) a project LUT by id so the renderer can use it. */
export async function loadLut(id: string, path: string): Promise<ParsedLut> {
  const have = loaded.get(id);
  if (have && loadedPaths.get(id) === path) return have;
  const p = pending.get(id);
  if (p && p.path === path) return p.promise;
  const promise = (async () => {
    try {
      const api = (globalThis as { window?: { omega?: { files?: { readText(path: string): Promise<string> } } } }).window?.omega;
      if (!api?.files?.readText) throw new Error('File access is not available');
      const text = await api.files.readText(path);
      const lut = parseCube(text);
      loaded.set(id, lut);
      loadedPaths.set(id, path);
      failed.delete(id);
      for (const l of listeners) {
        try {
          l(id);
        } catch {
          /* listener errors never break loading */
        }
      }
      return lut;
    } catch (e) {
      failed.set(id, e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      pending.delete(id);
    }
  })();
  pending.set(id, { path, promise });
  return promise;
}

/** A loaded LUT, or null if not loaded yet (renderer skips it until ready). */
export function getLoadedLut(id: string): ParsedLut | null {
  return loaded.get(id) ?? null;
}

/** Registers an already-parsed LUT (LUT import UI, generated LUTs, tests). */
export function setLoadedLut(id: string, lut: ParsedLut, path = ''): void {
  loaded.set(id, lut);
  loadedPaths.set(id, path);
  failed.delete(id);
  for (const l of listeners) l(id);
}

/** Forgets a LUT (e.g. when it is removed from the project or its file changed). */
export function unloadLut(id: string): void {
  loaded.delete(id);
  loadedPaths.delete(id);
  failed.delete(id);
}

/** The last load error for a LUT id, if any (for the color UI). */
export function lutError(id: string): string | null {
  return failed.get(id) ?? null;
}

/** Subscribes to LUT load completion (viewers re-render). Returns an unsubscribe function. */
export function onLutLoaded(cb: (id: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Loads every project LUT that is not loaded yet; failures are recorded per id and never thrown. */
export function ensureLutsLoaded(luts: { id: string; path: string }[]): Promise<void> {
  const jobs = luts.filter((l) => (!loaded.has(l.id) || loadedPaths.get(l.id) !== l.path) && !failed.has(l.id)).map((l) => loadLut(l.id, l.path).catch(() => undefined));
  return Promise.all(jobs).then(() => undefined);
}
