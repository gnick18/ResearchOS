// Supplies v2 unified page (SUPPLIES_V2_UNIFIED.md), chunk 4: reorder logic.
//
// Pure helpers that turn a Supply (the view-model from chunk 1) into a reorder
// line. "Reorder is informed by on-hand" (section 4.4): because both states
// live on one row, the prefilled quantity comes from the gap between the low
// threshold and what is on hand, and the line carries `inventory_item_id` so
// the new purchase attaches back to the right supply with no retyped identity.
//
// Side-effect-free; the write path lives in lib/purchases/reorder-actions. No
// new storage. House style: no em-dashes, no mid-sentence colons, no emojis.

import type { InventoryItem } from "@/lib/types";
import type { Supply } from "./supply-model";

/**
 * Prefill quantity for a reorder from the on-hand gap. When the supply's
 * inventory item carries a low threshold, order enough to clear it
 * (low_at_count - on-hand total), at least one. With no threshold (or already
 * at or above it) we cannot infer a gap, so default to one.
 *
 * Exported for direct testing.
 */
export function reorderQuantityFromGap(
  lowAtCount: number | null | undefined,
  onHandTotal: number,
): number {
  if (lowAtCount != null && Number.isFinite(lowAtCount) && lowAtCount > 0) {
    const gap = Math.ceil(lowAtCount - onHandTotal);
    if (gap >= 1) return gap;
  }
  return 1;
}

/** A reorder line seeded from a supply's identity. A superset of the fields
 *  the purchases write path copies forward, plus the inventory FK. */
export interface SupplyReorderSeed {
  item_name: string;
  vendor: string | null;
  cas: string | null;
  link: string | null;
  catalog_number: string | null;
  /** The supply's category, carried for display; the purchase write decides
   *  the on-disk PurchaseItem.category (misc-bucket marker or null). */
  category: string | null;
  /** Stamped on the new PurchaseItem so it attaches to this supply with no
   *  identity match needed. Null for order-only / brand-new supplies. */
  inventory_item_id: number | null;
  quantity: number;
}

/**
 * Build a reorder seed from a supply. Identity is copied from the supply
 * (never retyped, the redundancy killer of section 4.1); the link comes from
 * the backing inventory item when present. The quantity prefills from the gap
 * using the item's low threshold and the supply's on-hand total. Order-only
 * and brand-new supplies have no inventory item, so `inventory_item_id` stays
 * null and the quantity falls back to one.
 *
 * `item` is the InventoryItem backing the supply (supply.onHand.itemIds[0]),
 * or null for an order-only supply.
 */
export function seedFromSupply(
  supply: Supply,
  item: InventoryItem | null,
): SupplyReorderSeed {
  const onHandTotal = supply.onHand?.totalCount ?? 0;
  return {
    item_name: supply.identity.name,
    vendor: supply.identity.vendor,
    cas: supply.identity.cas,
    link: item?.url ?? null,
    catalog_number: supply.identity.catalogNumber,
    category: supply.identity.category,
    inventory_item_id: supply.onHand?.itemIds[0] ?? null,
    quantity: reorderQuantityFromGap(item?.low_at_count ?? null, onHandTotal),
  };
}
