// Supplies v2 unified page (SUPPLIES_V2_UNIFIED.md), chunk 1: the link layer.
//
// A "Supply" is one physical thing the lab buys and/or keeps, identified by its
// identity fields, with up to two ORTHOGONAL state sections: on-hand (from
// Inventory) and ordering (from Purchases). This module is the pure view-layer
// UNION: it does NOT merge the two data models, it presents an InventoryItem (+
// its stocks) and the open / past PurchaseItem lines that belong to it as one
// Supply.
//
// Keying is by IDENTITY (vendor+catalog when both present, else normalized
// name), lab-wide. This is deliberate:
//   - it matches the unified concept ("the lab has Taq from NEB M0273"),
//     collapsing same-identity inventory records across owners into one Supply;
//   - it sidesteps the numeric-id collision class entirely (two owners each with
//     inventory item id 1 do NOT collide, because the key is identity, not id).
//
// Linking an OPEN purchase line to a supply uses, in precedence order:
//   1. PurchaseItem.inventory_item_id (stamped by "Reorder" from a supply), and
//   2. identity match (the line's own vendor+catalog / name).
// A line that matches no inventory item forms an ORDER-ONLY supply (a flight,
// a service, a one-off). The post-receipt direction (received line -> stock) is
// InventoryStock.purchase_item_id and is the inventory side's concern.
//
// Pure + side-effect-free; the caller supplies the already-loaded records. No
// new storage. House style: no em-dashes, no mid-sentence colons, no emojis.

import type {
  InventoryItem,
  InventoryStock,
  InventoryStockStatus,
  PurchaseItem,
} from "@/lib/types";
import { normalizeOrderStatus } from "@/lib/types";

/** Identity shared by an inventory item and a purchase line for the same thing. */
export interface SupplyIdentity {
  name: string;
  vendor: string | null;
  catalogNumber: string | null;
  cas: string | null;
  category: string | null;
}

/** On-hand state, aggregated from an item's stocks. Null section = nothing on hand. */
export interface SupplyOnHand {
  /** The inventory item(s) backing this supply (usually one; more if the same
   *  identity exists under multiple owners in a shared lab). */
  itemIds: number[];
  totalCount: number;
  stockCount: number;
  /** Most urgent status across the stocks (empty > low > in_stock). */
  worstStatus: InventoryStockStatus;
  /** Soonest non-null expiration across stocks, or null. */
  soonestExpiry: string | null;
}

/** Ordering state, from the OPEN (non-received) purchase lines for this supply. */
export interface SupplyOrdering {
  openLines: PurchaseItem[];
  needsOrderingCount: number;
  orderedCount: number;
}

export type SupplyKind = "both" | "onHand" | "order";

export interface Supply {
  /** Identity key (vendor:catalog or name), stable across owners. */
  key: string;
  identity: SupplyIdentity;
  onHand: SupplyOnHand | null;
  ordering: SupplyOrdering | null;
  kind: SupplyKind;
}

export interface BuildSuppliesInput {
  items: InventoryItem[];
  stocks: InventoryStock[];
  /** Purchase lines; only non-received lines count as "on order". Received lines
   *  are inventory's job (they became stock), so they are ignored here. */
  purchases: PurchaseItem[];
}

const STATUS_RANK: Record<InventoryStockStatus, number> = {
  empty: 3,
  low: 2,
  in_stock: 1,
  expired: 4,
};

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** The lab-wide identity key. vendor+catalog when BOTH are present (the precise
 *  reorder identity), else the normalized name. Never empty for a named record. */
export function supplyKeyFor(args: {
  name: string;
  vendor: string | null;
  catalogNumber: string | null;
}): string {
  const v = norm(args.vendor);
  const c = norm(args.catalogNumber);
  if (v && c) return `vc:${v}|${c}`;
  return `n:${norm(args.name)}`;
}

function itemKey(item: InventoryItem): string {
  return supplyKeyFor({
    name: item.name,
    vendor: item.vendor,
    catalogNumber: item.catalog_number,
  });
}

function purchaseOwnKey(p: PurchaseItem): string {
  return supplyKeyFor({
    name: p.item_name,
    vendor: p.vendor,
    catalogNumber: p.catalog_number,
  });
}

/**
 * Resolve which supply key an open purchase line belongs to.
 *  1. inventory_item_id (the stamped FK) -> that item's key, when the item is
 *     in the provided set.
 *  2. the line's own identity key.
 * Exported for direct testing.
 */
export function resolvePurchaseKey(
  p: PurchaseItem,
  itemsById: Map<number, InventoryItem>,
): string {
  if (p.inventory_item_id != null) {
    const linked = itemsById.get(p.inventory_item_id);
    if (linked) return itemKey(linked);
  }
  return purchaseOwnKey(p);
}

function worstOf(a: InventoryStockStatus, b: InventoryStockStatus): InventoryStockStatus {
  return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
}

/**
 * Build the unified Supply list from the loaded inventory + purchase records.
 * Pure. One Supply per identity key. Stocks attach to their item's key; open
 * purchase lines attach by resolvePurchaseKey; identity governs the union.
 */
export function buildSupplies(input: BuildSuppliesInput): Supply[] {
  const { items, stocks, purchases } = input;

  const itemsById = new Map<number, InventoryItem>();
  for (const it of items) itemsById.set(it.id, it);

  // key -> accumulator
  interface Acc {
    key: string;
    identity: SupplyIdentity;
    itemIds: number[];
    totalCount: number;
    stockCount: number;
    worstStatus: InventoryStockStatus | null;
    soonestExpiry: string | null;
    openLines: PurchaseItem[];
  }
  const byKey = new Map<string, Acc>();

  const ensure = (key: string, identity: SupplyIdentity): Acc => {
    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        key,
        identity,
        itemIds: [],
        totalCount: 0,
        stockCount: 0,
        worstStatus: null,
        soonestExpiry: null,
        openLines: [],
      };
      byKey.set(key, acc);
    }
    return acc;
  };

  // 1. Inventory items seed the on-hand identity.
  for (const it of items) {
    const acc = ensure(itemKey(it), {
      name: it.name,
      vendor: it.vendor,
      catalogNumber: it.catalog_number,
      cas: it.cas,
      category: it.category,
    });
    if (!acc.itemIds.includes(it.id)) acc.itemIds.push(it.id);
  }

  // 2. Stocks aggregate into their item's supply.
  for (const st of stocks) {
    const it = itemsById.get(st.item_id);
    if (!it) continue; // orphan stock, skip
    const acc = byKey.get(itemKey(it));
    if (!acc) continue;
    acc.totalCount += st.container_count;
    acc.stockCount += 1;
    acc.worstStatus = acc.worstStatus ? worstOf(acc.worstStatus, st.status) : st.status;
    if (st.expiration_date) {
      if (!acc.soonestExpiry || st.expiration_date < acc.soonestExpiry) {
        acc.soonestExpiry = st.expiration_date;
      }
    }
  }

  // 3. Open (non-received) purchase lines attach as ordering state.
  for (const p of purchases) {
    if (normalizeOrderStatus(p.order_status) === "received") continue;
    const key = resolvePurchaseKey(p, itemsById);
    const existing = byKey.get(key);
    const acc =
      existing ??
      ensure(key, {
        name: p.item_name,
        vendor: p.vendor,
        catalogNumber: p.catalog_number,
        cas: p.cas,
        category: p.category,
      });
    acc.openLines.push(p);
  }

  // 4. Finalize into Supply view objects.
  const out: Supply[] = [];
  for (const acc of byKey.values()) {
    const hasOnHand = acc.itemIds.length > 0;
    const hasOrdering = acc.openLines.length > 0;
    const onHand: SupplyOnHand | null = hasOnHand
      ? {
          itemIds: acc.itemIds,
          totalCount: acc.totalCount,
          stockCount: acc.stockCount,
          worstStatus: acc.worstStatus ?? "empty",
          soonestExpiry: acc.soonestExpiry,
        }
      : null;
    const ordering: SupplyOrdering | null = hasOrdering
      ? {
          openLines: acc.openLines,
          needsOrderingCount: acc.openLines.filter(
            (p) => normalizeOrderStatus(p.order_status) === "needs_ordering",
          ).length,
          orderedCount: acc.openLines.filter(
            (p) => normalizeOrderStatus(p.order_status) === "ordered",
          ).length,
        }
      : null;
    const kind: SupplyKind = hasOnHand && hasOrdering ? "both" : hasOnHand ? "onHand" : "order";
    out.push({ key: acc.key, identity: acc.identity, onHand, ordering, kind });
  }
  return out;
}
