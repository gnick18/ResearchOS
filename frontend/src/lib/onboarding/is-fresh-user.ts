// frontend/src/lib/onboarding/is-fresh-user.ts
//
// Helper that decides whether the Onboarding v2 wizard is eligible to
// fire for a given username. Phase 0 lands the predicate only — the
// Phase 1 orchestrator wires this into the mount decision.

import { fileService } from "@/lib/file-system/file-service";
import { userSettingsFileExists } from "@/lib/settings/user-settings";
import { getUserMetadata } from "@/lib/file-system/user-metadata";

function sidecarPath(username: string): string {
  return `users/${username}/_onboarding.json`;
}

/**
 * Returns true iff the user is brand new and the v2 wizard should
 * fire. The wizard fires ONLY for users with NO prior footprint —
 * Grant's role-brief lock states: "Existing users skip the wizard
 * automatically and load their profile." (See Onboarding v2 Phase 0
 * brief / `ONBOARDING_V2_PROPOSAL.md`.)
 *
 * The predicate returns true iff ALL of the following hold:
 *
 *  1. `users/<username>/_onboarding.json` does not exist.
 *  2. `users/<username>/settings.json` does not exist.
 *  3. The user has no entry in `users/_user_metadata.json`.
 *
 * If ANY of those is present, the user is "existing" and the wizard
 * does not fire — they go straight to their profile. If the file
 * service is not connected (no folder mounted), the wizard cannot
 * fire either, so the helper returns false.
 *
 * This helper does NOT mount or unmount the wizard; it's a pure
 * predicate for Phase 1's orchestrator decision.
 */
export async function isFreshUserForWizard(
  username: string,
): Promise<boolean> {
  if (!fileService.isConnected()) return false;

  const [hasSidecar, hasSettings, metadata] = await Promise.all([
    fileService.fileExists(sidecarPath(username)),
    userSettingsFileExists(username),
    getUserMetadata(username),
  ]);

  if (hasSidecar) return false;
  if (hasSettings) return false;
  if (metadata !== null) return false;

  return true;
}
