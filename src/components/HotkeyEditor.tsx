import { useEffect, useState } from "react";
import type { AppHotkeys } from "../hotkeys";
import {
  bindingFromKeyboardEvent,
  formatHotkey,
  DEFAULT_HOTKEYS,
} from "../hotkeys";

type HotkeyField = keyof AppHotkeys;

const FIELD_META: {
  id: HotkeyField;
  title: string;
  description: string;
}[] = [
  {
    id: "transcribe",
    title: "Voice → cursor",
    description: "Hold to dictate; release to paste at your cursor.",
  },
  {
    id: "askAi",
    title: "Voice → AI",
    description: "Hold to ask Flunkey; release to send.",
  },
  {
    id: "transform",
    title: "Transform selection",
    description: "Hold to speak an edit instruction; the selected text will be replaced when you release.",
  },
  {
    id: "panel",
    title: "Open side panel",
    description: "Press to open the empty F9 side panel — browse chats or start from a screenshot.",
  },
];

interface HotkeyEditorProps {
  value: AppHotkeys;
  onChange: (next: AppHotkeys) => void;
  conflictMessage?: string | null;
  compact?: boolean;
}

export function HotkeyEditor({
  value,
  onChange,
  conflictMessage,
  compact = false,
}: HotkeyEditorProps) {
  const [listening, setListening] = useState<HotkeyField | null>(null);

  useEffect(() => {
    if (!listening) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setListening(null);
        return;
      }

      const binding = bindingFromKeyboardEvent(e);
      if (!binding) return;

      onChange({ ...value, [listening]: binding });
      setListening(null);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [listening, onChange, value]);

  return (
    <div className="hotkey-editor">
      {conflictMessage && (
        <div className="hotkey-conflict">{conflictMessage}</div>
      )}
      <div className="hotkey-editor-list">
        {FIELD_META.map((field) => (
          <div
            key={field.id}
            className={`hotkey-editor-row${compact ? " hotkey-editor-row--compact" : ""}`}
          >
            <div className="hotkey-editor-copy">
              <div className="settings-label">{field.title}</div>
              {!compact && (
                <div className="settings-desc">{field.description}</div>
              )}
            </div>
            <button
              type="button"
              className={`hotkey-capture-btn${listening === field.id ? " listening" : ""}`}
              onClick={() =>
                setListening((current) =>
                  current === field.id ? null : field.id
                )
              }
            >
              {listening === field.id
                ? "Press keys…"
                : formatHotkey(value[field.id])}
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="hotkey-reset-btn"
        onClick={() => onChange({ ...DEFAULT_HOTKEYS })}
      >
        Reset to F8 / F9 / F10
      </button>
    </div>
  );
}
