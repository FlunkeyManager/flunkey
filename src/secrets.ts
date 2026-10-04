/**
 * secrets.ts — API keys live in the OS keyring (Windows Credential Manager),
 * never in the plaintext Tauri Store. Single choke point: persistence.ts
 * syncs keys here on every settings save and reads them at bootstrap.
 */

import { invoke } from "@tauri-apps/api/core";

export const KEY_ACCOUNTS = {
  groqApiKey: "groq_api_key",
  openaiApiKey: "openai_api_key",
  geminiApiKey: "gemini_api_key",
  openRouterApiKey: "openrouter_api_key",
} as const;

export type ApiKeyField = keyof typeof KEY_ACCOUNTS;

const FIELDS = Object.keys(KEY_ACCOUNTS) as ApiKeyField[];

/**
 * Last keyring-synced value per field. Hot settings saves (autosave
 * debounce, overlay drags, toggles) skip the native round-trip entirely
 * when nothing changed — voice flows never wait on the vault.
 */
const lastSynced = new Map<ApiKeyField, string>();

export function primeKeyCache(keys: Record<ApiKeyField, string>): void {
  for (const field of FIELDS) lastSynced.set(field, (keys[field] ?? "").trim());
}

export async function readKeysFromKeyring(): Promise<
  Record<ApiKeyField, string>
> {
  const out = {
    groqApiKey: "",
    openaiApiKey: "",
    geminiApiKey: "",
    openRouterApiKey: "",
  };
  await Promise.all(
    FIELDS.map(async (field) => {
      try {
        const v = await invoke<string | null>("secret_get", {
          account: KEY_ACCOUNTS[field],
        });
        if (typeof v === "string" && v) out[field] = v;
      } catch (e) {
        console.error(`Keyring read failed for ${field}:`, e);
      }
    })
  );
  primeKeyCache(out);
  return out;
}

/**
 * Write changed keys to the keyring (empty value deletes the entry, but
 * ONLY on a real non-empty → empty transition — a field that was already
 * empty is left alone, so stale snapshots can never wipe stored keys).
 * Throws on failure so callers can fall back rather than lose keys.
 */
export async function syncKeysToKeyring(
  settings: Record<ApiKeyField, string>
): Promise<void> {
  await Promise.all(
    FIELDS.map(async (field) => {
      const value = (settings[field] ?? "").trim();
      if (lastSynced.get(field) === value) return;
      if (value) {
        await invoke("secret_set", {
          account: KEY_ACCOUNTS[field],
          secret: value,
        });
      } else if (lastSynced.get(field)) {
        await invoke("secret_delete", { account: KEY_ACCOUNTS[field] });
      }
      lastSynced.set(field, value);
    })
  );
}

export async function purgeKeysFromKeyring(): Promise<void> {
  for (const field of FIELDS) {
    try {
      await invoke("secret_delete", { account: KEY_ACCOUNTS[field] });
    } catch (e) {
      console.error(`Keyring purge failed for ${field}:`, e);
    }
  }
  lastSynced.clear();
}

/** Blank key fields so settings objects are safe to persist to disk. */
/**
 * Blank the API keys before settings are written to disk.
 *
 * `JSON.stringify` drops any key whose value is `undefined`, so this also
 * clears out settings that have been retired: an older install still carries
 * `dictionaryEnabledF8`/`F10` in its stored object, and leaving them would keep
 * dead keys in the file forever.
 */
export function stripKeys<T extends Record<ApiKeyField, string>>(s: T): T {
  return {
    ...s,
    groqApiKey: "",
    openaiApiKey: "",
    geminiApiKey: "",
    openRouterApiKey: "",
  };
}
