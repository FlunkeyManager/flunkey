/**
 * openrouter.ts — Dynamic OpenRouter model catalog.
 *
 * OpenRouter ships 400+ models with constant churn (especially the free
 * roster), so model ids are NEVER hardcoded as the source of truth. The
 * public models endpoint needs no key; results are cached on disk with a
 * 24h TTL and served stale-while-revalidate so the UI never waits on the
 * network. `OPENROUTER_MODELS` in types.ts remains as the offline fallback.
 */

import { load } from "@tauri-apps/plugin-store";

export interface OpenRouterCatalogModel {
  id: string;
  name: string;
  contextLength: number;
  inputModalities: string[];
  /** USD per 1M prompt tokens (NaN when unpublished). */
  promptPer1M: number;
  /** USD per 1M completion tokens (NaN when unpublished). */
  completionPer1M: number;
  /** True when prompt AND completion price are exactly 0. */
  free: boolean;
  created: number;
}

export interface OpenRouterCatalog {
  updatedAt: number;
  models: OpenRouterCatalogModel[];
}

export const OPENROUTER_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const CATALOG_STORE = "openrouter-catalog.json";
const MODELS_URL = "https://openrouter.ai/api/v1/models?output_modalities=text";
const KEY_INFO_URL = "https://openrouter.ai/api/v1/auth/key";

function toFiniteNumber(v: unknown): number {
  const n =
    typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : NaN;
}

function normalizeModel(raw: unknown): OpenRouterCatalogModel | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  // Text-to-text only: skip image/audio/embedding models even if the
  // server-side filter ever loosens.
  const out = (r.architecture as { output_modalities?: unknown } | undefined)
    ?.output_modalities;
  if (!Array.isArray(out) || out.length !== 1 || out[0] !== "text") return null;
  const pricing = (r.pricing ?? {}) as Record<string, unknown>;
  const prompt = toFiniteNumber(pricing.prompt);
  const completion = toFiniteNumber(pricing.completion);
  const contextLength = toFiniteNumber(r.context_length);
  const created = toFiniteNumber(r.created);
  const architecture = r.architecture;
  const input = architecture && typeof architecture === "object"
    ? (architecture as Record<string, unknown>).input_modalities
    : undefined;
  return {
    id: r.id,
    name:
      typeof r.name === "string" && r.name.trim() ? r.name.trim() : r.id,
    contextLength: Number.isFinite(contextLength) ? contextLength : 0,
    inputModalities: Array.isArray(input)
      ? input.filter((item): item is string => typeof item === "string")
      : ["text"],
    promptPer1M: Number.isFinite(prompt) ? prompt * 1e6 : NaN,
    completionPer1M: Number.isFinite(completion) ? completion * 1e6 : NaN,
    free: prompt === 0 && completion === 0,
    created: Number.isFinite(created) ? created : 0,
  };
}

/** Fetch the live catalog (public endpoint, no key). Free-first sorted. */
export async function fetchOpenRouterCatalog(): Promise<OpenRouterCatalogModel[]> {
  const res = await fetch(MODELS_URL);
  if (!res.ok) throw new Error(`Models error ${res.status}`);
  const data: unknown = await res.json();
  const list = (data as { data?: unknown })?.data;
  if (!Array.isArray(list)) throw new Error("Models returned no list");
  const models: OpenRouterCatalogModel[] = [];
  for (const raw of list) {
    const m = normalizeModel(raw);
    if (m) models.push(m);
  }
  // Pin the free router + free models first, then alphabetical. Stable order
  // keeps the picker predictable between refreshes.
  const rank = (m: OpenRouterCatalogModel) =>
    m.id === "openrouter/free" ? 0 : m.free ? 1 : 2;
  models.sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)
  );
  return models;
}

/* ── Disk cache (own store file — never rewritten by settings saves) ── */

let catalogStore: Awaited<ReturnType<typeof load>> | null = null;

async function getCatalogStore() {
  if (!catalogStore) {
    catalogStore = await load(CATALOG_STORE, {
      defaults: {},
      autoSave: true,
    });
  }
  return catalogStore;
}

export async function loadCatalogCache(): Promise<OpenRouterCatalog | null> {
  try {
    const store = await getCatalogStore();
    const cached = (await store.get<OpenRouterCatalog>(
      "catalog"
    )) as OpenRouterCatalog | null;
    if (!cached || !Array.isArray(cached.models) || !cached.updatedAt) {
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

export async function saveCatalogCache(
  catalog: OpenRouterCatalog
): Promise<void> {
  const store = await getCatalogStore();
  await store.set("catalog", catalog);
  await store.save().catch(() => {});
}

export async function clearCatalogCache(): Promise<void> {
  try {
    const store = await getCatalogStore();
    await store.clear();
    await store.save().catch(() => {});
  } catch {
    // Catalog is public data — wipe must never fail because of it.
  }
}

export function isCatalogStale(
  updatedAt: number | null | undefined,
  now = Date.now()
): boolean {
  if (!updatedAt) return true;
  return now - updatedAt > OPENROUTER_CATALOG_TTL_MS;
}

/* ── Key validation (on demand only — result cached per key, never persisted) ── */

export interface OpenRouterKeyStatus {
  ok: boolean;
  label?: string;
  error?: string;
}

const keyStatusCache = new Map<string, OpenRouterKeyStatus>();

export async function validateOpenRouterKey(
  apiKey: string
): Promise<OpenRouterKeyStatus> {
  const key = apiKey.trim();
  if (!key) return { ok: false, error: "Empty key" };
  const cached = keyStatusCache.get(key);
  if (cached) return cached;
  const fail = (error: string): OpenRouterKeyStatus => {
    const s = { ok: false, error };
    keyStatusCache.set(key, s);
    return s;
  };
  try {
    const res = await fetch(KEY_INFO_URL, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      return fail(
        res.status === 401 || res.status === 403
          ? "Invalid key"
          : `Error ${res.status}`
      );
    }
    const data: unknown = await res.json();
    const label = (data as { data?: { label?: unknown } })?.data?.label;
    const s: OpenRouterKeyStatus = {
      ok: true,
      label: typeof label === "string" && label ? label : undefined,
    };
    keyStatusCache.set(key, s);
    return s;
  } catch {
    return fail("Network error");
  }
}

/**
 * Catalog for hot paths (fallback selection). Reads the on-disk cache first
 * so choosing a fallback never adds a network round-trip to a voice flow,
 * and only reaches out when nothing is cached yet.
 */
export async function peekCatalog(): Promise<OpenRouterCatalogModel[]> {
  const cached = await loadCatalogCache();
  if (cached?.models?.length) {
    if (isCatalogStale(cached.updatedAt)) {
      // Refresh in the background; today's answer is good enough.
      void fetchOpenRouterCatalog()
        .then(async (models) => {
          await saveCatalogCache({ updatedAt: Date.now(), models });
        })
        .catch(() => {});
    }
    return cached.models;
  }
  try {
    return await fetchOpenRouterCatalog();
  } catch {
    return [];
  }
}

/** Display helpers */

export function formatPrice(per1M: number): string {
  if (!Number.isFinite(per1M)) return "price n/a";
  if (per1M === 0) return "FREE";
  return `$${per1M < 1 ? per1M.toFixed(2) : per1M.toFixed(1)}/1M`;
}

export function formatContext(contextLength: number): string {
  if (!contextLength || contextLength <= 0) return "";
  if (contextLength >= 1_000_000) {
    const m = contextLength / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  return `${Math.round(contextLength / 1000)}K`;
}

export function catalogAgeLabel(updatedAt: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - updatedAt) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function supportsOpenRouterImages(
  modelId: string,
  catalog: OpenRouterCatalogModel[]
): boolean {
  // The free-models router picks an endpoint per request, so its catalog
  // entry says nothing about image support. Let OpenRouter route it —
  // `provider.require_parameters: true` guarantees the endpoint it picks can
  // actually accept the image, and the auto-fallback covers a dead end.
  if (modelId === "openrouter/free") return true;
  const model = catalog.find((entry) => entry.id === modelId);
  if (model?.inputModalities?.includes("image")) return true;
  if (model) return false;
  return [
    "anthropic/claude-3.5-sonnet",
    "openai/gpt-4o",
    "google/gemini-2.5-flash",
  ].includes(modelId);
}

/**
 * Choose a fallback model for a primary, or "" when nothing sensible exists.
 *
 * Priority: same price tier first (a free model must not silently escalate to
 * a paid one), then the `:free` variants, then any vision match when the
 * primary takes images — so a screenshot turn can still be served.
 */
export function pickOpenRouterFallback(
  primaryId: string,
  catalog: OpenRouterCatalogModel[],
  options: { needsVision?: boolean } = {}
): string {
  const primary = catalog.find((m) => m.id === primaryId);
  if (!catalog.length) return "";

  // The free router is the fallback of last resort: it can always serve
  // *something*, so never pick it ahead of a concrete model.
  const isRouter = (id: string) => id === "openrouter/free";
  if (isRouter(primaryId)) return "";

  const candidates = catalog.filter(
    (m) => m.id !== primaryId && !isRouter(m.id) && m.inputModalities?.includes("image") !== false
  );
  if (!candidates.length) return "";

  // Vision turns need a model that can actually read the image.
  const usable = options.needsVision
    ? candidates.filter((m) => m.inputModalities?.includes("image"))
    : candidates;
  const pool = usable.length ? usable : [];

  if (primary) {
    const sameTier = pool.find((m) => m.free === primary.free);
    if (sameTier) return sameTier.id;
  }
  const free = pool.find((m) => m.free);
  if (free) return free.id;
  return pool[0]?.id ?? "";
}
