"use client";

/**
 * Reorder suggestions widget (reorder-loop sub-bot, 2026-05-31).
 *
 * Feature 3 of the reorder loop: a PURELY DERIVED nudge surface. It looks
 * at the current user's purchase history, groups by item (normalized name
 * + CAS), and for anything ordered >= 3 times estimates the reorder
 * cadence. When the time since the last order reaches ~0.8x the mean
 * interval the item is "due" and surfaces here, with a one-click "Buy
 * again" that drops a fresh `needs_ordering` line item into the normal
 * pipeline.
 *
 * ZERO new input, ZERO storage, ZERO data-shape change: the cadence is
 * computed at load from `PurchaseItem` records + their parent task dates
 * (see `useReorderSuggestions` + `lib/purchases/reorder-cadence`). The
 * "Buy again" write reuses the shared `createReorderPurchase` action,
 * which goes through the existing tasksApi / purchasesApi create path.
 *
 * Member-visible (the nudge is personal - "you reorder this about every N
 * weeks"). Renders as a SnapshotTile / SidebarTile (the due count) opening
 * the full ExpandedView list.
 */

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Tooltip from "@/components/Tooltip";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useReorderSuggestions } from "@/hooks/useReorderSuggestions";
import {
  createReorderPurchase,
  type ReorderItemSeed,
} from "@/lib/purchases/reorder-actions";
import {
  daysToWeeks,
  ROUGH_CADENCE_CV,
  type ReorderSuggestion,
} from "@/lib/purchases/reorder-cadence";
import StatTile from "./snapshot/StatTile";
import SidebarStatTile from "./snapshot/SidebarStatTile";
import type {
  ExpandedViewProps,
  SnapshotTileProps,
  SidebarTileProps,
} from "./types";

// ── Inline SVG icons (no emojis, no lucide-react) ─────────────────────────

/** Cyclical-arrows "reorder" mark - distinct from the plain cart used by
 *  the quick-capture button so the dashboard reads "recurring purchase". */
const REORDER_ICON = (
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
    <path d="M3 2v6h6" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L3 8" />
  </svg>
);

const REORDER_ICON_SM = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 2v6h6" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L3 8" />
  </svg>
);

/** Small cart-plus for the per-row "Buy again" affordance. */
const BUY_AGAIN_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    <line x1="16" y1="6" x2="22" y2="6" />
    <line x1="19" y1="3" x2="19" y2="9" />
  </svg>
);

// ── Copy helper ───────────────────────────────────────────────────────────

/** "you reorder this about every N weeks, last order was M weeks ago". The
 *  cadence math runs in days; we round to whole weeks for the copy. */
function cadenceSentence(s: ReorderSuggestion): string {
  const everyWeeks = daysToWeeks(s.meanIntervalDays);
  const sinceWeeks = daysToWeeks(s.daysSinceLast);
  const everyLabel =
    everyWeeks <= 1 ? "about every week" : `about every ${everyWeeks} weeks`;
  const sinceLabel =
    sinceWeeks <= 0
      ? "last order was this week"
      : sinceWeeks === 1
        ? "last order was 1 week ago"
        : `last order was ${sinceWeeks} weeks ago`;
  return `You reorder this ${everyLabel}, ${sinceLabel}.`;
}

// ── Shared "Buy again" button ─────────────────────────────────────────────

function BuyAgainButton({
  seed,
  currentUser,
  onDone,
}: {
  seed: ReorderItemSeed;
  currentUser: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const handleClick = async () => {
    if (busy || done) return;
    setBusy(true);
    try {
      // No explicit project -> routes to the per-user Miscellaneous bucket,
      // matching the quick-capture default. The new item starts in
      // needs_ordering and flows through the normal approval -> ordered
      // pipeline.
      await createReorderPurchase(seed, { currentUser });
      setDone(true);
      onDone();
    } catch {
      alert("Failed to create the reorder. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
        Added
      </span>
    );
  }

  return (
    <Tooltip label="Add a fresh needs-ordering line item" placement="left">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-label={`Buy ${seed.item_name} again`}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span aria-hidden="true">{BUY_AGAIN_ICON}</span>
        {busy ? "Adding…" : "Buy again"}
      </button>
    </Tooltip>
  );
}

// ── ExpandedView (the popup body) ─────────────────────────────────────────

export default function ReorderSuggestionsWidget(_props?: ExpandedViewProps) {
  const queryClient = useQueryClient();
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";
  const { suggestions, isLoading } = useReorderSuggestions();

  // Due first (already sorted by ratio), then the on-track items so a user
  // can see the whole recurring-purchase picture. The due ones get the
  // highlighted treatment.
  const due = useMemo(() => suggestions.filter((s) => s.due), [suggestions]);
  const onTrack = useMemo(
    () => suggestions.filter((s) => !s.due),
    [suggestions],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["purchases-all"] });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  const renderRow = (s: ReorderSuggestion) => {
    const seed: ReorderItemSeed = {
      item_name: s.itemName,
      vendor: s.vendor,
      cas: s.cas,
      link: s.link,
      price_per_unit: s.pricePerUnit,
      quantity: s.quantity,
    };
    const rough = s.intervalCv >= ROUGH_CADENCE_CV;
    return (
      <li
        key={s.key}
        className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2.5"
        data-testid="reorder-suggestion-row"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {s.itemName}
            </p>
            {s.due && (
              <span className="flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 border border-amber-200">
                Due
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {cadenceSentence(s)}
            {rough && (
              <span className="text-gray-400">
                {" "}
                Cadence is rough, treat as a loose estimate.
              </span>
            )}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {s.vendor ? `${s.vendor} · ` : ""}
            {s.orderCount} orders
            {s.pricePerUnit > 0 ? ` · $${s.pricePerUnit.toFixed(2)}/unit` : ""}
          </p>
        </div>
        <div className="flex-shrink-0 pt-0.5">
          <BuyAgainButton
            seed={seed}
            currentUser={currentUser}
            onDone={refresh}
          />
        </div>
      </li>
    );
  };

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <p className="text-xs text-gray-500">
        Computed from your purchase history. An item shows up here once you
        have ordered it at least three times and it is getting close to your
        usual reorder interval. Nothing is stored, this updates as you buy.
      </p>

      <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-3">
        {isLoading ? (
          <p className="text-sm text-gray-400 italic">Loading…</p>
        ) : suggestions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/40 px-4 py-6 text-center">
            <p className="text-sm font-medium text-gray-700">
              No reorder suggestions yet
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Once you have ordered the same item three or more times, we will
              estimate how often you buy it and flag when it is coming due.
            </p>
          </div>
        ) : (
          <>
            {due.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide font-semibold text-amber-700 mb-1.5">
                  Due now ({due.length})
                </p>
                <ul className="flex flex-col gap-1.5">{due.map(renderRow)}</ul>
              </div>
            )}
            {onTrack.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1.5">
                  On track ({onTrack.length})
                </p>
                <ul className="flex flex-col gap-1.5">
                  {onTrack.map(renderRow)}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Re-export for the Tool registry's canonical popup lookup. */
export const ExpandedView = ReorderSuggestionsWidget;

// ── Snapshot + Sidebar tiles (the at-a-glance count) ──────────────────────

export function SnapshotTile(_props: SnapshotTileProps) {
  const { suggestions, dueCount, isLoading } = useReorderSuggestions();
  const total = suggestions.length;

  const stat = isLoading ? "—" : dueCount;
  const sub = isLoading
    ? "Loading…"
    : total === 0
      ? "No recurring items yet"
      : dueCount === 0
        ? `${total} tracked · all on track`
        : `${dueCount} due of ${total} tracked`;

  return (
    <StatTile
      icon={REORDER_ICON}
      iconClassName={dueCount > 0 ? "text-amber-600" : "text-gray-400"}
      label="Reorder suggestions"
      stat={stat}
      sub={sub}
    />
  );
}

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { suggestions, dueCount, isLoading } = useReorderSuggestions();
  const total = suggestions.length;
  const stat = isLoading ? "—" : dueCount;
  const sub = isLoading
    ? "Loading…"
    : total === 0
      ? "No recurring items"
      : dueCount === 0
        ? "All on track"
        : `${dueCount} due`;

  return (
    <SidebarStatTile
      icon={REORDER_ICON_SM}
      iconClassName={dueCount > 0 ? "text-amber-600" : "text-gray-400"}
      label="Reorder"
      stat={stat}
      sub={sub}
      onClick={onClick}
    />
  );
}

/** Help-badge copy for the widget tile header. Member-visible widget. */
export const HELP_TEXT =
  "Items you reorder on a regular rhythm, flagged when they are coming due based on how often you have bought them. Click Buy again to drop a fresh needs-ordering line item into your purchases. Computed from your history, nothing is stored.";
