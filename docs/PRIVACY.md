# Flunkey Privacy Policy

Last updated: October 4, 2026. Version: 1.0.0. Holder: Flunkey.

Flunkey is a local-first Windows desktop app with no first-party AI proxy,
accounts, analytics, advertising, or tracking. Bring your own keys (BYOK) for
cloud providers, or use keyless local options: on-device Whisper for speech
transcription and your configured Ollama server for AI tasks. This policy
explains what stays on your device, what leaves it, and how to delete it.

## 1. Summary

- We operate no server for the app. There is no account, registration, or
  login. Cloud requests go directly from your device to the provider assigned
  to that task. Requests using Ollama go to the server you configured,
  normally localhost.
- We never receive your content. Your audio, transcripts, chats, selections,
  dictionary, and API keys never reach us.
- Cloud requests use the key you entered for that provider. Local Whisper and
  Ollama are keyless local options; an Ollama request is sent to its
  configured server. If you explicitly test an API key, the key is sent to
  that provider's validation endpoint. The app also fetches OpenRouter's
  public model catalog when needed; that request contains no API key or user
  content. The F9 Groq model catalog is fetched using your Groq API key and
  contains no chat content. Catalog requests are separate from F9
  conversation requests.
- Raw microphone audio stays in memory while you dictate. When you choose
  on-device transcription, the audio is converted to a temporary 16 kHz WAV file
  in your Windows temp folder (`%TEMP%\flunkey-stt-*.wav`) so the bundled
  whisper engine can read it, and the engine's text output is written alongside
  it as `%TEMP%\flunkey-stt-*.txt`. Both files are deleted as soon as the
  transcription finishes or fails, and any leftovers from a crash are removed
  when Flunkey next starts. No audio or transcript file is kept after that.
- Transcriptions, chats, and transforms of that audio ARE stored as plaintext
  JSON in AppData until you delete them. F9 screenshots are captured only when
  you select them, sent with that F9 request, and saved locally as JPEG
  attachments with chat history; F8 and F10 do not capture screenshots.

## 2. Data stored on your device

| Data | Location | Notes |
|---|---|---|
| Settings (without keys) | `%APPDATA%\com.flunkey.desktop\flunkey-settings.json` (plaintext JSON) | Written via Tauri Store with explicit flush. No encryption at rest. No API keys in these files. |
| Transcriptions, F9 chats, transforms, dictionary, analytics/history | `%APPDATA%\com.flunkey.desktop\flunkey-transcripts.json`, `flunkey-chats.json`, `flunkey-transforms.json`, `flunkey-dictionary.json` (plaintext JSON) | One file per collection, so saving one kind of data does not rewrite the others. |
| F9 screenshots | `%LOCALAPPDATA%\com.flunkey.desktop\screenshots\*.jpg` | User-selected screen or app-window captures stored as JPEGs with the local chat. The chat file references screenshots by filename. Local AppData: screenshots can contain whatever was on screen and must not follow a profile to another machine. |
| Downloaded on-device speech models | `%LOCALAPPDATA%\com.flunkey.desktop\models\` | Machine-specific weights. Moved here automatically from earlier versions that used the roaming folder. Removed by Wipe all data. |
| Public OpenRouter model catalog + timestamp | `%APPDATA%\com.flunkey.desktop\openrouter-catalog.json` (plaintext JSON) | Public data only, 24h cache. No keys, no user text. |
| API keys | Windows Credential Manager, service `Flunkey`: `groq_api_key`, `openai_api_key`, `gemini_api_key`, `openrouter_api_key` | DPAPI-backed, per-user, and stored with local-machine persistence so a domain profile does not copy them to another PC. Fail closed: if the keyring is unavailable, keys stay memory-only and are never written to disk. Legacy plaintext keys are auto-migrated then blanked. Local Whisper and Ollama do not need cloud API keys. |
| Clipboard | OS clipboard | F8/F10 paste via clipboard by design; last output can persist in clipboard / `Win+V` history. The current clipboard may be cleared by Wipe all data; Windows clipboard history and cloud clipboard may persist outside Flunkey. |
| Audio bytes | RAM while dictating (`MediaRecorder audio/webm;codecs=opus` → in-memory `Blob`); temporary file only for on-device transcription | Tracks stopped on completion. On-device transcription writes `%TEMP%\flunkey-stt-*.wav` plus the engine's `%TEMP%\flunkey-stt-*.txt`, deleted immediately afterwards, and swept on next launch if the app crashed. Nothing is retained. |

## 3. Data sent to third parties

When a task uses a network service, its request goes to the cloud provider
assigned to that task, the user-configured Ollama server, or the relevant
model catalog service:

| Provider | Endpoint | Privacy info |
|---|---|---|
| Groq | `https://api.groq.com` | https://groq.com/privacy-policy |
| OpenAI | `https://api.openai.com` | https://openai.com/policies/privacy-policy |
| Google Gemini | `https://generativelanguage.googleapis.com` | https://policies.google.com/privacy |
| OpenRouter | `https://openrouter.ai` | https://openrouter.ai/privacy |
| Ollama (optional) | User-configured server, normally localhost | Requests go to the server address configured by the user, not to a Flunkey cloud service. |
| Model catalogs | OpenRouter public catalog; Groq model listing uses the saved Groq key | Catalog requests contain no chat content and are separate from F9 conversations. |

Cloud audio and text are sent to the cloud provider assigned to that task.
OpenRouter has no speech-to-text endpoint — voice tasks assigned to it fall
back to a configured Groq/OpenAI/Gemini key. If you select Ollama, requests go
to the user-configured Ollama server (normally localhost) rather than a cloud
AI provider. Provider processing regions,
retention, and training-use policies are governed by the provider, not by
Flunkey. An F9 screenshot is included in the request only after you explicitly
capture and attach a screen or app window, and is sent to the provider assigned
to F9 with the spoken question. Image analysis requires a vision-capable model.

## 3a. Local models (Ollama)

If you enable Ollama, F9, F10, and grammar polish are sent to the Ollama server
you configure (default `http://localhost:11434`) instead of a cloud provider.
That traffic goes to a server you control and never reaches Groq, OpenAI, Gemini,
or OpenRouter. Ollama requires no API key. Voice transcription still uses a
cloud provider, since Ollama does not offer speech-to-text.

## 3b. On-device transcription (Whisper)

If you choose **On-device** under Voice-to-Text, Flunkey runs speech
recognition locally with whisper.cpp. The recording is converted to a 16 kHz
WAV and written to a temporary file in `%TEMP%` so the bundled engine can read
it; both it and the engine's text output are deleted as soon as the
transcription finishes or fails, and leftovers from a crash are removed on the
next launch. **No audio, transcript, or derived data is transmitted anywhere** —
this path works with the network disconnected and with no API keys saved.

The speech model is downloaded by you, from the official whisper.cpp model
repository on Hugging Face, on first use, and stored in
`%LOCALAPPDATA%\com.flunkey.desktop\models\` (local, machine-specific data —
it is not part of your roaming profile). The download is verified against the
SHA-1 digest published by the upstream project. Removing the model from Models
& providers deletes the file, and so does Wipe all data. Nothing about your
speech is collected by that download.

## 4. What we never collect

No analytics, crash reporting, advertising identifiers, or remote logging.
No prompts, completions, audio, screenshots, keys, IP addresses, or user agents
are sent to Flunkey. There is no first-party AI proxy. When local Ollama is
selected, requests go to the server address you configured. All dependencies
run locally; cloud network use is limited to the provider endpoints above plus
the user-configured Ollama server and model catalog lookups (see
`tauri.conf.json` CSP).

When you report an AI response, Flunkey opens an editable email draft to
flunkeymanager@gmail.com containing an excerpt of that generated output and its
model name. Flunkey does not send it unless you choose to send it; you can
review or remove the content first.

## 5. Retention and your choices

Data stays in local app storage until you wipe it.

- **Delete one item.** Transcripts and transforms have a delete button on each
  row; chats have one on each card. You can also remove individual dictionary
  words in-app at any time. Deleting a chat also deletes the
  screenshots saved with it.
- **Set a limit.** Settings → History storage keeps the newest N
  transcriptions, transforms, chats, and screenshots, and deletes the oldest
  beyond that. Leave a field empty to keep everything.
- **Delete everything.** Settings → Danger zone → Wipe all data clears settings
  and collection files, screenshots attached to saved chats, downloaded Whisper
  models, saved provider keys (all four keyring entries), and the current
  clipboard; it also turns off start-with-Windows, then resets settings,
  history, and dictionary. Windows clipboard history (including `Win+V`) and
  cloud clipboard may persist outside Flunkey.

## 6. Children

Flunkey is not directed at children under 13. Do not use it to process a
child's personal information.

## 7. Changes and contact

We may update this policy as the app evolves; the date at the top will change
and material changes will be surfaced in-app. Questions: flunkeymanager@gmail.com · https://www.flunkey.space
