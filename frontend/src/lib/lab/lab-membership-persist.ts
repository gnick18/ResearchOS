// Lab tier: persist lab membership into user settings.
//
// Called when a user creates or joins a lab so that both the account_type and
// lab_id are recorded in settings.json. useLabSession reads these two fields on
// boot to decide whether to mount the lab sign-in gate.
//
// Intentionally thin: all write serialization and normalization is handled by
// updateUserSettings (the per-user chained-promise queue in user-settings.ts).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { updateUserSettings } from "@/lib/settings/user-settings";

/**
 * Atomically records lab membership for the given user in their settings.json.
 * Sets `account_type` ("lab_head" or "member") and `lab_id` so the lab
 * sign-in gate (useLabSession + LabSessionMount) activates on next boot.
 *
 * @param username  The user whose settings to update.
 * @param opts.labId  The stable lab identifier (matches the DO record).
 * @param opts.role   "head" -> account_type "lab_head"; "member" -> "member".
 */
export async function persistLabMembership(
  username: string,
  opts: { labId: string; role: "head" | "member" },
): Promise<void> {
  await updateUserSettings(username, () => ({
    account_type: opts.role === "head" ? "lab_head" : "member",
    lab_id: opts.labId,
  }));
}
