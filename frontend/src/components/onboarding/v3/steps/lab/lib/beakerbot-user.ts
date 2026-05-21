import { ensureUserFolderStructure } from "@/lib/file-system/user-discovery";
import {
  getUserMetadata,
  setUserMetadataField,
} from "@/lib/file-system/user-metadata";

/**
 * Lab Mode tour fake-teammate spawn (L2 / L19).
 *
 * The Phase 3 walkthrough demonstrates sharing, edit / view-only
 * permission flavors, and revoke against a temporary teammate named
 * "BeakerBot" (the same mascot the wizard uses elsewhere, sky-coloured).
 * That teammate is a REAL user record on disk so:
 *   - Lab Mode's user list (labApi.getUsers → discoverUsers) surfaces
 *     them while the tour is in flight, matching the brief's "user
 *     navigates to Lab Mode and sees BeakerBot" promise.
 *   - Phase 4 cleanup can tear them down through the same usersApi.delete
 *     soft-tombstone path it uses for any other lab member.
 *
 * The user is marked with `is_tutorial: true` on its `_user_metadata.json`
 * entry. That flag follows the pattern set by Telegram image sidecars
 * (`tutorial_test: true` on W12's sample SVG). The onboarding v3 Phase
 * 4 selector reads the flag to render the discard option alongside the
 * `lab_user` wizard artifact. No other consumer currently alters
 * behaviour based on it; lab mode treats the user as a normal teammate
 * for the duration of the tour.
 *
 * The username is fixed at `beakerbot`. Lowercase to match the username
 * sanitisation in `ensureUserFolderStructure` (alphanum + dash +
 * underscore only); the wizard renders the display name "BeakerBot"
 * directly in step copy.
 */

export const BEAKERBOT_USERNAME = "beakerbot";
export const BEAKERBOT_DISPLAY_NAME = "BeakerBot";
export const BEAKERBOT_COLOR = "#0ea5e9"; // sky-500, matches mascot

export interface SpawnBeakerBotResult {
  username: string;
  alreadyExisted: boolean;
}

/** Idempotent: creates the BeakerBot user folder + metadata entry with
 *  the tutorial flag if missing, no-op if already present. Returns the
 *  username so the caller can register it as a `lab_user` artifact. */
export async function spawnBeakerBotUser(): Promise<SpawnBeakerBotResult> {
  const preExisting = await getUserMetadata(BEAKERBOT_USERNAME);
  const folderOk = await ensureUserFolderStructure(BEAKERBOT_USERNAME);
  if (!folderOk) {
    throw new Error("Failed to create BeakerBot user folder");
  }
  // setUserMetadataField writes one field at a time, preserving the
  // rest. A fresh entry picks a palette color on first write; the
  // second call pins the avatar to the mascot's sky tone regardless of
  // which palette slot was assigned.
  await setUserMetadataField(BEAKERBOT_USERNAME, "is_tutorial", true);
  await setUserMetadataField(BEAKERBOT_USERNAME, "color", BEAKERBOT_COLOR);
  return {
    username: BEAKERBOT_USERNAME,
    alreadyExisted: preExisting !== null,
  };
}
