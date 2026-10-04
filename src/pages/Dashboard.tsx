import { useStore } from "../store";
import { formatHotkey } from "../hotkeys";
import {
  countUserMessages,
  getFirstUserMessage,
} from "../sessionUtils";
import { ActivityCalendar } from "../components/ActivityCalendar";

export function Dashboard() {
  const name = useStore((s) => s.settings.name);
  const nickname = useStore((s) => s.settings.nickname);
  const transcriptions = useStore((s) => s.transcriptions);
  const aiSessions = useStore((s) => s.aiSessions);
  const transforms = useStore((s) => s.transforms);
  const hotkeys = useStore((s) => s.settings.hotkeys);
  const setCurrentPage = useStore((s) => s.setCurrentPage);

  // Weekly stats
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const weeklyTranscriptions = transcriptions.filter(
    (t) => t.timestamp >= weekAgo
  ).length;
  const weeklyAiQueries = aiSessions
    .filter((s) => s.timestamp >= weekAgo)
    .reduce((sum, s) => sum + countUserMessages(s), 0);
  const weeklyTransforms = transforms.filter((t) => t.timestamp >= weekAgo).length;

  // Recent activity — merge and sort (rows navigate to their page)
  type ActivityItem = {
    type: "f8" | "f9" | "f10";
    page: "transcripts" | "history" | "transforms";
    label: string;
    text: string;
    timestamp: number;
  };
  const recentActivity: ActivityItem[] = [
    ...transcriptions.slice(0, 20).map((t) => ({
      type: "f8" as const,
      page: "transcripts" as const,
      label: "F8",
      text: t.text,
      timestamp: t.timestamp,
    })),
    ...aiSessions.slice(0, 20).map((s) => ({
      type: "f9" as const,
      page: "history" as const,
      label: "F9",
      text: getFirstUserMessage(s),
      timestamp: s.timestamp,
    })),
    ...transforms.slice(0, 20).map((t) => ({
      type: "f10" as const,
      page: "transforms" as const,
      label: "F10",
      text: t.instruction ? `${t.instruction}: ${t.resultText.slice(0, 40)}` : t.originalText.slice(0, 60),
      timestamp: t.timestamp,
    })),
  ]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 8);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="pageTitle">Dashboard</div>
          <div className="pageSubtitle">
            {nickname || name ? `Welcome back, ${nickname || name}` : "Your Flunkey overview"}
          </div>
        </div>
      </div>

      {/* Stat cards — click through to each history page */}
      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="stat-card stat-card--link" role="button" tabIndex={0} title="Open Transcripts"
          onClick={() => setCurrentPage("transcripts")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCurrentPage("transcripts"); } }}>
          <div className="stat-value">{weeklyTranscriptions}</div>
          <div className="stat-label">Transcriptions this week</div>
          <div className="stat-badge f8">{formatHotkey(hotkeys.transcribe)}</div>
        </div>
        <div className="stat-card stat-card--link" role="button" tabIndex={0} title="Open Chat History"
          onClick={() => setCurrentPage("history")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCurrentPage("history"); } }}>
          <div className="stat-value">{weeklyAiQueries}</div>
          <div className="stat-label">AI queries this week</div>
          <div className="stat-badge f9">{formatHotkey(hotkeys.askAi)}</div>
        </div>
        <div className="stat-card stat-card--link" role="button" tabIndex={0} title="Open Transforms"
          onClick={() => setCurrentPage("transforms")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCurrentPage("transforms"); } }}>
          <div className="stat-value">{weeklyTransforms}</div>
          <div className="stat-label">Transforms this week</div>
          <div className="stat-badge" style={{ background: "rgba(168,85,247,0.12)", color: "#a855f7" }}>{formatHotkey(hotkeys.transform)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {transcriptions.length + aiSessions.length + transforms.length}
          </div>
          <div className="stat-label">Total items</div>
          <div className="stat-badge total">All</div>
        </div>
      </div>

      {/* GitHub-style activity calendar */}
      <ActivityCalendar
        transcriptions={transcriptions}
        aiSessions={aiSessions}
        transforms={transforms}
      />

      {/* Activity feed */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="cardTitle">Recent Activity</div>
        <div className="activity-feed">
          {recentActivity.length === 0 && (
            <div className="empty-state">
              No activity yet — hold{" "}
              <span className="mono">{formatHotkey(hotkeys.transcribe)}</span> or{" "}
              <span className="mono">{formatHotkey(hotkeys.askAi)}</span> to get
              started.
            </div>
          )}
          {recentActivity.map((item, i) => (
            <div
              key={i}
              className="activity-row activity-row--link"
              role="button"
              tabIndex={0}
              title={`Open ${item.label === "F8" ? "Transcripts" : item.label === "F9" ? "Chat History" : "Transforms"}`}
              onClick={() => setCurrentPage(item.page)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCurrentPage(item.page); } }}
            >
              <div
                className={`activity-dot ${item.type === "f8" ? "green" : item.type === "f10" ? "purple" : "orange"}`}
                style={item.type === "f10" ? { background: "#a855f7", boxShadow: "0 0 0 3px rgba(168,85,247,0.12)" } : undefined}
              />
              <div className="activity-type">{item.label}</div>
              <div className="activity-text">
                {item.text.length > 80
                  ? item.text.slice(0, 80) + "…"
                  : item.text}
              </div>
              <div className="activity-time">{formatTime(item.timestamp)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
