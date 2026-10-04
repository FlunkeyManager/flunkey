<p align="center">
  <img src="./readme-banner.png" alt="Flunkey banner" width="100%" />
</p>

<p align="center">
  <a href="https://www.flunkey.space/download"><img src="https://img.shields.io/badge/download-flunkey.space-blue" alt="download" /></a>
  <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="version" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license" />
  <img src="https://img.shields.io/badge/platform-Windows_10%2F11-0078D6" alt="platform" />
</p>

# Flunkey

Voice-activated AI assistant for Windows. Hold a hotkey, speak, release — text appears where you work.

Download the latest installer: https://www.flunkey.space/download

Source: https://github.com/FlunkeyManager/flunkey — issues and pull requests welcome.

Bring your own API keys (Groq, OpenAI, Gemini, OpenRouter) — keys are stored in Windows Credential Manager and sent only to the provider assigned to each task.

## Features

- **F8 — Dictate**: voice-to-text pasted at your cursor (hold, or double-tap for hands-free). Choose Verbatim (no cleanup model), Light (grammar cleanup plus clear code/email/list formatting), or Enhanced (your standing instructions combined with the active app's prompt).
- **F9 — Ask AI**: voice question answered in a side overlay, with optional continuous chat and an optional screenshot of a selected screen or app window. Press **Ctrl+F9** to open the side panel empty — browse past chats or choose **Screenshot**, select a screen/window, then hold F9 and ask. Vision-capable models can analyze the attached image.
- **F10 — Transform**: select text, hold F10, speak the edit ("make this formal"), release to replace it.
- **On-device transcription (free, optional)**: download a Whisper model once and dictation runs locally via whisper.cpp — no API key, no cost, and it keeps working offline. Choose **Tiny (75 MB)**, **Base (142 MB, recommended)** or **Small (466 MB)** in Models & providers; the app shows your RAM, thread count and free disk, and warns if a model is too big for the machine.
- **Ollama (optional)**: point Flunkey at a local Ollama server and answer from models running on your own machine — no API key, and nothing leaves the PC.
- **Custom dictionary**: add exact words once ("Groq", "Flunkey", "VS Code") with optional known-misspelling corrections; fuzzy matching fixes case variants and close misspellings before paste. JSON import/export supported.
- **Per-app profiles**: dictation cleanup and paste handling adapt to the foreground app (code, chat, notes, terminal, mail — e.g. plain `Ctrl+Shift+V` where rich paste is wrong). Enhanced mode combines your standing instructions with a per-app custom prompt editable on the Applications page.
- **History + analytics**: Transcripts, Chat History, and Transforms pages with search/filters, per-row delete, retention limits, and an Analytics page with per-app usage. Chats render markdown, tables, and KaTeX math; Chat History and Transforms offer a user-reviewed **Report AI response** email draft.
- **Desktop integration**: remappable hotkeys, start-with-Windows autostart, tray menu, pill + overlay windows, and start/stop/confirm sounds.

## Use

| Hotkey | Action |
|---|---|
| Hold F8 | Dictate at cursor; release to paste |
| Double-tap F8 | Hands-free mode (✓ pastes, ✕ cancels) |
| Hold F9 | Ask AI, answer appears in overlay |
| Ctrl+F9 | Open the side panel empty (history, new chat, screenshot) |
| Hold F10 | Transform the selected text by voice instruction |

All shortcuts are remappable in Settings. The pill at the bottom of the screen shows recording state; right-click the tray icon to jump to any page.

## Privacy

- Raw microphone audio lives only in memory and is never written to disk by Flunkey. Its transcription, chat history, and transforms are stored as plaintext JSON in `%APPDATA%\com.flunkey.desktop\` until wiped.
- F9 screenshots are captured only after you choose the Screenshot action and select a screen or app window. They are sent with that F9 question to its assigned AI provider and saved with the local chat history; F8 and F10 do not capture or send screenshots.
- API keys live in Windows Credential Manager (`Flunkey` service: `groq_api_key`, `openai_api_key`, `gemini_api_key`, `openrouter_api_key`), not in config files. If the keyring is unavailable, Flunkey keeps keys memory-only and never writes them to disk.
- The F9 Groq model list is fetched from Groq using your saved Groq API key; OpenRouter model discovery uses its public catalog. Neither catalog request includes chat content.
- History (transcripts, chats, transforms, dictionary, settings) plus the public OpenRouter model catalog stay in local AppData until you wipe them (Settings → Wipe all data clears both store files, keys, and the current clipboard; Windows clipboard history may persist).
- F8/F10 paste via the OS clipboard by design — the last output can linger there when clipboard restore is off or paste fails.
- Voice and text are sent only to the AI providers you configured (`api.groq.com`, `api.openai.com`, `generativelanguage.googleapis.com`, `openrouter.ai`) — see [Privacy Policy](./docs/PRIVACY.md) and [Terms](./docs/TERMS.md).

## Develop

```powershell
npm install
powershell -File scripts\fetch-whisper.ps1   # on-device speech engine (once)
npm run tauri dev     # Tauri dev window (frontend + Rust)
npm test              # frontend unit tests (vitest)
npx tsc --noEmit      # typecheck
npm run build         # frontend production build (tsc + vite)
npm run tauri build   # NSIS installer -> src-tauri/target/release/bundle
npm run build:msix    # x64 Store package -> src-tauri/target/release/bundle/msix
npm run build:msix:test  # Store package + signed local-test MSIX
```

`scripts/fetch-whisper.ps1` downloads the official whisper.cpp Windows build
into `src-tauri/whisper-bin\` (~12 MB) so the on-device engine is signed along
with the app. The Whisper **model** (75–466 MB) is not bundled — the user
downloads it from inside the app, and it is verified against the SHA-1 digest
published upstream. Both installers bundle the engine; the model is optional.

For MSIX prerequisites, Partner Center identity setup, and certification notes,
see [Microsoft Store Packaging](./docs/MICROSOFT_STORE.md). The MSIX build
requires the Windows SDK MakeAppx tool and the reserved package identity values.
Prerequisites: Node 20.19+ (22 LTS recommended), Rust stable toolchain with
MSVC + VS Build Tools C++ workload, WebView2 (preinstalled on Windows 10/11).

No `.env` needed — API keys are entered in-app and stored in Windows Credential Manager. `package.json` stays `"private": true` because Flunkey is a desktop app, not an npm package.

## Contributing

See [CONTRIBUTING](./CONTRIBUTING.md) for setup, `npm test`, and PR guidance. Report security issues privately per [SECURITY](./SECURITY.md).

## License

MIT — see [LICENSE](./LICENSE). Docs: [About](./docs/ABOUT.md) · [Privacy](./docs/PRIVACY.md) · [Terms](./docs/TERMS.md) · [Third-party notices](./docs/THIRD_PARTY.md).

## Contact

Questions or support: flunkeymanager@gmail.com

- X: https://x.com/Flunkeymanager
- Instagram: https://www.instagram.com/flunkeymanager/
