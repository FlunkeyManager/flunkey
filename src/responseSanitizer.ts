/** Tags models may emit for chain-of-thought (hidden from the user). */
const THINK_TAG = "think" as const;

const THINKING_TAG_PAIRS: { open: string; close: string }[] = [
  { open: "<think>", close: "</think>" },
  { open: `<${THINK_TAG}>`, close: `</${THINK_TAG}>` },
  { open: "<thinking>", close: "</thinking>" },
];

const ALL_TAG_FRAGMENTS = THINKING_TAG_PAIRS.flatMap((p) => [p.open, p.close]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove completed thinking blocks from a full response. */
export function stripThinkingBlocks(text: string): string {
  let result = text;
  for (const { open, close } of THINKING_TAG_PAIRS) {
    const re = new RegExp(
      `${escapeRegExp(open)}[\\s\\S]*?${escapeRegExp(close)}`,
      "gi"
    );
    result = result.replace(re, "");
  }
  // Unclosed thought block (truncated stream): drop the remainder.
  for (const { open } of THINKING_TAG_PAIRS) {
    const idx = result.toLowerCase().indexOf(open.toLowerCase());
    if (idx !== -1) result = result.slice(0, idx);
  }
  // Bare "thinking" / "thinking..." residue left behind when a model emits
  // a reasoning dump with no tags at all.
  result = result
    .split("\n")
    .filter((line) => !/^\s*(thinking|reasoning|thought)s?\s*(\.\.\.|:)?\s*$/i.test(line))
    .join("\n");
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim().replace(/\*\*(.*?)\*\*/g, "$1"));
}

function looksLikeDivider(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

// ── Mixed rendering: preserve surrounding text instead of replacing whole message with table ──
export type ContentSegment =
  | { kind: "text"; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "table"; header: string[]; rows: string[][]; raw: string };

function tryParseTableAt(lines: string[], idx: number): { header: string[]; rows: string[][]; consumed: number; rawLines: string[] } | null {
  if (idx >= lines.length) return null;
  const line = lines[idx];
  if (!line.includes("|")) return null;
  const header = splitTableRow(line);
  if (header.length < 2) return null;

  let next = idx + 1;
  let dividerConsumed = false;
  if (next < lines.length && looksLikeDivider(lines[next])) {
    dividerConsumed = true;
    next += 1;
  }

  const rows: string[][] = [];
  const rawLines: string[] = [lines[idx]];
  if (dividerConsumed) rawLines.push(lines[idx + 1]);

  let cursor = next;
  while (cursor < lines.length) {
    const l = lines[cursor];
    if (!l.trim()) break; // blank line ends table
    if (!l.includes("|")) break;
    const row = splitTableRow(l);
    if (row.length < 2) break;
    // Require consistent column count (allow ±1 for forgiving)
    if (row.length < 2) break;
    rows.push(row);
    rawLines.push(l);
    cursor += 1;
  }

  if (rows.length === 0) return null;
  // Need at least header + 1 row; divider optional but if present we already consumed
  return { header, rows, consumed: rawLines.length, rawLines };
}

export function segmentMessageContent(text: string, streaming = false): ContentSegment[] {
  if (!text.trim()) return [];

  const segments: ContentSegment[] = [];
  const lines = text.split(/\r?\n/);
  let textBuffer: string[] = [];
  let inCode = false;
  let codeLang = "";
  let codeBuffer: string[] = [];

  const flushText = () => {
    if (textBuffer.length === 0) return;
    // Trim trailing empty lines but preserve internal structure
    const joined = textBuffer.join("\n").trim();
    if (joined) segments.push({ kind: "text", text: joined });
    textBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)/);

    if (fence) {
      if (!inCode) {
        flushText();
        inCode = true;
        codeLang = fence[1] || "";
        codeBuffer = [];
      } else {
        // close fence
        segments.push({ kind: "code", lang: codeLang, text: codeBuffer.join("\n") });
        inCode = false;
        codeLang = "";
        codeBuffer = [];
      }
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    // Try table detection at this line
    const tableTry = tryParseTableAt(lines, i);
    if (tableTry) {
      // During streaming, don't finalize a table that ends at EOF with no trailing newline/blank —
      // it might still be receiving rows. Hold it as text until complete.
      const isAtTail = i + tableTry.consumed >= lines.length;
      if (streaming && isAtTail && !text.trimEnd().endsWith("\n")) {
        // Incomplete tail — keep as text to avoid flicker where earlier text disappears
        // Wait until at least one more non-table line or stream-end flushes.
        // We still want to avoid flicker, so buffer it as text for now.
        // Only promote to table if we have a blank line after or there are >=2 rows (likely complete).
        if (tableTry.rows.length < 2) {
          textBuffer.push(line);
          continue;
        }
      }
      flushText();
      segments.push({ kind: "table", header: tableTry.header, rows: tableTry.rows, raw: tableTry.rawLines.join("\n") });
      i += tableTry.consumed - 1; // -1 because loop increments
      continue;
    }

    textBuffer.push(line);
  }

  if (inCode) {
    // Unclosed fence during streaming — show as code so far, don't lose content
    segments.push({ kind: "code", lang: codeLang, text: codeBuffer.join("\n") });
  } else {
    flushText();
  }

  return segments;
}

function findEarliestOpen(buffer: string): { index: number; tag: string } | null {
  let best: { index: number; tag: string } | null = null;
  const lower = buffer.toLowerCase();
  for (const { open } of THINKING_TAG_PAIRS) {
    const idx = lower.indexOf(open.toLowerCase());
    if (idx !== -1 && (best === null || idx < best.index)) {
      best = { index: idx, tag: open };
    }
  }
  return best;
}

function findEarliestClose(buffer: string): { index: number; tag: string } | null {
  let best: { index: number; tag: string } | null = null;
  const lower = buffer.toLowerCase();
  for (const { close } of THINKING_TAG_PAIRS) {
    const idx = lower.indexOf(close.toLowerCase());
    if (idx !== -1 && (best === null || idx < best.index)) {
      best = { index: idx, tag: close };
    }
  }
  return best;
}

/** Don't emit text that might be the start of a thinking tag. */
function holdbackPartialTag(buffer: string): number {
  const lastLt = buffer.lastIndexOf("<");
  if (lastLt === -1) return buffer.length;

  const tail = buffer.slice(lastLt).toLowerCase();
  for (const fragment of ALL_TAG_FRAGMENTS) {
    const frag = fragment.toLowerCase();
    if (frag.startsWith(tail) && tail.length < frag.length) {
      return lastLt;
    }
  }
  return buffer.length;
}

/**
 * Filters thinking blocks from streamed tokens so the UI never shows them.
 */
export class StreamingThinkingFilter {
  private buffer = "";
  private inThinking = false;

  push(chunk: string): string {
    if (!chunk) return "";
    this.buffer += chunk;
    return this.drainVisible();
  }

  flush(): string {
    if (this.inThinking) {
      this.buffer = "";
      this.inThinking = false;
      return "";
    }
    const rest = stripThinkingBlocks(this.buffer);
    this.buffer = "";
    return rest;
  }

  private drainVisible(): string {
    let visible = "";

    while (this.buffer.length > 0) {
      if (this.inThinking) {
        const close = findEarliestClose(this.buffer);
        if (!close) break;
        const end = close.index + close.tag.length;
        this.buffer = this.buffer.slice(end);
        this.inThinking = false;
        continue;
      }

      const open = findEarliestOpen(this.buffer);
      if (!open) {
        const emitLen = holdbackPartialTag(this.buffer);
        visible += this.buffer.slice(0, emitLen);
        this.buffer = this.buffer.slice(emitLen);
        break;
      }

      visible += this.buffer.slice(0, open.index);
      const afterOpen = open.index + open.tag.length;
      this.buffer = this.buffer.slice(afterOpen);
      this.inThinking = true;
    }

    return visible;
  }
}
