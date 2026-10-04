import { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText as writeClipboardText } from "@tauri-apps/plugin-clipboard-manager";
import {
  DEFAULT_HOTKEYS,
  keyboardEventMatchesBinding,
  type AppHotkeys,
} from "./hotkeys";
import { segmentMessageContent, stripThinkingBlocks } from "./responseSanitizer";
import { resolveAppProfile } from "./appProfiles";
import { useOverlayWindowResize } from "./useOverlayWindowResize";
import { splitByDisplayMath, splitByInlineMath, renderKatex } from "./lib/katexMath";
import "./overlay.css";

// No native context menus (see main.tsx).
window.addEventListener("contextmenu", (e) => e.preventDefault());

type OverlayMessage = {
  role: string;
  content: string;
  imageDataUrl?: string;
};

type SyncChatPayload = {
  continuous: boolean;
  messages: OverlayMessage[];
};

type DrawerSession = {
  id: string;
  timestamp: number;
  model: string;
  title: string;
  preview: string;
  turns: number;
};

function OverlayApp() {
  const [continuous, setContinuous] = useState(false);
  const [messages, setMessages] = useState<OverlayMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [dragEnabled, setDragEnabled] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<DrawerSession[]>([]);
  const [hotkeys, setHotkeys] = useState<AppHotkeys>(DEFAULT_HOTKEYS);
  const [attachedScreenshot, setAttachedScreenshot] = useState<string | null>(null);
  const [screenshotError, setScreenshotError] = useState("");
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const boundsSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const scheduleBoundsSave = useCallback(() => {
    clearTimeout(boundsSaveTimer.current);
    boundsSaveTimer.current = setTimeout(() => {
      invoke("save_overlay_free_bounds").catch(console.error);
    }, 150);
  }, []);

  const { isResizingRef, onResizePointerDown } = useOverlayWindowResize(
    dragEnabled,
    scheduleBoundsSave
  );

  useEffect(() => {
    const unlisten: (() => void)[] = [];

    listen<SyncChatPayload>("sync-chat", (event) => {
      setContinuous(event.payload.continuous);
      setMessages(event.payload.messages);
      setStreaming(true);
      setShowHistory(false);
    }).then((u) => unlisten.push(u));

    listen<string>("set-question", (event) => {
      setMessages([{ role: "user", content: event.payload }]);
      setStreaming(true);
      setShowHistory(false);
    }).then((u) => unlisten.push(u));

    listen<string>("append-token", (event) => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content: last.content + event.payload,
          };
        } else {
          next.push({ role: "assistant", content: event.payload });
        }
        return next;
      });
      requestAnimationFrame(() => {
        if (bodyRef.current) {
          bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
        }
      });
    }).then((u) => unlisten.push(u));

    listen("stream-end", () => {
      setStreaming(false);
    }).then((u) => unlisten.push(u));

    listen<string>("overlay-model", () => {
      // Model is fixed to GPT-OSS 120B; no selector state needed.
    }).then((u) => unlisten.push(u));

    listen<DrawerSession[]>("overlay-sessions", (event) => {
      setSessions(event.payload);
    }).then((u) => unlisten.push(u));

    listen("overlay-close-history", () => {
      setShowHistory(false);
    }).then((u) => unlisten.push(u));

    listen("f9-image-consumed", () => {
      setAttachedScreenshot(null);
      setScreenshotError("");
    }).then((u) => unlisten.push(u));

    listen("f9-image-cleared", () => {
      setAttachedScreenshot(null);
      setScreenshotError("");
    }).then((u) => unlisten.push(u));

    listen<AppHotkeys>("hotkeys-changed", (event) => {
      setHotkeys(event.payload);
    }).then((u) => unlisten.push(u));

    return () => {
      unlisten.forEach((u) => u());
    };
  }, []);

  const captureScreenshot = useCallback(async () => {
    setScreenshotError("");
    setCapturingScreenshot(true);
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("Screen capture is not available in this Windows version.");
      }
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      if (!video.videoWidth || !video.videoHeight) {
        await new Promise<void>((resolve, reject) => {
          video.addEventListener("loadedmetadata", () => resolve(), { once: true });
          video.addEventListener(
            "error",
            () => reject(new Error("Could not read the selected screen.")),
            { once: true }
          );
        });
      }
      const scale = Math.min(1, 1280 / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare the screenshot.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageDataUrl = canvas.toDataURL("image/jpeg", 0.72);
      if (imageDataUrl.length > 1_400_000) {
        throw new Error("The screenshot is too large. Select a smaller window or screen.");
      }
      await emit("f9-image-attached", imageDataUrl);
      setAttachedScreenshot(imageDataUrl);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setScreenshotError("Screen capture was cancelled.");
      } else {
        setScreenshotError(
          error instanceof Error ? error.message : "Could not capture the screen."
        );
      }
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setCapturingScreenshot(false);
    }
  }, []);

  const [captureSources, setCaptureSources] = useState<
    { kind: "monitor" | "window"; id: number; label: string; appName?: string | null }[] | null
  >(null);
  const [sourcePreview, setSourcePreview] = useState<{
    index: number;
    src: string | null;
  } | null>(null);
  const openSourcePicker = useCallback(async () => {
    setScreenshotError("");
    try {
      const sources = await invoke<
        { kind: "monitor" | "window"; id: number; label: string }[]
      >("capture_sources");
      setCaptureSources(sources);
    } catch {
      // Native capture unavailable — fall back to the OS dialog.
      await captureScreenshot();
    }
  }, [captureScreenshot]);
  const captureFromSource = useCallback(
    async (kind: "monitor" | "window", id: number) => {
      setCaptureSources(null);
      setSourcePreview(null);
      setCapturingScreenshot(true);
      setScreenshotError("");
      try {
        const imageDataUrl = await invoke<string>("capture_screen", { kind, id });
        if (!imageDataUrl.startsWith("data:image/jpeg")) {
          throw new Error("Unexpected capture result");
        }
        if (imageDataUrl.length > 1_400_000) {
          throw new Error("The screenshot is too large. Try a smaller window.");
        }
        await emit("f9-image-attached", imageDataUrl);
        setAttachedScreenshot(imageDataUrl);
      } catch (error) {
        setScreenshotError(
          error instanceof Error ? error.message : "Could not capture the screen."
        );
      } finally {
        setCapturingScreenshot(false);
      }
    },
    []
  );

  const previewSource = useCallback(
    async (index: number, kind: "monitor" | "window", id: number) => {
      // Immediate loading state, then a cheap low-quality preview.
      setSourcePreview({ index, src: null });
      try {
        const src = await invoke<string>("capture_screen", {
          kind,
          id,
          maxWidth: 360,
          quality: 45,
        });
        // Only the most recently hovered row may publish its preview.
        setSourcePreview((prev) =>
          prev && prev.index === index ? { index, src } : prev
        );
      } catch {
        setSourcePreview((prev) =>
          prev && prev.index === index ? null : prev
        );
      }
    },
    []
  );

  const clearScreenshot = useCallback(async () => {
    setAttachedScreenshot(null);
    setScreenshotError("");
    await emit("f9-image-cleared").catch(console.error);
  }, []);

  // Keep history warm
  useEffect(() => {
    emit("overlay-request-sessions").catch(() => {});
  }, []);
  useEffect(() => {
    if (showHistory) emit("overlay-request-sessions").catch(() => {});
  }, [showHistory]);

  // Let the focused overlay reuse the configured app hotkeys even when the
  // global hook is swallowed by the webview itself.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;

      if (keyboardEventMatchesBinding(e, hotkeys.transcribe)) {
        e.preventDefault();
        e.stopPropagation();
        emit("f8-start").catch(() => {});
        return;
      }
      if (keyboardEventMatchesBinding(e, hotkeys.askAi)) {
        e.preventDefault();
        e.stopPropagation();
        if (showHistory) setShowHistory(false);
        emit("f9-start").catch(() => {});
        return;
      }
      if (keyboardEventMatchesBinding(e, hotkeys.transform)) {
        e.preventDefault();
        e.stopPropagation();
        emit("transform-start").catch(() => {});
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (keyboardEventMatchesBinding(e, hotkeys.transcribe)) {
        e.preventDefault();
        e.stopPropagation();
        emit("f8-stop").catch(() => {});
        return;
      }
      if (keyboardEventMatchesBinding(e, hotkeys.askAi)) {
        e.preventDefault();
        e.stopPropagation();
        emit("f9-stop").catch(() => {});
        return;
      }
      if (keyboardEventMatchesBinding(e, hotkeys.transform)) {
        e.preventDefault();
        e.stopPropagation();
        emit("transform-stop").catch(() => {});
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [hotkeys, showHistory]);

  const dismissOverlay = useCallback(async () => {
    if (showHistory) {
      setShowHistory(false);
      // Esc from history should close panel and make next F9 a fresh chat, not resume the previewed session
      await emit("f9-new-chat").catch(() => {});
      await invoke("hide_overlay");
      return;
    }
    if (continuous) {
      setMessages([]);
      setStreaming(false);
      await emit("f9-new-chat");
    }
    await invoke("hide_overlay");
  }, [continuous, showHistory]);

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void dismissOverlay();
      }
    };
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [dismissOverlay]);

  useEffect(() => {
    const unlisten: (() => void)[] = [];

    invoke<boolean>("is_overlay_free")
      .then(setDragEnabled)
      .catch(console.error);

    listen<boolean>("overlay-drag-enabled", (event) => {
      setDragEnabled(event.payload);
    }).then((u) => unlisten.push(u));

    return () => {
      unlisten.forEach((u) => u());
    };
  }, []);

  useEffect(() => {
    if (!dragEnabled) return;

    const win = getCurrentWindow();
    let cancelled = false;
    let unlistenMove: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;

    win
      .onMoved(() => {
        if (isResizingRef.current) return;
        scheduleBoundsSave();
      })
      .then((u) => {
        if (cancelled) u();
        else unlistenMove = u;
      })
      .catch(console.error);

    win
      .onResized(() => {
        if (isResizingRef.current) return;
        scheduleBoundsSave();
      })
      .then((u) => {
        if (cancelled) u();
        else unlistenResize = u;
      })
      .catch(console.error);

    return () => {
      cancelled = true;
      clearTimeout(boundsSaveTimer.current);
      unlistenMove?.();
      unlistenResize?.();
    };
  }, [dragEnabled, isResizingRef, scheduleBoundsSave]);

  const handleDragStart = (e: React.PointerEvent) => {
    if (!dragEnabled) return;
    if (isResizingRef.current) return;
    if ((e.target as HTMLElement).closest("button, select, label")) return;
    if ((e.target as HTMLElement).closest(".overlayResize")) return;
    e.preventDefault();
    void getCurrentWindow().startDragging();
  };

  const lastAssistant = stripThinkingBlocks(
    [...messages].reverse().find((m) => m.role === "assistant")?.content ?? ""
  );

  useEffect(() => {
    const handleKeydown = async (event: KeyboardEvent) => {
      const isCopyShortcut =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c";
      if (!isCopyShortcut) return;

      const selectionText = document.getSelection()?.toString().trim();
      const textToCopy = selectionText || lastAssistant;
      if (!textToCopy) return;

      event.preventDefault();
      try {
        await writeClipboardText(textToCopy);
      } catch {
        try { await navigator.clipboard.writeText(textToCopy); } catch {}
      }
    };

    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [lastAssistant]);

  // Ensure window gets focus when user clicks to select text
  useEffect(() => {
    const onMouseDown = () => {
      void getCurrentWindow().setFocus().catch(() => {});
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const toggleContinuous = async () => {
    const next = !continuous;
    setContinuous(next);
    await emit("f9-continuous-changed", next);
  };

  const openSession = async (id: string) => {
    setShowHistory(false);
    await emit("overlay-select-session", id).catch(() => {});
  };

  const handleCopyCode = async (text: string) => {
    try {
      await writeClipboardText(text);
    } catch {
      try { await navigator.clipboard.writeText(text); } catch {}
    }
    void getCurrentWindow().setFocus().catch(() => {});
  };

  // ── Inline markdown (code, bold, italic) + inline math ──
  const renderInlineInner = (text: string, baseKey: number): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    const regex = /(`[^`]+`|\*\*.*?\*\*|__.*?__|\*[^*\n]+?\*|_[^_\n]+?_)/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    let key = baseKey;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > lastIndex) {
        parts.push(text.slice(lastIndex, m.index));
      }
      const token = m[0];
      if (token.startsWith("`")) {
        parts.push(<code key={`c-${key++}`} className="overlayInlineCode">{token.slice(1, -1)}</code>);
      } else if (token.startsWith("**") || token.startsWith("__")) {
        parts.push(<strong key={`b-${key++}`} className="overlayBold">{token.slice(2, -2)}</strong>);
      } else {
        parts.push(<em key={`i-${key++}`} className="overlayItalic">{token.slice(1, -1)}</em>);
      }
      lastIndex = m.index + token.length;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts.length ? parts : [text];
  };

  const renderInline = (text: string): React.ReactNode[] => {
    const splits = splitByInlineMath(text);
    const out: React.ReactNode[] = [];
    let k = 0;
    for (const seg of splits) {
      if (seg.kind === "inline") {
        const html = renderKatex(seg.math, false);
        out.push(<span key={`mi-${k++}`} className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />);
      } else {
        out.push(...renderInlineInner(seg.text, k * 1000));
        k++;
      }
    }
    return out;
  };

  const renderTextBlocks = (raw: string) => {
    const lines = raw.split(/\r?\n/);
    const blocks: React.ReactNode[] = [];
    let paraBuffer: string[] = [];
    let listItems: string[] = [];
    let listOrdered = false;

    const flushPara = () => {
      if (paraBuffer.length === 0) return;
      const text = paraBuffer.join(" ").trim();
      if (text) blocks.push(<p key={`p-${blocks.length}`} className="overlayPara">{renderInline(text)}</p>);
      paraBuffer = [];
    };
    const flushList = () => {
      if (listItems.length === 0) return;
      blocks.push(
        <ul key={`l-${blocks.length}`} className={listOrdered ? "overlayOrderedList" : "overlayList"}>
          {listItems.map((it, idx) => (
            <li key={idx} className="overlayListItem">{renderInline(it)}</li>
          ))}
        </ul>
      );
      listItems = [];
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        flushPara();
        flushList();
        continue;
      }
      // Heading
      const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        flushPara();
        flushList();
        const level = heading[1].length;
        const content = heading[2];
        blocks.push(
          level === 1 ? <h3 key={`h-${blocks.length}`} className="overlayH3">{renderInline(content)}</h3> :
          level === 2 ? <h4 key={`h-${blocks.length}`} className="overlayH4">{renderInline(content)}</h4> :
                        <h5 key={`h-${blocks.length}`} className="overlayH5">{renderInline(content)}</h5>
        );
        continue;
      }
      // Unordered list
      const ul = trimmed.match(/^[-*]\s+(.*)$/);
      if (ul) {
        flushPara();
        if (listItems.length && listOrdered) flushList();
        listOrdered = false;
        listItems.push(ul[1]);
        continue;
      }
      // Ordered list
      const ol = trimmed.match(/^\d+\.\s+(.*)$/);
      if (ol) {
        flushPara();
        if (listItems.length && !listOrdered) flushList();
        listOrdered = true;
        listItems.push(ol[1]);
        continue;
      }
      // Blockquote
      if (trimmed.startsWith("> ")) {
        flushPara();
        flushList();
        blocks.push(<blockquote key={`q-${blocks.length}`} className="overlayQuote">{renderInline(trimmed.slice(2))}</blockquote>);
        continue;
      }
      // Normal line → part of paragraph
      if (listItems.length) flushList();
      paraBuffer.push(trimmed);
    }
    flushPara();
    flushList();
    return blocks.length ? blocks : [<span key="empty">{renderInline(raw)}</span>];
  };

  const renderMessageContent = (content: string) => {
    const cleaned = stripThinkingBlocks(content);
    if (!cleaned) {
      return streaming ? <span className="overlayPlaceholder">Thinking…</span> : null;
    }
    const segments = segmentMessageContent(cleaned, streaming);
    if (segments.length === 0) {
      return streaming ? <span className="overlayPlaceholder">Thinking…</span> : cleaned;
    }
    return (
      <div className="overlayRichContent">
        {segments.map((seg, idx) => {
          if (seg.kind === "code") {
            return (
              <div key={`seg-${idx}`} className="overlayCodeWrap">
                <div className="overlayCodeHeader">
                  <span className="overlayCodeLang">{seg.lang || "code"}</span>
                  <button
                    type="button"
                    className="overlayCodeCopy"
                    onClick={() => void handleCopyCode(seg.text)}
                    title="Copy code"
                  >
                    Copy
                  </button>
                </div>
                <pre className="overlayCodeBlock">
                  <code className={seg.lang ? `language-${seg.lang}` : undefined}>{seg.text}</code>
                </pre>
              </div>
            );
          }
          if (seg.kind === "table") {
            return (
              <div key={`seg-${idx}`} className="overlayTableWrap">
                <table className="overlayDataTable">
                  <thead>
                    <tr>
                      {seg.header.map((cell, cIdx) => (
                        <th key={`${cell}-${cIdx}`}>{cell}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {seg.rows.map((row, rIdx) => (
                      <tr key={`row-${rIdx}`}>
                        {row.map((cell, cellIndex) => (
                          <td key={`${rIdx}-${cellIndex}`}>{renderInline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          // text — split display math (\[...\] / $$...$$) into blocks
          const displayParts = splitByDisplayMath(seg.text);
          return (
            <div key={`seg-${idx}`} className="overlayTextBlock">
              {displayParts.map((part, pIdx) => {
                if (part.kind === "display") {
                  const html = renderKatex(part.math, true);
                  return <div key={`dm-${pIdx}`} className="math-display" dangerouslySetInnerHTML={{ __html: html }} />;
                }
                // For plain text fragments, preserve full block structure (headings/lists/para)
                // but still support inline math via renderInline
                return <span key={`dt-${pIdx}`}>{renderTextBlocks(part.text)}</span>;
              })}
            </div>
          );
        })}
      </div>
    );
  };

  const formatDrawerTime = (ts: number) =>
    new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className={`overlayRoot${dragEnabled ? " overlayRoot--free" : ""}`}>
      <div
        className={`overlayHeader${dragEnabled ? " overlayHeader--draggable" : ""}`}
        onPointerDown={handleDragStart}
        title={dragEnabled ? "Drag header to move" : undefined}
      >
        <div className="overlayHeaderLeft">
          <button
            type="button"
            className={`overlayMenuBtn ${showHistory ? "active" : ""}`}
            onClick={() => setShowHistory((o) => !o)}
            title={showHistory ? "Back to chat" : "View history"}
            aria-label="Toggle session history"
          >
            <img src="/icons/sidebar.svg" alt="" className="overlayMenuIcon" />
          </button>
        </div>
        <div className="overlayHeaderActions">
          <button
            type="button"
            className={`overlayScreenshotBtn${attachedScreenshot ? " active" : ""}${captureSources ? " active" : ""}`}
            onClick={() => {
              if (captureSources) {
                setCaptureSources(null);
                return;
              }
              void openSourcePicker();
            }}
            disabled={capturingScreenshot || showHistory}
            title="Choose a screen or app window to attach to your next F9 question"
          >
            {capturingScreenshot
              ? "Capturing…"
              : attachedScreenshot
                ? "Replace screenshot"
                : "Screenshot"}
          </button>
          <button
            type="button"
            className={`overlayModeBtn${continuous ? " active" : ""}`}
            onClick={toggleContinuous}
            title="Keep context across F9 turns"
          >
            {continuous ? "Chat on" : "Chat off"}
          </button>
          <button
            type="button"
            className="overlayClose"
            onClick={() => void dismissOverlay()}
          >
            Esc
          </button>
        </div>
      </div>

      {attachedScreenshot && (
        <div className="overlayPendingAttachment">
          <img src={attachedScreenshot} alt="Screenshot attached to the next F9 question" />
          <div className="overlayPendingAttachmentInfo">
            <span>Attached to your next F9 question</span>
            <button type="button" onClick={() => void clearScreenshot()}>
              Remove
            </button>
          </div>
        </div>
      )}
      {screenshotError && <div className="overlayScreenshotError">{screenshotError}</div>}

      {captureSources && (
        <div className="overlaySourcePicker">
          <div className="overlaySourcePickerHeader">
            <span>Capture from…</span>
            <span className="overlaySourcePickerHint">Screenshot closes this</span>
          </div>
          <div className="overlaySourcePickerList">
            {captureSources.map((s, i) => {
              const exeGuess = s.appName
                ? s.appName.toLowerCase().endsWith(".exe")
                  ? s.appName
                  : `${s.appName}.exe`
                : null;
              const profile =
                s.kind === "window"
                  ? resolveAppProfile(exeGuess, s.label)
                  : null;
              return (
                <button
                  key={`${s.kind}-${s.id}-${i}`}
                  type="button"
                  className="overlaySourceItem"
                  onClick={() => void captureFromSource(s.kind, s.id)}
                  onMouseEnter={() => void previewSource(i, s.kind, s.id)}
                >
                  {profile ? (
                    <img src={profile.icon} alt="" className="overlaySourceIcon" />
                  ) : (
                    <span className="overlaySourceKind">🖥</span>
                  )}
                  <span className="overlaySourceLabel">{s.label}</span>
                </button>
              );
            })}
            {captureSources.length === 0 && (
              <div className="overlaySourceEmpty">Nothing to capture.</div>
            )}
          </div>
          {sourcePreview && sourcePreview.src && (
            <img
              className="overlaySourcePreview"
              src={sourcePreview.src}
              alt="Preview of the hovered source"
            />
          )}
        </div>
      )}

      <div className="overlayBody" ref={bodyRef}>
        {showHistory ? (
          <div className="overlayHistoryView">
            <div className="overlayHistoryTop">
              <div className="overlayHistoryTitle">History</div>
            </div>
            <div className="overlayHistoryList">
              {sessions.length === 0 ? (
                <div className="overlayHistoryEmpty">No chats yet. Hold F9 and ask.</div>
              ) : (
                sessions.map((s) => (
                  <button key={s.id} type="button" className="overlayHistoryItem" onClick={() => void openSession(s.id)}>
                    <div className="overlayHistoryItemMeta">
                      <span className="overlayHistoryItemTime">{formatDrawerTime(s.timestamp)}</span>
                      <span className="overlayHistoryItemModel">{s.model.split("/").pop() || s.model}</span>
                      {s.turns > 1 && <span className="overlayHistoryItemTurns">{s.turns} turns</span>}
                    </div>
                    <div className="overlayHistoryItemTitle">{s.title.length > 64 ? s.title.slice(0, 64) + "…" : s.title || "Untitled"}</div>
                    <div className="overlayHistoryItemPreview">{s.preview.length > 96 ? s.preview.slice(0, 96) + "…" : s.preview}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <>
            {messages.length === 0 && (
              <div className="overlayEmpty">
                {continuous
                  ? "Continuous chat is on. Attach a screenshot if useful, then hold F9 and ask."
                  : "Attach a screenshot if useful, then hold F9 and ask. Turn on Chat for multi-turn memory."}
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={`${msg.role}-${i}`}
                className={`overlayMsg overlayMsg--${msg.role}`}
              >
                <div className="overlayMsgLabel">
                  {msg.role === "user" ? "You" : "AI"}
                </div>
                <div className="overlayMsgText">
                  {msg.role === "assistant"
                    ? renderMessageContent(msg.content)
                    : msg.content}
                </div>
                {msg.imageDataUrl && (
                  <img
                    className="overlayMessageImage"
                    src={msg.imageDataUrl}
                    alt="Screenshot attached to this question"
                  />
                )}
              </div>
            ))}
          </>
        )}
      </div>
      {dragEnabled && (
        <div className="overlayResize">
          <div
            className="overlayResizeEdge overlayResizeEdge--east"
            onPointerDown={onResizePointerDown("horizontal")}
            title="Resize width"
            aria-label="Resize width"
          />
          <div
            className="overlayResizeEdge overlayResizeEdge--south"
            onPointerDown={onResizePointerDown("vertical")}
            title="Resize height"
            aria-label="Resize height"
          />
          <div
            className="overlayResizeHandle"
            onPointerDown={onResizePointerDown("both")}
            title="Resize panel"
            aria-label="Resize panel"
          />
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <OverlayApp />,
);
