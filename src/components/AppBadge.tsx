import { profileForAppId } from "../appProfiles";

/** Small app badge for history rows (Transcripts / Transforms). */
export function AppBadge({ app, size = 14 }: { app?: string; size?: number }) {
  if (!app) return null;
  const profile = profileForAppId(app);
  return (
    <span
      className="app-badge"
      title={profile.label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        color: "var(--muted)",
        whiteSpace: "nowrap",
      }}
    >
      <img
        src={profile.icon}
        alt=""
        draggable={false}
        style={{ width: size, height: size, borderRadius: 3, display: "block" }}
      />
      {profile.label}
    </span>
  );
}
