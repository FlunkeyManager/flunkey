import type { AppHotkeys } from "./hotkeys";
import { DEFAULT_HOTKEYS } from "./hotkeys";
import { RECOMMENDED_LOCAL_MODEL } from "./whisper";

export type { AppHotkeys, HotkeyBinding } from "./hotkeys";

/* ── Data models ─────────────────────────────────────────────── */

export interface Transcription {
  id: string;
  text: string;
  timestamp: number; // epoch ms
  /** Foreground app profile id where dictation started ("generic" if unknown). */
  app?: string;
}

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Optional screenshot attached to this F9 turn as a data URL. */
  imageDataUrl?: string;
  timestamp: number; // epoch ms
}

export interface AiSession {
  id: string;
  messages: ChatMessage[];
  model: string;
  timestamp: number; // session start / last activity
  /** True when the session was built from multiple F9 turns. */
  continuous?: boolean;
}

export interface TransformRecord {
  id: string;
  originalText: string;
  instruction: string;
  resultText: string;
  timestamp: number; // epoch ms
  model: string;
  /** Foreground app profile id where the transform started. */
  app?: string;
}

/**
 * A custom vocabulary word (Wispr Flow-style): the user adds the exact
 * word once ("Groq", "Flunkey", "VS Code"). The engine recognizes
 * case variants and close misspellings and emits the canonical form.
 * No aliases, no replacement rules, no categories.
 */
export interface DictionaryEntry {
  id: string;
  word: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  /**
   * Known misspellings that must become `word`.
   *
   * The fuzzy matcher already fixes near-misses; this is for systematic errors
   * a distance threshold will not reach — "get" for "Git", "Paul" for "Pall".
   * Applied before the fuzzy pass, whole-word and case-insensitively.
   */
  corrections?: string[];
}

export type F9OverlayPosition = "left" | "right" | "top" | "bottom";

export const F9_OVERLAY_POSITIONS: {
  id: F9OverlayPosition;
  label: string;
}[] = [
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
];

export type AiProvider = "groq" | "openai" | "gemini" | "openrouter" | "ollama";

/**
 * Voice providers. "local" is whisper.cpp running on this machine — no key, no
 * cost, no network — and is only ever valid for speech-to-text.
 */
export type SttProvider = AiProvider | "local";

/** Default local Ollama server. Always http on loopback. */
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

export interface UserSettings {
  name: string;
  nickname: string;
  useCases: string[]; // "writing" | "coding" | "research" | "general"
  /** Groq key — Whisper transcription + default chat provider. */
  groqApiKey: string;
  /** Which provider answers F9 chats and F10 transforms (global default). */
  aiProvider: AiProvider;
  openaiApiKey: string;
  geminiApiKey: string;
  openRouterApiKey: string;
  /** Ollama (local models) — no API key, just a base URL. */
  ollamaEnabled: boolean;
  ollamaBaseUrl: string;
  ollamaModel: string;
  systemPrompt: string;
  /** Groq chat model id (preset or custom). */
  model: string;
  /** OpenAI chat model id (preset or custom). */
  openaiModel: string;
  /** OpenAI transcription model id. */
  openaiTranscriptionModel: string;
  /** Gemini model id (preset or custom) — also used for voice transcription. */
  geminiModel: string;
  /** Gemini transcription model override ("" = same as chat, native audio). */
  geminiTranscriptionModel: string;
  /** OpenRouter chat model id (preset or custom). */
  openRouterModel: string;
  // Per-task model assignments — only selectable among providers where a key is present.
  /** Voice-to-text transcription */
  sttProvider: SttProvider;
  sttModel: string;
  /** Which on-device model to use ("tiny" | "base" | "small"). */
  localSttModel: string;
  /** ISO-639-1 code for the spoken input language; "" = auto-detect. */
  sttLanguage: string;
  /** F9 question & answer */
  f9Provider: AiProvider;
  f9Model: string;
  /** F10 selection transform */
  f10Provider: AiProvider;
  f10Model: string;
  /** Grammar cleanup / polish (F8 when dictionary on) */
  polishProvider: AiProvider;
  polishModel: string;
  showRecordingIndicator: boolean;
  /** When on, F9 keeps context across turns until you start a new chat. */
  f9ContinuousChat: boolean;
  /** Screen edge where the F9 overlay panel appears (when free position is off). */
  f9OverlayPosition: F9OverlayPosition;
  /** When on, the F9 panel can be dragged anywhere and remembers its place. */
  f9OverlayFreePosition: boolean;
  /** Last logical position when free position is on (null = snap from edge once). */
  f9OverlayFreeX: number | null;
  f9OverlayFreeY: number | null;
  f9OverlayFreeWidth: number | null;
  f9OverlayFreeHeight: number | null;
  /** Global hold-to-talk shortcuts (defaults: F8 / F9). */
  hotkeys: AppHotkeys;
  /** When true, Flunkey will save and restore the user's clipboard around paste operations. */
  preserveClipboard: boolean;
  /** When true, Flunkey starts automatically with Windows. */
  autoStart: boolean;
  onboardingDone: boolean;
  /** Legal docs version accepted during onboarding ("" = never). */
  legalAcceptedVersion: string;
  /** How much AI cleanup F8 applies. */
  dictationStyle: DictationStyle;
  /**
   * Free-form standing instructions for F8. Combined with the active app's
   * instructions at the Enhanced cleanup level.
   */
  dictationInstructions: string;
  /** Per-application instruction overrides, keyed by app id. */
  appInstructions: Record<string, string>;
  /** How much AI cleanup F8 applies. */
  historyLimits: HistoryLimits;
}

/**
 * F8 cleanup level.
 *
 * - `verbatim` — no second model call for cleanup. Speech recognition still
 *   runs through the selected transcription engine; no rewriting follows it.
 * - `light` — the default. Uses a built-in prompt to fix punctuation,
 *   capitalization, filler words, self-corrections, and grammar.
 * - `enhanced` — follows global standing instructions together with the
 *   active application's prompt; that prompt may reshape or expand the text.
 */
export type DictationStyle = "verbatim" | "light" | "enhanced";

export const DICTATION_STYLES: readonly {
  id: DictationStyle;
  label: string;
  description: string;
}[] = [
  {
    id: "verbatim",
    label: "Verbatim",
    description:
      "No second-pass cleanup or dictionary corrections. Uses the speech engine's transcript as-is; speech recognition itself still uses a model.",
  },
  {
    id: "light",
    label: "Light",
    description:
      "Cleans speech and formats clearly requested code, email, or lists. Your own prompts are not used.",
  },
  {
    id: "enhanced",
    label: "Enhanced",
    description:
      "Combines your standing instructions with the active app's prompt. May substantially rewrite or expand your words to follow them.",
  },
];

export interface HistoryLimits {
  /** Dictation history entries to keep. */
  transcriptions: number;
  /** F10 transform records to keep. */
  transforms: number;
  /** Saved F9 chats to keep. */
  chats: number;
  /** Stored F9 screenshots to keep (files, not turns). */
  screenshots: number;
}

/**
 * Retention defaults.
 *
 * Generous enough that a normal user never notices, small enough that a heavy
 * one cannot silently fill a disk. Overridable in Settings; 0 means keep
 * everything for that collection.
 */
export const DEFAULT_HISTORY_LIMITS: HistoryLimits = {
  transcriptions: 2000,
  transforms: 1000,
  chats: 500,
  screenshots: 1000,
};

/** Clamp user input to something sane and self-consistent. */
export function normalizeHistoryLimits(raw: unknown): HistoryLimits {
  const src = (raw ?? {}) as Partial<HistoryLimits>;
  const clamp = (value: unknown, fallback: number, max: number) => {
    const n = typeof value === "number" ? Math.floor(value) : fallback;
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(n, max);
  };
  return {
    transcriptions: clamp(
      src.transcriptions,
      DEFAULT_HISTORY_LIMITS.transcriptions,
      100_000
    ),
    transforms: clamp(src.transforms, DEFAULT_HISTORY_LIMITS.transforms, 100_000),
    chats: clamp(src.chats, DEFAULT_HISTORY_LIMITS.chats, 10_000),
    screenshots: clamp(src.screenshots, DEFAULT_HISTORY_LIMITS.screenshots, 50_000),
  };
}

/** Current Terms + Privacy version users accept in onboarding. */
export const LEGAL_VERSION = "1.0.0";

/**
 * Default OpenRouter model. `openrouter/free` is OpenRouter's own router that
 * always lands on a free model, so nothing is billed by accident.
 */
export const DEFAULT_OPENROUTER_MODEL = "openrouter/free";

/** The paid model earlier builds shipped as the default. */
export const LEGACY_OPENROUTER_MODEL = "anthropic/claude-3.5-sonnet";

export const DEFAULT_SETTINGS: UserSettings = {
  name: "",
  nickname: "",
  useCases: [],
  groqApiKey: "",
  aiProvider: "groq",
  openaiApiKey: "",
  geminiApiKey: "",
  openRouterApiKey: "",
  ollamaEnabled: false,
  ollamaBaseUrl: DEFAULT_OLLAMA_BASE_URL,
  ollamaModel: "",
  systemPrompt:
    "You are Flunkey, a helpful voice-activated AI assistant on the user's Windows desktop. Keep the responses short unless specified and minimize the use of table formatting.",
  model: "openai/gpt-oss-120b",
  openaiModel: "gpt-4o-mini",
  openaiTranscriptionModel: "gpt-4o-mini-transcribe",
  geminiModel: "gemini-2.5-flash",
  geminiTranscriptionModel: "",
  openRouterModel: DEFAULT_OPENROUTER_MODEL,
  sttProvider: "groq",
  sttModel: "",
  localSttModel: RECOMMENDED_LOCAL_MODEL,
  sttLanguage: "",
  f9Provider: "groq",
  f9Model: "",
  f10Provider: "groq",
  f10Model: "",
  polishProvider: "groq",
  polishModel: "",
  showRecordingIndicator: true,
  f9ContinuousChat: false,
  f9OverlayPosition: "right",
  f9OverlayFreePosition: false,
  f9OverlayFreeX: null,
  f9OverlayFreeY: null,
  f9OverlayFreeWidth: null,
  f9OverlayFreeHeight: null,
  hotkeys: DEFAULT_HOTKEYS,
  preserveClipboard: true,
  autoStart: false,
  onboardingDone: false,
  legalAcceptedVersion: "",
  dictationStyle: "light",
  dictationInstructions: "",
  appInstructions: {},
  historyLimits: DEFAULT_HISTORY_LIMITS,
};

/** Clamp a stored cleanup level to a known value. */
export function normalizeDictationStyle(raw: unknown): DictationStyle {
  return DICTATION_STYLES.some((s) => s.id === raw)
    ? (raw as DictationStyle)
    : "light";
}

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

export function getGroqModelLabel(modelId: string): string {
  const gptOss = modelId.match(/^openai\/gpt-oss-(\d+)b$/i);
  return gptOss ? `GPT-OSS ${gptOss[1]}B` : modelId;
}

export function normalizeGroqModel(modelId: string): string {
  if (!modelId || !modelId.trim()) return DEFAULT_GROQ_MODEL;
  return modelId.trim();
}

export const OPENAI_MODELS = [
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  { id: "gpt-4.1", label: "GPT-4.1" },
] as const;

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
export const DEFAULT_OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

/** Fixed Groq assignments for F8 polish and F10 transform. */
export const GROQ_CHAT_MODEL = "openai/gpt-oss-120b";
export const GROQ_POLISH_MODEL = "openai/gpt-oss-20b";
export const GROQ_TRANSCRIBE_MODEL = "whisper-large-v3-turbo";

export const OPENAI_TRANSCRIPTION_MODELS = [
  { id: "gpt-4o-mini-transcribe", label: "GPT-4o mini Transcribe", desc: "Fast with strong accuracy" },
  { id: "gpt-4o-transcribe", label: "GPT-4o Transcribe", desc: "Most accurate" },
  { id: "whisper-1", label: "Whisper v2", desc: "Classic, inexpensive" },
] as const;

export const GEMINI_MODELS = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
] as const;

/** Offline fallback only — the live catalog (src/openrouter.ts) is the source
 * of truth whenever cached/fetched. Kept so the picker works with no network. */
export const OPENROUTER_MODELS = [
  { id: "openrouter/free", label: "Free models router" },
  { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { id: "openai/gpt-4o", label: "GPT-4o (via OpenRouter)" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (via OpenRouter)" },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
] as const;

/** Dedicated Gemini speech-to-text model (Interactions API). */
export const GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-transcribe";

/**
 * Whisper-supported transcription languages. "" (first entry) = let the
 * engine auto-detect. Whisper only accepts ISO-639-1 codes.
 */
export const STT_LANGUAGES: { code: string; label: string }[] = [
  { code: "", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "af", label: "Afrikaans" },
  { code: "ar", label: "Arabic" },
  { code: "hy", label: "Armenian" },
  { code: "az", label: "Azerbaijani" },
  { code: "be", label: "Belarusian" },
  { code: "bs", label: "Bosnian" },
  { code: "bg", label: "Bulgarian" },
  { code: "ca", label: "Catalan" },
  { code: "zh", label: "Chinese" },
  { code: "hr", label: "Croatian" },
  { code: "cs", label: "Czech" },
  { code: "da", label: "Danish" },
  { code: "nl", label: "Dutch" },
  { code: "et", label: "Estonian" },
  { code: "fi", label: "Finnish" },
  { code: "fr", label: "French" },
  { code: "gl", label: "Galician" },
  { code: "de", label: "German" },
  { code: "el", label: "Greek" },
  { code: "he", label: "Hebrew" },
  { code: "hi", label: "Hindi" },
  { code: "hu", label: "Hungarian" },
  { code: "is", label: "Icelandic" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "kn", label: "Kannada" },
  { code: "kk", label: "Kazakh" },
  { code: "ko", label: "Korean" },
  { code: "lv", label: "Latvian" },
  { code: "lt", label: "Lithuanian" },
  { code: "mk", label: "Macedonian" },
  { code: "ms", label: "Malay" },
  { code: "mr", label: "Marathi" },
  { code: "mi", label: "Maori" },
  { code: "ne", label: "Nepali" },
  { code: "no", label: "Norwegian" },
  { code: "fa", label: "Persian" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "pa", label: "Punjabi" },
  { code: "ro", label: "Romanian" },
  { code: "ru", label: "Russian" },
  { code: "sr", label: "Serbian" },
  { code: "sk", label: "Slovak" },
  { code: "sl", label: "Slovenian" },
  { code: "es", label: "Spanish" },
  { code: "sw", label: "Swahili" },
  { code: "sv", label: "Swedish" },
  { code: "tl", label: "Tagalog" },
  { code: "ta", label: "Tamil" },
  { code: "th", label: "Thai" },
  { code: "tr", label: "Turkish" },
  { code: "uk", label: "Ukrainian" },
  { code: "ur", label: "Urdu" },
  { code: "vi", label: "Vietnamese" },
  { code: "cy", label: "Welsh" },
];

/**
 * Gemini voice engine: explicit override uses the dedicated
 * Interactions-API transcription model, otherwise the chat model
 * transcribes natively (proven path, default).
 */
export function getGeminiTranscription(s: UserSettings): { model: string; dedicated: boolean } {
  const explicit = s.geminiTranscriptionModel?.trim();
  if (explicit) return { model: explicit, dedicated: explicit !== (s.geminiModel?.trim() || DEFAULT_GEMINI_MODEL) };
  const chat = s.geminiModel?.trim() || DEFAULT_GEMINI_MODEL;
  return { model: chat, dedicated: false };
}

export function hasProviderKey(s: UserSettings, provider: AiProvider): boolean {
  if (provider === "groq") return !!s.groqApiKey.trim();
  if (provider === "openai") return !!s.openaiApiKey.trim();
  if (provider === "gemini") return !!s.geminiApiKey.trim();
  if (provider === "openrouter") return !!s.openRouterApiKey.trim();
  // Local models need no key — the user just has to switch Ollama on.
  if (provider === "ollama") return !!s.ollamaEnabled;
  return false;
}

export function getProviderKey(s: UserSettings, provider: AiProvider): string {
  if (provider === "groq") return s.groqApiKey.trim();
  if (provider === "openai") return s.openaiApiKey.trim();
  if (provider === "gemini") return s.geminiApiKey.trim();
  if (provider === "openrouter") return s.openRouterApiKey.trim();
  // Ollama ignores the key but the transport requires a bearer value.
  if (provider === "ollama") return "ollama";
  return "";
}

/** Normalized Ollama base URL (never trailing slash). */
export function getOllamaBaseUrl(s: UserSettings): string {
  const raw = (s.ollamaBaseUrl ?? "").trim() || DEFAULT_OLLAMA_BASE_URL;
  return raw.replace(/\/+$/, "");
}

export function getProviderLabel(provider: AiProvider | SttProvider): string {
  if (provider === "openai") return "ChatGPT";
  if (provider === "gemini") return "Gemini";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "ollama") return "Ollama";
  if (provider === "local") return "On-device";
  return "Groq";
}

// Per-task effective targets — fallback to global aiProvider when task-specific not set or key missing.

function effectiveProvider(s: UserSettings, taskProvider?: AiProvider): AiProvider {
  if (taskProvider && hasProviderKey(s, taskProvider)) return taskProvider;
  if (hasProviderKey(s, s.aiProvider)) return s.aiProvider;
  // fallback to any provider with a key
  const avail: AiProvider[] = ["groq", "openai", "gemini", "openrouter", "ollama"];
  for (const p of avail) if (hasProviderKey(s, p)) return p;
  return s.aiProvider;
}

export function getSttTarget(s: UserSettings): { provider: SttProvider; model: string; key: string; dedicated?: boolean } | null {
  // On-device whisper: no key, no network. Falls through to cloud only when
  // nothing is installed.
  if (s.sttProvider === "local") {
    const model = s.localSttModel?.trim() || RECOMMENDED_LOCAL_MODEL;
    return { provider: "local", model, key: "" };
  }
  let provider = effectiveProvider(s, s.sttProvider as AiProvider);
  // Local models cannot transcribe audio — fall through to a cloud STT engine.
  if (provider === "ollama") {
    const cloud: AiProvider[] = ["groq", "openai", "gemini"];
    const found = cloud.find((p) => hasProviderKey(s, p));
    if (!found) return null;
    provider = found;
  }
  // OpenRouter STT not supported via Flunkey yet — fall back to any STT-capable provider with a key
  if (provider === "openrouter" && !hasProviderKey(s, "openrouter")) return null;
  if (provider === "openrouter") {
    // No native OpenRouter STT — use OpenAI/Groq/Gemini instead
    const fallback: AiProvider[] = ["groq", "openai", "gemini"];
    for (const p of fallback) {
      if (hasProviderKey(s, p)) {
        const fk = getProviderKey(s, p);
        if (p === "groq") return { provider: p, model: s.sttModel?.trim() || GROQ_TRANSCRIBE_MODEL, key: fk };
        if (p === "openai") return { provider: p, model: s.sttModel?.trim() || s.openaiTranscriptionModel?.trim() || DEFAULT_OPENAI_TRANSCRIPTION_MODEL, key: fk };
        if (p === "gemini") {
          const m = s.sttModel?.trim() || getGeminiTranscription(s).model;
          return { provider: p, model: m, key: fk, dedicated: s.sttModel?.trim() ? s.sttModel.trim() !== (s.geminiModel?.trim() || DEFAULT_GEMINI_MODEL) : getGeminiTranscription(s).dedicated };
        }
      }
    }
    return null;
  }
  const key = getProviderKey(s, provider);
  if (!key) return null;
  if (provider === "groq") return { provider, model: s.sttModel?.trim() || GROQ_TRANSCRIBE_MODEL, key };
  if (provider === "openai") {
    const m = s.sttModel?.trim() || s.openaiTranscriptionModel?.trim() || DEFAULT_OPENAI_TRANSCRIPTION_MODEL;
    return { provider, model: m, key };
  }
  if (provider === "gemini") {
    const m = s.sttModel?.trim() || getGeminiTranscription(s).model;
    const dedicated = s.sttModel?.trim() ? s.sttModel.trim() !== (s.geminiModel?.trim() || DEFAULT_GEMINI_MODEL) : getGeminiTranscription(s).dedicated;
    return { provider, model: m, key, dedicated };
  }
  return { provider, model: GROQ_TRANSCRIBE_MODEL, key };
}

export function getF9Target(s: UserSettings): { provider: AiProvider; model: string; key: string } | null {
  const provider = effectiveProvider(s, s.f9Provider);
  const key = getProviderKey(s, provider);
  if (!key) return null;
  if (provider === "groq") {
    return { provider, model: s.f9Model?.trim() || GROQ_CHAT_MODEL, key };
  }
  if (provider === "openai") return { provider, model: s.f9Model?.trim() || s.openaiModel?.trim() || DEFAULT_OPENAI_MODEL, key };
  if (provider === "gemini") return { provider, model: s.f9Model?.trim() || s.geminiModel?.trim() || DEFAULT_GEMINI_MODEL, key };
  if (provider === "openrouter") return { provider, model: s.f9Model?.trim() || s.openRouterModel?.trim() || DEFAULT_OPENROUTER_MODEL, key };
  if (provider === "ollama") return { provider, model: s.f9Model?.trim() || s.ollamaModel?.trim() || "", key };
  return { provider, model: GROQ_CHAT_MODEL, key };
}

export function getF10Target(s: UserSettings): { provider: AiProvider; model: string; key: string } | null {
  const provider = effectiveProvider(s, s.f10Provider);
  const key = getProviderKey(s, provider);
  if (!key) return null;
  if (provider === "groq") return { provider, model: s.f10Model?.trim() || GROQ_CHAT_MODEL, key };
  if (provider === "openai") return { provider, model: s.f10Model?.trim() || s.openaiModel?.trim() || DEFAULT_OPENAI_MODEL, key };
  if (provider === "gemini") return { provider, model: s.f10Model?.trim() || s.geminiModel?.trim() || DEFAULT_GEMINI_MODEL, key };
  if (provider === "openrouter") return { provider, model: s.f10Model?.trim() || s.openRouterModel?.trim() || DEFAULT_OPENROUTER_MODEL, key };
  if (provider === "ollama") return { provider, model: s.f10Model?.trim() || s.ollamaModel?.trim() || "", key };
  return { provider, model: GROQ_CHAT_MODEL, key };
}

export function getPolishTarget(s: UserSettings): { provider: AiProvider; model: string; key: string } | null {
  const provider = effectiveProvider(s, s.polishProvider);
  const key = getProviderKey(s, provider);
  if (!key) return null;
  if (provider === "groq") return { provider, model: s.polishModel?.trim() || GROQ_POLISH_MODEL, key };
  if (provider === "openai") return { provider, model: s.polishModel?.trim() || s.openaiModel?.trim() || DEFAULT_OPENAI_MODEL, key };
  if (provider === "gemini") return { provider, model: s.polishModel?.trim() || s.geminiModel?.trim() || DEFAULT_GEMINI_MODEL, key };
  if (provider === "openrouter") return { provider, model: s.polishModel?.trim() || s.openRouterModel?.trim() || DEFAULT_OPENROUTER_MODEL, key };
  if (provider === "ollama") return { provider, model: s.polishModel?.trim() || s.ollamaModel?.trim() || "", key };
  return { provider, model: GROQ_POLISH_MODEL, key };
}
