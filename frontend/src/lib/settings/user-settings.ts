import { fileService } from "../file-system/file-service";
import { setUserMetadataField, getUserMetadata } from "../file-system/user-metadata";
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
  coloredHeader: boolean;         // false → keep header white instead of tinting with `color`
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
  /** When `sidebarShowCalendarEvents` is on, how far past today to peek.
   *  `0` = show today only (no "Next N days" subsection). */
  sidebarEventsHorizonDays: number;

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
  coloredHeader: true,
  animationType: "rock",
  dateFormat: "MDY",
  timeFormat: "12h",
  telegramNotifications: true,
  confirmDestructiveActions: true,
  sidebarShowTasks: true,
  sidebarShowCalendarEvents: false,
  sidebarEventsHorizonDays: 7,
  hideGoalsFromLab: false,
};

/** Horizon choices surfaced in the Settings → Sidebar selector. */
export const SIDEBAR_HORIZON_CHOICES: Array<{ value: number; label: string }> = [
  { value: 0, label: "Today only" },
  { value: 3, label: "Today + next 3 days" },
  { value: 7, label: "Today + next 7 days" },
  { value: 14, label: "Today + next 14 days" },
  { value: 30, label: "Today + next 30 days" },
];

function settingsPath(username: string): string {
  return `users/${username}/settings.json`;
}

/**
 * Merges a (possibly partial / older-schema) payload from disk with the
 * default settings, dropping unknown tab hrefs and clamping the landing tab
 * to something the user can actually reach.
 */
// Legacy href → current href. The `/experiments` route was renamed to
// `/workbench` (EXPERIMENTS_STANDALONE_PROPOSAL.md); without this map a
// user with `/experiments` in their saved tab list would silently lose
// it on the first load post-rename.
const LEGACY_HREF_RENAMES: Record<string, string> = {
  "/experiments": "/workbench",
};

function migrateHref(href: string): string {
  return LEGACY_HREF_RENAMES[href] ?? href;
}

function normalize(raw: Partial<UserSettings> | null | undefined): UserSettings {
  const merged: UserSettings = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };

  const visibleTabs = (merged.visibleTabs ?? [])
    .map(migrateHref)
    .filter(isValidTabHref);
  // Home is always visible — it's the safe fallback landing tab.
  if (!visibleTabs.includes(HOME_HREF)) visibleTabs.unshift(HOME_HREF);
  merged.visibleTabs = visibleTabs;

  merged.defaultLandingTab = migrateHref(merged.defaultLandingTab);
  if (!isValidTabHref(merged.defaultLandingTab) || !visibleTabs.includes(merged.defaultLandingTab)) {
    merged.defaultLandingTab = HOME_HREF;
  }

  // Clamp the events horizon to a sane range — 0..365 days. A hand-edited
  // settings.json with NaN or a negative number would otherwise break the
  // sidebar's upcoming-events filter.
  const horizonRaw = Number(merged.sidebarEventsHorizonDays);
  merged.sidebarEventsHorizonDays = Number.isFinite(horizonRaw)
    ? Math.max(0, Math.min(365, Math.floor(horizonRaw)))
    : DEFAULT_SETTINGS.sidebarEventsHorizonDays;

  return merged;
}

export async function readUserSettings(username: string): Promise<UserSettings> {
  if (!fileService.isConnected()) return { ...DEFAULT_SETTINGS };
  const raw = await fileService.readJson<Partial<UserSettings>>(settingsPath(username));

  // Seed `color` and `hideGoalsFromLab` from `_user_metadata.json` when
  // they aren't in settings.json yet. Without this, the legacy-migration
  // path (which calls patchUserSettings → writeUserSettings → mirror) would
  // overwrite an existing user's metadata color with DEFAULT_SETTINGS.color
  // the first time they're switched to on a browser that previously held a
  // different user's settings. See the user-switch regression where a
  // user's red color flipped to blue on first login.
  const needsColorFallback = !raw || raw.color === undefined;
  const needsHideFallback = !raw || raw.hideGoalsFromLab === undefined;
  let metaSeed: Partial<UserSettings> = {};
  if (needsColorFallback || needsHideFallback) {
    const meta = await getUserMetadata(username);
    if (meta) {
      metaSeed = {
        ...(needsColorFallback && meta.color ? { color: meta.color } : {}),
        ...(needsHideFallback
          ? { hideGoalsFromLab: meta.hide_goals_from_lab ?? false }
          : {}),
      };
    }
  }

  return normalize({ ...metaSeed, ...(raw ?? {}) });
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
