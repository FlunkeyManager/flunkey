/**
 * whisper.ts — on-device speech-to-text (whisper.cpp + GGML Whisper weights).
 *
 * The engine binary ships with the app; the *model* file is the only thing the
 * user downloads, from this module. Nothing about a recording leaves the PC on
 * this path — which is what makes Flunkey usable with no API key at all.
 *
 * Catalog details mirror `src-tauri/src/whisper.rs`; the Rust side owns the
 * authoritative list and reports what is actually installed.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Voice provider id for the local engine (never a cloud provider). */
export const LOCAL_STT = "local" as const;

export interface LocalModelStatus {
  id: string;
  label: string;
  sizeMib: number;
  ramMb: number;
  note: string;
  installed: boolean;
  installedBytes: number;
  /** Bytes in an orphaned partial download, if one was abandoned. */
  partialBytes: number;
  path: string | null;
}

export interface EngineStatus {
  available: boolean;
  path: string | null;
}

export interface MachineInfo {
  ramTotalGb: number;
  ramFreeGb: number;
  logicalCores: number;
  diskFreeGb: number;
}

export type DownloadStage = "downloading" | "verifying" | "done" | "error";

export interface DownloadProgress {
  id: string;
  received: number;
  total: number;
  bytesPerSec: number;
  stage: DownloadStage;
  error: string | null;
}

/** Prescribed download order — base is the recommended pick. */
export const RECOMMENDED_LOCAL_MODEL = "base";

export function fetchEngineStatus(): Promise<EngineStatus> {
  return invoke<EngineStatus>("whisper_engine_status");
}

export function fetchMachineInfo(): Promise<MachineInfo> {
  return invoke<MachineInfo>("whisper_machine_info");
}

export function fetchModelStatus(): Promise<LocalModelStatus[]> {
  return invoke<LocalModelStatus[]>("whisper_model_status");
}

/** Kicks off a background download; progress arrives as events. */
export function downloadModel(id: string): Promise<void> {
  return invoke<void>("whisper_download_model", { id });
}

export function cancelDownload(): Promise<void> {
  return invoke<void>("whisper_cancel_download");
}

export function deleteModel(id: string): Promise<void> {
  return invoke<void>("whisper_delete_model", { id });
}

/** Subscribe to download progress. Returns an unsubscribe function. */
export function onDownloadProgress(
  handler: (progress: DownloadProgress) => void
): Promise<UnlistenFn> {
  return listen<DownloadProgress>("whisper-download-progress", (event) =>
    handler(event.payload)
  );
}

/**
 * Transcribe a 16 kHz mono WAV on this machine.
 *
 * `language` is an ISO-639-1 code, or "" to let whisper auto-detect.
 * `prompt` carries the user's custom vocabulary so proper nouns survive.
 */
export function transcribeLocal(args: {
  wav: Uint8Array;
  model: string;
  language?: string;
  prompt?: string;
}): Promise<string> {
  // IPC is JSON; base64 keeps a 30 s clip at ~1.3 MB instead of ~4 MB of
  // JSON numbers.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < args.wav.length; i += chunk) {
    binary += String.fromCharCode(...args.wav.subarray(i, i + chunk));
  }
  return invoke<string>("whisper_transcribe", {
    wavBase64: btoa(binary),
    model: args.model,
    language: args.language ?? "",
    prompt: args.prompt ?? "",
  });
}

export function formatMiB(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  const mib = bytes / (1024 * 1024);
  if (mib >= 1024) return `${(mib / 1024).toFixed(1)} GB`;
  return `${mib < 10 ? mib.toFixed(1) : Math.round(mib)} MB`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return "";
  return `${formatMiB(bytesPerSec)}/s`;
}
