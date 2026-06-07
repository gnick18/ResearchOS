// Shared display helpers for the inventory surface (chunk 2). Kept tiny and
// pure so the page and the two form dialogs agree on labels / colors without a
// component dependency. House style: no em-dashes, no emojis, no mid-sentence
// colons.

import type {
  InventoryCategory,
  InventoryItem,
  InventoryStock,
  InventoryStockStatus,
  StorageNode,
  StorageNodeKind,
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

// ── Chunk 3 signals (the three zero-upkeep computations, design 2.4 / 10) ────
//
// All three are pure and take an explicit `now: Date` so they are
// deterministically testable. The component passes `new Date()`; tests pass a
// fixed date. None of these reads any new field or storage; they are computed
// from the items + stocks already fetched in chunk 2.

/** The window, in days, that "expiring soon" looks ahead (design 2.4). */
export const EXPIRING_SOON_DAYS = 30;
/** The default staleness threshold, in months (design 2.4, locked at 6). */
export const STALE_AFTER_MONTHS = 6;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole-day difference between two dates (b - a), rounded toward zero so a
 *  same-day expiry reads as 0 days, not a fractional value. */
function wholeDaysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** Subtract whole months from a date (calendar-aware), for the stale cutoff. */
function subtractMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  out.setMonth(out.getMonth() - months);
  return out;
}

/** The three signal kinds. Used for the tile colors and the active filter. */
export type InventorySignalKind = "expiring" | "stale" | "low";

/** A stock that fired the expiring-soon signal, with its display annotation. */
export interface ExpiringSignal {
  item: InventoryItem;
  stock: InventoryStock;
  /** Days until expiry. Negative when already expired. */
  daysToExpiry: number;
  expired: boolean;
  /** "Expires in 9 days (Jun 16, 2026)" / "Expired 4 days ago (Jun 3, 2026)". */
  annotation: string;
}

/** A stock that fired the stale signal, with its display annotation. */
export interface StaleSignal {
  item: InventoryItem;
  stock: InventoryStock;
  /** The most-recent touch we measured staleness from (ISO). */
  referenceDate: string;
  /** "Received Oct 1, 2025, not touched in 8 months". */
  annotation: string;
}

/** An item that fired the low-or-empty signal, with its display annotation. */
export interface LowSignal {
  item: InventoryItem;
  totalContainers: number;
  empty: boolean;
  /** The status chip to show ("empty" when 0, else "low"). */
  chipStatus: InventoryStockStatus;
  /** "1 vial, below your threshold of 2" / "0 vials, empty". */
  annotation: string;
}

/** Build the expiring annotation for a stock given days-to-expiry. */
function expiringAnnotation(
  daysToExpiry: number,
  expirationDate: string,
): string {
  const when = formatDate(expirationDate);
  if (daysToExpiry < 0) {
    const days = Math.abs(daysToExpiry);
    return `Expired ${days} day${days === 1 ? "" : "s"} ago (${when})`;
  }
  if (daysToExpiry === 0) return `Expires today (${when})`;
  return `Expires in ${daysToExpiry} day${
    daysToExpiry === 1 ? "" : "s"
  } (${when})`;
}

/**
 * EXPIRING SOON: stocks whose `expiration_date` is within
 * `EXPIRING_SOON_DAYS` of `now`, PLUS any already-expired stock. Sorted
 * soonest-first (most-expired at the top). Stocks with no expiry are ignored.
 */
export function computeExpiringSignals(
  items: InventoryItem[],
  stocks: InventoryStock[],
  now: Date,
): ExpiringSignal[] {
  const itemById = new Map(items.map((it) => [it.id, it] as const));
  const out: ExpiringSignal[] = [];
  for (const stock of stocks) {
    if (!stock.expiration_date) continue;
    const exp = new Date(stock.expiration_date);
    if (Number.isNaN(exp.getTime())) continue;
    const daysToExpiry = wholeDaysBetween(now, exp);
    if (daysToExpiry > EXPIRING_SOON_DAYS) continue;
    const item = itemById.get(stock.item_id);
    if (!item) continue;
    out.push({
      item,
      stock,
      daysToExpiry,
      expired: daysToExpiry < 0,
      annotation: expiringAnnotation(daysToExpiry, stock.expiration_date),
    });
  }
  out.sort((a, b) => a.daysToExpiry - b.daysToExpiry);
  return out;
}

/** Approximate whole-month gap between two dates for the "not touched in N
 *  months" phrase. Calendar-aware enough for a coarse age label. */
function wholeMonthsBetween(from: Date, to: Date): number {
  let months =
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * STALE: stocks whose most-recent touch (`last_touched_at` if present, else
 * `received_date`) is older than `STALE_AFTER_MONTHS` months. A stock with no
 * received_date AND no last_touched_at cannot be aged, so it never fires.
 * Sorted oldest-first.
 */
export function computeStaleSignals(
  items: InventoryItem[],
  stocks: InventoryStock[],
  now: Date,
): StaleSignal[] {
  const itemById = new Map(items.map((it) => [it.id, it] as const));
  const cutoff = subtractMonths(now, STALE_AFTER_MONTHS);
  const out: StaleSignal[] = [];
  for (const stock of stocks) {
    // The most-recent touch wins, so a recently-edited old stock is NOT stale.
    const candidates: string[] = [];
    if (stock.last_touched_at) candidates.push(stock.last_touched_at);
    if (stock.received_date) candidates.push(stock.received_date);
    if (candidates.length === 0) continue;
    let mostRecent: Date | null = null;
    let mostRecentIso = "";
    for (const iso of candidates) {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) continue;
      if (mostRecent === null || d.getTime() > mostRecent.getTime()) {
        mostRecent = d;
        mostRecentIso = iso;
      }
    }
    if (mostRecent === null) continue;
    if (mostRecent.getTime() >= cutoff.getTime()) continue;
    const item = itemById.get(stock.item_id);
    if (!item) continue;
    const months = wholeMonthsBetween(mostRecent, now);
    // Lead with received_date when we have it (matches the mockup phrasing),
    // otherwise lead with the last-touched stamp.
    const lead = stock.received_date
      ? `Received ${formatDate(stock.received_date)}`
      : `Last touched ${formatDate(stock.last_touched_at)}`;
    out.push({
      item,
      stock,
      referenceDate: mostRecentIso,
      annotation: `${lead}, not touched in ${months} month${
        months === 1 ? "" : "s"
      }`,
    });
  }
  out.sort(
    (a, b) =>
      new Date(a.referenceDate).getTime() - new Date(b.referenceDate).getTime(),
  );
  return out;
}

/**
 * LOW OR EMPTY (item-level): items whose SUMMED `container_count` across their
 * stocks is below the item's `low_at_count`, UNIONED with items that have any
 * stock manually flagged `low` or `empty`. An item with `low_at_count == null`
 * only fires via a manual low/empty tap. Empty (0 total) is annotated as empty.
 * Sorted by total ascending (emptiest first).
 */
export function computeLowSignals(
  items: InventoryItem[],
  stocks: InventoryStock[],
): LowSignal[] {
  const stocksByItem = new Map<number, InventoryStock[]>();
  for (const s of stocks) {
    const arr = stocksByItem.get(s.item_id) ?? [];
    arr.push(s);
    stocksByItem.set(s.item_id, arr);
  }
  const out: LowSignal[] = [];
  for (const item of items) {
    const itemStocks = stocksByItem.get(item.id) ?? [];
    let total = 0;
    let manualLowOrEmpty = false;
    for (const s of itemStocks) {
      total += Number.isFinite(s.container_count) ? s.container_count : 0;
      if (s.status === "low" || s.status === "empty") manualLowOrEmpty = true;
    }
    const belowThreshold =
      typeof item.low_at_count === "number" && total < item.low_at_count;
    if (!belowThreshold && !manualLowOrEmpty) continue;
    const empty = total <= 0;
    const countLabel = containerCountLabel(total, item.container_label);
    let annotation: string;
    if (empty) {
      annotation = `${countLabel}, empty`;
    } else if (belowThreshold && typeof item.low_at_count === "number") {
      annotation = `${countLabel}, below your threshold of ${item.low_at_count}`;
    } else {
      // Manually tapped low/empty without a numeric threshold to cite.
      annotation = `${countLabel}, flagged low`;
    }
    out.push({
      item,
      totalContainers: total,
      empty,
      chipStatus: empty ? "empty" : "low",
      annotation,
    });
  }
  out.sort((a, b) => a.totalContainers - b.totalContainers);
  return out;
}

/** Bundle of all three signal lists plus their counts, computed once at load. */
export interface InventorySignals {
  expiring: ExpiringSignal[];
  stale: StaleSignal[];
  low: LowSignal[];
  allClear: boolean;
}

/** Compute the full signal bundle from the loaded items + stocks. */
export function computeInventorySignals(
  items: InventoryItem[],
  stocks: InventoryStock[],
  now: Date,
): InventorySignals {
  const expiring = computeExpiringSignals(items, stocks, now);
  const stale = computeStaleSignals(items, stocks, now);
  const low = computeLowSignals(items, stocks);
  return {
    expiring,
    stale,
    low,
    allClear: expiring.length === 0 && stale.length === 0 && low.length === 0,
  };
}

// ── Box-finder map helpers (v2 storage map, design section 5.3) ──────────────
//
// All pure so the BoxGrid occupancy + the location breadcrumb agree without a
// component dependency, and so both are deterministically testable without a
// React renderer (mirrors the chunk-3 signal helpers above).

/** Human label for each storage-node kind, shown as the little tag in the tree
 *  and in the kind <select> on the add-location form. */
export const STORAGE_KIND_LABEL: Record<StorageNodeKind, string> = {
  room: "Room",
  freezer: "Freezer",
  fridge: "Fridge",
  ln2: "LN2 tank",
  cabinet: "Cabinet",
  shelf: "Shelf",
  rack: "Rack",
  drawer: "Drawer",
  tower: "Tower",
  box: "Box",
  other: "Other",
};

/** Ordered kinds for the add-location <select> (coarse to fine). */
export const STORAGE_KIND_ORDER: StorageNodeKind[] = [
  "room",
  "freezer",
  "fridge",
  "ln2",
  "cabinet",
  "shelf",
  "rack",
  "tower",
  "drawer",
  "box",
  "other",
];

/** Default box grid offered when adding a `box` node (the two common SBS-ish
 *  cryobox layouts). The form pre-fills 9x9. */
export const DEFAULT_BOX_DIMS: { label: string; rows: number; cols: number }[] =
  [
    { label: "9 x 9 (81)", rows: 9, cols: 9 },
    { label: "10 x 10 (100)", rows: 10, cols: 10 },
  ];

/** The four cell fills the box grid paints, matching the mockup (in_stock =
 *  emerald, low = amber, expired/expiring = rose, empty = neutral). `expiring`
 *  is the soon-to-expire overlay; `expired` is the past-date status. */
export type BoxCellTone = "in" | "low" | "exp" | "empty";

/** Map a stock to its cell tone. `expired` status OR a within-window expiry
 *  both read as `exp` (rose) so a tube about to lapse stands out on the map;
 *  `low`/`empty` read as `low` (amber); everything else is `in` (emerald). An
 *  empty CELL (no stock) is handled by the grid, not here. */
export function boxCellToneForStock(
  stock: InventoryStock,
  now: Date,
): BoxCellTone {
  if (stock.status === "expired") return "exp";
  if (stock.expiration_date) {
    const exp = new Date(stock.expiration_date);
    if (!Number.isNaN(exp.getTime())) {
      const days = Math.round((exp.getTime() - now.getTime()) / MS_PER_DAY);
      if (days <= EXPIRING_SOON_DAYS) return "exp";
    }
  }
  if (stock.status === "low" || stock.status === "empty") return "low";
  return "in";
}

/** Tailwind fill class for a box-grid cell tone. Themed for dark mode the same
 *  way the status chips are (the mockup's emerald/amber/rose backgrounds). A
 *  filled cell drops its border so the fill reads as a solid swatch. */
export function boxCellToneClass(tone: BoxCellTone): string {
  switch (tone) {
    case "in":
      return "bg-emerald-200 border-transparent text-emerald-800 dark:bg-emerald-500/25 dark:text-emerald-200";
    case "low":
      return "bg-amber-200 border-transparent text-amber-800 dark:bg-amber-500/25 dark:text-amber-200";
    case "exp":
      return "bg-rose-200 border-transparent text-rose-800 dark:bg-rose-500/25 dark:text-rose-200";
    case "empty":
      return "bg-surface-raised text-foreground-muted";
  }
}

/** One occupied cell of a box: the position (A1 cell id), the stock sitting
 *  there, its parent item, and its tone. */
export interface BoxCellOccupant {
  position: string;
  stock: InventoryStock;
  item: InventoryItem | null;
  tone: BoxCellTone;
}

/**
 * Build the occupancy map for one box node: position (A1 cell id) -> the stock
 * sitting there. A stock occupies a cell iff `location_node_id === boxId` AND
 * it has a `position`. Unplaced stocks (no node, or node but no position) are
 * excluded. When two stocks claim the same cell (should not happen, but the
 * data layer does not enforce it), the FIRST wins and the rest are ignored so
 * the grid stays deterministic.
 */
export function buildBoxOccupancy(
  boxId: number,
  stocks: InventoryStock[],
  itemsById: Map<number, InventoryItem>,
  now: Date,
): Map<string, BoxCellOccupant> {
  const map = new Map<string, BoxCellOccupant>();
  for (const stock of stocks) {
    if (stock.location_node_id !== boxId) continue;
    if (!stock.position) continue;
    if (map.has(stock.position)) continue;
    map.set(stock.position, {
      position: stock.position,
      stock,
      item: itemsById.get(stock.item_id) ?? null,
      tone: boxCellToneForStock(stock, now),
    });
  }
  return map;
}

/**
 * Walk a node's ancestor chain to the root via `parent_id`, returning the path
 * root-first ("-80 #2", "Rack 3", "Box: Enzymes"). Tolerates a missing parent
 * (a node whose ancestor was deleted) by stopping the walk, and guards against
 * a cycle with a visited set so a malformed tree cannot loop forever.
 */
export function buildNodePath(
  nodeId: number,
  nodesById: Map<number, StorageNode>,
): StorageNode[] {
  const path: StorageNode[] = [];
  const seen = new Set<number>();
  let cur: number | null = nodeId;
  while (cur != null && !seen.has(cur)) {
    seen.add(cur);
    const node = nodesById.get(cur);
    if (!node) break;
    path.unshift(node);
    cur = node.parent_id ?? null;
  }
  return path;
}

/**
 * Build the location breadcrumb string for a placed stock, e.g.
 * "-80 #2 / Rack 3 / Enzymes / B4". `position` is appended when present. When
 * the node id is unknown (deleted location), returns null so the caller can
 * fall back to `location_text`. Node names are used verbatim; a "Box: " prefix
 * is stripped from the box name for a tighter trail (the box kind is already
 * implied by the position cell).
 */
export function buildLocationBreadcrumb(
  nodeId: number | null,
  position: string | null,
  nodesById: Map<number, StorageNode>,
): string | null {
  if (nodeId == null) return null;
  const path = buildNodePath(nodeId, nodesById);
  if (path.length === 0) return null;
  const names = path.map((n) => n.name.replace(/^Box:\s*/i, ""));
  if (position) names.push(position);
  return names.join(" / ");
}

/** The location to display for a stock: prefer the node-based breadcrumb when a
 *  box + position are set, otherwise fall back to the v1 free-text note. Returns
 *  null when neither is set. `kind` tells the caller whether it can be clicked
 *  to jump to the map (only "node" locations resolve to a cell). */
export interface StockLocationDisplay {
  text: string;
  kind: "node" | "text";
  nodeId: number | null;
  position: string | null;
}

export function stockLocationDisplay(
  stock: InventoryStock,
  nodesById: Map<number, StorageNode>,
): StockLocationDisplay | null {
  const crumb = buildLocationBreadcrumb(
    stock.location_node_id,
    stock.position,
    nodesById,
  );
  if (crumb) {
    return {
      text: crumb,
      kind: "node",
      nodeId: stock.location_node_id,
      position: stock.position,
    };
  }
  const text = (stock.location_text ?? "").trim();
  if (text.length > 0) {
    return { text, kind: "text", nodeId: null, position: null };
  }
  return null;
}

/** The descendant `box` nodes reachable under a given ancestor (used to scope
 *  "which boxes live in this freezer"). Pure BFS over parent_id links. */
export function descendantBoxes(
  ancestorId: number,
  nodes: StorageNode[],
): StorageNode[] {
  const childrenOf = new Map<number, StorageNode[]>();
  for (const n of nodes) {
    const p = n.parent_id ?? null;
    if (p == null) continue;
    const arr = childrenOf.get(p) ?? [];
    arr.push(n);
    childrenOf.set(p, arr);
  }
  const out: StorageNode[] = [];
  const queue: number[] = [ancestorId];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const child of childrenOf.get(id) ?? []) {
      if (child.kind === "box") out.push(child);
      queue.push(child.id);
    }
  }
  return out;
}
