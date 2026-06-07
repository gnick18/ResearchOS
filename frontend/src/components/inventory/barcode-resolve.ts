// Pure scan resolver (chunk 6, design 15.2). Given a scanned code string plus
// the already-loaded inventory items + stocks, classify what the code points
// at so the scan flow can branch (consume / multi-pick / register).
//
// Resolution order (design 15.2): a lab-applied per-container `container_code`
// is the PRIMARY path and is matched FIRST. It points at exactly one container,
// so a hit skips the multi-match picker. Only if no container_code matches do we
// fall back to an item's manufacturer `product_barcode`, which may be shared
// across several stocks (the multi-match case).
//
// Pure + deterministic: items and stocks are passed in, nothing is fetched.
// Matching is trim + case-insensitive so a hand-typed code or a slightly noisy
// scan still resolves.

import type { InventoryItem, InventoryStock } from "@/lib/types";

/** The discriminated outcome of resolving one scanned code. */
export type BarcodeResolution =
  | {
      /** The code exactly matched one stock's `container_code` (primary path,
       *  points at exactly one container). */
      kind: "container";
      stock: InventoryStock;
      item: InventoryItem;
    }
  | {
      /** The code matched an item's `product_barcode` and the item has exactly
       *  one stock, so we can consume directly. */
      kind: "product-single";
      item: InventoryItem;
      stock: InventoryStock;
    }
  | {
      /** The code matched an item's `product_barcode` and the item has 2+
       *  stocks, so the user must pick which container they used. */
      kind: "product-multi";
      item: InventoryItem;
      stocks: InventoryStock[];
    }
  | {
      /** Nothing matched. The register flow takes over. */
      kind: "unknown";
      code: string;
    };

/** Trim + lowercase for tolerant comparison. Returns "" for null/blank. */
function normalizeCode(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Classify a scanned code against the loaded items + stocks.
 *
 * @param rawCode  the scanned (or typed) string, possibly with surrounding
 *                 whitespace and arbitrary case.
 * @param items    the loaded InventoryItem list.
 * @param stocks   the loaded InventoryStock list.
 */
export function resolveBarcode(
  rawCode: string,
  items: InventoryItem[],
  stocks: InventoryStock[],
): BarcodeResolution {
  const code = normalizeCode(rawCode);
  // A blank scan can never match a record; treat it as unknown with the
  // original (trimmed) string so the register card shows what was scanned.
  if (!code) return { kind: "unknown", code: rawCode.trim() };

  const itemById = new Map(items.map((it) => [`${it.owner}:${it.id}`, it]));

  // 1) container_code FIRST (design 15.2). Exactly one container.
  for (const stock of stocks) {
    if (normalizeCode(stock.container_code) === code) {
      const item = itemById.get(`${stock.owner}:${stock.item_id}`);
      if (item) return { kind: "container", stock, item };
    }
  }

  // 2) product_barcode on an item. Collect the item's own stocks to decide
  //    single vs multi.
  for (const item of items) {
    if (normalizeCode(item.product_barcode) === code) {
      const itemStocks = stocks.filter(
        (s) => s.owner === item.owner && s.item_id === item.id,
      );
      if (itemStocks.length === 1) {
        return { kind: "product-single", item, stock: itemStocks[0] };
      }
      if (itemStocks.length >= 2) {
        return { kind: "product-multi", item, stocks: itemStocks };
      }
      // The product barcode matched but the item has no stocks to consume.
      // Fall through to unknown so the user is steered to register / add stock
      // rather than landing on an empty consume card.
    }
  }

  return { kind: "unknown", code: rawCode.trim() };
}
