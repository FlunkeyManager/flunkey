import { describe, expect, it } from "vitest";
import { resolveAppInstructions } from "../appInstructions";
import { buildDictationPrompt } from "../dictationPrompt";
import { DEFAULT_SETTINGS } from "../types";
import type { UserSettings } from "../types";

function settings(patch: Partial<UserSettings> = {}): UserSettings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

describe("per-application instructions", () => {
  it("falls back to the shipped default for that application", () => {
    expect(
      resolveAppInstructions(settings(), "vscode", "Preserve code identifiers"),
    ).toContain("APPLICATION-SPECIFIC INSTRUCTIONS:\nPreserve code identifiers");
  });

  it("combines the global instruction with the app's shipped default", () => {
    const s = settings({ dictationInstructions: "Use British spelling." });
    const resolved = resolveAppInstructions(
      s,
      "vscode",
      "Preserve code identifiers",
    );
    expect(resolved).toContain("STANDING INSTRUCTIONS:\nUse British spelling.");
    expect(resolved).toContain(
      "APPLICATION-SPECIFIC INSTRUCTIONS:\nPreserve code identifiers",
    );
  });

  it("combines global instructions with the app override instead of its default", () => {
    const s = settings({
      dictationInstructions: "Use British spelling.",
      appInstructions: { vscode: "Keep commit messages lowercase." },
    });
    const resolved = resolveAppInstructions(s, "vscode", "Preserve code identifiers");
    expect(resolved).toContain("Use British spelling.");
    expect(resolved).toContain("Keep commit messages lowercase.");
    expect(resolved).not.toContain("Preserve code identifiers");
    expect(
      resolveAppInstructions(s, "notepad", "default"),
    ).toContain("APPLICATION-SPECIFIC INSTRUCTIONS:\ndefault");
  });

  it("ignores a blank override, which means 'use the default'", () => {
    const s = settings({ appInstructions: { vscode: "   " } });
    expect(
      resolveAppInstructions(s, "vscode", "Preserve code identifiers"),
    ).toContain("APPLICATION-SPECIFIC INSTRUCTIONS:\nPreserve code identifiers");
  });

  it("does not leak an override from one application into another", () => {
    const s = settings({ appInstructions: { terminal: "Spell out CLI flags." } });
    const resolved = resolveAppInstructions(s, "browser", "Plain text");
    expect(resolved).toContain("APPLICATION-SPECIFIC INSTRUCTIONS:\nPlain text");
    expect(resolved).not.toContain("Spell out CLI flags.");
  });
});

describe("the cleanup prompt carries the resolved application context", () => {
  // Enhanced is the only level that reads these; `light` ignoring them is
  // pinned in dictationLevels.test.ts.
  it("includes the application instruction", () => {
    const prompt = buildDictationPrompt({
      style: "enhanced",
      appSuffix: "Keep commit messages lowercase.",
    });
    expect(prompt).toContain("Keep commit messages lowercase.");
  });

  it("passes both standing and app-specific prompts into Enhanced", () => {
    const resolved = resolveAppInstructions(
      settings({
        dictationInstructions: "Use British spelling.",
        appInstructions: { copilot: "Expand requests into detailed prompts." },
      }),
      "copilot",
      "Use plain single-block text.",
    );
    const prompt = buildDictationPrompt({
      style: "enhanced",
      appSuffix: resolved,
    });
    expect(prompt).toContain("Use British spelling.");
    expect(prompt).toContain("Expand requests into detailed prompts.");
    expect(prompt).not.toContain("Use plain single-block text.");
  });

  it("tells the model the prompt is the governing instruction", () => {
    const prompt = buildDictationPrompt({
      style: "enhanced",
      appSuffix: "Write like a pirate.",
    });
    expect(prompt).toContain("Write like a pirate.");
    expect(prompt).toMatch(/Follow all applicable instructions/i);
  });

  it("keeps every prohibition clause at every AI level", () => {
    // The bug these guard against: the language and Groq variants used to
    // drop the rules and examples, and that is exactly where the model starts
    // answering instead of editing.
    for (const style of ["light", "enhanced"] as const) {
      for (const languageName of ["", "Hindi"]) {
        const prompt = buildDictationPrompt({ style, languageName });
        expect(prompt).toContain("TRANSCRIPTION EDITOR");
        expect(prompt).toContain("NEVER:");
        expect(prompt).toMatch(/never a request/i);
        if (style === "enhanced") {
          expect(prompt).toContain("EXAMPLES:");
        } else {
          expect(prompt).toContain("Choose the output shape");
        }
        expect(prompt).toMatch(/claim to have performed/i);
        expect(prompt).toMatch(
          /Return.*transcript|Return the corrected text|finished text/i,
        );
      }
    }
  });

  it("emits no separate tidying block any more", () => {
    // Tidying folded into the light contract itself, so the old heading is gone
    // rather than being conditionally included.
    for (const style of ["light", "enhanced"] as const) {
      expect(buildDictationPrompt({ style })).not.toMatch(/SENTENCE TIDYING/);
    }
  });

  it("says the same thing whatever the language", () => {
    const english = buildDictationPrompt({ style: "light", languageName: "English" });
    const hindi = buildDictationPrompt({ style: "light", languageName: "Hindi" });
    // Only the scope sentence should differ.
    const strip = (p: string) => p.replace(/^.*$/gm, "").trim();
    expect(strip(english)).toBe(strip(hindi));
  });
});