/**
 * Reorder cadence suggestions (reorder-loop sub-bot, 2026-05-31).
 *
 * A PURELY DERIVED computation over existing purchase history. ZERO new
 * input and ZERO data-shape change: it reads the same `PurchaseItem`
 * records the /purchases page already loads and joins each to its parent
 * task's `start_date` for the order date (exactly how SpendingDashboard
 * derives a purchase's month). Nothing is stored; suggestions are
 * recomputed at load.
 *
 * The idea: if a lab reorders the same consumable on a regular rhythm
 * (every ~6 weeks, say), we can notice when the next reorder is coming
 * due without the user logging anything. We group the purchase history by
 * the item (normalized name + catalog#/CAS), and for any item ordered
 * >= 3 times we estimate the mean interval between consecutive orders.
 * When the time since the last order reaches ~0.8x that mean interval the
 * item is flagged "due" - early enough to reorder before running out, but
 * not so eager that every item is always nagging.
 *
 * Edge cases handled gracefully:
 *   - fewer than 3 distinct order dates  -> not enough signal, skipped
 *   - same-day duplicate orders          -> collapsed to one order date
 *     (a single purchase order with two line items of the same reagent
 *     is one ordering event, not two)
 *   - irregular intervals                -> the mean still summarizes the
 *     rhythm; the coefficient of variation is exposed so a caller can
 *     down-rank erratic items if it wants (the widget shows them but
 *     labels the cadence "rough")
 *   - undated purchases (no resolvable task / start_date) -> dropped from
 *     that item's date series (can't place them on the timeline)
 */

/** One purchase observation fed into the cadence model. Intentionally a
 *  minimal projection of `PurchaseItem` (+ its parent task's date) so the
 *  algorithm stays pure and trivially testable: callers map their real
 *  records down to this shape. */
export interface ReorderPurchaseInput {
  /** Source PurchaseItem id (used to pick a representative record for the
   *  "Buy again" action - the most recent order wins). */
  id: number;
  /** Raw item name as typed. Normalized internally for grouping. */
  item_name: string;
  /** Catalog number / CAS / accession, if any. Part of the group key so
   *  two different reagents that happen to share a loose name don't merge. */
  cas: string | null;
  /** Vendor, link, price - carried through so a suggestion can prefill a
   *  "Buy again" without a second lookup. Not used by the cadence math. */
  vendor: string | null;
  link: string | null;
  price_per_unit: number;
  quantity: number;
  /** ISO date (YYYY-MM-DD or full ISO) of when the order was placed. In
   *  the app this is the parent task's `start_date`. `null`/empty when the
   *  purchase can't be dated; such records are dropped from the series. */
  order_date: string | null;
}

/** A computed reorder suggestion for one item group. */
export interface ReorderSuggestion {
  /** Stable group key (normalized name + cas). */
  key: string;
  /** Display name (the most-recent order's raw item_name). */
  itemName: string;
  cas: string | null;
  vendor: string | null;
  link: string | null;
  pricePerUnit: number;
  quantity: number;
  /** PurchaseItem id of the most-recent order in the group - the record a
   *  one-click "Buy again" should clone. */
  representativeId: number;
  /** How many distinct order DATES are in this group (>= 3 to qualify). */
  orderCount: number;
  /** Mean gap between consecutive orders, in whole days (rounded). */
  meanIntervalDays: number;
  /** Days since the most-recent order, relative to the evaluation date. */
  daysSinceLast: number;
  /** `daysSinceLast / meanIntervalDays` - 1.0 means "right on schedule",
   *  >= the due threshold means due. */
  ratio: number;
  /** True when `daysSinceLast >= DUE_RATIO * meanIntervalDays`. */
  due: boolean;
  /** Coefficient of variation of the intervals (stddev / mean). Higher =
   *  more irregular rhythm. Callers may label cadence "rough" above a
   *  threshold; the math itself does not gate on it. */
  intervalCv: number;
}

/** Minimum distinct order dates an item needs before we'll model its
 *  cadence. Two orders give exactly one interval (no spread to speak of);
 *  three give two intervals, the smallest sample where a mean is
 *  meaningful. Matches the brief ("ordered >= 3 times"). */
export const MIN_ORDERS_FOR_CADENCE = 3;

/** Fraction of the mean interval at which an item becomes "due". 0.8 nudges
 *  the reorder a little before the average gap elapses so the supply is
 *  replaced just before it would typically run out. */
export const DUE_RATIO = 0.8;

/** Above this coefficient of variation the rhythm is "rough" / irregular.
 *  Advisory only - exposed for the UI label, never gates a suggestion. */
export const ROUGH_CADENCE_CV = 0.75;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Normalize an item name for grouping: trim, collapse internal whitespace,
 * lower-case. Keeps "Q5 Polymerase", "q5 polymerase", and "Q5  Polymerase"
 * in one bucket without touching the stored value (which the suggestion
 * carries verbatim from the most-recent record).
 */
export function normalizeItemName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Build the composite group key from a name + cas. CAS is included so two
 *  reagents with a colliding loose name but different catalog numbers don't
 *  merge; a null/blank cas contributes an empty segment so undated-cas
 *  items still group by name. */
function groupKey(name: string, cas: string | null): string {
  const normName = normalizeItemName(name);
  const normCas = (cas ?? "").trim().toLowerCase();
  return `${normName} ${normCas}`;
}

/**
 * Parse an order date to a day-resolution count. Returns null for empty /
 * unparseable values so the caller can drop the record from the series.
 *
 * Accepts both "YYYY-MM-DD" (task.start_date) and full ISO strings.
 */
function parseOrderDay(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // A bare "YYYY-MM-DD" parses at UTC midnight; a full ISO keeps its
  // instant. We only ever subtract two of these, so any consistent anchor
  // works.
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  // Collapse to whole days so same-day orders dedupe cleanly.
  return Math.floor(ms / MS_PER_DAY);
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stddev(xs: number[], avg: number): number {
  if (xs.length === 0) return 0;
  const variance =
    xs.reduce((s, x) => s + (x - avg) * (x - avg), 0) / xs.length;
  return Math.sqrt(variance);
}

/**
 * Core cadence computation.
 *
 * @param inputs   Flat list of purchase observations (any order).
 * @param nowMs    Evaluation timestamp in epoch ms (defaults to Date.now()).
 *                 Injected so tests are deterministic.
 * @returns        One suggestion per qualifying item group, sorted with the
 *                 most-overdue (highest ratio) first, then alphabetically.
 *                 Non-qualifying groups (< 3 distinct order dates) are
 *                 omitted entirely.
 *
 * Only items whose cadence model is computable are returned; `due` is a
 * field on each so a caller can show "due now" vs "on track" together, or
 * filter to `due === true` for a nudge list.
 */
export function computeReorderSuggestions(
  inputs: ReorderPurchaseInput[],
  nowMs: number = Date.now(),
): ReorderSuggestion[] {
  const nowDay = Math.floor(nowMs / MS_PER_DAY);

  // Bucket inputs by group key.
  const groups = new Map<string, ReorderPurchaseInput[]>();
  for (const input of inputs) {
    if (!input.item_name || !input.item_name.trim()) continue;
    const key = groupKey(input.item_name, input.cas);
    const arr = groups.get(key);
    if (arr) arr.push(input);
    else groups.set(key, [input]);
  }

  const suggestions: ReorderSuggestion[] = [];

  for (const [key, records] of groups) {
    // Map each record to its order day; drop undated ones.
    const dated = records
      .map((r) => ({ record: r, day: parseOrderDay(r.order_date) }))
      .filter((d): d is { record: ReorderPurchaseInput; day: number } =>
        d.day !== null,
      );
    if (dated.length === 0) continue;

    // Distinct order DATES: a single purchase order with two same-reagent
    // line items is one ordering event. Collapse by day, keeping the
    // record with the largest id per day as that day's representative
    // (largest id = most-recent write, matching the autocomplete dedupe).
    const byDay = new Map<number, ReorderPurchaseInput>();
    for (const { record, day } of dated) {
      const existing = byDay.get(day);
      if (!existing || existing.id < record.id) byDay.set(day, record);
    }

    const days = [...byDay.keys()].sort((a, b) => a - b);
    if (days.length < MIN_ORDERS_FOR_CADENCE) continue;

    // Consecutive intervals (in days). Length = days.length - 1 >= 2.
    const intervals: number[] = [];
    for (let i = 1; i < days.length; i++) {
      intervals.push(days[i] - days[i - 1]);
    }
    const meanInterval = mean(intervals);
    // Degenerate guard: a zero-mean interval has no rhythm to project.
    // Post-dedupe the days are distinct so intervals are >= 1, but defend
    // anyway against a pathological input.
    if (meanInterval <= 0) continue;

    const lastDay = days[days.length - 1];
    // Clamp to >= 0: a future-dated order (start_date ahead of "now")
    // shouldn't read as negative time-since.
    const daysSinceLast = Math.max(0, nowDay - lastDay);
    const ratio = daysSinceLast / meanInterval;
    const due = daysSinceLast >= DUE_RATIO * meanInterval;

    const sd = stddev(intervals, meanInterval);
    const intervalCv = meanInterval > 0 ? sd / meanInterval : 0;

    // Representative record for display + "Buy again": the most-recent
    // order overall (the latest day's record, which the per-day dedupe
    // already pinned to the largest id).
    const rep = byDay.get(lastDay)!;

    suggestions.push({
      key,
      itemName: rep.item_name.trim(),
      cas: rep.cas,
      vendor: rep.vendor,
      link: rep.link,
      pricePerUnit: rep.price_per_unit,
      quantity: rep.quantity,
      representativeId: rep.id,
      orderCount: days.length,
      meanIntervalDays: Math.round(meanInterval),
      daysSinceLast,
      ratio,
      due,
      intervalCv,
    });
  }

  // Most-overdue first (highest ratio), then alphabetical for stability.
  suggestions.sort((a, b) => {
    if (b.ratio !== a.ratio) return b.ratio - a.ratio;
    return a.itemName.localeCompare(b.itemName);
  });

  return suggestions;
}

/** Convenience: just the items that are currently due, in the same order. */
export function dueReorderSuggestions(
  inputs: ReorderPurchaseInput[],
  nowMs: number = Date.now(),
): ReorderSuggestion[] {
  return computeReorderSuggestions(inputs, nowMs).filter((s) => s.due);
}

/** Whole weeks (rounded) for a day count - the UI speaks in weeks
 *  ("about every 6 weeks"). Exposed so the copy stays consistent. */
export function daysToWeeks(days: number): number {
  return Math.round(days / 7);
}
