/**
 * smartSearch.ts — Relevance-ranked local search for history pages.
 *
 * Not a simple substring filter:
 * - multi-word queries use AND semantics (every term must match something),
 * - per-field weights (titles/instructions outrank body text),
 * - typo tolerance via word-level Levenshtein (scaled by term length),
 * - prefix matches ("gmail" finds "gmails"? no — prefix of longer word),
 * - verbatim phrase bonus when the whole query appears as-is,
 * - diacritic/case/whitespace-insensitive,
 * - recency breaks score ties.
 * Pure TypeScript, no dependencies, fast for history-sized lists.
 */

export interface SearchField {
  text: string;
  weight: number;
}

function normalize(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      cur[j] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[n];
}

/** Allowed edit distance by term length (short terms stay exact). */
function maxDist(termLen: number): number {
  if (termLen <= 3) return 0;
  if (termLen <= 6) return 1;
  return 2;
}

/** Match quality of one normalized term against one normalized field. */
function termFieldScore(term: string, field: string): number {
  if (!term || !field) return 0;
  if (field.includes(term)) return 1;
  const md = maxDist(term.length);
  if (md === 0) return 0;
  let best = 0;
  const words = field.split(" ");
  for (const w of words) {
    if (!w || Math.abs(w.length - term.length) > md + 1) continue;
    if (w.startsWith(term) && w.length > term.length) {
      if (0.9 > best) best = 0.9;
      continue;
    }
    const d = levenshtein(term, w);
    if (d <= md) {
      const q = (1 - d / (term.length + 1)) * 0.8;
      if (q > best) best = q;
    }
  }
  return best;
}

export function smartSearch<T>(
  items: T[],
  query: string,
  getFields: (item: T) => SearchField[],
  getTimestamp?: (item: T) => number
): T[] {
  const q = normalize(query);
  if (!q) return items;
  const terms = q.split(" ").filter(Boolean);
  const scored: { item: T; score: number; ts: number }[] = [];
  for (const item of items) {
    const fields = getFields(item)
      .filter((f) => f.weight > 0)
      .map((f) => ({ weight: f.weight, text: normalize(f.text) }))
      .filter((f) => f.text.length > 0);
    if (fields.length === 0) continue;
    let score = 0;
    let allMatch = true;
    for (const term of terms) {
      let best = 0;
      for (const f of fields) {
        const s = termFieldScore(term, f.text);
        if (s > 0) {
          const weighted = s * f.weight;
          if (weighted > best) best = weighted;
        }
      }
      if (best <= 0) {
        allMatch = false;
        break;
      }
      score += best;
    }
    if (!allMatch) continue;
    // Verbatim phrase bonus: the whole query appears as-is.
    for (const f of fields) {
      if (f.text.includes(q)) score += 0.5 * f.weight;
    }
    scored.push({ item, score, ts: getTimestamp ? getTimestamp(item) : 0 });
  }
  scored.sort((a, b) => b.score - a.score || b.ts - a.ts);
  return scored.map((s) => s.item);
}
