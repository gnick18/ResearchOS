// VCP R1 trash MVP notes (2026-05-26): settings extension for the
// trash cleanup window.
//
// OQ1 locks the default to 30 days. The Settings → History & Trash
// section exposes a 7 / 30 / 90 / Never radio. The value lives on
// `_user_settings.json` as `trash_cleanup_days`:
//   - null      → Never
//   - 7|30|90   → that many days
//
// We keep the new field on a parallel interface (`UserSettingsWithTrash`)
// rather than baking it into the base `UserSettings` shape so the trash
// module stays independent of the broader settings surface. The
// `patchUserSettings` / `readUserSettings` round-trip preserves unknown
// fields by virtue of the `{ ...DEFAULT_SETTINGS, ...raw }` spread in
// `normalize`, so adding a field via this module needs no edit to
// `user-settings.ts` itself. A future R3 schema bump can fold the field
// into the canonical interface.

import { DEFAULT_CLEANUP_DAYS } from "./trash-types";

/** Field added to the existing `_user_settings.json` shape. The base
 *  `UserSettings` normalization in `lib/settings/user-settings.ts`
 *  preserves unknown keys, so we extend the type-level shape here. */
export interface UserSettingsWithTrash {
  /** Number of days to keep records in trash before auto-cleanup.
   *  `null` = Never (manual cleanup only). Missing = use the default. */
  trash_cleanup_days?: number | null;
}

/** Discrete options surfaced in the Settings radio. */
export const TRASH_CLEANUP_OPTIONS: Array<{
  value: number | null;
  label: string;
}> = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: null, label: "Never" },
];

/** Pull the cleanup-days setting off a settings object, with the
 *  proposal default applied when missing or invalid. Accepts the
 *  combined-shape so callers can pass the result of `readUserSettings`
 *  directly when they've cast it. */
export function getUserTrashCleanupDays(
  settings: UserSettingsWithTrash | null | undefined,
): number | null {
  if (!settings) return DEFAULT_CLEANUP_DAYS;
  const raw = settings.trash_cleanup_days;
  // Explicit null = Never; explicit numeric = use it; anything else =
  // proposal default.
  if (raw === null) return null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_CLEANUP_DAYS;
}
