import { describe, expect, it } from "vitest";
import { isUnusablePolishResult } from "../refusalGuard";

/**
 * These are the exact failure modes reported in the field: a chat model
 * answering the dictated request instead of editing it, and the reply being
 * pasted into the user's focused app. Each case below was accepted by the
 * previous implementation.
 */
describe("F8 polish output must never be an AI reply", () => {
  it("rejects 'Sure! Here's a polished version' + invented email", () => {
    expect(
      isUnusablePolishResult(
        "Sure! Here's a polished version:\n\nHi Bob,\n\nCould you please send the invoice for $200?",
        "hey send an email to bob about the invoice for 200 dollars",
      ),
    ).toBe(true);
  });

  it("rejects a model that answered the dictated question", () => {
    expect(
      isUnusablePolishResult(
        "The capital of France is Paris.",
        "what is the capital of france",
      ),
    ).toBe(true);
  });

  it("rejects 'Certainly! Here is a summary' for a long original", () => {
    // The old 12-word guard skipped originals longer than 12 words entirely.
    const original =
      "can you summarise the meeting notes for me in three bullets please " +
      "and send them to the team channel before the end of the day";
    expect(original.split(/\s+/).length).toBeGreaterThan(12);
    expect(
      isUnusablePolishResult(
        "Certainly! Here is a summary of your meeting notes:\n\n" +
          "- Discussed the roadmap\n- Agreed on deadlines\n- Assigned owners",
        original,
      ),
    ).toBe(true);
  });

  it("rejects a model that claims it performed the action", () => {
    expect(
      isUnusablePolishResult(
        "Sure thing! I've scheduled a meeting with Alice for tomorrow at 10:00 AM. " +
          "Let me know if you need anything else!",
        "um schedule a meeting with alice tomorrow at ten",
      ),
    ).toBe(true);
  });
});