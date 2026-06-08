// Lab-tier Phase 3 chunk 2a: pure lab-work sync engine (R2 mirror model).
//
// MODEL: each lab member's LOCAL folder is the source of truth. Their client
// pushes encrypted snapshots of lab work to R2 so the PI can enumerate and read
// everything. One-way (local to R2), last-write-wins by content sha256. Scope is
// all lab work records (tasks, notes, experiments, methods, purchases); personal
// drafts are excluded but that decision belongs to the live-folder enumeration
// layer (next chunk).
//
// THIS MODULE IS I/O-FREE (as a pure engine). It takes records and a manifest
// as VALUES and returns new results and a new manifest. Persisting the manifest
// and enumerating live records is the next chunk's responsibility.
//
// Two clean seams for the next chunk:
//   1. ENUMERATION: the caller builds the `records: LabWorkRecord[]` list from
//      the live folder (tasks/, notes/, experiments/, methods/, purchases/). This
//      module makes no filesystem calls.
//   2. MANIFEST PERSISTENCE: the caller persists the returned manifest (e.g. to
//      the user's folder under _schema_migrations.json or a dedicated
//      _lab_sync_manifest.json). This module does not touch storage.
//
// TOMBSTONING: when a record is deleted locally its key appears in `removedKeys`
// in the result. The relay has NO delete route and we are deliberately not adding
// one (deletion on a server-blind store is sensitive). Instead, callers that pass
// `tombstoneRemoved: true` to syncLabWorkToMirror cause each removed key to be
// OVERWRITTEN with an encrypted tombstone sentinel (LAB_TOMBSTONE_MARKER bytes).
// The PI's read path calls isTombstone(plaintext) to detect these and treats them
// as deletions. When `tombstoneRemoved` is false (the default) the old behaviour
// is preserved: removedKeys are reported but the R2 blobs are left unchanged.
//
// LAB_TIER_ENABLED gate: production callers must check the flag before calling
// syncLabWorkToMirror or pullMemberLabRecords. The underlying putLabRecord /
// listLabRecords / getLabRecord functions enforce the flag themselves and throw
// when it is false. Unit tests bypass the gate by passing putImpl / listImpl /
// getImpl mocks (no real putLabRecord path) OR by vi.mock-ing config.ts to set
// LAB_TIER_ENABLED = true before importing the real client functions.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { labDataObjectKey } from "./lab-data-protocol";
import { putLabRecord, getLabRecord, listLabRecords } from "./lab-data-client";

// ---------------------------------------------------------------------------
// Tombstone sentinel + helpers.
// ---------------------------------------------------------------------------

/**
 * The marker field used to identify tombstone payloads. A tombstone plaintext
 * is canonical JSON with this key set to `true` plus a `deletedAt` timestamp.
 * The marker string is intentionally unlikely to collide with any real record
 * field, and the JSON structure is deterministic for a given `deletedAt` value.
 */
export const LAB_TOMBSTONE_MARKER = "__labTombstone";

/**
 * Builds the canonical tombstone bytes for a record deleted at `deletedAt`
 * (milliseconds since epoch). The output is deterministic for a given input:
 * the same `deletedAt` always produces the same bytes.
 *
 * The format is the compact JSON string:
 *   `{"__labTombstone":true,"deletedAt":<number>}`
 */
export function makeTombstoneBytes(deletedAt: number): Uint8Array {
  const json = `{"${LAB_TOMBSTONE_MARKER}":true,"deletedAt":${deletedAt}}`;
  return new TextEncoder().encode(json);
}

/**
 * Returns true iff `plaintext` decodes to valid JSON with the
 * `__labTombstone` field set to `true`. Malformed input or any JSON that does
 * not satisfy that condition returns `false` without throwing.
 */
export function isTombstone(plaintext: Uint8Array): boolean {
  try {
    const text = new TextDecoder().decode(plaintext);
    const parsed = JSON.parse(text) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as Record<string, unknown>)[LAB_TOMBSTONE_MARKER] === true
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

/**
 * One lab work record the live-folder layer (next chunk) will supply. The
 * engine treats the plaintext as an opaque byte payload; the caller serialises
 * the record to bytes (JSON, CBOR, etc.) before passing it here.
 */
export interface LabWorkRecord {
  recordType: string;
  recordId: string;
  plaintext: Uint8Array;
}

/**
 * A content-addressed sync manifest. Maps each R2 object key that has been
 * pushed to the lowercase hex sha256 of the plaintext that was pushed. The
 * engine uses this to skip unchanged records and detect local deletions.
 *
 * CALLERS: persist this between syncs (e.g. to `_lab_sync_manifest.json` in
 * the user's data folder). Passing an empty object triggers a full push of all
 * supplied records.
 */
export type LabSyncManifest = Record<string, string>;

/**
 * The result of one sync run.
 *
 *   manifest:     updated manifest (do NOT mutate the input, this is a new object).
 *   pushed:       object keys that were encrypted and uploaded this run.
 *   skipped:      object keys whose content sha256 matched the manifest (no-op).
 *   removedKeys:  object keys present in the INPUT manifest that no longer
 *                 correspond to any live record. When `tombstoneRemoved` is true
 *                 these keys have had tombstone sentinels written to R2 and their
 *                 manifest entries updated. When `tombstoneRemoved` is false the
 *                 R2 blobs are unchanged. See module-level doc comment.
 *   tombstoned:   object keys for which a tombstone sentinel was written during
 *                 this run. Empty when `tombstoneRemoved` is false (the default).
 */
export interface SyncResult {
  manifest: LabSyncManifest;
  pushed: string[];
  skipped: string[];
  removedKeys: string[];
  tombstoned: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/**
 * Lowercase hex sha256 of the given bytes via WebCrypto. Available in both the
 * browser and the Node test runtime. Mirrors sha256HexBytes in lab-data-client
 * (not re-exported from there) so this module can compute content hashes without
 * importing a private helper.
 */
async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  // Copy to a plain ArrayBuffer so SharedArrayBuffer-backed views never reach
  // subtle.digest (same guard used in lab-data-client and lib/sharing/bundle.ts).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// syncLabWorkToMirror.
// ---------------------------------------------------------------------------

/**
 * Pushes encrypted snapshots of all supplied lab work records to the R2 mirror.
 * Records whose plaintext sha256 already matches the manifest are skipped
 * (last-write-wins, content-addressed deduplication). Records deleted locally
 * since the last sync are reported in `removedKeys` but NOT deleted from R2
 * (tombstoning is a later chunk).
 *
 * The function is idempotent: calling it twice with the same records and the
 * returned manifest results in all records being skipped on the second call.
 *
 * @param params.labId        the lab identifier.
 * @param params.owner        the username whose records are being pushed.
 * @param params.records      all current lab work records for this owner.
 * @param params.labKey       the 32-byte lab symmetric key (used to encrypt each
 *                            record before it leaves the client).
 * @param params.signerEd25519Priv  caller's Ed25519 signing private key.
 * @param params.signerEd25519Pub   caller's Ed25519 signing public key.
 * @param params.manifest     the manifest from the previous sync (or {} for a
 *                            fresh start).
 * @param params.putImpl           optional override for putLabRecord (used in
 *                                 unit tests to bypass the LAB_TIER_ENABLED gate).
 * @param params.fetchImpl         optional fetch override forwarded to putLabRecord.
 * @param params.tombstoneRemoved  when true, each removed key is overwritten with
 *                                 an encrypted tombstone sentinel so the PI mirror
 *                                 reflects the deletion without a relay delete
 *                                 route. Defaults to false (back-compat: removed
 *                                 keys are only reported, not acted on).
 * @param params.now               optional override for the tombstone timestamp
 *                                 (milliseconds since epoch). Defaults to
 *                                 Date.now(). Useful in deterministic tests.
 *
 * @returns a new SyncResult with the updated manifest and categorised keys.
 */
export async function syncLabWorkToMirror(params: {
  labId: string;
  owner: string;
  records: LabWorkRecord[];
  labKey: Uint8Array;
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  manifest: LabSyncManifest;
  putImpl?: typeof putLabRecord;
  fetchImpl?: typeof fetch;
  tombstoneRemoved?: boolean;
  now?: number;
}): Promise<SyncResult> {
  const doPut = params.putImpl ?? putLabRecord;
  const tombstoneRemoved = params.tombstoneRemoved ?? false;
  const nowMs = params.now ?? Date.now();

  // Work on a shallow copy of the manifest so the input is never mutated.
  const newManifest: LabSyncManifest = { ...params.manifest };
  const pushed: string[] = [];
  const skipped: string[] = [];

  // Build the set of current record keys so we can detect removals.
  const liveKeys = new Set<string>();

  for (const record of params.records) {
    const key = labDataObjectKey(
      params.labId,
      params.owner,
      record.recordType,
      record.recordId,
    );
    liveKeys.add(key);

    const sha256 = await sha256HexBytes(record.plaintext);

    if (newManifest[key] === sha256) {
      // Content unchanged since last sync.
      skipped.push(key);
      continue;
    }

    // Content is new or changed: push the encrypted snapshot.
    await doPut({
      labId: params.labId,
      owner: params.owner,
      recordType: record.recordType,
      recordId: record.recordId,
      plaintext: record.plaintext,
      labKey: params.labKey,
      signerEd25519Priv: params.signerEd25519Priv,
      signerEd25519Pub: params.signerEd25519Pub,
      fetchImpl: params.fetchImpl,
    });

    newManifest[key] = sha256;
    pushed.push(key);
  }

  // Detect keys in the input manifest that no longer have a live record.
  // These correspond to records deleted locally since the last sync.
  const removedKeys: string[] = [];
  const tombstoned: string[] = [];

  for (const key of Object.keys(params.manifest)) {
    if (liveKeys.has(key)) continue;
    removedKeys.push(key);

    if (!tombstoneRemoved) {
      // Default behaviour: report but do not act. The stale entry is left in the
      // manifest intentionally so it is not treated as "new" on the next push.
      continue;
    }

    // tombstoneRemoved: overwrite the R2 blob with a tombstone sentinel.
    // Parse the key as 4 slash-segments: labId/owner/recordType/recordId.
    const parts = key.split("/");
    if (parts.length !== 4) {
      // Malformed key: skip rather than throw so one bad key does not abort the
      // entire sync. The stale entry remains in the manifest.
      continue;
    }
    const [kLabId, kOwner, kRecordType, kRecordId] = parts;

    const tombstoneBytes = makeTombstoneBytes(nowMs);
    const tombstoneHash = await sha256HexBytes(tombstoneBytes);

    // Short-circuit: if the manifest already holds this tombstone hash the
    // sentinel was written on a prior sync run. Skip to keep the operation
    // idempotent and avoid a redundant encrypted upload.
    if (newManifest[key] === tombstoneHash) {
      continue;
    }

    await doPut({
      labId: kLabId,
      owner: kOwner,
      recordType: kRecordType,
      recordId: kRecordId,
      plaintext: tombstoneBytes,
      labKey: params.labKey,
      signerEd25519Priv: params.signerEd25519Priv,
      signerEd25519Pub: params.signerEd25519Pub,
      fetchImpl: params.fetchImpl,
    });

    // Update the manifest entry to the tombstone content hash so a subsequent
    // sync does not re-push the tombstone (it will look unchanged).
    newManifest[key] = tombstoneHash;
    tombstoned.push(key);
  }

  return { manifest: newManifest, pushed, skipped, removedKeys, tombstoned };
}

// ---------------------------------------------------------------------------
// pullMemberLabRecords.
// ---------------------------------------------------------------------------

/**
 * PI READ PATH. Lists every R2 object key for a lab member under
 * `${labId}/${memberOwner}/` then fetches and decrypts each one. Returns an
 * array of decrypted records with their parsed recordType and recordId.
 *
 * Key format is exactly 4 slash-joined segments: `labId/owner/recordType/recordId`.
 * The function splits on "/" and takes the last two segments as recordType and
 * recordId; everything between the labId and recordType is the owner (which for
 * this 4-segment key is the second segment, but the split is safe for any valid
 * key emitted by labDataObjectKey).
 *
 * @param params.labId          the lab identifier.
 * @param params.memberOwner    the member whose records the PI wants to read.
 * @param params.labKey         the 32-byte lab key (the PI always holds this).
 * @param params.signerEd25519Priv  caller's Ed25519 signing private key.
 * @param params.signerEd25519Pub   caller's Ed25519 signing public key.
 * @param params.listImpl       optional override for listLabRecords (tests).
 * @param params.getImpl        optional override for getLabRecord (tests).
 * @param params.fetchImpl      optional fetch override forwarded to list/get.
 *
 * @returns an array of decrypted records, in the order the relay returns keys.
 */
export async function pullMemberLabRecords(params: {
  labId: string;
  memberOwner: string;
  labKey: Uint8Array;
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  listImpl?: typeof listLabRecords;
  getImpl?: typeof getLabRecord;
  fetchImpl?: typeof fetch;
}): Promise<
  Array<{ key: string; recordType: string; recordId: string; plaintext: Uint8Array }>
> {
  const doList = params.listImpl ?? listLabRecords;
  const doGet = params.getImpl ?? getLabRecord;

  // List all keys under this member's prefix.
  const keys = await doList({
    labId: params.labId,
    prefix: params.memberOwner,
    signerEd25519Priv: params.signerEd25519Priv,
    signerEd25519Pub: params.signerEd25519Pub,
    fetchImpl: params.fetchImpl,
  });

  const results: Array<{
    key: string;
    recordType: string;
    recordId: string;
    plaintext: Uint8Array;
  }> = [];

  for (const key of keys) {
    // Key format: labId/owner/recordType/recordId (exactly 4 segments).
    // Split on "/" and take segments 2 and 3 (0-indexed) as recordType and
    // recordId. The owner is segment 1 (everything between labId and recordType).
    const parts = key.split("/");
    if (parts.length !== 4) {
      // Malformed key: skip rather than throw so one bad key does not abort
      // the entire pull. The caller can observe missing records from the list.
      continue;
    }
    const [, , recordType, recordId] = parts;

    const plaintext = await doGet({
      labId: params.labId,
      owner: params.memberOwner,
      recordType,
      recordId,
      labKey: params.labKey,
      fetchImpl: params.fetchImpl,
    });

    results.push({ key, recordType, recordId, plaintext });
  }

  return results;
}
