// BeakerBot summarize_purchases tool (BeakerAI lane, 2026-06-12).
//
// Layer 2 of the summary suite (docs/proposals/beakerbot-summary-suite.md). The
// cleanest deterministic-total case, and the one where the safety rule matters
// most: the model must NEVER add money. This tool computes the total spend, the
// per-vendor and per-category and per-month spend, the largest line items, and
// the pending vs received split, all in TypeScript. The model only relays the
// numbers it returns and never sums, rounds, or invents a dollar figure.
//
// Read-only, runs immediately like search_my_work, it changes nothing. The
// result echoes the exact filter applied, the deterministic aggregates, and a
// CAPPED list of the largest matched items (with ids + deep links), flagged when
// truncated, plus a clean "no matching records" path.
//
// This is BeakerBot's global no-interpretation scope: a purchase summary reports
// STRUCTURE (counts, totals, vendors, dates, status), never a judgment about the
// spending.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  purchaseToBrief,
  filterArtifacts,
  type ArtifactBrief,
  type ArtifactFilter,
} from "@/lib/ai/artifact-index";
import { purchasesApi } from "@/lib/local-api";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import type { PurchaseItem } from "@/lib/types";
import type { AiTool } from "./types";

// A purchase decorated with the owning member, the shape
// purchasesApi.listAllIncludingShared returns.
type OwnedPurchase = PurchaseItem & { owner: string };

// ---------------------------------------------------------------------------
// Injectable deps seam. A test stubs listPurchases with fixture items and
// never touches a real folder.
// ---------------------------------------------------------------------------

export type SummarizePurchasesDeps = {
  /** Load every purchase the current user may see (own + shared-in), each
   *  decorated with its owner. ACL-enforced upstream by listAllIncludingShared. */
  listPurchases: () => Promise<OwnedPurchase[]>;
};

export const summarizePurchasesDeps: SummarizePurchasesDeps = {
  listPurchases: async () => {
    const currentUser = (await getCurrentUserCached()) ?? "";
    return purchasesApi.listAllIncludingShared(currentUser);
  },
};

// ---------------------------------------------------------------------------
// Aggregate shape. The ENTIRE payload the model narrates from. Every money
// figure here is the tool's arithmetic, never the model's.
// ---------------------------------------------------------------------------

/** One matched purchase, for the largest-items list. Deep-linked to /purchases. */
export type PurchaseSummaryItem = {
  id: string;
  name: string;
  vendor: string | null;
  category: string | null;
  quantity: number;
  totalPrice: number;
  /** Pre-formatted total price string, e.g. "$315.00". Echo this verbatim when
   *  narrating the item price. Never re-type the number yourself. */
  totalPriceDisplay: string;
  orderStatus: "needs_ordering" | "ordered" | "received";
  owner: string | null;
  deepLink: string;
};

/** A spend tally bucket (a vendor, a category, or a month). */
export type SpendBucket = {
  key: string;
  count: number;
  spend: number;
  /** Pre-formatted spend string, e.g. "$1,234.56". Echo this verbatim when
   *  narrating the bucket spend. Never re-type the number yourself. */
  spendDisplay: string;
};

export type PurchaseSummary = {
  /** The exact filter applied, echoed so the user sees the scope. */
  filter: ArtifactFilter;
  /** Total matched line items (the tool's count). */
  count: number;
  /** Total spend across all matched items (the tool's sum, never the model's). */
  totalSpend: number;
  /** Pre-formatted total spend string, e.g. "$6,966.00". ALWAYS echo this
   *  string verbatim when stating the total. Never re-type, re-sum, round, or
   *  recompute the figure. If this field is present, use it. */
  totalSpendDisplay: string;
  /** Spend + count per vendor, descending by spend. "Unknown vendor" collects
   *  items with no vendor. Each bucket carries a spendDisplay field; echo it
   *  verbatim, never re-type the spend. */
  byVendor: SpendBucket[];
  /** Spend + count per category, descending by spend. "Uncategorized" collects
   *  items with no category. Each bucket carries spendDisplay. */
  byCategory: SpendBucket[];
  /** Spend + count per calendar month (YYYY-MM by the item's last_edited_at),
   *  ascending by month. "undated" collects items with no usable date. Each
   *  bucket carries spendDisplay. */
  byMonth: SpendBucket[];
  /** Count of items by ordering stage. */
  byStatus: {
    needs_ordering: number;
    ordered: number;
    received: number;
  };
  /** The pending vs received split as plain counts (pending = anything not yet
   *  received, that is needs_ordering plus ordered). */
  pendingVsReceived: { pending: number; received: number };
  /** Up to `cap` largest matched line items by total price. */
  largestItems: PurchaseSummaryItem[];
  /** True when more items matched than `largestItems` carries. */
  truncated: boolean;
};

// ---------------------------------------------------------------------------
// Pure deterministic aggregation. Exported for direct unit testing so a test
// asserts the TOTAL SPEND and the per-bucket spend the tool computes from a
// fixture, never the model.
// ---------------------------------------------------------------------------

const DEFAULT_ITEM_CAP = 10;

/** Shared US dollar formatter. Produces strings like "$1,234.56". Used for
 *  every pre-formatted *Display field so the model never has to reformat a
 *  number and cannot mangle it. */
const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** The YYYY-MM-DD day prefix of an ISO-ish string, or null. Kept local so the
 *  aggregator owns its date handling. */
function dayOf(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

/** Round to cents so accumulated floating-point error never leaks a fraction of
 *  a cent into a reported dollar total. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** The total price of one line item. Trusts the loader-normalized total_price
 *  (which the purchasesApi mappers already backfill from price_per_unit *
 *  quantity + shipping), falling back to the component math only if it is
 *  missing, so the tool never silently reports 0 for a real spend. */
function itemTotal(item: PurchaseItem): number {
  if (typeof item.total_price === "number" && !Number.isNaN(item.total_price)) {
    return item.total_price;
  }
  const per = typeof item.price_per_unit === "number" ? item.price_per_unit : 0;
  const ship = typeof item.shipping_fees === "number" ? item.shipping_fees : 0;
  const qty = typeof item.quantity === "number" ? item.quantity : 0;
  return per * qty + ship;
}

/** Normalize an order status to one of the three known stages. */
function statusOf(item: PurchaseItem): PurchaseSummaryItem["orderStatus"] {
  if (item.order_status === "ordered" || item.order_status === "received") {
    return item.order_status;
  }
  return "needs_ordering";
}

/**
 * Compute the purchase summary from a list of owned purchases and a filter.
 * Pure and deterministic, so a test passes a fixture and asserts the exact total
 * spend and per-bucket spend. The model never does this arithmetic.
 */
export function aggregatePurchases(
  purchases: OwnedPurchase[],
  filter: ArtifactFilter,
  cap: number = DEFAULT_ITEM_CAP,
): PurchaseSummary {
  // Convert to briefs (carrying owner) and keep a compound-key map
  // (owner + ":" + id) so purchases from different owners that share the same
  // numeric id never collide. Each brief carries a unique synthetic compound key
  // in its id field so filterArtifacts can route back to exactly one record.
  const byCompoundKey = new Map<string, OwnedPurchase>();
  const briefs: ArtifactBrief[] = [];
  for (const item of purchases) {
    const brief = purchaseToBrief(item);
    const compoundKey = `${item.owner ?? ""}:${item.id}`;
    // Override the brief id with the compound key so filterArtifacts routes
    // back to the right record even when two owners share a numeric id.
    const compoundBrief: ArtifactBrief = { ...brief, id: compoundKey };
    briefs.push(compoundBrief);
    byCompoundKey.set(compoundKey, item);
  }

  const matched = filterArtifacts(briefs, filter)
    .map((b) => byCompoundKey.get(b.id))
    .filter((x): x is OwnedPurchase => x !== undefined);

  let totalSpend = 0;
  const vendorMap = new Map<string, { count: number; spend: number }>();
  const categoryMap = new Map<string, { count: number; spend: number }>();
  const monthMap = new Map<string, { count: number; spend: number }>();
  const byStatus = { needs_ordering: 0, ordered: 0, received: 0 };

  const bump = (
    map: Map<string, { count: number; spend: number }>,
    key: string,
    spend: number,
  ): void => {
    const cur = map.get(key) ?? { count: 0, spend: 0 };
    cur.count += 1;
    cur.spend += spend;
    map.set(key, cur);
  };

  for (const item of matched) {
    const spend = itemTotal(item);
    totalSpend += spend;

    bump(vendorMap, item.vendor?.trim() || "Unknown vendor", spend);
    bump(categoryMap, item.category?.trim() || "Uncategorized", spend);

    const day = dayOf(item.last_edited_at);
    bump(monthMap, day ? day.slice(0, 7) : "undated", spend);

    byStatus[statusOf(item)] += 1;
  }

  const toBuckets = (
    map: Map<string, { count: number; spend: number }>,
    sort: "spend" | "key",
  ): SpendBucket[] => {
    const arr: SpendBucket[] = Array.from(map.entries()).map(([key, v]) => {
      const spend = round2(v.spend);
      return {
        key,
        count: v.count,
        spend,
        spendDisplay: USD_FORMATTER.format(spend),
      };
    });
    if (sort === "spend") {
      arr.sort((a, b) => b.spend - a.spend || a.key.localeCompare(b.key));
    } else {
      arr.sort((a, b) => a.key.localeCompare(b.key));
    }
    return arr;
  };

  const largestItems: PurchaseSummaryItem[] = [...matched]
    .sort((a, b) => itemTotal(b) - itemTotal(a))
    .slice(0, cap)
    .map((item) => {
      const price = round2(itemTotal(item));
      return {
        id: String(item.id),
        name: item.item_name || "Untitled purchase",
        vendor: item.vendor ?? null,
        category: item.category ?? null,
        quantity: item.quantity,
        totalPrice: price,
        totalPriceDisplay: USD_FORMATTER.format(price),
        orderStatus: statusOf(item),
        owner: item.owner || null,
        deepLink: "/purchases",
      };
    });

  const totalSpendRounded = round2(totalSpend);
  return {
    filter,
    count: matched.length,
    totalSpend: totalSpendRounded,
    totalSpendDisplay: USD_FORMATTER.format(totalSpendRounded),
    byVendor: toBuckets(vendorMap, "spend"),
    byCategory: toBuckets(categoryMap, "spend"),
    byMonth: toBuckets(monthMap, "key"),
    byStatus,
    pendingVsReceived: {
      pending: byStatus.needs_ordering + byStatus.ordered,
      received: byStatus.received,
    },
    largestItems,
    truncated: matched.length > largestItems.length,
  };
}

// ---------------------------------------------------------------------------
// Argument parsing. Absolute YYYY-MM-DD dates only; the model resolves relative
// phrasing via the date-context line.
// ---------------------------------------------------------------------------

function parseFilter(args: Record<string, unknown>): ArtifactFilter {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : undefined;
  return {
    types: ["purchase"],
    since: str(args.since),
    until: str(args.until),
    owners: strArr(args.owners),
    // Purchase briefs carry no projectIds, so a project filter would drop
    // everything; intentionally not exposed on this tool. status maps to the
    // order stage via the keyword path instead.
    keywords: str(args.keywords),
    status: str(args.status),
  };
}

export const summarizePurchasesTool: AiTool = {
  name: "summarize_purchases",
  description:
    "Aggregate the user's purchases across a filter and return a deterministic summary (count, total spend, spend by vendor, by category, by month, the largest line items, and the pending vs received split). " +
    "Call this when the user asks you to summarize, total, or review purchases over a scope, for example \"summarize my purchases this month\", \"how much did we spend on Sigma this quarter\", \"what is still pending\". " +
    "Read-only, it changes nothing and runs straight away with no approval step. " +
    "THE TOOL owns every count and every dollar total; you NEVER add money, sum a spend, round a price, or invent a total yourself. You only relay the figures it returns, exactly as given, and never interpret them. " +
    "VERBATIM ECHO RULE: every dollar amount has a pre-formatted *Display field (totalSpendDisplay on the summary, spendDisplay on each byVendor / byCategory / byMonth bucket, totalPriceDisplay on each largestItems entry). When you state any dollar figure, COPY that Display string CHARACTER FOR CHARACTER. Never re-type the number, never re-sum, never round, never reformat. If a Display field exists, that string is what you say. " +
    "Pass absolute YYYY-MM-DD dates for since / until; resolve relative phrasing yourself using the current date in the context line first. The date window and the month timeline use each item's last edited date. " +
    "Pass owners (usernames) to scope to members; the whole lab is the default (own plus everything shared with the user, never a member's private purchases). Pass keywords for a free-text match on item name / vendor / category, and status to scope to needs_ordering / ordered / received. " +
    "Returns { ok, summary } where summary echoes the filter and carries count, totalSpend, totalSpendDisplay, byVendor (each with spendDisplay), byCategory (each with spendDisplay), byMonth (each with spendDisplay), byStatus, pendingVsReceived, and a capped largestItems list (each with totalPriceDisplay, flagged truncated). If nothing matches, summary.count is 0 and totalSpend is 0, say so plainly.",
  parameters: {
    type: "object",
    properties: {
      since: {
        type: "string",
        description:
          "Optional inclusive lower bound as YYYY-MM-DD on the item's last edited date. Resolve relative phrasing to an absolute date yourself first.",
      },
      until: {
        type: "string",
        description:
          "Optional inclusive upper bound as YYYY-MM-DD on the item's last edited date.",
      },
      owners: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional. Usernames of the lab members to scope to. Omit for the whole lab (own plus everything shared with the current user). Never reaches a member's private purchases, only what is shared.",
      },
      status: {
        type: "string",
        description:
          "Optional. Scope to one ordering stage: \"needs_ordering\", \"ordered\", or \"received\". Omit to count every stage.",
      },
      keywords: {
        type: "string",
        description:
          "Optional free-text match on the item name, vendor, or category, for example \"Sigma\" or \"primers\".",
      },
    },
    required: [],
    additionalProperties: false,
  },
  execute: async (args) => {
    const filter = parseFilter(args);
    const purchases = await summarizePurchasesDeps.listPurchases();
    const summary = aggregatePurchases(purchases, filter);
    return { ok: true as const, summary };
  },
};
