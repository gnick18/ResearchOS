// Lab tier (cross-folder group), the lab key crypto core.
//
// A lab's data is end-to-end encrypted under a single 32-byte symmetric LAB KEY.
// The PI (lab head) co-owns that key by construction, so the PI is ALWAYS a
// recipient and can read every member's lab data. Our server never sees the lab
// key in plaintext; it is only ever sealed to identity public keys or used as a
// symmetric AEAD key client-side.
//
// CRITICAL: this module composes the project's existing audited primitives and
// writes NO new low-level crypto.
//   - sealToRecipient / openSealed (lib/sharing/encryption.ts), the X25519
//     sealed-box, distributes the lab key to each member's and the PI's
//     encryption public key.
//   - sealUnderOneTimeKey-style symmetric AEAD for bulk lab data is provided
//     here by encryptLabData / decryptLabData, which call the SAME
//     XChaCha20-Poly1305 construction by reusing sealUnderOneTimeKey's symmetric
//     core through a thin wrapper. We do NOT mint a fresh key (we use the lab
//     key), so we cannot call sealUnderOneTimeKey directly (it generates its own
//     key); instead we reuse openWithOneTimeKey for decrypt and mirror its exact
//     nonce-prepend format for encrypt with the same cipher import. No new AEAD
//     is invented, only the supplied-key seal that the invite path deliberately
//     did not expose.
//   - the backup.ts wrap/unwrap (Argon2id + XChaCha20-Poly1305) and the
//     BackupBlob shape provide the PI recovery wrap, reusing the exact recovery
//     code path the identity keys already use.
//   - the membership log (lab-membership.ts) records every generation in a
//     head-signed, hash-chained, tamper-evident audit trail.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import {
  concatBytes,
  randomBytes,
  bytesToHex,
  hexToBytes,
} from "@noble/hashes/utils.js";
import {
  sealToRecipient,
  openSealed,
} from "@/lib/sharing/encryption";
import {
  deriveWrappingKey,
  wrapKeys,
  unwrapKeys,
  makeBackupBlob,
  openBackupBlob,
  type BackupBlob,
  type KdfParams,
} from "@/lib/sharing/identity/backup";
import {
  appendLogEntry,
  type LabMember,
  type LabRecord,
} from "./lab-membership";

export const LAB_KEY_LENGTH = 32; // XChaCha20-Poly1305 key length
const NONCE_LENGTH = 24; // XChaCha20-Poly1305 nonce length

// ---------------------------------------------------------------------------
// 1. Lab key generation.
// ---------------------------------------------------------------------------

/**
 * Generates a fresh random 32-byte lab key. This is the symmetric key all lab
 * data is encrypted under for the current generation. It never leaves the client
 * in plaintext, it is only sealed to identity public keys or used as the AEAD
 * key below.
 */
export function generateLabKey(): Uint8Array {
  return randomBytes(LAB_KEY_LENGTH);
}

// ---------------------------------------------------------------------------
// 2. Symmetric lab-data encryption under the lab key.
//
// Same XChaCha20-Poly1305 AEAD and nonce-prepend wire format as
// sealUnderOneTimeKey (lib/sharing/encryption.ts), but with the lab key supplied
// rather than freshly minted. Decrypt reuses openWithOneTimeKey's exact logic;
// we keep a local mirror only because sealUnderOneTimeKey insists on minting its
// own key. The cipher import is the same audited @noble primitive, no new AEAD.
// ---------------------------------------------------------------------------

/**
 * Encrypts lab data (already serialized to bytes by the caller) under a lab key
 * with XChaCha20-Poly1305. Generates a fresh random 24-byte nonce per call and
 * prepends it, so two encryptions of the same plaintext under the same key never
 * reuse a (key, nonce) pair. Output is nonce (24) || ciphertext, byte-compatible
 * with openWithOneTimeKey.
 *
 * @throws if labKey is not 32 bytes.
 */
export function encryptLabData(
  plaintext: Uint8Array,
  labKey: Uint8Array,
): Uint8Array {
  if (labKey.length !== LAB_KEY_LENGTH) {
    throw new Error(
      `encryptLabData: lab key must be ${LAB_KEY_LENGTH} bytes, got ${labKey.length}`,
    );
  }
  const nonce = randomBytes(NONCE_LENGTH);
  const ciphertext = xchacha20poly1305(labKey, nonce).encrypt(plaintext);
  return concatBytes(nonce, ciphertext);
}

/**
 * Decrypts data produced by encryptLabData given the lab key it was sealed
 * under. Parses the prepended nonce then decrypts. The Poly1305 tag throws on a
 * tampered ciphertext or a wrong key.
 *
 * @throws if labKey is not 32 bytes, the blob is too short, or auth fails.
 */
export function decryptLabData(
  blob: Uint8Array,
  labKey: Uint8Array,
): Uint8Array {
  if (labKey.length !== LAB_KEY_LENGTH) {
    throw new Error(
      `decryptLabData: lab key must be ${LAB_KEY_LENGTH} bytes, got ${labKey.length}`,
    );
  }
  if (blob.length < NONCE_LENGTH) {
    throw new Error(
      `decryptLabData: input too short, need at least ${NONCE_LENGTH} bytes, got ${blob.length}`,
    );
  }
  const nonce = blob.subarray(0, NONCE_LENGTH);
  const ciphertext = blob.subarray(NONCE_LENGTH);
  return xchacha20poly1305(labKey, nonce).decrypt(ciphertext);
}

// ---------------------------------------------------------------------------
// 3. Distributing the lab key to every member and the PI.
// ---------------------------------------------------------------------------

/**
 * One member's sealed copy of a lab-key generation. sealed is the opaque
 * sealToRecipient output, openable only with that member's X25519 private key.
 */
export interface SealedKeyCopy {
  username: string;
  /** Hex of the sealed bytes (epk || nonce || ct) from sealToRecipient. */
  sealed: string;
}

/**
 * The portable, server-storable envelope for ONE lab-key generation. It carries
 * a sealed copy of the lab key for every current recipient (members + the PI),
 * plus an optional seed-chain link binding the PREVIOUS generation's lab key
 * under THIS generation's lab key. The seed chain is what keeps historical data
 * readable to current members across rotations.
 *
 * Nothing here is plaintext-sensitive to the server: every copy is sealed to a
 * public key and the seed link is symmetric ciphertext under a key the server
 * never holds.
 */
export interface LabKeyEnvelope {
  generation: number;
  /** One sealed lab-key copy per recipient (members + PI), keyed by username. */
  copies: SealedKeyCopy[];
  /**
   * Hex of encryptLabData(previousLabKey, thisLabKey), present on every
   * generation after the first. Lets a holder of THIS generation's key recover
   * the PREVIOUS generation's key, and so on down the chain, to decrypt any
   * historical data. Absent on generation 0 (nothing precedes it).
   */
  seedLink?: string;
}

/**
 * Seals a lab key to every recipient's X25519 public key. The PI (record.head)
 * is ALWAYS included, even if somehow absent from members, so the PI can read
 * everything by construction. Returns one sealed copy per recipient.
 *
 * @param labKey the 32-byte lab key for this generation.
 * @param recipients the members to seal to. The head is force-added if missing.
 * @param head the PI, always a recipient.
 */
export function distributeLabKey(
  labKey: Uint8Array,
  recipients: LabMember[],
  head: LabMember,
): SealedKeyCopy[] {
  // Build the recipient set, head guaranteed present and de-duplicated by
  // username so the PI is sealed to exactly once even if also listed in members.
  const byUsername = new Map<string, LabMember>();
  byUsername.set(head.username, head);
  for (const r of recipients) {
    byUsername.set(r.username, r);
  }

  const copies: SealedKeyCopy[] = [];
  for (const member of byUsername.values()) {
    const pub = hexToBytes(member.x25519PublicKey);
    const sealed = sealToRecipient(labKey, pub);
    copies.push({ username: member.username, sealed: bytesToHex(sealed) });
  }
  return copies;
}

/**
 * Opens a member's (or the PI's) sealed copy of a lab key from an envelope, with
 * that user's X25519 private key. Returns the 32-byte lab key.
 *
 * @throws if there is no copy for this username, or if opening fails (the user
 *   is not a recipient, a tampered copy, or a wrong key). A non-member who is
 *   not in copies gets a clear "no sealed copy" error; a non-member who tampered
 *   a copy in fails the AEAD inside openSealed.
 */
export function openLabKeyCopy(
  envelope: LabKeyEnvelope,
  username: string,
  x25519PrivateKey: Uint8Array,
): Uint8Array {
  const copy = envelope.copies.find((c) => c.username === username);
  if (!copy) {
    throw new Error(`openLabKeyCopy: no sealed copy for username ${username}`);
  }
  return openSealed(hexToBytes(copy.sealed), x25519PrivateKey);
}

// ---------------------------------------------------------------------------
// 4. Seed chain, decrypting historical data across generations.
// ---------------------------------------------------------------------------

/**
 * Given the CURRENT generation's lab key and the ordered list of every
 * generation envelope (oldest to newest), walks the seed chain backwards to
 * recover the lab key of a TARGET (older or equal) generation. A current member
 * (or the PI) holds the current key, opens the current envelope's seedLink to
 * get the previous generation's key, repeats, and so reaches any past key.
 *
 * @param currentLabKey the lab key for currentGeneration.
 * @param currentGeneration the generation currentLabKey belongs to.
 * @param targetGeneration the generation whose key we want (<= currentGeneration).
 * @param envelopesByGeneration a lookup of every generation's envelope. Each
 *   envelope[g].seedLink is encryptLabData(key[g-1], key[g]).
 * @returns the 32-byte lab key for targetGeneration.
 * @throws if targetGeneration > currentGeneration, or a needed seedLink/envelope
 *   is missing, or a seed link fails to decrypt (tamper).
 */
export function recoverGenerationKey(
  currentLabKey: Uint8Array,
  currentGeneration: number,
  targetGeneration: number,
  envelopesByGeneration: Map<number, LabKeyEnvelope>,
): Uint8Array {
  if (targetGeneration > currentGeneration) {
    throw new Error(
      `recoverGenerationKey: target generation ${targetGeneration} is newer than current ${currentGeneration}`,
    );
  }
  let key = currentLabKey;
  for (let g = currentGeneration; g > targetGeneration; g -= 1) {
    const envelope = envelopesByGeneration.get(g);
    if (!envelope || !envelope.seedLink) {
      throw new Error(
        `recoverGenerationKey: missing seed link for generation ${g}`,
      );
    }
    // seedLink[g] = encryptLabData(key[g-1], key[g]); opening it with key[g]
    // yields key[g-1]. Decrypt throws on tamper or a wrong key.
    key = decryptLabData(hexToBytes(envelope.seedLink), key);
  }
  return key;
}

// ---------------------------------------------------------------------------
// 5. Rotation on departure.
// ---------------------------------------------------------------------------

/** The result of a rotation, the new key plus the updated record and envelope. */
export interface RotationResult {
  /** The fresh lab key for the new generation. Held by remaining members + PI. */
  newLabKey: Uint8Array;
  /** The new generation's envelope (sealed to remaining members + PI, with the
   *  seed link binding the old key under the new key). */
  envelope: LabKeyEnvelope;
  /** The record with the departing member removed, generation bumped, and a
   *  signed "rotate" entry appended to the membership log. */
  record: LabRecord;
}

/**
 * Rotates the lab key when a member departs.
 *
 * Effects:
 *   1. Generates a NEW lab key.
 *   2. Seals the new key ONLY to the remaining members + the PI. The departing
 *      member gets NO copy, so they cannot decrypt anything encrypted under the
 *      new generation.
 *   3. Seed-chains by encrypting the OLD lab key under the NEW lab key
 *      (envelope.seedLink). A remaining member who holds the new key can walk
 *      the chain to recover any past key and so keep reading historical data.
 *   4. Increments keyGeneration on the record.
 *   5. Appends a head-signed "rotate" entry to the membership log (the audit
 *      trail), with the departing member as the subject and the new roster.
 *
 * The departing member, lacking the new sealed copy AND not being in the new
 * roster, is cryptographically excluded from new data while the seed chain keeps
 * old data readable to the people who remain.
 *
 * @param currentRecord the lab record before departure (its keyGeneration is the
 *   generation currentLabKey belongs to).
 * @param currentLabKey the current (old) lab key.
 * @param departingUsername the member who is leaving.
 * @param headEd25519PrivateKey the PI's signing key, the sole log signer.
 * @throws if the departing member is the head, or is not in the roster.
 */
export function rotateLabKey(
  currentRecord: LabRecord,
  currentLabKey: Uint8Array,
  departingUsername: string,
  headEd25519PrivateKey: Uint8Array,
): RotationResult {
  if (departingUsername === currentRecord.head.username) {
    throw new Error("rotateLabKey: cannot rotate out the lab head");
  }
  const departing = currentRecord.members.find(
    (m) => m.username === departingUsername,
  );
  if (!departing) {
    throw new Error(
      `rotateLabKey: ${departingUsername} is not a member of this lab`,
    );
  }

  const remaining = currentRecord.members.filter(
    (m) => m.username !== departingUsername,
  );
  const newGeneration = currentRecord.keyGeneration + 1;
  const newLabKey = generateLabKey();

  // Seal the new key to remaining members + the PI only.
  const copies = distributeLabKey(newLabKey, remaining, currentRecord.head);

  // Seed-chain: bind the OLD key under the NEW key so current holders reach the
  // past. seedLink = encryptLabData(oldKey, newKey).
  const seedLink = bytesToHex(encryptLabData(currentLabKey, newLabKey));

  const envelope: LabKeyEnvelope = {
    generation: newGeneration,
    copies,
    seedLink,
  };

  // Append the signed rotate entry. The new roster is the remaining members
  // (head is always part of the lab, kept in record.head and included as a
  // sealed recipient; rosters list the non-head members consistent with how the
  // create entry was built by createLab below).
  const rotateEntry = appendLogEntry(
    currentRecord.log,
    {
      type: "rotate",
      keyGeneration: newGeneration,
      roster: remaining,
      subject: departing,
      issuedAt: Date.now(),
    },
    headEd25519PrivateKey,
  );

  const record: LabRecord = {
    ...currentRecord,
    members: remaining,
    keyGeneration: newGeneration,
    log: [...currentRecord.log, rotateEntry],
  };

  return { newLabKey, envelope, record };
}

// ---------------------------------------------------------------------------
// 6. PI recovery of the lab key (survives device loss without a lockout trap).
//
// The trap to avoid, if the lab key were recoverable ONLY by unwrapping some
// member's device-held identity key, then losing every recovery-holder's device
// at once would orphan the lab. We dodge it by giving the HEAD an independent,
// device-free wrap of the lab key under the head's OWN recovery factor (the same
// Argon2id + XChaCha20-Poly1305 BackupBlob the identity keys already use, with a
// device-independent salt, deviceSalt null). The head can restore the lab key on
// a brand-new device from that recovery factor alone, with no surviving device
// and no other member's cooperation. That single, always-present, device-free
// custody point is what makes the all-recoverers-locked-out bootstrap impossible
// for the head, and the head is always a lab-key recipient, so the head can
// re-seal copies to everyone after a recovery.
//
// This mirrors the locked custody decision in IDENTITY_LAB_LOGIN.md (the head
// always holds a recovery wrap independent of any single device). Reuses
// backup.ts verbatim, no new crypto.
// ---------------------------------------------------------------------------

/**
 * Wraps the lab key under the head's recovery factor (their Recovery Words or
 * recovery code, supplied verbatim as the passphrase). Uses the project's
 * Argon2id + XChaCha20-Poly1305 backup blob with a device-INDEPENDENT salt
 * (deviceSalt null), so the head can unwrap on any fresh device from the
 * recovery factor alone. Returns a serializable BackupBlob.
 *
 * The head holds THIS independently of any device-held identity key, which is
 * exactly what dodges the all-recoverers-locked-out bootstrap trap.
 *
 * @param labKey the 32-byte lab key to protect.
 * @param recoveryFactor the head's recovery words / code, verbatim passphrase.
 * @param salt a fresh KDF salt (generateSalt from backup.ts), stored in the blob.
 * @param params Argon2id params. Tests pass fast params; production passes the
 *   heavy PROD_KDF_PARAMS and runs this off the main thread.
 */
export function wrapLabKeyForHeadRecovery(
  labKey: Uint8Array,
  recoveryFactor: string,
  salt: Uint8Array,
  params: KdfParams,
): BackupBlob {
  if (labKey.length !== LAB_KEY_LENGTH) {
    throw new Error(
      `wrapLabKeyForHeadRecovery: lab key must be ${LAB_KEY_LENGTH} bytes`,
    );
  }
  const wrappingKey = deriveWrappingKey(recoveryFactor, salt, null, params);
  const wrapped = wrapKeys(labKey, wrappingKey);
  return makeBackupBlob(wrapped, salt, params);
}

/**
 * Recovers the lab key from a head-recovery blob and the head's recovery factor.
 * Re-derives the wrapping key from the verbatim recovery factor and the blob's
 * stored salt (deviceSalt null), then unwraps. The Poly1305 tag throws on a
 * wrong recovery factor or a tampered blob.
 *
 * @returns the 32-byte lab key.
 * @throws on a wrong recovery factor or tampered blob (auth failure).
 */
export function recoverLabKeyFromHead(
  blob: BackupBlob,
  recoveryFactor: string,
): Uint8Array {
  const opened = openBackupBlob(blob);
  const wrappingKey = deriveWrappingKey(
    recoveryFactor,
    opened.salt,
    null,
    opened.params,
  );
  return unwrapKeys(opened.ciphertext, opened.nonce, wrappingKey);
}

// ---------------------------------------------------------------------------
// Convenience, create a lab from scratch (genesis record + generation-0
// envelope). Composes the membership log genesis entry with the first key
// distribution, so tests and later phases have one entry point.
// ---------------------------------------------------------------------------

/** The output of createLab, the genesis record, the gen-0 envelope, and the key. */
export interface CreatedLab {
  record: LabRecord;
  envelope: LabKeyEnvelope;
  labKey: Uint8Array;
}

/**
 * Creates a brand-new lab. Generates the lab key, seals it to the initial
 * members + the head, and signs the genesis "create" log entry. keyGeneration
 * starts at 0 and the genesis envelope has no seed link (nothing precedes it).
 *
 * @param labId stable opaque lab id.
 * @param head the PI (role "head").
 * @param members the initial non-head members (role "member").
 * @param headEd25519PrivateKey the PI's signing key.
 * @param opts.labKey an existing 32-byte lab key to use instead of generating a
 *   fresh one. The caller injects this when it must derive something from the
 *   key BEFORE the genesis roster is signed, e.g. the head's lab-key-encrypted
 *   email binding (lab-create.ts, Phase 8a), so the binding rides inside the
 *   head-signed roster. When omitted, a fresh key is generated as before.
 */
export function createLab(
  labId: string,
  head: LabMember,
  members: LabMember[],
  headEd25519PrivateKey: Uint8Array,
  opts?: { labKey?: Uint8Array },
): CreatedLab {
  const labKey = opts?.labKey ?? generateLabKey();
  if (labKey.length !== LAB_KEY_LENGTH) {
    throw new Error(
      `createLab: provided lab key must be ${LAB_KEY_LENGTH} bytes, got ${labKey.length}`,
    );
  }
  const copies = distributeLabKey(labKey, members, head);
  const envelope: LabKeyEnvelope = { generation: 0, copies };

  const genesis = appendLogEntry(
    [],
    {
      type: "create",
      keyGeneration: 0,
      roster: members,
      issuedAt: Date.now(),
    },
    headEd25519PrivateKey,
  );

  const record: LabRecord = {
    labId,
    head,
    members,
    keyGeneration: 0,
    log: [genesis],
  };

  return { record, envelope, labKey };
}

/**
 * Adds a member to a lab WITHOUT rotating the key (an addition does not require
 * a new generation, the existing key is simply sealed to the newcomer too).
 * Appends a head-signed "add" entry and returns the updated record plus the
 * newcomer's sealed copy of the CURRENT lab key.
 *
 * @returns the updated record and the new member's SealedKeyCopy for the current
 *   generation, which the caller splices into the current envelope's copies.
 */
export function addMember(
  currentRecord: LabRecord,
  currentLabKey: Uint8Array,
  newMember: LabMember,
  headEd25519PrivateKey: Uint8Array,
): { record: LabRecord; copy: SealedKeyCopy } {
  if (currentRecord.members.some((m) => m.username === newMember.username)) {
    throw new Error(`addMember: ${newMember.username} is already a member`);
  }
  const members = [...currentRecord.members, newMember];
  const entry = appendLogEntry(
    currentRecord.log,
    {
      type: "add",
      keyGeneration: currentRecord.keyGeneration,
      roster: members,
      subject: newMember,
      issuedAt: Date.now(),
    },
    headEd25519PrivateKey,
  );
  const sealed = sealToRecipient(
    currentLabKey,
    hexToBytes(newMember.x25519PublicKey),
  );
  const copy: SealedKeyCopy = {
    username: newMember.username,
    sealed: bytesToHex(sealed),
  };
  const record: LabRecord = {
    ...currentRecord,
    members,
    log: [...currentRecord.log, entry],
  };
  return { record, copy };
}

/**
 * Phase C2 (PI re-admit, docs/proposals/2026-06-15-account-folder-identity-redesign.md
 * §4.4 / §6c): re-admit an EXISTING member who reset their identity (Phase C1
 * resetIdentityKeepData) and now holds a fresh keypair. Their old roster entry's
 * keys are stale, so the lab key sealed to the old x25519 key can no longer be
 * opened by them, and nothing new can be sealed to them until the head admits
 * the new keys.
 *
 * This is composed from the two existing, audited primitives rather than a new
 * signed-log event type (which would change canonicalEntryMessage +
 * verifyMembershipLog — the tamper-evident schema we deliberately do not touch
 * here): a `rotate` evicts the stale keys (new generation, sealed only to the
 * remaining members + PI, seed-linked so historical lab data stays readable),
 * then an `add` re-admits the SAME username with the new keys, sealing the new
 * generation's key to the new x25519 key. The lost old key is therefore
 * cryptographically excluded from everything sealed after the re-admit, which is
 * the correct posture for a key the member can no longer hold.
 *
 * The re-admitted member regains lab data (current + historical via the seed
 * chain) once they hold the new key. Person-to-person shares sealed directly to
 * their OLD identity key remain unreadable — that loss is inherent to the reset
 * and is what the Phase C1 confirmation warns about.
 *
 * @param currentRecord the lab record before the re-admit.
 * @param currentLabKey the current lab key (the generation currentRecord is at).
 * @param username the existing member to re-admit (must be a non-head member).
 * @param newKeys the member's NEW public keys, harvested from their re-published
 *   directory profile / sidecar by the caller (verify the fingerprint there).
 * @param headEd25519PrivateKey the PI's signing key, the sole log signer.
 * @throws if the username is the head or is not currently a member.
 */
export function readmitMember(
  currentRecord: LabRecord,
  currentLabKey: Uint8Array,
  username: string,
  newKeys: { x25519PublicKey: string; ed25519PublicKey: string },
  headEd25519PrivateKey: Uint8Array,
): RotationResult {
  if (username === currentRecord.head.username) {
    throw new Error("readmitMember: cannot re-admit the lab head");
  }
  const existing = currentRecord.members.find((m) => m.username === username);
  if (!existing) {
    throw new Error(
      `readmitMember: ${username} is not a member of this lab`,
    );
  }

  // 1. Rotate the stale keys out (new generation, seed-linked to the past).
  const rotated = rotateLabKey(
    currentRecord,
    currentLabKey,
    username,
    headEd25519PrivateKey,
  );

  // 2. Re-add the same member with their new keys, preserving role + any
  //    existing email binding (the human-identity layer survives a key reset).
  const readmitted: LabMember = {
    ...existing,
    x25519PublicKey: newKeys.x25519PublicKey,
    ed25519PublicKey: newKeys.ed25519PublicKey,
  };
  const { record, copy } = addMember(
    rotated.record,
    rotated.newLabKey,
    readmitted,
    headEd25519PrivateKey,
  );

  return {
    newLabKey: rotated.newLabKey,
    envelope: { ...rotated.envelope, copies: [...rotated.envelope.copies, copy] },
    record,
  };
}
