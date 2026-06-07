/**
 * purchase-write-through.ts
 *
 * Purchase items on Loro (docs/proposals/PURCHASE_LORO.md) chunk 3 = the single
 * shared WRITE seam. The two purchase write paths (the row editor's field save
 * and the lab-head approval / decline / flag writes in pi-actions) route through
 * here when PURCHASE_LORO_ENABLED, so a save lands in the Loro doc, persists
 * BOTH the .loro sidecar AND the .json mirror, and fans out over the relay,
 * while every legacy reader keeps seeing the .json mirror unchanged.
 *
 * Why one helper instead of duplicating at each call site: every write does the
 * same three things (open the doc, apply a partial update, flush). Centralizing
 * keeps the merge-at-save semantic identical everywhere and gives callers the
 * same return contract the old rawPurchasesApi.update / purchasesApi.update had
 * (the projected PurchaseItem).
 *
 * MERGE-AT-SAVE (the delicate part): applyPurchaseUpdate writes ONLY the fields
 * present in the partial payload (it iterates Object.entries and skips
 * undefined / immutable id+task_id). It NEVER re-seeds or overwrites the whole
 * field map. So a concurrent remote edit to OTHER fields, already merged into
 * the doc via the relay, is preserved. LoroMap is last-write-wins per key, which
 * is the intended semantic for a structured record. Callers MUST pass a PARTIAL
 * payload (only the fields they are changing), never a full record.
 *
 * The handle is opened via openPurchaseDoc, which is module-handle-cached keyed
 * owner:id. So when the row editor saves a row it has open (chunk 2), the write
 * commits into the SAME live doc the user has been viewing. For a pi-actions
 * write against an item not currently open in an editor, openPurchaseDoc opens +
 * adopts a fresh handle, which is fine.
 *
 * Authorization is NOT this module's job. In pi-actions the existing
 * pre-read / permission flow runs and must pass BEFORE this helper is called.
 * Only the persistence mechanism changes here, not the gate.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import type { PurchaseItem, PurchaseItemUpdate } from "@/lib/types";
import { applyPurchaseUpdate, getPurchaseFields } from "./purchase-doc";
import { openPurchaseDoc } from "./purchase-store";
import { buildPurchaseUpdatePatch } from "@/lib/local-api";

/**
 * Route a partial purchase update through the Loro doc.
 *
 * Opens (or reuses) the item's handle, runs the SAME effective-patch build
 * purchasesApi.update runs (total_price recompute + attribution stamp, via
 * buildPurchaseUpdatePatch), applies ONLY the resulting fields (per-key
 * last-write-wins, preserving any concurrent remote edits to other fields),
 * commits, and flushes so persistPurchaseDoc writes the .loro sidecar + the
 * .json mirror. The mirror is byte-identical to what the legacy .update would
 * have produced, so every legacy reader stays correct. Returns the projected
 * PurchaseItem so callers keep the same return shape the old .update gave them.
 *
 * @param owner          Folder owner the item's sidecar lives under.
 * @param id             Numeric purchase_item id in the owner's namespace.
 * @param partialUpdate  ONLY the fields being changed. Never a full record.
 * @param currentUser    Signed-in user (adopt / attribution parity).
 */
export async function writePurchaseUpdateThroughLoro(
  owner: string,
  id: number,
  partialUpdate: PurchaseItemUpdate,
  currentUser?: string,
): Promise<PurchaseItem> {
  const handle = await openPurchaseDoc(owner, id, currentUser);
  // The doc already carries the live record (chunk 2 read truth, plus any
  // concurrent remote edits merged in via the relay). Read its current price /
  // quantity / shipping so total_price recomputes off the latest values, then
  // build the same effective patch the legacy API builds.
  const current = getPurchaseFields(handle.doc);
  const patch = await buildPurchaseUpdatePatch(
    {
      price_per_unit: current.price_per_unit,
      quantity: current.quantity,
      shipping_fees: current.shipping_fees,
    },
    partialUpdate,
  );
  applyPurchaseUpdate(handle.doc, patch);
  handle.doc.commit();
  // Mark a persist pending, then flush it. handle.commit() arms the debounced
  // persist (so flush has work to do, since flush early-returns when nothing is
  // pending); flush then runs persistPurchaseDoc NOW, writing the .loro sidecar
  // AND the .json mirror synchronously. The caller can read the mirror
  // immediately after, so legacy readers stay correct.
  await handle.commit();
  await handle.flush();
  return getPurchaseFields(handle.doc);
}
