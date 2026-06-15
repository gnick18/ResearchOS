// Lab tier Phase 8c: the member's accept payload + the head's verification.
//
// After a member opens an invite link (lab-invite.ts) and logs in with their own
// choice of OAuth identity, they build a signed ACCEPT and post it to the lab's
// accept queue on the relay (lab-accept-client.ts). The accept carries:
//   - the echoed invite (so the head can verify its OWN signature, statelessly),
//   - the member's identity pubkeys (the lab key gets sealed to the X25519 one),
//   - the member's OAuth email, SEALED to the head's X25519 pubkey, so the relay
//     never sees it (server-blind) and only the head can read it,
//   - an Ed25519 signature by the member over all of the above.
//
// The head then verifies and finalizes (lab-invite-flow.ts): it confirms its own
// invite signature, the expiry, the member signature, decrypts the email, and
// adds the member with emailHashEnc = sealMemberEmailHash(thatEmail). So the
// bound email is harvested from the member's real login, never guessed by the
// head.
//
// WHY THE SEAL IS SAFE EVEN IF THE RELAY IS HOSTILE. A hostile relay could drop
// or replay accepts (denial of service), but it cannot read the member email
// (sealed to the head) nor forge a valid accept (it lacks the member's signing
// key) nor a valid invite (it lacks the head's signing key). The head reviews
// each accept before finalizing, which is the consent gate.
//
// CRITICAL: composes audited primitives only (Ed25519 from lab-membership's
// scheme, sealToRecipient/openSealed from sharing/encryption). No new crypto.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { sealToRecipient, openSealed } from "@/lib/sharing/encryption";
import { canonicalizeEmail } from "@/lib/sharing/directory/email";
import {
  verifyInviteSignature,
  isInviteExpired,
  type LabInvitePayload,
} from "./lab-invite";

/** The member's signed accept, stored in the lab's accept queue. */
export interface LabAcceptPayload {
  labId: string;
  /** Mirrors invite.nonce. The relay accept queue is keyed by memberEd25519Pub
   * (one pending accept per member), so a single reusable invite link admits
   * many members. */
  nonce: string;
  /** The invite echoed back, so the head verifies its own signature statelessly. */
  invite: LabInvitePayload;
  /** The member's chosen display username. */
  memberUsername: string;
  /** Hex X25519 pubkey. The head seals the lab key to this. */
  memberX25519Pub: string;
  /** Hex Ed25519 pubkey. Attribution + the key the member signs this accept with. */
  memberEd25519Pub: string;
  /** Hex of sealToRecipient(utf8(canonicalEmail), headX25519Pub). Head-only. */
  sealedEmail: string;
  /** Hex Ed25519 signature by the member over canonicalAcceptMessage. */
  memberSig: string;
}

/**
 * The message the member signs. Binds every field that matters (their pubkeys,
 * the sealed email, the nonce) so none can be swapped in transit. The
 * "lab-accept" verb prefix domain-separates it from invite and log messages.
 */
export function canonicalAcceptMessage(p: {
  labId: string;
  nonce: string;
  memberX25519Pub: string;
  memberEd25519Pub: string;
  memberUsername: string;
  sealedEmail: string;
}): string {
  return [
    "lab-accept",
    p.labId,
    p.nonce,
    p.memberX25519Pub,
    p.memberEd25519Pub,
    p.memberUsername,
    p.sealedEmail,
  ].join("\n");
}

/**
 * MEMBER side. Builds and signs an accept for an opened invite. Seals the
 * member's canonical email to the head's X25519 pubkey from the invite.
 *
 * @param params.invite the decoded invite payload.
 * @param params.memberUsername the member's display username.
 * @param params.memberEmail the member's OAuth-verified email (from getSession).
 * @param params.memberX25519Pub hex of the member's X25519 public key.
 * @param params.memberEd25519Pub hex of the member's Ed25519 public key.
 * @param params.memberEd25519Priv the member's Ed25519 private key (signer).
 */
export function buildAcceptPayload(params: {
  invite: LabInvitePayload;
  memberUsername: string;
  memberEmail: string;
  memberX25519Pub: string;
  memberEd25519Pub: string;
  memberEd25519Priv: Uint8Array;
}): LabAcceptPayload {
  const sealedEmailBytes = sealToRecipient(
    new TextEncoder().encode(canonicalizeEmail(params.memberEmail)),
    hexToBytes(params.invite.headX25519Pub),
  );
  const sealedEmail = bytesToHex(sealedEmailBytes);

  const message = canonicalAcceptMessage({
    labId: params.invite.labId,
    nonce: params.invite.nonce,
    memberX25519Pub: params.memberX25519Pub,
    memberEd25519Pub: params.memberEd25519Pub,
    memberUsername: params.memberUsername,
    sealedEmail,
  });
  const memberSig = bytesToHex(
    ed25519.sign(new TextEncoder().encode(message), params.memberEd25519Priv),
  );

  return {
    labId: params.invite.labId,
    nonce: params.invite.nonce,
    invite: params.invite,
    memberUsername: params.memberUsername,
    memberX25519Pub: params.memberX25519Pub,
    memberEd25519Pub: params.memberEd25519Pub,
    sealedEmail,
    memberSig,
  };
}

/** The outcome of verifying an accept. */
export interface AcceptVerifyResult {
  ok: boolean;
  reason: string;
}

/**
 * HEAD side. Verifies an accept before finalizing. Strict; every check must pass:
 *   1. accept.labId matches the lab being finalized.
 *   2. the echoed invite is internally consistent (labId + nonce match).
 *   3. invite.headEd25519Pub equals the REAL head pubkey (passed in from the lab
 *      record), so an attacker cannot mint a self-signed invite with their own
 *      pubkey and have it pass.
 *   4. the invite signature verifies (the head authored this nonce + expiry).
 *   5. the invite is not expired (relative to `now`).
 *   6. the member signature verifies over the canonical accept message, proving
 *      the accept was authored by the holder of memberEd25519Priv and that none
 *      of its fields were swapped.
 *
 * The email is decrypted separately (decryptAcceptEmail) because that needs the
 * head's X25519 private key, which this pure check does not take.
 */
export function verifyAccept(params: {
  accept: LabAcceptPayload;
  expectedLabId: string;
  headEd25519Pub: string;
  now: number;
}): AcceptVerifyResult {
  const { accept, expectedLabId, headEd25519Pub, now } = params;

  if (accept.labId !== expectedLabId) {
    return { ok: false, reason: "accept is for a different lab" };
  }
  if (accept.invite.labId !== expectedLabId || accept.invite.nonce !== accept.nonce) {
    return { ok: false, reason: "accept/invite labId or nonce mismatch" };
  }
  if (accept.invite.headEd25519Pub.toLowerCase() !== headEd25519Pub.toLowerCase()) {
    return { ok: false, reason: "invite head pubkey is not this lab's head" };
  }
  if (!verifyInviteSignature(accept.invite)) {
    return { ok: false, reason: "invite signature does not verify (not head-authored)" };
  }
  if (isInviteExpired(accept.invite, now)) {
    return { ok: false, reason: "invite has expired" };
  }
  const message = canonicalAcceptMessage({
    labId: accept.labId,
    nonce: accept.nonce,
    memberX25519Pub: accept.memberX25519Pub,
    memberEd25519Pub: accept.memberEd25519Pub,
    memberUsername: accept.memberUsername,
    sealedEmail: accept.sealedEmail,
  });
  let memberOk = false;
  try {
    memberOk = ed25519.verify(
      hexToBytes(accept.memberSig),
      new TextEncoder().encode(message),
      hexToBytes(accept.memberEd25519Pub),
    );
  } catch {
    memberOk = false;
  }
  if (!memberOk) {
    return { ok: false, reason: "member signature does not verify" };
  }
  return { ok: true, reason: "" };
}

/**
 * HEAD side. Decrypts the member's sealed email with the head's X25519 private
 * key. Returns the canonical email string.
 *
 * @throws if the seal fails to open (wrong key or tampered ciphertext).
 */
export function decryptAcceptEmail(
  accept: LabAcceptPayload,
  headX25519Priv: Uint8Array,
): string {
  const opened = openSealed(hexToBytes(accept.sealedEmail), headX25519Priv);
  return new TextDecoder().decode(opened);
}
