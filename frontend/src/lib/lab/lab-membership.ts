// Lab tier (cross-folder group), the signed membership log.
//
// A lab is a cross-folder group whose data is end-to-end encrypted to a lab key
// the PI (lab head) co-owns. Membership and key-generation history are recorded
// in an append-only, head-signed log so the roster and the key-generation chain
// are tamper-evident and independently verifiable. This module is the pure log
// shape plus its Ed25519 sign and verify. It holds NO secret key material, only
// public keys, usernames, roles, and signatures.
//
// Signing reuses the project's existing Ed25519 scheme exactly (see
// lib/collab/client/do-access.ts and lib/sharing/identity/keys.ts), so a
// signature produced here verifies under the same ed25519.verify the rest of the
// app uses. We hand-roll NO low-level crypto here.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { LabKeyEnvelope } from "./lab-key";

/** Locally-persisted genesis artifacts for a lab whose relay publish has not
 *  landed yet. record + envelope are fully JSON-safe and are exactly what a
 *  blind relay receives; the labKey is NOT stored (re-derivable from envelope). */
export interface PendingLabGenesis {
  labId: string;
  record: LabRecord;
  envelope: LabKeyEnvelope;
  /** Optional cosmetic branding to attach to the relay create body when the
   *  publish lands. Carried here so a retry (publishPendingGenesis) still sends
   *  the lab name / PI title / PI display. NOT part of the signed log. */
  branding?: {
    labName?: string;
    piTitle?: string;
    piDisplay?: string;
  };
}

/**
 * A lab participant, identified by username plus the public halves of their
 * identity keys (see lib/sharing/identity/keys.ts). x25519PublicKey is the
 * encryption key the lab key is sealed to; ed25519PublicKey is the signing key
 * used for attribution and, for the head, for signing this log. Both are hex.
 */
export interface LabMember {
  username: string;
  x25519PublicKey: string;
  ed25519PublicKey: string;
  /** "head" for the PI, "member" for everyone else. The head is the only signer. */
  role: "head" | "member";
  /**
   * Optional OAuth-email binding for this member, lab-key-encrypted (Phase 8a,
   * see lab-binding.ts). The value is hex of encryptLabData(hashEmail(
   * canonicalizeEmail(verifiedEmail), LAB_EMAIL_BINDING_SALT), labKey). It binds
   * the third-party-OAuth-verified email the member actually authenticates with
   * to this membership, so a login whose OAuth email does not match is rejected.
   * The lab-key seal of the key copy is the primary access gate, this is the
   * human-identity layer on top.
   *
   * Encrypted because /lab/get is an open read and a low-entropy email hash would
   * otherwise be brute-forceable. It rides inside this head-signed roster, so it
   * is also tamper-evident. Optional because labs created before this field exist
   * with no binding, and because it is set at member-add time (a login against a
   * member that has no binding yet is rejected, fail-safe). When absent,
   * JSON.stringify omits it, so older signed rosters stay byte-identical.
   */
  emailHashEnc?: string;
  /**
   * Lab Manager delegation (Phase 1, docs/proposals/2026-06-20-lab-admin-delegation-
   * and-co-pi.md). Set ONLY by a head-signed "role" log entry (setMemberAdmin in
   * lab-key.ts). It grants the member APP-LEVEL operational powers (approve
   * purchases, view audit / ops, manage companion-site content, propose member
   * changes for the head to ratify). It does NOT grant signing authority over this
   * log, so the head stays the sole signer and the crypto trust model is unchanged.
   * Absent for the head (the head already holds every power) and for plain members.
   * Optional and appended last so older signed rosters stay byte-identical
   * (JSON.stringify omits it when undefined, the same property emailHashEnc relies
   * on). Always constructed via a spread-append so its runtime key position is
   * deterministic, which keeps the canonical signed message reproducible.
   */
  admin?: true;
}

/**
 * The kinds of events the log records. "role" is a head-signed entry that changes
 * a member's Lab Manager (admin) flag WITHOUT rotating the key or changing the key
 * generation (an admin grant changes app-level power, not crypto access, so nothing
 * is resealed). See setMemberAdmin in lab-key.ts.
 */
export type LabLogEventType = "create" | "add" | "remove" | "rotate" | "role";

/**
 * One append-only log entry, signed by the head. Every entry chains to the
 * previous one via prevHash, so a verifier can confirm the entire sequence is
 * intact and ordered, not just each signature in isolation.
 *
 * The signed message is the canonical serialization of everything in the entry
 * EXCEPT the signature field itself (see canonicalEntryMessage). seq starts at 0
 * for the genesis "create" entry. prevHash is the SHA-256 hex of the previous
 * entry's signature, or the empty string for the genesis entry.
 */
export interface LabLogEntry {
  seq: number;
  type: LabLogEventType;
  /** Key generation in effect AFTER this entry. "create" and "rotate" bump it. */
  keyGeneration: number;
  /** The full roster in effect AFTER this entry, head first. */
  roster: LabMember[];
  /**
   * The member this entry is about (the one added or removed). Omitted for
   * "create" (the genesis roster is the subject) and present for add/remove and
   * for the departing member on "rotate".
   */
  subject?: LabMember;
  /** Millisecond timestamp the head stamped at signing time. */
  issuedAt: number;
  /** SHA-256 hex of the previous entry's signature, "" for the genesis entry. */
  prevHash: string;
  /** Hex Ed25519 signature by the head over canonicalEntryMessage(entry). */
  signature: string;
}

/**
 * The full lab record. labId is a stable opaque id. head is the PI, the sole
 * signer of the log and an implicit recipient of every lab-key generation. log
 * is the append-only signed history. keyGeneration mirrors the latest entry's
 * generation for quick access. The actual sealed lab-key copies and the seed
 * chain live in the LabKeyEnvelope (lab-key.ts), not here, so this record is
 * safe to treat as public metadata.
 */
export interface LabRecord {
  labId: string;
  head: LabMember;
  members: LabMember[];
  keyGeneration: number;
  log: LabLogEntry[];
}

/**
 * Canonical message signed for a log entry, every field except `signature`, in
 * a fixed order with a verb prefix. Deterministic JSON (the roster and subject
 * are plain objects with stable key order as constructed) keeps sign and verify
 * byte-identical. The verb prefix mirrors the do-access.ts convention so an
 * entry signature can never be replayed as a connect or grant token.
 */
export function canonicalEntryMessage(
  entry: Omit<LabLogEntry, "signature">,
): string {
  return [
    "lab-log",
    String(entry.seq),
    entry.type,
    String(entry.keyGeneration),
    JSON.stringify(entry.roster),
    JSON.stringify(entry.subject ?? null),
    String(entry.issuedAt),
    entry.prevHash,
  ].join("\n");
}

/** SHA-256 hex of an entry's signature, used as the next entry's prevHash. */
export function hashEntrySignature(signatureHex: string): string {
  return bytesToHex(sha256(hexToBytes(signatureHex)));
}

/**
 * Signs and returns a complete log entry. The head's Ed25519 private key is the
 * only signer. prevHash and seq are computed by the caller from the existing log
 * (see appendLogEntry), this function just stamps and signs the supplied body.
 */
export function signLogEntry(
  body: Omit<LabLogEntry, "signature">,
  headEd25519PrivateKey: Uint8Array,
): LabLogEntry {
  const message = new TextEncoder().encode(canonicalEntryMessage(body));
  const signature = bytesToHex(ed25519.sign(message, headEd25519PrivateKey));
  return { ...body, signature };
}

/**
 * Appends a new signed entry to an existing log, computing seq and prevHash from
 * the current tail so the chain stays intact. Returns the new entry; the caller
 * splices it into the record. The head's private key is required because only
 * the head may extend the log.
 */
export function appendLogEntry(
  log: LabLogEntry[],
  body: Omit<LabLogEntry, "signature" | "seq" | "prevHash">,
  headEd25519PrivateKey: Uint8Array,
): LabLogEntry {
  const tail = log.length > 0 ? log[log.length - 1] : null;
  const seq = tail ? tail.seq + 1 : 0;
  const prevHash = tail ? hashEntrySignature(tail.signature) : "";
  return signLogEntry({ ...body, seq, prevHash }, headEd25519PrivateKey);
}

/** The outcome of verifying a membership log. */
export interface VerifyResult {
  ok: boolean;
  /** Human-readable reason when ok is false. Empty when ok is true. */
  reason: string;
}

/**
 * Verifies a lab record's membership log end to end.
 *
 * Checks, in order:
 *   1. The genesis entry is seq 0, type "create", prevHash "".
 *   2. Every entry's signature verifies under the head's Ed25519 public key.
 *      (The head is fixed at creation; a log signed by anyone else fails.)
 *   3. seq increments by one with no gaps or reordering.
 *   4. prevHash of each entry equals SHA-256(previous entry's signature), so the
 *      chain is unbroken and entries cannot be removed or shuffled.
 *   5. keyGeneration is non-decreasing and bumps exactly on create/rotate.
 *   6. The record's top-level keyGeneration and members match the final entry.
 *
 * Any single flipped byte (in a signature, a roster, a generation, a prevHash,
 * or a timestamp) breaks either a signature check or the hash chain, so
 * tampering is detected. Returns { ok, reason } rather than throwing so callers
 * can surface the reason.
 */
export function verifyMembershipLog(record: LabRecord): VerifyResult {
  const log = record.log;
  if (log.length === 0) {
    return { ok: false, reason: "empty log" };
  }

  const headPub = hexToBytes(record.head.ed25519PublicKey);

  let expectedGeneration = 0;
  let prevSignature = "";

  for (let i = 0; i < log.length; i += 1) {
    const entry = log[i];

    if (entry.seq !== i) {
      return { ok: false, reason: `seq gap or reorder at index ${i}` };
    }

    if (i === 0) {
      if (entry.type !== "create") {
        return { ok: false, reason: "genesis entry is not type create" };
      }
      if (entry.prevHash !== "") {
        return { ok: false, reason: "genesis prevHash is not empty" };
      }
    } else {
      const wantPrev = hashEntrySignature(prevSignature);
      if (entry.prevHash !== wantPrev) {
        return { ok: false, reason: `broken hash chain at seq ${entry.seq}` };
      }
      if (entry.type === "create") {
        return { ok: false, reason: `unexpected second create at seq ${entry.seq}` };
      }
    }

    // Generation must bump by exactly one on create/rotate and stay put on
    // add/remove. This catches a forged generation jump even if the signature
    // were somehow valid.
    const wantGeneration =
      entry.type === "create" || entry.type === "rotate"
        ? expectedGeneration + (i === 0 ? 0 : 1)
        : expectedGeneration;
    // Genesis create establishes generation 0.
    const expected = i === 0 ? 0 : wantGeneration;
    if (entry.keyGeneration !== expected) {
      return {
        ok: false,
        reason: `unexpected keyGeneration ${entry.keyGeneration} at seq ${entry.seq}, wanted ${expected}`,
      };
    }
    expectedGeneration = entry.keyGeneration;

    // Verify the signature LAST for this entry, over the canonical message of
    // everything but the signature. A flipped byte anywhere above also changes
    // this message, so this is the catch-all tamper check.
    const { signature, ...bodyForSig } = entry;
    const message = new TextEncoder().encode(canonicalEntryMessage(bodyForSig));
    let sigOk = false;
    try {
      sigOk = ed25519.verify(hexToBytes(signature), message, headPub);
    } catch {
      sigOk = false;
    }
    if (!sigOk) {
      return { ok: false, reason: `bad signature at seq ${entry.seq}` };
    }

    prevSignature = entry.signature;
  }

  const finalEntry = log[log.length - 1];
  if (record.keyGeneration !== finalEntry.keyGeneration) {
    return { ok: false, reason: "record keyGeneration does not match final entry" };
  }
  if (
    JSON.stringify(record.members) !== JSON.stringify(finalEntry.roster)
  ) {
    return { ok: false, reason: "record members do not match final entry roster" };
  }

  return { ok: true, reason: "" };
}

/**
 * True when pubkeyHex (hex Ed25519 signing key) is the lab head or a listed
 * member of the lab record. Uses the real LabRecord shape where head is a
 * LabMember with ed25519PublicKey and members is an array of LabMember. The
 * data routes check this server-side against the roster fetched from the
 * LabRecordDO, and the client checks it locally. Comparison is case-insensitive.
 */
export function isLabMemberOrHead(
  record: LabRecord,
  pubkeyHex: string,
): boolean {
  const target = pubkeyHex.toLowerCase();
  if (record.head.ed25519PublicKey.toLowerCase() === target) return true;
  return record.members.some(
    (m) => m.ed25519PublicKey.toLowerCase() === target,
  );
}
