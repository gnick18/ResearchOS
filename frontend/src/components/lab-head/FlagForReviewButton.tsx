"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setFlagForReview } from "@/lib/lab/pi-actions";
import Tooltip from "@/components/Tooltip";
import type { PiFlag } from "@/lib/types";

interface FlagForReviewButtonProps {
  recordType: "task" | "note" | "purchase_item";
  recordId: number;
  recordName: string;
  /** Username of the record owner. */
  targetOwner: string;
  /** PI's username (audit actor). */
  actor: string;
  sessionId: string;
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
  sessionId,
  currentFlag,
  onFlagged,
}: FlagForReviewButtonProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(currentFlag?.reason ?? "");
  const [busy, setBusy] = useState(false);

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
        sessionId,
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
        sessionId,
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
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${
            isFlagged
              ? "border border-red-300 bg-red-50 text-red-800 hover:bg-red-100"
              : "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
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

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h3 className="text-base font-semibold text-gray-900">
                {isFlagged ? "Update flag" : "Flag for review"}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5 break-words">
                {recordName}
              </p>
            </header>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Reason (optional)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
                placeholder="e.g. Let's chat about this in our 1:1."
                className="w-full min-h-[80px] text-sm rounded-md border border-gray-300 px-2 py-1.5 focus:ring-2 focus:ring-amber-500"
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
                    className="px-3 py-1.5 rounded-md text-xs text-gray-600 hover:bg-gray-100 border border-gray-200"
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
                  className="px-3 py-1.5 rounded-md text-xs text-gray-600 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSet}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:bg-gray-300"
                  data-testid="lab-head-flag-set"
                >
                  {busy ? "Saving…" : isFlagged ? "Update" : "Flag"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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
