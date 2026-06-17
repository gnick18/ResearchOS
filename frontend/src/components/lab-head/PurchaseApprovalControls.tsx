"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setPurchaseApproval } from "@/lib/lab/pi-actions";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import Tooltip from "@/components/Tooltip";
import type { PurchaseItem } from "@/lib/types";

interface PurchaseApprovalToggleProps {
  item: PurchaseItem;
  /** Lab head's username (audit actor). */
  actor: string;
  targetOwner: string;
  /** Fires after the write lands so the editor can refresh local state. */
  onChanged?: () => void;
}

/**
 * Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): the "Approve"
 * toggle a lab head sees on a purchase item owned by another member.
 * Toggling writes through `pi-actions.setPurchaseApproval`, which:
 *   - flips `approved` + stamps `approved_by` + `approved_at`
 *   - appends a `_pi_audit.json` entry on the owner
 *   - posts a `lab_purchase_approval` bell notif to the owner
 */
export function PurchaseApprovalToggle({
  item,
  actor,
  targetOwner,
  onChanged,
}: PurchaseApprovalToggleProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  // inFlightRef guards against rapid double-clicks that fire before React
  // re-renders with busy=true (ref mutation is synchronous, state is not).
  const inFlightRef = useRef(false);
  const isApproved = !!item.approved;

  // Mira-Skeptic P0 compat migration (Mira-Skeptic P0 fix manager,
  // 2026-05-23): handles the new PiActionResult shape; see
  // AssignTaskButton.tsx for the full template.
  const handleToggle = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    try {
      const result = await setPurchaseApproval({
        actor,
        targetOwner,
        purchaseItemId: item.id,
        approved: !isApproved,
        itemName: item.item_name,
      });
      if (!result.ok && result.reason === "data-write") {
        console.error("[purchase-approval] data write failed", result.error);
        const msg =
          result.error instanceof Error
            ? result.error.message
            : "Failed to update approval. See console.";
        alert(msg);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["purchases"] });
      await queryClient.invalidateQueries({ queryKey: ["purchases-all"] });
      onChanged?.();
      if (!result.ok && result.reason === "audit") {
        console.warn("[purchase-approval] audit write failed", result.error);
        alert(
          "Approval status was updated, but the audit log entry could not be written. " +
            "The record reflects the new state, but this change won't appear in the audit history.",
        );
      }
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Tooltip
      label={
        isApproved
          ? `Approved by you. Click to revert to pending.`
          : `Mark this purchase as approved. The owner sees a green badge.`
      }
      placement="bottom"
    >
      <button
        type="button"
        onClick={handleToggle}
        disabled={busy}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-meta font-medium ${
          isApproved
            ? "bg-green-100 dark:bg-green-500/15 text-green-800 dark:text-green-300 border border-green-300 dark:border-green-500/30 hover:bg-green-200"
            : "bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200"
        }`}
        data-testid="lab-head-purchase-approval-toggle"
      >
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
          <polyline points="20 6 9 17 4 12" />
        </svg>
        {isApproved ? "Approved" : "Approve"}
      </button>
    </Tooltip>
  );
}

/**
 * Compact green "Lab Head Approved" badge for lists and read-only views.
 * Shows who approved + when when hovered.
 */
export function PurchaseApprovalBadge({ item }: { item: PurchaseItem }) {
  const profileMap = useLabUserProfileMap();
  if (!item.approved) return null;
  const approverLabel =
    item.approved_by
      ? profileMap[item.approved_by]?.displayName?.trim() || item.approved_by
      : "the PI";
  const when = item.approved_at
    ? new Date(item.approved_at).toLocaleString()
    : null;
  return (
    <Tooltip
      label={`Approved by ${approverLabel}${when ? ` on ${when}` : ""}`}
      placement="top"
    >
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-meta font-semibold bg-green-100 dark:bg-green-500/15 text-green-800 dark:text-green-300 border border-green-300 dark:border-green-500/30"
        data-testid="lab-head-purchase-approved-badge"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        PI Approved
      </span>
    </Tooltip>
  );
}

/**
 * Compact red "Declined" badge for lists and read-only views, parallel to
 * `PurchaseApprovalBadge`. PurchaseDeclinedBadge polish manager (2026-05-23):
 * surfaces persisted decline state (`declined_at` + `declined_by`, landed
 * in commit `07a1b7b3`) anywhere the approval badge is rendered. The two
 * pills are mutually exclusive: `setPurchaseApproval` clears the decline
 * stamps on approve, and `declinePurchase` clears `approved` on decline,
 * so an item is always exactly one of pending / approved / declined.
 * Shows who declined + when on hover, mirroring the approval badge.
 */
export function PurchaseDeclinedBadge({ item }: { item: PurchaseItem }) {
  const profileMap = useLabUserProfileMap();
  if (!item.declined_at) return null;
  const declinerLabel =
    item.declined_by
      ? profileMap[item.declined_by]?.displayName?.trim() || item.declined_by
      : "the PI";
  const when = item.declined_at
    ? new Date(item.declined_at).toLocaleString()
    : null;
  return (
    <Tooltip
      label={`Declined by ${declinerLabel}${when ? ` on ${when}` : ""}`}
      placement="top"
    >
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-meta font-semibold bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-500/30"
        data-testid="lab-head-purchase-declined-badge"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
        Declined
      </span>
    </Tooltip>
  );
}
