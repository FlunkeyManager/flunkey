/**
 * ollama.ts — local models through Ollama's OpenAI-compatible API.
 *
 * Ollama serves `/v1/chat/completions` (streaming + vision) and accepts any
 * bearer value for the key. Model discovery uses the native `/api/tags`
 * endpoint because it carries `capabilities` ("vision", "tools", …) and the
 * download size, neither of which `/v1/models` exposes.
 */

import { invoke } from "@tauri-apps/api/core";
import { getOllamaBaseUrl, type UserSettings } from "./types";

export interface OllamaModel {
  id: string;
  /** Download size in bytes (0 when unknown). */
  size: number;
  vision: boolean;
  tools: boolean;
}

function normalizeBaseUrl(baseUrl: string): string {
  const raw = baseUrl.trim() || "http://localhost:11434";
  return raw.replace(/\/+$/, "");
}

/** Port from a base URL so the Rust side can target the right listener. */
export function ollamaPort(baseUrl: string): number {
  try {
    const url = new URL(normalizeBaseUrl(baseUrl));
    if (url.port) return Number(url.port);
    return url.protocol === "https:" ? 443 : 11434;
  } catch {
    return 11434;
  }
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  const gb = bytes / 1e9;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1e6;
  return `${mb < 100 ? Math.round(mb) : mb.toFixed(0)} MB`;
}

export function isOllamaVisionModel(
  models: OllamaModel[],
  modelId: string
): boolean {
  return models.some((m) => m.id === modelId && m.vision);
}

/** Pull installed models out of `/api/tags`. Embedding models are dropped. */
export function normalizeOllamaModels(data: unknown): OllamaModel[] {
  const list = (data as { models?: unknown })?.models;
  if (!Array.isArray(list)) throw new Error("Ollama returned an invalid model list");
  const out: OllamaModel[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.name === "string" ? r.name.trim() : "";
    if (!id) continue;
    const capabilities = Array.isArray(r.capabilities)
      ? r.capabilities.filter((c): c is string => typeof c === "string")
      : [];
    const families = (r.details as { families?: unknown } | undefined)?.families;
    const familyList = Array.isArray(families)
      ? families.filter((f): f is string => typeof f === "string")
      : [];
    const size = typeof r.size === "number" ? r.size : 0;
    // Older Ollama builds omit `capabilities`; fall back to known vision archs.
    const vision =
      capabilities.includes("vision") ||
      familyList.some((f) => /clip|vision|mllama|llava|moondream|minicpm|gemma3|qwen2\.5vl|qwen3-vl/i.test(f));
    if (!capabilities.includes("completion") && !capabilities.includes("tools") && capabilities.length > 0) {
      // Embedding/rerank-only model — nothing Flunkey can do with it.
      continue;
    }
    out.push({
      id,
      size,
      vision,
      tools: capabilities.includes("tools"),
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  if (out.length === 0) throw new Error("No Ollama models installed — run `ollama pull <model>`");
  return out;
}

export async function fetchOllamaModels(
  baseUrl: string,
  signal?: AbortSignal
): Promise<OllamaModel[]> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/tags`, { signal });
  if (!res.ok) throw new Error(`Ollama error ${res.status}`);
  return normalizeOllamaModels(await res.json());
}

/** Live check used by the Models page "Connect" button. */
export async function checkOllama(
  baseUrl: string
): Promise<{ ok: boolean; models?: OllamaModel[]; error?: string }> {
  try {
    const models = await fetchOllamaModels(baseUrl);
    return { ok: true, models };
  } catch (e) {
    const message =
      e instanceof TypeError
        ? "Can't reach Ollama — is it running?"
        : e instanceof Error
          ? e.message
          : "Connection error";
    return { ok: false, error: message };
  }
}

/** Ask the Rust side to launch the local Ollama server. */
export async function startOllamaServer(): Promise<{
  ok: boolean;
  launched?: string;
  error?: string;
}> {
  try {
    const launched = await invoke<string>("start_ollama");
    return { ok: true, launched };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not start Ollama.",
    };
  }
}

/**
 * Poll until the server answers. Ollama's tray app needs a few seconds to
 * boot its runtime before /api/tags responds.
 */
export async function waitForOllama(
  baseUrl: string,
  timeoutMs = 30_000
): Promise<OllamaModel[] | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await fetchOllamaModels(baseUrl);
    } catch {
      // keep waiting
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return null;
}

/** Stop the local server. Only the process owning the port is terminated. */
export async function stopOllamaServer(
  baseUrl: string
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const message = await invoke<string>("stop_ollama", {
      port: ollamaPort(baseUrl),
    });
    return { ok: true, message };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not stop Ollama.",
    };
  }
}

/** OpenAI-compatible base for chat calls (Ollama ignores the key). */
export function ollamaChatBase(settings: UserSettings): string {
  return `${getOllamaBaseUrl(settings)}/v1`;
}
