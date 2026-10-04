import { describe, expect, it } from "vitest";
import {
  applyCorrections,
  collectCorrectionRules,
  countCorrections,
  findCorrectionOwner,
} from "../dictionaryCorrections";
import { normalizeDictionaryEntry } from "../dictionary";
import type { DictionaryEntry } from "../types";

function entry(word: string, corrections: string[] = [], enabled = true): DictionaryEntry {
  return {
    id: word.toLowerCase(),
    word,
    enabled,
    createdAt: 0,
    updatedAt: 0,
    ...(corrections.length ? { corrections } : {}),
  };
}

describe("dictionary corrections", () => {
  it("replaces a known misspelling with the stored spelling", () => {
    const entries = [entry("Groq", ["grock", "grok"])];
    expect(applyCorrections("I queried grock today", entries)).toBe(
      "I queried Groq today",
    );
  });

  it("matches whole words only", () => {
    const entries = [entry("Git", ["get"])];
    expect(applyCorrections("I forgot my budget", entries)).toBe(
      "I forgot my budget",
    );
    expect(applyCorrections("please get going", entries)).toBe(
      "please Git going",
    );
  });

  it("ignores capitalization in the misspelling", () => {
    const entries = [entry("Kubernetes", ["kubernitz"])];
    expect(applyCorrections("Kubernitz is running", entries)).toBe(
      "Kubernetes is running",
    );
  });

  it("does not rewrite the stem of a contraction", () => {
    // The researched reference behaviour: a bare-word rule fixes "don" but
    // must never produce "don't" -> "Dawn't".
    const entries = [entry("Dawn", ["don"])];
    expect(applyCorrections("Don't be late", entries)).toBe("Don't be late");
    expect(applyCorrections("don the next one", entries)).toBe("Dawn the next one");
  });

  it("still corrects possessives", () => {
    const entries = [entry("Bob", ["john"])];
    expect(applyCorrections("john's car", entries)).toBe("Bob's car");
  });

  it("prefers the longest rule when two overlap", () => {
    const entries = [entry("Vue", ["view"]), entry("Vue Router", ["view router"])];
    expect(applyCorrections("setup view router", entries)).toBe("setup Vue Router");
  });

  it("supports multi-word corrections", () => {
    const entries = [entry("Visual Studio Code", ["vs code", "visual studio cord"])];
    expect(applyCorrections("open visual studio cord now", entries)).toBe(
      "open Visual Studio Code now",
    );
  });

  it("ignores disabled entries", () => {
    const entries = [entry("Groq", ["grock"], false)];
    expect(applyCorrections("grock", entries)).toBe("grock");
  });

  it("drops a rule identical to its target", () => {
    const entries = [entry("Groq", ["Groq", "grock"])];
    expect(collectCorrectionRules(entries)).toEqual([
      { misspelling: "grock", replacement: "Groq" },
    ]);
  });

  it("counts rules for the UI", () => {
    expect(countCorrections([entry("Groq", ["grock", "grok"])])).toBe(2);
    expect(countCorrections([entry("Groq")])).toBe(0);
  });

  it("finds which entry already claims a misspelling", () => {
    const entries = [entry("Groq", ["grock"]), entry("Git", ["grock"])];
    expect(findCorrectionOwner(entries, "GROCK")?.word).toBe("Groq");
    expect(findCorrectionOwner(entries, "grock", "groq")?.word).toBe("Git");
    expect(findCorrectionOwner(entries, "unknown")).toBeUndefined();
  });

  it("leaves text alone when there are no rules", () => {
    expect(applyCorrections("anything at all", [entry("Groq")])).toBe(
      "anything at all",
    );
  });

  it("treats a correction as regex metacharacters, not a pattern", () => {
    const entries = [entry("C++", ["C plus plus"])];
    expect(applyCorrections("I write C plus plus daily", entries)).toBe(
      "I write C++ daily",
    );
    const dotted = [entry("Node.js", ["node dot js"])];
    expect(applyCorrections("node dot js runs here", dotted)).toBe(
      "Node.js runs here",
    );
  });
});

describe("dictionary entries carrying corrections survive a round trip", () => {
  it("keeps corrections through normalization", () => {
    const normalized = normalizeDictionaryEntry({
      id: "x",
      word: "Groq",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
      corrections: ["grock", " Groq ", "grock", ""],
    });
    // Blank entries are dropped and a correction equal to the target is
    // meaningless, so only the genuine misspelling survives.
    expect(normalized?.corrections).toEqual(["grock"]);
  });

  it("omits the field entirely when there are none", () => {
    const normalized = normalizeDictionaryEntry({ word: "Groq" });
    expect(normalized && "corrections" in normalized).toBe(false);
  });
});