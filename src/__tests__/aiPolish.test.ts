import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiTranscribe, polishTranscription } from "../ai";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dictation polish requests", () => {
  it("asks Gemini transcription to preserve words in Verbatim mode", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "um George, sorry, Manny" }] } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await geminiTranscribe("test-key", new Blob(["audio"]), {
      model: "gemini-2.5-flash",
      verbatim: true,
      vocabHint: "This must not be sent",
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));
    const instruction = body.contents[0].parts[0].text as string;
    expect(instruction).toContain("preserving fillers, repetitions, false starts");
    expect(instruction).toContain("both sides of self-corrections");
    expect(instruction).not.toContain("This must not be sent");
  });

  it("sends Enhanced instructions to Gemini even for short transcripts", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: "A polished short response." }] } },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await polishTranscription({
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-2.5-flash",
      text: "Hi.",
      vocabRules: "",
      style: "enhanced",
      appSuffix:
        "STANDING INSTRUCTIONS:\nUse British spelling.\n\nAPPLICATION-SPECIFIC INSTRUCTIONS:\nExpand this into a detailed prompt.",
    });

    expect(result).toBe("A polished short response.");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    const body = JSON.parse(String(init?.body));
    const systemPrompt = body.system_instruction.parts[0].text as string;
    expect(systemPrompt).toContain("Use British spelling.");
    expect(systemPrompt).toContain("Expand this into a detailed prompt.");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the built-in Light prompt without custom instructions", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Good morning." }] } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await polishTranscription({
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-2.5-flash",
      text: "yeah hello there sorry good morning",
      vocabRules: "",
      style: "light",
      appSuffix: "Do not include this instruction.",
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));
    const systemPrompt = body.system_instruction.parts[0].text as string;
    expect(systemPrompt).toContain("Remove fillers, stutters");
    expect(systemPrompt).not.toContain("Do not include this instruction.");
  });
});
