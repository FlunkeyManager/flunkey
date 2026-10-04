import { useEffect, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";

import { useStore } from "./store";
import { loadAllData, saveTranscriptions, saveAiSessions, saveSettings, saveTransforms } from "./persistence";
import { applyOverlayLayout } from "./overlayPosition";
import {
  applyHotkeys,
  keyboardEventMatchesBinding,
  normalizeHotkeys,
} from "./hotkeys";
import { playStartSound, playStopSound, playConfirmSound, playCancelSound, initAudio } from "./sounds";
import { setAutostartEnabled } from "./autostart";
import { transcribeAudio } from "./groq";
import { chatCompletion, openaiTranscribe, geminiTranscribe, polishTranscription } from "./ai";
import { fetchGroqModels, isGroqVisionModel } from "./groqModels";
import {
  fetchOpenRouterCatalog,
  peekCatalog,
  pickOpenRouterFallback,
  supportsOpenRouterImages,
} from "./openrouter";
import { fetchOllamaModels, isOllamaVisionModel } from "./ollama";
import {
  buildApiConversation,
  buildPendingMessages,
  buildSessionAfterTurn,
  syncOverlayChat,
} from "./f9Chat";
import type { AiSession, DictionaryEntry, TransformRecord, UserSettings } from "./types";
import {
  getF9Target,
  getF10Target,
  getOllamaBaseUrl,
  getPolishTarget,
  getProviderLabel,
  getSttTarget,
  normalizeDictationStyle,
} from "./types";
import { stripThinkingBlocks } from "./responseSanitizer";
import { blobToWav16kMono } from "./audioWav";
import { transcribeLocal } from "./whisper";
import { saveScreenshot } from "./screenshots";
import { isLikelySafetyRefusal, isUnusablePolishResult, looksLikeUnpromptedReply } from "./refusalGuard";
import { sanitizeDictationOutput } from "./dictationOutput";
import { resolveAppInstructions } from "./appInstructions";
import { detectDictationFormat } from "./dictationFormatting";
import {
  resolveAppProfile,
  APP_PROFILES,
  type ActiveAppInfo,
  type AppProfile,
} from "./appProfiles";
import {
  countUserMessages,
  getFirstUserMessage,
  getLastAssistantMessage,
} from "./sessionUtils";

/** Foreground app where the current voice flow started (per-app profiles). */
async function fetchActiveAppProfile(): Promise<AppProfile> {
  try {
    const info = await invoke<ActiveAppInfo>("get_active_app");
    return resolveAppProfile(info?.exe, info?.title);
  } catch {
    return resolveAppProfile(null);
  }
}

/** Tell the pill which app the current flow belongs to (icon on the left). */
async function emitPillContext(profile: AppProfile | null) {
  try {
    await emitTo("pill", "pill-context", {
      appId: profile ? profile.id : null,
      icon: profile ? profile.icon : null,
      label: profile ? profile.label : null,
    });
  } catch {}
}

/** Paste text using the target app's expected chord. */
async function pasteForApp(profile: AppProfile, text: string) {
  await writeText(text);
  if (profile.paste === "ctrl+shift+v") {
    await invoke("simulate_paste_plain");
  } else {
    await invoke("simulate_paste");
  }
}

/** How recently a session must be to auto-resume when chat mode is on. */
const F9_RESUME_WINDOW_MS = 30 * 60 * 1000;

/** Minimum time a pill stays up after key-down — shorter taps would
 * otherwise flash open/closed like a glitch before the toast lands. */
const MIN_PILL_DWELL_MS = 650;
/** Minimum time the processing spinner stays visible on fast paths, so
 * recording → processing → idle reads as intentional (F8-like). */
const MIN_PROC_MS = 500;

/**
 * Transcribe audio with the per-task STT provider's native engine:
 * Groq -> Whisper Turbo, OpenAI -> whisper-1 / gpt-4o-transcribe family,
 * Gemini -> native audio understanding, OpenRouter -> not supported for STT (falls back).
 */
async function transcribeWithProvider(
  settings: UserSettings,
  blob: Blob,
  opts: { prompt?: string; vocabHint?: string; verbatim?: boolean } = {}
): Promise<string> {
  const stt = getSttTarget(settings);
  if (!stt) throw new Error("No STT provider configured — add a key in Models");
  const sttLanguage = settings.sttLanguage?.trim() || undefined;

  // On-device whisper.cpp: convert the clip to 16 kHz mono WAV in the
  // WebView, then transcribe locally. Nothing is uploaded.
  if (stt.provider === "local") {
    const wav = await blobToWav16kMono(blob);
    return transcribeLocal({
      wav,
      model: stt.model,
      language: sttLanguage,
      // Custom vocabulary goes in as whisper's initial prompt, which is what
      // makes proper nouns survive the transcription step itself.
      prompt: opts.vocabHint || opts.prompt || "",
    });
  }

  if (stt.provider === "openai") {
    return openaiTranscribe(stt.key, blob, {
      model: stt.model,
      prompt: opts.prompt,
      language: sttLanguage,
    });
  }
  if (stt.provider === "gemini") {
    const dedicated = (stt as { dedicated?: boolean }).dedicated ?? stt.model === "gemini-3.5-transcribe";
    return geminiTranscribe(stt.key, blob, {
      model: stt.model,
      dedicated: !!dedicated,
      verbatim: opts.verbatim,
      vocabHint: opts.verbatim ? undefined : opts.vocabHint,
      language: sttLanguage,
    });
  }
  if (stt.provider === "openrouter") {
    if (settings.groqApiKey.trim()) return transcribeAudio(settings.groqApiKey, blob, opts.prompt, stt.model || undefined, sttLanguage);
    throw new Error("OpenRouter has no STT model — add a Groq/OpenAI/Gemini key for voice");
  }
  return transcribeAudio(stt.key, blob, opts.prompt, stt.model || undefined, sttLanguage);
}

/** Logs the implicit-Ollama-polish skip once, not on every dictation. */
let polishSkipLogged = false;

/**
 * One line per session describing which providers the voice flow actually
 * resolves to. A provider that differs from the obvious choice (Ollama picked
 * up by the generic fallback, say) is the kind of thing that otherwise shows
 * up only as "it just doesn't work".
 */
let providerLogKey = "";
function logResolvedProviders(
  settings: UserSettings,
  stt: { provider: string; model: string },
  appProfile: AppProfile,
) {
  const polish = getPolishTarget(settings);
  const polLabel = polish ? getProviderLabel(polish.provider) : "none (dictionary only)";
  const style = normalizeDictationStyle(settings.dictationStyle);
  const promptStatus =
    style === "enhanced"
      ? resolveAppInstructions(
          settings,
          appProfile.id,
          appProfile.polishSuffix,
        )
        ? "standing + app instructions"
        : "built-in fallback instructions"
      : "custom instructions inactive";
  const key = `${stt.provider}:${stt.model}|${polLabel}|${style}|${appProfile.id}|${promptStatus}`;
  if (key === providerLogKey) return;
  providerLogKey = key;
  console.info(
    `Voice pipeline → STT: ${stt.provider} (${stt.model}) · cleanup: ${style} via ${polLabel} · app: ${appProfile.label} · prompts: ${promptStatus}`
  );
}

/**
 * Grammar polish through the configured text model. This runs after every
 * transcription provider except Verbatim, including Gemini STT.
 */
/**
 * Run a polish pass and return text that is safe to paste.
 *
 * The model is an assistant, so it sometimes *answers* the dictated request
 * instead of editing it — "send an email to bob" comes back as a written
 * email, "what is the capital of france" comes back as "Paris". That text was
 * then pasted straight into the user's app. Every candidate now goes through
 * `acceptDictation`: a reply, a refusal, or chat framing is discarded and the
 * raw transcript is polished locally instead, which is instant and cannot
 * invent anything.
 */
async function acceptDictation(
  candidate: string,
  original: string,
  dictionary: DictionaryEntry[],
  allowExpansion = false,
  preserveStructure = allowExpansion,
  format?: ReturnType<typeof detectDictationFormat>,
): Promise<string> {
  const cleaned = sanitizeDictationOutput(candidate ?? "", preserveStructure);
  const resolveWords = (value: string) =>
    format === "code"
      ? value
      : resolveCustomVocabulary(value, dictionary, { fuzzy: true });
  if (!cleaned) {
    console.warn("F8: polish produced no usable text; using the raw transcript.");
    return resolveWords(original);
  }
  const allowStructuredOutput =
    !allowExpansion &&
    preserveStructure &&
    format === "code";
  if (
    isUnusablePolishResult(
      cleaned,
      original,
      allowExpansion,
      allowStructuredOutput,
    )
  ) {
    console.warn(
      "F8: the model replied instead of editing; using the raw transcript.",
      cleaned.slice(0, 200),
    );
    return resolveWords(original);
  }
  return resolveWords(cleaned);
}

async function polishWithProvider(
  settings: UserSettings,
  dictionary: DictionaryEntry[],
  text: string,
  appProfile: AppProfile,
): Promise<string> {
  const style = normalizeDictationStyle(settings.dictationStyle);
  const format =
    style === "light"
      ? detectDictationFormat(text, appProfile.id)
      : undefined;
  // Enhanced is the only level permitted to change wording. The guard and the
  // sanitizer are told the same thing, so a deliberately expanded prompt is not
  // discarded as an AI "reply" at the very level that asked for it.
  const allowExpansion = style === "enhanced";
  // Light deliberately ignores the user's instructions and the app's prompt:
  // at that level Flunkey promises cleanup and nothing more.
  const resolved =
    style === "enhanced"
      ? resolveAppInstructions(
          settings,
          appProfile.id,
          appProfile.polishSuffix,
        )
      : "";

  const pol = getPolishTarget(settings);
  if (!pol) {
    console.warn("F8: no cleanup model is configured; using the raw transcript.");
    try {
      await emitTo("pill", "show-toast", {
        message: "No AI cleanup model is configured — the transcript was pasted unchanged",
        status: "error",
      });
    } catch {}
    return format === "code"
      ? text
      : resolveCustomVocabulary(text, dictionary, { fuzzy: true });
  }
  // Ollama only polishes when the user actually assigned it there. Otherwise
  // it is just the automatic "any connected provider" fallback, and calling
  // it would block dictation behind a local model cold-start for no reason.
  if (pol.provider === "ollama" && settings.polishProvider !== "ollama") {
    if (!polishSkipLogged) {
      polishSkipLogged = true;
      console.info(
        "Polish: Ollama was only a fallback, not your choice — applying the custom dictionary locally instead."
      );
    }
    try {
      await emitTo("pill", "show-toast", {
        message: "No cleanup model is configured — the transcript was pasted unchanged",
        status: "error",
      });
    } catch {}
    return format === "code"
      ? text
      : resolveCustomVocabulary(text, dictionary, { fuzzy: true });
  }
  try {
    // Relevant-only vocab: the prompt carries just the words resembling
    // this transcript, never the whole dictionary. All providers use the
    // same prompt builder and the same timeout/fallback behavior.
    return await acceptDictation(
      await polishTranscription({
        provider: pol.provider,
        apiKey: pol.key,
        model: pol.model,
        baseUrl: getOllamaBaseUrl(settings),
        text,
        vocabRules:
          format === "code"
            ? ""
            : formatDictionaryForPrompt(
                selectRelevantEntries(text, dictionary),
              ),
        appSuffix: resolved,
        format,
        appId: appProfile.id,
        language: settings.sttLanguage,
        style: allowExpansion ? "enhanced" : "light",
      }),
      text,
      dictionary,
      allowExpansion,
      allowExpansion || (format !== undefined && format !== "prose"),
      format,
    );
  } catch (err) {
    // A failed polish must never lose the dictation, but make the fallback
    // visible so a configured prompt never appears to have silently worked.
    console.error("F8: polish failed; using the raw transcript.", err);
    try {
      await emitTo("pill", "show-toast", {
        message: "AI cleanup failed — the original transcript was pasted",
        status: "error",
      });
    } catch {}
    return resolveCustomVocabulary(text, dictionary, { fuzzy: true });
  }
}

function findResumableSession(
  sessions: AiSession[],
  activeChatId: string | null
): AiSession | null {
  if (activeChatId) {
    return sessions.find((s) => s.id === activeChatId) ?? null;
  }
  const latest = sessions[0];
  if (!latest) return null;
  if (Date.now() - latest.timestamp > F9_RESUME_WINDOW_MS) return null;
  return latest;
}
import { startRecording, stopRecording } from "./recorder";

import { Titlebar } from "./components/Titlebar";
import { Sidebar } from "./components/Sidebar";
import { Onboarding } from "./components/Onboarding";
import { Dashboard } from "./pages/Dashboard";
import { Dictation } from "./pages/Dictation";
import { Applications } from "./pages/Applications";
import { ChatHistory } from "./pages/ChatHistory";
import { Transcripts } from "./pages/Transcripts";
import { Transforms } from "./pages/Transforms";
import { Dictionary } from "./pages/Dictionary";
import { Settings } from "./pages/Settings";
import { Models } from "./pages/Models";
import { Analytics } from "./pages/Analytics";
import {
  buildWhisperDictionaryPrompt,
  formatDictionaryForPrompt,
  resolveCustomVocabulary,
  selectRelevantEntries,
} from "./dictionary";
import {
  F10_DEFAULT_INSTRUCTION,
  F10_MAX_SELECTION_CHARS,
  F10_SYSTEM_PROMPT,
  buildF10UserMessage,
  isUnusableF10Result,
  sanitizeF10Response,
} from "./f10Transform";

import "./App.css";

function PageRouter() {
  const page = useStore((s) => s.currentPage);
  switch (page) {
    case "dashboard":
      return <Dashboard />;
    case "dictation":
      return <Dictation />;
    case "applications":
      return <Applications />;
    case "history":
      return <ChatHistory />;
    case "transcripts":
      return <Transcripts />;
    case "transforms":
      return <Transforms />;
    case "dictionary":
      return <Dictionary />;
    case "settings":
      return <Settings />;
    case "models":
      return <Models />;
    case "analytics":
      return <Analytics />;
    default:
      return <Dashboard />;
  }
}

function App() {
  const [loading, setLoading] = useState(true);
  const onboardingDone = useStore((s) => s.settings.onboardingDone);
  const f8HandsFree = useRef(false);
  const f8Busy = useRef(false);
  /** Incremented per dictation; a stale pipeline must not paste. */
  const f8RunId = useRef(0);
  const f8LastUp = useRef(0);
  const f8LastDown = useRef(0);
  const f8TapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const f8IgnoreNextUp = useRef(false);
  /** Key-down timestamp of the current/last F9 hold (for pill dwell). */
  const f9StartTime = useRef(0);
  const f9LastDown = useRef(0);
  const f9TapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the processing phase began (for the processing minimum). */
  const f9ProcessingStart = useRef(0);
  const f9Screenshot = useRef<string | null>(null);
  /** Per-app profile of the foreground app where the F8 flow started. */
  /** Per-app profile of the foreground app where the F8 flow started. */

  useEffect(() => {
    const unlisten: (() => void)[] = [];
    listen<string>("f9-image-attached", (event) => {
      const image = event.payload;
      if (
        typeof image === "string" &&
        image.startsWith("data:image/jpeg;base64,") &&
        image.length <= 1_400_000
      ) {
        f9Screenshot.current = image;
      } else {
        console.error("Rejected invalid or oversized F9 screenshot attachment");
      }
    })
      .then((unlistenImage) => unlisten.push(unlistenImage))
      .catch(console.error);
    listen("f9-image-cleared", () => {
      f9Screenshot.current = null;
    })
      .then((unlistenImage) => unlisten.push(unlistenImage))
      .catch(console.error);
    listen("f9-image-consumed", () => {
      f9Screenshot.current = null;
    })
      .then((unlistenImage) => unlisten.push(unlistenImage))
      .catch(console.error);
    return () => unlisten.forEach((stop) => stop());
  }, []);

  // Bootstrap: load persisted data
  useEffect(() => {
    initAudio();
    loadAllData()
      .then(async () => {
        const { settings } = useStore.getState();
        await setAutostartEnabled(settings.autoStart ?? false).catch(console.error);
        await applyHotkeys(normalizeHotkeys(settings.hotkeys));
        const initialHotkeys = normalizeHotkeys(settings.hotkeys);
        await emitTo("pill", "hotkeys-changed", initialHotkeys);
        await emitTo("overlay", "hotkeys-changed", initialHotkeys);
        return applyOverlayLayout({
          f9OverlayPosition: settings.f9OverlayPosition,
          f9OverlayFreePosition: settings.f9OverlayFreePosition,
          f9OverlayFreeX: settings.f9OverlayFreeX,
          f9OverlayFreeY: settings.f9OverlayFreeY,
          f9OverlayFreeWidth: settings.f9OverlayFreeWidth,
          f9OverlayFreeHeight: settings.f9OverlayFreeHeight,
        });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Tray navigation: the system-tray menu emits a page id ("navigate").
  // Whitelisted to sidebar page ids so a stale/foreign payload can't
  // blank the router.
  useEffect(() => {
    const valid = new Set([
      "dashboard",
      "dictation",
      "applications",
      "history",
      "transcripts",
      "transforms",
      "dictionary",
      "models",
      "settings",
      "analytics",
    ]);
    let unlisten: (() => void) | undefined;
    listen<string>("navigate", (event) => {
      if (typeof event.payload === "string" && valid.has(event.payload)) {
        useStore.getState().setCurrentPage(event.payload);
      }
    })
      .then((u) => {
        unlisten = u;
      })
      .catch(console.error);
    return () => {
      unlisten?.();
    };
  }, []);

  // Hide-pill master switch: push the setting to the backend, which hides
  // the window and stops the watchdog/hook from re-showing it. Flows run
  // headless while off.
  const pillVisible = useStore((s) => s.settings.showRecordingIndicator);
  useEffect(() => {
    invoke("set_pill_disabled", { disabled: !pillVisible }).catch(() => {});
  }, [pillVisible]);

  // Keep pill topmost even after another TOPMOST app overtakes it
  useEffect(() => {
    // Initial bump after bootstrap
    const bump = () => invoke("ensure_pill_visible").catch(() => {});
    bump();
    // Re-bump on main window focus — happens when user alt-tabs back
    const onFocus = () => bump();
    const onVisibility = () => {
      if (!document.hidden) bump();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    // Light poll as final safety net (Rust watchdog is primary)
    const iv = window.setInterval(bump, 3000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(iv);
    };
  }, []);

  // Persist overlay position when user drags in free mode
  useEffect(() => {
    let saveTimer: ReturnType<typeof setTimeout> | undefined;

    const setup = async () => {
      const unlisten = await listen<{
        x: number;
        y: number;
        width: number;
        height: number;
      }>("overlay-free-bounds-changed", (event) => {
          const { settings, setSettings } = useStore.getState();
          if (!settings.f9OverlayFreePosition) return;

          const updated = {
            ...settings,
            f9OverlayFreeX: event.payload.x,
            f9OverlayFreeY: event.payload.y,
            f9OverlayFreeWidth: event.payload.width,
            f9OverlayFreeHeight: event.payload.height,
          };
          setSettings(updated);

          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            saveSettings(updated).catch(console.error);
          }, 400);
        }
      );
      return unlisten;
    };

    let unlisten: (() => void) | undefined;
    setup()
      .then((u) => {
        unlisten = u;
      })
      .catch(console.error);

    return () => {
      clearTimeout(saveTimer);
      unlisten?.();
    };
  }, []);

  // Listen for hotkey events from the Rust backend
  useEffect(() => {
    const unlisten: (() => void)[] = [];
    let f8HotkeyDown = false;
    let f9HotkeyDown = false;
    let transformHotkeyDown = false;

    const getCurrentHotkeys = () =>
      normalizeHotkeys(useStore.getState().settings.hotkeys);

    // Shared F8 pipeline: provider-native transcription (+ polish only
    // when the F8 dictionary toggle is ON), then paste + save.
    // Toggle OFF = plain voice-to-text, no dictionary anywhere.
    const transcribeAndPasteF8 = async (
      restoreClipboard = true,
      runId?: number,
    ): Promise<void> => {
      const blob = await stopRecording();
      const state = useStore.getState();
      const { settings, dictionary } = state;
      // Per-app context, resolved fresh rather than read from a ref that a
      // fire-and-forget call may not have written yet. The foreground app
      // cannot change mid-dictation, so this is the correct moment to ask, and
      // it also repairs a stale value left by an earlier dictation whose
      // lookup failed.
      const appProfile = await fetchActiveAppProfile();

      const stt = getSttTarget(settings);
      if (!stt) {
        try { await emitTo("pill", "show-toast", { message: `Set up voice in Models - add a key or download the on-device model`, status: "error" }); } catch {}
        return;
      }
      logResolvedProviders(settings, stt, appProfile);

      // Vocabulary bias is useful in cleanup modes. Verbatim deliberately
      // leaves the transcript and dictionary untouched.
      const style = normalizeDictationStyle(settings.dictationStyle);
      const vocabWords =
        style === "verbatim" ? "" : buildWhisperDictionaryPrompt(dictionary);
      let text = await transcribeWithProvider(settings, blob, {
        prompt: stt.provider === "gemini" ? undefined : vocabWords || undefined,
        vocabHint: stt.provider === "gemini" ? vocabWords || undefined : undefined,
        verbatim: style === "verbatim",
      });

      // Safety-refusal guard: Gemini native transcription can refuse
      // PII-seeking audio outright (no polish layer to catch it). Never
      // paste a lecture — abort with a toast instead. Plain "I can't…"
      // dictation is NOT flagged (lecture markers required).
      if (text && isLikelySafetyRefusal(text)) {
        console.warn("F8: STT safety refusal, not pasting:", text.slice(0, 200));
        try { await emitTo("pill", "show-toast", { message: "Transcription blocked — try again or switch voice provider", status: "error" }); } catch {}
        return;
      }

      // When an assistant model does the transcribing (Gemini's audio path)
      // there is no separate raw transcript to diff against, so the transcript
      // can only be judged on its own shape.
      if (text && looksLikeUnpromptedReply(text)) {
        console.warn("F8: transcription engine replied instead of transcribing:", text.slice(0, 200));
        try {
          await emitTo("pill", "show-toast", {
            message: "Your voice model replied instead of transcribing — pick a dedicated transcription model in Models",
            status: "error",
          });
        } catch {}
        return;
      }

      // Cleanup and vocabulary are two separate promises, and they used to be
      // welded together behind one toggle named "dictionary":
      //
      //   - your words and corrections always apply. They are deterministic,
      //     instant, need no network, and only ever fix a word you declared
      //     wrong. There is nothing to switch off.
      //   - the model runs when the cleanup level asks for it, and the level
      //     decides how much it may change.
      //
      // Gating cleanup on the dictionary flag was why a custom per-app prompt
      // would appear to do nothing: with the flag off, no prompt was ever sent.
      if (text) {
        if (style === "verbatim") {
          // No cleanup model or dictionary pass: preserve the speech engine's
          // transcript as-is.
        } else {
          text = await polishWithProvider(settings, dictionary, text, appProfile);
        }
      }
      if (!text) {
        try { await emitTo("pill", "show-toast", { message: "Didn't catch that — try again", status: "error" }); } catch {}
        return;
      }
      // Final safety net: polish returned a lecture despite fallback.
      if (isLikelySafetyRefusal(text)) {
        console.warn("F8: polish safety refusal, not pasting");
        try { await emitTo("pill", "show-toast", { message: "Transcription blocked — try again", status: "error" }); } catch {}
        return;
      }

      // A newer dictation started while this one was in flight. Pasting now
      // would put older text into whatever app the user has since focused.
      if (runId !== undefined && runId !== f8RunId.current) {
        console.info("F8: discarding a superseded dictation.");
        return;
      }

      let originalClipboard: string | null = null;
      if (settings.preserveClipboard && restoreClipboard) {
        try { originalClipboard = await readText(); } catch { originalClipboard = null; }
      }
      // Save first so history survives even if paste fails below.
      const entry = { id: crypto.randomUUID(), text, timestamp: Date.now(), app: appProfile.id };
      useStore.getState().addTranscription(entry);
      await saveTranscriptions(useStore.getState().transcriptions);
      try {
        await pasteForApp(appProfile, text);
        await new Promise((r) => setTimeout(r, 120));
        if (settings.preserveClipboard && restoreClipboard && originalClipboard !== null) {
          try { await writeText(originalClipboard); } catch (e) { console.error("Failed to restore clipboard:", e); }
        }
      } catch (e) {
        // Pasting failed: keep the text in the clipboard (don't restore over
        // the user's only copy) and say so.
        console.error("F8 paste failed, keeping text in clipboard:", e);
        try { await emitTo("pill", "show-toast", { message: "Paste failed — text kept in clipboard", status: "error" }); } catch {}
      }
    };

    const finishF8 = async () => {
      const runId = ++f8RunId.current;
      f8Busy.current = true;
      try {
        await transcribeAndPasteF8(true, runId);
      } catch (e) {
        console.error("F8 error:", e);
        // Surface the real reason. On-device transcription returns specific
        // messages (engine missing, model missing, no speech, timeout) that
        // are far more useful than a blanket failure.
        const detail = e instanceof Error ? e.message.trim() : "";
        const message = detail && detail.length < 90 ? detail : "Transcription failed";
        try { await emitTo("pill", "show-toast", { message, status: "error" }); } catch {}
      } finally {
        try { await invoke("set_pill_state", { state: "idle" }); } catch {}
        try { await emitTo("pill", "pill-state", { state: "idle" }); } catch {}
        // Only the newest run may clear the shared flags; an older one
        // finishing late must not reset a hands-free session started since.
        if (f8RunId.current === runId) {
          f8Busy.current = false;
          f8HandsFree.current = false;
        }
      }
    };

    // F8 — hold = normal, double-tap = hands-free (X | wave | ✓), next tap = confirm & paste
    const handleF8Start = async () => {
      // Busy guard. F8 was the only hotkey without one: releasing the key
      // cleared the flag before the async transcribe+polish finished, so
      // pressing it again mid-pipeline started a second one. Both then raced
      // to the clipboard and the paste, and the *older* response could land
      // last — pasting stale text over the newer dictation.
      if (f8Busy.current) {
        console.info("F8 ignored: a dictation is still being processed.");
        return;
      }
      if (f8HotkeyDown) return;
      f8HotkeyDown = true;
      const now = Date.now();
      // If hands-free is active, this press is the confirm (paste) — ignore its upcoming release
      if (f8HandsFree.current) {
        if (f8TapTimer.current) { clearTimeout(f8TapTimer.current); f8TapTimer.current = null; }
        f8HandsFree.current = false;
        f8IgnoreNextUp.current = true;
        playConfirmSound();
        useStore.getState().setRecording(false);
        useStore.getState().setActiveMode(null);
        emitTo("pill", "pill-state", { state: "processing" }).catch(() => {});
        invoke("set_pill_state", { state: "processing" } as unknown as { state: string }).catch(() => {});
        await finishF8();
        return;
      }
      // Double-tap detection: second down within 400ms of last up → hands-free
      if (now - f8LastUp.current < 400 && f8LastUp.current !== 0) {
        if (f8TapTimer.current) { clearTimeout(f8TapTimer.current); f8TapTimer.current = null; }
        f8HandsFree.current = true;
        // Already recording from first tap's start, just morph to hands-free X|wave|✓
        emitTo("pill", "pill-state", { state: "handsfree" }).catch(() => {});
        invoke("set_pill_state", { state: "handsfree" } as unknown as { state: string }).catch(() => {});
        f8LastDown.current = now;
        return;
      }
      f8LastDown.current = now;
      playStartSound();
      useStore.getState().setRecording(true);
      useStore.getState().setActiveMode("f8");
      invoke("show_recording_pill").catch(console.error);
      emitTo("pill", "pill-recording", { recording: true }).catch(() => {});
      emitTo("pill", "pill-state", { state: "recording" }).catch(() => {});
      // Per-app context for the pill only. The transcript's own profile is
      // resolved after the recording stops, when it is actually needed.
      fetchActiveAppProfile().then((p) => void emitPillContext(p));
      try { await startRecording(); } catch (e) { console.error("Failed to start recording:", e); }
    };

    listen("f8-start", () => {
      void handleF8Start();
    }).then((u) => unlisten.push(u));

    const handleF8Stop = async () => {
      if (!f8HotkeyDown) return;
      f8HotkeyDown = false;
      const now = Date.now();
      if (f8IgnoreNextUp.current) { f8IgnoreNextUp.current = false; f8LastUp.current = now; return; }
      const downDur = now - f8LastDown.current;
      f8LastUp.current = now;
      // Hands-free stays recording on release
      if (f8HandsFree.current) return;
      // Hold (>300ms) → immediate finish
      if (downDur > 300) {
        playStopSound();
        useStore.getState().setRecording(false);
        useStore.getState().setActiveMode(null);
        emitTo("pill", "pill-recording", { recording: false }).catch(() => {});
        emitTo("pill", "pill-state", { state: "processing" }).catch(() => {});
        invoke("hide_recording_pill").catch(console.error);
        await finishF8();
        return;
      }
      // Tap (<300ms) → wait for possible double-tap before finishing
      if (f8TapTimer.current) clearTimeout(f8TapTimer.current);
      // Keep recording during the double-tap window (so second tap can keep it)
      f8TapTimer.current = setTimeout(async () => {
        f8TapTimer.current = null;
        // No double → finish as normal tap
        if (f8HandsFree.current) return;
        playStopSound();
        useStore.getState().setRecording(false);
        useStore.getState().setActiveMode(null);
        emitTo("pill", "pill-recording", { recording: false }).catch(() => {});
        emitTo("pill", "pill-state", { state: "processing" }).catch(() => {});
        invoke("hide_recording_pill").catch(console.error);
        await finishF8();
      }, 380);
    };

    listen("f8-stop", () => {
      void handleF8Stop();
    }).then((u) => unlisten.push(u));

    // F9 — hold (or tap) = ask AI. The plain side panel is on its own
    // binding (default Ctrl+F9), not a F9 double-tap.
    const handleF9Start = async () => {
      if (f9HotkeyDown) return;
      f9HotkeyDown = true;
      const now = Date.now();
      if (useStore.getState().isRecording) return;
      // Safety: a stale tap timer must never outlive its window.
      if (f9TapTimer.current) { clearTimeout(f9TapTimer.current); f9TapTimer.current = null; }
      f9LastDown.current = now;
      f9StartTime.current = now;
      playStartSound();
      useStore.getState().setRecording(true);
      useStore.getState().setActiveMode("f9");
      // If history view is open, close it immediately so the next F9 appends to the re-opened chat visibly
      emitTo("overlay", "overlay-close-history").catch(() => {});
      invoke("show_recording_pill").catch(console.error);
      emitTo("pill", "pill-recording", { recording: true }).catch(() => {});
      emitTo("pill", "pill-state", { state: "recording" }).catch(() => {});
      // Pill shows which app the question is asked from (icon only, no prompt change).
      fetchActiveAppProfile().then((p) => {
        void emitPillContext(p);
      });
      try {
        await startRecording();
      } catch (e) {
        console.error("Failed to start recording:", e);
      }
    };

    listen("f9-start", () => {
      void handleF9Start();
    }).then((u) => unlisten.push(u));

    // Transform selection (F10) — copy selection, record spoken instruction,
    // run ONE dedicated transformer call, sanitize, then replace the selection.
    // F8/F9 pipelines above are intentionally untouched.
    let transformSelectionClipboard = "";
    let transformOriginalClipboard: string | null = null;
    let transformBusy = false;
    /** Key-down timestamp of the current F10 hold (for pill dwell). */
    let transformStartTime = 0;
    /** When the processing phase began (for the processing minimum). */
    let transformProcessingStart = 0;
    /** Per-app profile of the foreground app where the transform started. */
    let transformAppProfile: AppProfile = APP_PROFILES.generic;

    const restoreF10Clipboard = async () => {
      const { settings } = useStore.getState();
      try {
        if (settings.preserveClipboard && transformOriginalClipboard !== null) {
          await writeText(transformOriginalClipboard);
        }
      } catch (e) {
        console.error("Failed to restore clipboard:", e);
      }
    };

    const toastF10 = async (message: string, status: "error" | "info" = "error") => {
      try {
        await emitTo("pill", "show-toast", { message, status });
      } catch {}
    };

    const handleTransformStart = async () => {
      if (transformHotkeyDown) return;
      transformHotkeyDown = true;
      // Re-entrancy guard: F10 hold while already recording/transforming = ignore.
      if (transformBusy || useStore.getState().isRecording) return;
      transformBusy = true;
      transformStartTime = Date.now();
      playStartSound();
      useStore.getState().setRecording(true);
      useStore.getState().setActiveMode("transform");

      invoke("show_recording_pill").catch(console.error);
      emitTo("pill", "pill-recording", { recording: true }).catch(() => {});
      emitTo("pill", "pill-state", { state: "recording" }).catch(() => {});
      // Per-app context captured up-front while the target app has focus.
      fetchActiveAppProfile().then((p) => {
        transformAppProfile = p;
        void emitPillContext(p);
      });

      try {
        // Preserve the user's existing clipboard so it can be restored later
        try {
          transformOriginalClipboard = await readText();
        } catch {
          transformOriginalClipboard = null;
        }

        // Clear-then-copy: empty the clipboard BEFORE Ctrl+C so ANY non-empty
        // read afterwards is provably the fresh selection. The old
        // `captured !== before` check could not tell "copy succeeded but the
        // selection was already in the clipboard" (common with short snippets)
        // apart from "copy failed" — and aborted both as "Copy failed".
        let cleared = false;
        try {
          await writeText("");
          cleared = true;
        } catch {
          cleared = false;
        }
        const before = cleared ? "" : (transformOriginalClipboard ?? "");

        // Fast + reliable capture: fire Ctrl+C and start the mic IN PARALLEL,
        // poll with early exit (max ~400ms). A value seen twice in a row is
        // stable (clipboard writes are async); a single sighting is still
        // accepted when the loop exhausts.
        await invoke("simulate_copy");
        const recordPromise = startRecording().catch((e: unknown) => {
          console.error("Failed to start transform recording:", e);
          throw e;
        });
        let captured = "";
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 50));
          let cur = "";
          try {
            cur = (await readText()) || "";
          } catch {
            continue;
          }
          if (!cur) continue;
          if (!cleared && cur === before) continue; // stale clipboard, keep waiting
          if (cur === captured) break; // stable — seen twice
          captured = cur;
        }
        transformSelectionClipboard = captured;
        await recordPromise;

        if (!transformSelectionClipboard.trim()) {
          // Nothing selected — stop the mic we just started, don't hold voice.
          try { await stopRecording(); } catch {}
          transformBusy = false;
          useStore.getState().setRecording(false);
          useStore.getState().setActiveMode(null);
          try { await invoke("set_pill_state", { state: "idle" }); } catch {}
          try { await emitTo("pill", "pill-state", { state: "idle" }); } catch {}
          await toastF10("Select some text first");
          await restoreF10Clipboard();
          return;
        }
      } catch (e) {
        console.error("Failed to start transform recording:", e);
        try { await stopRecording(); } catch {}
        transformBusy = false;
        useStore.getState().setRecording(false);
        useStore.getState().setActiveMode(null);
        // Clipboard may already be cleared above — give the user theirs back.
        await restoreF10Clipboard();
      }
    };

    listen("transform-start", () => {
      void handleTransformStart();
    }).then((u) => unlisten.push(u));

    const handleTransformStop = async () => {
      if (!transformHotkeyDown) return;
      transformHotkeyDown = false;
      if (!transformBusy) {
        try { await stopRecording(); } catch {}
        return;
      }
      // Quick-tap smoothing (mirrors F9): rest the waveform briefly before
      // flipping to processing, so a single click never strobes past it.
      // Holds already exceed this; recording keeps running through the wait.
      const tapElapsed = Date.now() - transformStartTime;
      if (transformStartTime > 0 && tapElapsed < 380) {
        await new Promise((r) => setTimeout(r, 380 - tapElapsed));
      }
      playStopSound();
      useStore.getState().setRecording(false);
      useStore.getState().setActiveMode(null);
      emitTo("pill", "pill-recording", { recording: false }).catch(() => {});
      emitTo("pill", "pill-state", { state: "processing" }).catch(() => {});
      invoke("hide_recording_pill").catch(console.error);
      transformProcessingStart = Date.now();
      const state = useStore.getState();
      const { settings, dictionary } = state;

      try {
        const blob = await stopRecording();

        // Authoritative selection: the polled capture was verified at
        // key-down time (clipboard was cleared first, so any non-empty value
        // IS the selection). The live clipboard is only a fallback for a
        // late-landing copy — never an overwrite, since it may have changed
        // while the user was speaking.
        let selectionText = (transformSelectionClipboard || "").trim();
        if (!selectionText) {
          try {
            const live = ((await readText()) || "").trim();
            // Never fall back to the pre-existing clipboard content.
            if (live && live !== (transformOriginalClipboard ?? "").trim()) {
              selectionText = live;
            }
          } catch {}
        }
        selectionText = selectionText.trim();

        if (!selectionText) {
          console.warn("F10: no selected text captured");
          await toastF10("Select some text first");
          await restoreF10Clipboard();
          return;
        }
        if (selectionText.length > F10_MAX_SELECTION_CHARS) {
          console.warn("F10: selection too long", selectionText.length);
          await toastF10(`Selection too long (${selectionText.length} chars, max ${F10_MAX_SELECTION_CHARS})`);
          await restoreF10Clipboard();
          return;
        }
        // Capture was clear-then-copy verified, so any non-empty value here
        // is the user's selection — no same-as-clipboard ambiguity remains.

        const sttT = getSttTarget(settings);
        if (!sttT) {
          await toastF10("Set up voice in Models - add a key or download the on-device model");
          await restoreF10Clipboard();
          return;
        }

        // Spoken instruction. Relevance computed ONCE and reused for STT
        // vocab + system prompt (was two Levenshtein passes). No polish —
        // this text feeds the transform prompt.
        const relevantForTransform = selectRelevantEntries(selectionText, dictionary);
        const sttVocab = relevantForTransform.length
          ? buildWhisperDictionaryPrompt(relevantForTransform)
          : "";
        let instruction = "";
        try {
          instruction = (
            await transcribeWithProvider(settings, blob, {
              prompt: sttT.provider === "gemini" ? undefined : sttVocab || undefined,
              vocabHint: sttT.provider === "gemini" ? sttVocab || undefined : undefined,
            })
          ).trim();
        } catch (e) {
          console.error("Transform instruction transcribe error:", e);
          await restoreF10Clipboard();
          await toastF10("Couldn't hear the instruction — try again");
          return;
        }

        // Refused instruction (STT safety lecture) must NOT become the
        // transform instruction — that garbles the selection. Abort loudly.
        if (instruction && isLikelySafetyRefusal(instruction)) {
          console.warn("F10: instruction safety refusal, aborting:", instruction.slice(0, 200));
          await restoreF10Clipboard();
          await toastF10("Couldn't hear the instruction — try again");
          return;
        }

        // General-purpose default: silent/short instruction still fixes the text
        // instead of silently doing nothing.
        if (!instruction) {
          instruction = F10_DEFAULT_INSTRUCTION;
        }

        // Dedicated transformer prompt — never the F9 chat assistant prompt.
        // Reuses the cached relevance list (no second Levenshtein pass).
        // Per-app suffix tailors output to where the selection lives.
        let effectiveSystemPrompt = F10_SYSTEM_PROMPT;
        if (relevantForTransform.length) {
          effectiveSystemPrompt += formatDictionaryForPrompt(relevantForTransform);
        }
        if (transformAppProfile.f10Suffix) {
          effectiveSystemPrompt += `\nACTIVE APP CONTEXT (${transformAppProfile.label}): ${transformAppProfile.f10Suffix}`;
        }

        const userMessage = buildF10UserMessage(selectionText, instruction);

        const f10t = getF10Target(settings);
        const target = f10t ? { provider: f10t.provider, apiKey: f10t.key, model: f10t.model, keyLabel: getProviderLabel(f10t.provider) } : null;
        if (!target) {
          await toastF10("Add your AI provider API key in Models & providers");
          await restoreF10Clipboard();
          return;
        }

        // Same auto-fallback rule as F9: a blocked/rate-limited transform
        // retries on a same-tier model instead of losing the edit.
        let f10Fallbacks: string[] = [];
        if (target.provider === "openrouter") {
          const auto = pickOpenRouterFallback(target.model, await peekCatalog());
          if (auto && auto !== target.model) f10Fallbacks = [auto];
        }

        let rawResponse: string;
        try {
          rawResponse = await chatCompletion({
            provider: target.provider,
            apiKey: target.apiKey,
            model: target.model,
            baseUrl: getOllamaBaseUrl(settings),
            fallbacks: f10Fallbacks,
            systemPrompt: effectiveSystemPrompt,
            messages: [{ role: "user", content: userMessage }],
            temperature: 0,
            onToken: () => {},
          });
        } catch (e) {
          console.error("Transform AI error:", e);
          await restoreF10Clipboard();
          await toastF10(
            e instanceof Error && e.message
              ? `Transform failed — ${e.message.slice(0, 90)}`
              : "Transform failed — AI request error"
          );
          return;
        }

        let response = sanitizeF10Response(rawResponse, selectionText);
        if (response) {
          // Exact-case enforcement only: the model already got fuzzy variants
          // via the prompt. Fuzzy here corrupts code/URLs ("gmail" → "Gmail").
          response = resolveCustomVocabulary(response, dictionary, { fuzzy: false }).trim();
        }

        if (!response || isUnusableF10Result(response, selectionText)) {
          console.warn("F10: model returned unusable result:", rawResponse?.slice(0, 200));
          try {
            const record: TransformRecord = {
              id: crypto.randomUUID(),
              originalText: selectionText,
              instruction,
              resultText: "",
              timestamp: Date.now(),
              model: target.model,
              app: transformAppProfile.id,
            };
            useStore.getState().addTransform(record);
            await saveTransforms(useStore.getState().transforms);
          } catch (err) {
            console.error("Failed to save empty transform record:", err);
          }
          await restoreF10Clipboard();
          await toastF10("Transform failed — model didn't return text");
          return;
        }

        // Already-clean text: don't churn the clipboard/focus with a no-op paste.
        if (response.trim() === selectionText) {
          try {
            const record: TransformRecord = {
              id: crypto.randomUUID(),
              originalText: selectionText,
              instruction,
              resultText: response,
              timestamp: Date.now(),
              model: target.model,
              app: transformAppProfile.id,
            };
            useStore.getState().addTransform(record);
            await saveTransforms(useStore.getState().transforms);
          } catch (err) {
            console.error("Failed to save transform:", err);
          }
          await restoreF10Clipboard();
          return;
        }

        // Persist first so history survives even if paste fails below.
        try {
          const record: TransformRecord = {
            id: crypto.randomUUID(),
            originalText: selectionText,
            instruction,
            resultText: response,
            timestamp: Date.now(),
            model: target.model,
            app: transformAppProfile.id,
          };
          useStore.getState().addTransform(record);
          await saveTransforms(useStore.getState().transforms);
        } catch (err) {
          console.error("Failed to save transform:", err);
        }

        try {
          await pasteForApp(transformAppProfile, response);
          // Fixed short delay: Ctrl+V lands in well under 150ms.
          await new Promise((r) => setTimeout(r, 150));
          await restoreF10Clipboard();
        } catch (e) {
          // Pasting failed: keep the result in the clipboard (don't restore
          // over the user's only copy) and say so.
          console.error("F10 paste failed, keeping result in clipboard:", e);
          await toastF10("Transform ready — paste failed, result kept in clipboard");
        }
      } catch (e) {
        console.error("Transform error:", e);
        await restoreF10Clipboard();
        await toastF10("Transform failed");
      } finally {
        // Settle fast paths like F9: minimum dwell + processing time so a
        // quick tap reads as intentional instead of flashing open/closed.
        // Long flows already exceed both minimums (no added delay).
        const nowTs = Date.now();
        const dwellWait =
          transformStartTime > 0
            ? MIN_PILL_DWELL_MS - (nowTs - transformStartTime)
            : 0;
        const procWait =
          transformProcessingStart > 0
            ? MIN_PROC_MS - (nowTs - transformProcessingStart)
            : 0;
        const settleWait = Math.max(dwellWait, procWait, 0);
        if (settleWait > 0) {
          await new Promise((r) => setTimeout(r, settleWait));
        }
        transformBusy = false;
        transformStartTime = 0;
        transformProcessingStart = 0;
        transformSelectionClipboard = "";
        try { await invoke("set_pill_state", { state: "idle" }); } catch {}
        try { await emitTo("pill", "pill-state", { state: "idle" }); } catch {}
      }
    };

    listen("transform-stop", () => {
      void handleTransformStop();
    }).then((u) => unlisten.push(u));

    // Pill UI interaction: hands-free mode start (mic wave -> X / wave / ✓)
    listen("pill-start-handsfree", async () => {
      f8HandsFree.current = true;
      const st = useStore.getState();
      st.setActiveMode("f8");
      st.setRecording(true);
      emitTo("pill", "pill-recording", { recording: true }).catch(() => {});
      emitTo("pill", "pill-state", { state: "handsfree" }).catch(() => {});
      invoke("set_pill_state", { state: "handsfree" } as unknown as { state: string }).catch(() => {});
      try { await startRecording(); } catch (e) { console.error(e); }
    }).then((u) => unlisten.push(u));

    listen("pill-click-record", async () => {
      playStartSound();
      const st = useStore.getState();
      if (st.isRecording) return;
      st.setRecording(true);
      st.setActiveMode("f8");
      f8HandsFree.current = true;
      // Hands-free: X left / wave / ✓ right, stays recording until tick or F8 double-press confirm
      emitTo("pill", "pill-state", { state: "handsfree" }).catch(() => {});
      invoke("set_pill_state", { state: "handsfree" } as unknown as { state: string }).catch(() => {});
      try { await startRecording(); } catch (e) { console.error(e); }
    }).then((u) => unlisten.push(u));

    listen("pill-confirm", async () => {
      playConfirmSound();
      f8HandsFree.current = false;
      if (f8TapTimer.current) { clearTimeout(f8TapTimer.current); f8TapTimer.current = null; }
      if (!useStore.getState().isRecording) return;
      useStore.getState().setRecording(false);
      useStore.getState().setActiveMode(null);
      emitTo("pill", "pill-state", { state: "processing" }).catch(() => {});
      invoke("set_pill_state", { state: "processing" } as unknown as { state: string }).catch(() => {});
      try {
        // Hands-free confirm: paste directly, clipboard left as-is.
        await transcribeAndPasteF8(false, ++f8RunId.current);
      } catch (e) { console.error(e); try { await emitTo("pill", "show-toast", { message: "Transcription failed", status: "error" }); } catch {} }
      try { await invoke("set_pill_state", { state: "idle" }); } catch {}
      try { await emitTo("pill", "pill-state", { state: "idle" }); } catch {}
    }).then((u) => unlisten.push(u));

    listen("pill-cancel", async () => {
      playCancelSound();
      f8HandsFree.current = false;
      if (f8TapTimer.current) { clearTimeout(f8TapTimer.current); f8TapTimer.current = null; }
      if (!useStore.getState().isRecording) {
        try { await invoke("set_pill_state", { state: "idle" }); } catch {}
        try { await emitTo("pill", "pill-state", { state: "idle" }); } catch {}
        return;
      }
      useStore.getState().setRecording(false);
      useStore.getState().setActiveMode(null);
      try { await stopRecording(); } catch {}
      try { await invoke("set_pill_state", { state: "idle" }); } catch {}
      try { await emitTo("pill", "pill-state", { state: "idle" }); } catch {}
    }).then((u) => unlisten.push(u));

    const runF9Chat = async (question: string) => {
      const state = useStore.getState();
      const { settings, activeChatId, aiSessions, f9SkipResume } = state;
      const continuous = settings.f9ContinuousChat;
      const imageDataUrl = f9Screenshot.current ?? undefined;
      // Cached catalog read for auto-fallback selection — disk-first, so a
      // voice turn never waits on the network for it.
      const orCatalogSnapshot =
        settings.f9Provider === "openrouter" || settings.aiProvider === "openrouter"
          ? await peekCatalog()
          : [];

      let existing: AiSession | null = null;
      if (continuous && !f9SkipResume) {
        existing = findResumableSession(aiSessions, activeChatId);
        if (existing && existing.id !== activeChatId) {
          state.setActiveChatId(existing.id);
        }
        if (activeChatId && !existing) {
          state.setActiveChatId(null);
        }
      }

      const priorMessages = existing?.messages ?? [];

      // Fail fast on missing key BEFORE showing the overlay (previously the
      // empty overlay flashed first, then the toast).
      const f9t = getF9Target(settings);
      const target = f9t ? { provider: f9t.provider, apiKey: f9t.key, model: f9t.model, keyLabel: getProviderLabel(f9t.provider) } : null;
      if (!target) {
        try {
          await emitTo("pill", "show-toast", {
            message: `Add your ${getProviderLabel(f9t?.provider || settings.aiProvider)} API key in Models & providers`,
            status: "error",
          });
        } catch {}
        return;
      }

      if (imageDataUrl) {
        // Tri-state: true/false when we know, null when the catalog can't
        // tell us. Unknown must NOT block the turn — a stale catalog used to
        // reject perfectly good vision models before we ever tried them.
        let supportsImages: boolean | null = null;
        try {
          if (target.provider === "groq") {
            supportsImages = isGroqVisionModel(
              await fetchGroqModels(target.apiKey),
              target.model
            );
          } else if (target.provider === "openrouter") {
            supportsImages = supportsOpenRouterImages(
              target.model,
              await fetchOpenRouterCatalog()
            );
          } else if (target.provider === "gemini") {
            supportsImages = target.model.startsWith("gemini-");
          } else if (target.provider === "openai") {
            supportsImages = /^gpt-(4o|4\.1)(-|$)/i.test(target.model);
          } else if (target.provider === "ollama") {
            supportsImages = isOllamaVisionModel(
              await fetchOllamaModels(getOllamaBaseUrl(settings)),
              target.model
            );
          }
        } catch (error) {
          // Catalog unreachable — try the call anyway and let the provider
          // be the judge instead of failing a possibly-valid request.
          console.warn("Could not verify image support, trying anyway:", error);
          supportsImages = null;
        }
        if (supportsImages === false) {
          try {
            await emitTo("pill", "show-toast", {
              message: "The selected model cannot analyze images. Choose a Vision model in Models.",
              status: "error",
            });
          } catch {}
          return;
        }
      }

      // Store the screenshot as a file before the turn so the session holds a
      // filename rather than a base64 blob. The data URL is still used for
      // this turn's request; if saving fails we fall back to it so the turn
      // still works and the session simply keeps the inline image.
      let storedRef: string | undefined;
      if (imageDataUrl) {
        try {
          storedRef = await saveScreenshot(imageDataUrl, "f9");
        } catch (error) {
          console.error("Could not store the screenshot to disk:", error);
          storedRef = imageDataUrl;
        }
      }

      const pendingMessages = buildPendingMessages(
        priorMessages,
        question,
        storedRef
      );
      const apiMessages = await buildApiConversation(
        priorMessages,
        question,
        imageDataUrl
      );

      // Ensure history view is closed and overlay is synced before becoming visible — prevents previous chat flashing
      const overlayInitPromise = (async () => {
        await emitTo("overlay", "overlay-close-history").catch(() => {});
        await syncOverlayChat(invoke, continuous, pendingMessages);
        await invoke("show_overlay");
        await emitTo("overlay", "overlay-model", target.model).catch(
          console.error
        );
      })();

      const effectiveSystemPrompt = settings.systemPrompt;

      // OpenRouter: primary + one auto-picked fallback so a blocked,
      // rate-limited, or down model doesn't end the turn. The fallback is
      // always a same-tier model (free stays free) and, for screenshot
      // turns, one that can actually read an image.
      const orFallbacks: string[] =
        target.provider === "openrouter"
          ? (() => {
              try {
                const auto = pickOpenRouterFallback(
                  target.model,
                  orCatalogSnapshot,
                  { needsVision: !!imageDataUrl }
                );
                return auto && auto !== target.model ? [auto] : [];
              } catch {
                return [];
              }
            })()
          : [];

      await overlayInitPromise;

      // Provider chat: tokens flow into the overlay as they arrive
      // (Groq/OpenAI stream; Gemini delivers once). The pending user
      // turn is already visible.
      let response = "";
      try {
        response = await chatCompletion({
          provider: target.provider,
          apiKey: target.apiKey,
          model: target.model,
          baseUrl: getOllamaBaseUrl(settings),
          fallbacks: orFallbacks,
          systemPrompt: effectiveSystemPrompt,
          messages: apiMessages,
          onToken: (token) => {
            invoke("overlay_append_token", { token }).catch(console.error);
          },
        });
      } catch (e) {
        console.error("F9 chat error:", e);
        await invoke("overlay_stream_end");
        const message =
          e instanceof Error && e.message ? e.message : "AI request failed";
        try {
          await emitTo("pill", "show-toast", {
            message: imageDataUrl
              ? `${message} (if you attached a screenshot, the model may not accept images)`
              : message,
            status: "error",
          });
        } catch {}
        return;
      }

      await invoke("overlay_stream_end");

      const session = buildSessionAfterTurn(
        existing,
        question,
        response,
        target.model,
        continuous,
        imageDataUrl
      );

      if (existing) {
        state.updateAiSession(existing.id, session);
      } else {
        state.addAiSession(session);
      }

      if (continuous) {
        state.setActiveChatId(session.id);
      } else {
        state.setActiveChatId(null);
      }
      if (f9SkipResume) {
        state.setF9SkipResume(false);
      }

      await saveAiSessions(useStore.getState().aiSessions);
      await syncOverlayChat(
        invoke,
        continuous,
        session.messages
      );
      if (imageDataUrl && f9Screenshot.current === imageDataUrl) {
        f9Screenshot.current = null;
        await emitTo("overlay", "f9-image-consumed").catch(console.error);
      }
    };

    // Shared settle: minimum dwell + processing time, then idle. Fast paths
    // read as intentional (F8-like); long flows already exceed both minimums.
    const settleF9Pill = async () => {
      const now = Date.now();
      const dwell = now - f9StartTime.current;
      const proc = now - f9ProcessingStart.current;
      const wait = Math.max(
        f9StartTime.current > 0 ? MIN_PILL_DWELL_MS - dwell : 0,
        f9ProcessingStart.current > 0 ? MIN_PROC_MS - proc : 0,
        0
      );
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try { await invoke("set_pill_state", { state: "idle" }); } catch {}
      try { await emitTo("pill", "pill-state", { state: "idle" }); } catch {}
    };

    // Panel binding (default Ctrl+F9): plain side panel, no AI turn.
    let panelOpening = false;
    const showPlainOverlay = async () => {
      if (panelOpening) return;
      panelOpening = true;
      try {
      const state = useStore.getState();
      const { settings, activeChatId, aiSessions, f9SkipResume } = state;
      const continuous = settings.f9ContinuousChat;
      let existing: AiSession | null = null;
      if (continuous && !f9SkipResume) {
        existing = findResumableSession(aiSessions, activeChatId);
        if (existing && existing.id !== activeChatId) {
          state.setActiveChatId(existing.id);
        }
        if (activeChatId && !existing) {
          state.setActiveChatId(null);
        }
      }
      const messages = existing?.messages ?? [];
      await emitTo("overlay", "overlay-close-history").catch(() => {});
      await syncOverlayChat(invoke, continuous, messages);
      await invoke("show_overlay");
      const ovModel = getF9Target(settings)?.model ?? settings.model;
      await emitTo("overlay", "overlay-model", ovModel).catch(console.error);
      } finally {
        panelOpening = false;
      }
    };

    listen("panel-start", () => {
      void showPlainOverlay();
    }).then((u) => unlisten.push(u));

    const finishF9 = async () => {
      try {
        const blob = await stopRecording();
        try {
        const liveSettings = useStore.getState().settings;
        const qStt = getSttTarget(liveSettings);
        if (!qStt) {
          invoke("overlay_stream_end").catch(console.error);
          try {
            await emitTo("pill", "show-toast", { message: `Set up voice in Models - add a key or download the on-device model`, status: "error" });
          } catch {}
          return;
        }
        let question = "";
        try {
          // Same Whisper vocab bias as F8 so custom words survive in questions.
          const vocab = buildWhisperDictionaryPrompt(useStore.getState().dictionary);
          const isGem = qStt.provider === "gemini";
          question = (
            await transcribeWithProvider(liveSettings, blob, {
              prompt: isGem ? undefined : vocab || undefined,
              vocabHint: isGem ? vocab || undefined : undefined,
            })
          ).trim();
        } catch (e) {
          console.error("F9 transcribe error:", e);
          invoke("overlay_stream_end").catch(console.error);
          try {
            await emitTo("pill", "show-toast", { message: "Transcription failed", status: "error" });
          } catch {}
          return;
        }

        if (question) {
          await runF9Chat(question);
        } else {
          try {
            await emitTo("pill", "show-toast", { message: "Didn't catch that — try again", status: "error" });
          } catch {}
        }
        } finally {
          await settleF9Pill();
        }
      } catch (e) {
        console.error("F9 error:", e);
        invoke("overlay_stream_end").catch(console.error);
      }
    };

    const handleF9Stop = async () => {
      if (!f9HotkeyDown) return;
      f9HotkeyDown = false;
      const now = Date.now();
      // Stray release (e.g. after the overlay already stopped us).
      if (!useStore.getState().isRecording && !f9TapTimer.current) {
        return;
      }
      const downDur = now - f9LastDown.current;
      const beginProcessing = () => {
        playStopSound();
        useStore.getState().setRecording(false);
        useStore.getState().setActiveMode(null);
        emitTo("pill", "pill-recording", { recording: false }).catch(() => {});
        emitTo("pill", "pill-state", { state: "processing" }).catch(() => {});
        invoke("hide_recording_pill").catch(console.error);
        f9ProcessingStart.current = Date.now();
      };
      // Hold (>300ms) → immediate finish
      if (downDur > 300) {
        if (f9TapTimer.current) { clearTimeout(f9TapTimer.current); f9TapTimer.current = null; }
        beginProcessing();
        await finishF9();
        return;
      }
      // Tap (<300ms) → wait for possible double-click before finishing
      if (f9TapTimer.current) clearTimeout(f9TapTimer.current);
      // Keep recording during the double-tap window (so second tap can open
      // the plain panel instead).
      f9TapTimer.current = setTimeout(async () => {
        f9TapTimer.current = null;
        beginProcessing();
        await finishF9();
      }, 380);
    };

    listen("f9-stop", () => {
      void handleF9Stop();
    }).then((u) => unlisten.push(u));

    listen<boolean>("f9-continuous-changed", async (event) => {
      const enabled = event.payload;
      const store = useStore.getState();
      store.setSettings({ f9ContinuousChat: enabled });
      await saveSettings(useStore.getState().settings);
      if (!enabled) {
        store.setActiveChatId(null);
        return;
      }
      if (!store.activeChatId && !store.f9SkipResume) {
        const recent = findResumableSession(store.aiSessions, null);
        if (recent) {
          store.setActiveChatId(recent.id);
          store.updateAiSession(recent.id, { continuous: true });
          await saveAiSessions(useStore.getState().aiSessions);
        }
      }
    }).then((u) => unlisten.push(u));

    const resetContinuousChat = () => {
      const store = useStore.getState();
      store.setActiveChatId(null);
      store.setF9SkipResume(true);
      invoke("overlay_sync_chat", {
        continuous: store.settings.f9ContinuousChat,
        messages: [],
      }).catch(console.error);
    };

    listen("f9-new-chat", () => {
      f9Screenshot.current = null;
      emitTo("overlay", "f9-image-cleared").catch(console.error);
      resetContinuousChat();
    }).then((u) => unlisten.push(u));

    listen<string>("f9-model-changed", async (event) => {
      const nextModel = event.payload;
      const store = useStore.getState();
      const updated = { ...store.settings, model: nextModel };
      store.setSettings(updated);
      await saveSettings(updated);
    }).then((u) => unlisten.push(u));

    listen("f9-overlay-escaped", () => {
      if (useStore.getState().settings.f9ContinuousChat) {
        resetContinuousChat();
      }
    }).then((u) => unlisten.push(u));

    // Overlay drawer: provide chat history and handle session selection
    const pushSessionsToOverlay = async () => {
      const { aiSessions } = useStore.getState();
      const payload = aiSessions.slice(0, 80).map((s) => ({
        id: s.id,
        timestamp: s.timestamp,
        model: s.model,
        title: getFirstUserMessage(s),
        preview: stripThinkingBlocks(getLastAssistantMessage(s)),
        turns: countUserMessages(s),
      }));
      await emitTo("overlay", "overlay-sessions", payload).catch(() => {});
    };

    listen("overlay-request-sessions", () => {
      void pushSessionsToOverlay();
    }).then((u) => unlisten.push(u));

    listen<string>("overlay-select-session", async (event) => {
      const id = event.payload;
      const store = useStore.getState();
      const session = store.aiSessions.find((s) => s.id === id);
      if (!session) return;
      // Switch to that session and ensure Chat on so follow-ups continue it
      const shouldEnableContinuous = !store.settings.f9ContinuousChat;
      if (shouldEnableContinuous) {
        const updated = { ...store.settings, f9ContinuousChat: true };
        store.setSettings(updated);
        await saveSettings(updated);
      }
      store.setActiveChatId(session.id);
      store.setF9SkipResume(false);
      await syncOverlayChat(invoke, true, session.messages);
      await invoke("show_overlay").catch(() => {});
      // Push refreshed list (highlights current)
      await pushSessionsToOverlay();
    }).then((u) => unlisten.push(u));

    // Keep overlay drawer warm when sessions change from main window
    // Do an initial push after listeners are ready
    setTimeout(() => void pushSessionsToOverlay(), 800);

    const handleLocalHotkeyKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;

      const hotkeys = getCurrentHotkeys();
      if (keyboardEventMatchesBinding(event, hotkeys.transcribe)) {
        event.preventDefault();
        event.stopPropagation();
        void handleF8Start();
        return;
      }
      if (keyboardEventMatchesBinding(event, hotkeys.askAi)) {
        event.preventDefault();
        event.stopPropagation();
        void handleF9Start();
        return;
      }
      if (keyboardEventMatchesBinding(event, hotkeys.transform)) {
        event.preventDefault();
        event.stopPropagation();
        void handleTransformStart();
        return;
      }
      if (keyboardEventMatchesBinding(event, hotkeys.panel)) {
        event.preventDefault();
        event.stopPropagation();
        void showPlainOverlay();
      }
    };

    const handleLocalHotkeyKeyUp = (event: KeyboardEvent) => {
      const hotkeys = getCurrentHotkeys();
      if (keyboardEventMatchesBinding(event, hotkeys.transcribe)) {
        event.preventDefault();
        event.stopPropagation();
        void handleF8Stop();
        return;
      }
      if (keyboardEventMatchesBinding(event, hotkeys.askAi)) {
        event.preventDefault();
        event.stopPropagation();
        void handleF9Stop();
        return;
      }
      if (keyboardEventMatchesBinding(event, hotkeys.transform)) {
        event.preventDefault();
        event.stopPropagation();
        void handleTransformStop();
      }
    };

    window.addEventListener("keydown", handleLocalHotkeyKeyDown);
    window.addEventListener("keyup", handleLocalHotkeyKeyUp);

    return () => {
      window.removeEventListener("keydown", handleLocalHotkeyKeyDown);
      window.removeEventListener("keyup", handleLocalHotkeyKeyUp);
      unlisten.forEach((u) => u());
    };
  }, []);

  // Keep overlay drawer in sync when main creates new sessions
  const sessionsForOverlay = useStore((s) => s.aiSessions);
  useEffect(() => {
    const payload = sessionsForOverlay.slice(0, 80).map((s) => ({
      id: s.id,
      timestamp: s.timestamp,
      model: s.model,
      title: getFirstUserMessage(s),
      preview: stripThinkingBlocks(getLastAssistantMessage(s)),
      turns: countUserMessages(s),
    }));
    emitTo("overlay", "overlay-sessions", payload).catch(() => {});
  }, [sessionsForOverlay]);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!onboardingDone) {
    return (
      <>
        <Titlebar />
        <Onboarding />
      </>
    );
  }

  return (
    <>
      <Titlebar />
      <div className="appShell">
        <Sidebar />
        <main className="content">
          <PageRouter />
        </main>
      </div>
    </>
  );
}

export default App;
