import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes, type OllamaModel } from "../ollama";

interface Props {
  value: string;
  onChange: (id: string) => void;
  models: OllamaModel[];
  loading: boolean;
  error: string;
  onRefresh: () => void;
}

export function OllamaModelPicker({
  value,
  onChange,
  models,
  loading,
  error,
  onRefresh,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [visionOnly, setVisionOnly] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter((m) => {
      if (visionOnly && !m.vision) return false;
      if (!q) return true;
      return m.id.toLowerCase().includes(q);
    });
  }, [models, query, visionOnly]);

  const selected = models.find((m) => m.id === value) ?? null;

  const close = () => {
    setOpen(false);
    setMenuPos(null);
    setQuery("");
    setCustomMode(false);
  };

  const commitCustom = () => {
    const id = customDraft.trim();
    if (id) onChange(id);
    setCustomMode(false);
    close();
  };

  const toggle = () => {
    if (open) return close();
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const width = Math.max(300, Math.min(r.width, window.innerWidth - 16));
      const estH = 330;
      const flip = window.innerHeight - r.bottom < estH && r.top > estH + 40;
      setMenuPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        top: flip
          ? Math.max(8, r.top - estH - 6)
          : Math.min(r.bottom + 6, window.innerHeight - 120),
        width,
      });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onResize = () => close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="or-picker">
      <button
        ref={btnRef}
        type="button"
        className={`or-picker-btn${selected ? " selected" : ""}${open ? " open" : ""}`}
        onClick={toggle}
        title={selected ? selected.id : "Choose a local model"}
      >
        <span className="or-picker-value">
          {selected ? selected.id : value.trim() || "Select model…"}
        </span>
        <span className="or-picker-caret" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {!selected && value.trim() && (
        <div className="or-picker-note warn">
          Not installed locally — pull it with `ollama pull {value.trim()}`.
        </div>
      )}
      {error && <div className="or-picker-note warn">{error}</div>}

      {open && menuPos && (
        <>
          <div className="or-picker-backdrop" onClick={close} aria-hidden="true" />
          <div
            ref={menuRef}
            className="or-picker-menu"
            style={{ left: menuPos.left, top: menuPos.top, width: menuPos.width }}
          >
            <div className="or-picker-tools">
              <input
                className="settings-input or-picker-search"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search local models…"
                autoFocus
              />
              <button
                type="button"
                className={`or-pill${visionOnly ? " selected" : ""}`}
                onClick={() => setVisionOnly(!visionOnly)}
                title="Show vision-capable models only"
              >
                Vision
              </button>
              <button
                type="button"
                className="or-pill"
                onClick={onRefresh}
                disabled={loading}
                title="Refresh installed models"
              >
                {loading ? "…" : "↻"}
              </button>
            </div>
            <div className="or-picker-meta">
              {loading ? "Loading…" : `${filtered.length} of ${models.length} installed`}
            </div>
            <div className="or-picker-list">
              {filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`or-item${value === m.id ? " selected" : ""}`}
                  onClick={() => {
                    onChange(m.id);
                    close();
                  }}
                  title={m.id}
                >
                  <span className="or-item-main">
                    <span className="or-item-name">{m.id}</span>
                    {m.vision && <span className="or-vision">Vision</span>}
                    {m.tools && <span className="or-ctx">tools</span>}
                  </span>
                  <span className="or-item-side">
                    {formatBytes(m.size) && (
                      <span className="or-ctx">{formatBytes(m.size)}</span>
                    )}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="or-picker-empty">
                  {models.length === 0
                    ? "No models installed. Run `ollama pull llama3.2`."
                    : "No models match."}
                </div>
              )}
            </div>
            <div className="or-picker-custom">
              {customMode ? (
                <input
                  className="settings-input mono"
                  type="text"
                  value={customDraft}
                  autoFocus
                  placeholder="model:tag"
                  onChange={(e) => setCustomDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitCustom();
                    if (e.key === "Escape") setCustomMode(false);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="or-picker-custom-btn"
                  onClick={() => {
                    setCustomDraft(value);
                    setCustomMode(true);
                  }}
                >
                  Custom model id…
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
