/**
 * Mobile reorder queue (audit fix-bot, reorder-queue).
 *
 * A scan-to-reorder request from a paired phone used to land as a Note titled
 * "Reorder: <label>", which buried it in the Notes UI where nobody orders
 * anything. Grant's call (2026-06-08): a reorder should become a real purchase
 * line item in "needs_ordering" so it shows up on the Purchases tab and flows
 * through the normal needs-ordering -> approval -> ordered pipeline.
 *
 * Rather than spawn a fresh purchase task per scan (the createReorderPurchase
 * pattern in reorder-actions.ts, used by the on-laptop "Buy again" actions),
 * every mobile reorder collects into ONE dedicated sentinel task so the queue
 * reads as a single "things the phone asked to reorder" list.
 *
 * Sentinel shape (FLAG: new sentinel task id/path, analogous to _misc_purchases):
 *   - project : the per-user hidden `_misc_purchases` project (ensureMiscProject),
 *               reused so reorders never pollute the project list on
 *               Home / Workbench / Gantt;
 *   - task    : a `task_type: "purchase"` task named `_reorder_queue` inside
 *               that project, find-or-created by name (the sentinel);
 *   - items   : one PurchaseItem per scan, category = "Miscellaneous", in
 *               `order_status: "needs_ordering"` by default.
 *
 * On disk this is `users/<user>/tasks/<id>.json` (the sentinel task) plus the
 * usual `purchase_items` records under it. No new fields, no new entity types,
 * no migration. The only new convention is the reserved task NAME.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { tasksApi, purchasesApi } from "@/lib/local-api";
import { ensureMiscProject, MISC_CATEGORY_LABEL } from "@/lib/purchases/misc-project";
import {
  DEFAULT_PURCHASE_ORDER_STATUS,
  type PurchaseItem,
  type PurchaseOrderStatus,
  type Task,
} from "@/lib/types";

/**
 * Reserved on-disk task name for the per-user mobile reorder queue. Leading
 * underscore matches the `_misc_purchases` / `_shared_with_me` convention for
 * "reserved system record".
 */
export const REORDER_QUEUE_TASK_NAME = "_reorder_queue";

/** Local YYYY-MM-DD, matching reorder-actions.ts `todayLocal`. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Predicate: is `t` the reserved reorder-queue sentinel task? Matches on the
 * conjunction of the reserved name AND `task_type: "purchase"` so a user task
 * that happens to be named `_reorder_queue` (a list / experiment) does not
 * collapse into the queue.
 */
export function isReorderQueueTask(t: Task): boolean {
  return t.task_type === "purchase" && t.name === REORDER_QUEUE_TASK_NAME;
}

/**
 * Find-or-create the reorder-queue sentinel task for `currentUser`. Idempotent:
 * a second call returns the same task without writing a new one. The task lives
 * in the hidden misc-purchases project so it stays out of project views.
 */
export async function ensureReorderQueueTask(currentUser: string): Promise<Task> {
  if (!currentUser || typeof currentUser !== "string" || currentUser.trim().length === 0) {
    throw new Error("ensureReorderQueueTask: currentUser is required");
  }
  const misc = await ensureMiscProject(currentUser);
  const tasks = await tasksApi.listByProject(misc.id);
  const existing = tasks.find(isReorderQueueTask);
  if (existing) return existing;

  return tasksApi.create({
    name: REORDER_QUEUE_TASK_NAME,
    start_date: todayLocal(),
    duration_days: 1,
    task_type: "purchase",
    project_id: misc.id,
  });
}

/** A single scan's worth of reorder data, projected to what a line item needs. */
export interface ReorderQueueSeed {
  /** Best-effort display name for the line item (reorderLabel from the poll). */
  item_name: string;
  vendor?: string | null;
  /** Product page link, if the phone knew one. */
  link?: string | null;
  /** Catalog number. Carried in notes today (PurchaseItem has no dedicated
   *  field yet); if a parallel chip adds `catalog_number` to PurchaseItem,
   *  prefer that column and drop it from the notes string. */
  catalog_number?: string | null;
  /** Scanned barcode. */
  product_barcode?: string | null;
  /** Source inventory item id, if the scan resolved to a known stock row. */
  inventory_item_id?: number | string | null;
  /** Free-text note the phone attached. */
  note?: string | null;
}

/**
 * Assemble the human-readable notes string for a reorder line item. Holds the
 * fields PurchaseItem has no dedicated column for (catalog number, barcode,
 * source inventory id) plus a provenance line so the lab knows it came from a
 * phone scan. Returns null when there is nothing worth recording.
 */
export function buildReorderNotes(seed: ReorderQueueSeed): string | null {
  const lines: string[] = ["Reorder request from a paired phone."];
  // catalog_number now lands in the dedicated PurchaseItem.catalog_number
  // column (added by the additive-fields work), so it is no longer duplicated
  // into the notes string.
  if (seed.product_barcode) lines.push(`Barcode: ${seed.product_barcode}`);
  if (seed.inventory_item_id !== undefined && seed.inventory_item_id !== null)
    lines.push(`Inventory item id: ${seed.inventory_item_id}`);
  if (seed.note) lines.push(`Note: ${seed.note}`);
  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * Land a scanned reorder as a real purchase line item in the reorder queue.
 * Find-or-creates the sentinel task, then creates one PurchaseItem under it.
 * Returns the queue task id + created item.
 *
 * `orderStatus` overrides the default "needs_ordering" status. Pass "received"
 * for the create-purchase action (phone scanned a package that arrived
 * immediately; no ordering step needed). The item still lands under the same
 * sentinel task so all mobile-sourced purchases appear together on the
 * Purchases tab.
 */
export async function addReorderQueueItem(
  currentUser: string,
  seed: ReorderQueueSeed,
  orderStatus: PurchaseOrderStatus = DEFAULT_PURCHASE_ORDER_STATUS,
): Promise<{ taskId: number; item: PurchaseItem }> {
  const name = seed.item_name.trim() || "item";
  const task = await ensureReorderQueueTask(currentUser);
  const item = await purchasesApi.create({
    task_id: task.id,
    item_name: name,
    quantity: 1,
    vendor: seed.vendor ?? null,
    link: seed.link ?? null,
    catalog_number: seed.catalog_number ?? null,
    category: MISC_CATEGORY_LABEL,
    notes: buildReorderNotes(seed),
    order_status: orderStatus,
  });
  return { taskId: task.id, item };
}
