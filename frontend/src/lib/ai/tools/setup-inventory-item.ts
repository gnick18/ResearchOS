// BeakerBot setup_inventory_item composite tool (BeakerAI lane, 2026-06-16).
//
// The inventory analog of setup_experiment / setup_project. A single gated write
// that stands up a new inventory item AND its initial physical stocks in one
// consent, with every stock auto-assigned to the item it just made.
//
//   setup_inventory_item(name, category?, vendor?, catalogNumber?, lowAtCount?,
//                        tags?, stocks?)
//
// In one atomic, consented call it:
//   1. Creates the InventoryItem (name + optional vendor / catalog / category /
//      reorder threshold / tags).
//   2. Creates each named stock as an InventoryStock with the NEW item's id set on
//      every one. This back-reference (stocks pointing at an item that did not
//      exist before the call) is the thing the model cannot reliably do by chaining
//      separate create calls, because it cannot thread a just-created id into the
//      next argument list.
//   3. Navigates to /inventory so the user sees what they just created.
//
// The user consents ONCE. describeAction produces a numbered preview of every step
// before anything writes, matching the one-preview-per-composite-action principle
// used by setup_experiment / setup_project.
//
// computeInventorySetupPlan is a pure function (no I/O) producing the full item +
// stock set to create from the arguments, so it is unit-testable independently.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { inventoryItemsApi, inventoryStocksApi } from "@/lib/local-api";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import { parseTags } from "./method-tools";
import type {
  InventoryItem,
  InventoryStock,
  InventoryItemCreate,
  InventoryStockCreate,
  InventoryCategory,
} from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable seam
// ---------------------------------------------------------------------------

export type SetupInventoryItemDeps = {
  createItem: (data: InventoryItemCreate) => Promise<InventoryItem>;
  createStock: (data: InventoryStockCreate) => Promise<InventoryStock>;
  navigate: (path: string) => void;
};

export const setupInventoryItemDeps: SetupInventoryItemDeps = {
  createItem: (data) => inventoryItemsApi.create(data),
  createStock: (data) => inventoryStocksApi.create(data),
  navigate: requestNavigation,
};

// ---------------------------------------------------------------------------
// Pure compute core (exported for tests)
// ---------------------------------------------------------------------------

/** One stock to create under the new item. itemId is filled in at execute time. */
export interface StockSpec {
  containerCount: number;
  lotNumber: string | null;
  expirationDate: string | null;
  locationText: string | null;
  amountPerContainer: number | null;
  unit: string | null;
}

/** The fully-resolved plan for what setup_inventory_item will create. Pure. */
export interface InventorySetupPlan {
  item: {
    name: string;
    category: InventoryCategory | null;
    vendor: string | null;
    catalogNumber: string | null;
    lowAtCount: number | null;
    tags: string[];
  };
  stocks: StockSpec[];
}

const VALID_CATEGORIES = new Set<InventoryCategory>([
  "reagent",
  "antibody",
  "plasmid",
  "enzyme",
  "primer",
  "cell_line",
  "strain",
  "kit",
  "equipment",
  "other",
]);

/** Compute the full inventory setup plan from raw arguments. Pure, no I/O. */
export function computeInventorySetupPlan(
  name: string,
  category: InventoryCategory | null,
  vendor: string | null,
  catalogNumber: string | null,
  lowAtCount: number | null,
  tags: string[],
  stocks: StockSpec[],
): InventorySetupPlan {
  return {
    item: { name, category, vendor, catalogNumber, lowAtCount, tags },
    stocks,
  };
}

// ---------------------------------------------------------------------------
// Argument parsing (shared by describeAction + execute, pure)
// ---------------------------------------------------------------------------

interface ParsedArgs {
  name: string;
  category: InventoryCategory | null;
  vendor: string | null;
  catalogNumber: string | null;
  lowAtCount: number | null;
  tags: string[];
  stocks: StockSpec[];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseArgs(args: Record<string, unknown>): ParsedArgs {
  const name = String(args.name ?? "").trim();
  const rawCat = str(args.category)?.toLowerCase() ?? null;
  const category =
    rawCat && VALID_CATEGORIES.has(rawCat as InventoryCategory)
      ? (rawCat as InventoryCategory)
      : null;
  const lowRaw = num(args.lowAtCount);
  const lowAtCount = lowRaw != null && lowRaw >= 0 ? Math.round(lowRaw) : null;

  const rawStocks = Array.isArray(args.stocks) ? args.stocks : [];
  const stocks: StockSpec[] = [];
  for (const raw of rawStocks) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    const cc = num(s.containerCount);
    stocks.push({
      containerCount: cc != null && cc >= 0 ? Math.round(cc) : 1,
      lotNumber: str(s.lotNumber),
      expirationDate: str(s.expirationDate),
      locationText: str(s.locationText),
      amountPerContainer: num(s.amountPerContainer),
      unit: str(s.unit),
    });
  }

  return {
    name,
    category,
    vendor: str(args.vendor),
    catalogNumber: str(args.catalogNumber),
    lowAtCount,
    tags: parseTags(args.tags),
    stocks,
  };
}

// ---------------------------------------------------------------------------
// setup_inventory_item result type
// ---------------------------------------------------------------------------

export type SetupInventoryItemResult =
  | {
      ok: true;
      itemId: number;
      itemName: string;
      stockIds: number[];
      totalContainers: number;
      note?: string;
    }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// setup_inventory_item tool
// ---------------------------------------------------------------------------

const activeDeps: SetupInventoryItemDeps = { ...setupInventoryItemDeps };

/** Override the deps for testing. Returns a cleanup function. */
export function overrideSetupInventoryItemDeps(
  overrides: Partial<SetupInventoryItemDeps>,
): () => void {
  const original = { ...activeDeps };
  Object.assign(activeDeps, overrides);
  return () => {
    Object.assign(activeDeps, original);
  };
}

export const setupInventoryItemTool: AiTool = {
  name: "setup_inventory_item",
  description:
    "Add a new inventory item AND its initial physical stock in one step. Use this when the user wants to add a supply to inventory with one or more containers on the shelf, for example \"add 3 boxes of Q5 polymerase from NEB to inventory\" or \"register a new antibody with two vials expiring next year\". In a single consented action it creates the item, then creates each stock ALREADY ASSIGNED to that new item (with its container count, lot, expiry, and location). Prefer this over creating the item and then the stocks separately, because this links every stock to the brand new item for you in one step. After it writes, confirm the addition in one short sentence.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The item name, for example \"Q5 High-Fidelity Polymerase\".",
      },
      category: {
        type: "string",
        description:
          "Optional category, one of reagent, antibody, plasmid, enzyme, primer, cell_line, strain, kit, equipment, other. Omit to use the default (reagent).",
      },
      vendor: { type: "string", description: "Optional vendor, for example \"NEB\"." },
      catalogNumber: { type: "string", description: "Optional vendor catalog number." },
      lowAtCount: {
        type: "number",
        description:
          "Optional reorder threshold. When the total container count is at or below this number the item is flagged low. Omit for no auto low-stock flag.",
      },
      tags: {
        type: "string",
        description: "Optional comma-separated tags, for example \"pcr, enzyme\".",
      },
      stocks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            containerCount: {
              type: "number",
              description: "How many containers in this stock entry. Defaults to 1.",
            },
            lotNumber: { type: "string", description: "Optional lot number." },
            expirationDate: {
              type: "string",
              description: "Optional expiration date as a YYYY-MM-DD ISO string.",
            },
            locationText: {
              type: "string",
              description: "Optional free-text location, for example \"-20C freezer, shelf 2\".",
            },
            amountPerContainer: {
              type: "number",
              description: "Optional amount in each container (paired with unit).",
            },
            unit: { type: "string", description: "Optional unit for the amount, for example \"uL\"." },
          },
          required: [],
          additionalProperties: false,
        },
        description:
          "The physical stocks to create under the new item. Each becomes a stock record linked to the item. Omit to create the item with no stock yet.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const p = parseArgs(args);
    const safeName = p.name || "Untitled item";
    const meta: string[] = [];
    if (p.category) meta.push(p.category);
    if (p.vendor) meta.push(p.vendor);
    if (p.lowAtCount != null) meta.push(`low at ${p.lowAtCount}`);
    const metaNote = meta.length ? ` (${meta.join(", ")})` : "";

    const lines: string[] = [`1. Create inventory item "${safeName}"${metaNote}`];
    p.stocks.forEach((s, i) => {
      const bits: string[] = [
        `${s.containerCount} container${s.containerCount === 1 ? "" : "s"}`,
      ];
      if (s.amountPerContainer != null) {
        bits.push(`${s.amountPerContainer}${s.unit ? ` ${s.unit}` : ""} each`);
      }
      if (s.lotNumber) bits.push(`lot ${s.lotNumber}`);
      if (s.expirationDate) bits.push(`exp ${s.expirationDate}`);
      if (s.locationText) bits.push(`at ${s.locationText}`);
      lines.push(`${i + 2}. Add stock: ${bits.join(", ")}`);
    });

    const summary = [`add inventory item "${safeName}"`, ...lines].join("\n");
    return { summary };
  },
  execute: async (args): Promise<SetupInventoryItemResult> => {
    const deps = activeDeps;
    const p = parseArgs(args);

    if (!p.name) {
      return { ok: false, error: "Item name is required." };
    }

    const plan = computeInventorySetupPlan(
      p.name,
      p.category,
      p.vendor,
      p.catalogNumber,
      p.lowAtCount,
      p.tags,
      p.stocks,
    );

    // Step 1: create the item.
    let item: InventoryItem;
    try {
      item = await deps.createItem({
        name: plan.item.name,
        ...(plan.item.category ? { category: plan.item.category } : {}),
        ...(plan.item.vendor ? { vendor: plan.item.vendor } : {}),
        ...(plan.item.catalogNumber ? { catalog_number: plan.item.catalogNumber } : {}),
        ...(plan.item.lowAtCount != null ? { low_at_count: plan.item.lowAtCount } : {}),
        ...(plan.item.tags.length ? { tags: plan.item.tags } : {}),
      });
    } catch (err) {
      return {
        ok: false,
        error: `Could not create the inventory item. ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Step 2: create each stock, assigned to the new item (the back-reference).
    const stockIds: number[] = [];
    let totalContainers = 0;
    let stockFailNote: string | undefined;
    for (let i = 0; i < plan.stocks.length; i++) {
      const s = plan.stocks[i];
      try {
        const stock = await deps.createStock({
          item_id: item.id,
          container_count: s.containerCount,
          ...(s.lotNumber ? { lot_number: s.lotNumber } : {}),
          ...(s.expirationDate ? { expiration_date: s.expirationDate } : {}),
          ...(s.locationText ? { location_text: s.locationText } : {}),
          ...(s.amountPerContainer != null ? { amount_per_container: s.amountPerContainer } : {}),
          ...(s.unit ? { unit: s.unit } : {}),
        });
        stockIds.push(stock.id);
        totalContainers += s.containerCount;
      } catch (err) {
        stockFailNote = `Stock ${i + 1} could not be created (${err instanceof Error ? err.message : String(err)}). The item and ${stockIds.length} earlier stock${stockIds.length === 1 ? " was" : "s were"} created.`;
        break;
      }
    }

    deps.navigate("/inventory");

    return {
      ok: true,
      itemId: item.id,
      itemName: item.name,
      stockIds,
      totalContainers,
      ...(stockFailNote ? { note: stockFailNote } : {}),
    };
  },
};
