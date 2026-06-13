// BeakerBot inventory coworker tools (BeakerAI lane, 2026-06-13).
//
// Two gated WRITE tools that let BeakerBot add inventory items and adjust stock
// quantities on behalf of the user. Both pair with the read-only
// summarize_inventory tool (same lane, same deps shape).
//
//   - add_inventory_item: create a new catalog item (the "what a thing IS" record).
//     The user sees a preview of the name, category, and optional fields before
//     anything is written.
//
//   - adjust_inventory_stock: consume or restock a physical container batch. The
//     user names an item (resolved by name lookup; the tool surfaces ambiguity
//     rather than guessing), supplies a delta (positive = restock, negative =
//     consume) or an explicit new container count, and the tool creates a new
//     stock record (restock) or updates the first open stock's container_count
//     (consume). The user sees a preview of the item, the change, and the result
//     before anything writes.
//
// Both are action: true, isDestructive: () => false. Creating and adjusting are
// recoverable (items have a soft-delete trash path; stock counts can be corrected
// by a subsequent adjust). The describeAction preview IS the consent, exactly like
// the experiment coworker tools.
//
// The injectable deps seam mirrors experiment-tools.ts so tests can stub every
// API call and assert the exact payload without a real folder.
//
// Key field names (confirmed from types.ts and local-api.ts):
//   InventoryItem.id               -- numeric (JsonStore autoincrement)
//   InventoryItem.name             -- string, the product display name
//   InventoryItem.category         -- InventoryCategory enum, default "reagent"
//   InventoryItem.low_at_count     -- number | null, the reorder threshold
//   InventoryStock.item_id         -- FK -> InventoryItem.id
//   InventoryStock.container_count -- the PRIMARY quantity spine (count of containers)
//   InventoryStock.status          -- derived-and-persisted by deriveInventoryStatus
//   InventoryStock.lot_number      -- optional provenance string
//   InventoryStock.expiration_date -- optional ISO date string
//   InventoryStock.location_text   -- v1 free-text location stopgap
//
// SCOPE NOTES (for Grant):
//   1. adjust_inventory_stock resolves by name, returns the matched items list
//      when multiple items share the same name so the model can ask which one.
//      It does NOT guess an id.
//   2. A positive delta creates a NEW stock record (restocking a new lot). A
//      negative delta or an explicit absolute count updates the FIRST non-empty
//      stock record for the item (the most-common consume workflow). If the
//      item has no stocks yet and the caller passes a negative delta, the tool
//      returns an error rather than creating a stock with a negative count.
//   3. "delete item" is NOT included. inventoryItemsApi.delete is a soft-delete
//      (trash path) and the API supports it cleanly, but deleting an inventory
//      item that may have stock records associated is a larger scope decision
//      the user should make from the UI, not via the chatbot. It can be added
//      later as isDestructive: true if Grant approves.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { inventoryItemsApi, inventoryStocksApi } from "@/lib/local-api";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import type {
  InventoryItem,
  InventoryStock,
  InventoryCategory,
} from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable deps seam
// ---------------------------------------------------------------------------

export type InventoryToolsDeps = {
  /** List all of the current user's own inventory items. */
  listItems: () => Promise<InventoryItem[]>;
  /** Create a new inventory item in the current user's namespace. */
  createItem: (data: {
    name: string;
    category?: InventoryCategory;
    vendor?: string | null;
    catalog_number?: string | null;
    cas?: string | null;
    low_at_count?: number | null;
    container_label?: string | null;
    notes?: string | null;
  }) => Promise<InventoryItem>;
  /** List all stocks for a given item id (own namespace). */
  listStocksForItem: (itemId: number) => Promise<InventoryStock[]>;
  /** Create a new stock record (restocking). */
  createStock: (data: {
    item_id: number;
    container_count: number;
    lot_number?: string | null;
    expiration_date?: string | null;
    location_text?: string | null;
    notes?: string | null;
  }) => Promise<InventoryStock>;
  /** Update an existing stock's container count (consuming or correcting). */
  updateStock: (
    id: number,
    data: { container_count: number },
  ) => Promise<InventoryStock | null>;
  /** Navigate to a path after a successful write. */
  navigate: (path: string) => void;
};

export const inventoryToolsDeps: InventoryToolsDeps = {
  listItems: () => inventoryItemsApi.list(),
  createItem: (data) => inventoryItemsApi.create(data),
  listStocksForItem: (itemId) => inventoryStocksApi.listForItem(itemId),
  createStock: (data) => inventoryStocksApi.create(data),
  updateStock: (id, data) => inventoryStocksApi.update(id, data),
  navigate: requestNavigation,
};

// ---------------------------------------------------------------------------
// Name-resolution helper (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Find inventory items whose name matches `query` (case-insensitive, trimmed).
 * Returns all matches so the caller can surface ambiguity to the model.
 */
export function resolveItemsByName(
  items: InventoryItem[],
  query: string,
): InventoryItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return items.filter((item) => item.name.trim().toLowerCase() === q);
}

// ---------------------------------------------------------------------------
// add_inventory_item
// ---------------------------------------------------------------------------

export const addInventoryItemTool: AiTool = {
  name: "add_inventory_item",
  description:
    "Create a new inventory item (a catalog record for a reagent, antibody, enzyme, kit, or other lab supply). " +
    "Use this when the user asks to add a new item to their inventory, for example \"add Q5 polymerase to inventory\" or \"create an antibody entry for anti-GAPDH\". " +
    "The app shows the user a preview of the item name, category, and key fields BEFORE anything is written, so they confirm before it saves. " +
    "After it writes, confirm in one short sentence what was created. " +
    "This creates the CATALOG record only (the item descriptor). To record physical containers, use adjust_inventory_stock after the item exists. " +
    "Do NOT call this if the item already exists; resolve the existing one with summarize_inventory or search_my_work instead.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The item name, for example \"Q5 High-Fidelity DNA Polymerase\" or \"anti-GAPDH antibody\".",
      },
      category: {
        type: "string",
        description:
          "The item category. One of: reagent (default), antibody, plasmid, enzyme, primer, cell_line, strain, kit, equipment, other. Default is reagent when not specified.",
      },
      vendor: {
        type: "string",
        description: "Optional. The supplier name, for example \"NEB\" or \"Sigma-Aldrich\".",
      },
      catalogNumber: {
        type: "string",
        description: "Optional. The vendor catalog number, for example \"M0491L\".",
      },
      cas: {
        type: "string",
        description: "Optional. The CAS number for chemicals, for example \"7647-14-9\".",
      },
      lowAtCount: {
        type: "number",
        description:
          "Optional. The reorder threshold as a container count. When the total containers for this item drops to or below this number, the item is flagged low. Omit to leave no threshold.",
      },
      containerLabel: {
        type: "string",
        description:
          "Optional. The display word for one container unit, for example \"vial\", \"tube\", \"bottle\", \"plate\", or \"box\". Defaults to \"container\" when omitted.",
      },
      notes: {
        type: "string",
        description: "Optional. A short free-text note to save with the item.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const name = String(args.name ?? "Untitled item");
    const category = typeof args.category === "string" ? args.category : "reagent";
    const vendor = typeof args.vendor === "string" && args.vendor.trim()
      ? ` from ${args.vendor.trim()}`
      : "";
    const catalog = typeof args.catalogNumber === "string" && args.catalogNumber.trim()
      ? ` (${args.catalogNumber.trim()})`
      : "";
    const threshold = typeof args.lowAtCount === "number"
      ? `; reorder threshold ${args.lowAtCount} containers`
      : "";
    return {
      summary: `add inventory item "${name}" (${category})${vendor}${catalog}${threshold}`,
    };
  },
  execute: async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) {
      return { ok: false as const, error: "Item name is required." };
    }

    const VALID_CATEGORIES: InventoryCategory[] = [
      "reagent", "antibody", "plasmid", "enzyme", "primer",
      "cell_line", "strain", "kit", "equipment", "other",
    ];
    const rawCategory = typeof args.category === "string" ? args.category.trim() : "";
    const category: InventoryCategory =
      VALID_CATEGORIES.includes(rawCategory as InventoryCategory)
        ? (rawCategory as InventoryCategory)
        : "reagent";

    const vendor = typeof args.vendor === "string" && args.vendor.trim()
      ? args.vendor.trim()
      : null;
    const catalogNumber = typeof args.catalogNumber === "string" && args.catalogNumber.trim()
      ? args.catalogNumber.trim()
      : null;
    const cas = typeof args.cas === "string" && args.cas.trim()
      ? args.cas.trim()
      : null;
    const lowAtCount = typeof args.lowAtCount === "number" && args.lowAtCount >= 0
      ? Math.round(args.lowAtCount)
      : null;
    const containerLabel = typeof args.containerLabel === "string" && args.containerLabel.trim()
      ? args.containerLabel.trim()
      : null;
    const notes = typeof args.notes === "string" && args.notes.trim()
      ? args.notes.trim()
      : null;

    let item: InventoryItem;
    try {
      item = await inventoryToolsDeps.createItem({
        name,
        category,
        vendor,
        catalog_number: catalogNumber,
        cas,
        low_at_count: lowAtCount,
        container_label: containerLabel,
        notes,
      });
    } catch (err) {
      return {
        ok: false as const,
        error: `Could not create the inventory item. ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    inventoryToolsDeps.navigate("/inventory");

    return {
      ok: true as const,
      id: item.id,
      name: item.name,
      category: item.category,
      vendor: item.vendor,
      catalogNumber: item.catalog_number,
      lowAtCount: item.low_at_count,
    };
  },
};

// ---------------------------------------------------------------------------
// adjust_inventory_stock
// ---------------------------------------------------------------------------

/**
 * Apply a delta or an absolute count to an item's stock.
 *
 * A positive delta creates a NEW stock record (a new restocked lot arrives).
 * A negative delta or an absolute count targets the FIRST non-empty existing
 * stock, updating its container_count. If no stocks exist and the delta is
 * negative, the tool returns an error.
 *
 * Exported so the test can call this logic directly without the tool wrapper.
 */
export async function applyStockAdjustment(
  item: InventoryItem,
  {
    delta,
    absoluteCount,
    lotNumber,
    expirationDate,
    locationText,
    notes,
  }: {
    delta?: number;
    absoluteCount?: number;
    lotNumber?: string | null;
    expirationDate?: string | null;
    locationText?: string | null;
    notes?: string | null;
  },
  deps: InventoryToolsDeps,
): Promise<
  | {
      ok: true;
      action: "restocked" | "consumed" | "corrected";
      stockId: number;
      newContainerCount: number;
      itemName: string;
    }
  | { ok: false; error: string }
> {
  // If absoluteCount is given, treat it as the target count directly.
  // If delta is given, load existing stocks first to compute the new count.
  const isAbsolute = typeof absoluteCount === "number";
  const isDelta = typeof delta === "number";

  if (!isAbsolute && !isDelta) {
    return { ok: false, error: "Either delta or absoluteCount must be supplied." };
  }

  if (isAbsolute && absoluteCount! < 0) {
    return { ok: false, error: "absoluteCount cannot be negative." };
  }

  const existingStocks = await deps.listStocksForItem(item.id);

  // Restock path: positive delta creates a new stock record for the incoming lot.
  if (isDelta && delta! > 0) {
    const count = Math.round(delta!);
    let stock: InventoryStock;
    try {
      stock = await deps.createStock({
        item_id: item.id,
        container_count: count,
        lot_number: lotNumber ?? null,
        expiration_date: expirationDate ?? null,
        location_text: locationText ?? null,
        notes: notes ?? null,
      });
    } catch (err) {
      return {
        ok: false,
        error: `Could not create the stock record. ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return {
      ok: true,
      action: "restocked",
      stockId: stock.id,
      newContainerCount: stock.container_count,
      itemName: item.name,
    };
  }

  // Consume or correct path: find the first non-empty stock to update.
  const targetStock =
    existingStocks.find((s) => s.container_count > 0 && s.status !== "empty") ??
    existingStocks[0] ??
    null;

  if (!targetStock) {
    if (isDelta && delta! < 0) {
      return {
        ok: false,
        error: `"${item.name}" has no stock records to consume from. Use a positive delta to restock it first.`,
      };
    }
    // absoluteCount with no stocks: create a first stock at that count.
    let stock: InventoryStock;
    try {
      stock = await deps.createStock({
        item_id: item.id,
        container_count: Math.round(absoluteCount!),
        lot_number: lotNumber ?? null,
        expiration_date: expirationDate ?? null,
        location_text: locationText ?? null,
        notes: notes ?? null,
      });
    } catch (err) {
      return {
        ok: false,
        error: `Could not create the initial stock record. ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return {
      ok: true,
      action: "corrected",
      stockId: stock.id,
      newContainerCount: stock.container_count,
      itemName: item.name,
    };
  }

  const newCount = isAbsolute
    ? Math.round(absoluteCount!)
    : Math.max(0, targetStock.container_count + Math.round(delta!));

  let updated: InventoryStock | null;
  try {
    updated = await deps.updateStock(targetStock.id, { container_count: newCount });
  } catch (err) {
    return {
      ok: false,
      error: `Could not update the stock record. ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!updated) {
    return {
      ok: false,
      error: `Stock record ${targetStock.id} disappeared during the update.`,
    };
  }

  const action = isAbsolute ? "corrected" : "consumed";
  return {
    ok: true,
    action,
    stockId: updated.id,
    newContainerCount: updated.container_count,
    itemName: item.name,
  };
}

export const adjustInventoryStockTool: AiTool = {
  name: "adjust_inventory_stock",
  description:
    "Consume or restock a quantity of an existing inventory item. " +
    "Use this when the user reports using up a reagent, receiving a new shipment, or correcting a container count. " +
    "Examples: \"we used 2 vials of Q5\", \"5 new bottles of ethanol arrived\", \"set the anti-GAPDH count to 3\". " +
    "The tool resolves the item by NAME from the user's inventory; if multiple items share that name it returns them all so you can ask which one. " +
    "Never guess an item id; always resolve by name. " +
    "A positive delta creates a NEW stock lot record (restock). A negative delta or an explicit absoluteCount updates the existing stock. " +
    "The app shows the user a preview of the item, the change, and the resulting count BEFORE anything is written. " +
    "After it writes, confirm in one short sentence what changed.",
  parameters: {
    type: "object",
    properties: {
      itemName: {
        type: "string",
        description:
          "The name of the inventory item to adjust, for example \"Q5 High-Fidelity DNA Polymerase\". The tool resolves by exact name (case-insensitive).",
      },
      delta: {
        type: "number",
        description:
          "The change in container count. Positive = restock (creates a new stock lot). Negative = consume (deducts from the existing stock). Supply either delta or absoluteCount, not both.",
      },
      absoluteCount: {
        type: "number",
        description:
          "Set the container count to exactly this number (a correction, not a delta). Non-negative. Supply either absoluteCount or delta, not both.",
      },
      lotNumber: {
        type: "string",
        description: "Optional. Lot or batch number for a restock (positive delta).",
      },
      expirationDate: {
        type: "string",
        description: "Optional. Expiration date for a restock, as a YYYY-MM-DD ISO string.",
      },
      locationText: {
        type: "string",
        description: "Optional. Free-text storage location for a restock, for example \"-80 door, left\".",
      },
      notes: {
        type: "string",
        description: "Optional. A short note to save with the stock record.",
      },
    },
    required: ["itemName"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const itemName = String(args.itemName ?? "?");
    const delta = typeof args.delta === "number" ? args.delta : null;
    const absoluteCount = typeof args.absoluteCount === "number" ? args.absoluteCount : null;
    const lot = typeof args.lotNumber === "string" && args.lotNumber.trim()
      ? ` lot "${args.lotNumber.trim()}"`
      : "";

    let changeDesc: string;
    if (absoluteCount !== null) {
      changeDesc = `set container count to ${absoluteCount}`;
    } else if (delta !== null && delta > 0) {
      changeDesc = `restock +${delta} container${delta === 1 ? "" : "s"}${lot}`;
    } else if (delta !== null && delta < 0) {
      changeDesc = `consume ${Math.abs(delta)} container${Math.abs(delta) === 1 ? "" : "s"}`;
    } else if (delta === 0) {
      changeDesc = "no change (delta is 0)";
    } else {
      changeDesc = "adjust stock (no delta or count supplied)";
    }

    return {
      summary: `adjust inventory stock for "${itemName}": ${changeDesc}`,
    };
  },
  execute: async (args) => {
    const itemName = String(args.itemName ?? "").trim();
    if (!itemName) {
      return { ok: false as const, error: "itemName is required." };
    }

    const hasDelta = typeof args.delta === "number";
    const hasAbsolute = typeof args.absoluteCount === "number";

    if (!hasDelta && !hasAbsolute) {
      return {
        ok: false as const,
        error: "Supply either delta (positive to restock, negative to consume) or absoluteCount (set the exact count).",
      };
    }
    if (hasDelta && hasAbsolute) {
      return {
        ok: false as const,
        error: "Supply either delta or absoluteCount, not both.",
      };
    }
    if (hasAbsolute && (args.absoluteCount as number) < 0) {
      return { ok: false as const, error: "absoluteCount cannot be negative." };
    }

    const lotNumber = typeof args.lotNumber === "string" && args.lotNumber.trim()
      ? args.lotNumber.trim()
      : null;
    const expirationDate = typeof args.expirationDate === "string" && args.expirationDate.trim()
      ? args.expirationDate.trim()
      : null;
    const locationText = typeof args.locationText === "string" && args.locationText.trim()
      ? args.locationText.trim()
      : null;
    const notes = typeof args.notes === "string" && args.notes.trim()
      ? args.notes.trim()
      : null;

    // Resolve item by name.
    let allItems: InventoryItem[];
    try {
      allItems = await inventoryToolsDeps.listItems();
    } catch (err) {
      return {
        ok: false as const,
        error: `Could not load inventory items. ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const matches = resolveItemsByName(allItems, itemName);

    if (matches.length === 0) {
      return {
        ok: false as const,
        error: `No inventory item named "${itemName}" was found. Check the name with summarize_inventory or search_my_work. Do not guess an id.`,
      };
    }

    if (matches.length > 1) {
      // Surface the ambiguity so the model can ask the user which one.
      return {
        ok: false as const,
        error: `Multiple items match the name "${itemName}". Ask the user which one they mean.`,
        candidates: matches.map((m) => ({
          id: m.id,
          name: m.name,
          category: m.category,
          vendor: m.vendor,
        })),
      };
    }

    const item = matches[0];

    const result = await applyStockAdjustment(
      item,
      {
        delta: hasDelta ? (args.delta as number) : undefined,
        absoluteCount: hasAbsolute ? (args.absoluteCount as number) : undefined,
        lotNumber,
        expirationDate,
        locationText,
        notes,
      },
      inventoryToolsDeps,
    );

    if (!result.ok) {
      return { ok: false as const, error: result.error };
    }

    inventoryToolsDeps.navigate("/inventory");

    return {
      ok: true as const,
      action: result.action,
      itemId: item.id,
      itemName: result.itemName,
      stockId: result.stockId,
      newContainerCount: result.newContainerCount,
    };
  },
};
