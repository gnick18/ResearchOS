// Consolidated owner-scoped wrappers. Each routes writes to a specific
// owner's folder when the current viewer holds an edit-level share (or, for
// notebooks, a peer edit). This module re-exports the per-type wrappers + the
// unified read/write guards so a single `from "@/lib/owner-scoped"` import
// covers everything in this domain.
//
// The old PI edit-session audited-write factory was removed with the PI
// edit-mode feature; cross-owner writes are now driven purely by standard
// share permissions (owner-or-shared-edit), same as any other user.
//
// FLAG (data-shape): the wrappers themselves don't change on-disk shapes
// — they're write-path adapters. The on-disk shape changes belong to
// `lib/sharing/migrate-unified.ts`.

export { ownerScopedTasksApi } from "@/lib/tasks/owner-scoped-api";
export {
  ownerScopedNotesApi,
  type OwnerScopedNotesArgs,
} from "@/lib/notes/owner-scoped-api";
export {
  ownerScopedPurchasesApi,
  type OwnerScopedPurchasesArgs,
} from "@/lib/purchases/owner-scoped-api";

// Re-export the unified read/write helpers so a single
// `from "@/lib/owner-scoped"` import gives callers everything they
// need for cross-owner reads + writes.
export {
  canRead,
  canWrite,
  expandSharedWith,
  normalizeSharedWith,
  upsertSharedEntry,
  removeSharedEntry,
  isWholeLabShared,
  WHOLE_LAB_SENTINEL,
  type Viewer,
  type ShareableRecord,
} from "@/lib/sharing/unified";

import { fileService } from "@/lib/file-system/file-service";

/**
 * Convenience: read any record from a target owner's folder, given the
 * store's directory name. Used by cross-owner read paths.
 */
export async function readRecordForOwner<T = Record<string, unknown>>(
  dirName: string,
  id: number,
  owner: string,
): Promise<T | null> {
  return fileService.readJson<T>(`users/${owner}/${dirName}/${id}.json`);
}
