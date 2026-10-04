import { getCurrentWindow } from "@tauri-apps/api/window";

export function Titlebar() {
  const appWindow = getCurrentWindow();

  return (
    <div className="titlebar" data-tauri-drag-region>
      <span className="titlebar-title" data-tauri-drag-region>
        Flunkey
      </span>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => appWindow.minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 12 12">
            <rect y="5.25" width="12" height="1.5" fill="currentColor" />
          </svg>
        </button>
        <button
          className="titlebar-btn titlebar-close"
          aria-label="Close to tray"
          title="Close to tray"
          onClick={() => appWindow.hide()}
        >
          <svg width="10" height="10" viewBox="0 0 12 12">
            <path
              d="M1.5.4L6 4.9l4.5-4.5 1.1 1.1L7.1 6l4.5 4.5-1.1 1.1L6 7.1 1.5 11.6.4 10.5 4.9 6 .4 1.5z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
