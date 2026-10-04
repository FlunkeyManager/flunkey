/**
 * groq.ts – Direct calls to the Groq API from the frontend.
 * Two endpoints: Whisper transcription and chat completions.
 */

import { stripThinkingBlocks } from "./responseSanitizer";

const GROQ_BASE = "https://api.groq.com/openai/v1";

/**
 * Send an audio blob to Groq Whisper and get back the transcribed text.
 */
export async function transcribeAudio(
  apiKey: string,
  audioBlob: Blob,
  prompt?: string,
  model = "whisper-large-v3-turbo",
  language?: string
): Promise<string> {
  const formData = new FormData();
  formData.append("file", audioBlob, "recording.webm");
  formData.append("model", model);
  if (language && language.trim()) {
    formData.append("language", language.trim());
  }
  if (prompt && prompt.trim()) {
    formData.append("prompt", prompt.trim());
  }

  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq Whisper error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return (data.text ?? "").trim();
}

export type ApiChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * Perform a standard non-streaming chat completion from Groq.
 */
export async function createChatCompletion(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ApiChatMessage[],
  temperature = 0.2
): Promise<string> {
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      temperature,
      stream: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq chat error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? "";
  return stripThinkingBlocks(raw).trim();
}

