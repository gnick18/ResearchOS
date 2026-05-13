import { fileService } from "../file-system/file-service";
import { setUserMetadataField } from "../file-system/user-metadata";
import type { ViewMode } from "../types";
import type { AnimationType } from "../store";
import { ALL_TAB_HREFS, HOME_HREF, isValidTabHref } from "../nav";

export type CalendarViewMode = "month" | "week" | "day";
export type DateFormat = "MDY" | "DMY" | "YMD";
export type TimeFormat = "12h" | "24h";

export interface UserSettings {
  schemaVersion: 1;

  // Nav / layout
  visibleTabs: string[];          // hrefs from NAV_ITEMS — Home is always shown regardless of contents
  defaultLandingTab: string;      // href; falls back to HOME_HREF if not visible

  // View defaults (mirror Zustand fields, but disk-backed)
  defaultGanttViewMode: ViewMode;
  defaultCalendarViewMode: CalendarViewMode;
  showSharedByDefault: boolean;

  // Personalization
  displayName: string | null;     // null → use folder name
  color: string;                  // hex; mirrored to _user_metadata.json
  animationType: AnimationType;

  // Formatting
  dateFormat: DateFormat;
  timeFormat: TimeFormat;

  // Behavior
  telegramNotifications: boolean;
  confirmDestructiveActions: boolean;

  // Left sidebar (the one shown on every page except /calendar, which has
  // its own dedicated sidebar). Independent toggles so the user can pick
  // "tasks only", "calendar events only", or both stacked.
  sidebarShowTasks: boolean;
  sidebarShowCalendarEvents: boolean;

  // Per-user opt-out (mirrored to _user_metadata.json so the existing lab readers keep working)
  hideGoalsFromLab: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  schemaVersion: 1,
  visibleTabs: [...ALL_TAB_HREFS],
  defaultLandingTab: HOME_HREF,
  defaultGanttViewMode: "2week",
  defaultCalendarViewMode: "month",
  showSharedByDefault: true,
  displayName: null,
  color: "#3b82f6",
  animationType: "rock",
  dateFormat: "MDY",
  timeFormat: "12h",
  telegramNotifications: true,
  confirmDestructiveActions: true,
  sidebarShowTasks: true,
  sidebarShowCalendarEvents: false,
  hideGoalsFromLab: false,
};

function settingsPath(username: string): string {
  return `users/${username}/settings.json`;
}

/**
 * Merges a (possibly partial / older-schema) payload from disk with the
 * default settings, dropping unknown tab hrefs and clamping the landing tab
 * to something the user can actually reach.
 */
function normalize(raw: Partial<UserSettings> | null | undefined): UserSettings {
  const merged: UserSettings = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };

  const visibleTabs = (merged.visibleTabs ?? []).filter(isValidTabHref);
  // Home is always visible — it's the safe fallback landing tab.
  if (!visibleTabs.includes(HOME_HREF)) visibleTabs.unshift(HOME_HREF);
  merged.visibleTabs = visibleTabs;

  if (!isValidTabHref(merged.defaultLandingTab) || !visibleTabs.includes(merged.defaultLandingTab)) {
    merged.defaultLandingTab = HOME_HREF;
  }

  return merged;
}

export async function readUserSettings(username: string): Promise<UserSettings> {
  if (!fileService.isConnected()) return { ...DEFAULT_SETTINGS };
  const raw = await fileService.readJson<Partial<UserSettings>>(settingsPath(username));
  return normalize(raw);
}

export async function userSettingsFileExists(username: string): Promise<boolean> {
  if (!fileService.isConnected()) return false;
  return fileService.fileExists(settingsPath(username));
}

export async function writeUserSettings(username: string, settings: UserSettings): Promise<void> {
  if (!fileService.isConnected()) return;
  const normalized = normalize(settings);
  await fileService.writeJson(settingsPath(username), normalized);

  // Mirror the few fields that legacy readers still look up in _user_metadata.json.
  try {
    await setUserMetadataField(username, "color", normalized.color);
    await setUserMetadataField(username, "hide_goals_from_lab", normalized.hideGoalsFromLab);
  } catch (err) {
    console.warn("[user-settings] Failed to mirror to _user_metadata.json", err);
  }
}

export async function patchUserSettings(
  username: string,
  patch: Partial<UserSettings>,
): Promise<UserSettings> {
  const current = await readUserSettings(username);
  const next = normalize({ ...current, ...patch });
  await writeUserSettings(username, next);
  return next;
}
