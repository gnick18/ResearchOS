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
import { canonicalizeEmail } from "@/lib/sharing/directory/email";
import { getLabRemote } from "./lab-do-client";
import { openLabKeyCopy } from "./lab-key";
import type { DataKeyState } from "./lab-deferred-seal";
import { LAB_AS_FOLDER_ENABLED } from "./lab-as-folder-config";
import { provisionMemberFolder } from "./provision-member-folder";

/**
 * Lab-as-folder (P1). Record this member's membership for `labId`.
 *
 * Flag ON: provision (or reuse) a MANAGED OPFS member folder, write
 * account_type=member + lab_id into THAT folder, register it in the account
 * remembered set, and switch to it. The CURRENT folder is left untouched (this is
 * the fix for the Emile-test bug where joining a lab overwrote the joiner's own
 * folder's lab_id). On any provisioning failure we fall back to the legacy write
 * so the member is never left un-activated.
 *
 * Flag OFF: BYTE-IDENTICAL to before. patchUserSettings sets lab_id on the
 * CURRENT folder (the legacy single-lab_id behavior). account_type is not touched
 * (a member is the default), exactly as the prior code did.
 *
 * @param labName optional cosmetic name cached on the new folder's switcher label.
 */
async function recordMemberActivation(
  username: string,
  labId: string,
  labName?: string,
): Promise<void> {
  if (!LAB_AS_FOLDER_ENABLED) {
    await patchUserSettings(username, { lab_id: labId });
    return;
  }
  const result = await provisionMemberFolder({ labId, username, labName });
  if (!result.ok) {
    // Never trap the member un-activated. If OPFS is unavailable or provisioning
    // failed, fall back to the legacy write on the current folder so the lab gate
    // can still activate. This degrades to today's behavior, not a dead end.
    await patchUserSettings(username, { lab_id: labId });
  }
}

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
  /** Optional cosmetic lab name, cached on the managed member folder's switcher
   *  label when the lab-as-folder flag is on. Ignored when the flag is off. */
  labName?: string;
}): Promise<EnterLabResult> {
  const { labId, username, identity, labName } = params;

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
      message:
        "You are a member. A labmate still needs to grant you data access, which happens end-to-end (the server never sees the lab key). This usually lands the next time the lab head opens the lab, so try Enter lab again shortly.",
    };
  }

  // Approved + sealed to us. Record membership; useLabSession live-reads the
  // resulting settings write and the gate activates. Flag-off this is the legacy
  // lab_id set on the current folder; flag-on it provisions a managed member
  // folder and switches to it (see recordMemberActivation).
  await recordMemberActivation(username, labId, labName);
  return { entered: true, labId };
}

// ---------------------------------------------------------------------------
// Phase 4A. The token-joined member side. A member who joined via a Phase 4B
// server token has NO crypto-roster entry and NO sealed copy until a labmate runs
// the deferred-seal reconciliation. Membership (the server token) and data-key
// access (the sealed copy) are independent, so this returns a DataKeyState rather
// than collapsing both into a single "pending", and NEVER traps the member: a
// pending data key is a clearly-labeled state they can wait out or leave from.
//
// The deterministic roster key for a token-joined member is their CANONICAL EMAIL
// (the same key the head seals under, see lab-deferred-seal-reconcile.ts), so the
// member opens their copy keyed by canonicalizeEmail(their own OAuth email).
// ---------------------------------------------------------------------------

export type TokenEnterResult =
  | { entered: true; labId: string }
  | { entered: false; state: DataKeyState; message: string };

/**
 * Member side, token flow. Determines this member's data-key state for a lab and,
 * when their copy is openable, activates the lab. The member's OAuth email is the
 * roster key; we open the current-generation copy under it with the member's
 * X25519 private key.
 *
 *   active        -> sealed copy opened, lab_id set, entered:true.
 *   seal-pending  -> a sealed copy exists in the roster set but does not open under
 *                    our key (should not normally happen for our own email) OR no
 *                    copy yet though our pubkey is published. Wait for a labmate.
 *   key-pending   -> we have no published device key, nobody can seal to us yet.
 *
 * We deliberately do NOT consult the head-signed crypto roster for membership: in
 * the token flow the server token (billing roster) is the membership of record.
 * The sealed copy is the ONLY data-access gate.
 */
export async function enterLabViaToken(params: {
  labId: string;
  username: string;
  oauthEmail: string;
  identity: StoredIdentity;
  /** True when this device has published an X25519 pubkey (provisioned a key).
   *  The caller knows this from the directory bind state; it only distinguishes
   *  the two pending messages and never gates the open attempt. */
  hasPublishedKey: boolean;
  /** Optional cosmetic lab name, cached on the managed member folder's switcher
   *  label when the lab-as-folder flag is on. Ignored when the flag is off. */
  labName?: string;
}): Promise<TokenEnterResult> {
  const { labId, username, oauthEmail, identity, hasPublishedKey, labName } =
    params;
  const rosterKey = canonicalizeEmail(oauthEmail);

  let remote;
  try {
    remote = await getLabRemote(labId);
  } catch (e) {
    return {
      entered: false,
      state: "seal-pending",
      message: e instanceof Error ? e.message : String(e),
    };
  }
  if (!remote || !remote.envelopes.length) {
    return {
      entered: false,
      state: hasPublishedKey ? "seal-pending" : "key-pending",
      message: hasPublishedKey
        ? "Waiting for a labmate to grant you data access."
        : "Set up a device key so a labmate can grant you data access.",
    };
  }

  const current = remote.envelopes.reduce((a, b) =>
    b.generation > a.generation ? b : a,
  );
  try {
    openLabKeyCopy(current, rosterKey, identity.keys.encryption.privateKey);
  } catch {
    return {
      entered: false,
      state: hasPublishedKey ? "seal-pending" : "key-pending",
      message: hasPublishedKey
        ? "Waiting for a labmate to grant you data access."
        : "Set up a device key so a labmate can grant you data access.",
    };
  }

  await recordMemberActivation(username, labId, labName);
  return { entered: true, labId };
}
