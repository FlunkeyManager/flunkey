import { useEffect, useRef, useState } from "react";
import { profileForAppId } from "../appProfiles";

export type DatePreset = "all" | "today" | "yesterday" | "week" | "month";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function matchDatePreset(
  ts: number,
  preset: DatePreset,
  now = Date.now()
): boolean {
  switch (preset) {
    case "all":
      return true;
    case "today":
      return startOfLocalDay(ts) === startOfLocalDay(now);
    case "yesterday":
      return startOfLocalDay(ts) === startOfLocalDay(now) - DAY_MS;
    case "week":
      return ts >= now - 7 * DAY_MS;
    case "month":
      return ts >= now - 30 * DAY_MS;
  }
}

export interface AppOption {
  value: string;
  label: string;
  icon: string;
}

/** Distinct app ids actually present in the data (sorted by label). */
export function collectAppOptions<T>(
  items: T[],
  getApp: (item: T) => string | undefined
): AppOption[] {
  const seen = new Map<string, AppOption>();
  for (const item of items) {
    const app = getApp(item);
    if (!app || seen.has(app)) continue;
    const profile = profileForAppId(app);
    seen.set(app, { value: app, label: profile.label, icon: profile.icon });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function filterByAppAndDate<T>(
  items: T[],
  getApp: (item: T) => string | undefined,
  getTimestamp: (item: T) => number,
  app: string,
  date: DatePreset,
  now = Date.now()
): T[] {
  return items.filter(
    (item) =>
      (app === "all" || getApp(item) === app) &&
      matchDatePreset(getTimestamp(item), date, now)
  );
}

interface FilterOption {
  value: string;
  label: string;
  icon?: string;
}

interface MenuPos {
  left: number;
  top: number;
  width: number;
}

/** Themed dropdown: fixed-position menu, icon rows, flip near viewport edge. */
function FilterSelect({
  value,
  options,
  allLabel,
  onChange,
  label,
}: {
  value: string;
  options: FilterOption[];
  allLabel: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const close = () => {
    setOpen(false);
    setPos(null);
  };

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const width = Math.max(170, Math.min(r.width + 40, 240));
      const estH = Math.min(320, 44 + options.length * 34);
      const flip =
        window.innerHeight - r.bottom < estH && r.top > estH + 40;
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        top: flip
          ? Math.max(8, r.top - estH - 6)
          : Math.min(r.bottom + 6, window.innerHeight - 100),
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
  }, [open ]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`fselect-btn${open ? " open" : ""}`}
        onClick={toggle}
        aria-label={label}
        title={label}
      >
        {selected?.icon && (
          <img
            className="fselect-btn-icon"
            src={selected.icon}
            alt=""
            draggable={false}
          />
        )}
        <span className="fselect-btn-label">
          {selected ? selected.label : allLabel}
        </span>
        <span className="fselect-caret" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && pos && (
        <>
          <div
            className="fselect-backdrop"
            onClick={close}
            aria-hidden="true"
          />
          <div
            ref={menuRef}
            className="fselect-menu"
            style={{ left: pos.left, top: pos.top, width: pos.width }}
          >
            <button
              type="button"
              className={`fselect-item${value === "all" ? " selected" : ""}`}
              onClick={() => {
                onChange("all");
                close();
              }}
            >
              <span className="fselect-item-label">{allLabel}</span>
              {value === "all" && <CheckGlyph />}
            </button>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`fselect-item${value === o.value ? " selected" : ""}`}
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
                title={o.label}
              >
                {o.icon && (
                  <img
                    className="fselect-item-icon"
                    src={o.icon}
                    alt=""
                    draggable={false}
                  />
                )}
                <span className="fselect-item-label">{o.label}</span>
                {value === o.value && <CheckGlyph />}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

const DATE_OPTIONS: FilterOption[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "Past 7 days" },
  { value: "month", label: "Past 30 days" },
];

/** Designed check mark (matches the 1.7-weight icon language). */
function CheckGlyph() {
  return (
    <svg
      className="fselect-check"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path d="M4.5 12.5 10 18 19.5 6.5" />
    </svg>
  );
}

/**
 * One quiet row under the search bar: app dropdown (with icons), date
 * dropdown, result count.
 */
export function FilterBar({
  apps,
  app,
  onApp,
  date,
  onDate,
  shown,
  total,
}: {
  apps: AppOption[];
  app: string;
  onApp: (v: string) => void;
  date: DatePreset;
  onDate: (v: DatePreset) => void;
  shown: number;
  total: number;
}) {
  return (
    <div className="history-filters">
      {apps.length > 0 && (
        <FilterSelect
          value={app}
          options={apps}
          allLabel="All apps"
          onChange={onApp}
          label="Filter by app"
        />
      )}
      <FilterSelect
        value={date}
        options={DATE_OPTIONS}
        allLabel="All time"
        onChange={(v) => onDate(v as DatePreset)}
        label="Filter by date"
      />
      <span className="history-count" aria-live="polite">
        {shown} of {total}
      </span>
    </div>
  );
}
