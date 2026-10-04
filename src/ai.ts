/**
 * ai.ts — Bring-your-own-key multi-provider chat for F9 / F10.
 *
 * Providers: Groq + OpenAI (OpenAI-compatible `/chat/completions` with
 * SSE streaming) and Gemini (`:generateContent`, single response handed
 * to onToken once so overlay callers work unchanged).
 *
 * Whisper transcription stays Groq-only (src/groq.ts).
 */
import { StreamingThinkingFilter, stripThinkingBlocks } from "./responseSanitizer";
import { isUnusablePolishResult } from "./refusalGuard";
import { buildDictationPrompt } from "./dictationPrompt";
import type { DictationFormat } from "./dictationFormatting";
import { STT_LANGUAGES } from "./types";
import type { AiProvider, DictationStyle } from "./types";

export type AiChatMessage = {
  role: "user" | "assistant";
  content:
    | string
    | (
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      )[];
};

const GROQ_BASE = "https://api.groq.com/openai/v1";
const OPENAI_BASE = "https://api.openai.com/v1";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/** Free models regularly take 30s+; this is the hard ceiling, not a target. */
const CHAT_TIMEOUT_MS = 90_000;
/**
 * Hold back the opening of a stream until it is provably not a refusal
 * stub. OpenRouter answers some moderation hits with HTTP 200 and a body of
 * "User Safety: safe" — buffering lets us retry with a fallback model
 * before a single junk token reaches the overlay.
 */
const OPENING_HOLD_CHARS = 24;
const OPENING_HOLD_MS = 1500;

/** Replies that mean "the model refused / was blocked", not an answer. */
const DEGENERATE_PATTERNS: RegExp[] = [
  /^\s*user\s+safety\b/i,
  /^\s*safety\s*[:\-]/i,
  /^\s*i\s*(?:can(?:'|’)t|am\s+unable\s+to|cannot)\s+(?:assist|help|comply|provide|answer)/i,
  /^\s*(?:i\s*'m\s*sorry|sorry,?\s+i)/i,
  /^\s*thinking\s*[:\-]?\s*$/i,
  /^\s*(?:as\s+an\s+ai|i\s*am\s+an\s+ai)/i,
];

function isDegenerateReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.length > 120) return false;
  return DEGENERATE_PATTERNS.some((re) => re.test(t));
}

/** Turn an upstream status into something a person can act on. */
function describeChatError(status: number, body: string): string {
  let detail = "";
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; metadata?: { error_type?: string } };
      message?: string;
    };
    detail =
      parsed.error?.metadata?.error_type ||
      parsed.error?.message ||
      parsed.message ||
      "";
  } catch {
    detail = body.slice(0, 180);
  }
  const suffix = detail ? ` (${detail})` : "";
  if (status === 401) return `OpenRouter rejected the key${suffix}. Check it in Models.`;
  if (status === 402) return `Your OpenRouter account is out of credits${suffix}.`;
  if (status === 403) return `OpenRouter blocked this request (moderation or permissions)${suffix}.`;
  if (status === 408) return `The model timed out before answering${suffix}.`;
  if (status === 429) return `Rate limited by OpenRouter${suffix}. Try again in a moment.`;
  if (status === 502) return `The model returned an empty or invalid response${suffix}.`;
  if (status === 503) return `No OpenRouter provider is available for that model right now${suffix}.`;
  return `OpenRouter error ${status}${suffix}`;
}

type OpenAICompatibleOptions = {
  /** OpenRouter-only: server-side fallback models, tried in order. */
  fallbacks?: string[];
  /** Called when the first tokens take longer than this (free models). */
  onSlowStart?: () => void;
  /** Per-call ceiling; defaults to CHAT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Set for Ollama so a dead local server reports itself, not "Failed to fetch". */
  localBaseUrl?: string;
};

async function streamOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  conversation: AiChatMessage[],
  temperature: number,
  onToken: (token: string) => void,
  opts: OpenAICompatibleOptions = {}
): Promise<string> {
  const isOpenRouter = baseUrl === OPENROUTER_BASE;

  // OpenRouter reroutes on moderation, downtime, 429 and context-length
  // errors when given an ordered list. Ours: primary first, then fallbacks.
  const modelChain = isOpenRouter
    ? [model, ...(opts.fallbacks ?? []).filter((m) => m && m !== model)].slice(0, 4)
    : [model];

  let lastError: Error | null = null;
  for (const attemptModel of modelChain) {
    try {
      return await runChatAttempt(
        baseUrl,
        apiKey,
        attemptModel,
        systemPrompt,
        conversation,
        temperature,
        onToken,
        isOpenRouter,
        opts
      );
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      // Mid-stream: tokens already reached the user, so retrying would
      // duplicate text. Report honestly instead.
      if (lastError.message.startsWith("__STREAMED__")) {
        throw new Error(lastError.message.replace("__STREAMED__", ""));
      }
      if (lastError.message === "__DEGENERATE__") {
        lastError = new Error(
          `The model refused that request.${modelChain.length > 1 ? " Tried the fallback model too." : ""}`
        );
      }
      console.warn(`Chat attempt with ${attemptModel} failed:`, lastError.message);
    }
  }
  throw lastError ?? new Error("The request failed.");
}

async function runChatAttempt(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  conversation: AiChatMessage[],
  temperature: number,
  onToken: (token: string) => void,
  isOpenRouter: boolean,
  opts: OpenAICompatibleOptions
): Promise<string> {
  const controller = new AbortController();
  // The abort is what actually stops a stalled request, so short budgets
  // (grammar polish) are honoured here rather than only upstream.
  const budgetMs = opts.timeoutMs ?? CHAT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), budgetMs);
  const startedAt = Date.now();
  let slowNotified = false;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // App attribution (documented HTTP-Referer/X-Title convention —
        // plain `Referer` is a forbidden fetch header, these are not).
        ...(isOpenRouter
          ? { "HTTP-Referer": "https://flunkey.app", "X-Title": "Flunkey" }
          : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...conversation,
        ],
        temperature,
        stream: true,
        ...(isOpenRouter
          ? {
              // Reasoning tokens should never be billed: hide them entirely.
              reasoning: { exclude: true },
              // Only route to providers that accept every parameter we send —
              // this is what makes image input actually reach a vision model
              // instead of being dropped by a text-only provider.
              provider: { require_parameters: true },
            }
          : {}),
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error)?.name === "AbortError") {
      throw new Error(
        `${model} took longer than ${Math.round(budgetMs / 1000)}s and was stopped.`
      );
    }
    // A local server that isn't up rejects the fetch itself — say so instead
    // of leaking "Failed to fetch".
    if (e instanceof TypeError && opts.localBaseUrl) {
      throw new Error(
        `Can't reach Ollama at ${opts.localBaseUrl} — is it running?`
      );
    }
    throw e instanceof Error ? e : new Error(String(e));
  }

  try {
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      if (isOpenRouter) throw new Error(describeChatError(res.status, err));
      throw new Error(`Chat error ${res.status}: ${err.slice(0, 200)}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let rawFull = "";
    let sseBuffer = "";
    let finishReason: string | null = null;
    let streamedAny = false;
    const thinkingFilter = new StreamingThinkingFilter();
    // Refusal check runs on the opening of the stream only.
    let opening = "";
    let openingDone = false;
    const openingStartedAt = Date.now();

    const flushOpening = (): boolean => {
      if (openingDone) return true;
      openingDone = true;
      if (isDegenerateReply(opening)) return false;
      if (opening) {
        onToken(opening);
        streamedAny = true;
      }
      return true;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (
        !slowNotified &&
        opts.onSlowStart &&
        Date.now() - startedAt > OPENING_HOLD_MS
      ) {
        slowNotified = true;
        opts.onSlowStart();
      }

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";

      for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") continue;

          try {
            const parsed = JSON.parse(payload);
            // OpenRouter can deliver a provider-side error mid-stream.
            const streamErr = parsed.error ?? parsed.choices?.[0]?.error;
            if (streamErr) {
              const msg =
                typeof streamErr === "string"
                  ? streamErr
                  : streamErr?.message ?? JSON.stringify(streamErr);
              throw new Error(
                `${streamedAny ? "__STREAMED__" : ""}Provider error: ${msg}`
              );
            }
            const delta = parsed.choices?.[0]?.delta;
            // Reasoning fields (reasoning / reasoning_content / reasoning_details)
            // are never content — some models otherwise leak "thinking" text.
            const token =
              typeof delta?.content === "string" ? delta.content : undefined;
            if (token) {
              rawFull += token;
              const visible = thinkingFilter.push(token);
              if (!visible) continue;
              if (!openingDone) {
                opening += visible;
                const settled =
                  opening.length >= OPENING_HOLD_CHARS ||
                  Date.now() - openingStartedAt > OPENING_HOLD_MS;
                if (settled && !flushOpening()) {
                  throw new Error("__DEGENERATE__");
                }
              } else {
                onToken(visible);
                streamedAny = true;
              }
            }
            const finish = parsed.choices?.[0]?.finish_reason;
            if (finish && finish !== "stop" && finish !== "tool_calls") {
              finishReason = finish;
            }
          } catch (e) {
            if (
              e instanceof Error &&
              (e.message.startsWith("Provider error") ||
                e.message === "__DEGENERATE__")
            ) {
              throw e;
            }
            // skip malformed chunks
          }
      }
    }

    // Stream ended before the hold released — release it now.
    if (!openingDone && !flushOpening()) {
      throw new Error("__DEGENERATE__");
    }
    const tail = thinkingFilter.flush();
    if (tail) onToken(tail);

    const clean = stripThinkingBlocks(rawFull).trim();
    if (!clean) {
      if (finishReason === "length") {
        throw new Error(
          "The model used its whole budget on internal reasoning — try a non-reasoning model or a shorter question."
        );
      }
      throw new Error(
        "The model returned no answer. It may be unavailable on the free tier — try another model."
      );
    }
    if (isDegenerateReply(clean)) {
      throw new Error("__DEGENERATE__");
    }

    return clean;
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(
        `${model} took longer than ${Math.round(budgetMs / 1000)}s and was stopped.`
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function geminiComplete(
  apiKey: string,
  model: string,
  systemPrompt: string,
  conversation: AiChatMessage[],
  temperature: number,
  onToken: (token: string) => void,
  timeoutMs = CHAT_TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: conversation.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts:
              typeof m.content === "string"
                ? [{ text: m.content }]
                : m.content.map((part) => {
                    if (part.type === "text") return { text: part.text };
                    const match = part.image_url.url.match(
                      /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i
                    );
                    if (!match) {
                      throw new Error("Screenshot must be a base64 image data URL");
                    }
                    return {
                      inline_data: { mime_type: match[1], data: match[2] },
                    };
                  }),
          })),
          generationConfig: { temperature },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .map((p: { text?: string }) => (typeof p.text === "string" ? p.text : ""))
      .join("");
    const clean = stripThinkingBlocks(text.trim());
    if (clean) onToken(clean);
    return clean;
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(
        `${model} took longer than ${Math.round(timeoutMs / 1000)}s and was stopped.`
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * OpenAI speech-to-text (`whisper-1` / `gpt-4o-mini-transcribe` /
 * `gpt-4o-transcribe`). Same multipart shape as Whisper: file + model +
 * language + prompt (all three accept the vocab-bias prompt, json out).
 */
export async function openaiTranscribe(
  apiKey: string,
  audioBlob: Blob,
  opts: { model: string; prompt?: string; language?: string } = { model: "gpt-4o-mini-transcribe" }
): Promise<string> {
  const formData = new FormData();
  formData.append("file", audioBlob, "recording.webm");
  formData.append("model", opts.model);
  if (opts.language && opts.language.trim()) {
    formData.append("language", opts.language.trim());
  }
  if (opts.prompt && opts.prompt.trim()) {
    formData.append("prompt", opts.prompt.trim());
  }

  const res = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI transcription error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return ((data.text ?? "") as string).trim();
}

function partsText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => {
      const t = (p as { text?: unknown })?.text;
      return typeof t === "string" ? t : "";
    })
    .join("")
    .trim();
}

/**
 * Targeted transcript extraction — only transcript-bearing shapes, never
 * a blind walk (which would scoop up "STOP", role names, model ids):
 * 1. generateContent: candidates[0].content.parts[].text
 * 2. Interactions API: output[] items ({ type: text/transcript, text }),
 *    top-level transcript / output_text / text strings.
 */
function extractGeminiText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const root = data as Record<string, unknown>;

  const fast = partsText(
    (root.candidates as { content?: { parts?: unknown } }[])?.[0]?.content?.parts
  );
  if (fast) return fast;

  const texts: string[] = [];
  const out = root.output;
  if (Array.isArray(out)) {
    for (const item of out) {
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const kind = rec.type;
        if (
          typeof rec.text === "string" &&
          (kind === undefined || kind === "text" || kind === "transcript")
        ) {
          texts.push(rec.text);
        }
      } else if (typeof item === "string") {
        texts.push(item);
      }
    }
  }
  for (const k of ["transcript", "output_text", "text"]) {
    if (typeof root[k] === "string") texts.push(root[k] as string);
  }
  const nested = root.response ?? root.data ?? root.result;
  if (nested && typeof nested === "object") {
    const rec = nested as Record<string, unknown>;
    for (const k of ["transcript", "output_text", "text"]) {
      if (typeof rec[k] === "string") texts.push(rec[k] as string);
    }
    if (Array.isArray(rec.output)) {
      for (const item of rec.output) {
        const t = (item as { text?: unknown })?.text;
        if (typeof t === "string") texts.push(t);
      }
    }
  }
  return [...new Set(texts.map((t) => t.trim()))].filter(Boolean).join(" ").trim();
}

/**
 * Gemini speech-to-text, two engines:
 * - Chat model (default): native audio understanding via `generateContent`
 *   + inline `audio/webm` (20MB cap — clips are tiny). The instruction
 *   carries vocab bias AND cleanup, so one call transcribes + polishes.
 * - Dedicated (`gemini-3.5-transcribe` or custom id): Interactions API
 *   (`/v1beta/interactions`), same vocab/cleanup instruction, response
 *   parsed defensively across known shapes.
 */
export async function geminiTranscribe(
  apiKey: string,
  audioBlob: Blob,
  opts: {
    model: string;
    vocabHint?: string;
    dedicated?: boolean;
    language?: string;
    verbatim?: boolean;
  } = { model: "gemini-2.5-flash" }
): Promise<string> {
  const base64Audio = await blobToBase64(audioBlob);
  const vocabBlock = !opts.verbatim && opts.vocabHint && opts.vocabHint.trim()
    ? `\nVocabulary — when you hear these, use these exact spellings: ${opts.vocabHint.trim()}`
    : "";
  const STT_LABELS: Record<string, string> = {
    en: "English", hi: "Hindi", ta: "Tamil", te: "Telugu", bn: "Bengali",
    mr: "Marathi", gu: "Gujarati", kn: "Kannada", ml: "Malayalam", pa: "Punjabi",
    es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese",
    ru: "Russian", ja: "Japanese", ko: "Korean", zh: "Chinese", ar: "Arabic",
    nl: "Dutch", sv: "Swedish", pl: "Polish", tr: "Turkish", vi: "Vietnamese",
    th: "Thai", id: "Indonesian", uk: "Ukrainian", ur: "Urdu", fa: "Persian",
  };
  const langName = opts.language ? (STT_LABELS[opts.language] ?? opts.language) : "";
  const instruction =
    (opts.verbatim
      ? "Transcribe every audible word as spoken, preserving fillers, repetitions, false starts, and both sides of self-corrections. Do not clean up, correct grammar, or rewrite; add punctuation only as needed. "
      : "Transcribe the following audio recording into clean written text. " +
        "Remove filler words (um, uh, er, ah) and false starts. " +
        "Fix capitalization and punctuation. " +
        'If the speaker corrects themselves ("X, sorry, Y"), keep only the final version Y.') +
    " Output ONLY the transcript, no preamble or explanation." +
    (langName ? ` The audio is in ${langName} — transcribe in ${langName}.` : "") +
    vocabBlock;
  const mimeType = audioBlob.type || "audio/webm";

  if (opts.dedicated) {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          model: opts.model,
          input: [
            { type: "text", text: instruction },
            { type: "audio", data: base64Audio, mime_type: mimeType },
          ],
        }),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini transcription error ${res.status}: ${err}`);
    }
    return extractGeminiText(await res.json());
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [
          { parts: [{ text: instruction }] },
          {
            inlineData: {
              mimeType,
              data: base64Audio,
            },
          },
        ],
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini transcription error ${res.status}: ${err}`);
  }

  return extractGeminiText(await res.json());
}

function looksLikeAnswer(
  candidate: string,
  original: string,
  allowExpansion = false,
  allowStructuredOutput = false,
): boolean {
  return isUnusablePolishResult(
    candidate,
    original,
    allowExpansion,
    allowStructuredOutput,
  );
}

/**
 * Grammar polish through the active provider. Callers handle failures by
 * reporting them and falling back to the untouched transcript.
 */
export async function polishTranscription(args: {
  provider: AiProvider;
  apiKey: string;
  model: string;
  text: string;
  vocabRules: string;
  /** Combined standing and active-application instructions in Enhanced mode. */
  appSuffix?: string;
  /** Light-mode output shape inferred from transcript cues and destination. */
  format?: DictationFormat;
  /** Active application id, used to select code fencing. */
  appId?: string;
  /** STT language code; when set, a language-preserving prompt is used. */
  language?: string;
  /** How much cleanup to apply. */
  style?: Exclude<DictationStyle, "verbatim">;
  /** Ollama: local server base URL. */
  baseUrl?: string;
}): Promise<string> {
  const text = args.text.trim();
  if (!args.apiKey || !text) return args.text;

  const lang = args.language?.trim();
  const langName = lang
    ? (STT_LANGUAGES.find((l) => l.code === lang)?.label ?? lang)
    : "";
  const systemPrompt = buildDictationPrompt({
    language: lang,
    languageName: langName,
    style: args.style === "enhanced" ? "enhanced" : "light",
    vocabRules: args.vocabRules,
    appSuffix: args.appSuffix,
    format: args.format,
    appId: args.appId,
  });

  const POLISH_TIMEOUT_MS = 15_000;
  const clean = (
    await chatCompletion({
      provider: args.provider,
      apiKey: args.apiKey,
      model: args.model,
      baseUrl: args.baseUrl,
      systemPrompt,
      messages: [{ role: "user", content: text }],
      temperature: 0,
      timeoutMs: POLISH_TIMEOUT_MS,
      onToken: () => {},
    })
  ).trim();

  const allowExpansion = args.style === "enhanced";
  const allowStructuredOutput =
    args.style === "light" && args.format === "code";
  if (
    !clean ||
    looksLikeAnswer(clean, text, allowExpansion, allowStructuredOutput)
  ) {
    return args.text;
  }
  return clean;
}

export async function chatCompletion(args: {
  provider: AiProvider;
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: AiChatMessage[];
  temperature?: number;
  onToken: (token: string) => void;
  /** OpenRouter: models to try in order if the primary fails. */
  fallbacks?: string[];
  /** Fires once when the first tokens are slow (free/local models). */
  onSlowStart?: () => void;
  /** Ollama: the local server's OpenAI-compatible base. */
  baseUrl?: string;
  /**
   * Hard ceiling for this call. The polish path passes a few seconds so a
   * local model cold-start can never delay a paste; F9/F10 use the default.
   */
  timeoutMs?: number;
}): Promise<string> {
  const temperature = args.temperature ?? 0.2;
  if (args.provider === "gemini") {
    return geminiComplete(
      args.apiKey,
      args.model,
      args.systemPrompt,
      args.messages,
      temperature,
      args.onToken,
      args.timeoutMs,
    );
  }
  if (args.provider === "ollama") {
    const localBase = `${(args.baseUrl ?? "http://localhost:11434").replace(/\/+$/, "")}`;
    return streamOpenAICompatible(
      `${localBase}/v1`,
      args.apiKey || "ollama",
      args.model,
      args.systemPrompt,
      args.messages,
      temperature,
      args.onToken,
      {
        onSlowStart: args.onSlowStart,
        timeoutMs: args.timeoutMs,
        localBaseUrl: localBase,
      }
    );
  }
  if (args.provider === "openrouter") {
    return streamOpenAICompatible(
      OPENROUTER_BASE,
      args.apiKey,
      args.model,
      args.systemPrompt,
      args.messages,
      temperature,
      args.onToken,
      { fallbacks: args.fallbacks, onSlowStart: args.onSlowStart, timeoutMs: args.timeoutMs }
    );
  }
  return streamOpenAICompatible(
    args.provider === "openai" ? OPENAI_BASE : GROQ_BASE,
    args.apiKey,
    args.model,
    args.systemPrompt,
    args.messages,
    temperature,
    args.onToken,
    { onSlowStart: args.onSlowStart, timeoutMs: args.timeoutMs }
  );
}
