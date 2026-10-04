import { useEffect, useRef, useState, type ReactElement } from "react";
import { openUrl as openExternalUrl } from "@tauri-apps/plugin-opener";
import { useStore } from "../store";
import { saveSettings } from "../persistence";
import { requestMicrophonePermission } from "../recorder";
import { setAutostartEnabled } from "../autostart";
import { LEGAL_VERSION } from "../types";
import type { UserSettings } from "../types";
import { validateOpenRouterKey } from "../openrouter";
import {
  GroqLogo,
  OpenAiLogo,
  GeminiLogo,
  OpenRouterLogo,
} from "../pages/Models";

/**
 * 8-page onboarding (split + full-bleed + banner layouts, branded artwork).
 * 0 = name, 1-3 = F8/F9/F10 explainers, 4 = microphone, 5 = API keys,
 * 6 = autostart, 7 = terms + launch.
 * All nav buttons share one fixed action zone so the cursor never moves.
 * App behavior is unchanged: same settings written, same gates.
 */
const TOTAL_STEPS = 7; // steps 1–7 show progress; step 0 is the welcome gate

type KeyStatus = { state: "idle" | "testing" | "ok" | "fail"; message?: string };

type ApiProviderId = "groq" | "openai" | "gemini" | "openrouter";

interface ApiProviderDef {
  id: ApiProviderId;
  label: string;
  placeholder: string;
  Logo: () => ReactElement;
  test: (key: string) => Promise<{ ok: boolean; message?: string }>;
}

function CheckBadge() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M8 12.5 11 15.5 16.5 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertBadge() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7.5v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="16.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

async function testHttpKey(url: string, key: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) return { ok: true };
    return {
      ok: false,
      message:
        res.status === 401
          ? "Invalid key (401) — check for typos"
          : `Request failed (${res.status}) — try again`,
    };
  } catch {
    return { ok: false, message: "Network error — check your connection" };
  }
}

const API_PROVIDERS: ApiProviderDef[] = [
  {
    id: "groq",
    label: "Groq",
    placeholder: "gsk_...",
    Logo: GroqLogo,
    test: (key) => testHttpKey("https://api.groq.com/openai/v1/models", key),
  },
  {
    id: "openai",
    label: "ChatGPT",
    placeholder: "sk-...",
    Logo: OpenAiLogo,
    test: (key) => testHttpKey("https://api.openai.com/v1/models", key),
  },
  {
    id: "gemini",
    label: "Gemini",
    placeholder: "AIza...",
    Logo: GeminiLogo,
    test: async (key) => {
      try {
        const res = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models",
          { headers: { "x-goog-api-key": key } }
        );
        if (res.ok) return { ok: true };
        return {
          ok: false,
          message:
            res.status === 400 || res.status === 401 || res.status === 403
              ? "Invalid key — check for typos"
              : `Request failed (${res.status}) — try again`,
        };
      } catch {
        return { ok: false, message: "Network error — check your connection" };
      }
    },
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    placeholder: "sk-or-...",
    Logo: OpenRouterLogo,
    test: async (key) => {
      const result = await validateOpenRouterKey(key);
      return result.ok
        ? { ok: true }
        : { ok: false, message: result.error ?? "Invalid key" };
    },
  },
];

const FEATURE_PAGES = [
  {
    image: "/onboarding/f8_banner.webp",
    badge: "F8",
    title: "Dictate anywhere",
    desc: "Hold F8 and just speak — Flunkey types where your cursor is, in any app. Perfect for emails, docs, and chat. Double-tap F8 for hands-free mode.",
  },
  {
    image: "/onboarding/f9_banner.webp",
    badge: "F9",
    title: "Ask the AI",
    desc: "Hold F9 and ask anything — answers stream into the side panel. Your chats are saved, so follow-ups keep full context. Press Ctrl + F9 to open the empty side panel, attach a screenshot, or browse past chats.",
  },
  {
    image: "/onboarding/f10_banner.webp",
    badge: "F10",
    title: "Transform text",
    desc: "Select any text, hold F10, and say the edit — fix grammar, make it formal, or translate. The selection is replaced in place.",
  },
];

export function Onboarding() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);

  const [step, setStep] = useState(0);
  const [name, setName] = useState(settings.name ?? "");
  const [nickname, setNickname] = useState(settings.nickname ?? "");
  const [keys, setKeys] = useState<Record<ApiProviderId, string>>({
    groq: settings.groqApiKey ?? "",
    openai: settings.openaiApiKey ?? "",
    gemini: settings.geminiApiKey ?? "",
    openrouter: settings.openRouterApiKey ?? "",
  });
  const [keyStatus, setKeyStatus] = useState<Record<ApiProviderId, KeyStatus>>({
    groq: { state: "idle" },
    openai: { state: "idle" },
    gemini: { state: "idle" },
    openrouter: { state: "idle" },
  });
  const [showKeys, setShowKeys] = useState<Record<ApiProviderId, boolean>>({
    groq: false,
    openai: false,
    gemini: false,
    openrouter: false,
  });
  const [micPermission, setMicPermission] = useState<
    "unknown" | "requesting" | "granted" | "denied"
  >("unknown");
  const [autoStart, setAutoStart] = useState(true);
  const [legalAccepted, setLegalAccepted] = useState(
    settings.legalAcceptedVersion === LEGAL_VERSION
  );
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move screen-reader/keyboard focus to the step heading on change.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (!navigator.permissions?.query) return;
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((status) => {
        if (status.state === "granted") setMicPermission("granted");
        else if (status.state === "denied") setMicPermission("denied");
      })
      .catch(() => {});
  }, []);

  const handleRequestMic = async () => {
    setMicPermission("requesting");
    const granted = await requestMicrophonePermission();
    setMicPermission(granted ? "granted" : "denied");
  };

  const setKeyValue = (id: ApiProviderId, value: string) => {
    setKeys((prev) => ({ ...prev, [id]: value }));
    setKeyStatus((prev) => ({ ...prev, [id]: { state: "idle" } }));
  };

  const testKey = async (id: ApiProviderId) => {
    const def = API_PROVIDERS.find((p) => p.id === id);
    const value = keys[id].trim();
    if (!def || !value) return;
    setKeyStatus((prev) => ({ ...prev, [id]: { state: "testing" } }));
    const result = await def.test(value);
    setKeyStatus((prev) => ({
      ...prev,
      [id]: result.ok
        ? { state: "ok" }
        : { state: "fail", message: result.message },
    }));
  };

  // Next on the API page: every filled row must have tested OK.
  const apiReady =
    API_PROVIDERS.every(
      (p) => !keys[p.id].trim() || keyStatus[p.id].state === "ok"
    ) && API_PROVIDERS.some((p) => keys[p.id].trim());

  const finishOnboarding = async () => {
    // Persist the actual autostart state (backend is source of truth).
    let appliedAutoStart = autoStart;
    try {
      appliedAutoStart = await setAutostartEnabled(autoStart);
    } catch (e) {
      console.error("Autostart failed during onboarding:", e);
      appliedAutoStart = false;
    }
    const hasCloudKey = Boolean(
      keys.groq.trim() || keys.openai.trim() || keys.gemini.trim() || keys.openrouter.trim()
    );
    const updated = {
      ...settings,
      name: name.trim().slice(0, 60),
      nickname: nickname.trim().slice(0, 60),
      groqApiKey: keys.groq.trim(),
      openaiApiKey: keys.openai.trim(),
      geminiApiKey: keys.gemini.trim(),
      openRouterApiKey: keys.openrouter.trim(),
      // No key at all? Start on the on-device engine so dictation still works;
      // the model itself is downloaded from Models & providers.
      aiProvider: (hasCloudKey ? "groq" : "local") as UserSettings["aiProvider"],
      sttProvider: (hasCloudKey ? "groq" : "local") as UserSettings["sttProvider"],
      f9Provider: "groq" as const,
      f10Provider: "groq" as const,
      polishProvider: "groq" as const,
      autoStart: appliedAutoStart,
      onboardingDone: true,
      legalAcceptedVersion: LEGAL_VERSION,
    };
    setSettings(updated);
    await saveSettings(updated);
  };

  const goNext = (n: number) => setStep(n);

  // External links open deterministically in the system browser via the
  // opener plugin (plain target=_blank is unreliable inside WebView2).
  const openExternal = (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    openExternalUrl(url).catch(() => window.open(url, "_blank", "noopener"));
  };
  const progress = (current: number) => (
    <div
      className="onboarding-progress"
      role="progressbar"
      aria-label={`Step ${current} of ${TOTAL_STEPS}`}
      aria-valuemin={1}
      aria-valuemax={TOTAL_STEPS}
      aria-valuenow={current}
    >
      {Array.from({ length: TOTAL_STEPS }, (_, i) => {
        const dotStep = i + 1;
        return (
          <div
            key={i}
            className={`progress-dot${current === dotStep ? " active" : ""}${
              current > dotStep ? " done" : ""
            }`}
          />
        );
      })}
    </div>
  );

  // One fixed action zone on every page: Back / Skip / Next always render
  // in the same slots (placeholders keep geometry stable) so the cursor
  // never has to move between steps.
  const actions = (opts: {
    back: number | null;
    next: number | null;
    nextDisabled?: boolean;
    nextLabel?: string;
    onNext?: () => void;
    skipTo?: number | null;
  }) => (
    <div className="onboarding-actions ob-actions-fixed">
      {opts.back !== null ? (
        <button className="ob-back-btn" onClick={() => goNext(opts.back as number)}>
          Back
        </button>
      ) : (
        <span className="ob-action-slot" aria-hidden="true" />
      )}
      {opts.skipTo !== null && opts.skipTo !== undefined ? (
        <button className="ob-back-btn" onClick={() => goNext(opts.skipTo as number)}>
          Skip
        </button>
      ) : (
        <span className="ob-action-slot" aria-hidden="true" />
      )}
      {opts.next !== null ? (
        <button
          className="ob-next-btn"
          disabled={opts.nextDisabled}
          onClick={opts.onNext ?? (() => goNext(opts.next as number))}
        >
          {opts.nextLabel ?? "Next"} <img src="/icons/right_arrow.svg" alt="" className="ob-btn-arrow" />
        </button>
      ) : (
        <span className="ob-action-slot" aria-hidden="true" />
      )}
    </div>
  );

  return (
    <div className="onboarding">
      <div className="onboarding-card onboarding-card--wide">
        {/* Step 0 — name (split: artwork left, welcome + name right) */}
        {step === 0 && (
          <div className="ob-split">
            <div className="ob-split-visual">
              <img src="/onboarding/flunkey_app_opener.webp" alt="" />
            </div>
            <div className="ob-split-body ob-split-body--center">
              <span className="ob-user-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9 15.5H7.5C6.10444 15.5 5.40665 15.5 4.83886 15.6722C3.56045 16.06 2.56004 17.0605 2.17224 18.3389C2 18.9067 2 19.6044 2 21M14.5 7.5C14.5 9.98528 12.4853 12 10 12C7.51472 12 5.5 9.98528 5.5 7.5C5.5 5.01472 7.51472 3 10 3C12.4853 3 14.5 5.01472 14.5 7.5ZM11 21L14.1014 20.1139C14.2499 20.0715 14.3241 20.0502 14.3934 20.0184C14.4549 19.9902 14.5134 19.9558 14.5679 19.9158C14.6293 19.8707 14.6839 19.8161 14.7932 19.7068L21.25 13.25C21.9404 12.5597 21.9404 11.4403 21.25 10.75C20.5597 10.0596 19.4404 10.0596 18.75 10.75L12.2932 17.2068C12.1839 17.3161 12.1293 17.3707 12.0842 17.4321C12.0442 17.4866 12.0098 17.5451 11.9816 17.6066C11.9497 17.6759 11.9285 17.7501 11.8861 17.8987L11 21Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <h2 ref={headingRef} tabIndex={-1} className="ob-step-title">
                Enter name:
              </h2>
              <input
                id="ob-name"
                className="ob-name-input"
                type="text"
                name="flunkey-display-name"
                autoComplete="off"
                aria-label="Your name"
                placeholder="e.g. Alex"
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) goNext(1);
                }}
                autoFocus
              />
              <input
                id="ob-nickname"
                className="ob-name-input ob-name-input--nick"
                type="text"
                name="flunkey-nickname"
                autoComplete="off"
                aria-label="Nickname (optional)"
                placeholder="Nickname"
                maxLength={60}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) goNext(1);
                }}
              />
              {actions({ back: null, next: 1, nextDisabled: !name.trim() })}
            </div>
          </div>
        )}

        {/* Steps 1–3 — F8/F9/F10 explainers (split: banner left, info right) */}
        {step >= 1 && step <= 3 && (
          <div className="ob-split">
            <div className="ob-split-visual">
              <img src={FEATURE_PAGES[step - 1].image} alt="" />
            </div>
            <div className="ob-split-body">
              {progress(step)}
              <div className="ob-feature-badge">{FEATURE_PAGES[step - 1].badge}</div>
              <h2 ref={headingRef} tabIndex={-1} className="ob-step-title">
                {FEATURE_PAGES[step - 1].title}
              </h2>
              <p className="step-desc">{FEATURE_PAGES[step - 1].desc}</p>
              {actions({ back: step - 1, next: step + 1, skipTo: 4 })}
            </div>
          </div>
        )}

        {/* Step 4 — microphone (full-bleed) */}
        {step === 4 && (
          <div className="ob-full">
            {progress(4)}
            <div className="ob-mic-icon-wrap">
              <img
                src={micPermission === "granted" ? "/icons/mic.svg" : "/icons/mic_mute.svg"}
                alt=""
                className={`ob-mic-icon${micPermission === "granted" ? " ob-mic-icon--granted" : ""}`}
              />
            </div>
            <h2 ref={headingRef} tabIndex={-1} className="ob-step-title">
              Microphone Access
            </h2>
            <p className="step-desc">
              Flunkey uses your microphone for voice commands. Press Allow
              below to enable it for Flunkey.
            </p>
            <button
              className="ob-mic-btn"
              onClick={handleRequestMic}
              disabled={micPermission === "requesting" || micPermission === "granted"}
            >
              {micPermission === "requesting"
                ? "Requesting..."
                : micPermission === "granted"
                  ? "Microphone Allowed"
                  : "Allow Microphone"}
            </button>
            {micPermission === "granted" && (
              <div className="ob-status ob-status--ok" aria-live="polite">
                Microphone access granted
              </div>
            )}
            {micPermission === "denied" && (
              <div className="ob-status ob-status--fail" aria-live="polite">
                Permission denied. Allow the microphone in Windows Settings →
                Privacy → Microphone, then try again — or skip for now.
              </div>
            )}
            <div className="onboarding-actions ob-actions-fixed">
              <button className="ob-back-btn" onClick={() => goNext(3)}>
                Back
              </button>
              <button className="ob-back-btn" onClick={() => goNext(5)}>
                Skip
              </button>
              <button
                className="ob-next-btn"
                disabled={micPermission !== "granted"}
                onClick={() => goNext(5)}
              >
                Next <img src="/icons/right_arrow.svg" alt="" className="ob-btn-arrow" />
              </button>
            </div>
          </div>
        )}

        {/* Step 5 — API keys, full-bleed (4 providers) */}
        {step === 5 && (
          <div className="ob-full">
            {progress(5)}
            <h2 ref={headingRef} tabIndex={-1} className="ob-step-title">
              Connect your AI keys
            </h2>
            <p className="step-desc ob-key-links">
              Get free keys from{" "}
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                onClick={(e) =>
                  openExternal(e, "https://console.groq.com/keys")
                }
              >
                Groq
              </a>
              {" · "}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                onClick={(e) =>
                  openExternal(e, "https://openrouter.ai/keys")
                }
              >
                OpenRouter
              </a>
              , or install a local model.
            </p>
            <div className="ob-key-list">
              {API_PROVIDERS.map((p) => {
                const status = keyStatus[p.id];
                const filled = keys[p.id].trim().length > 0;
                const shown = showKeys[p.id];
                return (
                  <div className="ob-key-row" key={p.id}>
                    <span className="ob-key-logo" title={p.label}>
                      <p.Logo />
                    </span>
                    <input
                      className="ob-key-input"
                      type={shown ? "text" : "password"}
                      placeholder={p.placeholder}
                      aria-label={`${p.label} API key`}
                      value={keys[p.id]}
                      onChange={(e) => setKeyValue(p.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void testKey(p.id);
                      }}
                    />
                    <button
                      type="button"
                      className="ob-back-btn ob-key-mini"
                      onClick={() =>
                        setShowKeys((prev) => ({ ...prev, [p.id]: !prev[p.id] }))
                      }
                      aria-label={shown ? `Hide ${p.label} key` : `Show ${p.label} key`}
                    >
                      {shown ? "Hide" : "Show"}
                    </button>
                    <button
                      type="button"
                      className="ob-test-btn"
                      onClick={() => void testKey(p.id)}
                      disabled={!filled || status.state === "testing"}
                    >
                      {status.state === "testing" ? (
                        <span className="ob-test-spinner" aria-hidden="true" />
                      ) : (
                        "Test"
                      )}
                    </button>
                    <span
                      className={`ob-key-badge${status.state === "ok" ? " ob-key-badge--ok" : status.state === "fail" ? " ob-key-badge--fail" : ""}`}
                      aria-live="polite"
                      title={status.message ?? p.label}
                    >
                      {status.state === "ok" ? (
                        <CheckBadge />
                      ) : status.state === "fail" ? (
                        <AlertBadge />
                      ) : (
                        ""
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="onboarding-actions ob-actions-fixed">
              <button className="ob-back-btn" onClick={() => goNext(4)}>
                Back
              </button>
              <button className="ob-back-btn" onClick={() => goNext(6)}>
                Skip
              </button>
              <button
                className="ob-next-btn"
                disabled={!apiReady}
                onClick={() => goNext(6)}
              >
                Next <img src="/icons/right_arrow.svg" alt="" className="ob-btn-arrow" />
              </button>
            </div>
          </div>
        )}

        {/* Step 6 — autostart (split with texture) */}
        {step === 6 && (
          <div className="ob-split">
            <div className="ob-split-visual">
              <img src="/onboarding/autostart_req.webp" alt="" />
            </div>
            <div className="ob-split-body">
              {progress(6)}
              <h2 ref={headingRef} tabIndex={-1} className="ob-step-title">
                Start with Windows?
              </h2>
              <p className="step-desc">
                Flunkey runs quietly in the background so your shortcuts work
                everywhere, right after boot.
              </p>
              <div
                className="ob-terms-row"
                style={{ cursor: "pointer" }}
                onClick={() => setAutoStart(!autoStart)}
              >
                <div className="ob-terms-copy">
                  <div className="ob-terms-label">Launch at startup</div>
                  <div className="ob-terms-link">
                    You can change this anytime in Settings
                  </div>
                </div>
                <button
                  type="button"
                  className={`toggle${autoStart ? " on" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAutoStart(!autoStart);
                  }}
                  aria-label="Toggle launch at startup"
                >
                  <div className="toggle-handle" />
                </button>
              </div>
              {actions({ back: 5, next: 7, skipTo: 7 })}
            </div>
          </div>
        )}

        {/* Step 7 — terms + launch (banner top, agreement + launch below) */}
        {step === 7 && (
          <div className="ob-banner-page">
            <div className="ob-banner-top">
              <img
                src="/onboarding/flunkey_onboarding_banner.webp"
                alt=""
              />
            </div>
            <div className="ob-banner-body">
              {progress(7)}
              <div
                className="ob-terms-row"
                style={{ cursor: "pointer" }}
                onClick={() => setLegalAccepted(!legalAccepted)}
              >
                <div className="ob-terms-copy">
                  <div className="ob-terms-label">
                    I agree to terms and privacy
                  </div>
                  <div className="ob-terms-link">
                    <a
                      href="https://www.flunkey.space/terms"
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) =>
                        openExternal(e, "https://www.flunkey.space/terms")
                      }
                    >
                      Terms
                    </a>
                    {" · "}
                    <a
                      href="https://www.flunkey.space/privacy"
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) =>
                        openExternal(e, "https://www.flunkey.space/privacy")
                      }
                    >
                      Privacy
                    </a>
                  </div>
                </div>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={legalAccepted}
                  aria-label="Agree to Terms and Privacy Policy"
                  className={`toggle${legalAccepted ? " on" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLegalAccepted(!legalAccepted);
                  }}
                >
                  <div className="toggle-handle" />
                </button>
              </div>
              <div className="onboarding-actions ob-actions-fixed">
                <button className="ob-back-btn" onClick={() => goNext(6)}>
                  Back
                </button>
                <button
                  className="ob-next-btn"
                  disabled={!legalAccepted}
                  onClick={finishOnboarding}
                >
                  Launch Flunkey{" "}
                  <img src="/icons/right_arrow.svg" alt="" className="ob-btn-arrow" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
