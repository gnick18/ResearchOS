// Lab tier Phase 8a: the OAuth-email to membership binding.
//
// A lab member opens the lab key with their X25519 KEYPAIR (openLabKeyCopy).
// That seal is the PRIMARY gate, you cannot read lab data without being a sealed
// recipient. This module adds the SECONDARY, human-identity layer: it binds the
// THIRD-PARTY-OAuth-verified email a member actually authenticates with to their
// membership, so a different OAuth account that somehow holds the keypair cannot
// quietly take the seat, and so the roster reflects a real, verified human.
//
// PRIVACY. The binding value stored on a LabMember (member.emailHashEnc) is the
// member's email HASHED (least exposure: even a lab-key holder recovers only a
// hash, never the raw email) and then ENCRYPTED under the lab key. /lab/get is an
// OPEN read, so a plaintext or merely-salted hash there would be brute-forceable
// back to the low-entropy email (exactly what the directory's server pepper
// guards against). Lab-key encryption is what prevents that: only a lab-key
// holder can decrypt it. The value also rides INSIDE the head-signed roster, so
// it is tamper-evident on top of being confidential.
//
// WHERE THE BOUND EMAIL COMES FROM. It is harvested from the member's own login,
// not asserted by the head. The head's invite address is only a delivery hint;
// the member accepts with whatever provider/email THEY choose, and that verified
// email is what gets sealed here (see LAB_MEMBERSHIP_INVITE.md). So send-email
// not equal to bound-email is expected and correct.
//
// CRITICAL: this module writes NO new low-level crypto. It composes hashEmail
// (lib/sharing/directory/email.ts) and encryptLabData/decryptLabData
// (lab-key.ts), both already audited.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { hashEmail, canonicalizeEmail } from "@/lib/sharing/directory/email";
import { encryptLabData, decryptLabData } from "./lab-key";
import type { LabMember } from "./lab-membership";

/**
 * Public, client-computable salt for the lab-member email-binding hash. This is
 * NOT the directory's server pepper (a secret the browser never holds). The
 * binding does not rely on this salt for secrecy, the value is ALSO lab-key
 * encrypted before storage, which is what keeps the open /lab/get read from
 * brute-forcing the email. The salt only domain-separates this hash from any
 * other email hash in the system, so a value here can never be cross-matched
 * against a directory hash or an inbox-address hash.
 */
export const LAB_EMAIL_BINDING_SALT = "researchos-lab-member-binding-v1";

/**
 * hashEmail of an email under the public lab-binding salt, after canonicalizing
 * (trim + lowercase, the same normalization the directory uses). Deterministic,
 * so the value sealed at add time matches the value recomputed at login time
 * regardless of the case or whitespace the provider returns.
 */
export function computeLabEmailHash(email: string): string {
  return hashEmail(canonicalizeEmail(email), LAB_EMAIL_BINDING_SALT);
}

/**
 * Produces the lab-key-encrypted email binding stored on a LabMember
 * (member.emailHashEnc). Hash first, then encrypt under the lab key. The output
 * is hex of encryptLabData(hashBytes, labKey), a fresh random nonce per call so
 * two members with the same email produce unrelated ciphertexts.
 *
 * @throws if labKey is not 32 bytes (via encryptLabData).
 */
export function sealMemberEmailHash(email: string, labKey: Uint8Array): string {
  const hashBytes = new TextEncoder().encode(computeLabEmailHash(email));
  return bytesToHex(encryptLabData(hashBytes, labKey));
}

/** The outcome of checking a member's OAuth-email binding. */
export interface BindingResult {
  ok: boolean;
  /** Human-readable reason when ok is false. Empty when ok is true. */
  reason: string;
}

/**
 * Verifies that an OAuth-verified email matches a member's stored binding.
 *
 * Strict by construction (the locked decision is no silent takeover):
 *   - a member with NO emailHashEnc is rejected (there is no binding to check),
 *   - an empty or whitespace OAuth email is rejected,
 *   - a binding that fails to decrypt under the supplied lab key is rejected
 *     (wrong key, or a tampered/swapped ciphertext fails the Poly1305 tag),
 *   - a decrypted hash that does not equal computeLabEmailHash(oauthEmail) is
 *     rejected.
 *
 * Returns { ok, reason } rather than throwing so the caller can log the reason.
 * The final comparison is constant-time so it leaks no timing signal about how
 * close a wrong email was.
 */
export function verifyMemberEmailBinding(params: {
  member: LabMember;
  oauthEmail: string;
  labKey: Uint8Array;
}): BindingResult {
  const { member, oauthEmail, labKey } = params;

  if (!member.emailHashEnc) {
    return { ok: false, reason: "membership has no email binding" };
  }
  if (!oauthEmail || !oauthEmail.trim()) {
    return { ok: false, reason: "no OAuth email to bind against" };
  }

  let expectedHash: string;
  try {
    const decrypted = decryptLabData(hexToBytes(member.emailHashEnc), labKey);
    expectedHash = new TextDecoder().decode(decrypted);
  } catch {
    return { ok: false, reason: "email binding failed to decrypt" };
  }

  const actualHash = computeLabEmailHash(oauthEmail);
  if (!constantTimeEqual(expectedHash, actualHash)) {
    return { ok: false, reason: "OAuth email does not match this membership" };
  }
  return { ok: true, reason: "" };
}

/**
 * Constant-time string equality. A length mismatch returns immediately (the hash
 * length is fixed, so this leaks nothing useful), otherwise it XOR-accumulates
 * over every character so the loop never short-circuits on the first difference.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
