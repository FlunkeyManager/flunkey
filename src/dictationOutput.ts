/**
 * dictationOutput.ts — makes a model reply safe to paste as dictated text.
 *
 * F10 had `sanitizeF10Response` for exactly this; F8 had nothing, so a polite
 * preamble or a stray `**bold**` was pasted verbatim into whatever app the
 * user was typing in. This is the F8 equivalent; structured code, email, and
 * list output must remain intact when those formats are explicitly requested.
 *
 * Order matters: unwrap ordinary fenced replies, strip framing, strip inline
 * markdown, then collapse whitespace. Structured output bypasses Markdown
 * cleanup so its code, bullets, and layout remain pasteable as authored.
 */

/** Whole-response wrappers the model adds despite being told not to. */
const FENCE_WRAPPER = /^```(?:[\w-]+)?\n([\s\S]*?)\n?```\s*$/;

/** Opening framing on its own line, before the actual dictation. */
const PREAMBLE_LINE: RegExp[] = [
  /^(?:sure|certainly|of course|absolutely|got it|okay|ok)\s*[!,.:]?\s*(?:here(?:'s| is| are)\s+(?:the\s+)?(?:corrected|polished|cleaned|revised|rewritten|formatted|final)\s*(?:version|text|output|result))?[:\s]*$/i,
  /^(?:here(?:'s| is| are))\s+(?:the\s+)?(?:corrected|polished|cleaned|revised|rewritten|formatted|final)\s*(?:version|text|output|result)[:\s]*$/i,
  /^(?:the\s+)?(?:corrected|polished|cleaned|revised|rewritten|formatted|final)\s+(?:version|text|output|result)\s*(?:is|of)?[:\s]*$/i,
  /^(?:below\s+is|as requested|per your request)[:,]?\s*$/i,
  /^(?:i(?:'ve| have)\s+(?:cleaned up|polished|corrected|revised|processed)|(?:cleaning up|polishing)\s+the\s+transcript)[:\s]*$/i,
  /^(?:transcribed|transcript|result|output|answer|text)\s*[:：]\s*$/i,
];

/**
 * "Here's a polished version: <text>" on one line.
 *
 * The inner group is kept; only the framing is dropped.
 */
const INLINE_PREAMBLE =
  /^(?:(?:sure|certainly|of course|absolutely|okay|ok)\s*[!,.:]?\s*)?(?:here(?:'s| is| are)\s+(?:the\s+)?)?(?:(?:corrected|polished|cleaned|revised|rewritten|formatted|final)\s*(?:version|text|output|result)\s*(?:is|of)?\s*[:：-]\s*|transcript\s*[:：-]\s*|i(?:'ve| have)\s+(?:cleaned up|polished|corrected|revised|processed)\s*[:：-]\s*)([\s\S]+)$/i;

/**
 * Inline markdown that has no business in dictated prose.
 *
 * Emphasis requires non-space content on both sides, which is what keeps
 * `2 * 3 * 4` (dictated maths) and `snake_case_name` intact while still
 * removing `**bold**` and `_italic_` even at the very start of the text.
 *
 * Not used for structured or Enhanced output: their bullets and headings are
 * the deliverable.
 */
function stripInlineMarkdown(text: string): string {
  return text
    // Headings: "## Heading" -> "Heading"
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    // Horizontal rules.
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "")
    // Bold, then italics. Order matters: ** must go before *.
    .replace(/\*\*(\S(?:[^*\n]*\S)?)\*\*/g, "$1")
    .replace(/(?<![A-Za-z0-9_])__(\S(?:[^_\n]*\S)?)__(?![A-Za-z0-9_])/g, "$1")
    .replace(/\*(\S(?:[^*\n]*\S)?)\*/g, "$1")
    .replace(/(?<![A-Za-z0-9_])_(\S(?:[^_\n]*\S)?)_(?![A-Za-z0-9_])/g, "$1")
    // Bullets: "- item" -> "item"
    .replace(/^\s{0,4}[-*+]\s+/gm, "")
    // Blockquote markers.
    .replace(/^\s{0,3}>\s?/gm, "");
}

/** Remove a single pair of wrapping quotes, which are framing not content. */
function stripWrappingQuotes(text: string): string {
  const pairs: [string, string][] = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
  ];
  for (const [open, close] of pairs) {
    if (
      text.length >= 2 &&
      text.startsWith(open) &&
      text.endsWith(close) &&
      // A quoted sentence ends in punctuation, so requiring it keeps
      // he said "hi" and that's that from being unwrapped.
      /[.!?…]["'’”)\]]?$/.test(text)
    ) {
      const inner = text.slice(1, -1).trim();
      if (inner) return inner;
    }
  }
  return text;
}

/**
 * Clean a dictation so only the spoken words remain.
 *
 * `preserveStructure` is set for Enhanced output and Light's explicitly
 * structured formats, where fences, paragraphs, and bullets are intentional.
 * Framing is stripped either way: a preamble is never something anyone said.
 *
 * Returns `""` when the input contained nothing but chat framing — a sign-off,
 * a bare preamble, an empty fence. That is a real outcome: there are no
 * dictated words in it, and pasting the framing is exactly the bug this
 * module exists to stop. Callers must treat an empty result as "no usable
 * dictation" and fall back to the raw transcript.
 */
export function sanitizeDictationOutput(
  raw: string,
  preserveStructure = false,
): string {
  let text = (raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";

// A reply wrapped entirely in a fence. An empty fence means there was nothing
// inside, which is itself the answer: return empty rather than the fence.
const fenced = preserveStructure ? null : text.match(FENCE_WRAPPER);
if (fenced) {
  const inner = fenced[1].trim();
  text = inner;
}

  // Strip a standalone framing line, repeatedly: models sometimes stack
  // "Sure!" then "Here's the cleaned text:".
  let guard = 0;
  while (guard++ < 4) {
    const lines = text.split("\n");
    if (lines.length < 2) break;
    if (!PREAMBLE_LINE.some((re) => re.test(lines[0].trim()))) break;
    lines.shift();
    text = lines.join("\n").trim();
    if (!text) break;
  }

  // "Here's the polished version: <the dictation>" on one line.
  if (!text.includes("\n")) {
    const inline = text.match(INLINE_PREAMBLE);
    if (inline && inline[1].trim()) text = inline[1].trim();
  }

  text = preserveStructure ? text : stripInlineMarkdown(text);
  text = stripWrappingQuotes(text);

  // Remove chatty model sign-offs from plain dictation, never from authored
  // structures such as emails or code comments.
  if (!preserveStructure) {
    text = text.replace(
      /\n*\s*(?:i hope (?:this|that) helps|let me know if you need anything else|hope (?:this|that) helps|feel free to ask)[.!]?\s*$/i,
      "",
    );
  }

  // Collapse the blank-line runs a chat reply tends to produce. A single
  // paragraph break is preserved because emails use it.
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  // Leftover fence markers with nothing between them: the reply had no
  // content, only a wrapper and a sign-off. Pasting ``` ``` is worse than
  // pasting nothing.
  if (/^[\s`~]+$/.test(text)) return "";

  return text;
}