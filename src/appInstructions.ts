/**
 * appInstructions.ts — per-application standing instructions for dictation.
 *
 * The app profiles shipped two hardcoded suffix strings per app
 * (`polishSuffix`, `f10Suffix`) that could not be edited without a code
 * change. A user writing code in an IDE, an email in Outlook, and a commit
 * message in a terminal wants three different behaviours, and only the first
 * two had a sensible default — there was no way to say "keep commit messages
 * lowercase" or "always spell out CLI flags".
 *
 * Enhanced dictation combines global standing instructions with the active
 * application's instruction. A custom app instruction replaces only that
 * application's shipped default; it does not suppress the global rules.
 *
 * An explicit override replaces the default rather than appending to it: once
 * someone has written their own sentence for an app, adding ours to it makes
 * the result unpredictable, which is the opposite of what this feature is for.
 */

import type { AppProfile } from "./appProfiles";
import type { UserSettings } from "./types";

/** Stored overrides, keyed by app id. Empty string means "no override". */
export type AppInstructionMap = Record<string, string>;

function readOverride(settings: UserSettings, appId: string): string {
  const map = (settings.appInstructions ?? {}) as AppInstructionMap;
  const value = map[appId];
  return typeof value === "string" ? value.trim() : "";
}

export function hasAppOverride(settings: UserSettings, appId: string): boolean {
  return readOverride(settings, appId) !== "";
}

export function clearAppOverride(settings: UserSettings, appId: string) {
  const map: AppInstructionMap = { ...((settings.appInstructions ?? {}) as AppInstructionMap) };
  delete map[appId];
  return map;
}

export function setAppOverride(
  settings: UserSettings,
  appId: string,
  value: string,
): AppInstructionMap {
  const map: AppInstructionMap = { ...((settings.appInstructions ?? {}) as AppInstructionMap) };
  const trimmed = value.trim();
  if (trimmed) map[appId] = trimmed;
  else delete map[appId];
  return map;
}

/**
 * The instruction block to use for an application.
 *
 * Global and app-specific instructions are independently labelled so the
 * model can follow both without one silently replacing the other.
 */
export function resolveAppInstructions(
  settings: UserSettings,
  appId: string,
  defaultSuffix: string,
): string {
  const override = readOverride(settings, appId);
  const global = settings.dictationInstructions?.trim() ?? "";
  const application = override || defaultSuffix.trim();
  const sections: string[] = [];
  if (global) sections.push(`STANDING INSTRUCTIONS:\n${global}`);
  if (application) {
    sections.push(`APPLICATION-SPECIFIC INSTRUCTIONS:\n${application}`);
  }
  return sections.join("\n\n");
}

/**
 * What the user would see for an application before saving an edit.
 *
 * Used to seed the editor so the shipped default is discoverable rather than
 * hidden, and to show which applications are customised.
 */
export function appInstructionPreview(
  settings: UserSettings,
  profile: AppProfile,
): { current: string; isOverridden: boolean; defaultText: string } {
  const defaultText = profile.polishSuffix.trim();
  const isOverridden = hasAppOverride(settings, profile.id);
  return {
    current: resolveAppInstructions(settings, profile.id, profile.polishSuffix),
    isOverridden,
    defaultText,
  };
}