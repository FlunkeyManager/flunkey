import { stripThinkingBlocks } from "./responseSanitizer";
import type { AiSession, ChatMessage } from "./types";
import {
  createAssistantMessage,
  createUserMessage,
  toApiMessages,
} from "./sessionUtils";

export type OverlayChatMessage = {
  role: string;
  content: string;
  imageDataUrl?: string;
};

export function toOverlayMessages(
  messages: ChatMessage[]
): OverlayChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content:
      m.role === "assistant" ? stripThinkingBlocks(m.content) : m.content,
    imageDataUrl: m.imageDataUrl,
  }));
}

export async function syncOverlayChat(
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
  continuous: boolean,
  messages: ChatMessage[]
) {
  await invoke("overlay_sync_chat", {
    continuous,
    messages: toOverlayMessages(messages),
  });
}

export function buildSessionAfterTurn(
  existing: AiSession | null,
  userText: string,
  assistantText: string,
  model: string,
  continuous: boolean,
  imageDataUrl?: string
): AiSession {
  const userMsg = createUserMessage(userText, imageDataUrl);
  const assistantMsg = createAssistantMessage(assistantText);
  assistantMsg.timestamp = Date.now();

  if (existing && continuous) {
    return {
      ...existing,
      model,
      timestamp: Date.now(),
      continuous: true,
      messages: [...existing.messages, userMsg, assistantMsg],
    };
  }

  return {
    id: crypto.randomUUID(),
    model,
    timestamp: userMsg.timestamp,
    continuous,
    messages: [userMsg, assistantMsg],
  };
}

/**
 * Build the provider payload for one F9 turn.
 *
 * `imageDataUrl` is the freshly captured screenshot, still in memory as a data
 * URL; only earlier turns reference files on disk. Async because stored
 * screenshots are read back before being sent.
 */
export async function buildApiConversation(
  priorMessages: ChatMessage[],
  newUserText: string,
  imageDataUrl?: string
) {
  const prior = await toApiMessages(priorMessages);
  const fresh = await toApiMessages([createUserMessage(newUserText, imageDataUrl)]);
  return [...prior, ...fresh];
}

export function buildPendingMessages(
  priorMessages: ChatMessage[],
  newUserText: string,
  imageDataUrl?: string
): ChatMessage[] {
  return [...priorMessages, createUserMessage(newUserText, imageDataUrl)];
}
