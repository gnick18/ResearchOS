// Mirror the cloud profile display name into the account-scoped E2E settings blob.
//
// The canonical cloud profile (handle / name / avatar / bio / links) lives in the
// Neon account_profiles table, edited via /api/account/profile (ProfileEditor).
// The greeting surfaces (the welcome-back splash, BeakerBot) read the display
// name from the account-scoped E2E blob, the SAME place preferredName lives, via
// readEffectiveUserSettings. Those two stores are otherwise disconnected, so a
// name set in the profile editor would never reach the greeting (it would fall
// back to the folder username). This mirror closes that gap: when the profile is
// saved, copy the display name into the blob so the greeting follows the cloud
// profile across folders + devices.
//
// Flag-guarded and best-effort, so it is a clean no-op (and no network) when
// account settings are off, exactly like savePreferredName's account write. The
// cloud profile (account_profiles) remains the canonical store; the blob is the
// greeting-facing mirror.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { isAccountSettingsEnabled } from "./account-settings-config";
import {
  fetchAccountSettings,
  scheduleAccountSettingsWrite,
} from "./account-settings";

/**
 * Normalize a raw display-name input into the stored value. A blank / whitespace
 * input clears the mirror (null), so the greeting falls back to the folder value
 * when the user removes their name.
 */
function normalizeDisplayName(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Copy the just-saved cloud profile display name into the account-scoped E2E blob
 * so the greeting can read it. Best-effort and non-throwing, so a profile save
 * never hard-fails on a mirror hiccup. No-op (and no network) when account
 * settings are off or no identity is unlocked.
 *
 * Skips the write when the blob already carries the same value, so a profile save
 * that did not change the name does not churn the blob.
 */
export async function syncDisplayNameToAccount(
  displayName: string | null,
): Promise<void> {
  if (!isAccountSettingsEnabled()) return;
  try {
    const value = normalizeDisplayName(displayName);
    const existing = await fetchAccountSettings();
    if ((existing?.displayName ?? null) === value) return;
    scheduleAccountSettingsWrite({ ...(existing ?? {}), displayName: value });
  } catch {
    // Account layer unavailable (no identity unlocked, network): the cloud
    // profile still carries the name; never block the save on the mirror.
  }
}
