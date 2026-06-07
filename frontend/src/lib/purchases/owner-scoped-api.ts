// Owner-scoped wrapper around `purchasesApi` mutations.
//
// The PI edit-session audited soft-write branch was removed with the PI
// edit-mode feature. Purchase line-item edits now run only on data the
// current user can write directly (their own purchase orders); shared-into-me
// purchase orders are read-only at the editor level. This wrapper is kept as a
// thin passthrough so call sites don't change shape, leaving room to add
// share-permission owner routing later if purchases gain edit-level sharing.

import { purchasesApi as rawPurchasesApi } from "@/lib/local-api";

export interface OwnerScopedPurchasesArgs {
  /** Deprecated: retained for back-compat; no longer used. */
  targetOwner?: string | null | undefined;
  /** Deprecated: retained for back-compat; no longer used. */
  actor?: string | null | undefined;
  /** Deprecated: retained for back-compat; no longer used. */
  sessionId?: string | null | undefined;
}

/**
 * Build an owner-scoped `purchasesApi`. Currently a passthrough to the raw
 * `purchasesApi` (current-user folder). The args are accepted but ignored.
 */
export function ownerScopedPurchasesApi(_args: OwnerScopedPurchasesArgs = {}) {
  void _args;
  return { ...rawPurchasesApi };
}
