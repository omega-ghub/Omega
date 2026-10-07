// Pure helpers for the effects UI (no DOM, no store): search ranking, point
// parsing, numeric param ranges, effect copy/paste with keyframe remapping,
// and list reordering. Unit-tested in logic.test.ts.
import type { ParamDef } from '../../../engine/effects/types';
import type { Clip, EffectInstance, Keyframe } from '../../../state/types';

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface Searchable {
  type: string;
  name: string;
  category: string;
  description: string;
  keywords?: string[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9&+#]+/g, ' ')
    .trim();

/** Splits camelCase type ids into words ('gaussianBlur' → 'gaussian blur'). */
const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

/**
 * Relevance of an item for a query (0 = no match). Every query term must match
 * somewhere; name matches outrank keywords, which outrank the description.
 */
export function matchScore(item: Searchable, query: string): number {
  const q = norm(query);
  if (!q) return 1;
  const name = norm(item.name);
  const type = norm(words(item.type));
  const kws = (item.keywords ?? []).map(norm);
  const cat = norm(item.category);
  const desc = norm(item.description);
  let score = 0;
  if (name === q) score += 1000;
  else if (name.startsWith(q)) score += 600;
  for (const term of q.split(' ')) {
    if (!term) continue;
    const nameWords = name.split(' ');
    let s = 0;
    if (nameWords.some((w) => w === term)) s = 300;
    else if (nameWords.some((w) => w.startsWith(term))) s = 220;
    else if (name.includes(term)) s = 150;
    else if (kws.some((k) => k === term)) s = 140;
    else if (kws.some((k) => k.startsWith(term) || k.split(' ').some((w) => w.startsWith(term)))) s = 110;
    else if (type.split(' ').some((w) => w.startsWith(term))) s = 100;
    else if (cat.split(' ').some((w) => w.startsWith(term))) s = 60;
    else if (desc.split(' ').some((w) => w.startsWith(term))) s = 25;
    else if (term.length >= 4 && desc.includes(term)) s = 10;
    if (s === 0) return 0;
    score += s;
  }
  return score;
}

/** Filters and ranks items for a query; an empty query keeps the original order. */
export function searchItems<T extends Searchable>(items: readonly T[], query: string): T[] {
  if (!norm(query)) return [...items];
  return items
    .map((item, i) => ({ item, i, s: matchScore(item, query) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((r) => r.item);
}

/** Groups items by category, keeping the given category order first. */
export function groupByCategory<T extends { category: string }>(items: readonly T[], order: readonly string[]): { category: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const c of order) map.set(c, []);
  for (const it of items) {
    if (!map.has(it.category)) map.set(it.category, []);
    map.get(it.category)!.push(it);
  }
  return [...map.entries()].filter(([, list]) => list.length).map(([category, list]) => ({ category, items: list }));
}

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

/** Parses an 'x,y' point param (layer-normalized, y down). */
export function parsePoint(v: unknown, fallback: { x: number; y: number } = { x: 0.5, y: 0.5 }): { x: number; y: number } {
  if (typeof v !== 'string') return fallback;
  const [xs, ys] = v.split(',');
  const x = Number(xs);
  const y = Number(ys);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : fallback;
}

export function formatPoint(p: { x: number; y: number }): string {
  const r = (n: number) => String(Math.round(n * 10000) / 10000);
  return `${r(p.x)},${r(p.y)}`;
}

/** Slider range for a numeric param: soft limits when present, else hard limits, else a sensible span around the default. */
export function sliderRange(p: ParamDef): { min: number; max: number } {
  const d = Number(p.default) || 0;
  let min = p.softMin ?? p.min;
  let max = p.softMax ?? p.max;
  if (min === undefined && max === undefined) {
    const span = Math.max(Math.abs(d) * 2, 1);
    min = d - span;
    max = d + span;
  } else if (min === undefined) min = Math.min(0, d, max! - 1);
  else if (max === undefined) max = Math.max(min + 1, d * 2, min + 100);
  if (max! <= min!) max = min! + 1;
  return { min: min!, max: max! };
}

/** Clamps a numeric value to a param's hard limits. */
export function clampParam(p: ParamDef, v: number): number {
  if (!Number.isFinite(v)) return Number(p.default) || 0;
  return Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, v));
}

/** Arrow-key step for a numeric param. */
export function paramStep(p: ParamDef): number {
  if (p.step && p.step > 0) return p.step;
  const { min, max } = sliderRange(p);
  const span = max - min;
  return span >= 100 ? 1 : span >= 10 ? 0.1 : 0.01;
}

/** True when a param can carry keyframes (numeric and not opted out). */
export function isAnimatable(p: ParamDef): boolean {
  return (p.type === 'number' || p.type === 'angle') && p.animatable !== false;
}

/** Default params as stored on an EffectInstance. */
export function defaultsOf(params: readonly ParamDef[]): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = {};
  for (const p of params) out[p.key] = p.default;
  return out;
}

// ---------------------------------------------------------------------------
// Copy / paste (effects travel with their keyframes)
// ---------------------------------------------------------------------------

export interface EffectsPayload {
  effects: EffectInstance[];
  /** Keyframes per effect id (relative to the source clip's start), keyed by param key. */
  keyframes: Record<string, Record<string, Keyframe[]>>;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Snapshot of some (default: all) effects of a clip, with their keyframes. */
export function copyEffects(clip: Clip, ids?: readonly string[]): EffectsPayload {
  const effects = clip.effects.filter((e) => !ids || ids.includes(e.id)).map(clone);
  const keyframes: EffectsPayload['keyframes'] = {};
  for (const e of effects) {
    const prefix = `effects.${e.id}.`;
    for (const [path, list] of Object.entries(clip.keyframes)) {
      if (!path.startsWith(prefix) || !list.length) continue;
      (keyframes[e.id] ??= {})[path.slice(prefix.length)] = clone(list);
    }
  }
  return { effects, keyframes };
}

/**
 * Adds a payload's effects to a clip draft with fresh ids, remapping their
 * keyframes (dropping keys beyond the clip's end). Inserts at `index`
 * (default: the end). Returns the new ids.
 */
export function pasteEffects(clip: Clip, payload: EffectsPayload, makeId: () => string, index = clip.effects.length): string[] {
  const added: EffectInstance[] = [];
  for (const e of payload.effects) {
    const id = makeId();
    added.push({ ...clone(e), id });
    const kf = payload.keyframes[e.id];
    if (!kf) continue;
    for (const [key, list] of Object.entries(kf)) {
      const kept = list.filter((k) => k.t <= clip.duration + 1e-6).map((k) => ({ ...k }));
      if (kept.length) clip.keyframes[`effects.${id}.${key}`] = kept;
    }
  }
  const at = Math.max(0, Math.min(index, clip.effects.length));
  clip.effects.splice(at, 0, ...added);
  return added.map((e) => e.id);
}

/** Removes an effect and its keyframes from a clip draft. */
export function removeEffect(clip: Clip, id: string): void {
  clip.effects = clip.effects.filter((e) => e.id !== id);
  const prefix = `effects.${id}.`;
  for (const path of Object.keys(clip.keyframes)) if (path.startsWith(prefix)) delete clip.keyframes[path];
}

/** Resets an effect's params to defaults and drops its keyframes. */
export function resetEffect(clip: Clip, id: string, params: readonly ParamDef[]): void {
  const fx = clip.effects.find((e) => e.id === id);
  if (!fx) return;
  fx.params = defaultsOf(params);
  const prefix = `effects.${id}.`;
  for (const path of Object.keys(clip.keyframes)) if (path.startsWith(prefix)) delete clip.keyframes[path];
}

/** Moves an item from one index to another (returns a new array). `to` is the final index. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const [it] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, it);
  return out;
}

/** Index to drop at when hovering item `over` in its upper or lower half, adjusted for removal of `from`. */
export function dropIndex(from: number, over: number, after: boolean): number {
  let to = over + (after ? 1 : 0);
  if (from < to) to -= 1;
  return to;
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

export type FavKind = 'effect' | 'transition';
export const favKey = (kind: FavKind, type: string) => `${kind}:${type}`;

export function parseFavKey(key: string): { kind: FavKind; type: string } | null {
  const m = /^(effect|transition):([a-zA-Z0-9_-]+)$/.exec(key);
  return m ? { kind: m[1] as FavKind, type: m[2] } : null;
}

/** Toggles a favorite, keeping insertion order (the order drives "Apply favorite 1…3"). */
export function toggleFavorite(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}
