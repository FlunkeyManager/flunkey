import { useMemo } from "react";
import type { Transcription, AiSession, TransformRecord } from "../types";

type Props = {
  transcriptions: Transcription[];
  aiSessions: AiSession[];
  transforms: TransformRecord[];
};

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateLong(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function levelFor(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

export function ActivityCalendar({ transcriptions, aiSessions, transforms }: Props) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const { dayMap, weekDays, totalWeek, weekLabel } = useMemo(() => {
    const map = new Map<string, { total: number; f8: number; f9: number; f10: number }>();

    const bump = (ts: number, type: "f8" | "f9" | "f10") => {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return;
      const k = dateKey(d);
      const cur = map.get(k) ?? { total: 0, f8: 0, f9: 0, f10: 0 };
      cur.total += 1;
      if (type === "f8") cur.f8 += 1;
      if (type === "f9") cur.f9 += 1;
      if (type === "f10") cur.f10 += 1;
      map.set(k, cur);
    };

    for (const t of transcriptions) bump(t.timestamp, "f8");
    for (const t of transforms) bump(t.timestamp, "f10");
    for (const s of aiSessions) {
      if (s.messages && s.messages.length > 0) {
        let counted = 0;
        for (const m of s.messages) {
          if (m.role === "user") {
            bump(m.timestamp ?? s.timestamp, "f9");
            counted++;
          }
        }
        if (counted === 0) bump(s.timestamp, "f9");
      } else {
        bump(s.timestamp, "f9");
      }
    }

    // Last 7 days inclusive (aligns with Dashboard's rolling 7-day weekly stats)
    const days: Date[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      d.setHours(0, 0, 0, 0);
      days.push(d);
    }

    // Daily counts are from actual timestamps (local dateKey)
    let total = 0;
    for (const d of days) {
      total += map.get(dateKey(d))?.total ?? 0;
    }

    const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
    const weekLabel = `${fmt.format(days[0])} – ${fmt.format(days[6])}`;

    return { dayMap: map, weekDays: days, totalWeek: total, weekLabel };
  }, [transcriptions, aiSessions, transforms, today]);

  const getCounts = (d: Date) => dayMap.get(dateKey(d)) ?? { total: 0, f8: 0, f9: 0, f10: 0 };

  const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });

  return (
    <div className="card gh-card">
      <div className="gh-header">
        <div className="gh-title">
          <span className="gh-title-main">{totalWeek} {totalWeek === 1 ? "use" : "uses"}</span>
          <span className="gh-title-sub">this week · {weekLabel}</span>
        </div>
        <div className="gh-legend">
          <span className="gh-legend-label">Less</span>
          <span className="gh-legend-cell level-0" />
          <span className="gh-legend-cell level-1" />
          <span className="gh-legend-cell level-2" />
          <span className="gh-legend-cell level-3" />
          <span className="gh-legend-cell level-4" />
          <span className="gh-legend-label">More</span>
        </div>
      </div>

      {/* Last 7 days — static, no hover tooltip, shows actual per-day counts */}
      <div className="gh-week-row" role="grid" aria-label="Last 7 days usage">
        {weekDays.map((date, idx) => {
          const { total } = getCounts(date);
          const lvl = levelFor(total);
          const isToday = dateKey(date) === dateKey(today);
          return (
            <div key={idx} className="gh-day">
              <div
                role="gridcell"
                className={`gh-cell gh-cell--week level-${lvl}${isToday ? " gh-cell--today" : ""}`}
                aria-label={`${formatDateLong(date)}: ${total} ${total === 1 ? "use" : "uses"}`}
              />
              <span className="gh-day-label">{weekdayFmt.format(date)}</span>
              <span className="gh-day-date">{date.getDate()}</span>
              <span className="gh-day-count">{total === 0 ? "—" : `${total} ${total === 1 ? "use" : "uses"}`}</span>
            </div>
          );
        })}
      </div>

      <div className="gh-footer">
        <span className="gh-footer-hint">F8 dictations · F9 AI queries · F10 transforms · Daily intensity scales with count</span>
      </div>
    </div>
  );
}
