import type { AiSession, ChatMessage } from "./types";
import { loadScreenshot } from "./screenshots";

/** Legacy shape persisted before message-based sessions. */
interface LegacyAiSession {
  id: string;
  question: string;
  response: string;
  model: string;
  timestamp: number;
}

export function isLegacyAiSession(raw: unknown): raw is LegacyAiSession {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "question" in raw &&
    "response" in raw &&
    !("messages" in raw)
  );
}

export function migrateAiSession(raw: unknown): AiSession | null {
  if (typeof raw !== "object" || raw === null) return null;

  if ("messages" in raw && Array.isArray((raw as AiSession).messages)) {
    const session = raw as AiSession;
    return {
      ...session,
      messages: session.messages.map((m) => ({
        id: m.id ?? crypto.randomUUID(),
        role: m.role,
        content: m.content ?? "",
        imageDataUrl:
          typeof m.imageDataUrl === "string" ? m.imageDataUrl : undefined,
        timestamp: m.timestamp ?? session.timestamp,
      })),
    };
  }

  if (isLegacyAiSession(raw)) {
    const ts = raw.timestamp;
    return {
      id: raw.id,
      model: raw.model,
      timestamp: ts,
      continuous: false,
      messages: [
        {
          id: crypto.randomUUID(),
          role: "user",
          content: raw.question,
          timestamp: ts,
        },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: raw.response,
          timestamp: ts,
        },
      ],
    };
  }

  return null;
}

export function migrateAiSessions(list: unknown[]): AiSession[] {
  return list
    .map(migrateAiSession)
    .filter((s): s is AiSession => s !== null);
}

export function getFirstUserMessage(session: AiSession): string {
  return session.messages.find((m) => m.role === "user")?.content ?? "";
}

export function getLastAssistantMessage(session: AiSession): string {
  const assistants = session.messages.filter((m) => m.role === "assistant");
  return assistants[assistants.length - 1]?.content ?? "";
}

export function countUserMessages(session: AiSession): number {
  return session.messages.filter((m) => m.role === "user").length;
}

/**
 * Return a data URL for a stored screenshot reference.
 *
 * Accepts both forms so pre-migration sessions keep working: a stored value
 * that already looks like a data URL is passed through untouched, anything
 * else is treated as a filename and read from disk.
 */
export async function resolveScreenshot(ref: string): Promise<string | null> {
  if (ref.startsWith("data:")) return ref;
  return loadScreenshot(ref);
}

export function createUserMessage(
  content: string,
  imageDataUrl?: string
): ChatMessage {
  const ts = Date.now();
  return {
    id: crypto.randomUUID(),
    role: "user",
    content,
    imageDataUrl,
    timestamp: ts,
  };
}

export function createAssistantMessage(content = ""): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content,
    timestamp: Date.now(),
  };
}

/**
 * Convert stored messages into the provider's wire format.
 *
 * Async because a stored screenshot is a filename, not the image: the bytes
 * are read back from disk here so callers keep working with data URLs.
 */
export async function toApiMessages(
  messages: ChatMessage[]
): Promise<{
  role: "user" | "assistant";
  content:
    | string
    | (
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      )[];
}[]> {
  return Promise.all(
    messages.map(async (m) => {
      if (m.role !== "user" || !m.imageDataUrl) {
        return { role: m.role, content: m.content };
      }
      const url = await resolveScreenshot(m.imageDataUrl);
      if (!url) {
        // The file was deleted or is unreadable. Send the text alone rather
        // than failing the whole turn or sending a broken image reference.
        console.warn(`[chat] Screenshot ${m.imageDataUrl} is unavailable.`);
        return { role: m.role, content: m.content };
      }
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content },
          { type: "image_url", image_url: { url } },
        ],
      };
    })
  );
}
