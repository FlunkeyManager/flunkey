import { useEffect, useMemo, useRef, useState } from "react";
import { STT_LANGUAGES } from "../types";

export function LanguagePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return STT_LANGUAGES;
    return STT_LANGUAGES.filter(
      (l) => l.label.toLowerCase().includes(q) || l.code.toLowerCase().includes(q)
    );
  }, [query]);

  const selected = STT_LANGUAGES.find((l) => l.code === value) ?? STT_LANGUAGES[0];

  const close = () => {
    setOpen(false);
    setMenuPos(null);
    setQuery("");
  };

  const toggle = () => {
    if (open) return close();
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const width = Math.max(280, Math.min(r.width, window.innerWidth - 16));
      const estH = 320;
      const flip = window.innerHeight - r.bottom < estH && r.top > estH + 40;
      setMenuPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        top: flip ? Math.max(8, r.top - estH - 6) : Math.min(r.bottom + 6, window.innerHeight - 120),
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
        className={`or-picker-btn${open ? " open" : ""}`}
        onClick={toggle}
        title={selected.label}
      >
        <span className="or-picker-value">
          {selected.label}
          {selected.code ? ` (${selected.code})` : ""}
        </span>
        <span className="or-picker-caret" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
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
                placeholder="Search languages…"
                autoFocus
              />
            </div>
            <div className="or-picker-meta">{filtered.length} languages</div>
            <div className="or-picker-list">
              {filtered.map((l) => (
                <button
                  key={l.code || "auto"}
                  type="button"
                  className={`or-item${value === l.code ? " selected" : ""}`}
                  onClick={() => {
                    onChange(l.code);
                    close();
                  }}
                  title={l.label}
                >
                  <span className="or-item-main">
                    <span className="or-item-name">{l.label}</span>
                    {l.code && <span className="or-ctx">{l.code}</span>}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="or-picker-empty">No languages match.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
