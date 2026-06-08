// Lab tier Phase 8e: member activation ("Enter lab" after approval).
//
// Accepting an invite only POSTS a request. The member becomes an active lab
// member explicitly: once the head has approved (the member is in the roster AND
// a sealed lab-key copy exists for them), this sets their lab_id so the sign-in
// gate drops them into the lab. Before approval it returns a pending result and
// changes nothing, so the member is never half-activated into a lab they cannot
// open.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { patchUserSettings } from "@/lib/settings/user-settings";
import type { StoredIdentity } from "@/lib/sharing/identity/storage";
import { getLabRemote } from "./lab-do-client";
import { openLabKeyCopy } from "./lab-key";

export type EnterLabResult =
  | { entered: true; labId: string }
  | {
      entered: false;
      reason: "not-found" | "pending" | "error";
      message: string;
    };

/**
 * Member side. If the head has approved this member, set lab_id and return
 * entered:true (the gate, which live-reads lab_id, then activates the lab). If
 * not yet approved, return a pending result and write nothing.
 *
 * Approval is proven cryptographically, not by a flag: the member must be able
 * to OPEN their sealed lab-key copy. A roster entry alone is not enough (the
 * sealed copy is what the head adds on finalize), and the open also fails if the
 * member somehow is not the real recipient.
 */
export async function checkAndEnterLab(params: {
  labId: string;
  username: string;
  identity: StoredIdentity;
}): Promise<EnterLabResult> {
  const { labId, username, identity } = params;

  let remote;
  try {
    remote = await getLabRemote(labId);
  } catch (e) {
    return {
      entered: false,
      reason: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
  if (!remote) {
    return { entered: false, reason: "not-found", message: "Lab not found." };
  }

  const inRoster =
    remote.record.head.username === username ||
    remote.record.members.some((m) => m.username === username);
  if (!inRoster || !remote.envelopes.length) {
    return {
      entered: false,
      reason: "pending",
      message: "The lab head has not approved your request yet.",
    };
  }

  const current = remote.envelopes.reduce((a, b) =>
    b.generation > a.generation ? b : a,
  );
  try {
    openLabKeyCopy(current, username, identity.keys.encryption.privateKey);
  } catch {
    return {
      entered: false,
      reason: "pending",
      message: "The lab head has not finished adding you yet.",
    };
  }

  // Approved + sealed to us. Set lab_id; useLabSession live-reads the write and
  // the gate activates. We do not touch account_type (a member is the default).
  await patchUserSettings(username, { lab_id: labId });
  return { entered: true, labId };
}
