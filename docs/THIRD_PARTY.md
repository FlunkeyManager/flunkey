# Third-Party Notices

Flunkey redistributes and downloads the following third-party components.

## Bundled in the installer

### whisper.cpp

Flunkey ships the `whisper-cli.exe` Windows build from the official
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) releases so on-device
speech recognition works without a separate install.

- License: MIT
- Copyright (c) 2023-2024 Georgi Gerganov
- License text: <https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE>

The bundled binary is trimmed to the CLI and the runtime libraries it loads
(`whisper.dll`, `ggml*.dll`, `llama.dll`); benchmark and test tools from the
same release are not included.

### Whisper model weights (optional, downloaded by the user)

The speech models offered in Models & providers (`tiny`, `base`, `small`) are the
GGML conversions of OpenAI's Whisper models, downloaded at the user's request
from the model repository referenced by the upstream project
(`huggingface.co/ggerganov/whisper.cpp`).

- Weights license: MIT
- Copyright (c) 2022 OpenAI
- Model card: <https://github.com/openai/whisper>

No model weights are bundled with Flunkey. Each download is verified against the
SHA-1 digest published in the whisper.cpp model documentation.

### xcap (screen and window capture)

Flunkey uses [xcap](https://crates.io/crates/xcap) to enumerate displays and
windows and to capture screenshots for the F9 image feature.

- License: MIT
- Copyright (c) 2024 Michael intermediate (xcap contributors)

## Downloaded at the user's request, not redistributed

- **Ollama** — an optional external application the user installs themselves
  (<https://ollama.com/download>). Flunkey only talks to a server the user runs.

## Used as a network service (no code redistributed)

- Groq, OpenAI, Google Gemini, OpenRouter, and any Ollama-compatible server.
  Each is contacted only when the user assigns a task to it. Their own terms and
  privacy policies apply; see [PRIVACY.md](./PRIVACY.md).
