# Flunkey Terms of Service

Last updated: October 4, 2026. Version: 1.0.0 (in-app `LEGAL_VERSION 1.0.0`).
Holder: Flunkey. Contact: flunkeymanager@gmail.com · https://www.flunkey.space

These terms govern your use of Flunkey, a free open-source (MIT) Windows
desktop app. By installing or using Flunkey you agree to them. If you do not
agree, do not use the app.

## 1. What Flunkey is

Flunkey is a voice-activated AI assistant for Windows 10/11 64-bit:

- **F8 — Dictate**: hold to record, release to transcribe and paste text at
  your cursor. Double-tap F8 for hands-free mode (confirm to paste, cancel to
  discard).
- **F9 — Ask AI**: hold to record a question, release for a streamed answer in
  the side overlay. Optional continuous chat keeps context across turns.
  Press `Ctrl+F9` to open the panel; from there, you may explicitly select a
  screen or app window for a screenshot question.
- **F10 — Transform**: select text, hold F10, speak the edit, release to
  replace the selection in place (limited to 12,000 characters).

All hotkeys are remappable in Settings. Requirements: microphone permission and
WebView2 (preinstalled on Windows 10/11). Cloud provider API keys are needed
only for cloud services you choose; on-device Whisper and local Ollama are
available without a cloud provider key.

## 2. Bring your own keys (BYOK)

Flunkey does not provide cloud API access. If you choose Groq, OpenAI,
Google Gemini, or OpenRouter, you supply your own keys and assign
providers/models by task (speech transcription, F9, F10, or cleanup). You pay
any provider charges directly and use those services under their own terms. A
cloud key is not universally required: on-device Whisper can transcribe speech
and Ollama can provide local AI models through the server you configure
(normally localhost). Local requests are not sent to a cloud AI provider by
Flunkey. Provider links:

- Groq — https://groq.com/terms
- OpenAI — https://openai.com/policies/terms-of-use
- Google Gemini — https://ai.google.dev/gemini-api/terms
- OpenRouter — https://openrouter.ai/terms

Flunkey is not a party to those provider relationships and is not responsible
for provider availability, billing, rate limits, or content-moderation
decisions. Do not add credentials whose provider terms forbid third-party
software use. Your prompts, audio-derived text, and keys flow to the provider
you configured for that cloud task. When you use Ollama, the request goes to
the server address you configured. Provider privacy and retention policies
apply to cloud services.

## 3. Acceptable use

You agree not to:

- Transcribe or transform content you have no right to process (including
  attorney-client privileged, medical, or other confidential material where
  processing would violate an obligation).
- Generate or distribute defamatory, harassing, discriminatory, obscene, or
  illegal content.
- Attempt to access other users' credentials or data, probe or disrupt
  Flunkey or any provider, or circumvent security features.
- Reverse-engineer Flunkey beyond what the MIT license permits, resell or
  broker provider access obtained through Flunkey, or use output in
  safety-critical decisions (medical, legal, financial) without human review.

AI output may contain errors. You are responsible for reviewing transcriptions,
answers, and transforms before acting on them.

## 4. System behaviors you consent to

By using the features you consent to the desktop behaviors required for them:
microphone access when recording, a low-level keyboard hook for global
F8/F9/F10 detection, simulated paste (Ctrl+V), reading the foreground app name
for per-app paste/vocabulary handling, always-on-top pill/overlay and tray
behavior, optional launch at startup, and clipboard-based paste (the last
output can linger in the clipboard / Windows clipboard history — see Privacy
Policy). If you choose Screenshot in the F9 panel, Flunkey captures only the
screen or app window you select, sends it with the F9 request to its assigned
provider, and saves a JPEG attachment with local chat history. F8 and F10 do
not capture screenshots. Image analysis requires a vision-capable model.
Review provider terms before sending sensitive content.

## 5. Intellectual property and license

Flunkey source is MIT-licensed (see `LICENSE`). You own your content
(dictations, questions, selections, results). You grant Flunkey no rights
beyond processing it locally and forwarding it to your chosen provider to
deliver the feature you invoked.

## 6. No warranty and liability limit

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, as stated in the MIT license. To the fullest extent permitted by law,
Flunkey is not liable for indirect, incidental, special, consequential, or
punitive damages, including loss of data, API credits, profits, or provider
charges arising from your use of the app.

## 7. Changes and acceptance

Onboarding records acceptance of these terms at `LEGAL_VERSION`. Material
changes will bump that version and require re-acceptance in-app. Continued use
constitutes acceptance of the then-current terms. Contact: flunkeymanager@gmail.com
