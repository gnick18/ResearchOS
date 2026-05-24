"use client";

/**
 * Lab Overview Tools refactor — Phase C (Tools refactor manager,
 * 2026-05-23): the burn-rate variant of the `purchases` Tool.
 *
 * This widget reuses the chart logic from `MetricsWidget`'s SnapshotTile
 * (the 4-week bar chart of approved spend) but is wired to the
 * `purchases` Tool, not `metrics`. Clicking it opens the LabPurchases
 * 4-tab popup (same as the funding-bars and pending-count variants).
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
 * count) — the rail is too narrow for a 4-week chart.
 */

import { useMemo } from "react";
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

/** Bucket approved spend into the last 4 calendar weeks (Sun-Sat).
 *  Lifted verbatim from MetricsWidget's `weeklyBurnRate`. Bucket 0 is 3
 *  weeks ago, bucket 3 is the current week — left-to-right reads as
 *  oldest → newest, matching how burn-rate charts are usually drawn. */
function weeklyBurnRate(
  items: Array<{
    username: string;
    task_id: number;
    total_price: number | null;
    approved?: boolean;
  }>,
  tasksByKey: Map<string, { start_date: string | null }>,
): Array<{ label: string; total: number }> {
  const startOfThisWeek = new Date();
  startOfThisWeek.setHours(0, 0, 0, 0);
  startOfThisWeek.setDate(startOfThisWeek.getDate() - startOfThisWeek.getDay());
  const buckets: Array<{
    label: string;
    total: number;
    startMs: number;
    endMs: number;
  }> = [];
  for (let i = 3; i >= 0; i--) {
    const start = new Date(startOfThisWeek);
    start.setDate(start.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    buckets.push({
      label: start.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      total: 0,
      startMs: start.getTime(),
      endMs: end.getTime(),
    });
  }
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
  return buckets.map(({ label, total }) => ({ label, total }));
}

function pendingCount(
  items: Array<{ approved?: boolean }>,
): number {
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
 * SnapshotTile: 4 vertical bars (one per calendar week, oldest →
 * newest, left → right) representing approved lab spend, plus a small
 * "X pending" pill in the top-right when there are unapproved items.
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
  const buckets = useMemo(
    () => weeklyBurnRate(items, tasksByKey),
    [items, tasksByKey],
  );
  const pending = useMemo(() => pendingCount(items), [items]);
  const maxTotal = useMemo(
    () => Math.max(0, ...buckets.map((b) => b.total)),
    [buckets],
  );

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
      <div className="mt-2 flex-1 min-h-0 flex flex-col">
        {isLoading ? (
          <p className="text-xs text-gray-400 italic m-auto">Loading…</p>
        ) : maxTotal === 0 ? (
          <p className="text-xs text-gray-400 italic m-auto">
            No spend in the last 4 weeks
          </p>
        ) : (
          <>
            <div
              className="flex-1 min-h-0 flex items-end justify-between gap-1.5"
              aria-label="Approved purchase spend by week (last 4 weeks)"
            >
              {buckets.map((b, idx) => {
                const pct = maxTotal > 0 ? (b.total / maxTotal) * 100 : 0;
                const isCurrent = idx === buckets.length - 1;
                return (
                  <div
                    key={b.label}
                    className="flex-1 flex flex-col justify-end h-full min-w-0"
                    title={`Week of ${b.label}: ${formatCompactCurrency(b.total)}`}
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
            <div className="mt-1 flex items-center justify-between gap-1 text-[10px] text-gray-400 tabular-nums">
              {buckets.map((b, idx) => (
                <span key={b.label} className="flex-1 text-center truncate">
                  {idx === buckets.length - 1 ? "now" : b.label}
                </span>
              ))}
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

export default LabPurchasesWidget;
