import { useState } from "react";
import { useStore } from "../store";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "/icons/home.svg" },
  { id: "dictation", label: "Dictation", icon: "/icons/mic.svg" },
  { id: "history", label: "Chat History", icon: "/icons/chat_history.svg" },
  { id: "transcripts", label: "Transcripts", icon: "/icons/transcripts.svg" },
  { id: "transforms", label: "Transforms", icon: "/icons/writing.svg" },
  { id: "dictionary", label: "Dictionary", icon: "/icons/dictionary.svg" },
  { id: "applications", label: "Applications", icon: "/icons/apps.svg" },
  { id: "analytics", label: "Analytics", icon: "/icons/research.svg" },
  { id: "models", label: "Models", icon: "/icons/api.svg" },
  { id: "settings", label: "Settings", icon: "/icons/settings.svg" },
];

export function Sidebar() {
  const currentPage = useStore((s) => s.currentPage);
  const setCurrentPage = useStore((s) => s.setCurrentPage);
  const [expanded, setExpanded] = useState(false);
  const [logoHovered, setLogoHovered] = useState(false);

  return (
    <aside className={`sidebar ${expanded ? "sidebar--expanded" : ""}`}>
      {/* Logo / Toggle button */}
      <button
        className="sidebar-logo-btn"
        onClick={() => setExpanded((prev) => !prev)}
        onMouseEnter={() => setLogoHovered(true)}
        onMouseLeave={() => setLogoHovered(false)}
        title={expanded ? "Collapse sidebar" : "Expand sidebar"}
      >
        <div className="sidebar-logo-icon-wrap">
          <img
            src="/icons/app-icon.svg"
            alt="Flunkey"
            className={`sidebar-logo-img ${logoHovered ? "sidebar-logo-img--hidden" : ""}`}
          />
          <img
            src="/icons/sidebar.svg"
            alt="Toggle sidebar"
            className={`sidebar-toggle-img ${logoHovered ? "sidebar-toggle-img--visible" : ""}`}
          />
        </div>
      </button>

      {/* Navigation */}
      <nav className="nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`navItem${currentPage === item.id ? " navItemActive" : ""}`}
            onClick={() => setCurrentPage(item.id)}
            title={!expanded ? item.label : undefined}
          >
            <img
              src={item.icon}
              alt={item.label}
              className="navIcon-svg"
            />
            {expanded && <span className="navLabel">{item.label}</span>}
          </button>
        ))}
      </nav>
    </aside>
  );
}
