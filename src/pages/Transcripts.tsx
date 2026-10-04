import { useMemo, useState } from "react";
import { useStore } from "../store";
import { saveTranscriptions } from "../persistence";
import { AppBadge } from "../components/AppBadge";
import { smartSearch } from "../smartSearch";
import { SearchBar, useDebouncedValue } from "../components/SearchBar";
import {
  FilterBar,
  collectAppOptions,
  filterByAppAndDate,
  type DatePreset,
} from "../components/HistoryFilters";

/** Row text clamps past this length until expanded. */
const MAX_TRANSCRIPT_CHARS = 280;

export function Transcripts() {
  const transcriptions = useStore((s) => s.transcriptions);
  const deleteTranscription = useStore((s) => s.deleteTranscription);
  const [search, setSearch] = useState("");
  const [app, setApp] = useState("all");
  const [date, setDate] = useState<DatePreset>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { debounced, pending } = useDebouncedValue(search);
  const apps = useMemo(
    () => collectAppOptions(transcriptions, (t) => t.app),
    [transcriptions]
  );
  const preFiltered = useMemo(
    () =>
      filterByAppAndDate(
        transcriptions,
        (t) => t.app,
        (t) => t.timestamp,
        app,
        date
      ),
    [transcriptions, app, date]
  );
  // Relevance-ranked with typo tolerance; newest wins ties.
  const filtered = useMemo(
    () =>
      smartSearch(
        preFiltered,
        debounced,
        (t) => [{ text: t.text, weight: 1 }],
        (t) => t.timestamp
      ),
    [preFiltered, debounced]
  );

  const toggleExpanded = (id: string) =>
    setExpanded((s) => ({ ...s, [id]: !s[id] }));

  const copyRow = async (id: string, text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((cur) => (cur === id ? null : cur));
      }, 1500);
    } catch {}
  };

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="pageTitle">Transcripts</div>
          <div className="pageSubtitle">
            Every F8 voice-to-cursor dictation
          </div>
        </div>
      </div>

      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Smart search transcriptions…"
        searching={pending}
      />
      {transcriptions.length > 0 && (
        <FilterBar
          apps={apps}
          app={app}
          onApp={setApp}
          date={date}
          onDate={setDate}
          shown={filtered.length}
          total={transcriptions.length}
        />
      )}

      {filtered.length === 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="empty-state">
            {transcriptions.length === 0
              ? <>No transcriptions yet. Hold <span className="mono">F8</span> and speak to dictate.</>
              : "No results for your search."}
          </div>
        </div>
      )}


      <div className="transcript-list">
        {filtered.map((t) => {
          const isLong = t.text.length > MAX_TRANSCRIPT_CHARS;
          const showAll = !isLong || expanded[t.id];
          return (
            <div key={t.id} className="transcript-row transcript-row--wrap">
              <div className="transcript-time">{formatDate(t.timestamp)}</div>
              <AppBadge app={t.app} />
              <div className="transcript-text">
                {showAll ? t.text : `${t.text.slice(0, MAX_TRANSCRIPT_CHARS)}…`}
                {isLong && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => toggleExpanded(t.id)}
                  >
                    {showAll ? "Show less" : "Show more"}
                  </button>
                )}
              </div>
              <button
                type="button"
                className="row-icon-btn"
                onClick={() => void copyRow(t.id, t.text)}
                title={copiedId === t.id ? "Copied" : "Copy transcript"}
                aria-label="Copy transcript"
              >
                {copiedId === t.id ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
                    <path d="M4.5 12.5 10 18 19.5 6.5" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
                    <rect x="9" y="9" width="12" height="12" rx="2.5" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                className="row-icon-btn row-icon-btn--danger"
                onClick={() => {
                  deleteTranscription(t.id);
                  void saveTranscriptions(
                    useStore
                      .getState()
                      .transcriptions.filter((x) => x.id !== t.id)
                  );
                }}
                title="Delete this transcript"
                aria-label="Delete this transcript"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
                  <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
