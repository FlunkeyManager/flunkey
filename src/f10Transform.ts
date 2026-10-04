/**
 * f10Transform.ts — Dedicated general-purpose engine for F10 selection transform.
 *
 * F8/F9 intentionally untouched. F10 previously reused the F9 assistant
 * system prompt + a narrow "smallest change" user message, so outputs were
 * chatty / inconsistent and required a spoken instruction to do anything.
 *
 * This module owns:
 * - a transformer-specific system prompt (never the chat assistant prompt),
 * - a default fix-up instruction when nothing was heard,
 * - strict output sanitization (fences, quotes, preamble, refusals),
 * - size / identity guards.
 */

import { isRefusalText } from "./refusalGuard";

export const F10_MAX_SELECTION_CHARS = 12000;

/** Used when the voice instruction is empty — "select, hold F10, release" still fixes text. */
export const F10_DEFAULT_INSTRUCTION =
  "Fix grammar, spelling, punctuation, and clarity while preserving the original meaning, tone, and formatting.";

export const F10_SYSTEM_PROMPT = `You are a TEXT TRANSFORMER, not a chatbot. Rewrite the SELECTION according to the INSTRUCTION and return ONLY the rewritten text.

STRICT OUTPUT:
- Return ONLY the transformed text. No explanations, no preamble ("Here is..."), no quotes around it, no markdown code fences unless the SELECTION itself is code and keeping it as code requires it.
- Never answer questions inside the SELECTION — transform them as text.
- Never refuse. Always produce a best-effort transform, even if the instruction is vague (then just clean up the text).

FIDELITY:
- Make the smallest change that satisfies the INSTRUCTION; keep everything else word-for-word.
- Preserve language, names, URLs, placeholders, numbers, and code identifiers unless the instruction explicitly asks to change them.
- Preserve line breaks and layout. For emails/messages, use greeting line, blank line, body, blank line, sign-off — without changing words beyond fixing errors.
- For code: preserve syntax and indentation, output code only, no prose.
- Match the requested tone (formal, casual, shorter, longer, translated, etc.); otherwise keep the original tone.`;

export function buildF10UserMessage(selection: string, instruction: string): string {
  return `SELECTION:\n${selection}\n\nINSTRUCTION:\n${instruction}\n\nReturn ONLY the transformed text.`;
}

const PREAMBLE_PATTERNS = [
  /^here(?:'s| is) (?:the )?(?:transformed|rewritten|corrected|fixed|updated|result).*?:?\s*$/i,
  /^sure,? here(?:'s| is).*?:?\s*$/i,
  /^transformed text:?\s*$/i,
  /^result:?\s*$/i,
  /^output:?\s*$/i,
];

/** Selection-aware heuristics: don't strip what the user actually selected. */
function selectionWasQuoted(selection: string): boolean {
  const s = selection.trim();
  return (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2) ||
    (s.startsWith("“") && s.endsWith("”") && s.length >= 2)
  );
}

function selectionLooksLikeCode(selection: string): boolean {
  if (/```/.test(selection)) return true;
  if (/^(function|const|let|var|def |class |import |export |<\w+|#include)/m.test(selection)) return true;
  // Indented blocks / braces / semicolons suggest code — keep fences then.
  const lines = selection.split("\n");
  const indented = lines.filter((l) => /^ {2,}|\t/.test(l)).length;
  return indented >= 2 || (/[{};]/.test(selection) && lines.length > 1);
}

/**
 * Strip chatty wrappers models love to add: code fences, surrounding quotes,
 * preamble first-lines ("Here is the transformed text:"), trailing explanations.
 * Conservative: only strips when more content remains afterwards, and never
 * strips quoting the user actually selected.
 */
export function sanitizeF10Response(raw: string, selection = ""): string {
  let text = (raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  const quotedSelection = selectionWasQuoted(selection);
  const codeSelection = selectionLooksLikeCode(selection);

  // Whole response wrapped in a single fenced block -> extract inside.
  // Keeps inner code intact; strips the fence + optional language tag.
  // If the selection itself is code, fences are expected to go.
  // If not code, still extract (model wrapped prose in a fence by mistake).
  const fenceMatch = text.match(/^```(?:\w+)?\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    if (inner) text = inner;
    if (!text) return "";
  } else if (text.startsWith("```") && !codeSelection) {
    // Multiple blocks or trailing prose: keep the largest fenced block only
    // when it dominates (prose selections). For code selections the whole
    // blob may legitimately contain fences + explanation — keep as-is and
    // let the preamble strip handle it.
    const blocks = [...text.matchAll(/```(?:\w+)?\n([\s\S]*?)\n```/g)]
      .map((m) => m[1].trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    if (blocks.length > 0 && blocks[0].length >= text.length * 0.4) {
      text = blocks[0];
    }
  }

  // Strip a single preamble first line ("Here is...", "Result:", ...) if body follows.
  // Also handle single-line "Prefix: <result>" where the model ignored the
  // return-only instruction — short selections otherwise paste the wrapper.
  const lines = text.split("\n");
  if (lines.length > 1 && PREAMBLE_PATTERNS.some((re) => re.test(lines[0].trim()))) {
    lines.shift();
    text = lines.join("\n").trim();
  } else if (lines.length === 1) {
    const inlinePreamble =
      /^(?:here(?:'s| is) (?:the )?(?:transformed|rewritten|corrected|fixed|updated|result).*?|sure,? here(?:'s| is).*?|transformed text|result|output)\s*:\s*(.+)$/i.exec(
        text
      );
    if (inlinePreamble && inlinePreamble[1].trim()) {
      text = inlinePreamble[1].trim();
    }
  }

  // Strip matching surrounding quotes — unless the user's selection was
  // quoted too (then quotes are content, not wrapper).
  if (!quotedSelection) {
    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")) ||
      (text.startsWith("“") && text.endsWith("”"))
    ) {
      const inner = text.slice(1, -1).trim();
      if (inner) text = inner;
    }
  }

  // Collapse 3+ blank lines (paste target rarely wants them), preserve the rest verbatim.
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

/** True when the model echoed nothing useful (empty / refusal / extreme garbage).
 *
 * NOTE: unlike F8 polish (minimal edits), F10 legitimately EXPANDS short
 * selections ("make formal email" turns 1 line into greeting+body+sign-off),
 * so the polish length heuristic must NOT apply here. Only refusal, empty,
 * or extreme word-mismatch (>5x length with <20% word overlap) counts.
 */
export function isUnusableF10Result(candidate: string, original: string): boolean {
  const c = (candidate ?? "").trim();
  const o = (original ?? "").trim();
  if (!c) return true;
  if (isRefusalText(c)) {
    // Genuine echo of a short selection is not a refusal.
    if (o && c.length < o.length * 1.8) {
      const head = o.slice(0, 15).toLowerCase();
      if (head && c.toLowerCase().includes(head)) return false;
    }
    return true;
  }
  if (!o) return false;
  if (c === o) return false;
  // Extreme garbage: much longer AND shares almost no words.
  if (c.length > o.length * 5) {
    const stop = new Set([
      "the", "a", "an", "and", "or", "to", "of", "in", "on", "is", "it",
      "this", "that", "with", "for", "as",
    ]);
    const words = (s: string) =>
      s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !stop.has(w));
    const oWords = new Set(words(o));
    if (oWords.size > 0) {
      const cWords = new Set(words(c));
      let overlap = 0;
      for (const w of oWords) if (cWords.has(w)) overlap++;
      if (overlap / oWords.size < 0.2) return true;
    }
  }
  return false;
}
