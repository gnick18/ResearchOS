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
 * reconstruct a CreatedLab with an empty labKey placeholder.
 *
 * The pending genesis is cleared ONLY when BOTH the relay genesis publish AND
 * the directory upsert succeed. Previously pending was cleared on relay success
 * alone, which stranded labs with a missing directory_labs row (making the lab
 * invisible to the admin roster and /network). Now, if the directory write fails
 * (non-2xx or network error), directoryOk is false, the function returns false,
 * and the pending genesis stays in place so the next retry attempts both steps
 * again (the relay publish is idempotent; re-sending a genesis the DO already
 * has is safe and cheap).
 *
 * On any failure (thrown, non-ok relay) the pending genesis is left in place
 * and the function returns false so a later retry can pick it back up.
 */
export async function publishPendingGenesis(
  username: string,
  pending: PendingLabGenesis,
): Promise<boolean> {
  try {
    const result = await publishLabRemote(
      pending.labId,
      {
        record: pending.record,
        envelope: pending.envelope,
        // labKey is unused by the publish path; createLabRemote ships only the
        // public, sealed artifacts. An empty array satisfies the CreatedLab type.
        labKey: new Uint8Array(),
      },
      // Carry any persisted cosmetic branding so a retried publish still sends
      // the lab name / PI title / PI display to the relay DO meta.
      pending.branding
        ? {
            labName: pending.branding.labName,
            piTitle: pending.branding.piTitle,
            piDisplayName: pending.branding.piDisplay,
          }
        : undefined,
    );
    // Only clear the pending genesis once BOTH the relay genesis AND the
    // directory upsert landed. A partial result (relay ok, directory failed)
    // leaves the pending genesis in place so the next retry can backfill the
    // directory row. The relay is idempotent for re-sent genesis records.
    if (!result.ok) {
      return false;
    }
    await clearPendingGenesis(username);
    return true;
  } catch {
    return false;
  }
}
