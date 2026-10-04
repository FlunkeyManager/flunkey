/**
 * dictionary.ts – Shared Custom Vocabulary Resolver for Flunkey
 *
 * Single core used by both F8 (dictation) and F10 (transform).
 * Wispr Flow-style: the user adds a plain word once ("Groq"); the
 * engine recognizes its case variants and close misspellings
 * ("groq", "grock", "Flunky") and emits the canonical form.
 * No aliases, no replacement rules, no categories, no case modes.
 *
 * Engine is context-aware and conservative:
 * - Exact phase: longest-phrase-first, word-boundary, always
 *   case-insensitive, emits canonical casing ("PostgreSQL", "GitHub").
 * - Fuzzy phase: Levenshtein distance with length-adaptive thresholds,
 *   confidence = 1 - dist/maxLen, only if ≥0.82, and only for words
 *   ≥4 chars, not common English, not ambiguous (single best match).
 * - Conservative: short tokens (≤3), common words, and ambiguous ties
 *   are left untouched.
 * - Shared: one `resolveCustomVocabulary()` called from F8 and F10; UI
 *   stays simple with two toggles `dictionaryEnabledF8` / `F10`.
 */

import { applyCorrections } from "./dictionaryCorrections";
import type { DictionaryEntry } from "./types";

function defaultEntry(id: string, word: string): DictionaryEntry {
  return {
    id,
    word,
    enabled: true,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}

export const DEFAULT_DICTIONARY_ENTRIES: DictionaryEntry[] = [
  defaultEntry("default-groq", "Groq"),
  defaultEntry("default-flunkey", "Flunkey"),
  defaultEntry("default-vscode", "VS Code"),
];

/**
 * Normalize a stored/imported entry to the words-only shape.
 * Legacy fields (shortcut aliases, caseSensitive, category) are dropped:
 * fuzzy matching now covers misspellings ("grok" -> "Groq") without them.
 * `corrections` is kept: it carries errors the fuzzy threshold cannot reach.
 */
export function normalizeDictionaryEntry(item: unknown): DictionaryEntry | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  if (typeof raw.word !== "string" || raw.word.trim().length === 0) return null;
  const now = Date.now();
  const word = raw.word.trim();
  const corrections = Array.from(
    new Set(
      (Array.isArray(raw.corrections) ? raw.corrections : [])
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.trim())
        // A correction identical to the target is a no-op, and a correction
        // for another entry's word would make two rules fight over it.
        .filter((c) => c.length > 0 && c.toLowerCase() !== word.toLowerCase()),
    ),
  );
  return {
    id: typeof raw.id === "string" ? raw.id : crypto.randomUUID(),
    word,
    enabled: raw.enabled !== false,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
    ...(corrections.length > 0 ? { corrections } : {}),
  };
}

/** Normalize a list: drop invalid rows, dedupe case-insensitively (keep first). */
export function normalizeDictionaryList(list: unknown[]): DictionaryEntry[] {
  const seen = new Set<string>();
  const out: DictionaryEntry[] = [];
  for (const item of list) {
    const entry = normalizeDictionaryEntry(item);
    if (!entry) continue;
    const key = entry.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/* ── helpers ─────────────────────────────────────────────────── */

// Words-only vocabulary: every entry contributes exactly one trigger —
// its own word, always matched case-insensitively.
function triggerFor(entry: DictionaryEntry): string {
  return entry.word.trim();
}

// Small common-word stoplist to avoid fuzzy over-correction of everyday words.
const COMMON_WORDS = new Set([
  "the", "be", "to", "of", "and", "a", "in", "that", "have", "i", "it", "for", "not", "on", "with", "he", "as", "you", "do", "at", "this", "but", "his", "by", "from", "they", "we", "say", "her", "she", "or", "an", "will", "my", "one", "all", "would", "there", "their", "what", "so", "up", "out", "if", "about", "who", "get", "which", "go", "me", "when", "make", "can", "like", "time", "no", "just", "him", "know", "take", "people", "into", "year", "your", "good", "some", "could", "them", "see", "other", "than", "then", "now", "look", "only", "come", "its", "over", "think", "also", "back", "after", "use", "two", "how", "our", "work", "first", "well", "way", "even", "new", "want", "because", "any", "these", "give", "day", "most", "us", "code", "app", "file", "data", "word", "text",
]);

function isCommonWord(w: string): boolean {
  return COMMON_WORDS.has(w.toLowerCase());
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function confidenceFor(a: string, b: string, dist: number): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  return 1 - dist / maxLen;
}

function maxAllowedDist(tokenLen: number): number {
  if (tokenLen <= 3) return 0; // never fuzzy short tokens
  if (tokenLen === 4) return 1;
  if (tokenLen <= 7) return 1;
  return 2;
}

function shouldFuzzyToken(token: string, alias: string): boolean {
  const t = token.toLowerCase();
  const a = alias.toLowerCase();
  if (t.length < 4 || a.length < 4) return false;
  if (isCommonWord(t) && !isCommonWord(a)) {
    const d = levenshtein(t, a);
    return d === 1;
  }
  return true;
}

/**
 * Relevance pre-filter: return only the entries that could plausibly
 * appear in `text` — exact/substring hit or within a small edit distance
 * of some token. This is what goes into LLM prompts (Whisper bias,
 * polish, F10 rules) instead of the whole dictionary: fewer tokens,
 * faster calls, less hallucination surface. The deterministic resolver
 * below still runs over ALL enabled entries, so nothing is ever missed.
 */
export function selectRelevantEntries(
  text: string,
  entries: DictionaryEntry[],
  max = 10
): DictionaryEntry[] {
  const enabled = entries.filter((e) => e.enabled && e.word.trim().length > 0);
  if (enabled.length === 0 || !text.trim()) return [];
  const lowerText = text.toLowerCase();
  // Spaceless haystack lets "VSCode" match a "VS Code" entry.
  const spacelessText = lowerText.replace(/[^a-z0-9]+/g, "");
  const tokens = lowerText
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0 && spacelessText.length < 2) return [];

  const scored: { e: DictionaryEntry; d: number; exact: boolean }[] = [];
  for (const e of enabled) {
    const canon = e.word.trim().toLowerCase();
    const spacelessCanon = canon.replace(/[^a-z0-9]+/g, "");
    const variants = new Set<string>([
      canon.replace(/[^a-z0-9]+/g, ""),
      ...canon.split(/[^a-z0-9]+/).filter((p) => p.length >= 2),
    ]);
    variants.delete("");
    // Whole-phrase substring hit (covers "VS Code" in text as-is).
    if (canon.length >= 2 && lowerText.includes(canon)) {
      scored.push({ e, d: 0, exact: true });
      continue;
    }
    // Spaceless hit: text "vscode" matches entry "VS Code".
    if (
      spacelessCanon.length >= 4 &&
      spacelessText.includes(spacelessCanon)
    ) {
      scored.push({ e, d: 0, exact: true });
      continue;
    }
    let best = Infinity;
    for (const v of variants) {
      if (v.length < 2) continue;
      for (const t of tokens) {
        if (t === v || (t.length >= 5 && v.length >= 5 && (t.includes(v) || v.includes(t)))) {
          best = 0;
          break;
        }
        // 2-3 char tokens: exact only, never fuzzy (avoids "AI" hijacking "a").
        if (t.length < 4 || v.length < 4) continue;
        if (Math.abs(t.length - v.length) > 2) continue;
        const d = levenshtein(t, v);
        const maxD = Math.max(1, Math.floor(Math.max(t.length, v.length) / 4));
        if (d <= maxD && d < best) best = d;
      }
      if (best === 0) break;
    }
    if (best <= 2) scored.push({ e, d: best, exact: best === 0 });
  }
  // Exact/substring hits first (stable for Whisper bias order), then by distance.
  scored.sort((a, b) => Number(b.exact) - Number(a.exact) || a.d - b.d);
  return scored.slice(0, max).map((s) => s.e);
}

/* ── Core resolver – shared by F8 and F10 ─────────────────────── */

export interface ResolveOptions {
  /** If true, allow fuzzy (0.80+) for non-exact misspellings. Default true. */
  fuzzy?: boolean;
  /** Minimum confidence for fuzzy replacement. Default 0.82. */
  minConfidence?: number;
}

export function resolveCustomVocabulary(
  text: string,
  entries: DictionaryEntry[],
  opts: ResolveOptions = {}
): string {
  if (!text || entries.length === 0) return text;
  const active = entries.filter((e) => e.enabled && e.word.trim().length > 0);
  if (active.length === 0) return text;

  const fuzzyEnabled = opts.fuzzy !== false;
  const minConf = opts.minConfidence ?? 0.82;

  // Build trigger -> canonical map, longest first for exact phase.
  // One trigger per word, always case-insensitive.
  type Trigger = { raw: string; norm: string; canonical: string };
  const triggers: Trigger[] = [];
  for (const e of active) {
    const raw = triggerFor(e);
    if (!raw) continue;
    triggers.push({ raw, norm: raw.toLowerCase(), canonical: raw });
  }
  // Deduplicate by norm, keep longest raw for same norm
  const byNorm = new Map<string, Trigger>();
  for (const tr of triggers) {
    const existing = byNorm.get(tr.norm);
    if (!existing || tr.raw.length > existing.raw.length) byNorm.set(tr.norm, tr);
  }
  const deduped = Array.from(byNorm.values()).sort((a, b) => b.raw.length - a.raw.length);

  // ── Exact corrections phase.
  // Explicit "this wrong word means that right word" rules go first, before
  // both the exact scan and the fuzzy guess. A rule the user typed must always
  // beat a correction we inferred from edit distance.
  const corrected = applyCorrections(text, entries);

  // ── Exact phase: scan left-to-right, longest match wins, word-boundary aware
  let exactResult = "";
  let i = 0;
  while (i < corrected.length) {
    let best: Trigger | null = null;
    let bestLen = 0;
    for (const tr of deduped) {
      const len = tr.raw.length;
      if (i + len > corrected.length) continue;
      const slice = corrected.slice(i, i + len);
      if (slice.toLowerCase() !== tr.norm) continue;
      // Word/phrase boundary check: char before and after must be non-word or string edge
      const before = i === 0 ? "" : corrected[i - 1];
      const after = i + len >= corrected.length ? "" : corrected[i + len];
      const isWordChar = (c: string) => /[A-Za-z0-9_]/.test(c);
      // For phrases containing space, we allow internal spaces, but boundaries still apply
      if (before && isWordChar(before)) continue;
      if (after && isWordChar(after)) continue;
      // Longest match wins (e.g. "VS Code" beats "VS")
      if (len > bestLen) {
        best = tr;
        bestLen = len;
      }
    }
    if (best) {
      // Enforce canonical casing; skip when already exact
      const slice = text.slice(i, bestLen);
      if (slice === best.canonical) {
        exactResult += slice;
      } else {
        // Enforce canonical casing (proper-name handling)
        exactResult += best.canonical;
      }
      i += bestLen;
    } else {
      exactResult += text[i];
      i++;
    }
  }

  if (!fuzzyEnabled) return exactResult;

  // ── Fuzzy phase: token-wise correction for remaining words not already canonical
  // Tokenize preserving delimiters: split on word boundaries but keep delimiters
  // We'll walk the exactResult and replace word tokens where fuzzy match is confident.

  // Fuzzy candidates: the words themselves, always case-insensitive
  type FuzzyCandidate = { aliasNorm: string; canonical: string };
  const fuzzyCandidates: FuzzyCandidate[] = deduped.map((tr) => ({
    aliasNorm: tr.norm,
    canonical: tr.canonical,
  }));

  // Quick early exit if no candidates suitable for fuzzy (all short/common)
  let result = "";
  const tokens: Array<{ text: string; isWord: boolean; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  const tokenRe = /[A-Za-z0-9_]+(?:['’][A-Za-z0-9_]+)*|[^A-Za-z0-9_]+/g;
  while ((m = tokenRe.exec(exactResult)) !== null) {
    const t = m[0];
    const isWord = /^[A-Za-z0-9_]/.test(t);
    tokens.push({ text: t, isWord, start: m.index, end: m.index + t.length });
  }

  for (let idx = 0; idx < tokens.length; idx++) {
    const tok = tokens[idx];
    if (!tok.isWord) {
      result += tok.text;
      continue;
    }
    const word = tok.text;
    // Skip if word already exactly equals any canonical (with correct casing) — don't re-fuzzy
    const wordLower = word.toLowerCase();
    const isAlreadyCanonical = fuzzyCandidates.some(
      (c) => c.canonical.toLowerCase() === wordLower && c.canonical === word // would have been exact
    );
    if (isAlreadyCanonical) {
      result += word;
      continue;
    }
    // Skip short/common
    if (word.length < 4) {
      result += word;
      continue;
    }
    // Word matches a dictionary word case-insensitively but wasn't
    // replaced (boundary overlap) — exact phase owns those, skip here.
    const exactLowerMatch = fuzzyCandidates.find((c) => c.aliasNorm === wordLower);
    if (exactLowerMatch) {
      result += word;
      continue;
    }

    let best: FuzzyCandidate | null = null;
    let bestDist = Infinity;
    let bestConf = 0;
    for (const cand of fuzzyCandidates) {
      // Phrase entries ("VS Code"): match a single spaceless token
      // ("vscode") against the spaceless canonical. This is exact/short-
      // distance only — never aggressive, so "code" alone won't become it.
      const target = cand.aliasNorm.includes(" ")
        ? cand.aliasNorm.replace(/[^a-z0-9]+/g, "")
        : cand.aliasNorm;
      if (!shouldFuzzyToken(word, target)) continue;
      const dist = levenshtein(wordLower, target);
      const maxDist = cand.aliasNorm.includes(" ")
        ? 1
        : maxAllowedDist(word.length);
      if (dist === 0) {
        // Spaceless exact hit on a phrase ("vscode" → "VS Code").
        if (cand.aliasNorm.includes(" ")) {
          best = cand;
          bestDist = 0;
          bestConf = 1;
        }
        continue; // plain exact would have been handled above
      }
      if (dist > maxDist) continue;
      const conf = confidenceFor(wordLower, target, dist);
      if (conf < minConf) continue;
      if (dist < bestDist || (dist === bestDist && conf > bestConf)) {
        best = cand;
        bestDist = dist;
        bestConf = conf;
      }
    }
    if (best && bestConf >= minConf) {
      // Check for tie ambiguity: if another candidate has same dist/conf, skip (conservative)
      let tie = false;
      for (const cand of fuzzyCandidates) {
        if (cand === best) continue;
        const target = cand.aliasNorm.includes(" ")
          ? cand.aliasNorm.replace(/[^a-z0-9]+/g, "")
          : cand.aliasNorm;
        const d = levenshtein(wordLower, target);
        const c = confidenceFor(wordLower, target, d);
        if (d === bestDist && Math.abs(c - bestConf) < 0.02) {
          tie = true;
          break;
        }
      }
      if (!tie) {
        result += best.canonical; // proper-name casing enforced
        continue;
      }
    }
    result += word;
  }

  return result;
}

/**
 * Pre-compiles enabled custom words into a concise comma-separated prompt for Whisper.
 * Whisper uses this prompt parameter to bias its acoustic recognition toward these exact terms.
 * NOTE: caller order is preserved — pass `selectRelevantEntries(text, dict)`
 * for relevance-sorted bias so the 650ch cap keeps the most relevant words.
 */
export function buildWhisperDictionaryPrompt(entries: DictionaryEntry[]): string {
  const enabledWords = entries
    .filter((e) => e.enabled && e.word.trim().length > 0)
    .map((e) => e.word.trim());

  if (enabledWords.length === 0) return "";

  // Deduplicate and cap to ~650 characters (Whisper prompt token limit is 224 tokens)
  const uniqueWords = Array.from(new Set(enabledWords));
  let promptStr = "";

  for (const word of uniqueWords) {
    const candidate = promptStr ? `${promptStr}, ${word}` : word;
    if (candidate.length > 650) break;
    promptStr = candidate;
  }

  return promptStr;
}

/**
 * Formats active dictionary entries for LLM prompts (F8 polish, F10).
 * AI-applied (not blind find/replace): the model sees the exact forms
 * and is told to fix misspelled/variant forms it finds in the text.
 */
export function formatDictionaryForPrompt(entries: DictionaryEntry[]): string {
  const active = entries.filter((e) => e.enabled && e.word.trim().length > 0);
  if (active.length === 0) return "";

  const lines = active.slice(0, 30).map((e) => `- "${e.word.trim()}"`);

  return `\n\n[CUSTOM VOCABULARY & SPELLING RULES]\nUse these exact terms with this exact capitalization. If the text contains a misspelled, misheard, or variant form of any listed term, replace ONLY that word with the exact listed form — change nothing else around it:\n${lines.join("\n")}`;
}

/**
 * Exports dictionary entries as a clean JSON string.
 */
export function exportDictionaryAsJson(entries: DictionaryEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

/**
 * Parses and validates an imported JSON dictionary.
 * Legacy fields (shortcut, caseSensitive, category) are ignored —
 * only words are kept, deduplicated case-insensitively.
 */
export function importDictionaryFromJson(
  jsonStr: string
): { valid: DictionaryEntry[]; count: number } {
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return { valid: [], count: 0 };
    const valid = normalizeDictionaryList(parsed);
    return { valid, count: valid.length };
  } catch {
    return { valid: [], count: 0 };
  }
}
