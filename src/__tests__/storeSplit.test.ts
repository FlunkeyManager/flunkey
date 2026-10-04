/**
 * Tests for the pre-split store migration.
 *
 * The failure guarded against is silent and unrecoverable: emptying the source
 * file before every destination write is confirmed loses the user's settings,
 * transcriptions, chats, and transforms with no backup. These run in plain
 * Node against an in-memory store double, so they need neither Tauri nor a
 * real AppData directory.
 */
import { describe, expect, it } from "vitest";
import { migrateStoreSplit, type StoreLike } from "../storeSplit";

/** In-memory store double with an injectable write failure. */
function fakeStore(
  initial: Record<string, unknown> = {},
  opts: { failWrite?: string } = {}
): StoreLike & { data: Record<string, unknown>; writes: string[] } {
  const data: Record<string, unknown> = { ...initial };
  const writes: string[] = [];
  return {
    data,
    writes,
    async get<T>(key: string) {
      return data[key] as T | undefined;
    },
    async set(key: string, value: unknown) {
      if (opts.failWrite === key) throw new Error(`write refused for ${key}`);
      data[key] = value;
      writes.push(key);
    },
    async save() {},
    async clear() {
      for (const k of Object.keys(data)) delete data[k];
    },
  };
}

const COLLECTIONS = [
  "settings",
  "transcriptions",
  "aiSessions",
  "transforms",
  "dictionary",
] as const;

const SAMPLE: Record<string, unknown> = {
  settings: { systemPrompt: "hi", sttProvider: "groq" },
  transcriptions: [{ id: "t1", text: "hello", timestamp: 1 }],
  aiSessions: [{ id: "s1", model: "m", timestamp: 2, messages: [] }],
  transforms: [{ id: "x1", originalText: "a", resultText: "b", timestamp: 3 }],
  dictionary: [{ id: "d1", word: "Groq" }],
};

function destinationsFor(stores: Record<string, ReturnType<typeof fakeStore>>) {
  return async (key: string) => stores[key] ?? null;
}

describe("migrateStoreSplit", () => {
  it("moves every collection and empties the source only afterwards", async () => {
    const source = fakeStore(SAMPLE);
    const targets = Object.fromEntries(
      COLLECTIONS.map((k) => [k, fakeStore()])
    ) as Record<(typeof COLLECTIONS)[number], ReturnType<typeof fakeStore>>;

    const outcome = await migrateStoreSplit(
      source,
      destinationsFor(targets),
      COLLECTIONS
    );

    expect(outcome).toEqual({
      moved: 5,
      retained: 0,
      safeToRetireSource: true,
      failures: [],
    });
    expect(source.data).toEqual({});
    for (const key of COLLECTIONS) {
      expect(targets[key].data[key]).toEqual(SAMPLE[key]);
    }
  });

  it("moves the writable collections and keeps the source when one fails", async () => {
    const source = fakeStore(SAMPLE);
    const targets = Object.fromEntries(
      COLLECTIONS.map((k) => [
        k,
        // One collection cannot be written.
        k === "aiSessions" ? fakeStore({}, { failWrite: "aiSessions" }) : fakeStore(),
      ])
    ) as Record<(typeof COLLECTIONS)[number], ReturnType<typeof fakeStore>>;

    const outcome = await migrateStoreSplit(
      source,
      destinationsFor(targets),
      COLLECTIONS
    );

    expect(outcome.safeToRetireSource).toBe(false);
    // Only the failed collection is stranded; the rest still moved.
    expect(outcome.moved).toBe(4);
    expect(outcome.retained).toBe(1);
    expect(outcome.failures).toEqual([
      { key: "aiSessions", error: "write refused for aiSessions" },
    ]);
    // Nothing lost: every value is still readable from the source.
    expect(source.data).toEqual(SAMPLE);
    expect(targets.transcriptions.data.transcriptions).toEqual(
      SAMPLE.transcriptions
    );
  });

  it("accepts a value that round-tripped with different key order", async () => {
    // Regression: the store layer re-serializes with its own key order, so a
    // raw string comparison reported every successful write as a mismatch and
    // the source file was never retired.
    const source = fakeStore({ settings: { b: 2, a: 1 } });
    const target = fakeStore();
    // Writes and reads back the same data, reordered.
    const reordering: StoreLike = {
      async get<T>(key: string) {
        return target.get<T>(key);
      },
      async set(key: string, value: unknown) {
        const reordered =
          value && typeof value === "object" && !Array.isArray(value)
            ? Object.fromEntries(
                Object.entries(value as Record<string, unknown>).reverse()
              )
            : value;
        return target.set(key, reordered);
      },
      async save() {
        return target.save();
      },
      async clear() {
        return target.clear();
      },
    };

    const outcome = await migrateStoreSplit(
      source,
      async () => reordering,
      ["settings"]
    );

    expect(outcome.moved).toBe(1);
    expect(outcome.retained).toBe(0);
    expect(outcome.safeToRetireSource).toBe(true);
    expect(outcome.failures).toEqual([]);
  });

  it("keeps the source when a write is silently dropped (read-back mismatch)", async () => {
    // A store double that accepts set() but does not retain the value, which
    // is what a truncated disk write looks like from here.
    const liar: StoreLike = {
      async get() {
        return undefined;
      },
      async set() {},
      async save() {},
      async clear() {},
    };
    const source = fakeStore(SAMPLE);

    const outcome = await migrateStoreSplit(
      source,
      async () => liar,
      COLLECTIONS
    );

    expect(outcome.safeToRetireSource).toBe(false);
    expect(source.data).toEqual(SAMPLE);
    expect(outcome.failures.length).toBe(COLLECTIONS.length);
  });

  it("reports a failure when a destination cannot even be opened", async () => {
    // A store that throws on open is the shape of a permission or profile
    // problem, and must be surfaced rather than silently skipping the data.
    const source = fakeStore(SAMPLE);
    const targets = Object.fromEntries(
      COLLECTIONS.map((k) => [k, fakeStore()])
    ) as Record<(typeof COLLECTIONS)[number], ReturnType<typeof fakeStore>>;

    const outcome = await migrateStoreSplit(
      source,
      async (key) => {
        if (key === "dictionary") throw new Error("profile not writable");
        return targets[key as (typeof COLLECTIONS)[number]] ?? null;
      },
      COLLECTIONS
    );

    expect(outcome.safeToRetireSource).toBe(false);
    expect(outcome.failures).toEqual([
      { key: "dictionary", error: "profile not writable" },
    ]);
    expect(source.data).toEqual(SAMPLE);
  });

  it("is a no-op when the source holds nothing", async () => {
    const source = fakeStore({});
    const targets = Object.fromEntries(
      COLLECTIONS.map((k) => [k, fakeStore()])
    ) as Record<(typeof COLLECTIONS)[number], ReturnType<typeof fakeStore>>;

    const outcome = await migrateStoreSplit(
      source,
      destinationsFor(targets),
      COLLECTIONS
    );

    expect(outcome.moved).toBe(0);
    expect(source.data).toEqual({});
    for (const key of COLLECTIONS) {
      expect(targets[key].writes).toHaveLength(0);
    }
  });

  it("does not overwrite a destination that already holds a value", async () => {
    // Models resuming after an earlier build's partial migration: the
    // destination is newer and authoritative, the source is stale.
    const source = fakeStore({
      ...SAMPLE,
      settings: { systemPrompt: "stale" },
    });
    const targets = Object.fromEntries(
      COLLECTIONS.map((k) => [
        k,
        k === "settings"
          ? fakeStore({ settings: { systemPrompt: "current" } })
          : fakeStore(),
      ])
    ) as Record<(typeof COLLECTIONS)[number], ReturnType<typeof fakeStore>>;

    const outcome = await migrateStoreSplit(
      source,
      destinationsFor(targets),
      COLLECTIONS
    );

    expect(targets.settings.data.settings).toEqual({ systemPrompt: "current" });
    expect(targets.settings.writes).toHaveLength(0);
    // The remaining collections still moved, then the source was emptied.
    expect(outcome.moved).toBe(4);
    expect(outcome.safeToRetireSource).toBe(true);
    expect(targets.transcriptions.data.transcriptions).toEqual(
      SAMPLE.transcriptions
    );
  });

  it("treats a null value as absent rather than migrating it", async () => {
    const source = fakeStore({ settings: null, transcriptions: SAMPLE.transcriptions });
    const targets = Object.fromEntries(
      COLLECTIONS.map((k) => [k, fakeStore()])
    ) as Record<(typeof COLLECTIONS)[number], ReturnType<typeof fakeStore>>;

    const outcome = await migrateStoreSplit(
      source,
      destinationsFor(targets),
      COLLECTIONS
    );

    expect(targets.settings.writes).toHaveLength(0);
    expect(outcome.moved).toBe(1);
  });

  it("skips a collection with no destination instead of failing", async () => {
    const source = fakeStore({ settings: SAMPLE.settings, stray: "x" });
    const settings = fakeStore();

    const outcome = await migrateStoreSplit(
      source,
      async (key) => (key === "settings" ? settings : null),
      [...COLLECTIONS, "stray"]
    );

    expect(outcome.moved).toBe(1);
    expect(settings.data.settings).toEqual(SAMPLE.settings);
  });
});