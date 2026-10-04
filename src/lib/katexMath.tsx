import katex from "katex";
import "katex/dist/katex.min.css";

export function renderKatex(math: string, display: boolean): string {
  try {
    return katex.renderToString(math, {
      throwOnError: false,
      displayMode: display,
      strict: false,
      trust: true,
    });
  } catch {
    return `<code>${math}</code>`;
  }
}

// Split text by display math delimiters: \[ ... \] and $$ ... $$
const DISPLAY_RE = /\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$/g;

export type DisplaySplit = { kind: "text"; text: string } | { kind: "display"; math: string };

export function splitByDisplayMath(text: string): DisplaySplit[] {
  const out: DisplaySplit[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(DISPLAY_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    const raw = m[0];
    let inner = raw;
    if (raw.startsWith("\\[")) inner = raw.slice(2, -2);
    else if (raw.startsWith("$$")) inner = raw.slice(2, -2);
    out.push({ kind: "display", math: inner });
    last = m.index + raw.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out.length ? out : [{ kind: "text", text }];
}

// Split by inline math: \( ... \) and $ ... $ (single dollar, not $$)
// Must be called after display math has been extracted
const INLINE_RE = /\\\(.*?\\\)|\$[^$\n]+?\$/gs;

export type InlineSplit = { kind: "text"; text: string } | { kind: "inline"; math: string };

export function splitByInlineMath(text: string): InlineSplit[] {
  const out: InlineSplit[] = [];
  let last = 0;
  const re = new RegExp(INLINE_RE.source, "gs");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    const raw = m[0];
    let inner = raw;
    if (raw.startsWith("\\(")) inner = raw.slice(2, -2);
    else if (raw.startsWith("$")) inner = raw.slice(1, -1);
    out.push({ kind: "inline", math: inner });
    last = m.index + raw.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out.length ? out : [{ kind: "text", text }];
}
