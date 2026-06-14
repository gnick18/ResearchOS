// Lab tier: pending-genesis persistence + background publish helpers.
//
// When a PI commits to creating a lab we promote them to lab_head and persist
// the genesis artifacts (the head-signed record + the gen-0 sealed envelope)
// LOCALLY, before any relay round-trip. Being a PI is a local account-type
// property, so the PI UI lens renders instantly whether or not the relay is
// reachable. The relay genesis publish then becomes a retryable background step
// driven off the persisted artifacts (see LabGenesisPublishRetry.tsx).
//
// The 32-byte lab key is NOT persisted. It is re-derivable from the persisted
// envelope via openLabKeyCopy, so the head is never locked out even if the
// publish never lands (openLabKey falls back to the local envelope, see
// lab-session-effects.ts).
//
// No emojis, no em-dashes, no mid-sentence colons.

import {
  patchUserSettings,
  readUserSettings,
} from "@/lib/settings/user-settings";
import { publishLabRemote } from "./lab-create";
import type { PendingLabGenesis } from "./lab-membership";

/** Persists the genesis artifacts for a lab whose relay publish has not landed. */
export async function savePendingGenesis(
  username: string,
  pending: PendingLabGenesis,
): Promise<void> {
  await patchUserSettings(username, { lab_pending_genesis: pending });
}

/** Reads the pending genesis for a user, or null when none is queued. */
export async function readPendingGenesis(
  username: string,
): Promise<PendingLabGenesis | null> {
  const settings = await readUserSettings(username);
  return settings.lab_pending_genesis ?? null;
}

/**
 * Clears the pending genesis. patchUserSettings merges the patch into the
 * current settings and writes via fileService.writeJson; an undefined field is
 * dropped by JSON.stringify, so setting it to undefined removes it from disk and
 * readPendingGenesis then returns null.
 */
export async function clearPendingGenesis(username: string): Promise<void> {
  await patchUserSettings(username, { lab_pending_genesis: undefined });
}

/**
 * Attempts the relay genesis publish from a persisted PendingLabGenesis. The
 * lab key is NOT part of the publish (createLabRemote only reads
 * created.record.log[0] + created.envelope + created.record.head), so we
 * reconstruct a CreatedLab with an empty labKey placeholder. On success the
 * pending genesis is cleared and the function returns true; on any failure
 * (thrown, non-ok relay) it leaves the pending genesis in place and returns
 * false so a later retry can pick it back up.
 */
export async function publishPendingGenesis(
  username: string,
  pending: PendingLabGenesis,
): Promise<boolean> {
  try {
    await publishLabRemote(pending.labId, {
      record: pending.record,
      envelope: pending.envelope,
      // labKey is unused by the publish path; createLabRemote ships only the
      // public, sealed artifacts. An empty array satisfies the CreatedLab type.
      labKey: new Uint8Array(),
    });
    await clearPendingGenesis(username);
    return true;
  } catch {
    return false;
  }
}
