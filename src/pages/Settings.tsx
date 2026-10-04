import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { emitTo } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store";
import { saveSettings, wipeAllData } from "../persistence";
import { screenshotUsageBytes } from "../screenshots";
import { normalizeHistoryLimits, type HistoryLimits } from "../types";
import type { LocalModelStatus } from "../whisper";
import {
  F9_OVERLAY_POSITIONS,
  LEGAL_VERSION,
} from "../types";
import type { AppHotkeys, F9OverlayPosition, UserSettings } from "../types";
import { applyOverlayLayout } from "../overlayPosition";
import { setAutostartEnabled } from "../autostart";
import { HotkeyEditor } from "../components/HotkeyEditor";
import {
  applyHotkeys,
  bindingsEqual,
  hotkeysConflict,
  normalizeHotkeys,
} from "../hotkeys";

type SaveStatus = "idle" | "saving" | "saved";

/** Human-readable size for the storage summary. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Settings() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const storageError = useStore((s) => s.storageError);
  const setStorageError = useStore((s) => s.setStorageError);

  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [showPill, setShowPill] = useState(settings.showRecordingIndicator);
  const [overlayPosition, setOverlayPosition] = useState<F9OverlayPosition>(
    settings.f9OverlayPosition
  );
  const [overlayFree, setOverlayFree] = useState(settings.f9OverlayFreePosition);
  const [hotkeys, setHotkeys] = useState<AppHotkeys>(
    normalizeHotkeys(settings.hotkeys)
  );
  const [preserveClipboard, setPreserveClipboard] = useState(settings.preserveClipboard ?? true);
  const [autoStart, setAutoStart] = useState(settings.autoStart ?? false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const hotkeyConflict = useMemo(() => hotkeysConflict(hotkeys), [hotkeys]);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  // Retention controls. Empty string means "unlimited", which is stored as 0.
  const [limits, setLimits] = useState<Record<keyof HistoryLimits, string>>({
    transcriptions: String(settings.historyLimits?.transcriptions ?? ""),
    transforms: String(settings.historyLimits?.transforms ?? ""),
    chats: String(settings.historyLimits?.chats ?? ""),
    screenshots: String(settings.historyLimits?.screenshots ?? ""),
  });
  // Real disk usage, so "wipe everything" can say how much it would remove.
  const [modelsOnDiskMb, setModelsOnDiskMb] = useState(0);
  const [screenshotBytes, setScreenshotBytes] = useState(0);

  // How much the models on disk occupy, for the wipe confirmation.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      invoke<LocalModelStatus[]>("whisper_model_status").catch(() => []),
      screenshotUsageBytes(),
    ]).then(([models, shots]) => {
      if (cancelled) return;
      setModelsOnDiskMb(
        models.reduce((sum, m) => sum + m.installedBytes + m.partialBytes, 0) / 1_048_576
      );
      setScreenshotBytes(shots);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateLimit = (key: keyof HistoryLimits, raw: string) => {
    const digits = raw.replace(/[^0-9]/g, "");
    setLimits((prev) => ({ ...prev, [key]: digits }));
    const normalized = normalizeHistoryLimits({
      ...useStore.getState().settings.historyLimits,
      [key]: digits === "" ? 0 : Number(digits),
    });
    const updated = { ...useStore.getState().settings, historyLimits: normalized };
    setSettings(updated);
    void saveSettings(updated);
  };

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const persistDraftRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const skipAutoSave = useRef(true);

  useEffect(() => {
    setSystemPrompt(settings.systemPrompt);
    setShowPill(settings.showRecordingIndicator);
    setOverlayPosition(settings.f9OverlayPosition);
    setOverlayFree(settings.f9OverlayFreePosition);
    setHotkeys(normalizeHotkeys(settings.hotkeys));
    setPreserveClipboard(settings.preserveClipboard ?? true);
    setAutoStart(settings.autoStart ?? false);
    skipAutoSave.current = true;
  }, [settings]);

  const buildDraft = useCallback((): UserSettings => {
    const base = useStore.getState().settings;
    return {
      ...base,
      systemPrompt,
      showRecordingIndicator: showPill,
      // `dictionaryEnabledF8` is deliberately absent: that toggle now lives on
      // the Dictation page, and carrying a stale copy here meant changing any
      // setting in Settings silently reverted it.
      f9OverlayPosition: overlayPosition,
      f9OverlayFreePosition: overlayFree,
      hotkeys: normalizeHotkeys(hotkeys),
      preserveClipboard,
      autoStart,
    };
  }, [
    systemPrompt,
    showPill,
    overlayPosition,
    overlayFree,
    hotkeys,
    preserveClipboard,
    autoStart,  ]);

  const persistDraft = useCallback(async () => {
    const updated = buildDraft();
    const current = useStore.getState().settings;

    const bindingsChanged =
      !bindingsEqual(updated.hotkeys.transcribe, current.hotkeys.transcribe) ||
      !bindingsEqual(updated.hotkeys.askAi, current.hotkeys.askAi) ||
      !bindingsEqual(updated.hotkeys.transform, current.hotkeys.transform) ||
      !bindingsEqual(updated.hotkeys.panel, current.hotkeys.panel);

    const unchanged =
      updated.systemPrompt === current.systemPrompt &&
      updated.showRecordingIndicator === current.showRecordingIndicator &&
      updated.f9OverlayPosition === current.f9OverlayPosition &&
      updated.f9OverlayFreePosition === current.f9OverlayFreePosition &&
      !bindingsChanged &&
      updated.preserveClipboard === current.preserveClipboard &&
      updated.autoStart === current.autoStart;

    if (unchanged) return;

    // A conflicting shortcut blocks only the shortcut write. Vetoing every
    // save on the page meant an unresolved duplicate binding silently stopped
    // the system prompt, the clipboard preference and everything else from
    // saving too.
    if (hotkeyConflict && bindingsChanged) return;

    setSaveStatus("saving");
    setSettings(updated);

    // Apply autostart immediately when the toggle changes.
    if (updated.autoStart !== current.autoStart) {
      const actual = await setAutostartEnabled(updated.autoStart);
      if (actual !== updated.autoStart) {
        const corrected = { ...updated, autoStart: actual };
        setSettings(corrected);
        await saveSettings(corrected);
      }
    }

    await applyOverlayLayout({
      f9OverlayPosition: updated.f9OverlayPosition,
      f9OverlayFreePosition: updated.f9OverlayFreePosition,
      f9OverlayFreeX: updated.f9OverlayFreeX,
      f9OverlayFreeY: updated.f9OverlayFreeY,
      f9OverlayFreeWidth: updated.f9OverlayFreeWidth,
      f9OverlayFreeHeight: updated.f9OverlayFreeHeight,
    }).catch(console.error);

    await saveSettings(updated);
    // Registering the shortcuts with the OS is what actually makes a new
    // binding work; the emits only tell the tray and overlay to redraw.
    if (bindingsChanged) {
      await applyHotkeys(updated.hotkeys).catch(console.error);
      await emitTo("pill", "hotkeys-changed", updated.hotkeys).catch(console.error);
      await emitTo("overlay", "hotkeys-changed", updated.hotkeys).catch(console.error);
    }

    setSaveStatus("saved");
    clearTimeout(savedFlashTimer.current);
    savedFlashTimer.current = setTimeout(() => setSaveStatus("idle"), 1500);
  }, [buildDraft, setSettings, hotkeyConflict]);

  useEffect(() => {
    persistDraftRef.current = persistDraft;
  }, [persistDraft]);

  const queueSave = useCallback(
    (delayMs: number) => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void persistDraft();
      }, delayMs);
    },
    [persistDraft]
  );

  useEffect(() => {
    if (skipAutoSave.current) {
      skipAutoSave.current = false;
      return;
    }
    queueSave(450);
    return () => clearTimeout(saveTimer.current);
  }, [
    systemPrompt,
    showPill,
    overlayPosition,
    overlayFree,
    hotkeys,
    preserveClipboard,
    autoStart,    queueSave,
  ]);

  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      clearTimeout(savedFlashTimer.current);
      // Navigating away unmounts this page. Persist the current draft now so
      // the debounce never drops an edit made immediately before navigation.
      void persistDraftRef.current();
    },
    []
  );

  const handleWipe = async () => {
    await wipeAllData();
    setShowWipeConfirm(false);
    window.location.reload();
  };

  const statusLabel =
    saveStatus === "saving"
      ? "Saving…"
      : saveStatus === "saved"
        ? "Saved"
        : null;

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="pageTitle">Settings</div>
          <div className="pageSubtitle">
            Changes save automatically
            {statusLabel ? ` · ${statusLabel}` : ""}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">Keyboard shortcuts</div>
        <HotkeyEditor
          value={hotkeys}
          onChange={setHotkeys}
          conflictMessage={hotkeyConflict}
        />
      </div>

      <div className="settings-section">
        <div className="settings-label">F9 panel position</div>
        <div className="settings-desc">
          {overlayFree
            ? "With Free on, drag the header and resize from the corner when F9 is active."
            : "Where the chat panel appears when you hold F9."}
        </div>
        <div className={`model-grid${overlayFree ? " model-grid--disabled" : ""}`}>
          {F9_OVERLAY_POSITIONS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`model-option${overlayPosition === p.id ? " selected" : ""}`}
              onClick={() => setOverlayPosition(p.id)}
              disabled={overlayFree}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="overlay-free-block">
          <div className="toggle-row">
            <div>
              <div className="settings-label">Free position</div>
              <div className="settings-desc">
                Move and resize the F9 panel anywhere on your screen.
              </div>
            </div>
            <button
              type="button"
              className={`toggle${overlayFree ? " on" : ""}`}
              onClick={() => setOverlayFree(!overlayFree)}
              aria-label="Toggle free panel position"
            >
              <div className="toggle-handle" />
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">F9 System Prompt</div>
        <div className="settings-desc">How the AI answers your voice questions.</div>
        <textarea
          className="settings-textarea"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={5}
        />
      </div>

      <div className="settings-section">
        <div className="toggle-row">
          <div>
            <div className="settings-label">Show recording pill</div>
            <div className="settings-desc">
              When off, the floating pill never appears and flows run headless.
            </div>
          </div>
          <button
            type="button"
            className={`toggle${showPill ? " on" : ""}`}
            onClick={() => setShowPill(!showPill)}
            aria-label="Toggle recording pill"
          >
            <div className="toggle-handle" />
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="toggle-row">
          <div>
            <div className="settings-label">Restore clipboard after paste</div>
            <div className="settings-desc">
              When enabled, Flunkey will preserve and restore your clipboard around F8 and Transform operations so your previous clipboard contents are not lost.
            </div>
          </div>
          <button
            type="button"
            className={`toggle${preserveClipboard ? " on" : ""}`}
            onClick={() => setPreserveClipboard(!preserveClipboard)}
            aria-label="Toggle clipboard restore"
          >
            <div className="toggle-handle" />
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="toggle-row">
          <div>
            <div className="settings-label">Start with Windows</div>
            <div className="settings-desc">
              Launch Flunkey automatically when your computer starts so your shortcuts always work.
            </div>
          </div>
          <button
            type="button"
            className={`toggle${autoStart ? " on" : ""}`}
            onClick={() => setAutoStart(!autoStart)}
            aria-label="Toggle start with Windows"
          >
            <div className="toggle-handle" />
          </button>
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-label">History storage</div>
        <div className="limit-grid">
          {(
            [
              ["transcriptions", "Transcriptions"],
              ["transforms", "Transforms"],
              ["chats", "F9 chats"],
              ["screenshots", "Screenshots"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="limit-field">
              <span className="limit-label">{label}</span>
              <input
                className="limit-input"
                type="text"
                inputMode="numeric"
                placeholder="Unlimited"
                value={limits[key]}
                onChange={(e) => updateLimit(key, e.target.value)}
              />
            </label>
          ))}
        </div>
        <div className="storage-usage">
          {modelsOnDiskMb > 0
            ? `${formatBytes(screenshotBytes)} screenshots · ${Math.round(modelsOnDiskMb)} MB models`
            : `${formatBytes(screenshotBytes)} screenshots`}
        </div>
      </div>

      {storageError && (
        <div className="settings-section">
          <div className="settings-label" style={{ color: "#f59e0b" }}>
            Not saving
          </div>
          <div className="settings-desc">
            Flunkey could not write your {storageError} to disk. Anything from
            now on may be lost when you close it. This is usually a full or
            read-only drive — check free space, then try again.
          </div>
          <div style={{ marginTop: 10 }}>
            <button type="button" className="cancel-btn" onClick={() => setStorageError(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="settings-section danger-zone">
        <div className="settings-label">Danger zone</div>
        <div className="settings-desc">Deletes everything stored on this device.</div>
        {!showWipeConfirm ? (
          <button
            type="button"
            className="danger-btn"
            onClick={() => setShowWipeConfirm(true)}
          >
            Wipe all data
          </button>
        ) : (
          <div className="danger-confirm">
            <span>This cannot be undone.</span>
            <button type="button" className="danger-btn" onClick={handleWipe}>
              Yes, wipe everything
            </button>
            <button
              type="button"
              className="cancel-btn"
              onClick={() => setShowWipeConfirm(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-label">Setup wizard</div>
        <div className="settings-desc">
          Re-runs the first-time setup without deleting your history.
        </div>
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="cancel-btn"
            onClick={() => {
              const updated = { ...settings, onboardingDone: false };
              setSettings(updated);
              void saveSettings(updated);
            }}
          >
            Re-run setup
          </button>
        </div>
      </div>

      <div className="settings-footer">
        <div className="footer-info">
          <div className="footer-item">
            <span className="footer-label">Version</span>
            <span className="footer-value">{LEGAL_VERSION}</span>
          </div>
          <div className="footer-divider" />
          <div className="footer-item">
            <span className="footer-label">Email</span>
            <a href="mailto:flunkeymanager@gmail.com" className="footer-link">
              flunkeymanager@gmail.com
            </a>
          </div>
          <div className="footer-divider" />
          <div className="footer-item">
            <span className="footer-label">Instagram</span>
            <a
              href="https://www.instagram.com/flunkeymanager"
              target="_blank"
              rel="noreferrer"
              className="footer-link"
            >
              @flunkeymanager
            </a>
          </div>
          <div className="footer-divider" />
          <div className="footer-item">
            <span className="footer-label">Website</span>
            <a
              href="https://www.flunkey.space"
              target="_blank"
              rel="noreferrer"
              className="footer-link"
            >
              www.flunkey.space
            </a>
          </div>
          <div className="footer-divider" />
          <div className="footer-item footer-item--legal">
            <span className="footer-label">Legal</span>
            <span className="footer-legal-links">
              <a
                href="https://www.flunkey.space/privacy"
                target="_blank"
                rel="noreferrer"
                className="footer-link"
              >
                Privacy
              </a>
              <span className="footer-sep" aria-hidden="true"> · </span>
              <a
                href="https://www.flunkey.space/terms"
                target="_blank"
                rel="noreferrer"
                className="footer-link"
              >
                Terms
              </a>
              <span className="footer-sep" aria-hidden="true"> · </span>
              <a
                href="https://www.flunkey.space/about"
                target="_blank"
                rel="noreferrer"
                className="footer-link"
              >
                About
              </a>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
