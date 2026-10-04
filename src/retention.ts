/**
 * retention.ts – keeps stored history from growing without bound.
 *
 * Everything here trims oldest-first and reports what it removed, so callers
 * can tell the user when something was dropped rather than letting it happen
 * silently. Screenshot files are deleted with their sessions; if that fails the
 * turn is still trimmed, because the JSON size is the real problem.
 */
import type { AiSession, HistoryLimits, Transcription, TransformRecord } from "./types";
import { DEFAULT_HISTORY_LIMITS } from "./types";
import { deleteScreenshots } from "./screenshots";

export interface TrimResult<T> {
  items: T[];
  removed: number;
}

/**
 * Drop the oldest entries past `limit`.
 *
 * Lists are stored newest-first, so a slice is enough. A limit of 0 keeps
 * everything, which is what an explicit "unlimited" setting should mean.
 */
function trimNewestFirst<T>(list: T[], limit: number): TrimResult<T> {
  if (limit <= 0 || list.length <= limit) {
    return { items: list, removed: 0 };
  }
  return { items: list.slice(0, limit), removed: list.length - limit };
}

/** Every screenshot file referenced by the given sessions. */
export function referencedScreenshots(sessions: AiSession[]): string[] {
  const names = new Set<string>();
  for (const session of sessions) {
    for (const message of session.messages) {
      const ref = message.imageDataUrl;
      // Legacy inline data URLs are not files; those are handled by the
      // screenshot migration instead.
      if (ref && !ref.startsWith("data:")) names.add(ref);
    }
  }
  return [...names];
}

/**
 * Trim transcripts, transforms, and chats to the configured limits.
 *
 * Returns the new lists plus the screenshot filenames that are no longer
 * referenced, so the caller can delete exactly those files and no others.
 */
export async function trimHistory(
  limits: HistoryLimits | undefined,
  transcriptions: Transcription[],
  transforms: TransformRecord[],
  sessions: AiSession[]
): Promise<{
  transcriptions: Transcription[];
  transforms: TransformRecord[];
  sessions: AiSession[];
  orphanedScreenshots: string[];
  removed: { transcriptions: number; transforms: number; chats: number };
}> {
  const effective = limits ?? DEFAULT_HISTORY_LIMITS;
  const trimmedTranscriptions = trimNewestFirst(
    transcriptions,
    effective.transcriptions
  );
  const trimmedTransforms = trimNewestFirst(transforms, effective.transforms);
  let trimmedSessions = trimNewestFirst(sessions, effective.chats);
  let trimmedShots = trimmedScreenshots(effective.screenshots, trimmedSessions.items);

  // Screenshot files are the bulk of the footprint, so when only the image cap
  // bites we trim turns until it fits — dropping a whole chat to save one image
  // would be the wrong trade.
  // Each pass drops one session, so the iteration count is bounded by the
  // session list; the guard only exists so a logic error cannot spin forever.
  let guard = 0;
  while (
    effective.screenshots > 0 &&
    trimmedShots.referenced > effective.screenshots &&
    trimmedSessions.items.length > 1 &&
    guard++ < 10_000
  ) {
    trimmedSessions = {
      items: trimmedSessions.items.slice(0, -1),
      removed: trimmedSessions.removed + 1,
    };
    trimmedShots = trimmedScreenshots(effective.screenshots, trimmedSessions.items);
  }

  const stillReferenced = new Set(referencedScreenshots(trimmedSessions.items));
  const orphaned = trimmedShots.dropped.filter((n) => !stillReferenced.has(n));

  return {
    transcriptions: trimmedTranscriptions.items,
    transforms: trimmedTransforms.items,
    sessions: trimmedSessions.items,
    orphanedScreenshots: orphaned,
    removed: {
      transcriptions: trimmedTranscriptions.removed,
      transforms: trimmedTransforms.removed,
      chats: trimmedSessions.removed,
    },
  };
}

/**
 * Decide which screenshot files to keep.
 *
 * Walks sessions newest-first so the most recent images survive, dropping the
 * oldest references until the cap is met. Keeps its own drop list because the
 * caller's surviving sessions may still reference an image that was dropped on
 * a later pass.
 */
function trimmedScreenshots(
  limit: number,
  sessions: AiSession[]
): { referenced: number; dropped: string[] } {
  const all = referencedScreenshots(sessions);
  if (limit <= 0 || all.length <= limit) {
    return { referenced: all.length, dropped: [] };
  }
  // Sessions are newest-first, and images appear in turn order within a
  // session, so a reverse walk visits images oldest-first.
  const keep = new Set<string>();
  const dropped: string[] = [];
  for (let s = sessions.length - 1; s >= 0; s--) {
    for (let m = sessions[s].messages.length - 1; m >= 0; m--) {
      const ref = sessions[s].messages[m].imageDataUrl;
      if (!ref || ref.startsWith("data:") || keep.has(ref)) continue;
      if (keep.size < limit) {
        keep.add(ref);
      } else {
        dropped.push(ref);
      }
    }
  }
  return { referenced: all.length, dropped };
}

/**
 * Delete a session and the screenshot files only it referenced.
 *
 * Shared by per-item delete and any trim path so a deleted chat never leaves
 * its images behind.
 */
export async function deleteSessionWithScreenshots(
  sessions: AiSession[],
  sessionId: string
): Promise<AiSession[]> {
  const target = sessions.find((s) => s.id === sessionId);
  const remaining = sessions.filter((s) => s.id !== sessionId);
  if (target) {
    const stillReferenced = new Set(referencedScreenshots(remaining));
    const orphans = referencedScreenshots([target]).filter(
      (n) => !stillReferenced.has(n)
    );
    if (orphans.length > 0) await deleteScreenshots(orphans);
  }
  return remaining;
}

/** Delete screenshots attached to one message, clearing its reference. */
export async function clearMessageScreenshot(message: {
  imageDataUrl?: string;
}): Promise<void> {
  const ref = message.imageDataUrl;
  if (ref && !ref.startsWith("data:")) {
    await deleteScreenshots([ref]);
  }
  message.imageDataUrl = undefined;
}