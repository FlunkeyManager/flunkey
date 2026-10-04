import { useEffect, useMemo, useState, type JSX } from "react";
import { useStore } from "../store";
import { profileForAppId } from "../appProfiles";
import "../analytics.css";

const F8_COLOR = "#4ade80";
const F9_COLOR = "#fb923c";
const F10_COLOR = "#a855f7";
const FALLBACK_APP_COLOR = "#8a8a85";

const APP_PALETTE: string[] = [
  "#4ade80",
  "#60a5fa",
  "#a855f7",
  "#fb923c",
  "#f472b6",
  "#2dd4bf",
  "#facc15",
  "#f87171",
  "#38bdf8",
  "#c084fc",
  "#fb7185",
  "#34d399",
];

const APP_COLOR_OVERRIDES: Record<string, string> = {
  vscode: "#60a5fa",
  cursor: "#c084fc",
  browser: "#facc15",
  edge: "#38bdf8",
  terminal: "#34d399",
  obsidian: "#a855f7",
  whatsapp: "#4ade80",
  discord: "#818cf8",
  slack: "#f472b6",
  word: "#60a5fa",
  outlook: "#38bdf8",
  generic: "#8a8a85",
};

interface DayBucket {
  key: string;
  label: string;
  fullLabel: string;
  count: number;
}

interface AppUsage {
  appId: string;
  label: string;
  icon: string;
  color: string;
  count: number;
  share: number;
}

interface SplitSlice {
  id: string;
  label: string;
  key: string;
  count: number;
  share: number;
  color: string;
}

function colorForAppId(appId: string): string {
  const override = APP_COLOR_OVERRIDES[appId];
  if (override) return override;
  let hash = 0;
  for (let i = 0; i < appId.length; i += 1) {
    hash = (hash * 31 + appId.charCodeAt(i)) >>> 0;
  }
  return APP_PALETTE[hash % APP_PALETTE.length] ?? FALLBACK_APP_COLOR;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function Analytics(): JSX.Element {
  const transcriptions = useStore((s) => s.transcriptions);
  const aiSessions = useStore((s) => s.aiSessions);
  const transforms = useStore((s) => s.transforms);
  const [mounted, setMounted] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [openApp, setOpenApp] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState<boolean>(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const f8Count = transcriptions.length;
  const f9Count = aiSessions.length;
  const f10Count = transforms.length;
  const totalUses = f8Count + f9Count + f10Count;

  const dayBuckets: DayBucket[] = useMemo(() => {
    const today = startOfDay(new Date());
    const buckets: DayBucket[] = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const day = new Date(today);
      day.setDate(today.getDate() - offset);
      const next = new Date(day);
      next.setDate(day.getDate() + 1);
      const start = day.getTime();
      const end = next.getTime();
      let count = 0;
      for (const t of transcriptions) {
        if (t.timestamp >= start && t.timestamp < end) count += 1;
      }
      for (const s of aiSessions) {
        if (s.timestamp >= start && s.timestamp < end) count += 1;
      }
      for (const t of transforms) {
        if (t.timestamp >= start && t.timestamp < end) count += 1;
      }
      buckets.push({
        key: day.toISOString().slice(0, 10),
        label: day.toLocaleDateString(undefined, { weekday: "short" }),
        fullLabel: day.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        count,
      });
    }
    return buckets;
  }, [transcriptions, aiSessions, transforms]);

  const weekUses = useMemo(
    () => dayBuckets.reduce((sum, b) => sum + b.count, 0),
    [dayBuckets]
  );

  const appUsages: AppUsage[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of transcriptions) {
      const id = t.app ?? "generic";
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const t of transforms) {
      const id = t.app ?? "generic";
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const appTotal = [...counts.values()].reduce((a, b) => a + b, 0);
    const rows: AppUsage[] = [...counts.entries()].map(([appId, count]) => {
      const profile = profileForAppId(appId);
      return {
        appId,
        label: profile.label,
        icon: profile.icon,
        color: colorForAppId(appId),
        count,
        share: appTotal > 0 ? count / appTotal : 0,
      };
    });
    rows.sort((a, b) => b.count - a.count);
    return rows;
  }, [transcriptions, transforms]);

  const split: SplitSlice[] = useMemo(() => {
    const rows: SplitSlice[] = [
      { id: "f8", label: "Dictation", key: "F8", count: f8Count, share: 0, color: F8_COLOR },
      { id: "f9", label: "Assistant", key: "F9", count: f9Count, share: 0, color: F9_COLOR },
      { id: "f10", label: "Transform", key: "F10", count: f10Count, share: 0, color: F10_COLOR },
    ];
    for (const row of rows) {
      row.share = totalUses > 0 ? row.count / totalUses : 0;
    }
    return rows;
  }, [f8Count, f9Count, f10Count, totalUses]);

  const topApp: AppUsage | null = useMemo(
    () => (appUsages.length > 0 ? (appUsages[0] as AppUsage) : null),
    [appUsages]
  );

  const summaryText = useMemo(() => {
    const lines = [
      `Flunkey Analytics — ${new Date().toLocaleDateString()}`,
      `Total uses: ${totalUses} (dictations ${f8Count}, chats ${f9Count}, transforms ${f10Count})`,
      `This week: ${weekUses}`,
      topApp
        ? `Top app: ${topApp.label} (${topApp.count} uses, ${Math.round(topApp.share * 100)}%)`
        : "Top app: —",
      "",
      "Per-app usage:",
      ...appUsages.map(
        (a) => `- ${a.label}: ${a.count} (${Math.round(a.share * 100)}%)`
      ),
      "",
      "Last 7 days:",
      ...dayBuckets.map((b) => `- ${b.fullLabel}: ${b.count}`),
    ];
    return lines.join("\n");
  }, [totalUses, f8Count, f9Count, f10Count, weekUses, topApp, appUsages, dayBuckets]);

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — nothing to do
    }
  };

  const chartStateClass = mounted ? "an-mounted" : "an-pre";

  return (
    <div className={`page an-root ${chartStateClass}`}>
      <div className="pageHeader">
        <div>
          <div className="pageTitle">Analytics</div>
          <div className="pageSubtitle">
            Usage across dictation, chat, and transforms
          </div>
        </div>
      </div>

      <div className="an-stats">
        <div className="an-card">
          <div className="an-card-label">Total uses</div>
          <div className="an-card-value">{totalUses}</div>
          <div className="an-card-sub">
            {f8Count} F8 · {f9Count} F9 · {f10Count} F10
          </div>
        </div>
        <div className="an-card">
          <div className="an-card-label">Top app</div>
          <div className="an-card-value an-app-value">
            {topApp && (
              <img className="an-card-icon" src={topApp.icon} alt="" />
            )}
            <span className="an-ellipsis">{topApp ? topApp.label : "—"}</span>
          </div>
          <div className="an-card-sub">
            {topApp ? `${topApp.count} uses` : "Use Flunkey to see it here"}
          </div>
        </div>
      </div>

      {totalUses === 0 ? (
        <div className="an-empty">
          <div className="an-empty-title">Nothing to chart yet</div>
          <div className="an-empty-body">
            Dictate with F8, chat with F9, or transform a selection with F10 —
            your activity will show up here.
          </div>
        </div>
      ) : (
        <>
          <div className="an-section">
            <div className="an-section-title">Feature split</div>
            <div className="an-split-track">
              {split.map((slice) => (
                <div
                  key={slice.id}
                  className="an-split-seg"
                  title={`${slice.key} · ${slice.label}: ${slice.count}`}
                  style={{
                    width: mounted ? `${slice.share * 100}%` : "0%",
                    backgroundColor: slice.color,
                  }}
                />
              ))}
            </div>
            <div className="an-split-legend">
              {split.map((slice) => (
                <div className="an-split-item" key={slice.id}>
                  <span
                    className="an-dot"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="an-split-key">{slice.key}</span>
                  <span className="an-split-label">{slice.label}</span>
                  <span className="an-split-count">{slice.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="an-section">
            <div className="an-section-title">Per-app usage</div>
            <div className="an-apps">
              {appUsages.map((app) => {
                const isOpen = openApp === app.appId;
                const toggle = () => {
                  const sel = window.getSelection();
                  if (sel && !sel.isCollapsed) return;
                  setOpenApp(isOpen ? null : app.appId);
                };
                return (
                  <div
                    className="an-app-row an-app-row--tappable"
                    key={app.appId}
                    role="button"
                    tabIndex={0}
                    title={`${app.label} — click for details`}
                    onClick={toggle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpenApp(isOpen ? null : app.appId);
                      }
                    }}
                  >
                    <img className="an-app-icon" src={app.icon} alt="" />
                    <div className="an-app-meta">
                      <div className="an-app-top">
                        <span className="an-app-label">{app.label}</span>
                        {isOpen && (
                          <span className="an-app-count">
                            {app.count} · {Math.round(app.share * 100)}%
                          </span>
                        )}
                      </div>
                      <div className="an-app-track">
                        <div
                          className="an-app-fill"
                          style={{
                            width: mounted ? `${app.share * 100}%` : "0%",
                            backgroundColor: app.color,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="an-section">
            <div className="an-section-title">Export</div>
            <div className="an-export-row">
              <button type="button" className="copy-btn" onClick={copySummary}>
                {copied ? "Copied ✓" : "Copy summary"}
              </button>
              <button
                type="button"
                className="copy-btn"
                onClick={() => setShowSummary(!showSummary)}
                aria-expanded={showSummary}
              >
                {showSummary ? "Hide preview" : "Preview"}
              </button>
            </div>
            {showSummary && (
              <pre className="an-summary-pre">{summaryText}</pre>
            )}
            <div className="an-export-note">
              Preview the exact text that gets copied.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
