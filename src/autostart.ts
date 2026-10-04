/**
 * autostart.ts — Windows "start with computer" via the Tauri autostart
 * plugin (already registered in src-tauri/src/lib.rs with capabilities
 * in src-tauri/capabilities/default.json).
 *
 * All calls are safe outside Tauri (browser dev): failures resolve false.
 */

import { invoke } from "@tauri-apps/api/core";

/** Apply the user's choice immediately. Returns the actual end state. */
export async function setAutostartEnabled(on: boolean): Promise<boolean> {
  try {
    return await invoke<boolean>("set_autostart_enabled", { enabled: on });
  } catch (e) {
    console.error("Autostart change failed:", e);
    return false;
  }
}

/**
 * Remove the startup entry.
 *
 * Used by "Wipe all data": a registry Run entry is app state that outlives
 * the data, so it must be cleared explicitly or the next launch would run a
 * freshly reset Flunkey the user never asked to start.
 */
export async function disableAutostart(): Promise<void> {
  await setAutostartEnabled(false);
}
