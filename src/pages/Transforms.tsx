import { useMemo, useState } from "react";
import { useStore } from "../store";
import { getGroqModelLabel } from "../types";
import { saveTransforms } from "../persistence";
import type { TransformRecord } from "../types";
import { formatHotkey } from "../hotkeys";
import { AppBadge } from "../components/AppBadge";
import { profileForAppId } from "../appProfiles";
import { smartSearch } from "../smartSearch";
import { SearchBar, useDebouncedValue } from "../components/SearchBar";
import { reportAiResponse } from "../reporting";
import {
  FilterBar,
  collectAppOptions,
  filterByAppAndDate,
  type DatePreset,
} from "../components/HistoryFilters";

export function Transforms() {
  const transforms = useStore((s) => s.transforms);
  const deleteTransform = useStore((s) => s.deleteTransform);
  const hotkeys = useStore((s) => s.settings.hotkeys);
  const [search, setSearch] = useState("");
  const [app, setApp] = useState("all");
  const [date, setDate] = useState<DatePreset>("all");
  const [selected, setSelected] = useState<TransformRecord | null>(null);

  // Typing shows the spinner until results settle; structural filters run
  // first (cheap), smart search ranks what remains.
  const { debounced, pending } = useDebouncedValue(search);
  const apps = useMemo(
    () => collectAppOptions(transforms, (t) => t.app),
    [transforms]
  );
  const preFiltered = useMemo(
    () => filterByAppAndDate(transforms, (t) => t.app, (t) => t.timestamp, app, date),
    [transforms, app, date]
  );
  // Relevance-ranked: instruction matches outrank result/original matches,
  // typos tolerated, newest wins ties.
  const filtered = useMemo(
    () =>
      smartSearch(
        preFiltered,
        debounced,
        (t) => [
          { text: t.instruction, weight: 2.5 },
          { text: t.resultText, weight: 1.5 },
          { text: t.originalText, weight: 1 },
        ],
        (t) => t.timestamp
      ),
    [preFiltered, debounced]
  );

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const preview = (s: string, n = 90) =>
    s.length > n ? s.slice(0, n) + "…" : s;

  const openCard = (t: TransformRecord) => {
    // A drag that ends on the card is text selection, not an open request.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    setSelected(t);
  };
  const onCardKey = (e: React.KeyboardEvent, t: TransformRecord) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelected(t);
    }
  };

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="pageTitle">Transforms</div>
          <div className="pageSubtitle">
            F10 selection transforms — drag text, hold {formatHotkey(hotkeys.transform)}, speak the edit, release
          </div>
        </div>
      </div>

      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Smart search instruction, result or original…"
        searching={pending}
      />
      {transforms.length > 0 && (
        <FilterBar
          apps={apps}
          app={app}
          onApp={setApp}
          date={date}
          onDate={setDate}
          shown={filtered.length}
          total={transforms.length}
        />
      )}

      {filtered.length === 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="empty-state">
            {transforms.length === 0 ? (
              <>
                No transforms yet. Select text in any app, hold{" "}
                <span className="mono">{formatHotkey(hotkeys.transform)}</span>, say e.g. “Make this formal”, and release.
              </>
            ) : (
              "No results for your search."
            )}
          </div>
        </div>
      )}

      <div className="session-list">
        {filtered.map((t) => (
          <div
            key={t.id}
            className="session-card transform-card"
            role="button"
            tabIndex={0}
            onClick={() => openCard(t)}
            onKeyDown={(e) => onCardKey(e, t)}
          >
            <div className="session-meta">
              <span className="session-time">{formatDate(t.timestamp)}</span>
              <span className="session-model">{getGroqModelLabel(t.model)}</span>
              <AppBadge app={t.app} />
              <span className="transform-badge">{t.instruction ? `“${preview(t.instruction, 28)}”` : "—"}</span>
            </div>
            <div className="session-question" style={{ fontSize: 13, color: "var(--text)" }}>
              <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3 }}>Result: </span>
              {t.resultText ? preview(t.resultText, 110) : <em style={{ color: "var(--muted)" }}>No result</em>}
            </div>
            <div className="session-preview" style={{ marginTop: 4, borderTop: "1px solid rgba(46,46,44,0.35)", paddingTop: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3 }}>Original: </span>
              {preview(t.originalText, 120)}
            </div>
            <button
              type="button"
              className="session-delete"
              title="Delete this transform"
              aria-label="Delete this transform"
              onClick={(e) => {
                e.stopPropagation();
                deleteTransform(t.id);
                void saveTransforms(
                  useStore.getState().transforms.filter((x) => x.id !== t.id)
                );
                setSelected(null);
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Transform Detail</div>
                <div className="modal-meta">
                  {formatDate(selected.timestamp)} · {getGroqModelLabel(selected.model)} · {selected.app ? profileForAppId(selected.app).label : "—"}
                </div>
              </div>
              <button className="modal-close" onClick={() => setSelected(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="modal-section">
                <div className="modal-section-label">Voice Instruction</div>
                <div className="modal-section-text" style={{ fontStyle: selected.instruction ? "normal" : "italic", color: selected.instruction ? "var(--text)" : "var(--muted)" }}>
                  {selected.instruction || "(no transcription)"}
                </div>
              </div>
              <div className="modal-section">
                <div className="modal-section-label">Original Selection</div>
                <div className="modal-section-text">{selected.originalText}</div>
              </div>
              <div className="modal-section">
                <div className="modal-section-label">Transformed Result</div>
                <div className="modal-section-text">{selected.resultText || <span style={{ color: "var(--muted)", fontStyle: "italic" }}>No result was returned</span>}</div>
                {selected.resultText && (
                  <button
                    type="button"
                    className="ai-report-action"
                    onClick={() => void reportAiResponse(selected.resultText, getGroqModelLabel(selected.model))}
                    title="Opens an editable email draft with this result excerpt; nothing is sent automatically."
                  >
                    Report AI response
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
