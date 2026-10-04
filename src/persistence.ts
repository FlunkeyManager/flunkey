/**
 * persistence.ts – Bridge between Zustand and the Tauri Store plugin.
 * Reads/writes a single JSON file in Windows AppData.
 */
import { load } from "@tauri-apps/plugin-store";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./store";
import { migrateInlineScreenshots, wipeScreenshots } from "./screenshots";
import { migrateStoreSplit, type StoreLike } from "./storeSplit";
import { disableAutostart } from "./autostart";
import { trimHistory } from "./retention";
import {
  DEFAULT_SETTINGS,
  LEGACY_OPENROUTER_MODEL,
  normalizeGroqModel,
  normalizeHistoryLimits,
  normalizeDictationStyle,
} from "./types";
import { normalizeHotkeys } from "./hotkeys";
import { DEFAULT_DICTIONARY_ENTRIES, normalizeDictionaryList } from "./dictionary";
import type {
  UserSettings,
  Transcription,
  AiSession,
  TransformRecord,
  DictionaryEntry,
} from "./types";
import { migrateAiSessions } from "./sessionUtils";
import { clearCatalogCache } from "./openrouter";
import {
  purgeKeysFromKeyring,
  readKeysFromKeyring,
  stripKeys,
  syncKeysToKeyring,
  type ApiKeyField,
} from "./secrets";

/**
 * One file per collection.
 *
 * They used to share a single flunkey-data.json, which meant every dictation
 * rewrote the whole chat history and every screenshot-laden session was
 * re-serialised for an unrelated settings change. Splitting them makes each
 * save proportional to what actually changed.
 */
const STORE_FILES = {
  settings: "flunkey-settings.json",
  transcriptions: "flunkey-transcripts.json",
  aiSessions: "flunkey-chats.json",
  transforms: "flunkey-transforms.json",
  dictionary: "flunkey-dictionary.json",
} as const;

type StoreKey = keyof typeof STORE_FILES;

/** The single file every release before this one wrote to. */
const LEGACY_STORE_FILE = "flunkey-data.json";

/**
 * Report a store write that did not reach disk.
 *
 * Every save used to swallow its error into `console.error`, which is invisible
 * in a packaged app: a full disk or a locked file meant the user's dictation
 * simply vanished with no message anywhere. Surfaced as a toast instead.
 */
function reportSaveFailure(what: string, err: unknown) {
  console.error(`[persistence] Could not save ${what}:`, err);
  useStore.getState().setStorageError(what);
}

const stores = new Map<StoreKey, Awaited<ReturnType<typeof load>>>();

async function getStore(key: StoreKey) {
  let store = stores.get(key);
  if (!store) {
    store = await load(STORE_FILES[key], { defaults: {}, autoSave: true });
    stores.set(key, store);
  }
  return store;
}

/**
 * Move data out of the old combined file, once.
 *
 * Safety rule: the legacy file is emptied only after every collection has been
 * read back from its new file and confirmed. If any write fails or comes back
 * short, the old file is left completely intact so the next launch retries —
 * the one unacceptable outcome is a half-migrated profile where the data
 * exists in neither layout.
 */
async function migrateLegacyStore(): Promise<void> {
  // Read the old file's bytes directly rather than through the store plugin.
  // The plugin's `load()` on this path returns an empty store even when the
  // file holds valid JSON — which means a `clear()` through the plugin would
  // overwrite real data with `{}`. Reading and clearing the file explicitly is
  // the only way to be sure about both what we read and what we destroy.
  const raw = await invoke<string | null>("appdata_read_json", {
    name: LEGACY_STORE_FILE,
  }).catch((err) => {
    console.error("[persistence] Could not read the previous store file.", err);
    return null;
  });
  if (!raw) return;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    // Corrupt file: leave it exactly as it is rather than replacing it.
    console.error(
      `[persistence] ${LEGACY_STORE_FILE} is not valid JSON; leaving it untouched.`,
      err,
    );
    return;
  }
  if (Object.keys(parsed).length === 0) return;

  const collections = Object.keys(STORE_FILES) as StoreKey[];

  // Read-then-write through the store plugin, with the source bytes held in
  // memory. The ordering rule lives in storeSplit.ts and is covered by
  // src/__tests__/storeSplit.test.ts.
  const outcome = await migrateStoreSplit(
    memorySource(parsed, collections),
    (key) => getStore(key as StoreKey),
    collections
  );
  if (!outcome.safeToRetireSource) {
    console.warn(
      `[persistence] Could not split the previous store file; ${outcome.retained} ` +
        `collection(s) are unwritten and the file has been left intact for a retry. ` +
        outcome.failures
          .map((f) => `${f.key}: ${f.error}`)
          .join("; "),
    );
    return;
  }
  if (outcome.moved === 0) return;

  // Only now is it safe to empty the old file.
  try {
    await invoke("appdata_clear_json", { name: LEGACY_STORE_FILE });
  } catch (err) {
    // The data is safely in the new files; a leftover old file is harmless and
    // the next launch will find the destinations already populated.
    console.warn(
      `[persistence] Split succeeded but the old file could not be emptied; ` +
        `it will be ignored from now on.`,
      err,
    );
  }
  console.info(
    `[persistence] Split the previous store file across ${outcome.moved} collection(s).`,
  );
}

/** Store-shaped view over the parsed legacy file. */
function memorySource(
  data: Record<string, unknown>,
  keys: StoreKey[]
): StoreLike {
  return {
    async get<T>(key: string) {
      return keys.includes(key as StoreKey) ? (data[key] as T) : undefined;
    },
    async set() {},
    async save() {},
    async clear() {},
  };
}

/**
 * Trailing-edge writer used to collapse bursts of setting changes.
 *
 * Hand-rolled rather than pulled from lodash: the app has no lodash
 * dependency and this is the only place that needs one. `cancel()` matters —
 * a scheduled write that survives a wipe would repopulate the file we just
 * emptied.
 */
function debounceWriter<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void fn(...args);
    }, wait);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

/* ── Bootstrap  ──────────────────────────────────────────────── */

export async function loadAllData() {
  await migrateLegacyStore();
  const settingsStore = await getStore("settings");
  const transcriptStore = await getStore("transcriptions");
  const chatStore = await getStore("aiSessions");
  const transformStore = await getStore("transforms");
  const dictionaryStore = await getStore("dictionary");
  const stored =
    ((await settingsStore.get<UserSettings>("settings")) as UserSettings | null) ??
    null;
  const historyLimits = normalizeHistoryLimits(stored?.historyLimits);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    // The dictionary toggles and the prompt-builder flags were removed. `stored`
    // still carries them, so blank them explicitly — JSON.stringify drops
    // undefined values, which is what retires the keys from the file.
    dictionaryEnabledF8: undefined,
    dictionaryEnabledF10: undefined,
    appPromptBuilder: undefined,
    model: normalizeGroqModel(stored?.model ?? DEFAULT_SETTINGS.model),
    hotkeys: normalizeHotkeys(stored?.hotkeys),
    // Dictation cleanup level, standing instructions, per-app overrides and
    // per-app prompt-builder flags. Normalized because a bad value here would
    // silently change how much of the user's words gets rewritten.
    dictationStyle: normalizeDictationStyle(stored?.dictationStyle),
    dictationInstructions:
      typeof stored?.dictationInstructions === "string"
        ? stored.dictationInstructions
        : DEFAULT_SETTINGS.dictationInstructions,
    appInstructions:
      stored?.appInstructions && typeof stored.appInstructions === "object"
        ? Object.fromEntries(
            Object.entries(stored.appInstructions as Record<string, unknown>)
              .filter(([, v]) => typeof v === "string" && v.trim())
              .map(([k, v]) => [k, (v as string).trim()]),
          )
: {},
    historyLimits,
  };

  // OpenRouter used to default to a paid Anthropic model. Untouched installs
  // (and any task still pointing at that legacy id) move to the free router
  // so nobody is billed by default; a different id means a real user choice
  // and is left alone.
  const legacyIds = new Set([LEGACY_OPENROUTER_MODEL, ""]);
  let migratedOpenRouterDefault = false;
  if (legacyIds.has(settings.openRouterModel?.trim() ?? "")) {
    settings.openRouterModel = DEFAULT_SETTINGS.openRouterModel;
    migratedOpenRouterDefault = true;
  }
  for (const key of ["f9Model", "f10Model", "polishModel"] as const) {
    if (
      (settings[key] ?? "").trim() === LEGACY_OPENROUTER_MODEL &&
      migratedOpenRouterDefault
    ) {
      settings[key] = "";
    }
  }
  // API keys: keyring is the source of truth; legacy plaintext keys in the
  // store file are adopted into memory (and moved on first save below).
  const KEY_FIELDS: ApiKeyField[] = [
    "groqApiKey",
    "openaiApiKey",
    "geminiApiKey",
    "openRouterApiKey",
  ];
  const keyringKeys = await readKeysFromKeyring();
  let legacyPlaintextKeys = false;
  for (const field of KEY_FIELDS) {
    const diskValue = (stored?.[field] ?? "").trim();
    if (diskValue) {
      settings[field] = diskValue;
      legacyPlaintextKeys = true;
    } else if (keyringKeys[field]) {
      settings[field] = keyringKeys[field];
    }
  }
  const needsShapeRewrite =
    // Write back once when a release adds settings this install predates, so
    // the file on disk matches what the UI shows. Without this the new fields
    // exist only in memory until the user happens to change something, which
    // makes a data-file read disagree with the page.
    typeof stored?.dictationStyle !== "string" ||
    typeof stored?.dictationInstructions !== "string" ||
    !stored?.appInstructions ||
    // Retired keys: your words always apply now, and Enhanced simply follows
    // the application's prompt, so neither needs a switch.
    "dictionaryEnabledF8" in (stored ?? {}) ||
    "dictionaryEnabledF10" in (stored ?? {}) ||
    "appPromptBuilder" in (stored ?? {});

  if (legacyPlaintextKeys) {
    // Complete the migration now: keys → keyring, disk copy blanked.
    //
    // saveSettings writes the keyring *before* it blanks the disk copy, so a
    // keyring failure surfaces as an error and the plaintext survives for the
    // next attempt. Saving unconditionally would have destroyed the only
    // remaining copy of a key we could not store anywhere else.
    await saveSettings(settings).catch((err) => {
      console.error(
        "[persistence] Could not move API keys into the credential store; " +
          "leaving them on disk for the next attempt.",
        err,
      );
    });
  } else if (migratedOpenRouterDefault || needsShapeRewrite) {
    // Either the free-router default needs persisting so it stops
    // re-migrating, or the file predates a settings shape.
    await saveSettings(settings);
  }
  const transcriptions =
    ((await transcriptStore.get<Transcription[]>("transcriptions")) as Transcription[]) ??
    [];
  const rawSessions =
    ((await chatStore.get<unknown[]>("aiSessions")) as unknown[]) ?? [];
  const aiSessions = migrateAiSessions(rawSessions);
  if (rawSessions.length > 0 && aiSessions.length > 0) {
    const needsRewrite = rawSessions.some(
      (s) => typeof s === "object" && s !== null && "question" in s
    );
    if (needsRewrite) {
      await chatStore.set("aiSessions", aiSessions);
    }
  }

  const transforms =
    ((await transformStore.get<TransformRecord[]>("transforms")) as TransformRecord[]) ?? [];

  const storedDict =
    ((await dictionaryStore.get<DictionaryEntry[]>("dictionary")) as DictionaryEntry[]) ??
    null;
  // Migrate legacy entries (aliases/categories dropped) to words-only.
  // null (never saved) -> defaults; an empty array stays empty.
  const dictionary =
    storedDict === null ? [...DEFAULT_DICTIONARY_ENTRIES] : normalizeDictionaryList(storedDict);

  // Move screenshots out of the JSON into their own files. Older builds stored
  // a base64 data URL per turn, which could add 1.3 MB to this file and made
  // every later save rewrite all of it.
  let sessions = aiSessions;
  if (await migrateInlineScreenshots(sessions)) {
    await chatStore.set("aiSessions", sessions);
    await chatStore
      .save()
      .catch((e: unknown) => console.error("Store save failed:", e));
  }

  // Enforce retention on load too, not only on write: an install that already
  // holds far more than the cap is trimmed the first time it starts.
  const trimmed = await trimHistory(historyLimits, transcriptions, transforms, sessions);
  if (
    trimmed.removed.transcriptions ||
    trimmed.removed.transforms ||
    trimmed.removed.chats ||
    trimmed.orphanedScreenshots.length > 0
  ) {
    if (trimmed.removed.transcriptions) {
      await transcriptStore.set("transcriptions", trimmed.transcriptions);
      await transcriptStore
        .save()
        .catch((e: unknown) => console.error("Store save failed:", e));
    }
    if (trimmed.removed.transforms) {
      await transformStore.set("transforms", trimmed.transforms);
      await transformStore
        .save()
        .catch((e: unknown) => console.error("Store save failed:", e));
    }
    if (trimmed.removed.chats) {
      await chatStore.set("aiSessions", trimmed.sessions);
      await chatStore
        .save()
        .catch((e: unknown) => console.error("Store save failed:", e));
    }
    console.info(
      `[persistence] Retention removed ${trimmed.removed.transcriptions} transcriptions, ` +
        `${trimmed.removed.transforms} transforms, ${trimmed.removed.chats} chats, and ` +
        `${trimmed.orphanedScreenshots.length} screenshots.`,
    );
  }
  sessions = trimmed.sessions;

  useStore.setState({
    settings,
    transcriptions: trimmed.transcriptions,
    aiSessions: sessions,
    transforms: trimmed.transforms,
    dictionary,
  });
}

/* ── Writers (call after mutations) ──────────────────────────── */

export async function saveSettings(settings: UserSettings) {
  const key = "settings" as const;
  const store = await getStore(key);
  try {
    await syncKeysToKeyring(settings);
  } catch (e) {
    // Fail closed: never write API keys to disk in plaintext.
    // Persist non-secret settings stripped of keys and keep keys memory-only
    // for this session; the next save retries the keyring.
    console.error("Keyring sync failed, keys kept memory-only:", e);
  }
  await store.set("settings", stripKeys(settings));
  // Flush to disk now — autoSave's debounce alone can lose the last write
  // on a fast app exit (tray Quit gives the frontend no flush hook).
  await store.save().catch((e: unknown) => reportSaveFailure(key, e));
}

export async function saveTranscriptions(list: Transcription[]) {
  const key = "transcriptions" as const;
  const store = await getStore(key);
  await store.set("transcriptions", list);
  await store.save().catch((e: unknown) => reportSaveFailure(key, e));
}

export async function saveAiSessions(list: AiSession[]) {
  const key = "aiSessions" as const;
  const store = await getStore(key);
  await store.set("aiSessions", list);
  await store.save().catch((e: unknown) => reportSaveFailure(key, e));
}

/**
 * Debounced settings writer.
 *
 * The Settings page calls `updateSettings` on every keystroke; without this
 * each character rewrote the whole store. The pending write is flushed by the
 * 150 ms trailing edge, which is also why `wipeAllData` cancels it first.
 */
export const pendingSettingsSave = debounceWriter((settings: UserSettings) => {
  void saveSettings(settings);
}, 150);

export async function saveTransforms(list: TransformRecord[]) {
  const key = "transforms" as const;
  const store = await getStore(key);
  await store.set("transforms", list);
  await store.save().catch((e: unknown) => reportSaveFailure(key, e));
}

export async function saveDictionary(list: DictionaryEntry[]) {
  const key = "dictionary" as const;
  const store = await getStore(key);
  await store.set("dictionary", list);
  await store.save().catch((e: unknown) => reportSaveFailure(key, e));
}

/**
 * Delete everything this app stored: settings, history, API keys, cached
 * catalogs, screenshots, and downloaded speech models.
 *
 * The confirmation dialog is explicit that models go too, because leaving
 * 141 MB of weights behind after "wipe all data" is the kind of surprise
 * that erodes trust in the label.
 */
export async function wipeAllData() {
  // Stop the debounced settings writer first: a save scheduled moments before
  // the wipe would otherwise land after it and repopulate the file we just
  // emptied.
  pendingSettingsSave.cancel();
  for (const key of Object.keys(STORE_FILES) as StoreKey[]) {
    const store = await getStore(key);
    await store.clear();
    await store.save().catch((e: unknown) => reportSaveFailure(key, e));
  }
  // The pre-split file too, so a user who installed an older build and then
  // wiped has nothing left in it. Written directly rather than through the
  // store plugin, whose clear() on this path overwrites the file without
  // reliably reading it first.
  try {
    await invoke("appdata_clear_json", { name: LEGACY_STORE_FILE });
  } catch (e) {
    console.error("Could not clear the pre-split store file:", e);
  }
  await purgeKeysFromKeyring();
  try {
    await clearCatalogCache();
  } catch (e) {
    console.error("Failed to clear model catalog on wipe:", e);
  }
  try {
    await wipeScreenshots();
  } catch (e) {
    console.error("Failed to clear stored screenshots on wipe:", e);
  }
  try {
    await invoke("whisper_wipe_models");
  } catch (e) {
    // The engine may not be present at all; not being able to reach the models
    // folder must not abort the rest of the wipe.
    console.error("Failed to delete downloaded models on wipe:", e);
  }
  try {
    await disableAutostart();
  } catch (e) {
    console.error("Failed to clear autostart on wipe:", e);
  }
  try {
    await writeText("");
  } catch (e) {
    console.error("Failed to clear clipboard on wipe:", e);
  }
  useStore.getState().resetSettings();
  useStore.getState().clearTranscriptions();
  useStore.getState().clearAiSessions();
  useStore.getState().clearTransforms();
  useStore.getState().setDictionary([...DEFAULT_DICTIONARY_ENTRIES]);
  useStore.getState().setActiveChatId(null);
}
