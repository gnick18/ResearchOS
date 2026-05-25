"use client";

/**
 * Lab Overview Tools refactor — Phase C (Tools refactor manager,
 * 2026-05-23): the pending-count variant of the `purchases` Tool.
 *
 * A compact summary tile: shield icon + "N pending approvals" + total
 * dollar value. The smallest of the three purchases variants — for users
 * who want the signal without the chrome of the funding-bars view.
 *
 * Clicking it opens the same LabPurchases 4-tab popup as the
 * funding-bars and burn-rate variants. Canvas-only (no sidebar pin).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { labApi } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { useArchivedUsers } from "@/hooks/useArchivedUsers";
import { isPurchasePending } from "@/lib/types";
import type { SnapshotTileProps } from "./types";
import LabPurchasesWidget, {
  SidebarTile as LabPurchasesSidebarTile,
} from "./LabPurchasesWidget";

// Mira PI R1 fix manager (2026-05-25): aligned to the canonical
// `isPurchasePending` predicate from lib/types. The previous local
// `isApprovedItem` predicate treated `approved === undefined` as
// approved, so legacy demo items (and any newly-seeded fixture items
// lacking the `approved` field) silently dropped out of the pending
// count — producing the 40-vs-0 contradiction the fresh-eyes verifier
// flagged between LabPurchasesWidget (which uses `isPurchasePending`,
// pending = `!approved && !declined_at`, treating undefined as pending)
// and this widget (which used the inverse predicate). Aligning to
// `isPurchasePending` makes the three purchases variants — funding-bars,
// burn-rate, pending-count — all agree, and matches the PiActions popup
// + Tab A of the LabPurchases popup.

function formatCompactCurrency(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (n >= 100_000) return `$${(n / 1000).toFixed(0)}k`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1_000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

const SHIELD_ICON = (
  // Shield with check — the "approvals" semantic. Mirrors the SHIELD_ICON
  // used by PiActionsWidget so the user reads "this is the approvals
  // queue at a glance".
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

/**
 * SnapshotTile: the tiniest variant — a single big count + a sub-label
 * for total dollar value. When nothing is pending the tile reads "All
 * caught up" so it never goes blank.
 */
export function SnapshotTile(_props: SnapshotTileProps) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
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
  const pending = useMemo(() => items.filter(isPurchasePending), [items]);
  const pendingValue = useMemo(
    () => pending.reduce((s, it) => s + (it.total_price ?? 0), 0),
    [pending],
  );

  if (accountType !== "lab_head") return null;

  const hasPending = pending.length > 0;

  return (
    <div className="relative h-full overflow-hidden flex flex-col">
      <div className="flex items-center gap-1.5 text-gray-500">
        <span
          aria-hidden="true"
          className={
            hasPending ? "text-amber-600 flex-shrink-0" : "text-emerald-600 flex-shrink-0"
          }
        >
          {SHIELD_ICON}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-medium">
          Pending approvals
        </span>
      </div>
      <div className="mt-2 flex-1 min-h-0 flex flex-col items-center justify-center">
        {isLoading ? (
          <p className="text-xs text-gray-400 italic">Loading…</p>
        ) : !hasPending ? (
          <>
            <p className="text-2xl font-semibold text-emerald-600 tabular-nums">
              0
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">All caught up</p>
          </>
        ) : (
          <>
            <p className="text-3xl font-semibold text-amber-700 tabular-nums">
              {pending.length}
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5 tabular-nums">
              {formatCompactCurrency(pendingValue)} total
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Canvas-only variant. SidebarTile slot reuses the parent purchases
 *  widget's sidebar row — the variant's catalog entry sets
 *  `surface: "canvas"` so the sidebar path is unreachable. */
export const SidebarTile = LabPurchasesSidebarTile;

/** ExpandedView fallback (the Tool registry is the canonical lookup). */
export const ExpandedView = LabPurchasesWidget;

/**
 * Mira PI R1 fix manager (Fix 3, 2026-05-25): help-badge copy for the
 * pending-count variant of the Purchases tile. Lab-head-only widget.
 * Matches Chip B voice (pedagogical, no em-dashes, no emojis).
 */
export const HELP_TEXT =
  "Purchase requests waiting on your sign-off as PI. Click to approve or decline; the requester gets notified either way.";

export default LabPurchasesWidget;
