/**
 * storeSplit.ts – moving collections out of the pre-split store file.
 *
 * Split out of persistence.ts, and free of any Tauri import, so the ordering
 * rule that protects user data can be tested directly. The rule exists because
 * the failure it prevents is silent and unrecoverable: emptying the source
 * file before every destination write is confirmed loses a user's settings,
 * transcriptions, chats, and transforms with nothing to restore from.
 *
 * The invariant: **never destroy the source until every destination has been
 * read back and matched.** Any failure leaves the source completely intact and
 * the migration to be retried on the next launch.
 */

/** The subset of the Tauri store API this module needs. */
export interface StoreLike {
  get<T>(key: string): Promise<T | null | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
  clear(): Promise<void>;
}

export type CollectionKey = string;

/** Why one collection could not be written. */
export interface DestinationFailure {
  key: CollectionKey;
  error: string;
}

export interface WriteOutcome {
  /** Collections successfully written and verified. */
  moved: number;
  /** Collections whose data is still only in the source. */
  retained: number;
  /**
   * True when every collection is safely in its destination, so the caller may
   * retire the source. False means the source must be kept for a retry.
   */
  safeToRetireSource: boolean;
  /** Why each unwritten collection failed, for the caller's diagnostics. */
  failures: DestinationFailure[];
}

/**
 * Migrate each collection from a legacy store into its own destination store.
 *
 * `destinations(key)` returns the store a collection should live in, or null
 * when it has no destination. A destination that already holds a value is
 * treated as the newer state and left alone, which makes an interrupted earlier
 * migration resumable rather than destructive.
 */

/**
 * Whether a written value round-tripped intact.
 *
 * JSON text comparison, not `JSON.stringify`: the store layer may re-serialize
 * with different key order or whitespace, which changes the string without
 * changing the data. Comparing parsed structure reports a false mismatch on
 * every successful write, which would make the migration look broken forever
 * and the source file would never be retired.
 */
function equivalent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
  } catch {
    return false;
  }
}

/** Deep clone with object keys in a stable order, for comparison only. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortKeys(src[key]);
    return out;
  }
  return value;
}

export async function migrateStoreSplit(
  source: StoreLike,
  // Async because opening a destination is I/O; the real store is opened
  // lazily so a migration touches only the files it actually needs.
  destinations: (key: CollectionKey) => Promise<StoreLike | null>,
  keys: readonly CollectionKey[]
): Promise<WriteOutcome> {
  const failures: DestinationFailure[] = [];
  const record = (key: CollectionKey, error: unknown) => {
    failures.push({
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  };

  // Read everything before writing anything, so deciding to stop leaves the
  // source untouched rather than half-drained. A failure to even *read* a
  // destination must not be swallowed: that is exactly the case where the
  // write would have failed, and losing it silently would drop the collection.
  const pending: { key: CollectionKey; value: unknown }[] = [];
  for (const key of keys) {
    const value = await source.get(key);
    if (value === undefined || value === null) continue;
    try {
      const dest = await destinations(key);
      if (!dest) continue;
      // A destination that already holds a value is the newer state. Checked
      // before anything is written, so this "already migrated?" probe never
      // runs against a store we have just written to in this same pass.
      const existing = await dest.get(key);
      if (existing !== undefined && existing !== null) continue;
      pending.push({ key, value });
    } catch (err) {
      record(key, err);
    }
  }

  // Write and verify each collection independently, so one bad destination
  // does not strand the rest. Each collection is only counted as moved once it
  // has been read back and matched.
  let moved = 0;
  const written: { key: CollectionKey; value: unknown }[] = [];
  for (const { key, value } of pending) {
    try {
      // Cached per key: the same Store instance is reused for the write and
      // the verification read.
      const dest = await destinations(key);
      if (!dest) throw new Error(`no destination for ${key}`);
      await dest.set(key, value);
      await dest.save();
      const readBack = await dest.get(key);
      if (!equivalent(readBack, value)) {
        throw new Error(`${key} did not read back as written`);
      }
      moved++;
      written.push({ key, value });
    } catch (err) {
      record(key, err);
    }
  }

  const retained = failures.length;
  if (retained > 0) {
    // Source deliberately untouched: some data exists nowhere else.
    return { moved, retained, safeToRetireSource: false, failures };
  }

  await source.clear();
  await source.save();
  return { moved, retained: 0, safeToRetireSource: true, failures };
}