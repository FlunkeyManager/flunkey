/**
 * screenshots.ts – storage for F9 screenshots attached to chat turns.
 *
 * Screenshots used to live inside flunkey-data.json as base64 data URLs. One
 * turn could add 1.3 MB to the settings file, and every subsequent save
 * rewrote all of it, so a chat with a few screenshots turned ordinary dictation
 * into a multi-hundred-megabyte disk write.
 *
 * Each screenshot is now a JPEG file under local AppData, and the session only
 * holds the filename. The session-facing API below still speaks data URLs so
 * the rest of the app does not have to care where the bytes live.
 */
import { invoke } from "@tauri-apps/api/core";

const encoderFailed = new Set<string>();

/** Persist a data URL and return the filename to store in the session. */
export async function saveScreenshot(dataUrl: string, hint = "shot"): Promise<string> {
  return invoke<string>("screenshot_save", { dataUrl, hint });
}

/** Load a stored screenshot back as a data URL. */
export async function loadScreenshot(name: string): Promise<string | null> {
  try {
    return await invoke<string>("screenshot_load", { name });
  } catch (err) {
    console.error(`[screenshots] Could not read ${name}:`, err);
    return null;
  }
}

export async function deleteScreenshots(names: string[]): Promise<void> {
  if (names.length === 0) return;
  try {
    await invoke("screenshot_delete_many", { names });
  } catch (err) {
    console.error("[screenshots] Delete failed:", err);
  }
}

/** Total bytes held by stored screenshots. */
export async function screenshotUsageBytes(): Promise<number> {
  try {
    return await invoke<number>("screenshot_usage");
  } catch {
    return 0;
  }
}

export async function wipeScreenshots(): Promise<void> {
  try {
    await invoke("screenshot_wipe");
  } catch (err) {
    console.error("[screenshots] Wipe failed:", err);
  }
}

/**
 * Convert a session's `imageDataUrl` values into stored filenames in place,
 * then save and delete the source images.
 *
 * Sessions written by older builds carry the whole data URL, so this is the
 * one-time migration that keeps that history but gets it out of the JSON.
 * Already-migrated sessions are left untouched.
 */
export async function migrateInlineScreenshots(
  sessions: { id: string; messages: { imageDataUrl?: string }[] }[],
): Promise<boolean> {
  let changed = false;
  for (const session of sessions) {
    for (const message of session.messages) {
      const inline = message.imageDataUrl;
      if (!inline || !inline.startsWith("data:image/jpeg;base64,")) continue;
      if (encoderFailed.has(inline)) continue;
      try {
        const name = await saveScreenshot(inline, `migrated-${session.id}`);
        message.imageDataUrl = name;
        changed = true;
      } catch (err) {
        // Leave the data URL in place rather than losing the screenshot, and
        // stop retrying this exact payload on every future load.
        encoderFailed.add(inline);
        console.error("[screenshots] Could not migrate an inline screenshot:", err);
      }
    }
  }
  return changed;
}

/** Every stored screenshot filename, for reconciling orphans. */
export async function listScreenshots(): Promise<string[]> {
  try {
    return await invoke<string[]>("screenshot_list");
  } catch {
    return [];
  }
}