// Mirror the SELF user's avatar color into the account-scoped E2E settings blob.
//
// Avatar color is a cloud USER SETTING (Grant 2026-06-25): it follows the
// account across folders and devices, edited in Settings -> Appearance (NOT the
// identity profile editor). The canonical home is the account E2E blob
// (AccountScopedSettings.color / colorSecondary, added in Phase 1). The folder
// copies (users/<u>/settings.json + the _user_metadata.json roster) stay as the
// OFFLINE fallback and, crucially, as the only place OTHER users in a shared
// folder can read this user's color (the blob is E2E, readable only by its
// owner). So a color pick writes BOTH: the folder roster (for labmates, via the
// existing settings.json mirror) AND the account blob (this helper, so it follows
// the owner).
//
// Uses writeAccountSettings DIRECTLY (write-through cache update) rather than the
// debounced scheduleAccountSettingsWrite, so a read of the color map right after
// a pick (the Settings page invalidates it) sees the new color instead of the
// stale cached blob. Best-effort and flag-guarded, a clean no-op when account
// settings are off or no identity is unlocked.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { isAccountSettingsEnabled } from "./account-settings-config";
import { fetchAccountSettings, writeAccountSettings } from "./account-settings";

/**
 * Persist the SELF user's just-picked avatar color into the account blob. Reads
 * the current blob (served from the warm session cache), overlays color +
 * colorSecondary, and writes it back through the write-through path so the cache
 * reflects the new color immediately. Skips the write when neither value changed,
 * so a non-color settings save never churns the blob.
 *
 * Awaitable on purpose, so the caller can ensure the write-through cache holds
 * the new color before it invalidates the color map (otherwise the SELF read
 * override would briefly serve the stale blob value over the fresh local one).
 */
export async function syncUserColorToAccount(
  color: string | null | undefined,
  colorSecondary: string | null | undefined,
): Promise<void> {
  if (!isAccountSettingsEnabled()) return;
  try {
    const nextColor = color ?? null;
    const nextSecondary = colorSecondary ?? null;
    const existing = await fetchAccountSettings();
    if (
      (existing?.color ?? null) === nextColor &&
      (existing?.colorSecondary ?? null) === nextSecondary
    ) {
      return;
    }
    await writeAccountSettings({
      ...(existing ?? {}),
      color: nextColor,
      colorSecondary: nextSecondary,
    });
  } catch {
    // Account layer unavailable (no identity unlocked, network): the folder copy
    // + roster still carry the color; never block the color pick on the cloud
    // write.
  }
}
