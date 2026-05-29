import { fileService } from "../file-system/file-service";
import {
  setUserMetadataField,
  setUserMetadataColors,
  getUserMetadata,
} from "../file-system/user-metadata";
import type { ViewMode } from "../types";
import type { AnimationType } from "../store";
import { ALL_TAB_HREFS, HOME_HREF, isValidTabHref } from "../nav";

export type CalendarViewMode = "month" | "week" | "day";
export type DateFormat = "MDY" | "DMY" | "YMD";
export type TimeFormat = "12h" | "24h";

// Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
// per-user persistence of the Lab Overview widget canvas + customizable
// sidebar (proposal §3, §3g). Stored in users/<u>/settings.json under
// the `lab_overview_layout` key — additive, optional; missing payload
// resolves to the account-type-default layout at read time (see
// `frontend/src/lib/lab-overview/layout-persistence.ts`).
//
// Schema is versioned so future catalog additions can run a one-way
// migration that appends the new widget at the bottom of `canvas` (or
// `sidebar.order`) without trashing the user's custom positions. Unknown
// widget IDs (e.g. a widget that got renamed or removed) are dropped at
// read time with a console.warn; the read helper still resolves to a
// usable shape.
/**
 * Widget canvas Phase A (Phase A redispatch manager, 2026-05-23):
 * the persisted layout shape switched from the R2 free-grid map to a
 * simple ordered list of widget IDs per surface.
 *
 * v2 (current) — `LabOverviewLayout`:
 *   { version: 2, widgetOrder: { canvas: string[], sidebar: string[] } }
 *
 * v1 (legacy, migrated at read time) — `LabOverviewLayoutV1`:
 *   { version: 1, canvas: { [id]: { x, y, w, h } },
 *                 sidebar: { order, hidden } }
 *
 * Both shapes can exist on disk; `migrateLayoutToV2` in
 * `frontend/src/lib/lab-overview/layout-persistence.ts` upgrades v1
 * payloads on read. The `LabOverviewLayout` union type below covers
 * both so consumers (mostly the layout-persistence module) can hold a
 * reference to either while still being type-checked.
 */
export interface LabOverviewWidgetPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Legacy v1 free-grid shape. Still appears on disk for users who
 *  haven't visited the Lab Overview surface since the Phase A change.
 *  Migrated at read time; never written. */
export interface LabOverviewLayoutV1 {
  version: 1;
  canvas: Record<string, LabOverviewWidgetPosition>;
  sidebar: {
    order: string[];
    hidden: string[];
  };
}

/**
 * Per-instance widget configuration (weekly-goals widget, 2026-05-29).
 *
 * PERSISTED-LAYOUT-SHAPE CHANGE — additive + optional. A placed widget can
 * carry a small config object persisted alongside the canvas layout. The
 * first (and currently only) field is `pinnedMember`: when set, a widget
 * that supports a single-member mode (e.g. the Trainee notes + weekly goals
 * widget) shows that ONE member directly instead of the roster step. Unset
 * = the widget's default (everyone / roster) mode.
 *
 * Old layouts that predate this field simply have no `widgetConfig` map and
 * read as "every widget in default mode" — no migration needed.
 */
export interface WidgetInstanceConfig {
  /** When set, the widget is pinned to this one member's username. */
  pinnedMember?: string;
}

/** Current v2 ordered-list shape. Written by every Phase A mutator. */
export interface LabOverviewLayoutV2 {
  version: 2;
  widgetOrder: {
    canvas: string[];
    sidebar: string[];
  };
  /**
   * Per-instance widget config, keyed by widget id (weekly-goals widget,
   * 2026-05-29). Optional + additive: absent map = every widget in its
   * default mode. Keyed by widget id (the same id used in `widgetOrder`)
   * because the canvas tracks one placed instance per widget id today.
   * Entries for ids not in `widgetOrder` are harmless and ignored.
   */
  widgetConfig?: Record<string, WidgetInstanceConfig>;
}

/** The canonical type consumers reference. Always v2 when read through
 *  `layout-persistence.readResolvedLayout`. Persisted payloads can
 *  still be v1 on disk; settings reader hands them through unchanged
 *  and the layout-persistence module migrates on the fly. */
export type LabOverviewLayout = LabOverviewLayoutV2;
// Lab Head Phase 1 (2026-05-23): per-user account role inside a shared lab.
// `member` = regular lab researcher (the existing behavior, defaults here).
// `lab_head` = PI / principal investigator; reveals the Lab Overview surface
// and (in Phase 2+) gains audit + soft-write capabilities. This is
// orthogonal to `FeaturePicks.account_type` ("solo" | "lab") which captures
// the onboarding-wizard choice of workspace shape; this field captures the
// user's role *within* a lab and is meaningful only for lab accounts.
export type AccountType = "member" | "lab_head";

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
  /** Optional second hex for a 2-stop user gradient. `null` → solid (the
   *  default). Mirrored to `_user_metadata.json:color_secondary`. */
  colorSecondary: string | null;
  coloredHeader: boolean;         // false → keep header white instead of tinting with `color`
  animationType: AnimationType;
  /** When off, suppresses the BeakerBot daily hello wave AND the BeakerBot
   *  streak-celebration scenes (mouseWave / eureka / ladder / skateboard,
   *  etc.). Default true (opt-out). This is distinct from `animationType`
   *  above (the per-task-completion celebration the user picks) and from
   *  the v4 onboarding tour's guided BeakerBot cursor, neither of which
   *  this flag touches. Read by CelebrationManager. */
  beakerBotAnimations: boolean;

  // Formatting
  dateFormat: DateFormat;
  timeFormat: TimeFormat;

  // Behavior
  telegramNotifications: boolean;
  /** When on, the user has opted into the encrypted-backup auto-reconnect
   *  path. The actual encrypted sidecar lives at
   *  users/<u>/_telegram-encrypted.json — this flag just records the
   *  user's intent so the polling tab knows whether to prompt for the
   *  password on startup when the pairing file is missing. */
  telegramAutoReconnect: boolean;
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

  // Lab Head Phase 1: role inside the lab. Defaults to `member` for every
  // existing user via plain object spread in `normalize()`. `lab_head`
  // reveals the Lab Overview top-nav entry (renamed from "Lab Inbox" +
  // promoted out of the sidebar 2026-05-23) and (Phase 2+) audit + soft-write
  // surfaces. Multiple users in a lab can hold `lab_head` (co-PIs are
  // allowed by design, per Grant's 2026-05-23 decisions).
  account_type: AccountType;

  // PI Home migration (pi-home-migration, 2026-05-29): for lab_head (PI)
  // accounts the Home page is redundant with Lab Overview, so the Home
  // top-nav tab is hidden by default and the PI lands on Lab Overview
  // instead. This flag is the opt-back-in: when `true`, a lab head sees
  // the Home tab again and can land on it. Default `false` for lab heads.
  //
  // The field has no effect for `member` accounts — members always keep
  // the Home tab and their existing landing behavior regardless of this
  // value (AppShell + the landing-route logic both gate the hide on
  // `account_type === "lab_head"`). Default below is `false`, which is
  // also the correct value for a brand-new member: it simply never gates
  // their Home tab. A member who later switches to PI inherits the
  // hidden-by-default behavior until they flip this on.
  showHomeForLabHead: boolean;

  // When on, the app makes zero calls to its own server proxies
  // (`/api/calendar-feed`, `/api/telegram-file`). Direct browser → Telegram
  // polling continues because that talks to api.telegram.org directly.
  offlineMode: boolean;

  // Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
  // optional, additive. When absent, the layout-persistence reader fills
  // in the account-type-appropriate default. When present, unknown
  // widget IDs are dropped at read time and new catalog widgets append
  // at the end of canvas / sidebar. See `LabOverviewLayout` above.
  //
  // Widget canvas Phase A (Phase A redispatch manager, 2026-05-23): the
  // field type accepts either v1 (legacy free-grid) or v2 (current
  // ordered lists) so disk payloads from before the migration still
  // type-check. `readResolvedLayout` migrates v1 → v2 on the fly.
  lab_overview_layout?: LabOverviewLayout | LabOverviewLayoutV1;

  // Home canvas migration (Home canvas migration manager, 2026-05-23):
  // separate per-user persistence for the new /home widget canvas.
  // Reuses the same v2 shape as `lab_overview_layout` so the
  // SnapshotCanvas-style mechanics can be reused. Independent field so
  // the two pages' customizations stay decoupled — a lab head can have
  // a dense PI dashboard on /lab-overview AND a quieter personal
  // canvas on /home. Optional; absent → account-type default kicks in
  // (see `defaultHomeLayoutFor` in `lab-overview/layout-persistence.ts`).
  //
  // Migration safety: members who previously customized
  // `lab_overview_layout` keep that payload on disk after this
  // migration — it just becomes orphaned (members no longer have
  // /lab-overview). New `home_layout` starts unset; defaults apply.
  home_layout?: LabOverviewLayout | LabOverviewLayoutV1;
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
  colorSecondary: null,
  coloredHeader: true,
  animationType: "rock",
  beakerBotAnimations: true,
  dateFormat: "MDY",
  timeFormat: "12h",
  telegramNotifications: true,
  telegramAutoReconnect: false,
  confirmDestructiveActions: true,
  sidebarShowTasks: true,
  sidebarShowCalendarEvents: false,
  sidebarEventsHorizonDays: 7,
  hideGoalsFromLab: false,
  offlineMode: false,
  account_type: "member",
  showHomeForLabHead: false,
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

  // Lab Head Phase 1: clamp `account_type` to the accepted union so a
  // hand-edited settings.json with a garbage value falls back to `member`
  // (the safe default — never accidentally elevate someone to lab_head).
  if (merged.account_type !== "member" && merged.account_type !== "lab_head") {
    merged.account_type = "member";
  }

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
  const needsSecondaryFallback = !raw || raw.colorSecondary === undefined;
  const needsHideFallback = !raw || raw.hideGoalsFromLab === undefined;
  let metaSeed: Partial<UserSettings> = {};
  if (needsColorFallback || needsSecondaryFallback || needsHideFallback) {
    const meta = await getUserMetadata(username);
    if (meta) {
      metaSeed = {
        ...(needsColorFallback && meta.color ? { color: meta.color } : {}),
        ...(needsSecondaryFallback
          ? { colorSecondary: meta.color_secondary ?? null }
          : {}),
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
  // The two color fields go through `setUserMetadataColors` so they land in
  // ONE read-modify-write cycle — without that, two sequential field writes
  // could let the primary land on disk while the secondary is dropped by a
  // concurrent reader (the Settings save handler relies on this atomicity
  // when the user picks a new gradient).
  try {
    await setUserMetadataColors(
      username,
      normalized.color,
      normalized.colorSecondary,
    );
    await setUserMetadataField(username, "hide_goals_from_lab", normalized.hideGoalsFromLab);
  } catch (err) {
    console.warn("[user-settings] Failed to mirror to _user_metadata.json", err);
  }

  // Fire the success bus so live readers (e.g. `useAccountType`) can
  // refresh without waiting for a route change. See `onUserSettingsWritten`
  // docblock below for the full root-cause writeup. (top-nav visibility
  // fix manager, 2026-05-27)
  dispatchUserSettingsWritten({ username, next: normalized });
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

// ---------------------------------------------------------------------------
// User-settings success bus (top-nav visibility fix manager, 2026-05-27)
//
// Mirrors `onSidecarWritten` in `lib/onboarding/sidecar.ts`. Hooks like
// `useAccountType` previously read on mount + username change only; the
// Settings page's `update({ account_type })` and onboarding Q1c's new
// bridge to `_user_settings.account_type` both write without bumping the
// hook's local state. Subscribers receive the full normalized next
// settings object so they don't have to re-read disk (a follow-up write
// could otherwise read past this snapshot).
//
// The dispatch is fire-and-forget; subscriber errors are logged but
// never bubble so a misbehaving subscriber doesn't break the write
// path. Use `_clearUserSettingsWrittenSubscribersForTest` in vitest
// `beforeEach` hooks to keep tests isolated.
// ---------------------------------------------------------------------------

export interface UserSettingsWrittenEvent {
  username: string;
  next: UserSettings;
}

type UserSettingsWrittenCallback = (event: UserSettingsWrittenEvent) => void;

const userSettingsWrittenSubscribers = new Set<UserSettingsWrittenCallback>();

export function onUserSettingsWritten(
  callback: UserSettingsWrittenCallback,
): () => void {
  userSettingsWrittenSubscribers.add(callback);
  return () => {
    userSettingsWrittenSubscribers.delete(callback);
  };
}

export function _clearUserSettingsWrittenSubscribersForTest(): void {
  userSettingsWrittenSubscribers.clear();
}

function dispatchUserSettingsWritten(event: UserSettingsWrittenEvent): void {
  for (const sub of [...userSettingsWrittenSubscribers]) {
    try {
      sub(event);
    } catch (err) {
      console.error("[user-settings] written-bus subscriber threw", err);
    }
  }
}
