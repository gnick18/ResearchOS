"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { purchasesApi } from "@/lib/local-api";
import Tooltip from "@/components/Tooltip";
import {
  normalizeOrderStatus,
  PURCHASE_ORDER_STATUS_LABEL,
  type PurchaseItem,
  type PurchaseOrderStatus,
} from "@/lib/types";

interface PurchaseOrderStatusControlProps {
  item: PurchaseItem;
  /**
   * Username of the item owner (the requester). For the current user's own
   * purchases this is just the current user; for shared / lab-mode tasks the
   * caller passes the task owner so the write routes into the owner's folder
   * and the `purchase_ordered` bell lands on the right requester.
   */
  ownerUsername: string;
  /** Active user flipping the status. Stamped on the `purchase_ordered`
   *  bell that fires on the "needs_ordering" -> "ordered" transition. */
  currentUser: string;
  /** When true (lab read-only mode or shared-into-me) the control renders
   *  the status chip only, no advance / revert affordance. */
  readOnly?: boolean;
  /** Fires after a successful status change so the parent can refetch. */
  onChanged?: () => void;
}

// Visual styling per stage. Mirrors the existing chip vocabulary on the
// purchases surface (amber = pending-ish, blue = in-flight, green = done).
const STATUS_CHIP_CLASS: Record<PurchaseOrderStatus, string> = {
  needs_ordering: "bg-gray-100 text-gray-600 border-gray-200",
  ordered: "bg-blue-50 text-blue-700 border-blue-200",
  received: "bg-green-50 text-green-700 border-green-200",
};

// The linear advance / revert neighbors for each stage. The control surfaces
// at most one "advance" and one "back" action so the row stays compact.
const NEXT_STATUS: Partial<Record<PurchaseOrderStatus, PurchaseOrderStatus>> = {
  needs_ordering: "ordered",
  ordered: "received",
};
const PREV_STATUS: Partial<Record<PurchaseOrderStatus, PurchaseOrderStatus>> = {
  ordered: "needs_ordering",
  received: "ordered",
};

const ADVANCE_LABEL: Record<PurchaseOrderStatus, string> = {
  needs_ordering: "Mark ordered",
  ordered: "Mark received",
  received: "Mark received",
};
const REVERT_LABEL: Record<PurchaseOrderStatus, string> = {
  needs_ordering: "Move back",
  ordered: "Back to needs ordering",
  received: "Back to ordered",
};

/**
 * Per-line-item ordering-status control inside PurchaseEditor
 * (purchases-ordered-stage, 2026-05-29). Surfaces the real
 * "Needs ordering -> Ordered -> Received" stage as a colored chip plus
 * small forward / back arrows that call `purchasesApi.setOrderStatus`.
 *
 * The forward step into "Ordered" is the transition that fires the
 * `purchase_ordered` bell to the requester (when the item was handed off to
 * a different lab member) — replacing the old parent complete-toggle stopgap.
 * Available to any lab member, mirroring PurchaseAssigneePicker (not gated
 * behind a PI edit session).
 */
export default function PurchaseOrderStatusControl({
  item,
  ownerUsername,
  currentUser,
  readOnly = false,
  onChanged,
}: PurchaseOrderStatusControlProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const status = normalizeOrderStatus(item.order_status);
  const next = NEXT_STATUS[status];
  const prev = PREV_STATUS[status];

  const apply = async (target: PurchaseOrderStatus) => {
    setBusy(true);
    try {
      await purchasesApi.setOrderStatus(item.id, target, {
        // Omit `owner` for the current user's own items so the write stays
        // on the cheap current-user path; pass it for shared / lab-mode
        // items so it routes into the owner's folder.
        owner:
          ownerUsername && ownerUsername !== currentUser
            ? ownerUsername
            : undefined,
        actor: currentUser,
      });
      await queryClient.refetchQueries({ queryKey: ["purchases"] });
      await queryClient.refetchQueries({ queryKey: ["purchases-all"] });
      onChanged?.();
    } catch {
      alert("Failed to update ordering status");
    } finally {
      setBusy(false);
    }
  };

  const chip = (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border ${STATUS_CHIP_CLASS[status]}`}
      data-testid="purchase-order-status-chip"
      data-order-status={status}
    >
      <StatusIcon status={status} />
      {PURCHASE_ORDER_STATUS_LABEL[status]}
    </span>
  );

  if (readOnly) return chip;

  return (
    <div className="inline-flex items-center gap-1">
      {prev && (
        <Tooltip label={REVERT_LABEL[status]} placement="left">
          <button
            type="button"
            onClick={() => apply(prev)}
            disabled={busy}
            aria-label={REVERT_LABEL[status]}
            className="text-gray-300 hover:text-gray-600 disabled:opacity-40"
            data-testid="purchase-order-status-back"
          >
            <ChevronLeftIcon />
          </button>
        </Tooltip>
      )}
      {chip}
      {next && (
        <Tooltip label={ADVANCE_LABEL[status]} placement="right">
          <button
            type="button"
            onClick={() => apply(next)}
            disabled={busy}
            aria-label={ADVANCE_LABEL[status]}
            className="text-gray-300 hover:text-blue-600 disabled:opacity-40"
            data-testid="purchase-order-status-advance"
          >
            <ChevronRightIcon />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: PurchaseOrderStatus }) {
  if (status === "received") {
    // Check inside a box — the supply arrived.
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="11"
        height="11"
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
  if (status === "ordered") {
    // Package box — the order was placed.
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    );
  }
  // needs_ordering — a small cart, "still to buy".
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="11"
      height="11"
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
    </svg>
  );
}

function ChevronLeftIcon() {
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
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRightIcon() {
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
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
