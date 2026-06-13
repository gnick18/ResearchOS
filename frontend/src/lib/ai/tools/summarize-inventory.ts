// BeakerBot summarize_inventory tool (BeakerAI lane, 2026-06-12).
//
// Layer 2 of the summary suite (docs/proposals/beakerbot-summary-suite.md). A
// read-only tool that aggregates the user's INVENTORY (items + their physical
// stocks) and hands the model a compact, structured tally of what is low, what is
// expiring, and what was recently touched, so the model can write one grounded
// "state of the shelf" narrative.
//
// THE HARD RULE: the TOOL computes every count and every low / expiring / empty
// determination DETERMINISTICALLY in TypeScript against a fixed "today". The model
// NEVER counts an item, decides what is low, or invents a date. It only relays the
// aggregate this tool returns and never interprets it into a buying decision.
//
// REAL FIELDS (verified against types.ts, the brief's "what actually exists"):
//   InventoryItem.low_at_count  -> the COUNT-based reorder threshold (containers),
//                                  null = no auto low-stock flag.
//   InventoryItem.category      -> InventoryCategory enum, drives the by-category tally.
//   InventoryStock.container_count -> the primary quantity (count of containers).
//   InventoryStock.status       -> "in_stock" | "low" | "empty" | "expired".
//   InventoryStock.expiration_date -> ISO; drives "expiring soon".
//   InventoryStock.last_touched_at -> ISO; drives "recently touched / consumed".
// So a reorder threshold AND an expiry field BOTH genuinely exist, this tool uses
// them rather than inventing anything.
//
// Low-stock rule (matches the data model, design §2.3, count-based): an item is
// low when low_at_count is set and the summed container_count across its stocks is
// at or below low_at_count, OR when an item with NO threshold has zero containers
// (genuinely out). An item is reported as out when its total container_count is 0.
//
// Sources: fetchAllInventoryItemsIncludingShared + fetchAllInventoryStocksIncludingShared.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  fetchAllInventoryItemsIncludingShared,
  fetchAllInventoryStocksIncludingShared,
} from "@/lib/local-api";
import type { InventoryItem, InventoryStock } from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable deps seam. A test stubs both loaders with fixtures.
// ---------------------------------------------------------------------------

export type SummarizeInventoryDeps = {
  listItems: () => Promise<InventoryItem[]>;
  listStocks: () => Promise<InventoryStock[]>;
};

export const summarizeInventoryDeps: SummarizeInventoryDeps = {
  listItems: () => fetchAllInventoryItemsIncludingShared(),
  listStocks: () => fetchAllInventoryStocksIncludingShared(),
};

// ---------------------------------------------------------------------------
// Aggregate shape. The ENTIRE structured payload the model narrates from.
// ---------------------------------------------------------------------------

/** One flagged item (low, out, or expiring), deep-linked to /inventory. */
export type InventoryFlagItem = {
  id: string;
  name: string;
  category: string | null;
  owner: string | null;
  /** Summed container_count across this item's stocks. */
  totalContainers: number;
  /** The reorder threshold (low_at_count), or null when none is set. */
  reorderThreshold: number | null;
  /** The soonest expiration date among this item's stocks, YYYY-MM-DD, or null. */
  soonestExpiry: string | null;
  deepLink: string;
};

/** One recently-touched stock, for the movements list. */
export type InventoryMovementItem = {
  stockId: string;
  itemId: string;
  itemName: string;
  status: string;
  containerCount: number;
  lastTouchedAt: string | null;
  owner: string | null;
  deepLink: string;
};

export type InventorySummary = {
  /** Echoed scope so the user sees what was summarized. */
  filter: {
    owners: string[] | null;
    keywords: string | null;
    /** Days-ahead window used for "expiring soon". */
    expiringWithinDays: number;
    /** The "today" used to derive expiring / recent, YYYY-MM-DD. */
    asOf: string;
  };
  /** Total matched items (the tool's count). */
  itemCount: number;
  /** Total stocks (containers records) across matched items. */
  stockCount: number;
  /** Count of items per category, descending by count. */
  byCategory: Array<{ category: string; count: number }>;
  /** Items at or below their reorder threshold (or empty with no threshold). */
  low: InventoryFlagItem[];
  /** Items with zero total containers (genuinely out). */
  out: InventoryFlagItem[];
  /** Items with a stock expiring within `expiringWithinDays` (today inclusive). */
  expiringSoon: InventoryFlagItem[];
  /** Stocks already past expiration (status "expired" or expiry < today). */
  expired: InventoryFlagItem[];
  /** Most-recently-touched stocks (the "recently consumed / moved" signal). */
  recentMovements: InventoryMovementItem[];
  /** True when a flag list was capped. */
  truncated: boolean;
};

// ---------------------------------------------------------------------------
// Pure deterministic aggregation. Exported for direct unit testing.
// ---------------------------------------------------------------------------

const DEFAULT_FLAG_CAP = 25;
const DEFAULT_MOVEMENT_CAP = 15;
const DEFAULT_EXPIRING_DAYS = 30;

/** The YYYY-MM-DD day prefix of an ISO-ish string, or null. */
function dayOf(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

/** Add `days` to a YYYY-MM-DD day string (UTC math, timezone-stable). */
function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lowercase keyword tokens that appear in an item's searchable fields. */
function itemMatchesKeywords(item: InventoryItem, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = [item.name, item.vendor, item.category, item.catalog_number, item.cas]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(" ")
    .toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

/**
 * Compute the inventory summary from items, stocks, a filter, and a fixed today.
 * Pure and deterministic, so a test passes fixtures + a frozen today and asserts
 * the exact low / out / expiring sets.
 */
export function aggregateInventory(
  items: InventoryItem[],
  stocks: InventoryStock[],
  filter: { owners?: string[]; keywords?: string },
  today: string,
  opts?: { expiringWithinDays?: number; flagCap?: number; movementCap?: number },
): InventorySummary {
  const expiringWithinDays = opts?.expiringWithinDays ?? DEFAULT_EXPIRING_DAYS;
  const flagCap = opts?.flagCap ?? DEFAULT_FLAG_CAP;
  const movementCap = opts?.movementCap ?? DEFAULT_MOVEMENT_CAP;

  const ownerSet =
    filter.owners && filter.owners.length > 0 ? new Set(filter.owners) : null;
  const keywordTokens = (filter.keywords ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  const expiryHorizon = addDays(today, expiringWithinDays);

  // Match items by owner + keywords first.
  const matchedItems = items.filter((item) => {
    if (ownerSet && (!item.owner || !ownerSet.has(item.owner))) return false;
    if (!itemMatchesKeywords(item, keywordTokens)) return false;
    return true;
  });
  const matchedItemIds = new Set(matchedItems.map((i) => i.id));

  // Group the matched items' stocks by item id (own + shared union, ACL upstream).
  const stocksByItem = new Map<number, InventoryStock[]>();
  let stockCount = 0;
  for (const stock of stocks) {
    if (!matchedItemIds.has(stock.item_id)) continue;
    stockCount += 1;
    const bucket = stocksByItem.get(stock.item_id);
    if (bucket) bucket.push(stock);
    else stocksByItem.set(stock.item_id, [stock]);
  }

  const categoryCounts = new Map<string, number>();
  const low: InventoryFlagItem[] = [];
  const out: InventoryFlagItem[] = [];
  const expiringSoon: InventoryFlagItem[] = [];
  const expired: InventoryFlagItem[] = [];

  for (const item of matchedItems) {
    const cat = item.category || "uncategorized";
    categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);

    const itemStocks = stocksByItem.get(item.id) ?? [];
    const totalContainers = itemStocks.reduce(
      (sum, s) => sum + (typeof s.container_count === "number" ? s.container_count : 0),
      0,
    );

    // Soonest expiry across this item's stocks.
    let soonestExpiry: string | null = null;
    let hasExpiredStock = false;
    let hasExpiringSoon = false;
    for (const s of itemStocks) {
      const exp = dayOf(s.expiration_date);
      if (exp !== null) {
        if (soonestExpiry === null || exp < soonestExpiry) soonestExpiry = exp;
        if (exp < today) hasExpiredStock = true;
        else if (exp <= expiryHorizon) hasExpiringSoon = true;
      }
      if (s.status === "expired") hasExpiredStock = true;
    }

    const flag: InventoryFlagItem = {
      id: String(item.id),
      name: item.name || "Untitled item",
      category: item.category || null,
      owner: item.owner || null,
      totalContainers,
      reorderThreshold: typeof item.low_at_count === "number" ? item.low_at_count : null,
      soonestExpiry,
      deepLink: "/inventory",
    };

    // Out: zero containers.
    if (totalContainers <= 0) {
      out.push(flag);
    }
    // Low: a threshold is set and total is at or below it (but not already out),
    // OR any stock is explicitly flagged "low" / "empty".
    const thresholdLow =
      flag.reorderThreshold !== null && totalContainers <= flag.reorderThreshold;
    const taggedLow = itemStocks.some((s) => s.status === "low" || s.status === "empty");
    if (totalContainers > 0 && (thresholdLow || taggedLow)) {
      low.push(flag);
    }

    if (hasExpiredStock) expired.push(flag);
    else if (hasExpiringSoon) expiringSoon.push(flag);
  }

  // Recent movements: stocks of matched items, most-recently-touched first.
  const itemNameById = new Map(matchedItems.map((i) => [i.id, i.name || "Untitled item"]));
  const recentMovements: InventoryMovementItem[] = [...stocks]
    .filter((s) => matchedItemIds.has(s.item_id) && dayOf(s.last_touched_at) !== null)
    .sort((a, b) => (dayOf(b.last_touched_at) ?? "").localeCompare(dayOf(a.last_touched_at) ?? ""))
    .slice(0, movementCap)
    .map((s) => ({
      stockId: String(s.id),
      itemId: String(s.item_id),
      itemName: itemNameById.get(s.item_id) ?? "Untitled item",
      status: s.status,
      containerCount: typeof s.container_count === "number" ? s.container_count : 0,
      lastTouchedAt: dayOf(s.last_touched_at),
      owner: s.owner || null,
      deepLink: "/inventory",
    }));

  const byCategory = Array.from(categoryCounts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  const truncated =
    low.length > flagCap ||
    out.length > flagCap ||
    expiringSoon.length > flagCap ||
    expired.length > flagCap;

  return {
    filter: {
      owners: filter.owners && filter.owners.length > 0 ? filter.owners : null,
      keywords: filter.keywords?.trim() || null,
      expiringWithinDays,
      asOf: today,
    },
    itemCount: matchedItems.length,
    stockCount,
    byCategory,
    low: low.slice(0, flagCap),
    out: out.slice(0, flagCap),
    expiringSoon: expiringSoon.slice(0, flagCap),
    expired: expired.slice(0, flagCap),
    recentMovements,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Argument parsing + runtime today.
// ---------------------------------------------------------------------------

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export const summarizeInventoryTool: AiTool = {
  name: "summarize_inventory",
  description:
    "Aggregate the user's inventory (items and their physical stocks) and return a deterministic summary of the shelf, the item count, the stock count, a by-category tally, what is LOW (at or below its reorder threshold, or flagged low / empty), what is OUT (zero containers), what is EXPIRING SOON, what is already EXPIRED, and the most recently touched stocks. " +
    "Call this when the user asks about supplies, for example \"what is low\", \"summarize my inventory\", \"what is expiring soon\", \"what do I need to reorder\". " +
    "Read-only, it changes nothing and runs straight away with no approval step. " +
    "THE TOOL owns every count and every low / out / expiring determination; you NEVER decide what is low, count an item, or invent a date yourself. You relay the lists it returns and never interpret them into a purchasing decision. " +
    "Pass owners (usernames) to scope to members; the whole lab is the default (own plus everything shared with the user, never a member's private inventory). Pass keywords for a free-text match on the item name, vendor, category, catalog number, or CAS. Pass expiringWithinDays to widen or narrow the expiring-soon window (default 30). " +
    "Returns { ok, summary } where summary echoes the scope and carries itemCount, stockCount, byCategory, low, out, expiringSoon, expired, and recentMovements. If nothing matches, itemCount is 0, say so plainly.",
  parameters: {
    type: "object",
    properties: {
      owners: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional. Usernames of the lab members to scope to. Omit for the whole lab (own plus everything shared with the current user). Never reaches a member's private inventory, only what is shared.",
      },
      keywords: {
        type: "string",
        description:
          "Optional free-text match on the item name, vendor, category, catalog number, or CAS, for example \"Q5\" or \"antibody\".",
      },
      expiringWithinDays: {
        type: "number",
        description:
          "Optional. How many days ahead counts as expiring soon. Default 30. A stock whose expiration date is on or before today + this many days is flagged.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  execute: async (args) => {
    const owners = Array.isArray(args.owners)
      ? args.owners.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : undefined;
    const keywords = typeof args.keywords === "string" && args.keywords.trim()
      ? args.keywords.trim()
      : undefined;
    const expiringWithinDays =
      typeof args.expiringWithinDays === "number" && args.expiringWithinDays > 0
        ? Math.round(args.expiringWithinDays)
        : undefined;
    const [items, stocks] = await Promise.all([
      summarizeInventoryDeps.listItems(),
      summarizeInventoryDeps.listStocks(),
    ]);
    const summary = aggregateInventory(
      items,
      stocks,
      { owners, keywords },
      todayString(),
      expiringWithinDays ? { expiringWithinDays } : undefined,
    );
    return { ok: true as const, summary };
  },
};
