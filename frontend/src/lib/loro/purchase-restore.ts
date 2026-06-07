/**
 * purchase-restore.ts
 *
 * Restore a past version of a purchase item by writing it back into the live doc
 * as a FORWARD commit, never a destructive rewind (the same invariant as
 * restore.ts for notes). History keeps moving forward; the sidecar gains a new
 * commit on top of HEAD rather than truncating or rewinding to the target.
 *
 * Purchase restore is SIMPLER than note restore: a purchase item is a flat field
 * map (no markdown entries, no per-entry metadata sync), so the whole restore is
 *   1. reconstruct the field values at the target version,
 *   2. applyPurchaseUpdate them into the live handle's doc (per-key
 *      last-write-wins, which also re-serializes the `flagged` object),
 *   3. commit FORWARD with a "restore-vN" message,
 *   4. commit + flush the handle so persistPurchaseDoc writes the .loro sidecar
 *      AND the .json mirror NOW (the chunk-3 persist-now pattern), so every
 *      legacy reader sees the restored record immediately.
 *
 * React-free: no hooks, no JSX.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { reconstructPurchaseAt } from "./purchase-history";
import { applyPurchaseUpdate, getPurchaseFields } from "./purchase-doc";
import type { PurchaseDocHandle } from "./purchase-store";
import type { PurchaseItem } from "@/lib/types";

/**
 * Restore a past version of a purchase item as a FORWARD commit.
 *
 * @param handle        The LIVE open handle for the item (from openPurchaseDoc).
 * @param owner         The folder owner the item's sidecar lives under.
 * @param id            The numeric purchase_item id in the owner's namespace.
 * @param targetVersion The version index to restore (0 = seed).
 * @returns             The projected PurchaseItem after the restore (the live
 *                       record), so the caller can refresh React state.
 */
export async function restorePurchaseVersion(
  handle: PurchaseDocHandle,
  owner: string,
  id: number,
  targetVersion: number,
): Promise<PurchaseItem> {
  // Reconstruct the field values at the target (throwaway clone, never touches
  // the live handle). getPurchaseFields returns `flagged` as a parsed object;
  // applyPurchaseUpdate re-serializes it on write.
  const restored = await reconstructPurchaseAt(owner, id, targetVersion);

  // Apply the reconstructed fields into the LIVE doc. applyPurchaseUpdate skips
  // the immutable id / task_id keys, so the record can never be re-keyed, and
  // writes every other field last-write-wins (the right semantic for restoring
  // a flat structured record).
  applyPurchaseUpdate(handle.doc, restored);

  // Forward commit with a restore message. This is the load-bearing
  // forward-commit (matches restore.ts `restore-vN`): the history file gains a
  // new commit recording this restore without truncating or rewinding.
  handle.doc.commit({ message: `restore-v${targetVersion}` });

  // Persist NOW: handle.commit() arms the debounced persist (so flush has work),
  // flush() then runs persistPurchaseDoc, writing the .loro sidecar AND the
  // .json mirror synchronously. Matches writePurchaseUpdateThroughLoro.
  await handle.commit();
  await handle.flush();

  // The doc already carries the restored state; project it for the caller.
  return getPurchaseFields(handle.doc);
}
