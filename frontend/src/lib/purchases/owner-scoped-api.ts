// Lab Head Phase 5 R1 (lab head Phase 5 R1 manager, 2026-05-23): owner-scoped
// wrapper around `purchasesApi` mutations.
//
// Mirrors `lib/tasks/owner-scoped-api.ts` and `lib/notes/owner-scoped-api.ts`.
// When a PI is in an unlocked edit session editing purchase items on a task
// owned by another lab member, every mutation needs to:
//   1. Route into the OWNER's `users/<owner>/purchase_items/<id>.json` so
//      the items the PI added/edited/deleted are visible to the owner.
//   2. Append per-field audit entries to `users/<owner>/_pi_audit.json` so
//      each change is recorded.
//
// Purchase items are flat (no sub-records like note entries) so each save
// is one record + one audit emission. A multi-line update touches multiple
// records, each of which gets its own audit-entry batch — the field-level
// granularity stays exactly the same as the Phase 5 tasks pattern.
//
// As with the tasks/notes wrappers: when any of `targetOwner` / `actor` /
// `sessionId` is missing, the wrapper falls through to the unwrapped
// purchasesApi so current-user edits work normally.

import {
  purchasesApi as rawPurchasesApi,
  type PurchaseItemCreate,
  type PurchaseItemUpdate,
} from "@/lib/local-api";
import {
  appendAuditEntries,
  buildFieldDiffEntries,
  type PiAuditEntry,
} from "@/lib/lab/pi-audit";

export interface OwnerScopedPurchasesArgs {
  /** Username of the task owner — the user whose purchase_items directory is
   *  the write target. */
  targetOwner: string | null | undefined;
  /** Username of the lab head doing the edit. Recorded as `actor` on each
   *  audit entry. */
  actor: string | null | undefined;
  /** Session id from `edit-session.startEditSession`. */
  sessionId: string | null | undefined;
}

/**
 * Build an owner-scoped `purchasesApi`. Returns the same shape as the
 * underlying `purchasesApi` (so call sites don't change) but with each
 * mutation routed to the target owner's folder and per-field audit
 * entries appended.
 *
 * Audit-entry shape decision:
 *   - update() emits one entry per CHANGED field on the touched item. So
 *     editing `price_per_unit` + `quantity` on item 42 writes 2 entries
 *     plus the `total_price` recompute, all tagged `record_id: 42`. This
 *     gives the audit-trail reader a useful per-field view.
 *   - create() emits one entry with `field_path: "_new"` and the whole
 *     new record as the new_value (and old_value = null). Item-level
 *     creation is a single atomic event from the audit perspective.
 *   - delete() emits the mirror: field_path: "_deleted", new_value: null,
 *     and old_value carrying the pre-delete record snapshot.
 */
export function ownerScopedPurchasesApi(args: OwnerScopedPurchasesArgs) {
  const { targetOwner, actor, sessionId } = args;
  const active = !!targetOwner && !!actor && !!sessionId;

  if (!active) {
    return { ...rawPurchasesApi };
  }

  const owner = targetOwner as string;
  const writer = actor as string;
  const session = sessionId as string;

  const writeAuditEntries = async (
    entries: Array<Omit<PiAuditEntry, "id" | "timestamp">>,
  ) => {
    if (entries.length === 0) return;
    try {
      await appendAuditEntries(owner, entries);
    } catch (err) {
      console.warn("[ownerScopedPurchasesApi] appendAuditEntries failed", err);
    }
  };

  return {
    ...rawPurchasesApi,
    // Owner-routed reads — so the wrapper consumer reads from the target
    // user's purchase_items, not the PI's.
    listByTask: (taskId: number) => rawPurchasesApi.listByTask(taskId, owner),
    create: async (data: PurchaseItemCreate) => {
      const created = await rawPurchasesApi.create(data, owner);
      await writeAuditEntries([
        {
          session_id: session,
          actor: writer,
          target_user: owner,
          record_type: "purchase_item",
          record_id: created.id,
          field_path: "_new",
          old_value: null,
          new_value: created as unknown,
        },
      ]);
      return created;
    },
    update: async (id: number, data: PurchaseItemUpdate) => {
      // Read the pre-edit record (from the OWNER's folder) directly so the
      // diff captures the actual previous on-disk values. The popup hands
      // us the item id (not task id), so we go through the file-service
      // helper rather than `listByTask`.
      const beforeRecord = await readPurchaseItem(id, owner);
      const updated = await rawPurchasesApi.update(id, data, owner);
      if (beforeRecord && updated) {
        const entries = buildFieldDiffEntries({
          actor: writer,
          session_id: session,
          target_user: owner,
          record_type: "purchase_item",
          record_id: id,
          oldRecord: beforeRecord as Record<string, unknown>,
          newRecord: updated as unknown as Record<string, unknown>,
          fieldPaths: [
            ...Object.keys(data),
            // total_price is computed (not in the caller's data payload) but
            // it's an audit-worthy derived field — include it explicitly so
            // the trail reads as "ppu changed AND total recomputed".
            "total_price",
          ].filter((k, i, arr) => arr.indexOf(k) === i),
        });
        await writeAuditEntries(entries);
      }
      return updated;
    },
    delete: async (id: number) => {
      const beforeRecord = await readPurchaseItem(id, owner);
      await rawPurchasesApi.delete(id, owner);
      if (beforeRecord) {
        await writeAuditEntries([
          {
            session_id: session,
            actor: writer,
            target_user: owner,
            record_type: "purchase_item",
            record_id: id,
            field_path: "_deleted",
            old_value: beforeRecord as unknown,
            new_value: null,
          },
        ]);
      }
    },
  };
}

// Local helper: read a single purchase item from a target user's folder.
// We need this for the audit-diff pre-image; `purchasesApi.listByTask`
// requires a task id we don't have at the wrapper layer (the popup that
// calls update knows the item id, not the task id), so we walk the file
// system directly via the store.
async function readPurchaseItem(
  id: number,
  owner: string,
): Promise<Record<string, unknown> | null> {
  const { fileService } = await import("@/lib/file-system/file-service");
  return fileService.readJson<Record<string, unknown>>(
    `users/${owner}/purchase_items/${id}.json`,
  );
}
