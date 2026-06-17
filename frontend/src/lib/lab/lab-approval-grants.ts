// Approval grants: the TTL engine behind Phase C of the hybrid lab mirror
// (docs/proposals/2026-06-17-hybrid-lab-mirror-index.md).
//
// A heavy record (a big Data Hub table) is held back from the eager mirror and
// fetched on demand. When the PI requests it and the OWNING MEMBER approves, the
// member records an approval grant with an expiry. While the grant is active the
// member's sync PROMOTES that heavy record into the eager push (so the PI reads
// it instantly) and the index marks it eager. When the grant expires the record
// simply drops out of the push set, and the sync engine's existing
// tombstone-on-removal reverts it to on-demand for free, no extra machinery.
//
// Grant decision 2026-06-17: approved heavy content STAYS WITH A TTL, then
// reverts to on-demand. Approve-only but visible (no silent decline).
//
// Pure model + helpers (no I/O); a store interface with a fileService-backed
// default. No emojis, no em-dashes, no mid-sentence colons.

/** Default time an approval keeps a heavy record in the mirror: 30 days. */
export const DEFAULT_GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** One member-approved grant promoting a single heavy record into the mirror. */
export interface ApprovalGrant {
  recordType: string;
  recordId: string;
  /** Epoch ms after which the grant is expired and the record reverts. */
  approvedUntil: number;
  /** Who requested it (the lab head username), for the audit and the panel. */
  requestedBy: string;
}

export interface ApprovalGrantsFile {
  version: 1;
  grants: ApprovalGrant[];
}

/** Stable key for a record within a member's grant set. */
export function grantKey(recordType: string, recordId: string): string {
  return `${recordType}/${recordId}`;
}

/** True when a non-expired grant exists for this record. */
export function hasActiveGrant(
  grants: ApprovalGrant[],
  recordType: string,
  recordId: string,
  nowMs: number,
): boolean {
  return grants.some(
    (g) =>
      g.recordType === recordType &&
      g.recordId === recordId &&
      g.approvedUntil > nowMs,
  );
}

/** The keys of every record with an active grant, for the index builder. */
export function activeGrantKeys(
  grants: ApprovalGrant[],
  nowMs: number,
): Set<string> {
  const out = new Set<string>();
  for (const g of grants) {
    if (g.approvedUntil > nowMs) out.add(grantKey(g.recordType, g.recordId));
  }
  return out;
}

/** Drop expired grants. Returns a new array (the input is never mutated). */
export function pruneExpired(
  grants: ApprovalGrant[],
  nowMs: number,
): ApprovalGrant[] {
  return grants.filter((g) => g.approvedUntil > nowMs);
}

/**
 * Add or refresh a grant for one record. An existing grant for the same record
 * is replaced (a re-approval extends the window), so the set never duplicates a
 * record.
 */
export function addGrant(
  grants: ApprovalGrant[],
  grant: ApprovalGrant,
): ApprovalGrant[] {
  const key = grantKey(grant.recordType, grant.recordId);
  const kept = grants.filter(
    (g) => grantKey(g.recordType, g.recordId) !== key,
  );
  return [...kept, grant];
}

// ---------------------------------------------------------------------------
// Persistence (per member, in their own folder).
// ---------------------------------------------------------------------------

export interface ApprovalGrantStore {
  load(owner: string): Promise<ApprovalGrant[]>;
  save(owner: string, grants: ApprovalGrant[]): Promise<void>;
}

/** The per-user path the grants live at. */
export function approvalGrantsPath(owner: string): string {
  return `users/${owner}/_lab_approval_grants.json`;
}

/**
 * A fileService-backed store. Imported lazily inside the factory so the pure
 * model above stays free of any storage import (and so this module can be unit
 * tested without the file system).
 */
export function createFileServiceGrantStore(): ApprovalGrantStore {
  return {
    async load(owner) {
      const { fileService } = await import("@/lib/file-system/file-service");
      const file = await fileService.readJson<ApprovalGrantsFile>(
        approvalGrantsPath(owner),
      );
      return file?.grants ?? [];
    },
    async save(owner, grants) {
      const { fileService } = await import("@/lib/file-system/file-service");
      const file: ApprovalGrantsFile = { version: 1, grants };
      await fileService.writeJson(approvalGrantsPath(owner), file);
    },
  };
}
