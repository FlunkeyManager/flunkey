/**
 * Applications.tsx — per-application dictation prompts.
 *
 * The app profiles shipped a hardcoded one-line suffix each ("preserve code
 * identifiers", "plain single-block text") that could only be changed by
 * editing source and rebuilding. That is a fine default and a useless control:
 * a developer who wants commit messages lowercase, or a chat prompt expanded
 * into detail, had nowhere to say so.
 *
 * Laid out as bare icons in a tight grid. Twenty-six boxed cards with captions
 * is a page you scroll past; the logos are already distinctive, so the label
 * is redundant on screen and stays available as a tooltip and accessible name.
 * The editor for the chosen application appears underneath.
 *
 * At the Enhanced level, the global standing instructions and this
 * application-specific prompt are combined. A custom prompt replaces this
 * application's shipped default only.
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { saveSettings } from "../persistence";
import { APP_PROFILES } from "../appProfiles";
import type { AppId } from "../appProfiles";

interface AppEntry {
  id: AppId;
  label: string;
  icon: string;
  defaultText: string;
}

const ENTRIES: AppEntry[] = Object.values(APP_PROFILES).map((p) => ({
  id: p.id,
  label: p.label,
  icon: p.icon,
  defaultText: p.polishSuffix?.trim() ?? "",
}));

export function Applications() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setCurrentPage = useStore((s) => s.setCurrentPage);

  const [query, setQuery] = useState("");
  /** One open at a time; null means the grid only. */
  const [openId, setOpenId] = useState<AppId | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Seed each editor with what is actually in force, so the shipped default is
  // discoverable rather than hidden behind an empty box.
  useEffect(() => {
    const seeded: Record<string, string> = {};
    for (const app of ENTRIES) {
      seeded[app.id] =
        (settings.appInstructions ?? {})[app.id] ?? app.defaultText;
    }
    setDrafts(seeded);
  }, [settings.appInstructions]);

  const persist = async (patch: Partial<typeof settings>) => {
    const updated = { ...useStore.getState().settings, ...patch };
    setSettings(updated);
    await saveSettings(updated);
  };

  const persistInstruction = async (id: string, value: string) => {
    const map = { ...(useStore.getState().settings.appInstructions ?? {}) };
    if (value.trim()) map[id] = value.trim();
    else delete map[id];
    await persist({ appInstructions: map });
  };

  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? ENTRIES.filter(
            (a) =>
              a.label.toLowerCase().includes(needle) ||
              // Search the shipped default too, so "commit" finds the
              // applications whose default mentions commit messages.
              a.defaultText.toLowerCase().includes(needle),
          )
        : ENTRIES,
    [needle],
  );

  const overrideCount = Object.values(settings.appInstructions ?? {}).filter(
    (v) => v.trim(),
  ).length;

  const open = ENTRIES.find((a) => a.id === openId) ?? null;
  const openCustomized = open
    ? Boolean((settings.appInstructions ?? {})[open.id]?.trim())
    : false;

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="pageTitle">Applications</div>
          <div className="pageSubtitle">
            What "cleaned up" should mean in each app
          </div>
        </div>
      </div>

      <div className="apps-toolbar">
        <div className="apps-search">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="text"
            placeholder="Search applications"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search applications"
          />
          {query && (
            <button
              type="button"
              className="apps-search-clear"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        <div className="apps-meta">
          {overrideCount > 0 ? `${overrideCount} customised` : "None customised"}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="empty-state">No applications match “{query}”.</div>
        </div>
      ) : (
        <div className="apps-grid">
          {visible.map((app) => {
            const customized = Boolean(
              (settings.appInstructions ?? {})[app.id]?.trim(),
            );
            return (
              <button
                key={app.id}
                type="button"
                className={`app-tile${openId === app.id ? " open" : ""}${
                  customized ? " customized" : ""
                }`}
                onClick={() => setOpenId(openId === app.id ? null : app.id)}
                aria-expanded={openId === app.id}
                aria-label={app.label}
                title={app.label}
              >
                <img src={app.icon} alt="" aria-hidden="true" />
                {customized && <span className="app-tile-dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}

      {open && (
        <div className="app-detail">
          <div className="app-detail-head">
            <img className="app-detail-icon" src={open.icon} alt="" aria-hidden="true" />
            <div className="app-detail-title">{open.label}</div>
            <button
              type="button"
              className="app-detail-close"
              onClick={() => setOpenId(null)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="app-detail-field">
            <div className="settings-label">
              Dictation prompt{" "}
              {openCustomized && <span className="app-instruction-tag">Custom</span>}
            </div>
            <textarea
              className="app-instruction-input"
              rows={4}
              value={drafts[open.id] ?? ""}
              placeholder="e.g. Expand this into a detailed prompt"
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [open.id]: e.target.value }))
              }
              onBlur={(e) => void persistInstruction(open.id, e.target.value)}
            />
            <div className="app-detail-foot">
              <span className="app-instruction-default">
                {openCustomized
                  ? "Used as written."
                  : open.defaultText || "No default — write your own."}
              </span>
              {openCustomized && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setDrafts((prev) => ({ ...prev, [open.id]: open.defaultText }));
                    void persistInstruction(open.id, "");
                  }}
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="settings-desc" style={{ marginTop: 16 }}>
        Combined with Standing instructions at the Enhanced level. A custom
        application prompt replaces that app's default.{" "}
        <button
          type="button"
          className="link-btn"
          onClick={() => setCurrentPage("dictation")}
        >
          Set one prompt for every app
        </button>
      </div>
    </div>
  );
}