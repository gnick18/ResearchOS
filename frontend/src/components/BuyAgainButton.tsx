"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Tooltip from "@/components/Tooltip";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  createReorderPurchase,
  seedFromPurchaseItem,
} from "@/lib/purchases/reorder-actions";
import type { PurchaseItem } from "@/lib/types";

/**
 * One-click "Buy again" affordance (reorder-loop sub-bot, 2026-05-31).
 *
 * Feature 2 of the reorder loop. On a RECEIVED purchase line item, a single
 * click creates a NEW purchase order (parent task + line item) copying the
 * reagent's name / vendor / cas / link / price / quantity, starting in
 * `order_status: "needs_ordering"` so it re-enters the normal
 * needs-ordering -> approval -> ordered pipeline. No form, no typing.
 *
 * ZERO data-shape change: the write goes through the shared
 * `createReorderPurchase` action (existing tasksApi + purchasesApi create).
 *
 * The reorder routes to the SAME project as the source item's parent task
 * when known (`projectId`), otherwise the per-user Miscellaneous bucket.
 * After a successful create the button shows a brief "Added" confirmation
 * and calls `onDone` so the caller can refetch.
 */
export default function BuyAgainButton({
  item,
  projectId,
  onDone,
  size = "icon",
}: {
  /** The received PurchaseItem to clone. */
  item: PurchaseItem;
  /** Destination project (the source item's parent task project). When
   *  omitted / null the reorder routes to the Miscellaneous bucket. */
  projectId?: number | null;
  /** Fires after a successful reorder so the caller can refetch lists. */
  onDone?: () => void;
  /** "icon" = compact icon-only button (default, for dense table rows);
   *  "label" = icon + "Buy again" text. */
  size?: "icon" | "label";
}) {
  const queryClient = useQueryClient();
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    // Stop the row's click-to-edit handler from firing underneath.
    e.stopPropagation();
    if (busy || done) return;
    setBusy(true);
    try {
      await createReorderPurchase(seedFromPurchaseItem(item), {
        projectId: projectId ?? undefined,
        currentUser,
      });
      // Refresh the surfaces the /purchases page + editor read so the new
      // order appears without a manual reload.
      void queryClient.invalidateQueries({ queryKey: ["purchases-all"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDone(true);
      onDone?.();
      // Reset the confirmation after a moment so the row stays reusable
      // (e.g. a user reorders, then reorders again later in the session).
      window.setTimeout(() => setDone(false), 2500);
    } catch {
      alert("Failed to create the reorder. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <span
        className="inline-flex items-center gap-1 text-meta font-medium text-emerald-600"
        data-testid="buy-again-done"
      >
        <CheckIcon />
        {size === "label" ? "Added" : ""}
      </span>
    );
  }

  const label = `Buy "${item.item_name}" again`;

  return (
    <Tooltip label="Buy again (new needs-ordering item)" placement="left">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-label={label}
        data-testid="buy-again-button"
        className={
          size === "label"
            ? "inline-flex items-center gap-1 px-2 py-1 text-meta font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            : "inline-flex items-center justify-center text-gray-400 hover:text-amber-600 transition-colors disabled:opacity-40"
        }
      >
        <ReorderCartIcon />
        {size === "label" && <span>{busy ? "Adding…" : "Buy again"}</span>}
      </button>
    </Tooltip>
  );
}

function ReorderCartIcon() {
  // Cart with a recurring-arrow hint - "order this again".
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
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
}

function CheckIcon() {
  return (
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
  );
}
