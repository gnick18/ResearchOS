"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clearFlagAsOwner } from "@/lib/lab/pi-actions";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import type { PiFlag } from "@/lib/types";

interface FlagBannerProps {
  flag: PiFlag;
  recordType: "task" | "note" | "purchase_item";
  recordId: number;
  /** Owner of the record. The owner alone can clear the flag (no
   *  password required — the owner is dismissing their own banner). */
  owner: string;
  /** Active user; if equal to `owner`, the "Clear flag" button shows. */
  activeUser: string | null;
  onCleared?: () => void;
}

/**
 * Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): the red-tinted
 * banner shown to the owner of a flagged record. Carries the PI's
 * username, optional reason, and a "Clear flag" button (owner-only, no
 * PI-session needed — the owner clearing their own attention flag is a
 * personal action).
 */
export default function FlagBanner({
  flag,
  recordType,
  recordId,
  owner,
  activeUser,
  onCleared,
}: FlagBannerProps) {
  const queryClient = useQueryClient();
  const profileMap = useLabUserProfileMap();
  const [busy, setBusy] = useState(false);

  const isOwner = activeUser === owner;
  const piProfile = profileMap[flag.by];
  const piName = piProfile?.displayName?.trim() || flag.by;
  // Mira Batch 1 polish (2026-05-23): badge the PI inline (same pattern
  // as CommentCell + announcements) so it's visually clear who set
  // the flag.
  const showLabHeadBadge = piProfile?.account_type === "lab_head";

  // Mira-Skeptic P0 compat migration (Mira-Skeptic P0 fix manager,
  // 2026-05-23): handles the new PiActionResult shape; see
  // AssignTaskButton.tsx for the full template. `clearFlagAsOwner` now
  // emits its own audit entry (P0 #2) which can itself fail.
  const handleClear = async () => {
    setBusy(true);
    try {
      const result = await clearFlagAsOwner({ owner, recordType, recordId });
      if (!result.ok && result.reason === "data-write") {
        console.error("[flag-banner] data write failed", result.error);
        const msg =
          result.error instanceof Error
            ? result.error.message
            : "Failed to clear flag.";
        alert(msg);
        return;
      }
      if (recordType === "task") {
        await queryClient.invalidateQueries({ queryKey: ["tasks"] });
        await queryClient.invalidateQueries({ queryKey: ["task"] });
      } else if (recordType === "note") {
        await queryClient.invalidateQueries({ queryKey: ["notes"] });
      } else {
        await queryClient.invalidateQueries({ queryKey: ["purchases"] });
        await queryClient.invalidateQueries({ queryKey: ["purchases-all"] });
      }
      onCleared?.();
      if (!result.ok && result.reason === "audit") {
        console.warn("[flag-banner] audit write failed", result.error);
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
    <div
      role="status"
      aria-live="polite"
      className="flex items-start justify-between gap-2 px-3 py-2 mb-3 rounded-lg border border-red-200 bg-red-50 text-red-900 text-xs"
      data-testid="lab-head-flag-banner"
    >
      <div className="flex items-start gap-2 min-w-0">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
          className="flex-shrink-0 mt-0.5"
        >
          <path d="M4 22V4a2 2 0 0 1 2-2h8l2 4h4v10h-6l-2-4H6v10" />
        </svg>
        <div className="min-w-0">
          <p className="font-medium flex items-center gap-1.5 flex-wrap">
            <span>{piName}</span>
            {showLabHeadBadge && (
              <span
                className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-800"
                title="PI"
              >
                PI
              </span>
            )}
            <span>flagged this for your review</span>
          </p>
          {flag.reason && (
            <p className="mt-0.5 text-red-800 whitespace-pre-wrap break-words">
              {flag.reason}
            </p>
          )}
          <p className="mt-0.5 text-red-700/80">
            Set {new Date(flag.at).toLocaleString()}.
          </p>
        </div>
      </div>
      {isOwner && (
        <button
          type="button"
          onClick={handleClear}
          disabled={busy}
          className="flex-shrink-0 px-2 py-1 rounded-md text-xs text-red-800 hover:bg-red-100 border border-red-300 disabled:opacity-50"
          data-testid="lab-head-flag-clear-owner"
        >
          {busy ? "Clearing…" : "Clear flag"}
        </button>
      )}
    </div>
  );
}
