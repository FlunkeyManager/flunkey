import { useMemo, useState, useEffect } from "react";
import { useStore } from "../store";
import { getGroqModelLabel } from "../types";
import type { AiSession } from "../types";
import { saveAiSessions } from "../persistence";
import { deleteSessionWithScreenshots } from "../retention";
import { ScreenshotImage } from "../components/ScreenshotImage";
import { stripThinkingBlocks } from "../responseSanitizer";
import {
  countUserMessages,
  getFirstUserMessage,
  getLastAssistantMessage,
} from "../sessionUtils";
import { smartSearch } from "../smartSearch";
import { SearchBar, useDebouncedValue } from "../components/SearchBar";
import { reportAiResponse } from "../reporting";
import {
  FilterBar,
  collectAppOptions,
  filterByAppAndDate,
  type DatePreset,
} from "../components/HistoryFilters";
import { splitByDisplayMath, splitByInlineMath, renderKatex } from "../lib/katexMath";

function renderChatInline(text: string): React.ReactNode[] {
  const splits = splitByInlineMath(text);
  const out: React.ReactNode[] = [];
  let k = 0;
  for (const seg of splits) {
    if (seg.kind === "inline") {
      const html = renderKatex(seg.math, false);
      out.push(<span key={`mi-${k++}`} className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />);
    } else {
      // basic markdown: `code`, **bold**, *italic*
      const parts: React.ReactNode[] = [];
      const regex = /(`[^`]+`|\*\*.*?\*\*|__.*?__|\*[^*\n]+?\*|_[^_\n]+?_)/g;
      let last = 0;
      let m: RegExpExecArray | null;
      let innerK = 0;
      while ((m = regex.exec(seg.text)) !== null) {
        if (m.index > last) parts.push(seg.text.slice(last, m.index));
        const token = m[0];
        if (token.startsWith("`")) parts.push(<code key={`c-${innerK++}`} className="overlayInlineCode">{token.slice(1, -1)}</code>);
        else if (token.startsWith("**") || token.startsWith("__")) parts.push(<strong key={`b-${innerK++}`}>{token.slice(2, -2)}</strong>);
        else parts.push(<em key={`i-${innerK++}`}>{token.slice(1, -1)}</em>);
        last = m.index + token.length;
      }
      if (last < seg.text.length) parts.push(seg.text.slice(last));
      out.push(...(parts.length ? parts : [seg.text]));
      k++;
    }
  }
  return out;
}

function ChatMessageContent({ content }: { content: string }) {
  const cleaned = stripThinkingBlocks(content);
  if (!cleaned) return null;
  const displayParts = splitByDisplayMath(cleaned);
  return (
    <>
      {displayParts.map((part, idx) => {
        if (part.kind === "display") {
          const html = renderKatex(part.math, true);
          return <div key={`dm-${idx}`} className="math-display" dangerouslySetInnerHTML={{ __html: html }} />;
        }
        // split remaining text by lines to preserve paragraphs
        const lines = part.text.split(/\r?\n/);
        return (
          <span key={`t-${idx}`}>
            {lines.map((line, li) => (
              <span key={li} style={{ display: line.trim() === "" ? "block" : "inline" }}>
                {line.trim() === "" ? <br /> : renderChatInline(line)}
                {li < lines.length - 1 && line.trim() !== "" ? " " : null}
              </span>
            ))}
          </span>
        );
      })}
    </>
  );
}

export function ChatHistory() {
  const aiSessions = useStore((s) => s.aiSessions);
  const [selectedSession, setSelectedSession] = useState<AiSession | null>(
    null
  );
  const [search, setSearch] = useState("");
  const [app, setApp] = useState("all");
  const [date, setDate] = useState<DatePreset>("all");

  const { debounced, pending } = useDebouncedValue(search);
  const apps = useMemo(
    () => collectAppOptions(aiSessions, () => undefined),
    [aiSessions]
  );
  // AI sessions don't track a source app yet — app filter stays hidden
  // (collectAppOptions returns []) while date + smart search apply.
  const preFiltered = useMemo(
    () =>
      filterByAppAndDate(
        aiSessions,
        () => undefined,
        (s) => s.timestamp,
        app,
        date
      ),
    [aiSessions, app, date]
  );

  // Relevance-ranked: opening question outranks follow-ups and answers,
  // typos tolerated, newest wins ties.
  const filtered = useMemo(
    () =>
      smartSearch(
        preFiltered,
        debounced,
        (s) => [
          { text: getFirstUserMessage(s), weight: 3 },
          {
            text: s.messages
              .filter((m) => m.role === "user")
              .map((m) => m.content)
              .join("\n"),
            weight: 2,
          },
          {
            text: s.messages
              .filter((m) => m.role === "assistant")
              .map((m) => stripThinkingBlocks(m.content))
              .join("\n"),
            weight: 1,
          },
        ],
        (s) => s.timestamp
      ),
    [preFiltered, debounced]
  );

  // Esc closes the detail sidepanel, not the page
  useEffect(() => {
    if (!selectedSession) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedSession(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedSession]);

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const onCardKey = (e: React.KeyboardEvent, session: AiSession) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelectedSession(session);
    }
  };

  const onCardClick = (session: AiSession) => {
    // A drag that ends on the card is text selection, not an open request.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    setSelectedSession(session);
  };

  // Deleting a chat is irreversible and removes its screenshots too, so it
  // goes through an explicit confirmation rather than firing on first click.
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setSelectedSession(null);
    const remaining = await deleteSessionWithScreenshots(aiSessions, target.id);
    deleteAiSession(target.id);
    await saveAiSessions(remaining);
  };

  const deleteAiSession = useStore((s) => s.deleteAiSession);

  const [pendingDelete, setPendingDelete] = useState<AiSession | null>(null);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="pageTitle">Chat History</div>
          <div className="pageSubtitle">
            F9 conversations — single questions or multi-turn chats
          </div>
        </div>
      </div>

      {aiSessions.length > 0 && (
        <>
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Smart search questions and answers…"
            searching={pending}
          />
          <FilterBar
            apps={apps}
            app={app}
            onApp={setApp}
            date={date}
            onDate={setDate}
            shown={filtered.length}
            total={aiSessions.length}
          />
        </>
      )}

      {aiSessions.length === 0 && (
        <div className="card">
          <div className="empty-state">
            No AI sessions yet. Hold <span className="mono">F9</span> and ask a
            question to get started.
          </div>
        </div>
      )}

      {aiSessions.length > 0 && filtered.length === 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="empty-state">No results for your search.</div>
        </div>
      )}

      <div className="session-list">
        {filtered.map((session) => {
          const title = getFirstUserMessage(session);
          const preview = stripThinkingBlocks(getLastAssistantMessage(session));
          const turns = countUserMessages(session);

          return (
            <div
              key={session.id}
              className="session-card"
              role="button"
              tabIndex={0}
              onClick={() => onCardClick(session)}
              onKeyDown={(e) => onCardKey(e, session)}
            >
              <div className="session-meta">
                <span className="session-time">
                  {formatDate(session.timestamp)}
                </span>
                <span className="session-model">
                  {getGroqModelLabel(session.model)}
                </span>
                {turns > 1 && (
                  <span className="session-turns">{turns} turns</span>
                )}
                {session.continuous && (
                  <span className="session-turns">chat</span>
                )}
              </div>
              <div className="session-question">
                {title.length > 100 ? title.slice(0, 100) + "…" : title}
              </div>
              <div className="session-preview">
                {preview.length > 120
                  ? preview.slice(0, 120) + "…"
                  : preview}
              </div>
              <button
                type="button"
                className="session-delete"
                title="Delete this chat and any screenshots attached to it"
                aria-label="Delete this chat"
                onClick={(e) => {
                  // The card opens on click, so the delete must not bubble.
                  e.stopPropagation();
                  setPendingDelete(session);
                }}
              >
                Delete
              </button>
            </div>
          );
        })}
      </div>

      {pendingDelete && (
        <div className="modal-backdrop" onClick={() => setPendingDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Delete this chat?</div>
            </div>
            <div className="modal-body">
              <p>
                This removes the conversation from this device, along with any
                screenshots saved with it. It cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedSession && (
        <div className="modal-backdrop" onClick={() => setSelectedSession(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">AI Session</div>
                <div className="modal-meta">
                  {formatDate(selectedSession.timestamp)} ·{" "}
                  {getGroqModelLabel(selectedSession.model)}
                  {countUserMessages(selectedSession) > 1 &&
                    ` · ${countUserMessages(selectedSession)} turns`}
                </div>
              </div>
              <button
                className="modal-close"
                onClick={() => setSelectedSession(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body chat-thread">
              {selectedSession.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`chat-bubble chat-bubble--${msg.role}`}
                >
                  <div className="chat-bubble-label">
                    {msg.role === "user" ? "You" : "AI"}
                  </div>
                  <div className="chat-bubble-text">
                    {msg.role === "assistant"
                      ? <ChatMessageContent content={msg.content} />
                      : msg.content}
                  </div>
                  {msg.imageDataUrl && (
                    <ScreenshotImage
                      reference={msg.imageDataUrl}
                      className="chat-screenshot"
                      alt="Screenshot attached to this question"
                    />
                  )}
                  {msg.role === "assistant" && (
                    <button
                      type="button"
                      className="ai-report-action"
                      onClick={() => void reportAiResponse(msg.content, getGroqModelLabel(selectedSession.model))}
                      title="Opens an editable email draft with this response excerpt; nothing is sent automatically."
                    >
                      Report AI response
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
