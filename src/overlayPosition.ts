import { invoke } from "@tauri-apps/api/core";
import type { UserSettings } from "./types";

export type OverlayLayoutSettings = Pick<
  UserSettings,
  | "f9OverlayPosition"
  | "f9OverlayFreePosition"
  | "f9OverlayFreeX"
  | "f9OverlayFreeY"
  | "f9OverlayFreeWidth"
  | "f9OverlayFreeHeight"
>;

export async function applyOverlayLayout(settings: OverlayLayoutSettings) {
  await invoke("set_overlay_layout", {
    position: settings.f9OverlayPosition,
    free: settings.f9OverlayFreePosition,
    x: settings.f9OverlayFreeX,
    y: settings.f9OverlayFreeY,
    width: settings.f9OverlayFreeWidth,
    height: settings.f9OverlayFreeHeight,
  });
}
