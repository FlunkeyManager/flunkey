import { invoke } from "@tauri-apps/api/core";

export interface HotkeyBinding {
  vk: number;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  win: boolean;
  scanCode?: number | null;
}

export interface AppHotkeys {
  transcribe: HotkeyBinding;
  askAi: HotkeyBinding;
  transform: HotkeyBinding;
  panel: HotkeyBinding;
}

export const VK = {
  F8: 0x77,
  F9: 0x78,
  F10: 0x79,
} as const;

export const DEFAULT_HOTKEYS: AppHotkeys = {
  transcribe: { vk: VK.F8, ctrl: false, alt: false, shift: false, win: false },
  askAi: { vk: VK.F9, ctrl: false, alt: false, shift: false, win: false },
  transform: { vk: VK.F10, ctrl: false, alt: false, shift: false, win: false },
  panel: { vk: VK.F9, ctrl: true, alt: false, shift: false, win: false },
};

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
]);

const CODE_TO_VK: Record<string, number> = {
  Space: 0x20,
  Enter: 0x0d,
  Tab: 0x09,
  Escape: 0x1b,
  Backspace: 0x08,
  Delete: 0x2e,
  Insert: 0x2d,
  Home: 0x24,
  End: 0x23,
  PageUp: 0x21,
  PageDown: 0x22,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  Minus: 0xbd,
  Equal: 0xbb,
  BracketLeft: 0xdb,
  BracketRight: 0xdd,
  Backslash: 0xdc,
  Semicolon: 0xba,
  Quote: 0xde,
  Comma: 0xbc,
  Period: 0xbe,
  Slash: 0xbf,
  Backquote: 0xc0,
};

for (let i = 1; i <= 24; i++) {
  CODE_TO_VK[`F${i}`] = 0x6f + i;
}
for (let d = 0; d <= 9; d++) {
  CODE_TO_VK[`Digit${d}`] = 0x30 + d;
}
for (let i = 0; i < 26; i++) {
  const letter = String.fromCharCode(65 + i);
  CODE_TO_VK[`Key${letter}`] = 0x41 + i;
}

const VK_LABELS: Record<number, string> = {};
for (let i = 1; i <= 24; i++) {
  VK_LABELS[0x6f + i] = `F${i}`;
}
for (let i = 0; i < 26; i++) {
  VK_LABELS[0x41 + i] = String.fromCharCode(65 + i);
}
VK_LABELS[0x20] = "Space";
VK_LABELS[0x0d] = "Enter";
VK_LABELS[0x09] = "Tab";
VK_LABELS[0x1b] = "Esc";

export function bindingFromKeyboardEvent(
  e: KeyboardEvent
): HotkeyBinding | null {
  if (MODIFIER_CODES.has(e.code)) return null;

  const vk = CODE_TO_VK[e.code];
  if (vk === undefined) return null;

  return {
    vk,
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    win: e.metaKey,
  };
}

export function keyboardEventMatchesBinding(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
  binding: HotkeyBinding
): boolean {
  if (MODIFIER_CODES.has(e.code)) return false;

  const vk = CODE_TO_VK[e.code];
  if (vk === undefined) return false;

  return (
    vk === binding.vk &&
    e.ctrlKey === binding.ctrl &&
    e.altKey === binding.alt &&
    e.shiftKey === binding.shift &&
    e.metaKey === binding.win
  );
}

export function formatHotkey(binding: HotkeyBinding): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push("Ctrl");
  if (binding.alt) parts.push("Alt");
  if (binding.shift) parts.push("Shift");
  if (binding.win) parts.push("Win");
  parts.push(VK_LABELS[binding.vk] ?? `Key ${binding.vk}`);
  return parts.join(" + ");
}

export function bindingsEqual(a: HotkeyBinding, b: HotkeyBinding): boolean {
  return (
    a.vk === b.vk &&
    a.ctrl === b.ctrl &&
    a.alt === b.alt &&
    a.shift === b.shift &&
    a.win === b.win
  );
}

export function hotkeysConflict(hotkeys: AppHotkeys): string | null {
  const entries: [string, HotkeyBinding][] = [
    ["Voice → cursor", hotkeys.transcribe],
    ["Voice → AI", hotkeys.askAi],
    ["Transform selection", hotkeys.transform],
    ["Open side panel", hotkeys.panel],
  ];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (bindingsEqual(entries[i][1], entries[j][1])) {
        return `${entries[i][0]} and ${entries[j][0]} cannot use the same shortcut.`;
      }
    }
  }
  return null;
}

export function normalizeHotkeys(
  partial?: Partial<AppHotkeys> | null
): AppHotkeys {
  const base = { ...DEFAULT_HOTKEYS };
  if (!partial) return base;

  const merge = (key: keyof AppHotkeys): HotkeyBinding => {
    const value = partial[key];
    if (!value || typeof value.vk !== "number" || value.vk <= 0) {
      return base[key];
    }
    return {
      vk: value.vk,
      ctrl: Boolean(value.ctrl),
      alt: Boolean(value.alt),
      shift: Boolean(value.shift),
      win: Boolean(value.win),
      scanCode: value.scanCode ?? null,
    };
  };

  return {
    transcribe: merge("transcribe"),
    askAi: merge("askAi"),
    transform: merge("transform"),
    panel: merge("panel"),
  };
}

export async function applyHotkeys(hotkeys: AppHotkeys): Promise<void> {
  await invoke("set_hotkeys", { hotkeys });
}
