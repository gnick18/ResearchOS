"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { purchasesApi } from "@/lib/local-api";
import { useLabData } from "@/hooks/useLabData";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { useArchivedUsers } from "@/hooks/useArchivedUsers";
import Tooltip from "@/components/Tooltip";
import type { PurchaseItem } from "@/lib/types";

interface PurchaseAssigneePickerProps {
  item: PurchaseItem;
  /**
   * Username of the item owner (the requester). For the current user's own
   * purchases this is just the current user; for shared / lab-mode tasks
   * the caller passes the task owner so the write routes into the owner's
   * folder.
   */
  ownerUsername: string;
  /** Active user doing the assigning. Stamped on the assignment bell. */
  currentUser: string;
  /** When true (lab read-only mode or shared-into-me) the picker renders
   *  the chip only, no edit affordance. */
  readOnly?: boolean;
  /** Fires after a successful assign / unassign so the parent can refetch. */
  onAssigned?: () => void;
}

/**
 * Lab-manager ordering workflow (purchases-assignee fix, 2026-05-29):
 * per-line-item assignee control inside PurchaseEditor. Mirrors the
 * task-assignee chip + picker (TaskDetailPopup / AssignTaskButton) but is
 * available to any lab member (not gated behind a PI edit session): a
 * trainee hands an order off to whoever will actually buy it.
 *
 * Renders:
 *   - the "assigned to X" emerald chip when `assigned_to` is set and
 *     differs from the owner (matches Task.assignee chip styling)
 *   - a small "Assign" / "Reassign" trigger that opens a member dropdown
 *
 * Assigning a member OTHER than the requester posts a `purchase_assignment`
 * bell to the assignee via `purchasesApi.assign`.
 */
export default function PurchaseAssigneePicker({
  item,
  ownerUsername,
  currentUser,
  readOnly = false,
  onAssigned,
}: PurchaseAssigneePickerProps) {
  const queryClient = useQueryClient();
  const { users } = useLabData();
  const profileMap = useLabUserProfileMap();
  const archivedSet = useArchivedUsers();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const assignee = item.assigned_to ?? null;
  // The chip surfaces only when the order was handed off to someone other
  // than the requester (mirrors Task.assignee !== owner gate).
  const showChip = !!assignee && assignee !== ownerUsername;
  const assigneeLabel = assignee
    ? profileMap[assignee]?.displayName?.trim() || assignee
    : null;
  const assigneeIsArchived = !!assignee && archivedSet.has(assignee);

  const handlePick = async (value: string | null) => {
    setBusy(true);
    try {
      await purchasesApi.assign(item.id, value, {
        // Omit `owner` when the item belongs to the current user so the
        // write stays on the cheap current-user path; pass it for shared
        // / lab-mode items so it routes into the owner's folder.
        owner: ownerUsername && ownerUsername !== currentUser ? ownerUsername : undefined,
        actor: currentUser,
      });
      await queryClient.refetchQueries({ queryKey: ["purchases"] });
      await queryClient.refetchQueries({ queryKey: ["purchases-all"] });
      setOpen(false);
      onAssigned?.();
    } catch {
      alert("Failed to update assignee");
    } finally {
      setBusy(false);
    }
  };

  // Read-only contexts (lab mode, shared-into-me): chip only, no edit.
  if (readOnly) {
    if (!showChip) return <span className="text-gray-300 text-meta">—</span>;
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-meta font-medium border border-emerald-200"
        data-testid="purchase-assignee-chip"
      >
        <AssigneeIcon />
        {assigneeLabel}
        {assigneeIsArchived ? " (archived)" : ""}
      </span>
    );
  }

  return (
    <div
      className="relative"
      // Stop the row's click-to-edit handler from firing when the user
      // interacts with the picker.
      onClick={(e) => e.stopPropagation()}
    >
      {showChip ? (
        <Tooltip
          label={
            assigneeIsArchived
              ? `Assigned to ${assignee} (archived). Click to reassign.`
              : `Assigned to ${assignee}. Click to reassign.`
          }
          placement="left"
        >
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            disabled={busy}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-meta font-medium border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
            data-testid="purchase-assignee-chip"
          >
            <AssigneeIcon />
            {assigneeLabel}
            {assigneeIsArchived ? " (archived)" : ""}
          </button>
        </Tooltip>
      ) : (
        <Tooltip label="Assign this item to a lab member to order" placement="left">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            disabled={busy}
            className="inline-flex items-center gap-1 text-meta text-gray-400 hover:text-emerald-700 disabled:opacity-50"
            data-testid="purchase-assignee-trigger"
          >
            <AssigneeIcon />
            Assign
          </button>
        </Tooltip>
      )}

      {open && (
        <div
          className="absolute z-20 mt-1 right-0 w-52 bg-white border border-gray-200 rounded-lg shadow-lg p-1"
          data-testid="purchase-assignee-menu"
        >
          {/* Unassign option, only when something is set. */}
          {assignee && (
            <button
              type="button"
              onClick={() => handlePick(null)}
              disabled={busy}
              className="w-full text-left px-2 py-1.5 text-meta text-gray-600 rounded hover:bg-gray-100 disabled:opacity-50"
            >
              Unassign
            </button>
          )}
          {users
            .filter((u) => !archivedSet.has(u.username))
            // No self-assign: handing an order to yourself is a no-op and
            // would only spam your own bell.
            .filter((u) => u.username !== currentUser)
            .map((u) => {
              const label = profileMap[u.username]?.displayName?.trim() || u.username;
              const isCurrent = u.username === assignee;
              return (
                <button
                  key={u.username}
                  type="button"
                  onClick={() => handlePick(u.username)}
                  disabled={busy}
                  className={`w-full text-left px-2 py-1.5 text-meta rounded hover:bg-emerald-50 disabled:opacity-50 ${
                    isCurrent ? "bg-emerald-50 text-emerald-800 font-medium" : "text-gray-700"
                  }`}
                >
                  {label}{" "}
                  <span className="text-gray-400">({u.username})</span>
                </button>
              );
            })}
          {users.filter(
            (u) => !archivedSet.has(u.username) && u.username !== currentUser,
          ).length === 0 && (
            <p className="px-2 py-1.5 text-meta text-gray-400">
              No other lab members to assign.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AssigneeIcon() {
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
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  );
}
