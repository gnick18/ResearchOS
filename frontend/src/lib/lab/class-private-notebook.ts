// Class Mode Stage C: subkey at-rest write + read for the PRIVATE student notebook.
//
// THE THREAT (scope critic C3). A private student notebook must NOT be readable by
// a classmate who holds the team key. The generic lab-sync path seals every record
// under the team key, so a notebook pushed that way is classmate-readable. This
// module is the DEDICATED, contained write path that seals the private notebook
// under the student's per-student SUBKEY (lab-subkey.ts) instead, plus the read
// resolver that peels that subkey on the way back, WITHOUT touching the generic
// lab-sync.ts team-key path.
//
// HOW IT STAYS CONTAINED. The SubkeyedRecord (blob sealed under the subkey, plus
// the sealed-to-student-and-head envelope) is serialized to JSON and handed to
// putLabRecord AS THE PLAINTEXT. putLabRecord then AEAD-seals that JSON under the
// team key on top (its invariant, unchanged). So a classmate peels the outer team
// layer (they hold the team key) and hits the INNER subkey wall: no classmate copy
// of the subkey exists, so decryptClassRecord throws for them. The student and the
// head each hold a sealed subkey copy and read it.
//
// SUBKEY REUSE. One subkey per student per class. Before minting a fresh subkey,
// recoverExistingSubkey lists the student's class records and opens any prior
// private record's envelope with the writer's x25519 key. Mint only when none
// exists. The student threads the same subkey across all their private records.
//
// FENCE NOTE (class-live-wiring lane). This module is the contained crypto core +
// transport for the private notebook. It is deliberately NOT yet wired into the
// generic enumerate/sync/pull orchestration, because making that SHARED path
// subkey-aware (partitioning the private notebook OUT of the team-key push, and
// threading the viewer x25519 private key + the relay roster + the assignment
// visibility into lab-sync.ts / lab-view-pull-runner.ts / the session state) is
// the fenced design follow-up. See the lane report. These functions are the ready
// building blocks for that follow-up, proven by round-trip tests on real keys.
//
// FLAG: gated behind NEXT_PUBLIC_CLASS_MODE. Flag off, every export refuses (write)
// or passes through unchanged (read), so a flag-off build is byte-identical.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { putLabRecord, getLabRecord, listLabRecords } from "./lab-data-client";
import {
  encryptPrivateRecord,
  decryptClassRecord,
  openSubkeyCopy,
  reSealEnvelopeForStudent,
  type SubkeyedRecord,
  type SubkeyEnvelope,
} from "./lab-subkey";
import { CLASS_MODE_ENABLED } from "./class-mode-config";
import { WHOLE_LAB_SENTINEL } from "@/lib/sharing/unified";
import type { LabMember } from "./lab-membership";

/**
 * Type guard: a parsed value is a SubkeyedRecord WITH a subkey envelope (a private
 * record). A plain task / collaborative record has no `blob`+`subkey` pair and is
 * handled by the team-key path. Defensive against arbitrary JSON.
 */
export function isSubkeyedPrivateRecord(value: unknown): value is SubkeyedRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.blob !== "string") return false;
  const env = v.subkey;
  if (typeof env !== "object" || env === null) return false;
  const e = env as Record<string, unknown>;
  return typeof e.owner === "string" && Array.isArray(e.copies);
}

/**
 * PARTITION PREDICATE (the single source of truth for the WRITE side). Returns
 * true iff a record is a PRIVATE student notebook that must be diverted OUT of
 * the generic team-key push and sealed under the student's per-student subkey.
 *
 * The predicate is total and conservative. A record is a private class notebook
 * iff ALL of these hold:
 *   1. recordType === "task" (the per-student notebook is a student-owned task),
 *   2. the canonical task JSON carries a NON-EMPTY string `assignment_id` (the
 *      back-link to the instructor-owned assignment, Task.assignment_id, CT-2),
 *   3. it is NOT a COLLABORATIVE class task. Collaborative notebooks ride the
 *      team key and are seeded with a whole-lab share ("*") by the class
 *      visibility policy (seedSharedWithForVisibility, class-dashboard.ts:
 *      collaborative -> ["*"], private -> []). So a class task whose shared_with
 *      contains the "*" whole-lab sentinel is collaborative and stays on the
 *      team-key path; the ABSENCE of "*" marks it private.
 *
 * WHY shared_with rather than a visibility field: the persisted Task has no
 * direct visibility field (types.ts); the create-time visibility is encoded in
 * the seeded shared_with per CT-5. Reading shared_with is therefore the exact,
 * already-persisted signal, and it keeps the predicate decidable from the
 * canonical bytes alone (the only thing the sync engine sees).
 *
 * EXCLUSIVITY: this predicate is the partition's sole arbiter. Every record for
 * which it returns false rides the unchanged team-key loop; every record for
 * which it returns true rides the subkey write path. A record can never satisfy
 * both, so a private notebook is pushed by exactly one path (no double-push, no
 * team-key leak alongside the subkey copy).
 *
 * Flag off (NEXT_PUBLIC_CLASS_MODE), ALWAYS returns false, so the partition is a
 * no-op and every record stays on the team-key path, byte-identical to today.
 *
 * @param recordType the record's type segment (only "task" can be a notebook).
 * @param canonicalPlaintext the canonical record JSON bytes (the sync payload).
 */
export function isPrivateClassNotebookRecord(
  recordType: string,
  canonicalPlaintext: Uint8Array,
): boolean {
  if (!CLASS_MODE_ENABLED) return false;
  if (recordType !== "task") return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(canonicalPlaintext));
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) return false;
  const rec = parsed as Record<string, unknown>;
  const assignmentId = rec["assignment_id"];
  if (typeof assignmentId !== "string" || assignmentId.length === 0) {
    // Not a class notebook (no assignment back-link): team-key path.
    return false;
  }
  // Collaborative class tasks carry the "*" whole-lab sentinel in shared_with
  // (seedSharedWithForVisibility). Their presence marks collaborative -> team
  // key. Their ABSENCE marks the private notebook -> subkey path.
  const sw = rec["shared_with"];
  if (Array.isArray(sw)) {
    for (const entry of sw) {
      if (sharedEntryIsWholeLab(entry)) {
        // Collaborative class task: stays on the team-key path.
        return false;
      }
    }
  }
  return true;
}

/**
 * True iff one shared_with entry is the "*" whole-lab sentinel, in any of the
 * supported entry shapes (bare string, `{ username: "*" }`, legacy `{ user }`).
 * Mirrors sharedEntryName + the WHOLE_LAB_SENTINEL check in lab-read.ts so the
 * predicate reads the seeded shared_with exactly the way the read path does.
 */
function sharedEntryIsWholeLab(entry: unknown): boolean {
  if (typeof entry === "string") return entry === WHOLE_LAB_SENTINEL;
  if (typeof entry === "object" && entry !== null) {
    const e = entry as Record<string, unknown>;
    if (typeof e["username"] === "string") return e["username"] === WHOLE_LAB_SENTINEL;
    if (typeof e["user"] === "string") return e["user"] === WHOLE_LAB_SENTINEL;
  }
  return false;
}

/**
 * READ RESOLVER. Given the plaintext bytes a class record decrypted to under the
 * TEAM key (what getLabRecord / pullLabView hand back), resolve the final cleartext:
 *   - If the bytes parse to a SubkeyedRecord WITH a subkey envelope, peel the inner
 *     subkey layer via decryptClassRecord (only the student and the head can; a
 *     classmate throws). Returns the notebook cleartext bytes.
 *   - Otherwise (a plain record, or non-JSON), pass the bytes through UNCHANGED.
 *
 * This is backward compatible by construction: a record that is not a subkeyed
 * private record is returned byte-identical, so existing team-key records are
 * untouched. The viewer must supply their x25519 private key to open their subkey
 * copy.
 *
 * @param teamDecryptedPlaintext the bytes a class record yielded under the team key.
 * @param viewer the reader's username + x25519 private key.
 * @param teamKey the lab team key (unused for a subkeyed record, passed through to
 *   decryptClassRecord which only consults it for the non-subkeyed branch).
 */
export function resolvePulledClassRecord(
  teamDecryptedPlaintext: Uint8Array,
  viewer: { username: string; x25519PrivateKey: Uint8Array },
  teamKey: Uint8Array,
): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(teamDecryptedPlaintext));
  } catch {
    // Not JSON: a markdown mirror or opaque payload. Pass through unchanged.
    return teamDecryptedPlaintext;
  }
  if (!isSubkeyedPrivateRecord(parsed)) {
    // A plain task / collaborative record: byte-identical to today.
    return teamDecryptedPlaintext;
  }
  // A private, subkey-sealed record. Peel the inner subkey layer.
  return decryptClassRecord(parsed, viewer, teamKey);
}

/**
 * SUBKEY RECOVERY. One subkey per student per class. Lists the student's class
 * records under the lab prefix and opens the FIRST prior private record's envelope
 * with the writer's x25519 key, returning the recovered subkey. Returns null when
 * the student has no prior private record (the caller then mints a fresh subkey).
 *
 * The writer is normally the student (recovering their own subkey to reuse it), but
 * the head can also recover a student's subkey to re-seal, since the head holds a
 * sealed copy in every envelope. recoverFor names whose sealed copy to open.
 *
 * @param params.labId the class lab id.
 * @param params.student the student whose private records to scan (the owner prefix).
 * @param params.recoverFor the reader opening a copy (student or head username).
 * @param params.x25519PrivateKey the reader's x25519 private key.
 * @param params.signer the writer's Ed25519 signing keypair (lists are signed).
 * @returns the recovered 32-byte subkey, or null when none exists.
 */
export async function recoverExistingSubkey(params: {
  labId: string;
  student: string;
  recoverFor: string;
  x25519PrivateKey: Uint8Array;
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  listImpl?: typeof listLabRecords;
  getImpl?: typeof getLabRecord;
  teamKey: Uint8Array;
  fetchImpl?: typeof fetch;
}): Promise<Uint8Array | null> {
  const doList = params.listImpl ?? listLabRecords;
  const doGet = params.getImpl ?? getLabRecord;

  const keys = await doList({
    labId: params.labId,
    prefix: params.student + "/",
    signerEd25519Priv: params.signerEd25519Priv,
    signerEd25519Pub: params.signerEd25519Pub,
    fetchImpl: params.fetchImpl,
  });

  for (const key of [...keys].sort()) {
    const parts = key.split("/");
    if (parts.length !== 4) continue;
    const [, owner, recordType, recordId] = parts;
    let teamPlaintext: Uint8Array;
    try {
      teamPlaintext = await doGet({
        labId: params.labId,
        owner,
        recordType,
        recordId,
        labKey: params.teamKey,
        fetchImpl: params.fetchImpl,
      });
    } catch {
      continue; // unreadable record: skip, try the next
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(teamPlaintext));
    } catch {
      continue;
    }
    if (!isSubkeyedPrivateRecord(parsed)) continue;
    const envelope: SubkeyEnvelope = parsed.subkey!;
    // Only this student's own private records carry a subkey we want to reuse.
    if (envelope.owner !== params.student) continue;
    try {
      return openSubkeyCopy(envelope, params.recoverFor, params.x25519PrivateKey);
    } catch {
      // No copy for this reader, or a tampered envelope: keep scanning.
      continue;
    }
  }
  return null;
}

/**
 * DEDICATED WRITE PATH. Seal the private notebook under the student's per-student
 * subkey and PUT it. Does NOT touch lab-sync.ts: it calls encryptPrivateRecord then
 * putLabRecord directly, handing the SubkeyedRecord JSON as the plaintext so
 * putLabRecord's own team-key AEAD wraps it (the classmate hits the inner subkey
 * wall). Recovers an existing per-student subkey first (one subkey per student per
 * class); mints only when none exists.
 *
 * INVARIANT (C2): owner is ALWAYS the student. The notebook lives under the
 * student's own owner-prefix; the head never authors it.
 *
 * Flag off, refuses cleanly (no write), byte-identical to today.
 *
 * @returns the subkey used (mint-once, then thread) so the caller can reuse it.
 */
export async function writePrivateNotebookRecord(params: {
  labId: string;
  /** The student (the record owner + the subkey owner). INVARIANT: never the head. */
  student: LabMember;
  /** The instructor (head), always a co-recipient of the subkey. */
  head: LabMember;
  /** The notebook record type + id (the student's task). */
  recordType: string;
  recordId: string;
  /** The notebook cleartext bytes (the canonical task JSON). */
  plaintext: Uint8Array;
  /** The team key (putLabRecord seals the SubkeyedRecord JSON under it). */
  teamKey: Uint8Array;
  /** The student's lab signing keypair (the relay verifies the signer). */
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  /** The student's x25519 private key, to recover their existing subkey. */
  x25519PrivateKey: Uint8Array;
  putImpl?: typeof putLabRecord;
  listImpl?: typeof listLabRecords;
  getImpl?: typeof getLabRecord;
  fetchImpl?: typeof fetch;
}): Promise<{ subkey: Uint8Array } | { refused: true; reason: string }> {
  if (!CLASS_MODE_ENABLED) {
    return { refused: true, reason: "class mode is disabled (NEXT_PUBLIC_CLASS_MODE off)" };
  }
  const put = params.putImpl ?? putLabRecord;

  // Recover the student's existing per-student subkey (reuse one per class), or
  // mint a fresh one inside encryptPrivateRecord when none exists.
  const existing = await recoverExistingSubkey({
    labId: params.labId,
    student: params.student.username,
    recoverFor: params.student.username,
    x25519PrivateKey: params.x25519PrivateKey,
    signerEd25519Priv: params.signerEd25519Priv,
    signerEd25519Pub: params.signerEd25519Pub,
    teamKey: params.teamKey,
    listImpl: params.listImpl,
    getImpl: params.getImpl,
    fetchImpl: params.fetchImpl,
  });

  const { record, subkey } = encryptPrivateRecord(
    params.plaintext,
    params.student,
    params.head,
    existing ? { subkey: existing } : undefined,
  );

  // The SubkeyedRecord JSON IS the plaintext handed to putLabRecord. putLabRecord
  // wraps it under the team key; the inner blob stays subkey-sealed.
  await put({
    labId: params.labId,
    owner: params.student.username,
    recordType: params.recordType,
    recordId: params.recordId,
    plaintext: new TextEncoder().encode(JSON.stringify(record)),
    labKey: params.teamKey,
    signerEd25519Priv: params.signerEd25519Priv,
    signerEd25519Pub: params.signerEd25519Pub,
    fetchImpl: params.fetchImpl,
  });

  return { subkey };
}

/**
 * IDENTITY-RESET RE-SEAL (head-side orchestration, the fast-follow). When a student
 * resets their identity, readmitMember rotates the team key and re-admits them under
 * a NEW x25519 key, but their existing private-notebook subkey envelopes still seal
 * the subkey to their OLD x25519 key, so they lose access to their own prior private
 * work until each envelope is re-sealed. The head co-holds every subkey, so the head
 * can recover and re-seal each one to the student's new key. Invoke this after a
 * successful re-admit (readmitMemberRemote ok), from the head's session.
 *
 * For each of the student's subkeyed private records:
 *   1. read it under oldTeamKey (the generation it was written under, pre-rotation),
 *   2. re-seal ONLY the student's subkey copy to their NEW x25519 public key (the
 *      head's copy and the inner subkey-sealed blob are byte-identical, see
 *      reSealEnvelopeForStudent), then
 *   3. re-PUT it sealed under newTeamKey (the post-rotation generation the
 *      re-admitted student holds directly), HEAD-signed (the relay accepts a head
 *      write to a member's owner-prefix, rosterAllows is head-or-member, it does not
 *      tie the signer to the owner), owner unchanged (the student).
 *
 * Sealing the OUTER layer under newTeamKey means the re-admitted student, who holds
 * newTeamKey + their new x25519, peels both layers with the keys they actually have,
 * with no dependence on seed-chain derivation of an old generation. The FERPA
 * boundary is preserved throughout, a classmate never gains a subkey copy.
 *
 * Best-effort and idempotent. A record that fails to read (wrong generation, gone)
 * is skipped, not fatal, so a partial run can be safely re-invoked. The re-admit
 * itself has already committed, so a failure here never unwinds it. Flag off
 * (NEXT_PUBLIC_CLASS_MODE), refuses cleanly with no I/O, byte-identical to today.
 *
 * @returns the count of records re-sealed, or a refusal when the flag is off.
 */
export async function reSealPrivateNotebooksForStudent(params: {
  labId: string;
  /** The student who reset identity (the owner-prefix + the subkey owner). */
  student: { username: string; newX25519PublicKey: string };
  /** The head reader, username + x25519 private key, to open every subkey copy. */
  head: { username: string; x25519PrivateKey: Uint8Array };
  /** The team key the student's existing records are sealed under (pre-rotation). */
  oldTeamKey: Uint8Array;
  /** The team key to re-seal the outer layer under (the current generation). */
  newTeamKey: Uint8Array;
  /** The head's lab signing keypair; the re-PUT is head-signed. */
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  listImpl?: typeof listLabRecords;
  getImpl?: typeof getLabRecord;
  putImpl?: typeof putLabRecord;
  fetchImpl?: typeof fetch;
}): Promise<{ resealed: number } | { refused: true; reason: string }> {
  if (!CLASS_MODE_ENABLED) {
    return { refused: true, reason: "class mode is disabled (NEXT_PUBLIC_CLASS_MODE off)" };
  }
  const doList = params.listImpl ?? listLabRecords;
  const doGet = params.getImpl ?? getLabRecord;
  const put = params.putImpl ?? putLabRecord;

  const keys = await doList({
    labId: params.labId,
    prefix: params.student.username + "/",
    signerEd25519Priv: params.signerEd25519Priv,
    signerEd25519Pub: params.signerEd25519Pub,
    fetchImpl: params.fetchImpl,
  });

  let resealed = 0;
  for (const key of [...keys].sort()) {
    const parts = key.split("/");
    if (parts.length !== 4) continue;
    const [, owner, recordType, recordId] = parts;
    // Only the student's OWN private records carry a subkey we can re-seal.
    if (owner !== params.student.username) continue;

    let teamPlaintext: Uint8Array;
    try {
      teamPlaintext = await doGet({
        labId: params.labId,
        owner,
        recordType,
        recordId,
        labKey: params.oldTeamKey,
        fetchImpl: params.fetchImpl,
      });
    } catch {
      continue; // unreadable under this generation: skip, keep going
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(teamPlaintext));
    } catch {
      continue;
    }
    if (!isSubkeyedPrivateRecord(parsed)) continue;
    const envelope = parsed.subkey!;
    if (envelope.owner !== params.student.username) continue; // defensive

    let nextEnvelope: SubkeyEnvelope;
    try {
      nextEnvelope = reSealEnvelopeForStudent(
        envelope,
        { username: params.head.username, x25519PrivateKey: params.head.x25519PrivateKey },
        {
          username: params.student.username,
          x25519PublicKey: params.student.newX25519PublicKey,
        },
      );
    } catch {
      // The head could not open this envelope (should not happen): skip it rather
      // than abort the whole pass, so the other notebooks still recover.
      continue;
    }

    // Re-PUT: the inner blob is unchanged (still sealed under the same subkey), only
    // the envelope's student copy was re-sealed. Wrap under the NEW team key.
    const nextRecord: SubkeyedRecord = { blob: parsed.blob, subkey: nextEnvelope };
    await put({
      labId: params.labId,
      owner,
      recordType,
      recordId,
      plaintext: new TextEncoder().encode(JSON.stringify(nextRecord)),
      labKey: params.newTeamKey,
      signerEd25519Priv: params.signerEd25519Priv,
      signerEd25519Pub: params.signerEd25519Pub,
      fetchImpl: params.fetchImpl,
    });
    resealed += 1;
  }

  return { resealed };
}
