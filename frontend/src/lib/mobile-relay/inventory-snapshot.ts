// Mobile DOWNLOAD path, the laptop inventory publisher (barcode reorder, web half).
//
// Builds a small snapshot of the connected folder's inventory and seals it,
// once per paired phone, to that phone's X25519 key before publishing it to the
// capture relay under the "inventory" kind. The relay only ever holds the sealed
// bytes, so a phone with the matching device key is the only thing that can read
// its own snapshot. The phone uses this snapshot to resolve a scanned barcode to
// a known item before sending a reorder request back up.
//
// This mirrors today-snapshot.ts exactly; see that file + relay/scripts/
// smoke-snapshot.mjs for the full seal/openSealed round-trip contract.
//
// W2 (scan-manager web sub-bot, 2026-06-08): extended with three additive fields
// on the snapshot:
//   trackedStocks[] - one entry per InventoryStock with both product_barcode AND
//     units_per_scan set (the "tracked" stocks the mobile deduct UI cares about).
//   recentPurchases[] - purchase items currently in order_status === "ordered".
//   barcodeIndex - a best-effort map productBarcode -> {name, vendor, catalog}
//     drawn from items + stocks, used for the new-package autopopulate guess.
//
// No em-dashes, no emojis, no mid-sentence colons.

import {
  inventoryItemsApi,
  inventoryStocksApi,
  purchasesApi,
  fetchAllTasks,
  fetchAllStorageNodesIncludingShared,
  fetchAllLabMapsIncludingShared,
} from "@/lib/local-api";
import { buildNodePath } from "@/components/inventory/inventory-ui";
import type { StorageNode, LabMap } from "@/lib/types";
import { sealToRecipient } from "@/lib/sharing/encryption";
import { decodePublicKey } from "@/lib/sharing/identity/keys";
import { listDevices, publishSnapshot, type UserCaptureKeys } from "./client";

/** A single inventory item as it appears in the phone's scan-to-identify view. */
export interface SnapshotInventoryItem {
  id: number;
  name: string;
  category: string;
  vendor: string | null;
  catalog_number: string | null;
  product_barcode: string | null;
  low_at_count: number | null;
  container_label: string | null;
}

/**
 * One tracked stock entry, shown in the mobile deduct UI.
 * A stock qualifies when the parent item has product_barcode set AND the stock
 * has units_per_scan set (i.e. the lab explicitly registered it for scan tracking).
 *
 * `unitLabel`: the human label for one scan's unit ("tip", "rxn", "mL"). Sourced
 * from `InventoryStock.scan_unit_label` when set; otherwise falls back to
 * `InventoryStock.unit` (the amount-per-container label, e.g. "uL"); otherwise
 * an empty string. The mobile UI hides the label when empty.
 */
export interface SnapshotTrackedStock {
  stockId: number;
  itemName: string;
  vendor: string | null;
  productBarcode: string;
  unitsPerScan: number;
  unitsRemaining: number;
  unitLabel: string;
  lowAtCount: number | null;
  purchaseItemId: number | null;
  totalUnits: number;
  /**
   * Free-text physical location of this stock ("-80 door, left"), from
   * `InventoryStock.location_text`. Null when the lab has not recorded one yet.
   * Spatial inventory Phase A: surfaced so the phone can answer "where is it"
   * and the scan-in flow can prompt + set it. Additive (an older phone ignores it).
   */
  location: string | null;
  /**
   * Structured location path resolved from the lab's StorageNode tree
   * (`location_node_id` + `position`), e.g. "-80 #2 > Rack 1 > Box: Q5 - A1".
   * Spatial inventory Phase B bridge: the laptop's box-finder placement, read-only
   * on the phone. Null when the stock has no structured location (then the phone
   * falls back to `location`). Additive.
   */
  locationPath: string | null;
  /**
   * The stock's raw `location_node_id`, so the phone can "find it on the room
   * map": walk this node up the tree to the nearest pinned ancestor and highlight
   * that pin. Null when unplaced. Phase C. Additive.
   */
  locationNodeId: number | null;
}

/**
 * One recent purchase: an ordered-but-not-yet-arrived purchase item.
 * The mobile "match received package" flow shows these so the user can mark
 * one as arrived with a single tap.
 */
export interface SnapshotRecentPurchase {
  purchaseItemId: number;
  name: string;
  vendor: string | null;
  orderedDate: string | null;
  catalog: string | null;
  productBarcode: string | null;
}

/**
 * Barcode index entry: best-effort guess for an unknown barcode.
 * Populated from items that have product_barcode set + from purchase items
 * that have catalog_number (which might carry a barcode value on older records).
 */
export interface SnapshotBarcodeIndexEntry {
  name: string;
  vendor: string | null;
  catalog: string | null;
}

/**
 * One node of the lab's storage tree, projected for the phone's cascading
 * location picker (spatial inventory Phase B bridge, write half). The phone walks
 * `parentId` one level at a time; a `box` node exposes its `boxRows` x `boxCols`
 * grid as the A1 position options. Mirrors `StorageNode` minus display-only fields.
 */
export interface SnapshotStorageNode {
  id: number;
  name: string;
  kind: string;
  parentId: number | null;
  boxRows: number | null;
  boxCols: number | null;
}

/** One pin on the room map, projected for the phone's read-only viewer. Marks a
 *  StorageNode (`nodeId`) or a free label at a normalized 0..1 (x,y). Phase C. */
export interface SnapshotLabMapPin {
  nodeId: number | null;
  label: string | null;
  x: number;
  y: number;
}

/** The lab's 2D room map, projected for the phone (read-only). `aspect` =
 *  width/height of the plan. Null published when the lab has no map yet. Phase C. */
export interface SnapshotLabMap {
  aspect: number;
  pins: SnapshotLabMapPin[];
}

/** The decrypted shape the phone reads after openSealed. */
export interface InventorySnapshot {
  generatedAt: string;
  items: SnapshotInventoryItem[];
  /** W2 additions (scan-manager web sub-bot, 2026-06-08). All additive: a phone
   *  built before these were added simply ignores the new fields. */
  trackedStocks: SnapshotTrackedStock[];
  recentPurchases: SnapshotRecentPurchase[];
  barcodeIndex: Record<string, SnapshotBarcodeIndexEntry>;
  /** The whole-lab storage tree, so the phone scan-in flow can offer a structured
   *  location picker (Phase B bridge, write half). Additive. */
  storageNodes: SnapshotStorageNode[];
  /** The lab's 2D room map (Phase C), so the phone can render it + find an item
   *  on it. Null when the lab has not started a map. Additive. */
  labMap: SnapshotLabMap | null;
}

/** Reads the connected folder's inventory and builds the snapshot. */
export async function buildInventorySnapshot(): Promise<InventorySnapshot> {
  // Parallel fetch to keep snapshot build fast.
  const [items, stocks, purchases, tasks, storageNodes, labMaps] = await Promise.all([
    inventoryItemsApi.list(),
    inventoryStocksApi.list(),
    purchasesApi.listAll(),
    fetchAllTasks(),
    // The location tree is whole-lab shared, so a stock owned by this user may
    // sit in a node another member created. Use the shared-inclusive read.
    fetchAllStorageNodesIncludingShared().catch(() => [] as StorageNode[]),
    // The room map is one-per-lab, whole-lab shared. Read-only here (never create).
    fetchAllLabMapsIncludingShared().catch(() => [] as LabMap[]),
  ]);

  // ── Item lookup maps ──────────────────────────────────────────────────────
  // item by id, for stock -> item join.
  const itemById = new Map(items.map((i) => [i.id, i]));

  // Storage-node lookup for resolving a stock's structured location to a path.
  const nodesById = new Map<number, StorageNode>(
    storageNodes.map((n) => [n.id, n]),
  );

  // Resolve a stock's `location_node_id` + `position` to a readable path like
  // "-80 #2 > Box: Q5 - A1". Returns null when the stock is not placed in the
  // tree (the phone then falls back to the free-text `location_text`).
  const resolveLocationPath = (
    nodeId: number | null | undefined,
    position: string | null | undefined,
  ): string | null => {
    if (nodeId == null) return null;
    const path = buildNodePath(nodeId, nodesById);
    if (path.length === 0) return null;
    const names = path.map((n) => n.name).join(" > ");
    const pos = (position ?? "").trim();
    return pos ? `${names} - ${pos}` : names;
  };

  // task start_date by task id, for orderedDate in recentPurchases.
  const taskDateById = new Map(
    (tasks as Array<{ id: number; start_date: string; task_type: string }>)
      .filter((t) => t.task_type === "purchase")
      .map((t) => [t.id, t.start_date]),
  );

  // ── trackedStocks ─────────────────────────────────────────────────────────
  // A stock qualifies when the PARENT ITEM has product_barcode set (so the
  // scanner can resolve it) AND the stock itself has units_per_scan set (so the
  // deduct flow knows how many units to subtract per scan).
  const trackedStocks: SnapshotTrackedStock[] = [];
  for (const stock of stocks) {
    if (
      typeof stock.units_per_scan !== "number" ||
      stock.units_per_scan <= 0
    ) {
      continue;
    }
    const item = itemById.get(stock.item_id);
    if (!item?.product_barcode) continue;

    // units_remaining defaults to totalUnits (same value stored at registration)
    // when absent on a legacy record. Treat absence as 0 (should not happen for
    // a properly registered stock, but defensive is better than NaN in the UI).
    const unitsRemaining = stock.units_remaining ?? 0;
    const totalUnits = stock.units_remaining ?? 0;

    // Resolve the unit label. Priority: scan_unit_label > stock.unit > "".
    const unitLabel =
      (stock.scan_unit_label && stock.scan_unit_label.trim()) ||
      (stock.unit && stock.unit.trim()) ||
      "";

    trackedStocks.push({
      stockId: stock.id,
      itemName: item.name,
      vendor: item.vendor,
      productBarcode: item.product_barcode,
      unitsPerScan: stock.units_per_scan,
      unitsRemaining,
      unitLabel,
      lowAtCount: item.low_at_count,
      purchaseItemId: stock.purchase_item_id,
      totalUnits,
      location: (stock.location_text && stock.location_text.trim()) || null,
      locationPath: resolveLocationPath(stock.location_node_id, stock.position),
      locationNodeId: stock.location_node_id ?? null,
    });
  }

  // ── recentPurchases ───────────────────────────────────────────────────────
  // Purchase items currently in "ordered" status (on their way, not yet arrived).
  // The mobile "mark as arrived" flow surfaces these for one-tap receiving.
  const recentPurchases: SnapshotRecentPurchase[] = purchases
    .filter((p) => p.order_status === "ordered")
    .map((p) => ({
      purchaseItemId: p.id,
      name: p.item_name,
      vendor: p.vendor,
      orderedDate: taskDateById.get(p.task_id) ?? null,
      catalog: p.catalog_number,
      // product_barcode lives on the InventoryItem, not the PurchaseItem, so
      // this field is null for now. After a barcode scan links a purchase to
      // an inventory item, the item carries the barcode and barcodeIndex covers
      // the reverse lookup. Kept here as a nullable slot for forward-compat.
      productBarcode: null,
    }));

  // ── barcodeIndex ──────────────────────────────────────────────────────────
  // Best-effort map productBarcode -> {name, vendor, catalog} for the
  // new-package autopopulate guess. Populated from two sources:
  //   1. InventoryItem records that already have product_barcode set.
  //   2. PurchaseItem records (catalog_number might be a barcode for some labs).
  // Source 1 wins if both have the same barcode (most precise, lab-confirmed).
  const barcodeIndex: Record<string, SnapshotBarcodeIndexEntry> = {};

  // Purchase items first (lower priority, can be overwritten by items).
  for (const p of purchases) {
    // Use catalog_number as a secondary barcode signal only when the purchase
    // item has one and there is no item-level barcode for it yet.
    if (p.catalog_number) {
      if (!barcodeIndex[p.catalog_number]) {
        barcodeIndex[p.catalog_number] = {
          name: p.item_name,
          vendor: p.vendor,
          catalog: p.catalog_number,
        };
      }
    }
  }

  // InventoryItem records (higher priority, overwrite purchase entries).
  for (const item of items) {
    if (item.product_barcode) {
      barcodeIndex[item.product_barcode] = {
        name: item.name,
        vendor: item.vendor,
        catalog: item.catalog_number,
      };
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category,
      vendor: i.vendor,
      catalog_number: i.catalog_number,
      product_barcode: i.product_barcode,
      low_at_count: i.low_at_count,
      container_label: i.container_label,
    })),
    trackedStocks,
    recentPurchases,
    barcodeIndex,
    storageNodes: storageNodes.map((n) => ({
      id: n.id,
      name: n.name,
      kind: n.kind,
      parentId: n.parent_id,
      boxRows: n.box_rows,
      boxCols: n.box_cols,
    })),
    labMap: (() => {
      // One map per lab; pick the lowest id when several exist (matches
      // getOrCreateLabMap). Publish null when the lab has not started one.
      const map = [...labMaps].sort((a, b) => a.id - b.id)[0];
      if (!map) return null;
      return {
        aspect: map.plan?.aspect ?? 1.5,
        pins: map.pins.map((p) => ({
          nodeId: p.nodeId,
          label: p.label,
          x: p.x,
          y: p.y,
        })),
      };
    })(),
  };
}

/**
 * Builds the inventory snapshot once, then seals + publishes a copy to every
 * paired phone that has an X25519 key on file. Phones registered before the
 * DOWNLOAD path landed have no seal key and are skipped (logged, not an error).
 * Returns how many were published vs skipped.
 */
export async function publishInventoryToAllDevices(
  keys: UserCaptureKeys,
): Promise<{ published: number; skipped: number }> {
  const devices = await listDevices(keys);
  if (devices.length === 0) return { published: 0, skipped: 0 };

  const snap = await buildInventorySnapshot();
  const plaintext = new TextEncoder().encode(JSON.stringify(snap));

  let published = 0;
  let skipped = 0;
  for (const device of devices) {
    if (!device.x25519Pubkey) {
      console.info(
        `[inventory-publisher] skip device ${device.devicePubkey.slice(0, 12)}... (no x25519 seal key)`,
      );
      skipped += 1;
      continue;
    }
    const sealed = sealToRecipient(plaintext, decodePublicKey(device.x25519Pubkey));
    await publishSnapshot(keys, "inventory", device.devicePubkey, sealed);
    published += 1;
  }
  return { published, skipped };
}
