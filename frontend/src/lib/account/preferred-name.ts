// Persist the user's preferred / greeting name ("call me Grant").
//
// Writes to TWO places so the name is both immediately usable AND durable across
// folders + devices:
//   1. the folder-local settings.json slot (preferredName), so the greeting
//      surfaces (the welcome-back splash, BeakerBot) can read it synchronously in
//      the current folder, and
//   2. the account-scoped E2E blob, so the preference follows the user to every
//      other folder + device they sign in from. The account write is flag-guarded
//      and best-effort, so it is a clean no-op when account settings are off.
//
// Called by the onboarding "what do you like to be called?" step. The actual
// resolution rule (preferred name wins over the honorific-stripped first name)
// lives in lib/greeting/greeting-name.ts.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { patchUserSettings } from "@/lib/settings/user-settings";
import { isAccountSettingsEnabled } from "./account-settings-config";
import {
  fetchAccountSettings,
  scheduleAccountSettingsWrite,
} from "./account-settings";

/**
 * Normalize a raw preferred-name input into the stored value. A blank / whitespace
 * input clears the preference (null), so a user can remove it by emptying the box.
 */
export function normalizePreferredName(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Save the preferred name for the given user. Best-effort and non-throwing, so the
 * onboarding step never hard-fails on a write hiccup (the name is editable later in
 * Settings). Returns { ok } and never rejects.
 *
 * `username` may be empty when no folder is connected yet; in that case the
 * folder-local write is skipped and only the account-scoped write (when the flag is
 * on) persists the name.
 */
export async function savePreferredName(
  username: string,
  rawName: string,
): Promise<{ ok: boolean }> {
  const value = normalizePreferredName(rawName);

  // 1. Folder-local slot, so the greeting reads it synchronously in this folder.
  if (username) {
    try {
      await patchUserSettings(username, { preferredName: value });
    } catch {
      // Folder unwritable (e.g. not connected): fall through to the account write.
    }
  }

  // 2. Account-scoped E2E blob, so the preference follows the user. Flag-guarded;
  //    a clean no-op (and no network) when account settings are off.
  if (isAccountSettingsEnabled()) {
    try {
      const existing = await fetchAccountSettings();
      scheduleAccountSettingsWrite({ ...(existing ?? {}), preferredName: value });
    } catch {
      // Account layer unavailable (no identity unlocked, network): the folder-local
      // copy still carries the name; never block the user on the cloud write.
    }
  }

  return { ok: true };
}
