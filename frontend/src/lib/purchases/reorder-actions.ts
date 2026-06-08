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
  // Inventory link (supplies-v2 chunk 4). A reorder started from a Supply
  // stamps the backing InventoryItem id so the new line attaches to that
  // supply with no identity match. Null for order-only / brand-new supplies.
  inventory_item_id?: number | null;
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
    inventory_item_id: seed.inventory_item_id ?? null,
    // Explicit for clarity even though create() defaults the same value:
    // the reorder re-enters the pipeline at the start, never mid-flow.
    order_status: DEFAULT_PURCHASE_ORDER_STATUS,
  });

  return { taskId: task.id, item };
}

/** Funding to apply to a whole draft-order batch (supplies-v2 chunk 4). The
 *  caller resolves the typed label to an account id the same way
 *  NewPurchaseModal does (find an existing account, else create one), then
 *  passes both so every line in the batch records the same funding context. */
export interface BatchFunding {
  funding_account_id: number | null;
  funding_string: string | null;
}

export interface SubmitDraftOrderOptions extends CreateReorderOptions {
  /** One funding context for the whole batch (decision 2, the cart keeps the
   *  one-funding-context-per-order contract). */
  funding?: BatchFunding;
  /** Parent task name. Defaults to a count-based label. */
  orderName?: string;
}

/**
 * Submit a draft reorder order (supplies-v2 chunk 4, decision 2). Unlike
 * `createReorderPurchase` (one task per item), this batches several reorder
 * seeds into ONE purchase task with ONE funding context, mirroring how a real
 * order groups items for one submission and one PI approval pass. Each line
 * starts in `needs_ordering` and flows through the normal pipeline.
 *
 * Routes to the explicit project, else the per-user Miscellaneous bucket
 * (same contract as createReorderPurchase). Returns the task id + the created
 * line items.
 */
export async function submitDraftOrder(
  seeds: ReorderItemSeed[],
  options: SubmitDraftOrderOptions = {},
): Promise<{ taskId: number; items: PurchaseItem[] }> {
  const clean = seeds.filter((s) => s.item_name.trim().length > 0);
  if (clean.length === 0) {
    throw new Error("submitDraftOrder: at least one item is required");
  }

  let projectId: number | undefined;
  let itemCategory: string | null = null;
  if (options.projectId && options.projectId > 0) {
    projectId = options.projectId;
  } else {
    if (!options.currentUser) {
      throw new Error(
        "submitDraftOrder: currentUser is required to route to the Miscellaneous bucket",
      );
    }
    const miscProject = await ensureMiscProject(options.currentUser);
    projectId = miscProject.id;
    itemCategory = MISC_CATEGORY_LABEL;
  }

  const orderName =
    options.orderName?.trim() ||
    `Reorder (${clean.length} ${clean.length === 1 ? "item" : "items"})`;

  const task = await tasksApi.create({
    name: orderName,
    start_date: todayLocal(),
    duration_days: 1,
    task_type: "purchase",
    project_id: projectId,
  });

  const fundingAccountId = options.funding?.funding_account_id ?? null;
  const fundingString = options.funding?.funding_string ?? null;

  const items: PurchaseItem[] = [];
  for (const seed of clean) {
    const item = await purchasesApi.create({
      task_id: task.id,
      item_name: seed.item_name.trim(),
      quantity: seed.quantity && seed.quantity > 0 ? seed.quantity : 1,
      price_per_unit: seed.price_per_unit ?? 0,
      vendor: seed.vendor ?? null,
      cas: seed.cas ?? null,
      link: seed.link ?? null,
      catalog_number: seed.catalog_number ?? null,
      funding_account_id: fundingAccountId,
      funding_string: fundingString,
      notes: seed.notes ?? null,
      category: itemCategory,
      inventory_item_id: seed.inventory_item_id ?? null,
      order_status: DEFAULT_PURCHASE_ORDER_STATUS,
    });
    items.push(item);
  }

  return { taskId: task.id, items };
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
