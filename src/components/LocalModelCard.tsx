import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelDownload,
  deleteModel,
  downloadModel,
  fetchEngineStatus,
  fetchMachineInfo,
  fetchModelStatus,
  formatMiB,
  formatSpeed,
  onDownloadProgress,
  RECOMMENDED_LOCAL_MODEL,
  type DownloadProgress,
  type LocalModelStatus,
  type MachineInfo,
} from "../whisper";

function WhisperMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <rect x="9" y="2.5" width="6" height="11" rx="3" stroke="#fff" strokeWidth="1.6" />
      <path d="M5 11a7 7 0 0 0 14 0" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 18v3.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function LocalModelCard({
  selectedModel,
  onSelectModel,
  onInstalledChange,
}: {
  selectedModel: string;
  onSelectModel: (id: string) => void;
  onInstalledChange?: (installed: boolean) => void;
}) {
  const [engine, setEngine] = useState<{ available: boolean } | null>(null);
  const [machine, setMachine] = useState<MachineInfo | null>(null);
  const [models, setModels] = useState<LocalModelStatus[]>([]);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const unlistenRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    const [status, info, list] = await Promise.all([
      fetchEngineStatus(),
      fetchMachineInfo(),
      fetchModelStatus(),
    ]);
    setEngine(status);
    setMachine(info);
    setModels(list);
    setLoading(false);
    const installed = list.filter((m) => m.installed);
    onInstalledChange?.(installed.length > 0);
    // Preselect whatever is installed, preferring the recommended one.
    if (installed.length > 0) {
      const preferred =
        installed.find((m) => m.id === RECOMMENDED_LOCAL_MODEL) ?? installed[0];
      if (preferred.id !== selectedModel) onSelectModel(preferred.id);
    }
  }, [onInstalledChange, onSelectModel, selectedModel]);

  useEffect(() => {
    void refresh().catch((e) => {
      setError(e instanceof Error ? e.message : "Could not read local models.");
      setLoading(false);
    });
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    onDownloadProgress((p) => {
      if (disposed) return;
      setProgress(p);
      if (p.stage === "done") {
        setProgress(null);
        void refresh();
      } else if (p.stage === "error") {
        setError(p.error ?? "The download failed.");
        setProgress(null);
        void refresh();
      }
    })
      .then((un) => {
        if (disposed) un();
        else unlistenRef.current = un;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
    // Progress subscription is global; refresh is stable enough for our use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDownload = async (id: string) => {
    setError("");
    try {
      await downloadModel(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the download.");
    }
  };

/**
   * Ask before deleting, and always name the model.
   *
   * The confirm is an in-app modal rather than `window.confirm`, which rendered
   * as a browser dialog reading "localhost:1420 says" over a native-feeling
   * window. It reuses the same markup as the Chat History delete.
   *
   * Two reasons this is not a one-click button: the files are large and a
   * re-download is a long wait, and deleting the model currently selected for
   * dictation breaks F8 until the user downloads it again.
   */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const confirmDelete = async () => {
    const id = pendingDelete;
    setPendingDelete(null);
    if (!id) return;
    setError("");
    try {
      await deleteModel(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the model.");
    }
  };

  // Esc cancels, matching the other modals in the app.
  useEffect(() => {
    if (!pendingDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setPendingDelete(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDelete]);

  // Real usage rather than the sum of published sizes, so the number matches
  // what Explorer shows.
  const installedBytes = models.reduce(
    (sum, m) => sum + m.installedBytes,
    0
  );
  // Abandoned partial downloads: invisible as models but still taking space.
  const partialBytes = models.reduce((sum, m) => sum + m.partialBytes, 0);
  const installedCount = models.filter((m) => m.installed).length;

  const busy = progress?.stage === "downloading" || progress?.stage === "verifying";
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : 0;

  return (
    <div className="models-provider-card local-stt-card">
      <div className="models-provider-heading">
        <span className="provider-logo">
          <WhisperMark />
        </span>
        <span className="usecase-label" title="Runs on this PC. No key, no cost, works offline.">
          On-device transcription
        </span>
        <span className="info-dot" title="Powered by whisper.cpp. Audio never leaves your computer — and the app works with no API keys at all.">
          i
        </span>
      </div>

      {engine && !engine.available && (
        <div className="settings-desc" style={{ color: "#f59e0b" }}>
          The speech engine is missing from this install. Reinstall Flunkey to
          enable on-device transcription.
        </div>
      )}

      {installedCount > 0 && (
        <div className="local-stt-machine">
          <span>
            <strong>{installedCount}</strong>{" "}
            {installedCount === 1 ? "model" : "models"} downloaded
          </span>
          <span>·</span>
          <span>
            <strong>{formatMiB(installedBytes)}</strong> on disk
          </span>
          {partialBytes > 0 && (
            <>
              <span>·</span>
              <span title="A download that did not finish. Deleting that model clears it.">
                <strong>{formatMiB(partialBytes)}</strong> of unfinished downloads
              </span>
            </>
          )}
        </div>
      )}

      {machine && machine.ramTotalGb > 0 && (
        <div className="local-stt-machine">
          <span>
            <strong>{machine.ramTotalGb.toFixed(0)} GB</strong> RAM
          </span>
          <span>·</span>
          <span>
            <strong>{machine.logicalCores}</strong> threads
          </span>
          {machine.diskFreeGb > 0 && (
            <>
              <span>·</span>
              <span>
                <strong>{machine.diskFreeGb.toFixed(0)} GB</strong> free
              </span>
            </>
          )}
        </div>
      )}

      <div className="local-stt-list">
        {loading
          ? null
          : models.map((m) => {
              const active = selectedModel === m.id;
              const tooHeavy =
                machine && machine.ramFreeGb > 0 && m.ramMb / 1024 > machine.ramFreeGb * 0.6;
              const noSpace =
                machine && machine.diskFreeGb > 0 && m.sizeMib / 1024 > machine.diskFreeGb * 0.9;
              return (
                <div
                  key={m.id}
                  className={`local-stt-row${active ? " active" : ""}${m.installed ? " installed" : ""}`}
                >
                  <button
                    type="button"
                    className="local-stt-main"
                    onClick={() => m.installed && onSelectModel(m.id)}
                    disabled={!m.installed || busy}
                    title={m.note}
                  >
                    <span className="local-stt-name">
                      {m.label}
                      {m.installed && (
                      <span className="local-stt-badge">Installed</span>
                    )}
                      {active && m.installed && (
                        <span className="local-stt-badge local-stt-badge--active">
                          In use
                        </span>
                      )}
                    </span>
                    <span className="local-stt-meta">
                      {m.sizeMib} MB · ~{m.ramMb} MB RAM while running
                    </span>
                    <span className="local-stt-note">{m.note}</span>
                    {tooHeavy && (
                      <span className="local-stt-warn">
                        Your machine has {machine?.ramFreeGb.toFixed(1)} GB free — this
                        may be tight.
                      </span>
                    )}
                    {noSpace && (
                      <span className="local-stt-warn">Not enough free disk space.</span>
                    )}
                  </button>
                  {m.installed ? (
                    <button
                      type="button"
                      className="models-mini-btn"
                      onClick={() => setPendingDelete(m.id)}
                      disabled={busy}
                      title={
                      active
                        ? `Delete the ${m.label} model — it is the one Flunkey uses for on-device dictation`
                        : `Delete the ${m.label} model and free ${formatMiB(m.installedBytes)}`
                    }
                    >
                      Delete
                    </button>
                  ) : progress?.id === m.id ? (
                    <div className="local-stt-progress">
                      {progress.stage === "verifying" ? (
                        <span className="local-stt-progress-label">Verifying…</span>
                      ) : (
                        <>
                          <div className="local-stt-bar">
                            <div className="local-stt-bar-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="local-stt-progress-label">
                            {pct}% · {formatMiB(progress.received)}
                            {progress.total > 0 ? ` / ${formatMiB(progress.total)}` : ""}
                            {formatSpeed(progress.bytesPerSec) ? ` · ${formatSpeed(progress.bytesPerSec)}` : ""}
                          </span>
                          <button
                            type="button"
                            className="models-mini-btn"
                            onClick={() => void cancelDownload()}
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="models-mini-btn"
                      onClick={() => void startDownload(m.id)}
                      disabled={busy || !engine?.available}
                      title={`Download the ${m.label} model (${m.sizeMib} MB) for on-device transcription`}
                    >
                      Download
                    </button>
                  )}
                </div>
              );
            })}
      </div>

      {error && (
        <div className="local-stt-error">
          {error}
          <button type="button" className="models-mini-btn" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}

      {pendingDelete && (() => {
        const model = models.find((m) => m.id === pendingDelete);
        if (!model) return null;
        const isInUse = selectedModel === model.id;
        return (
          <div
            className="modal-backdrop"
            onClick={() => setPendingDelete(null)}
          >
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">
                  Delete the {model.label} model?
                </div>
              </div>
              <div className="modal-body">
                <p>
                  {isInUse
                    ? `It is the model Flunkey is set to use for on-device dictation, so on-device transcription will stop working until you download it again. This frees about ${formatMiB(model.installedBytes)}.`
                    : `This frees about ${formatMiB(model.installedBytes)}. You can download it again at any time.`}
                </p>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setPendingDelete(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void confirmDelete()}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
