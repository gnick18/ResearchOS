// Units-per-scan consume helpers (scan-manager sub-bot, 2026-06-08).
//
// Two exported functions:
//
//   deductUnitsFromScan — pure math for one scan deduction: given the current
//     units_remaining and the stock's units_per_scan, returns the new clamped
//     value. Used by ScanFlow (real API write) and by tests.
//
//   registerTrackedBarcode — imperative write helper: given a stock and the
//     total unit count the box started with, flips the stock into tracked mode
//     by setting product_barcode (on the parent item) / units_per_scan /
//     units_remaining and enabling track_consumption. This is what the mobile
//     "Start tracking" step will call when a lab member first scans a new box.
//
// The functions here are additive and backward-compatible. Stocks that never
// call registerTrackedBarcode continue to use the container_count path
// unchanged.

import { inventoryItemsApi, inventoryStocksApi } from "@/lib/local-api";
import type { InventoryItem, InventoryStock } from "@/lib/types";

/**
 * Pure math: compute the units_remaining after one scan deduction.
 *
 * @param currentRemaining  the current units_remaining on the stock.
 * @param unitsPerScan      how many units one scan consumes (must be > 0).
 * @returns the new units_remaining, clamped to a minimum of 0.
 */
export function deductUnitsFromScan(
  currentRemaining: number,
  unitsPerScan: number,
): number {
  return Math.max(0, currentRemaining - unitsPerScan);
}

/**
 * Options for `registerTrackedBarcode`.
 */
export interface RegisterTrackedBarcodeOptions {
  /**
   * The total number of units in the box at registration time. Stored as
   * `units_remaining` and represents "full box" for this stock. Does NOT
   * correspond to `amount_per_container * container_count` automatically;
   * the caller provides the real count (e.g. 96 for a 96-well plate of tips).
   */
  totalUnits: number;

  /**
   * How many units one barcode scan consumes. Defaults to 1 when omitted
   * (one scan = one unit drawn from the box).
   */
  unitsPerScan?: number;

  /**
   * The product barcode to associate with the parent item. When the item
   * already has a product_barcode set and this is omitted, the existing
   * barcode is left untouched. When provided, it overwrites the item's
   * product_barcode so future scans resolve to this item.
   */
  productBarcode?: string | null;

  /**
   * Owner routing for a shared item viewed by a non-owner. Mirrors the
   * `owner` parameter accepted by inventoryStocksApi.update.
   */
  owner?: string;
}

/**
 * Register a stock for units-per-scan tracking.
 *
 * Sets `units_per_scan` and `units_remaining` on the stock, and flips
 * `track_consumption` on the parent item. Optionally binds a product barcode
 * to the parent item so the scan resolver finds it on the next scan.
 *
 * Returns the updated stock on success, or null when the stock is not found.
 *
 * This is a fire-and-forget-safe write: calling it a second time on an already-
 * tracked stock resets units_remaining to totalUnits (useful when a new box of
 * the same product arrives).
 */
export async function registerTrackedBarcode(
  stock: InventoryStock,
  item: InventoryItem,
  options: RegisterTrackedBarcodeOptions,
): Promise<InventoryStock | null> {
  const unitsPerScan =
    typeof options.unitsPerScan === "number" && options.unitsPerScan > 0
      ? options.unitsPerScan
      : 1;

  // Bind the product barcode to the parent item when the caller provides one.
  if (
    options.productBarcode != null &&
    options.productBarcode !== item.product_barcode
  ) {
    await inventoryItemsApi.update(item.id, {
      product_barcode: options.productBarcode,
      track_consumption: true,
    });
  } else if (!item.track_consumption) {
    // Flip track_consumption even when no new barcode is provided.
    await inventoryItemsApi.update(item.id, { track_consumption: true });
  }

  // Write the units ledger fields onto the stock.
  return inventoryStocksApi.update(
    stock.id,
    {
      units_per_scan: unitsPerScan,
      units_remaining: options.totalUnits,
    },
    options.owner,
  );
}
