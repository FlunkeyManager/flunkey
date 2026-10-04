import { describe, expect, it } from "vitest";
import { sanitizeDictationOutput } from "../dictationOutput";

describe("dictation output cleaning", () => {
  it("keeps a clean transcript untouched", () => {
    const t = "Hello, my name is John. I'll see you tomorrow.";
    expect(sanitizeDictationOutput(t)).toBe(t);
  });

  it("drops a single-line preamble and keeps the dictation", () => {
    expect(
      sanitizeDictationOutput(
        "Here's the polished version: Please send the invoice today.",
      ),
    ).toBe("Please send the invoice today.");
  });

  it("drops stacked preamble lines", () => {
    expect(
      sanitizeDictationOutput("Sure!\nHere's the cleaned text:\nShip it today."),
    ).toBe("Ship it today.");
  });

  it("unwraps a reply fenced as a code block", () => {
    expect(
      sanitizeDictationOutput("```text\nShip it today.\n```"),
    ).toBe("Ship it today.");
  });

  it("removes bold, italics, headings and bullets", () => {
    expect(
      sanitizeDictationOutput("**Important:** call Bob _before_ Friday.\n- first\n- second"),
    ).toBe("Important: call Bob before Friday.\nfirst\nsecond");
  });

  it("keeps inline code spans, which dictation can genuinely contain", () => {
    expect(sanitizeDictationOutput("Run `pnpm install` first.")).toBe(
      "Run `pnpm install` first.",
    );
  });

  it("keeps code the user actually dictated", () => {
    const code = "const total = price * quantity;\nreturn total;";
    expect(sanitizeDictationOutput(code)).toBe(code);
  });

  it("drops a chat sign-off", () => {
    expect(
      sanitizeDictationOutput("Let me know if you need anything else."),
    ).toBe("");
    expect(
      sanitizeDictationOutput("Ship it today.\nI hope this helps!"),
    ).toBe("Ship it today.");
  });

  it("removes wrapping quotes around a full sentence", () => {
    expect(sanitizeDictationOutput('"The meeting moved to Friday."')).toBe(
      "The meeting moved to Friday.",
    );
  });

  it("does not unwrap quotes that are part of the sentence", () => {
    const t = 'He said "ship it" and that was that.';
    expect(sanitizeDictationOutput(t)).toBe(t);
  });

  it("returns empty when there were no dictated words to begin with", () => {
    // The caller must fall back to the raw transcript for these. Pasting the
    // framing is the bug; pasting nothing is handled by the no-text guard.
    for (const input of ["```\n```", "***", "```\n```\nHope this helps"]) {
      expect(sanitizeDictationOutput(input)).toBe("");
    }
  });

  it("keeps a multiplication sign in dictated maths", () => {
    expect(sanitizeDictationOutput("2 * 3 * 4 equals twenty four")).toBe(
      "2 * 3 * 4 equals twenty four",
    );
  });

  it("keeps snake_case identifiers intact", () => {
    expect(
      sanitizeDictationOutput("Rename max_retry_count to retry_budget."),
    ).toBe("Rename max_retry_count to retry_budget.");
  });

  it("preserves a multi-paragraph email layout", () => {
    const email = "Hi Bob,\n\nCan you send the invoice today?\n\nRegards,\nJane";
    expect(sanitizeDictationOutput(email)).toBe(email);
  });
});