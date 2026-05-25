"use client";

/**
 * Lab Overview Tools refactor — Phase C (Tools refactor manager,
 * 2026-05-23): the burn-rate variant of the `purchases` Tool.
 *
 * This widget reuses the chart logic from `MetricsWidget`'s SnapshotTile
 * (the bar chart of approved spend) but is wired to the `purchases`
 * Tool, not `metrics`. Clicking it opens the LabPurchases 4-tab popup
 * (same as the funding-bars and pending-count variants).
 *
 * Burn-rate range selector (burn-rate range manager, 2026-05-23): the
 * tile now exposes a 4-button segmented control (4w / 8w / 12w / 6mo)
 * inside the tile so a lab head can flex the time window without
 * leaving the canvas. The selected range is persisted to localStorage
 * keyed by widget id, so a refresh keeps the user's pick. Chip clicks
 * call `stopPropagation` to avoid triggering the SnapshotCanvas
 * click-to-open wrapper (mirrors the AnnouncementsWidget composer
 * idiom).
 *
 * Why a separate widget file:
 *   - the Tool/Widget split lets a user pin EITHER the funding-bars view
 *     OR the burn-rate view (or both) of the same purchases popup. Each
 *     pin needs its own widget entry in the catalog with a distinct id.
 *   - the chart logic itself was lifted from MetricsWidget rather than
 *     factored out. MemberWorkload + LabActivity share similar mini-bar
 *     visuals; a future follow-up could factor a `<MiniBarChart>`
 *     primitive under `widgets/snapshot/`. Keeping the inline copy here
 *     for now to keep the refactor scope contained.
 *
 * SidebarTile: this variant is canvas-only per the brief. The sidebar
 * keeps the existing `LabPurchasesWidget.SidebarTile` (compact pending
 * count) since the rail is too narrow for a multi-bar chart.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { labApi } from "@/lib/local-api";
import { useLabData } from "@/hooks/useLabData";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { useArchivedUsers } from "@/hooks/useArchivedUsers";
import type { SnapshotTileProps } from "./types";
import LabPurchasesWidget, {
  SidebarTile as LabPurchasesSidebarTile,
} from "./LabPurchasesWidget";

/** Approved predicate mirrors MetricsWidget + LabPurchasesWidget. An
 *  item is approved if `approved === undefined` (back-compat: no field
 *  written) OR `approved === true`. */
function isApprovedItem(item: { approved?: boolean }) {
  return item.approved === undefined || item.approved === true;
}

// ── Range model ──────────────────────────────────────────────────────────

/** Range options exposed in the in-tile segmented control. Adding a new
 *  option means: extend this union, add a `RANGE_OPTIONS` entry, and
 *  cover the bucket math in `bucketsForRange`. */
type BurnRateRange = "4w" | "8w" | "12w" | "6mo";

interface RangeOption {
  id: BurnRateRange;
  /** Short chip label. Inline SVG-free so it stays narrow. */
  label: string;
  /** Aria label for the chip button. */
  aria: string;
  /** Empty-state copy (used when every bucket sums to 0). */
  emptyLabel: string;
}

const RANGE_OPTIONS: ReadonlyArray<RangeOption> = [
  { id: "4w", label: "4w", aria: "Last 4 weeks", emptyLabel: "No spend in the last 4 weeks" },
  { id: "8w", label: "8w", aria: "Last 8 weeks", emptyLabel: "No spend in the last 8 weeks" },
  { id: "12w", label: "12w", aria: "Last 12 weeks", emptyLabel: "No spend in the last 12 weeks" },
  { id: "6mo", label: "6mo", aria: "Last 6 months", emptyLabel: "No spend in the last 6 months" },
];

const DEFAULT_RANGE: BurnRateRange = "4w";

/** localStorage key for the burn-rate widget's persisted settings.
 *  Shape: `{ "range": BurnRateRange }`. Other future tile-local prefs
 *  can ride the same object. The `researchos:widget-settings:<id>`
 *  prefix is reserved for this kind of per-tile prefs; if a second
 *  tile adopts the model, factor `widget-settings.ts` out. */
const STORAGE_KEY = "researchos:widget-settings:lab-purchases-burn-rate";

function isBurnRateRange(value: unknown): value is BurnRateRange {
  return value === "4w" || value === "8w" || value === "12w" || value === "6mo";
}

function readStoredRange(): BurnRateRange {
  if (typeof window === "undefined") return DEFAULT_RANGE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_RANGE;
    const parsed = JSON.parse(raw) as { range?: unknown };
    return isBurnRateRange(parsed.range) ? parsed.range : DEFAULT_RANGE;
  } catch {
    return DEFAULT_RANGE;
  }
}

function writeStoredRange(range: BurnRateRange): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ range }));
  } catch {
    // best-effort; storage may be disabled (private mode, quota)
  }
}

// ── Bucket math ──────────────────────────────────────────────────────────

interface Bucket {
  /** Short label (`Mar 3` for weekly, `Mar` for monthly). */
  label: string;
  /** Full hover label (`Week of Mar 3` / `Mar 2026`). */
  fullLabel: string;
  total: number;
  startMs: number;
  endMs: number;
}

/** Build N weekly buckets ending at this week (Sun-Sat). Bucket 0 is
 *  oldest, bucket N-1 is the current week. */
function weeklyBuckets(weeks: number): Bucket[] {
  const startOfThisWeek = new Date();
  startOfThisWeek.setHours(0, 0, 0, 0);
  startOfThisWeek.setDate(startOfThisWeek.getDate() - startOfThisWeek.getDay());
  const buckets: Bucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(startOfThisWeek);
    start.setDate(start.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const label = start.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    buckets.push({
      label,
      fullLabel: `Week of ${label}`,
      total: 0,
      startMs: start.getTime(),
      endMs: end.getTime(),
    });
  }
  return buckets;
}

/** Build N monthly buckets ending at this month. Bucket 0 is oldest,
 *  bucket N-1 is the current month. */
function monthlyBuckets(months: number): Bucket[] {
  const now = new Date();
  const buckets: Bucket[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    end.setHours(0, 0, 0, 0);
    const label = start.toLocaleDateString(undefined, { month: "short" });
    const fullLabel = start.toLocaleDateString(undefined, {
      month: "short",
      year: "numeric",
    });
    buckets.push({
      label,
      fullLabel,
      total: 0,
      startMs: start.getTime(),
      endMs: end.getTime(),
    });
  }
  return buckets;
}

function bucketsForRange(range: BurnRateRange): Bucket[] {
  switch (range) {
    case "4w":
      return weeklyBuckets(4);
    case "8w":
      return weeklyBuckets(8);
    case "12w":
      return weeklyBuckets(12);
    case "6mo":
      return monthlyBuckets(6);
  }
}

/** Sum approved purchase items into the supplied buckets, keyed off the
 *  parent purchase task's `start_date` (the timestamp proxy used by
 *  MetricsWidget + LabPurchasesWidget). Mutates each bucket's `total`
 *  in place; returns the same array for convenience. */
function fillBuckets(
  buckets: Bucket[],
  items: Array<{
    username: string;
    task_id: number;
    total_price: number | null;
    approved?: boolean;
  }>,
  tasksByKey: Map<string, { start_date: string | null }>,
): Bucket[] {
  for (const it of items) {
    if (!isApprovedItem(it)) continue;
    const parent = tasksByKey.get(`${it.username}:${it.task_id}`);
    if (!parent?.start_date) continue;
    const t = new Date(`${parent.start_date}T00:00:00`).getTime();
    if (!Number.isFinite(t)) continue;
    for (const b of buckets) {
      if (t >= b.startMs && t < b.endMs) {
        b.total += it.total_price ?? 0;
        break;
      }
    }
  }
  return buckets;
}

function pendingCount(items: Array<{ approved?: boolean }>): number {
  let count = 0;
  for (const it of items) {
    if (!isApprovedItem(it)) count++;
  }
  return count;
}

function formatCompactCurrency(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (n >= 100_000) return `$${(n / 1000).toFixed(0)}k`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1_000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

const BURN_RATE_ICON = (
  // Trending up — distinct from PURCHASES_TILE_ICON (dollar sign) so the
  // two purchases variants read differently on the canvas. Mirrors the
  // METRICS_ICON shape that historically owned the burn-rate visual.
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 3v18h18" />
    <path d="M7 14l4-4 4 4 5-6" />
  </svg>
);

/**
 * SnapshotTile: vertical bars (one per bucket, oldest -> newest, left ->
 * right) of approved lab spend, a small "X pending" pill in the
 * top-right when there are unapproved items, and a 4-button range
 * selector inline beneath the title.
 *
 * Range chip placement: below the title row (not the absolute
 * top-right) so it doesn't collide with the existing pending pill that
 * lives there, and so the 4 chips can sit on a single row inside the
 * 176px tile height without crowding the bars. Chip clicks call
 * `stopPropagation` to avoid the SnapshotCanvas click-to-open wrapper.
 *
 * Visibility: lab_head only. Members don't have purchase visibility
 * (the registry entry sets `memberVisible: false`); the catalog filter
 * is the canonical gate, but we mirror it here so a mis-pinned tile on
 * a member surface renders nothing instead of crashing.
 */
export function SnapshotTile(_props: SnapshotTileProps) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const { tasks } = useLabData();
  const archivedSet = useArchivedUsers();
  const { data: rawItems = [], isLoading } = useQuery({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: accountType === "lab_head",
  });
  const items = useMemo(
    () => rawItems.filter((it) => !archivedSet.has(it.username)),
    [rawItems, archivedSet],
  );
  const tasksByKey = useMemo(() => {
    const m = new Map<string, { start_date: string | null }>();
    for (const t of tasks) {
      if (t.task_type === "purchase") m.set(`${t.username}:${t.id}`, t);
    }
    return m;
  }, [tasks]);

  // Range state: SSR-safe two-step hydration mirroring the
  // LabExperimentsPanel idiom (initial render uses the default, an
  // effect reads from localStorage on mount). Avoids hydration
  // mismatch warnings.
  const [range, setRange] = useState<BurnRateRange>(DEFAULT_RANGE);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe localStorage hydration: useState seed must match the server-rendered HTML (DEFAULT_RANGE), then we read the persisted value on mount.
    setRange(readStoredRange());
  }, []);
  const setAndPersistRange = (next: BurnRateRange) => {
    setRange(next);
    writeStoredRange(next);
  };

  const buckets = useMemo(
    () => fillBuckets(bucketsForRange(range), items, tasksByKey),
    [range, items, tasksByKey],
  );
  const pending = useMemo(() => pendingCount(items), [items]);
  const maxTotal = useMemo(
    () => Math.max(0, ...buckets.map((b) => b.total)),
    [buckets],
  );
  const activeOption =
    RANGE_OPTIONS.find((o) => o.id === range) ?? RANGE_OPTIONS[0];

  // Stops the SnapshotCanvas wrapper's click-to-open + keydown-to-open
  // handlers on the interactive range-selector area. Mirrors the
  // AnnouncementsWidget composer idiom.
  const stopClick = (e: React.MouseEvent | React.KeyboardEvent) =>
    e.stopPropagation();

  if (accountType !== "lab_head") return null;

  return (
    <div className="relative h-full overflow-hidden flex flex-col">
      <div className="flex items-center gap-1.5 text-gray-500">
        <span aria-hidden="true" className="text-emerald-600 flex-shrink-0">
          {BURN_RATE_ICON}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-medium">
          Burn rate
        </span>
      </div>
      {pending > 0 && (
        <span
          className="absolute top-0 right-0 text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full font-medium"
          aria-label={`${pending} pending`}
        >
          {pending} pending
        </span>
      )}
      {/* Range selector: 4 segmented chips. Wrapper stops click + key
          propagation so chip interaction doesn't trigger the
          SnapshotCanvas open-popup handler. */}
      <div
        className="mt-1.5 inline-flex self-start rounded-md border border-gray-200 bg-gray-50 p-0.5"
        role="group"
        aria-label="Burn rate range"
        onClick={stopClick}
        onKeyDown={stopClick}
      >
        {RANGE_OPTIONS.map((opt) => {
          const isActive = opt.id === range;
          return (
            <button
              key={opt.id}
              type="button"
              aria-label={opt.aria}
              aria-pressed={isActive}
              data-testid={`burn-rate-range-${opt.id}`}
              onClick={(e) => {
                e.stopPropagation();
                setAndPersistRange(opt.id);
              }}
              className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors tabular-nums ${
                isActive
                  ? "bg-white text-emerald-700 shadow-sm border border-gray-200"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex-1 min-h-0 flex flex-col">
        {isLoading ? (
          <p className="text-xs text-gray-400 italic m-auto">Loading…</p>
        ) : maxTotal === 0 ? (
          <p className="text-xs text-gray-400 italic m-auto">
            {activeOption.emptyLabel}
          </p>
        ) : (
          <>
            <div
              className="flex-1 min-h-0 flex items-end justify-between gap-1"
              aria-label={`Approved purchase spend per bucket (${activeOption.aria.toLowerCase()})`}
            >
              {buckets.map((b, idx) => {
                const pct = maxTotal > 0 ? (b.total / maxTotal) * 100 : 0;
                const isCurrent = idx === buckets.length - 1;
                return (
                  <div
                    key={`${b.startMs}-${b.label}`}
                    className="flex-1 flex flex-col justify-end h-full min-w-0"
                    title={`${b.fullLabel}: ${formatCompactCurrency(b.total)}`}
                  >
                    <div
                      className={`w-full rounded-sm ${
                        isCurrent ? "bg-emerald-500" : "bg-gray-300"
                      }`}
                      style={{ height: `${Math.max(2, pct)}%` }}
                    />
                  </div>
                );
              })}
            </div>
            {/* Axis labels: weekly view labels every bucket; longer
                ranges (8w / 12w / 6mo) only label first + last to keep
                the row readable in 176px of tile height. */}
            <div className="mt-1 flex items-center justify-between gap-1 text-[10px] text-gray-400 tabular-nums">
              {buckets.map((b, idx) => {
                const isFirst = idx === 0;
                const isLast = idx === buckets.length - 1;
                const showLabel =
                  range === "4w" || isFirst || isLast;
                return (
                  <span
                    key={`label-${b.startMs}-${b.label}`}
                    className="flex-1 text-center truncate"
                  >
                    {isLast ? "now" : showLabel ? b.label : ""}
                  </span>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * SidebarTile: this variant is canvas-only per the brief. We re-export
 * the existing `LabPurchasesWidget.SidebarTile` so the registry's
 * `SidebarTile` slot is satisfied (the type requires it); pinning the
 * variant in the sidebar surface would show the same row as the parent
 * purchases widget. In practice the variant's catalog entry sets
 * `surface: "canvas"` so this path is unreachable from the UI.
 */
export const SidebarTile = LabPurchasesSidebarTile;

/**
 * ExpandedView: the burn-rate variant opens the same LabPurchases 4-tab
 * popup as every other purchases variant. We alias to the parent
 * widget's default export to keep the back-compat fallback wired (the
 * Tool registry is the canonical lookup, but if it fails to resolve
 * we still get the right popup).
 */
export const ExpandedView = LabPurchasesWidget;

/**
 * Lab overview PI tooltips (Chip B, 2026-05-25): help-badge copy for
 * the burn-rate variant of the Purchases tile. Lab-head-only widget.
 */
export const HELP_TEXT =
  "Approved purchase spend across the last 4 weeks, week by week. PI only. Use it to spot funding burn-rate spikes before they bite.";

export default LabPurchasesWidget;
