// Shared display helpers for the inventory surface (chunk 2). Kept tiny and
// pure so the page and the two form dialogs agree on labels / colors without a
// component dependency. House style: no em-dashes, no emojis, no mid-sentence
// colons.

import type {
  InventoryCategory,
  InventoryStock,
  InventoryStockStatus,
} from "@/lib/types";

/** Human label for each catalog category (design section 5.1). */
export const CATEGORY_LABEL: Record<InventoryCategory, string> = {
  reagent: "Reagent",
  antibody: "Antibody",
  plasmid: "Plasmid",
  enzyme: "Enzyme",
  primer: "Primer",
  cell_line: "Cell line",
  strain: "Strain",
  kit: "Kit",
  equipment: "Equipment",
  other: "Other",
};

/** Ordered list for the category <select>. */
export const CATEGORY_ORDER: InventoryCategory[] = [
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
];

/** Human label for each coarse stock status (design section 5.2). */
export const STATUS_LABEL: Record<InventoryStockStatus, string> = {
  in_stock: "In stock",
  low: "Low",
  empty: "Empty",
  expired: "Expired",
};

/** The three one-tap statuses the user can set directly. `expired` is derived
 *  from `expiration_date`, never tapped (design section 2.3). */
export const TAPPABLE_STATUSES: InventoryStockStatus[] = [
  "in_stock",
  "low",
  "empty",
];

/** Tailwind classes for a status chip. Themed for dark mode (every surface uses
 *  semantic / brand tokens). */
export function statusChipClass(status: InventoryStockStatus): string {
  switch (status) {
    case "in_stock":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300";
    case "low":
      return "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300";
    case "empty":
      return "bg-slate-200 text-slate-600 dark:bg-slate-500/25 dark:text-slate-300";
    case "expired":
      return "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300";
  }
}

/** Singular container word for an item, defaulting to "container". */
export function containerWord(label: string | null | undefined): string {
  const trimmed = (label ?? "").trim();
  return trimmed.length > 0 ? trimmed : "container";
}

/** Pluralize the container word for a count ("3 vials", "1 vial"). Naive English
 *  pluralization is enough for the short bench words this field holds. */
export function containerCountLabel(
  count: number,
  label: string | null | undefined,
): string {
  const word = containerWord(label);
  if (count === 1) return `1 ${word}`;
  const plural = word.endsWith("s") || word.endsWith("x") ? word : `${word}s`;
  return `${count} ${plural}`;
}

/** Summary across an item's stocks: total containers, soonest expiry, and the
 *  most-urgent status. Used by the list row. */
export interface StockSummary {
  totalContainers: number;
  stockCount: number;
  soonestExpiry: string | null;
  worstStatus: InventoryStockStatus | null;
}

// Status urgency order for "worst wins" in the row summary.
const STATUS_RANK: Record<InventoryStockStatus, number> = {
  expired: 3,
  empty: 2,
  low: 1,
  in_stock: 0,
};

export function summarizeStocks(stocks: InventoryStock[]): StockSummary {
  let totalContainers = 0;
  let soonestExpiry: string | null = null;
  let worstStatus: InventoryStockStatus | null = null;
  for (const s of stocks) {
    const count = Number.isFinite(s.container_count) ? s.container_count : 0;
    totalContainers += count;
    if (s.expiration_date) {
      if (soonestExpiry === null || s.expiration_date < soonestExpiry) {
        soonestExpiry = s.expiration_date;
      }
    }
    if (
      worstStatus === null ||
      STATUS_RANK[s.status] > STATUS_RANK[worstStatus]
    ) {
      worstStatus = s.status;
    }
  }
  return {
    totalContainers,
    stockCount: stocks.length,
    soonestExpiry,
    worstStatus,
  };
}

/** Format an ISO date for display ("Jun 7, 2026"). Returns "" for null/bad. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Coerce a date-only ISO string (yyyy-mm-dd, the <input type="date"> value) to
 *  the stored ISO, or null when blank. Stored as midnight UTC so the derived
 *  expiry math is stable. */
export function dateInputToIso(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  // The input already yields yyyy-mm-dd; store the full ISO at UTC midnight.
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** ISO -> yyyy-mm-dd for an <input type="date"> value. */
export function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}
