import { useEffect, useMemo, useRef, useState } from "react";
import { OPENROUTER_MODELS } from "../types";
import {
  catalogAgeLabel,
  formatContext,
  formatPrice,
  type OpenRouterCatalogModel,
} from "../openrouter";

interface PickerItem {
  id: string;
  name: string;
  free: boolean;
  priceKnown: boolean;
  promptPer1M: number;
  contextLength: number;
  supportsImages: boolean;
}

function toItems(
  catalog: OpenRouterCatalogModel[] | null
): { items: PickerItem[]; offline: boolean } {
  if (catalog && catalog.length > 0) {
    return {
      items: catalog.map((m) => ({
        id: m.id,
        name: m.name,
        free: m.free,
        priceKnown: true,
        promptPer1M: m.promptPer1M,
        contextLength: m.contextLength,
        supportsImages: m.inputModalities?.includes("image") ?? false,
      })),
      offline: false,
    };
  }
  // Offline fallback: built-in list, no price info.
  return {
    items: OPENROUTER_MODELS.map((m) => ({
      id: m.id,
      name: m.label,
      free: false,
      priceKnown: false,
      promptPer1M: NaN,
      contextLength: 0,
      supportsImages: ["anthropic/claude-3.5-sonnet", "openai/gpt-4o", "google/gemini-2.5-flash"].includes(m.id),
    })),
    offline: true,
  };
}

interface MenuPos {
  left: number;
  top: number;
  width: number;
}

export function OpenRouterModelPicker({
  value,
  onChange,
  catalog,
  catalogLoading,
  catalogUpdatedAt,
  onRefresh,
}: {
  value: string;
  onChange: (id: string) => void;
  catalog: OpenRouterCatalogModel[] | null;
  catalogLoading: boolean;
  catalogUpdatedAt: number | null;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const commitCustom = () => {
    const id = customDraft.trim();
    if (id) onChange(id);
    setCustomMode(false);
    close();
  };

  const { items, offline } = useMemo(() => toItems(catalog), [catalog]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((m) => {
      if (freeOnly && !m.free) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
      );
    });
  }, [items, query, freeOnly]);

  const selected = items.find((m) => m.id === value) ?? null;
  const missing =
    value.trim() && !selected
      ? "Not in the current list — still works if the API serves it."
      : null;

  const close = () => {
    setOpen(false);
    setMenuPos(null);
    setQuery("");
    setCustomMode(false);
  };

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    // Fixed positioning from the trigger rect: immune to ancestor
    // overflow/scroll clipping, flips upward near the viewport bottom.
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const width = Math.max(300, Math.min(r.width, window.innerWidth - 16));
      const estH = 330;
      const flip =
        window.innerHeight - r.bottom < estH && r.top > estH + 40;
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

  // Dismiss on outside scroll/resize/Escape — but not on list-internal scroll.
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
  }, [open ]);

  return (
    <div className="or-picker">
      <button
        ref={btnRef}
        type="button"
        className={`or-picker-btn${selected ? " selected" : ""}${open ? " open" : ""}`}
        onClick={toggle}
        title={selected ? selected.id : "Choose an OpenRouter model"}
      >
        <span className="or-picker-value">
          {selected ? selected.name : value.trim() || "Select model…"}
        </span>
        {selected?.free && <span className="or-free">FREE</span>}
        <span className="or-picker-caret" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {missing && <div className="or-picker-note warn">{missing}</div>}

      {open && menuPos && (
        <>
          <div
            className="or-picker-backdrop"
            onClick={close}
            aria-hidden="true"
          />
          <div
            ref={menuRef}
            className="or-picker-menu"
            style={{
              left: menuPos.left,
              top: menuPos.top,
              width: menuPos.width,
            }}
          >
            <div className="or-picker-tools">
              <input
                className="settings-input or-picker-search"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search 400+ models…"
                autoFocus
              />
              <button
                type="button"
                className={`or-pill${freeOnly ? " selected" : ""}`}
                onClick={() => setFreeOnly(!freeOnly)}
                title="Show free models only"
              >
                Free
              </button>
              <button
                type="button"
                className="or-pill"
                onClick={onRefresh}
                disabled={catalogLoading}
                title={
                  catalogUpdatedAt
                    ? `Updated ${catalogAgeLabel(catalogUpdatedAt)} — refresh`
                    : "Fetch model list"
                }
                style={{ opacity: catalogLoading ? 0.5 : 1 }}
              >
                {catalogLoading ? "…" : "↻"}
              </button>
            </div>
            <div className="or-picker-meta">
              {offline
                ? "Offline list — connect to refresh."
                : `${filtered.length} of ${items.length} · ${catalogUpdatedAt ? catalogAgeLabel(catalogUpdatedAt) : "just now"}`}
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
                    <span className="or-item-name">{m.name}</span>
                    {m.supportsImages && <span className="or-vision">Vision</span>}
                    <span className="or-item-id mono">{m.id}</span>
                  </span>
                  <span className="or-item-side">
                    {m.free ? (
                      <span className="or-free">FREE</span>
                    ) : (
                      m.priceKnown && (
                        <span className="or-price">
                          {formatPrice(m.promptPer1M)}
                        </span>
                      )
                    )}
                    {formatContext(m.contextLength) && (
                      <span className="or-ctx">
                        {formatContext(m.contextLength)}
                      </span>
                    )}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="or-picker-empty">No models match.</div>
              )}
            </div>
            <div className="or-picker-custom">
              {customMode ? (
                <input
                  className="settings-input mono"
                  type="text"
                  value={customDraft}
                  autoFocus
                  placeholder="vendor/model-name"
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
