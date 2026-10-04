/**
 * appProfiles.ts — Per-app transcription profiles for Flunkey.
 *
 * Identity is the foreground process exe basename (lowercased), supplied by
 * the Rust `get_active_app` command. Matching is substring-based so app
 * variants work without code changes.
 *
 * Adding an app later = one row in EXE_TO_APP + one profile + one SVG in
 * `public/app-icons/`. No logic changes needed.
 */

export type PasteStrategy = "ctrl+v" | "ctrl+shift+v";

export type AppId =
  | "vscode"
  | "cursor"
  | "antigravity"
  | "opencode"
  | "browser"
  | "edge"
  | "brave"
  | "chatgpt"
  | "claude"
  | "copilot"
  | "perplexity"
  | "whatsapp"
  | "discord"
  | "telegram"
  | "obsidian"
  | "evernote"
  | "onenote"
  | "terminal"
  | "notepad"
  | "word"
  | "excel"
  | "outlook"
  | "powerpoint"
  | "powerbi"
  | "slack"
  | "generic";

export interface AppProfile {
  id: AppId;
  /** Short label shown in history badges / pill tooltip. */
  label: string;
  /** Bundled icon path (public/app-icons/). User-supplied SVGs go here. */
  icon: string;
  /** Paste chord the target app expects. */
  paste: PasteStrategy;
  /** 1–2 line suffix appended to the F8 polish prompt ("" = none). */
  polishSuffix: string;
  /** 1–2 line suffix appended to the F10 transform prompt ("" = none). */
  f10Suffix: string;
}

const ICON = (name: string) => `/app-icons/${name}.svg`;

/* Shared suffix presets — profiles below reference these so new chat-style
   apps stay consistent without duplicating strings. */
const CODE_POLISH =
  "Preserve code identifiers, file paths, and symbol names exactly; never reformat code; keep dictation as prose unless it is clearly code.";
const CODE_F10 =
  "Preserve code syntax, indentation, and identifiers exactly; output code only with no prose when the selection is code.";
const CHAT_POLISH =
  "Keep output as plain single-block text: no markdown tables, no headings; URLs stay on one line.";
const CHAT_F10 =
  "Keep the result paste-friendly: plain text, no markdown tables or headings unless explicitly asked; URLs stay on one line.";
const NOTES_POLISH =
  "Rich-text notes: headings and lists are welcome where natural; no markdown code fences; preserve links and structure.";
const NOTES_F10 =
  "Rich-text notes: headings and lists are welcome where appropriate; no markdown code fences unless explicitly asked.";

export const APP_PROFILES: Record<AppId, AppProfile> = {
  vscode: {
    id: "vscode",
    label: "VS Code",
    icon: ICON("vscode"),
    paste: "ctrl+v",
    polishSuffix:
      "The user is dictating into VS Code (code editor). Preserve code identifiers, file paths, and symbol names exactly; never reformat code; keep dictation as prose unless it is clearly code.",
    f10Suffix:
      "The selection lives in VS Code. Preserve code syntax, indentation, and identifiers exactly; output code only with no prose when the selection is code.",
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    icon: ICON("cursor"),
    paste: "ctrl+v",
    polishSuffix:
      "The user is dictating into Cursor (AI code editor). Preserve code identifiers, file paths, and symbol names exactly; never reformat code; keep dictation as prose unless it is clearly code.",
    f10Suffix:
      "The selection lives in Cursor. Preserve code syntax, indentation, and identifiers exactly; output code only with no prose when the selection is code.",
  },
  antigravity: {
    id: "antigravity",
    label: "Antigravity",
    icon: ICON("antigravity"),
    paste: "ctrl+v",
    polishSuffix: `The user is dictating into Antigravity (agentic code editor). ${CODE_POLISH}`,
    f10Suffix: `The selection lives in Antigravity. ${CODE_F10}`,
  },
  browser: {
    id: "browser",
    label: "Chrome",
    icon: ICON("browser"),
    paste: "ctrl+v",
    polishSuffix:
      "The user is dictating into a Chrome text field (chat input, form, or document). Keep output as plain single-block text: no markdown tables, no headings; URLs stay on one line.",
    f10Suffix:
      "The selection lives in a Chrome text field. Keep the result paste-friendly: plain text, no markdown tables or headings unless explicitly asked; URLs stay on one line.",
  },
  edge: {
    id: "edge",
    label: "Edge",
    icon: ICON("edge"),
    paste: "ctrl+v",
    polishSuffix: `The user is dictating into a Microsoft Edge text field. ${CHAT_POLISH}`,
    f10Suffix: `The selection lives in a Microsoft Edge text field. ${CHAT_F10}`,
  },
  brave: {
    id: "brave",
    label: "Brave",
    icon: ICON("brave"),
    paste: "ctrl+v",
    polishSuffix: `The user is dictating into a Brave text field. ${CHAT_POLISH}`,
    f10Suffix: `The selection lives in a Brave text field. ${CHAT_F10}`,
  },
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    icon: ICON("chatgpt"),
    paste: "ctrl+v",
    polishSuffix: `The user is dictating into a ChatGPT input box. ${CHAT_POLISH}`,
    f10Suffix: `The selection lives in a ChatGPT input box. ${CHAT_F10}`,
  },
  claude: {
    id: "claude",
    label: "Claude",
    icon: ICON("claude"),
    paste: "ctrl+v",
    polishSuffix: `The user is dictating into a Claude input box. ${CHAT_POLISH}`,
    f10Suffix: `The selection lives in a Claude input box. ${CHAT_F10}`,
  },
  copilot: {
    id: "copilot",
    label: "Copilot",
    icon: ICON("copilot"),
    paste: "ctrl+v",
    polishSuffix: `The user is dictating into a Microsoft Copilot input box. ${CHAT_POLISH}`,
    f10Suffix: `The selection lives in a Microsoft Copilot input box. ${CHAT_F10}`,
  },
  whatsapp: {
    id: "whatsapp",
    label: "WhatsApp",
    icon: ICON("whatsapp"),
    paste: "ctrl+v",
    polishSuffix:
      "The user is dictating into WhatsApp chat. Keep output short-message friendly: plain text, no markdown tables or headings, no email sign-off layout; single emoji only if dictated.",
    f10Suffix:
      "The selection lives in WhatsApp chat. Keep the result short-message friendly: plain text, no markdown tables or headings unless explicitly asked.",
  },
  discord: {
    id: "discord",
    label: "Discord",
    icon: ICON("discord"),
    paste: "ctrl+v",
    polishSuffix: `The user is dictating into Discord chat. ${CHAT_POLISH}`,
    f10Suffix: `The selection lives in Discord chat. ${CHAT_F10}`,
  },
  obsidian: {
    id: "obsidian",
    label: "Obsidian",
    icon: ICON("obsidian"),
    paste: "ctrl+v",
    polishSuffix:
      "The user is dictating into Obsidian (markdown notes). Markdown is welcome: use headings, lists, and code fences where natural; preserve [[wiki-links]] verbatim.",
    f10Suffix:
      "The selection lives in Obsidian (markdown notes). Markdown is welcome where appropriate; preserve [[wiki-links]] verbatim and keep code fences intact.",
  },
  terminal: {
    id: "terminal",
    label: "Terminal",
    icon: ICON("terminal"),
    paste: "ctrl+v",
    polishSuffix:
      "The user is dictating into a terminal. Output plain literal text only: no smart quotes or curly punctuation, no markdown, no trailing explanation, at most one trailing newline.",
    f10Suffix:
      "The selection lives in a terminal. Output plain literal text only: no smart quotes, no markdown fences, no commentary; preserve commands character-for-character except what the instruction changes.",
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    icon: ICON("opencode"),
    paste: "ctrl+v",
    polishSuffix: `The user is dictating into OpenCode (AI coding tool). ${CODE_POLISH}`,
    f10Suffix: `The selection lives in OpenCode. ${CODE_F10}`,
  },
  perplexity: {
    id: "perplexity",
    label: "Perplexity",
    icon: ICON("perplexity"),
    paste: "ctrl+v",
    polishSuffix: `The user is dictating into a Perplexity input box. ${CHAT_POLISH}`,
    f10Suffix: `The selection lives in a Perplexity input box. ${CHAT_F10}`,
  },
  telegram: {
    id: "telegram",
    label: "Telegram",
    icon: ICON("telegram"),
    paste: "ctrl+v",
    polishSuffix: `The user is dictating into Telegram chat. ${CHAT_POLISH}`,
    f10Suffix: `The selection lives in Telegram chat. ${CHAT_F10}`,
  },
  evernote: {
    id: "evernote",
    label: "Evernote",
    icon: ICON("evernote"),
    paste: "ctrl+v",
    polishSuffix: `The user is dictating into Evernote. ${NOTES_POLISH}`,
    f10Suffix: `The selection lives in Evernote. ${NOTES_F10}`,
  },
  onenote: {
    id: "onenote",
    label: "OneNote",
    icon: ICON("onenote"),
    paste: "ctrl+v",
    polishSuffix: `The user is dictating into OneNote. ${NOTES_POLISH}`,
    f10Suffix: `The selection lives in OneNote. ${NOTES_F10}`,
  },
  excel: {
    id: "excel",
    label: "Excel",
    icon: ICON("excel"),
    paste: "ctrl+v",
    polishSuffix:
      "The user is dictating into Excel. Output cell-friendly plain text: no markdown tables; preserve numbers, dates, and formulas character-for-character.",
    f10Suffix:
      "The selection lives in Excel. Output cell-friendly plain text with no markdown tables; preserve numbers, dates, and formulas character-for-character except what the instruction changes.",
  },
  outlook: {
    id: "outlook",
    label: "Outlook",
    icon: ICON("outlook"),
    paste: "ctrl+v",
    polishSuffix:
      "The user is dictating into Outlook email. Full email formatting applies: subject-aware greeting, body paragraphs, and sign-off when cues are present; smart punctuation is fine.",
    f10Suffix:
      "The selection lives in Outlook email. Full email formatting applies: greeting, body paragraphs, and sign-off where appropriate.",
  },
  powerpoint: {
    id: "powerpoint",
    label: "PowerPoint",
    icon: ICON("powerpoint"),
    paste: "ctrl+v",
    polishSuffix:
      "The user is dictating into PowerPoint. Output slide-friendly text: short lines and bullets, no markdown headings; one idea per line.",
    f10Suffix:
      "The selection lives in PowerPoint. Keep the result slide-friendly: short lines and bullets, no markdown headings unless explicitly asked.",
  },
  powerbi: {
    id: "powerbi",
    label: "Power BI",
    icon: ICON("powerbi"),
    paste: "ctrl+v",
    polishSuffix:
      "The user is dictating into Power BI. Preserve DAX formulas, measure names, and field names character-for-character; keep dictation as prose otherwise.",
    f10Suffix:
      "The selection lives in Power BI. Preserve DAX formulas, measure names, and field names character-for-character except what the instruction changes.",
  },
  slack: {
    id: "slack",
    label: "Slack",
    icon: ICON("slack"),
    paste: "ctrl+v",
    polishSuffix: `The user is dictating into Slack. ${CHAT_POLISH}`,
    f10Suffix: `The selection lives in Slack. ${CHAT_F10}`,
  },
  notepad: {
    id: "notepad",
    label: "Notepad",
    icon: ICON("notepad"),
    paste: "ctrl+v",
    polishSuffix:
      "The user is dictating into Notepad (plain text, no formatting). Output plain text only: no markdown, no smart quotes; preserve line breaks as dictated.",
    f10Suffix:
      "The selection lives in Notepad (plain text). Output plain text only with no markdown; preserve line breaks and layout.",
  },
  word: {
    id: "word",
    label: "Word",
    icon: ICON("word"),
    paste: "ctrl+v",
    polishSuffix:
      "The user is dictating into Microsoft Word. Full prose formatting applies: proper paragraphs, email greeting/body/sign-off layout when cues are present, smart punctuation is fine.",
    f10Suffix:
      "The selection lives in Microsoft Word. Full prose formatting applies: paragraphs and email greeting/body/sign-off layout where appropriate.",
  },
  generic: {
    id: "generic",
    label: "Generic",
    icon: ICON("generic"),
    paste: "ctrl+v",
    polishSuffix: "",
    f10Suffix: "",
  },
};

/** exe substring (lowercase) → AppId. Exact basenames always win over
 * substring hits (so "opencode.exe" never matches the "code.exe" row). */
const EXE_TO_APP: [string, AppId][] = [
  ["opencode.exe", "opencode"],
  ["cursor.exe", "cursor"],
  ["code.exe", "vscode"],
  ["chrome.exe", "browser"],
  ["msedge.exe", "edge"],
  ["brave.exe", "brave"],
  ["firefox.exe", "generic"],
  ["chatgpt.exe", "chatgpt"],
  ["claude.exe", "claude"],
  ["copilot.exe", "copilot"],
  ["perplexity.exe", "perplexity"],
  ["whatsapp.exe", "whatsapp"],
  ["discord.exe", "discord"],
  ["telegram.exe", "telegram"],
  ["obsidian.exe", "obsidian"],
  ["evernote.exe", "evernote"],
  ["onenote.exe", "onenote"],
  ["onenotem.exe", "onenote"],
  ["windowsterminal.exe", "terminal"],
  ["wt.exe", "terminal"],
  ["powershell.exe", "terminal"],
  ["pwsh.exe", "terminal"],
  ["cmd.exe", "terminal"],
  ["alacritty.exe", "terminal"],
  ["wezterm.exe", "terminal"],
  ["notepad++.exe", "notepad"],
  ["notepad.exe", "notepad"],
  ["winword.exe", "word"],
  ["excel.exe", "excel"],
  ["outlook.exe", "outlook"],
  ["olk.exe", "outlook"],
  ["powerpnt.exe", "powerpoint"],
  ["pbidesktop.exe", "powerbi"],
  ["slack.exe", "slack"],
];

/** Lowercased once — matching lowercases the exe, so needles must be
 * lowercase too. Normalizing here (not by hand) kills case bugs forever. */
const EXE_TO_APP_NORM: [string, AppId][] = EXE_TO_APP.map(([n, id]) => [
  n.toLowerCase(),
  id,
]);
/** Window-title keywords (lowercase) -> AppId. Besides packaged apps, browser
 * tab titles identify web apps such as Copilot and ChatGPT. */
const TITLE_TO_APP: [string, AppId][] = [
  ["chatgpt", "chatgpt"],
  ["claude", "claude"],
  ["copilot", "copilot"],
  ["perplexity", "perplexity"],
  ["outlook", "outlook"],
  ["whatsapp", "whatsapp"],
  ["onenote", "onenote"],
  ["opencode", "opencode"],
  ["telegram", "telegram"],
  ["discord", "discord"],
  ["slack", "slack"],
  ["excel", "excel"],
  ["powerpoint", "powerpoint"],
  ["obsidian", "obsidian"],
  ["evernote", "evernote"],
  ["word", "word"],
];

/** Resolve a foreground app to its profile. Pure — unit-testable.
 * Browser tab titles can refine a browser profile to a supported web app;
 * otherwise exact exe, exe substring, title keyword, then generic are used. */
export function resolveAppProfile(
  exe: string | null | undefined,
  title?: string | null
): AppProfile {
  const lower = (exe ?? "").toLowerCase().trim();
  const t = (title ?? "").toLowerCase();
  const browserApp = EXE_TO_APP_NORM.some(
    ([needle, id]) =>
      lower.includes(needle) &&
      (id === "browser" || id === "edge" || id === "brave"),
  );
  if (browserApp && t) {
    for (const [needle, id] of TITLE_TO_APP) {
      if (t.includes(needle)) return APP_PROFILES[id];
    }
  }
  if (lower) {
    const exact = EXE_TO_APP_NORM.find(([needle]) => lower === needle);
    if (exact && exact[1] !== "generic") return APP_PROFILES[exact[1]];
    for (const [needle, id] of EXE_TO_APP_NORM) {
      if (id !== "generic" && lower.includes(needle)) return APP_PROFILES[id];
    }
  }
  if (t) {
    for (const [needle, id] of TITLE_TO_APP) {
      if (t.includes(needle)) return APP_PROFILES[id];
    }
  }
  return APP_PROFILES.generic;
}

/** Resolve a stored history `app` id to its profile (generic fallback). */
export function profileForAppId(app: string | null | undefined): AppProfile {
  const found = (Object.values(APP_PROFILES) as AppProfile[]).find(
    (p) => p.id === app
  );
  return found ?? APP_PROFILES.generic;
}

export interface ActiveAppInfo {
  exe: string;
  title: string;
}
