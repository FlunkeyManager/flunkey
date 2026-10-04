import { describe, expect, it } from "vitest";
import {
  isUnusablePolishResult,
  looksLikeChatReply,
} from "../refusalGuard";

/**
 * The guard has to reject AI replies without rejecting good dictation.
 * A false positive here is worse than the bug: the user's own words would be
 * thrown away and replaced by the raw transcript. These are the shapes that
 * must survive.
 */
describe("legitimate dictation is never rejected", () => {
  it("keeps a normal polish", () => {
    expect(
      isUnusablePolishResult(
        "Hello, my name is John.",
        "um hello uh my name is john",
      ),
    ).toBe(false);
  });

  it("keeps a punctuated question as a question", () => {
    expect(
      isUnusablePolishResult(
        "What is the capital of France?",
        "what is the capital of france",
      ),
    ).toBe(false);
  });

  it('keeps dictation that itself opens with "Sure"', () => {
    // The opener check must not fire on the speaker's own word.
    expect(
      isUnusablePolishResult(
        "Sure, that works for me. I will send it tomorrow.",
        "sure that works for me i will send it tomorrow",
      ),
    ).toBe(false);
  });

  it("keeps dictation that says it cannot come", () => {
    // "I can't come today" must never trip the refusal check.
    expect(
      isUnusablePolishResult("I can't come today.", "i cant come today"),
    ).toBe(false);
  });

  it("keeps an instruction to a person, not a claim of having done it", () => {
    expect(
      isUnusablePolishResult(
        "I have scheduled the meeting for tomorrow at ten.",
        "i have scheduled the meeting for tomorrow at ten",
      ),
    ).toBe(false);
  });

  it("keeps a longer dictation that expands only slightly", () => {
    const original =
      "so anyway the meeting moved to friday at three instead of thursday " +
      "let me know if that works for everyone on the team";
    expect(
      isUnusablePolishResult(
        "So anyway, the meeting moved to Friday at three instead of Thursday. " +
          "Let me know if that works for everyone on the team.",
        original,
      ),
    ).toBe(false);
  });

  it("keeps an email laid out from spoken greeting and sign-off cues", () => {
    expect(
      looksLikeChatReply(
        "Hi Bob,\n\nCould you send the invoice for $200 today?\n\nRegards,\nJane",
        "hi bob could you send the invoice for 200 today regards jane",
      ),
    ).toBe(false);
  });

  it("keeps dictation that names a language the speaker switched to", () => {
    expect(
      isUnusablePolishResult(
        "Bonjour, je m'appelle Jean. Je travaille sur le projet demain.",
        "bonjour je m'appelle jean je travaille sur le projet demain",
      ),
    ).toBe(false);
  });

  it("keeps a request for a list, which legitimately expands", () => {
    // A rewrite pass may legitimately produce more text; only *invention*
    // signals a reply.
    expect(
      looksLikeChatReply(
        "Please review the attached document and send feedback by Friday.",
        "please review the attached document and send feedback by friday",
      ),
    ).toBe(false);
  });
});