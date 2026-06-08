/**
 * Reorder write actions (reorder-loop sub-bot, 2026-05-31).
 *
 * Shared "create a fresh needs-ordering line item" helpers used by the
 * three reorder features:
 *   - Feature 1: quick capture from the global cluster (typed / catalog-
 *     matched item)
 *   - Feature 2: one-click "Buy again" on a received item
 *   - Feature 3: the "Buy again" action on a reorder-cadence suggestion
 *
 * ZERO data-shape change: every write goes through the existing
 * `tasksApi.create` (a `task_type: "purchase"` parent) + `purchasesApi
 * .create` (the line item) exactly the way NewPurchaseModal does today.
 * The new item lands in `order_status: "needs_ordering"` and then flows
 * through the normal needs-ordering -> approval -> ordered pipeline - no
 * special path. No new fields, no new entities.
 */

import { tasksApi, purchasesApi } from "@/lib/local-api";
import { ensureMiscProject, MISC_CATEGORY_LABEL } from "@/lib/purchases/misc-project";
import { DEFAULT_PURCHASE_ORDER_STATUS, type PurchaseItem } from "@/lib/types";

/** Local YYYY-MM-DD, matching NewPurchaseModal's `todayLocal`. The new
 *  purchase task is dated today so the cadence model (which reads
 *  task.start_date) sees the reorder as a fresh ordering event. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** The reagent fields a reorder copies forward. A superset of what each
 *  feature has on hand: Feature 2 passes a whole PurchaseItem, Features 1
 *  and 3 pass a catalog / suggestion projection. */
export interface ReorderItemSeed {
  item_name: string;
  vendor?: string | null;
  cas?: string | null;
  link?: string | null;
  // Vendor ordering / catalog number (audit fix, additive-fields). Carried
  // forward so a reorder keeps the catalog id the user types into the vendor.
  catalog_number?: string | null;
  price_per_unit?: number | null;
  quantity?: number | null;
  notes?: string | null;
  funding_string?: string | null;
}

export interface CreateReorderOptions {
  /** Destination project for the new purchase task. When omitted (or 0)
   *  the item routes to the per-user hidden `_misc_purchases` project,
   *  matching how NewPurchaseModal handles an unselected category. */
  projectId?: number | null;
  /** Current username - required to find-or-create the misc project when
   *  no projectId is supplied. */
  currentUser?: string;
}

/**
 * Create a brand-new purchase order (parent task + one line item) from a
 * reorder seed. The line item starts in `needs_ordering`. Returns the
 * created task id + item so callers can refresh / focus.
 *
 * Mirrors NewPurchaseModal's save flow:
 *   1. resolve the destination project (explicit id, else misc)
 *   2. create the `task_type: "purchase"` parent dated today
 *   3. create the line item under it, copying the reagent fields
 */
export async function createReorderPurchase(
  seed: ReorderItemSeed,
  options: CreateReorderOptions = {},
): Promise<{ taskId: number; item: PurchaseItem }> {
  const name = seed.item_name.trim();
  if (!name) {
    throw new Error("createReorderPurchase: item_name is required");
  }

  // Resolve the destination project. A real project id wins; otherwise
  // route to the hidden misc project (find-or-create), tagging the line
  // item's category with the reserved label so downstream filters /
  // dashboards recognise it as a misc purchase (same contract as the
  // NewPurchaseModal misc path).
  let projectId: number | undefined;
  let itemCategory: string | null = null;
  if (options.projectId && options.projectId > 0) {
    projectId = options.projectId;
  } else {
    if (!options.currentUser) {
      throw new Error(
        "createReorderPurchase: currentUser is required to route to the Miscellaneous bucket",
      );
    }
    const miscProject = await ensureMiscProject(options.currentUser);
    projectId = miscProject.id;
    itemCategory = MISC_CATEGORY_LABEL;
  }

  const task = await tasksApi.create({
    name,
    start_date: todayLocal(),
    duration_days: 1,
    task_type: "purchase",
    project_id: projectId,
  });

  const item = await purchasesApi.create({
    task_id: task.id,
    item_name: name,
    quantity: seed.quantity && seed.quantity > 0 ? seed.quantity : 1,
    price_per_unit: seed.price_per_unit ?? 0,
    vendor: seed.vendor ?? null,
    cas: seed.cas ?? null,
    link: seed.link ?? null,
    catalog_number: seed.catalog_number ?? null,
    funding_string: seed.funding_string ?? null,
    notes: seed.notes ?? null,
    category: itemCategory,
    // Explicit for clarity even though create() defaults the same value:
    // the reorder re-enters the pipeline at the start, never mid-flow.
    order_status: DEFAULT_PURCHASE_ORDER_STATUS,
  });

  return { taskId: task.id, item };
}

/** Project a full PurchaseItem down to a reorder seed (Feature 2's
 *  "Buy again"). Copies name / vendor / cas / link / price / quantity. */
export function seedFromPurchaseItem(item: PurchaseItem): ReorderItemSeed {
  return {
    item_name: item.item_name,
    vendor: item.vendor,
    cas: item.cas,
    link: item.link,
    catalog_number: item.catalog_number,
    price_per_unit: item.price_per_unit,
    quantity: item.quantity,
  };
}
