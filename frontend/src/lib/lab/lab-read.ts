// Lab-tier Phase 3 chunk 3: member lab-view read layer.
//
// MEMBER VIEW MODEL:
//   A non-PI lab member reconstructs their lab view from the server-blind R2
//   store as: their OWN records PLUS records other members explicitly shared
//   with them (via each record's `shared_with` field). All lab members hold the
//   lab key and can technically decrypt any blob, but visibility here is
//   intent-based (own + shared-with-me), not everything-decryptable. The PI-all
//   path (pullMemberLabRecords per member) is separate and deliberately not
//   exposed here.
//
// TOMBSTONES: deleted records are overwritten with tombstone sentinels in R2
// (see lab-sync.ts). pullLabView skips them so the caller never sees deletions
// as live records.
//
// NON-JSON PLAINTEXT: a record whose plaintext is not valid JSON is treated as
// an own record (always visible to its owner) and invisible to any other viewer.
// The shared_with check requires parsed JSON; without it the sharing intent
// cannot be read, so the record is conservatively hidden from non-owners.
//
// ANNOUNCEMENTS (lab-wide-public exception): the `announcement` record type is
// the one type that is NOT per-user owner+shared_with. Announcements are PI-
// written and all-members-readable by design (the on-disk shape has no
// shared_with). pullLabView therefore surfaces every `announcement` record to
// every lab member regardless of shared_with, matching the on-disk semantics.
// This exception is scoped strictly to recordType === "announcement"; the
// per-record shared_with gate is unchanged for all other types.
//
// WHOLE-LAB SHARE ("*" sentinel): a record can be shared with EVERY current lab
// member by carrying the WHOLE_LAB_SENTINEL ("*") in its shared_with (see
// lib/sharing/unified.ts). This is the per-record analog of the announcement
// exception. recordSharedWith treats a shared_with that contains "*" as naming
// the viewer, so a "*"-shared record is visible to every member on the roster.
// The viewer reaching this read path is always a roster member (they are in
// params.owners and hold the lab key), so expanding "*" stays within the
// roster. The server remains blind: this is the client-side intent gate
// (own + shared-with-me), not a transport or encryption change.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { isTombstone } from "./lab-sync";
import { listLabRecords, getLabRecord } from "./lab-data-client";
import { WHOLE_LAB_SENTINEL } from "@/lib/sharing/unified";

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

/**
 * One record in a member's lab view. Carries the raw decrypted plaintext so
 * the caller can deserialise it according to the record type.
 */
export interface LabViewRecord {
  /** The full R2 object key: `${labId}/${owner}/${recordType}/${recordId}`. */
  key: string;
  /** The username whose folder this record came from. */
  owner: string;
  /** The record type segment from the object key (e.g. "note", "task"). */
  recordType: string;
  /** The record identifier segment from the object key. */
  recordId: string;
  /** The decrypted plaintext bytes. Never a tombstone sentinel. */
  plaintext: Uint8Array;
  /** True iff `owner === viewer` (the record belongs to the viewer). */
  isOwn: boolean;
  /**
   * True iff the record's `shared_with` field includes the viewer. Can be
   * true even when `isOwn` is true (owner shared with themselves, which is
   * harmless but unusual).
   */
  sharedWithViewer: boolean;
}

// ---------------------------------------------------------------------------
// recordSharedWith helper.
// ---------------------------------------------------------------------------

/**
 * Returns true iff the parsed record object contains a `shared_with` array
 * that includes `viewer`. Handles three entry shapes:
 *   - plain string: `"username"`
 *   - object with `username` field: `{ username: "...", level?: "..." }`
 *   - object with `user` field (legacy alias): `{ user: "..." }`
 *
 * WHOLE-LAB SHARE: an entry equal to the WHOLE_LAB_SENTINEL ("*"), in either the
 * plain-string or the `{ username: "*" }` shape, means the record is shared with
 * every current lab member. Because every viewer reaching this read path is a
 * roster member (they are listed in pullLabView's `owners` and hold the lab
 * key), a "*" entry resolves to "shared with the viewer". This is the per-record
 * analog of the announcement lab-wide-public exception and reuses the same "*"
 * sentinel as expandSharedWith in lib/sharing/unified.ts.
 *
 * Defensive: non-object input, missing or non-array `shared_with`, or any
 * malformed entry never throws and returns false for that entry.
 *
 * @param recordJson  The parsed record value (result of JSON.parse or any unknown).
 * @param viewer      The username to look for in `shared_with`.
 * @param opts.includeWholeLab  When true (default), a "*" sentinel entry counts
 *          as a match for any viewer (the record is shared with everyone). When
 *          false, only an explicit username match counts; the caller is then
 *          responsible for the roster-membership gate on whole-lab shares (see
 *          pullLabView, which honors "*" only for roster members).
 * @returns true iff the viewer is named in `shared_with`, or (when
 *          includeWholeLab) the record is shared with the whole lab via "*".
 */
export function recordSharedWith(
  recordJson: unknown,
  viewer: string,
  opts: { includeWholeLab?: boolean } = {},
): boolean {
  const includeWholeLab = opts.includeWholeLab ?? true;
  if (typeof recordJson !== "object" || recordJson === null) return false;
  const rec = recordJson as Record<string, unknown>;
  const sw = rec["shared_with"];
  if (!Array.isArray(sw)) return false;

  for (const entry of sw) {
    const name = sharedEntryName(entry);
    if (name === null) continue;
    if (name === viewer) return true;
    if (includeWholeLab && name === WHOLE_LAB_SENTINEL) return true;
  }
  return false;
}

/**
 * True iff the record's `shared_with` array contains the "*" whole-lab sentinel
 * in any supported entry shape (bare string, `{ username }`, legacy `{ user }`).
 * Used by pullLabView to honor a whole-lab share only for roster members.
 */
export function recordIsWholeLabShared(recordJson: unknown): boolean {
  if (typeof recordJson !== "object" || recordJson === null) return false;
  const rec = recordJson as Record<string, unknown>;
  const sw = rec["shared_with"];
  if (!Array.isArray(sw)) return false;
  for (const entry of sw) {
    if (sharedEntryName(entry) === WHOLE_LAB_SENTINEL) return true;
  }
  return false;
}

/**
 * Extract the username from one `shared_with` entry. Handles three entry
 * shapes: a bare string, `{ username }`, and the legacy `{ user }` alias.
 * Returns null for any malformed entry so callers never throw.
 */
function sharedEntryName(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && entry !== null) {
    const e = entry as Record<string, unknown>;
    if (typeof e["username"] === "string") return e["username"];
    if (typeof e["user"] === "string") return e["user"];
  }
  return null;
}

// ---------------------------------------------------------------------------
// pullLabView.
// ---------------------------------------------------------------------------

/**
 * MEMBER READ PATH. Reconstructs the viewing member's lab view from R2:
 *   - All of the viewer's OWN records (under their owner prefix).
 *   - Records from other owners whose `shared_with` explicitly names the viewer.
 *
 * Tombstoned records are silently skipped regardless of ownership.
 * Non-own records whose plaintext is not valid JSON are skipped (no shared_with
 * to parse, so sharing intent cannot be determined).
 * Own records are always included even if their plaintext is not valid JSON.
 *
 * NOTE: the PI-all path is separate (`pullMemberLabRecords` per member in
 * lab-sync.ts). This function is deliberately scoped to the MEMBER view
 * (own + shared-with-me); do not use it for PI enumeration.
 *
 * @param params.labId              the lab identifier.
 * @param params.viewer             the username whose view is being built.
 * @param params.owners             all member usernames in the lab (including
 *                                  the viewer). Records are fetched for each
 *                                  owner in this array, in order.
 * @param params.labKey             the 32-byte lab symmetric key.
 * @param params.signerEd25519Priv  caller's Ed25519 signing private key.
 * @param params.signerEd25519Pub   caller's Ed25519 signing public key.
 * @param params.listImpl           optional override for `listLabRecords` (tests).
 * @param params.getImpl            optional override for `getLabRecord` (tests).
 * @param params.fetchImpl          optional fetch override forwarded to list/get.
 *
 * @returns a flat array of visible records. Stable order: grouped by the order
 *          of `owners`, then by key ascending within each owner's group.
 */
export async function pullLabView(params: {
  labId: string;
  viewer: string;
  owners: string[];
  labKey: Uint8Array;
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  listImpl?: typeof listLabRecords;
  getImpl?: typeof getLabRecord;
  fetchImpl?: typeof fetch;
}): Promise<LabViewRecord[]> {
  const doList = params.listImpl ?? listLabRecords;
  const doGet = params.getImpl ?? getLabRecord;

  // The active roster. A "*"-shared record is visible to roster members ONLY,
  // never to a non-member. The viewer is normally one of `owners`, but we guard
  // explicitly so the whole-lab expansion can never leak to a caller who is not
  // on the roster (defense in depth; the lab key already gates decryption).
  const viewerIsRosterMember = params.owners.includes(params.viewer);

  const results: LabViewRecord[] = [];

  for (const owner of params.owners) {
    // List all keys for this owner under the lab prefix.
    const keys = await doList({
      labId: params.labId,
      prefix: owner + "/",
      signerEd25519Priv: params.signerEd25519Priv,
      signerEd25519Pub: params.signerEd25519Pub,
      fetchImpl: params.fetchImpl,
    });

    // Sort keys ascending within each owner group for stable output.
    const sortedKeys = [...keys].sort();

    for (const key of sortedKeys) {
      // Key must be exactly 4 slash-joined segments: labId/owner/recordType/recordId.
      const parts = key.split("/");
      if (parts.length !== 4) {
        // Malformed key: skip silently.
        continue;
      }
      const [, keyOwner, recordType, recordId] = parts;

      // Decrypt the record.
      const plaintext = await doGet({
        labId: params.labId,
        owner: keyOwner,
        recordType,
        recordId,
        labKey: params.labKey,
        fetchImpl: params.fetchImpl,
      });

      // Skip tombstones: a deleted record is not part of anyone's view.
      if (isTombstone(plaintext)) continue;

      const isOwn = owner === params.viewer;

      // Attempt to parse the plaintext as JSON to read shared_with.
      let parsed: unknown = null;
      let parseOk = false;
      try {
        parsed = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
        parseOk = true;
      } catch {
        // Not valid JSON. Own records are still visible (see module doc).
        parseOk = false;
      }

      // Two independent signals from shared_with:
      //   - namedViewer: the viewer is listed explicitly by username. Always
      //     honored, even for a non-roster caller.
      //   - wholeLab: the record carries the "*" sentinel (shared with everyone).
      //     Honored only for a roster member so the whole-lab expansion can never
      //     leak to a non-member.
      const namedViewer = parseOk
        ? recordSharedWith(parsed, params.viewer, { includeWholeLab: false })
        : false;
      const wholeLab = parseOk ? recordIsWholeLabShared(parsed) : false;
      const sharedWithViewer =
        namedViewer || (wholeLab && viewerIsRosterMember);

      // Announcements are lab-wide-public (PI-written, all-members-readable, no
      // shared_with on the on-disk shape). Treat the `announcement` type as
      // visible to every member regardless of shared_with. The exception is
      // scoped strictly to these types; every other type still passes the
      // per-record shared_with gate below.
      //
      // CLASS DASHBOARD (CT-5 + CT-3): the instructor-authored `class_dashboard`
      // template rides the SAME lab-wide-public path so every student in the
      // class reads the one instructor-owned record (see lab/class-dashboard.ts).
      // Additive: an unknown record type was invisible to this read before, so
      // admitting `class_dashboard` here cannot change any existing lab's view.
      const isLabWidePublic =
        recordType === "announcement" || recordType === "class_dashboard";

      // Visibility rule:
      //   - own records are always visible (even if unparseable).
      //   - lab-wide-public records (announcements) are visible to every member.
      //   - other non-own records are visible iff shared_with names the viewer
      //     (explicitly, or via the "*" whole-lab sentinel for roster members).
      if (!isOwn && !isLabWidePublic && !sharedWithViewer) continue;

      results.push({
        key,
        owner,
        recordType,
        recordId,
        plaintext,
        isOwn,
        sharedWithViewer,
      });
    }
  }

  return results;
}
