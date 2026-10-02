// Output file names: template tokens, sanitizing and path joining. Pure.

import type { Container, ExportSettings } from './types';

export const NAME_TOKENS = ['project', 'sequence', 'preset', 'date', 'format'] as const;
export type NameToken = (typeof NAME_TOKENS)[number];

export const DEFAULT_NAME_TEMPLATE = '{sequence} - {preset}';

export interface NameContext {
  project: string;
  sequence: string;
  preset: string;
  /** Format name; '' for the main format. */
  format: string;
  date: Date;
}

function two(n: number) {
  return String(n).padStart(2, '0');
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/**
 * Makes a string safe as a file name on Windows, macOS and Linux: aspect
 * ratios become "9x16", reserved characters become '-', control characters
 * are dropped, whitespace collapses, and trailing dots/spaces go.
 */
export function sanitizeFileName(name: string): string {
  let s = name
    .replace(/(\d+)\s*:\s*(\d+)/g, '$1x$2')
    .replace(/[<>:"/\\|?*]/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .trim()
    .replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `${s}_`;
  return s.slice(0, 180) || 'Export';
}

/** Expands {project} {sequence} {preset} {date} {format}; unknown tokens are kept literally. */
export function expandTemplate(template: string, ctx: NameContext): string {
  const values: Record<NameToken, string> = {
    project: ctx.project,
    sequence: ctx.sequence,
    preset: ctx.preset,
    date: isoDate(ctx.date),
    format: ctx.format,
  };
  // An empty token takes the separator in front of it along ("{sequence} - {format}" → "Seq").
  let t = template;
  for (const k of NAME_TOKENS) if (!values[k]) t = t.replace(new RegExp(`\\s*[-_.]?\\s*\\{${k}\\}`, 'g'), '');
  const out = t.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? values[key as NameToken] : m));
  return out.replace(/^[\s\-_.]+/, '').replace(/[\s\-_]+$/, '');
}

/**
 * The final base name (no extension) for one job. When several formats are
 * rendered and the template has no {format} token, alternate formats are
 * suffixed with the format name so the files never collide.
 */
export function outputBaseName(template: string, ctx: NameContext, opts: { multiFormat: boolean }): string {
  let name = expandTemplate(template || DEFAULT_NAME_TEMPLATE, ctx);
  if (opts.multiFormat && ctx.format && !/\{format\}/.test(template)) name = `${name}_${ctx.format}`;
  return sanitizeFileName(name);
}

/** File extension (without the dot) for an output. */
export function extensionFor(settings: Pick<ExportSettings, 'kind' | 'container'>): string {
  const c: Container = settings.container;
  if (settings.kind === 'imageSequence') return '';
  if (c === 'chapters') return 'txt';
  return c;
}

export function pathSeparator(dir: string): string {
  return dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
}

export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = pathSeparator(dir);
  return dir.endsWith('/') || dir.endsWith('\\') ? `${dir}${name}` : `${dir}${sep}${name}`;
}

export function dirName(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i > 0 ? path.slice(0, i) : i === 0 ? path.slice(0, 1) : '';
}

export function baseName(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return path.slice(i + 1);
}

/** Path without its extension ("/a/b.mp4" → "/a/b"). */
export function stripExtension(path: string): string {
  const base = baseName(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? path.slice(0, path.length - (base.length - dot)) : path;
}

/** Full output path for a job: a file, or a folder for an image sequence. */
export function outputPath(dir: string, base: string, settings: Pick<ExportSettings, 'kind' | 'container'>): string {
  const ext = extensionFor(settings);
  return joinPath(dir, ext ? `${base}.${ext}` : base);
}

/** "name.mp4" → "name 2.mp4" → "name 3.mp4"; for folders "name" → "name 2". */
export function numberedVariant(path: string, n: number): string {
  if (n <= 1) return path;
  const base = baseName(path);
  const dot = base.lastIndexOf('.');
  const dir = path.slice(0, path.length - base.length);
  return dot > 0 ? `${dir}${base.slice(0, dot)} ${n}${base.slice(dot)}` : `${dir}${base} ${n}`;
}

/** First variant of `path` for which `taken` returns false. */
export async function uniquePath(path: string, taken: (p: string) => boolean | Promise<boolean>): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const p = numberedVariant(path, n);
    if (!(await taken(p))) return p;
  }
  return numberedVariant(path, Date.now());
}

/** Zero-padded frame file name for image sequences ("name_000042.png"). */
export function sequenceFrameName(base: string, index: number, total: number): string {
  const digits = Math.max(6, String(Math.max(0, total - 1)).length);
  return `${base}_${String(index).padStart(digits, '0')}.png`;
}
