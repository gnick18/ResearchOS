"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setPurchaseApproval } from "@/lib/lab/pi-actions";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import Tooltip from "@/components/Tooltip";
import type { PurchaseItem } from "@/lib/types";

interface PurchaseApprovalToggleProps {
  item: PurchaseItem;
  /** PI's username (audit actor). */
  actor: string;
  sessionId: string;
  targetOwner: string;
  /** Fires after the write lands so the editor can refresh local state. */
  onChanged?: () => void;
}

/**
 * Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): the "Approve"
 * toggle visible only when the PI's edit-mode session is active for a
 * purchase item owned by someone else. Toggling writes through
 * `pi-actions.setPurchaseApproval`, which:
 *   - flips `approved` + stamps `approved_by` + `approved_at`
 *   - appends a `_pi_audit.json` entry on the owner
 *   - posts a `lab_purchase_approval` bell notif to the owner
 */
export function PurchaseApprovalToggle({
  item,
  actor,
  sessionId,
  targetOwner,
  onChanged,
}: PurchaseApprovalToggleProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const isApproved = !!item.approved;

  const handleToggle = async () => {
    setBusy(true);
    try {
      await setPurchaseApproval({
        actor,
        sessionId,
        targetOwner,
        purchaseItemId: item.id,
        approved: !isApproved,
        itemName: item.item_name,
      });
      await queryClient.invalidateQueries({ queryKey: ["purchases"] });
      await queryClient.invalidateQueries({ queryKey: ["purchases-all"] });
      onChanged?.();
    } catch (err) {
      console.error("[purchase-approval] toggle failed", err);
      alert("Failed to update approval. See console.");
    } finally {
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
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${
          isApproved
            ? "bg-green-100 text-green-800 border border-green-300 hover:bg-green-200"
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
 * Compact green "PI Approved" badge for lists and read-only views. Shows
 * who approved + when when hovered.
 */
export function PurchaseApprovalBadge({ item }: { item: PurchaseItem }) {
  const profileMap = useLabUserProfileMap();
  if (!item.approved) return null;
  const approverLabel =
    item.approved_by
      ? profileMap[item.approved_by]?.displayName?.trim() || item.approved_by
      : "the lab head";
  const when = item.approved_at
    ? new Date(item.approved_at).toLocaleString()
    : null;
  return (
    <Tooltip
      label={`Approved by ${approverLabel}${when ? ` on ${when}` : ""}`}
      placement="top"
    >
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-green-100 text-green-800 border border-green-300"
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
