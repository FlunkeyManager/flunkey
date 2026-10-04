/**
 * dictionaryCorrections.ts — teach Flunkey a specific misspelling.
 *
 * The dictionary already knew a word ("Groq") and would fuzzy-correct anything
 * within a small Levenshtein distance of it. That handles "grock" but gives
 * the user no way to say *this exact wrong thing* means *that exact right
 * thing*, which is what you need when the error is systematic rather than a
 * typo — a model that always hears "get" when you say "Git", or "Paul" for
 * "Pall".
 *
 * Modelled on the correction rule Wispr Flow ships: an entry holds the
 * correct spelling plus one or more known misspellings, matching is whole-word
 * and case-insensitive, the longest match wins when rules overlap, and the
 * replacement keeps the capitalization that was saved.
 *
 * Corrections run *before* the fuzzy pass so an explicit rule always wins over
 * a guessed one.
 */

import type { DictionaryEntry } from "./types";

/**
 * Contraction endings a bare-word rule must not rewrite.
 *
 * "Don" -> "Dawn" fixes the standalone word but must not turn "don't" into
 * "Dawn't". Only `n't` is excluded: possessives are still corrected, which is
 * what you want ("John's" -> "Bob's").
 */
const CONTRACTION_SUFFIX = /n['’]t$/i;

export interface CorrectionRule {
  /** What the engine wrongly produces, e.g. "grock". */
  misspelling: string;
  /** What it should produce, e.g. "Groq". */
  replacement: string;
}

export interface CorrectionOptions {
  /** Match case-insensitively (default). Case is taken from `replacement`. */
  caseInsensitive?: boolean;
}

function normalize(value: string | undefined | null): string {
  return (value ?? "").trim();
}

/**
 * Flatten the dictionary into correction rules.
 *
 * Longer misspellings are applied first so "vue js framework" wins over "vue"
 * when both are defined.
 */
export function collectCorrectionRules(
  entries: DictionaryEntry[],
): CorrectionRule[] {
  const rules: CorrectionRule[] = [];
  for (const entry of entries) {
    if (!entry.enabled) continue;
    const replacement = normalize(entry.word);
    if (!replacement) continue;
    for (const misspelling of entry.corrections ?? []) {
      const from = normalize(misspelling);
      // A rule identical to its target is a no-op that could only confuse.
      if (!from || from.toLowerCase() === replacement.toLowerCase()) continue;
      rules.push({ misspelling: from, replacement });
    }
  }
  return rules.sort((a, b) => b.misspelling.length - a.misspelling.length);
}


/**
 * Apply known-misspelling corrections.
 *
 * Whole-word, case-insensitive by default, longest rule first. The replacement
 * is inserted with the capitalization stored in the dictionary, because a name
 * spelled "Groq" should come out "Groq" at the start of a sentence and mid-text
 * alike — matching the behaviour of the existing exact-phase resolver.
 */
export function applyCorrections(
  text: string,
  entries: DictionaryEntry[],
  options: CorrectionOptions = {},
): string {
  const caseInsensitive = options.caseInsensitive !== false;
  const rules = collectCorrectionRules(entries);
  if (!text || rules.length === 0) return text;

  let out = text;
  for (const { misspelling, replacement } of rules) {
    const escaped = escapeRegExp(misspelling);
    // Whole-word, with an optional trailing contraction suffix captured so a
    // bare-word rule can decline to rewrite the stem of "don't".
    const pattern = new RegExp(
      `(^|[^A-Za-z0-9])(${escaped})(['’][a-z]+)?(?![A-Za-z0-9])`,
      caseInsensitive ? "gi" : "g",
    );
    out = out.replace(pattern, (match, lead: string, found: string, suffix?: string) => {
      // "Don" -> "Dawn" must not turn "don't" into "Dawn't". Only `n't` is
      // excluded, so possessives are still corrected.
      if (
        suffix &&
        !/\s/.test(misspelling) &&
        CONTRACTION_SUFFIX.test(`${found}${suffix}`)
      ) {
        return match;
      }
      return `${lead}${replacement}${suffix ?? ""}`;
    });
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Entries that carry at least one correction, for UI summaries. */
export function entriesWithCorrections(entries: DictionaryEntry[]): DictionaryEntry[] {
  return entries.filter((e) => (e.corrections ?? []).length > 0);
}

/** How many correction rules the dictionary currently holds. */
export function countCorrections(entries: DictionaryEntry[]): number {
  return collectCorrectionRules(entries).length;
}

/**
 * A misspelling already claimed by some entry, optionally excluding one.
 *
 * Used to keep the UI from silently creating two rules that fight over the
 * same wrong word.
 */
export function findCorrectionOwner(
  entries: DictionaryEntry[],
  misspelling: string,
  excludeId?: string,
): DictionaryEntry | undefined {
  const needle = normalize(misspelling).toLowerCase();
  if (!needle) return undefined;
  return entries.find(
    (e) =>
      e.id !== excludeId &&
      (e.corrections ?? []).some((c) => normalize(c).toLowerCase() === needle),
  );
}
