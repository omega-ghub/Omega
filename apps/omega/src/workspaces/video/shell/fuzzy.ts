// Fuzzy matching for the command palette and the shortcuts search.
// Pure: no DOM. OWNED BY THE SHELL PACKAGE.

export interface FuzzyMatch {
  score: number;
  /** Indices into the text that matched (for highlighting). */
  positions: number[];
}

const isBoundary = (text: string, i: number) => i === 0 || /[\s\-_./:·(]/.test(text[i - 1]) || (/[a-z]/.test(text[i - 1]) && /[A-Z]/.test(text[i]));

/**
 * Scores `query` as a subsequence of `text`. Contiguous runs, word starts and
 * prefix matches score higher; gaps cost a little. Returns null when some
 * character of the query does not occur in order.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return { score: 0, positions: [] };
  if (q.length > t.length) return null;

  // Exact substring: strongest signal, prefer word-start occurrences.
  let best: FuzzyMatch | null = null;
  let from = 0;
  while (true) {
    const at = t.indexOf(q, from);
    if (at < 0) break;
    const score = 100 + q.length * 12 + (at === 0 ? 40 : isBoundary(text, at) ? 25 : 0) - at * 0.5 - (t.length - q.length) * 0.15;
    if (!best || score > best.score) best = { score, positions: Array.from({ length: q.length }, (_, k) => at + k) };
    from = at + 1;
  }
  if (best) return best;

  // Subsequence: greedy, but jump to a word start when one is available.
  const positions: number[] = [];
  let score = 0;
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    // look for a boundary occurrence first
    for (let k = ti; k < t.length; k++) {
      if (t[k] === ch && isBoundary(text, k)) {
        found = k;
        break;
      }
    }
    const plain = t.indexOf(ch, ti);
    if (plain < 0) return null;
    // only take the boundary match if it doesn't skip too far ahead
    if (found < 0 || (positions.length && plain === positions[positions.length - 1] + 1)) found = plain;
    const prev = positions[positions.length - 1];
    score += 10;
    if (isBoundary(text, found)) score += 9;
    if (prev !== undefined && found === prev + 1) score += 7;
    if (prev !== undefined) score -= Math.min(6, (found - prev - 1) * 0.6);
    else score -= found * 0.4;
    positions.push(found);
    ti = found + 1;
  }
  score -= (t.length - q.length) * 0.1;
  return { score, positions };
}

export interface Searchable {
  label: string;
  /** Secondary fields (group, id, hint…) with their weights. */
  extra?: { text: string; weight: number }[];
}

/**
 * Multi-word search: every whitespace-separated token must match the label
 * or one of the extra fields. Returns the summed score and the label
 * positions to highlight, or null.
 */
export function searchScore(query: string, item: Searchable): FuzzyMatch | null {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { score: 0, positions: [] };
  let total = 0;
  const positions = new Set<number>();
  for (const tok of tokens) {
    let best: { score: number; label: number[] | null } | null = null;
    const m = fuzzyMatch(tok, item.label);
    if (m) best = { score: m.score, label: m.positions };
    for (const f of item.extra ?? []) {
      const e = fuzzyMatch(tok, f.text);
      if (e && (!best || e.score * f.weight > best.score)) best = { score: e.score * f.weight, label: null };
    }
    if (!best) return null;
    total += best.score;
    for (const p of best.label ?? []) positions.add(p);
  }
  // A whole-query label match beats token soup.
  const whole = tokens.length > 1 ? fuzzyMatch(query.trim(), item.label) : null;
  if (whole && whole.score > total) return whole;
  return { score: total, positions: [...positions].sort((a, b) => a - b) };
}
