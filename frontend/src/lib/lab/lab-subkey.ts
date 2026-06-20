// Class Mode per-student SUBKEY (the FERPA-grade privacy core).
//
// THE PROBLEM this solves (scope critic C3). Today every class member holds the
// ONE shared team key (the lab key, lab-key.ts) and GET /lab/data/get is open at
// the transport, so a classmate can fetch and decrypt any "private" student
// notebook. shared_with is a client-side INTENT filter, not access control. So a
// student's PRIVATE class notebook must be encrypted under a key NO classmate
// holds.
//
// THE FIX. A per-student-per-class SUBKEY, a fresh random 32-byte symmetric key,
// sealed ONLY to two recipients, the STUDENT and the INSTRUCTOR (lab head). No
// other classmate is ever a recipient, so no classmate can ever open the subkey
// and therefore no classmate can decrypt the student's private notebook, even
// though they hold the team key and can fetch the ciphertext. The head is ALWAYS
// a recipient by construction (PI oversight, exactly like distributeLabKey always
// includes the head), so the instructor can read every student's private work for
// grading without ever being handed the subkey in plaintext by the server.
//
// GRANULARITY. v1 uses ONE subkey per student per class, reused across that
// student's private records in that class, NOT a fresh subkey per record. WHY:
//   - The threat model is "a classmate must not read my private notebook." A
//     single per-student subkey already delivers that fully, because the subkey
//     is sealed only to the student and the head regardless of how many records
//     it protects.
//   - One envelope per student (two sealed copies) instead of one per record
//     keeps the envelope count O(students) not O(records), so the student does
//     one seal-open per session rather than one per record, and the head opens
//     one subkey per student rather than per record when grading.
//   - Per-record granularity buys forward secrecy between a student's OWN
//     records, which no actor in this threat model cares about (the student and
//     the head are the only holders of all of them anyway). It is strictly more
//     machinery for no privacy gain here. If a future requirement needs per-record
//     isolation (e.g. selectively re-sealing one exam), a per-record subkey is a
//     drop-in because sealSubkeyTo / openSubkeyCopy take the key as an argument
//     and do not assume how many records share it.
//
// NO NEW CRYPTO. This module composes only audited primitives:
//   - sealToRecipient / openSealed (lib/sharing/encryption.ts), the X25519
//     sealed-box, for the per-recipient subkey copies (same shape as the lab key
//     envelope's copies).
//   - encryptLabData / decryptLabData (lib/lab/lab-key.ts), the XChaCha20-Poly1305
//     AEAD, for the at-rest record seal, called with the SUBKEY as the 32-byte key
//     instead of the team key. Same cipher, different key. No new AEAD.
//
// SERVER-BLIND. The subkey never leaves the browser in plaintext. Only sealed
// copies (each opaque to anyone but its recipient) and ciphertext travel. The
// envelope and the encrypted record carry no plaintext key material.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { randomBytes, bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { sealToRecipient, openSealed } from "@/lib/sharing/encryption";
import { encryptLabData, decryptLabData, LAB_KEY_LENGTH } from "./lab-key";
import type { LabMember } from "./lab-membership";

/** A subkey is the same length as the lab key (a 32-byte XChaCha20-Poly1305 key). */
export const SUBKEY_LENGTH = LAB_KEY_LENGTH;

// ---------------------------------------------------------------------------
// 1. Subkey generation.
// ---------------------------------------------------------------------------

/**
 * Generates a fresh random 32-byte subkey. One per student per class (see the
 * granularity note at the top). Never leaves the client in plaintext, it is only
 * sealed to the student's and the head's X25519 public keys (sealSubkeyTo) or
 * used as the AEAD key for the student's private records (encryptLabData).
 */
export function generateSubkey(): Uint8Array {
  return randomBytes(SUBKEY_LENGTH);
}

// ---------------------------------------------------------------------------
// 2. The subkey envelope, sealed to the student and the head only.
//
// Shape deliberately mirrors LabKeyEnvelope.copies (lab-key.ts) so the read and
// write paths look the same, but the recipient set is exactly two people and the
// head is ALWAYS one of them, never the whole roster.
// ---------------------------------------------------------------------------

/**
 * One recipient's sealed copy of a subkey. sealed is the opaque sealToRecipient
 * output (epk || nonce || ct), openable only with that recipient's X25519 private
 * key. Keyed by username so a reader can find their own copy.
 */
export interface SealedSubkeyCopy {
  username: string;
  /** Hex of the sealed bytes from sealToRecipient. */
  sealed: string;
}

/**
 * The portable, server-storable envelope for ONE student's class subkey. It
 * carries exactly the sealed copies for [the student, the instructor/head]. The
 * envelope travels WITH the encrypted record (as transport metadata, see the
 * record-level shape below). Nothing here is plaintext-sensitive, every copy is
 * sealed to a public key the server never has the private half of.
 *
 * owner is the student the subkey belongs to, recorded so a reader can tell whose
 * private record this is and the head can index "open the subkey for student X".
 */
export interface SubkeyEnvelope {
  /** The student this subkey protects (the record's owner). */
  owner: string;
  /** Exactly two sealed copies, one for the student and one for the head. */
  copies: SealedSubkeyCopy[];
}

/**
 * Seals a subkey to each recipient's X25519 public key. The HEAD is ALWAYS
 * included even if somehow absent from the explicit recipient list, exactly like
 * distributeLabKey force-adds the head, so the instructor can read the student's
 * private work by construction. De-duplicated by username so a recipient is
 * sealed to exactly once.
 *
 * INVARIANT for the caller. recipients must be exactly the student plus the head.
 * This function does NOT itself reject a longer list (it just seals to whoever is
 * passed), so the CALLER is responsible for never passing a third classmate. The
 * sealSubkeyForStudent helper below encodes the correct two-recipient set so
 * normal callers cannot get it wrong.
 *
 * @param subkey the 32-byte subkey for this student.
 * @param owner the student the subkey belongs to (stamped on the envelope).
 * @param recipients the X25519 recipients (student + head). Head force-added.
 * @param head the instructor, always a recipient.
 * @throws if the subkey is not 32 bytes.
 */
export function sealSubkeyTo(
  subkey: Uint8Array,
  owner: string,
  recipients: LabMember[],
  head: LabMember,
): SubkeyEnvelope {
  if (subkey.length !== SUBKEY_LENGTH) {
    throw new Error(
      `sealSubkeyTo: subkey must be ${SUBKEY_LENGTH} bytes, got ${subkey.length}`,
    );
  }
  // Build the recipient set, head guaranteed present and de-duplicated so the
  // head is sealed to exactly once even if also listed in recipients.
  const byUsername = new Map<string, LabMember>();
  byUsername.set(head.username, head);
  for (const r of recipients) {
    byUsername.set(r.username, r);
  }

  const copies: SealedSubkeyCopy[] = [];
  for (const member of byUsername.values()) {
    const pub = hexToBytes(member.x25519PublicKey);
    const sealed = sealToRecipient(subkey, pub);
    copies.push({ username: member.username, sealed: bytesToHex(sealed) });
  }
  return { owner, copies };
}

/**
 * The correct, hard-to-misuse way to build a student's subkey envelope. Seals the
 * subkey to EXACTLY the student and the head, the only two recipients a private
 * class notebook ever has. Use this everywhere instead of hand-assembling the
 * recipient list, so a third classmate can never be added by accident.
 *
 * @param subkey the student's 32-byte subkey.
 * @param student the student LabMember (the record owner).
 * @param head the instructor LabMember.
 */
export function sealSubkeyForStudent(
  subkey: Uint8Array,
  student: LabMember,
  head: LabMember,
): SubkeyEnvelope {
  return sealSubkeyTo(subkey, student.username, [student], head);
}

/**
 * Opens a reader's sealed copy of a subkey from an envelope, with that reader's
 * X25519 private key. Returns the 32-byte subkey. Only the student and the head
 * have a copy, so only they can open it; a classmate who is not in copies gets a
 * clear "no sealed copy" error, and a classmate who tampered a copy in fails the
 * AEAD inside openSealed.
 *
 * @throws if there is no copy for this username, or if opening fails (not a
 *   recipient, tampered copy, or wrong key).
 */
export function openSubkeyCopy(
  envelope: SubkeyEnvelope,
  username: string,
  x25519PrivateKey: Uint8Array,
): Uint8Array {
  const copy = envelope.copies.find((c) => c.username === username);
  if (!copy) {
    throw new Error(`openSubkeyCopy: no sealed copy for username ${username}`);
  }
  return openSealed(hexToBytes(copy.sealed), x25519PrivateKey);
}

// ---------------------------------------------------------------------------
// 3. The record-level transport shape and the read/write resolution.
//
// A class record optionally carries a subkey envelope alongside its ciphertext.
// When present, the ciphertext is sealed under the SUBKEY, not the team key, and
// only the student and the head can decrypt it. When absent (every collaborative
// record, and every legacy record written before subkeys existed), the ciphertext
// is sealed under the team key, decrypted exactly as today. This is the BACKWARD
// COMPATIBLE switch.
// ---------------------------------------------------------------------------

/**
 * The transport wrapper for ONE class record. blob is the XChaCha20-Poly1305
 * ciphertext (nonce || ct, the encryptLabData wire format) as hex. subkey, when
 * present, is the SubkeyEnvelope that the blob was sealed under; when absent, the
 * blob was sealed under the team key.
 *
 * This shape travels with the record (it is the metadata the store layer carries
 * next to the ciphertext). The server stays blind, it holds only hex of sealed
 * bytes and ciphertext, never a key.
 */
export interface SubkeyedRecord {
  /** Hex of encryptLabData(plaintext, key), where key is the subkey or team key. */
  blob: string;
  /**
   * Present iff blob is sealed under a subkey. Absent means blob is sealed under
   * the team key (legacy and collaborative records). JSON omits it when absent,
   * so a team-key record stays byte-identical to the pre-subkey shape.
   */
  subkey?: SubkeyEnvelope;
}

/**
 * Encrypts a PRIVATE class record under a freshly generated per-student subkey and
 * returns BOTH the transport record (ciphertext + envelope) and the raw subkey, so
 * the caller can REUSE the same subkey for the student's other private records in
 * this class (the per-student-per-class model). On the very first private record
 * the caller has no subkey yet, so this mints one; on later records the caller
 * passes the existing subkey via opts.subkey to keep one subkey per student.
 *
 * The envelope is sealed to exactly the student and the head (sealSubkeyForStudent),
 * so no classmate can open the subkey and therefore no classmate can decrypt the
 * blob, even though the blob sits in the same team-key-readable store.
 *
 * @param plaintext the serialized record bytes.
 * @param student the student LabMember (the record owner).
 * @param head the instructor LabMember (always a co-recipient).
 * @param opts.subkey reuse this existing per-student subkey instead of minting a
 *   fresh one. Pass it on every private record after the first so the student has
 *   ONE subkey for the class.
 * @returns the transport record and the subkey used (mint it once, then thread it).
 */
export function encryptPrivateRecord(
  plaintext: Uint8Array,
  student: LabMember,
  head: LabMember,
  opts?: { subkey?: Uint8Array },
): { record: SubkeyedRecord; subkey: Uint8Array } {
  const subkey = opts?.subkey ?? generateSubkey();
  if (subkey.length !== SUBKEY_LENGTH) {
    throw new Error(
      `encryptPrivateRecord: subkey must be ${SUBKEY_LENGTH} bytes, got ${subkey.length}`,
    );
  }
  const blob = encryptLabData(plaintext, subkey);
  const envelope = sealSubkeyForStudent(subkey, student, head);
  return {
    record: { blob: bytesToHex(blob), subkey: envelope },
    subkey,
  };
}

/**
 * Wraps a COLLABORATIVE / non-private record sealed under the team key into the
 * SAME transport shape (no subkey envelope). This keeps the write path uniform,
 * collaborative records keep using the team key exactly as today and just travel
 * in the SubkeyedRecord wrapper with subkey absent.
 *
 * @param plaintext the serialized record bytes.
 * @param teamKey the 32-byte lab (team) key.
 */
export function encryptTeamRecord(
  plaintext: Uint8Array,
  teamKey: Uint8Array,
): SubkeyedRecord {
  const blob = encryptLabData(plaintext, teamKey);
  return { blob: bytesToHex(blob) };
}

/**
 * Resolves and decrypts a class record for a given VIEWER. This is the single
 * BACKWARD-COMPATIBLE read path:
 *
 *   - If the record carries a subkey envelope AND the viewer has a sealed copy
 *     (the student or the head), open the subkey with the viewer's X25519 private
 *     key, then decryptLabData(blob, subkey). A classmate who holds only the team
 *     key has NO sealed copy, so this throws for them (privacy enforced by crypto).
 *   - If the record carries a subkey envelope but the viewer has NO copy, throw a
 *     clear "not a recipient" error (do NOT silently fall through to the team key,
 *     which would defeat the whole point).
 *   - If the record carries NO subkey envelope, decrypt with the team key exactly
 *     as today (legacy + collaborative records).
 *
 * @param record the transport record (ciphertext + optional envelope).
 * @param viewer the reader's identity, username + X25519 private key.
 * @param teamKey the lab (team) key, used only for non-subkeyed records.
 * @returns the decrypted plaintext bytes.
 * @throws if a subkeyed record has no copy for the viewer, or if any decrypt fails
 *   (tamper, wrong key). The Poly1305 tag enforces integrity in every branch.
 */
export function decryptClassRecord(
  record: SubkeyedRecord,
  viewer: { username: string; x25519PrivateKey: Uint8Array },
  teamKey: Uint8Array,
): Uint8Array {
  const blob = hexToBytes(record.blob);

  if (record.subkey) {
    // A private, subkey-sealed record. Only the student and the head can open it.
    const copy = record.subkey.copies.find(
      (c) => c.username === viewer.username,
    );
    if (!copy) {
      // The viewer (a classmate holding only the team key) is not a subkey
      // recipient. Refuse, do NOT fall back to the team key. This is the line
      // that makes private student notebooks cryptographically private from
      // classmates even though the ciphertext is fetchable.
      throw new Error(
        `decryptClassRecord: viewer ${viewer.username} is not a recipient of this private record`,
      );
    }
    const subkey = openSubkeyCopy(
      record.subkey,
      viewer.username,
      viewer.x25519PrivateKey,
    );
    return decryptLabData(blob, subkey);
  }

  // No envelope, a collaborative or legacy record sealed under the team key.
  return decryptLabData(blob, teamKey);
}
