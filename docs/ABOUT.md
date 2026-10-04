# About Flunkey

Flunkey is a free, open-source, voice-activated AI assistant for Windows.
Hold a hotkey, speak, release — text appears where you work.

## What it does

- **F8 — Dictate anywhere.** Hold F8 and speak; Flunkey transcribes and pastes
  at your cursor in any app — emails, docs, chat. Double-tap F8 for hands-free
  mode with confirm/cancel in the pill. Choose Verbatim, Light (grammar
  cleanup with clear code/email/list formatting), or Enhanced; Enhanced
  combines your standing instructions with the active app's custom prompt.
- **F9 — Ask AI.** Hold F9 and ask anything; the answer streams into a side
  overlay. Chats are saved with markdown, tables, and math rendering, and an
  optional continuous mode keeps context across follow-ups.
- **F10 — Transform text.** Select any text, hold F10, say the edit ("make
  this formal", "translate to German"), release to replace it in place.

## How it works

1. The pill at the bottom of the screen shows recording state; sounds confirm
   start, stop, and hands-free actions.
2. Audio is transcribed by your selected engine: on-device Whisper, Groq
   Whisper, OpenAI transcription, or Gemini native audio. On-device Whisper
   uses temporary files that are removed after transcription.
3. Optional custom dictionary + grammar polish fixes vocabulary,
   capitalization, and punctuation before paste.
4. Paste happens at the cursor via the OS clipboard with per-app handling
   (code, chat, notes, terminal, mail) and clipboard restore.

## Privacy by design

- Bring your own keys — no accounts, no Flunkey servers, no analytics.
- Keys live in Windows Credential Manager (`Flunkey` service), never in config
  files; fail-closed if the vault is unavailable.
- History lives in local AppData (`com.flunkey.desktop`) until you wipe it
  (Settings → Wipe all data). See `PRIVACY.md`.

## Requirements

Windows 10/11 64-bit, microphone, and WebView2. Provider API keys are needed
for cloud features; on-device Whisper dictation and optional local Ollama chat
can be used without a cloud key. All shortcuts are remappable; the tray icon
jumps to any page.

## Open source

MIT-licensed by Flunkey — see `LICENSE`. Stack: Tauri v2 + Rust (global
hotkeys, clipboard simulation, keyring, tray) + React 19 + Zustand frontend
with three windows (main, overlay, pill). Issues and contributions welcome;
start with `README.md` Develop section and `TERMS.md`.
Source: https://github.com/FlunkeyManager/flunkey — see `CONTRIBUTING.md`
in the repo root.

## Contact

Questions: flunkeymanager@gmail.com · https://www.flunkey.space
