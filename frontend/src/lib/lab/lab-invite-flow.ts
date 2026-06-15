// Lab tier Phase 8c: the two end-to-end orchestrations of the invite handshake.
//
//   acceptLabInvite     MEMBER side. From a decoded invite + the member's
//                       unlocked identity + their OAuth email, build a signed
//                       accept and post it to the lab's queue.
//   finalizeLabAccepts  HEAD side. Read pending accepts, verify each, decrypt the
//                       member email, add the member to the roster with the
//                       lab-key-encrypted email binding (the SAME binding 8a
//                       checks at login), append the head-signed log entry, and
//                       dismiss the handled accept.
//
// The head must be live (it needs the lab key + its signing/X25519 private keys),
// which is the locked "head online to finalize" decision. Finalize is also the
// CONSENT gate: the head sees who accepted and adds them deliberately.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { encodePublicKey } from "@/lib/sharing/identity/keys";
import type { StoredIdentity } from "@/lib/sharing/identity/storage";
import { getLabRemote, appendAddMemberRemote } from "./lab-do-client";
import { addMember } from "./lab-key";
import { sealMemberEmailHash } from "./lab-binding";
import { buildAcceptPayload, verifyAccept, decryptAcceptEmail } from "./lab-accept";
import { postLabAccept, listLabAccepts, dismissLabAccept } from "./lab-accept-client";
import type { LabInvitePayload } from "./lab-invite";
import type { LabMember, LabRecord } from "./lab-membership";

export type AcceptInviteResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * MEMBER side. Builds and posts a signed accept for a decoded invite.
 *
 * @param invite the decoded invite payload (from decodeInviteFragment).
 * @param params.username the member's chosen display username.
 * @param params.identity the member's unlocked StoredIdentity.
 * @param params.oauthEmail the member's OAuth-verified email (from getSession).
 *   THIS is the email that gets bound to the membership, whatever provider the
 *   member chose, regardless of the address the head sent the invite to.
 */
export async function acceptLabInvite(
  invite: LabInvitePayload,
  params: { username: string; identity: StoredIdentity; oauthEmail: string },
): Promise<AcceptInviteResult> {
  if (!params.oauthEmail || !params.oauthEmail.trim()) {
    return { ok: false, reason: "no OAuth email to accept with" };
  }
  const accept = buildAcceptPayload({
    invite,
    memberUsername: params.username,
    memberEmail: params.oauthEmail,
    memberX25519Pub: encodePublicKey(params.identity.keys.encryption.publicKey),
    memberEd25519Pub: encodePublicKey(params.identity.keys.signing.publicKey),
    memberEd25519Priv: params.identity.keys.signing.privateKey,
  });
  const res = await postLabAccept(invite.labId, accept);
  if (!res.ok) {
    return { ok: false, reason: `relay rejected accept (HTTP ${res.status})` };
  }
  return { ok: true };
}

/** One finalize outcome per pending accept. */
export interface FinalizeOutcome {
  nonce: string;
  username: string;
  /** "added" when the member was added, otherwise the rejection reason. */
  status: "added" | "skipped";
  reason: string;
}

/**
 * HEAD side. Processes every pending accept for a lab. The head must supply the
 * live lab key and its private keys (held in the live session).
 *
 * Sequential by necessity: each addMember chains a new head-signed entry onto the
 * log tail, so accepts are appended one at a time and the local record advances
 * between them. A relay append failure stops the run (later accepts are left
 * pending for a retry) so the local and server logs never diverge.
 *
 * @returns one outcome per accept (added or skipped-with-reason).
 */
export async function finalizeLabAccepts(params: {
  labId: string;
  labKey: Uint8Array;
  headEd25519Priv: Uint8Array;
  headEd25519Pub: string;
  headX25519Priv: Uint8Array;
}): Promise<FinalizeOutcome[]> {
  const { labId, labKey, headEd25519Priv, headEd25519Pub, headX25519Priv } = params;

  const remote = await getLabRemote(labId);
  if (!remote) {
    throw new Error("finalizeLabAccepts: lab not found on relay");
  }
  let record: LabRecord = remote.record;

  const accepts = await listLabAccepts(labId, headEd25519Priv);
  const outcomes: FinalizeOutcome[] = [];

  for (const accept of accepts) {
    const base: Omit<FinalizeOutcome, "status" | "reason"> = {
      nonce: accept.nonce,
      username: accept.memberUsername,
    };

    // 1. cryptographic + freshness checks.
    const v = verifyAccept({
      accept,
      expectedLabId: labId,
      headEd25519Pub,
      now: Date.now(),
    });
    if (!v.ok) {
      outcomes.push({ ...base, status: "skipped", reason: v.reason });
      continue;
    }

    // 2. idempotency: already a member -> dismiss and skip (do not double-add).
    const dup =
      record.head.username === accept.memberUsername ||
      record.members.some((m) => m.username === accept.memberUsername);
    if (dup) {
      await dismissLabAccept(labId, accept.memberEd25519Pub, headEd25519Priv);
      outcomes.push({ ...base, status: "skipped", reason: "already a member" });
      continue;
    }

    // 3. decrypt the member email (head-only) and seal the binding under the key.
    let email: string;
    try {
      email = decryptAcceptEmail(accept, headX25519Priv);
    } catch {
      outcomes.push({ ...base, status: "skipped", reason: "email failed to decrypt" });
      continue;
    }

    const newMember: LabMember = {
      username: accept.memberUsername,
      x25519PublicKey: accept.memberX25519Pub,
      ed25519PublicKey: accept.memberEd25519Pub,
      role: "member",
      emailHashEnc: sealMemberEmailHash(email, labKey),
    };

    // 4. add to the roster (head-signed) + ship to the relay.
    const { record: nextRecord, copy } = addMember(
      record,
      labKey,
      newMember,
      headEd25519Priv,
    );
    const entry = nextRecord.log[nextRecord.log.length - 1];
    const res = await appendAddMemberRemote(labId, entry, copy);
    if (!res.ok) {
      // Stop so local and server logs stay in lockstep; leave this + the rest
      // pending for a retry.
      outcomes.push({
        ...base,
        status: "skipped",
        reason: `relay rejected add (HTTP ${res.status})`,
      });
      break;
    }

    record = nextRecord;
    await dismissLabAccept(labId, accept.memberEd25519Pub, headEd25519Priv);
    outcomes.push({ ...base, status: "added", reason: "" });
  }

  return outcomes;
}
