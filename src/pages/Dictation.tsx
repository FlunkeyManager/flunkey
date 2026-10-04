/**
 * Dictation.tsx — everything about F8, in one place.
 *
 * The F8 controls used to be scattered: the hotkey and dictionary toggle in
 * Settings, the STT and polish models in Models, and the one prompt you could
 * actually edit was labelled "F9 System Prompt" and had nothing to do with
 * dictation. Someone wanting to know "how much will this rewrite my words" had
 * nowhere to look.
 *
 * Three levels, and the difference between them is the whole point:
 *
 * - **Verbatim** — no AI at all. Fastest, works with no API key, and nothing
 *   is ever rewritten.
 * - **Light** — a general cleanup prompt. Filler words, punctuation, capitals.
 *   Your own instructions are deliberately ignored, so nothing you said changes.
 * - **Enhanced** — the only level that reads your instructions, follows the
 *   active application's prompt, and may rewrite or expand.
 */
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { saveSettings } from "../persistence";
import { formatHotkey, normalizeHotkeys } from "../hotkeys";
import { DICTATION_STYLES, normalizeDictationStyle } from "../types";
import type { DictationStyle, UserSettings } from "../types";
import { LanguagePicker } from "../components/LanguagePicker";
import { getSttTarget } from "../types";

export function Dictation() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setCurrentPage = useStore((s) => s.setCurrentPage);

  const [instructions, setInstructions] = useState(
    settings.dictationInstructions ?? "",
  );
  const [language, setLanguage] = useState(settings.sttLanguage ?? "");
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setInstructions(settings.dictationInstructions ?? "");
    setLanguage(settings.sttLanguage ?? "");
  }, [settings]);

  const persist = async (patch: Partial<UserSettings>) => {
    const updated = { ...useStore.getState().settings, ...patch };
    setSettings(updated);
    await saveSettings(updated);
  };

  const style = normalizeDictationStyle(settings.dictationStyle);
  const stt = getSttTarget(settings);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="pageTitle">Dictation</div>
          <div className="pageSubtitle">
            Hold {formatHotkey(normalizeHotkeys(settings.hotkeys).transcribe)},
            speak, release
          </div>
        </div>
      </div>

      {/* ── Cleanup level ─────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-label">How much should cleanup change?</div>
        <div className="settings-desc">
          This is the promise Flunkey makes about your words, and it applies every
          single time.
        </div>
        <div className="style-grid">
          {DICTATION_STYLES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`style-card${style === option.id ? " active" : ""}`}
              onClick={() => void persist({ dictationStyle: option.id })}
              aria-pressed={style === option.id}
            >
              <span className="style-card-title">
                {style === option.id && (
                  <span className="style-card-check" aria-hidden="true">
                    ✓
                  </span>
                )}
                {option.label}
              </span>
              <span className="style-card-desc">{option.description}</span>
            </button>
          ))}
        </div>
        {style === "verbatim" && (
          <div className="settings-desc" style={{ marginTop: 10 }}>
            No second-pass cleanup or dictionary replacement happens. Speech
            recognition still uses the selected model; on-device Whisper works
            without an API key.
          </div>
        )}
        {style === "light" && (
          <div className="settings-desc" style={{ marginTop: 10 }}>
            Light cleans grammar and follows clear code, email, and list intent.
            Switch to Enhanced to apply your standing and app-specific prompts.
          </div>
        )}
      </div>

      {/* ── Voice engine ───────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-label">Voice engine</div>
        <div className="settings-desc">
          {stt
            ? `Transcribing with ${
                stt.provider === "local" ? "the on-device model" : stt.provider
              }${stt.model ? ` (${stt.model})` : ""}. `
            : "No voice engine is set up yet. "}
          <button
            type="button"
            className="link-btn"
            onClick={() => setCurrentPage("models")}
          >
            Change
          </button>
        </div>
      </div>

      {/* ── Language ──────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-label">Spoken language</div>
        <div className="settings-desc">
          Used for transcription, and to keep cleanup in the same language. Leave
          on auto-detect if you switch between languages while speaking.
        </div>
        <div style={{ marginTop: 10 }}>
          <LanguagePicker
            value={language}
            onChange={(code) => void persist({ sttLanguage: code })}
          />
        </div>
      </div>

      {/* ── Instructions ──────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-label">Standing instructions</div>
        <div className="settings-desc">
          Used at the Enhanced level only. Anything Flunkey should always do
          while rewriting dictation — house style, spelling conventions, what a
          commit message should look like. These are combined with the selected
          application's prompt; they never let it answer you or discuss what
          you said.
        </div>
        <textarea
          className="settings-textarea"
          rows={4}
          value={instructions}
          placeholder="e.g. Use British spelling. Keep commit messages lowercase."
          onChange={(e) => {
            setInstructions(e.target.value);
            setSavedFlash(false);
          }}
          onBlur={() => {
            void persist({ dictationInstructions: instructions.trim() });
            setSavedFlash(true);
          }}
        />
        {savedFlash && (
          <div className="settings-desc" style={{ marginTop: 6 }}>
            Saved.
          </div>
        )}
        {style !== "enhanced" && (
          <div className="settings-desc" style={{ marginTop: 8 }}>
            Not in use at the {style === "verbatim" ? "Verbatim" : "Light"}{" "}
            level — switch to Enhanced to have these applied.
          </div>
        )}
        <div className="settings-desc" style={{ marginTop: 8 }}>
          Want this to differ per application — an IDE, a terminal, a chat
          assistant?{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => setCurrentPage("applications")}
          >
            Set it per application
          </button>
        </div>
      </div>
    </div>
  );
}

/** Re-exported so the level union stays in one place for callers. */
export type { DictationStyle };
