// frontend/src/lib/onboarding/dev-sandbox.ts
//
// Dev-only helpers for the "Show welcome wizard (creates Test user)"
// affordance in DevForceTipButton. Isolated in its own file because the
// concept is strictly dev-sandbox — not part of the production wizard
// runtime, not consumed by the orchestrator. Keeping it next to
// sidecar.ts (the wizard's persistence layer) is enough proximity.
//
// Design lock (Grant, onboarding v2 manager 2026-05-20):
//   - The dev button at DevForceTipButton must NEVER mutate the real
//     signed-in user's data when previewing the v2 wizard. Instead it
//     mints a throwaway "Test-N" user, points active-user at it, and
//     lets the orchestrator's normal showWizard gate mount the wizard
//     against that user. Inline pair / feed / clipboard flows then
//     write to Test-N's folder, completion writes Test-N's sidecar,
//     skip writes Test-N's sidecar. The real user is invariant.
//
//   - The Test user is created at click-time (not lazily). The
//     wizard's inline integration flows need a user to write into
//     before they fire, so upfront creation is the cleanest
//     reconciliation. createUser() handles directory tree + counters
//     + user-list refresh.
//
//   - Naming uses "Test-N" where N is the lowest positive integer not
//     currently used in _user_metadata. Tombstoned entries
//     (deleted_at set) count as used so we don't collide with their
//     lingering metadata — soft-deleted users still have a sidecar /
//     settings / metadata footprint until cloud-sync finishes GC.
//     Once an entry is fully gone from the metadata file, the counter
//     re-uses that slot.

import { readAllUserMetadata } from "@/lib/file-system/user-metadata";

/**
 * Returns the lowest N (starting at 1) where "Test-N" is NOT currently
 * a registered username in users/_user_metadata.json.
 *
 * Tombstoned entries (those with `deleted_at` set) count as "used" so
 * we don't collide with their lingering sidecar / settings / metadata
 * footprint. The check is purely on key presence in the metadata map —
 * `readAllUserMetadata()` returns the full object including
 * soft-deleted users.
 *
 * Returns "Test-1" when no folder is connected (readAllUserMetadata
 * returns `{}` in that path).
 */
export async function nextTestUserName(): Promise<string> {
  const meta = await readAllUserMetadata();
  let n = 1;
  while (meta[`Test-${n}`] !== undefined) {
    n += 1;
  }
  return `Test-${n}`;
}
