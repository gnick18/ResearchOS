"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setFlagForReview } from "@/lib/lab/pi-actions";
import Tooltip from "@/components/Tooltip";
import LivingPopup from "@/components/ui/LivingPopup";
import type { PiFlag } from "@/lib/types";

interface FlagForReviewButtonProps {
  recordType: "task" | "note" | "purchase_item";
  recordId: number;
  recordName: string;
  /** Username of the record owner. */
  targetOwner: string;
  /** Lab head's username (audit actor). */
  actor: string;
  /** Current flag state (passed in by the popup that owns the record). */
  currentFlag: PiFlag | null;
  /** Fires after the flag write lands so the popup can refresh. */
  onFlagged?: (next: PiFlag | null) => void;
}

/**
 * Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): "Flag for
 * review" button. Visible only when the popup's lab-head gate is
 * unlocked. Click opens a small modal with optional reason text.
 *
 * Persistence: writes via `pi-actions.setFlagForReview` which routes
 * the update to the owner's folder + emits an audit entry + notifies
 * the owner.
 */
export default function FlagForReviewButton({
  recordType,
  recordId,
  recordName,
  targetOwner,
  actor,
  currentFlag,
  onFlagged,
}: FlagForReviewButtonProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(currentFlag?.reason ?? "");
  const [busy, setBusy] = useState(false);

  // Escape / scrim close route through LivingPopup, suspended while a write is
  // in flight (busy) so a mid-write click cannot dismiss the modal.
  const closeIfIdle = () => {
    if (!busy) setOpen(false);
  };

  const isFlagged = !!currentFlag;

  // Mira-Skeptic P0 compat migration (Mira-Skeptic P0 fix manager,
  // 2026-05-23): see AssignTaskButton.tsx for the full template. This
  // surface uses the minimal-touch shape: data-write failures surface
  // the existing alert; audit failures emit a separate non-blocking
  // alert + still invalidate + close so the UI reflects the data write
  // that DID land.
  const handleSet = async () => {
    setBusy(true);
    try {
      const next: PiFlag = {
        by: actor,
        at: new Date().toISOString(),
        reason: reason.trim() || null,
      };
      const result = await setFlagForReview({
        actor,
        targetOwner,
        recordType,
        recordId,
        flag: next,
        recordName,
      });
      if (!result.ok && result.reason === "data-write") {
        console.error("[flag-for-review] data write failed", result.error);
        const msg =
          result.error instanceof Error
            ? result.error.message
            : "Failed to flag record. See console for details.";
        alert(msg);
        return;
      }
      await invalidateForRecord(queryClient, recordType);
      setOpen(false);
      onFlagged?.(next);
      if (!result.ok && result.reason === "audit") {
        console.warn("[flag-for-review] audit write failed", result.error);
        alert(
          "Flag was set, but the audit log entry could not be written. " +
            "The record reflects the new flag, but this change won't appear in the audit history.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    try {
      const result = await setFlagForReview({
        actor,
        targetOwner,
        recordType,
        recordId,
        flag: null,
        recordName,
      });
      if (!result.ok && result.reason === "data-write") {
        console.error("[flag-for-review] data write failed", result.error);
        const msg =
          result.error instanceof Error
            ? result.error.message
            : "Failed to clear flag.";
        alert(msg);
        return;
      }
      await invalidateForRecord(queryClient, recordType);
      setOpen(false);
      onFlagged?.(null);
      if (!result.ok && result.reason === "audit") {
        console.warn("[flag-for-review] audit write failed", result.error);
        alert(
          "Flag was cleared, but the audit log entry could not be written. " +
            "The record reflects the cleared flag, but this change won't appear in the audit history.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip
        label={
          isFlagged
            ? "This record is flagged for review. Click to update or clear."
            : "Flag this record for the owner's attention"
        }
        placement="bottom"
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-meta font-medium ${
            isFlagged
              ? "border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 text-red-800 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-500/20"
              : "border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20"
          }`}
          data-testid="lab-head-flag-button"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill={isFlagged ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 22V4a2 2 0 0 1 2-2h8l2 4h4v10h-6l-2-4H6v10" />
          </svg>
          {isFlagged ? "Flagged" : "Flag for review"}
        </button>
      </Tooltip>

      <LivingPopup
        open={open}
        onClose={closeIfIdle}
        label="Flag for review"
        card={false}
        widthClassName="max-w-md"
        closeOnScrimClick={!busy}
      >
          <div
            className="pointer-events-auto bg-surface-raised rounded-xl ros-popup-card-shadow w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h3 className="text-title font-semibold text-foreground">
                {isFlagged ? "Update flag" : "Flag for review"}
              </h3>
              <p className="text-meta text-foreground-muted mt-0.5 break-words">
                {recordName}
              </p>
            </header>

            <div>
              <label className="block text-meta font-medium text-foreground mb-1">
                Reason (optional)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
                placeholder="e.g. Let's chat about this in our 1:1."
                className="w-full min-h-[80px] text-body rounded-md border border-border px-2 py-1.5 focus:ring-2 focus:ring-amber-500"
                data-testid="lab-head-flag-reason"
              />
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <div>
                {isFlagged && (
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={busy}
                    className="ros-btn-neutral px-3 py-1.5 text-meta text-foreground-muted"
                    data-testid="lab-head-flag-clear"
                  >
                    Clear flag
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-md text-meta text-foreground-muted hover:bg-surface-sunken"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSet}
                  disabled={busy}
                  className="ros-btn-raise px-3 py-1.5 rounded-md bg-amber-600 text-white text-meta font-medium hover:bg-amber-700 disabled:bg-gray-300"
                  data-testid="lab-head-flag-set"
                >
                  {busy ? "Saving…" : isFlagged ? "Update" : "Flag"}
                </button>
              </div>
            </div>
          </div>
      </LivingPopup>
    </>
  );
}

async function invalidateForRecord(
  queryClient: ReturnType<typeof useQueryClient>,
  recordType: "task" | "note" | "purchase_item",
): Promise<void> {
  if (recordType === "task") {
    await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    await queryClient.invalidateQueries({ queryKey: ["task"] });
    await queryClient.invalidateQueries({ queryKey: ["lab", "tasks"] });
  } else if (recordType === "note") {
    await queryClient.invalidateQueries({ queryKey: ["notes"] });
    await queryClient.invalidateQueries({ queryKey: ["lab", "notes-shared"] });
  } else {
    await queryClient.invalidateQueries({ queryKey: ["purchases"] });
    await queryClient.invalidateQueries({ queryKey: ["purchases-all"] });
  }
}
