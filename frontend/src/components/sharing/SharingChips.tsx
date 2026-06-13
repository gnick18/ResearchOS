"use client";

// Lab Mode retirement R1 (R1 unified sharing manager, 2026-05-23): a
// read-only chip row showing who currently has access to a record.
// Sits near the top of record-detail popups (TaskDetailPopup,
// NoteDetailPopup, PurchaseEditor, etc.) so the viewer can see at a
// glance who else is on this record.
//
// Companion to ShareDialog: ShareDialog is the WRITER; SharingChips
// is the READER. Both consume the same SharedUser[] shape.

import { useMemo } from "react";
import type { SharedUser } from "@/lib/types";
import {
  WHOLE_LAB_SENTINEL,
  normalizeSharedWith,
} from "@/lib/sharing/unified";

export interface SharingChipsProps {
  /** The record's `shared_with` array. */
  sharedWith: SharedUser[];
  /** Owner username — rendered as "you" if it matches viewerUsername. */
  ownerUsername: string;
  /** Optional current viewer — when set + === ownerUsername the owner
   *  chip swaps to "you". */
  viewerUsername?: string;
  /** Optional click handler — fires the Share dialog. */
  onShareClick?: () => void;
  /** Hide the empty-state "only you" hint. Defaults to false. */
  hideWhenEmpty?: boolean;
  /** Optional extra class names for the outer container. */
  className?: string;
}

export default function SharingChips({
  sharedWith,
  ownerUsername,
  viewerUsername,
  onShareClick,
  hideWhenEmpty = false,
  className = "",
}: SharingChipsProps) {
  const normalized = useMemo(
    () => normalizeSharedWith(sharedWith),
    [sharedWith],
  );

  const isEmpty = normalized.length === 0;
  if (isEmpty && hideWhenEmpty && !onShareClick) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 text-meta ${className}`}
      data-tour-target="sharing-chips"
    >
      {/* Owner chip. Dark mode fills the chip solid with white text (Grant's
          ask) so it reads as a vibrant tag, not a faint tint. */}
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-slate-600 dark:text-white">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-500 dark:bg-slate-300" />
        {ownerUsername === viewerUsername ? "you" : `@${ownerUsername}`}
        <span className="text-gray-400 dark:text-white/70">(owner)</span>
      </span>

      {/* One chip per shared entry. Dark = filled solid + white text. */}
      {normalized.map((s) => (
        <span
          key={s.username}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${
            s.username === WHOLE_LAB_SENTINEL
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-600 dark:text-white"
              : s.level === "edit"
              ? "bg-blue-50 text-blue-700 dark:bg-brand-action dark:text-white"
              : "bg-slate-50 text-slate-700 dark:bg-slate-600 dark:text-white"
          }`}
        >
          {s.username === WHOLE_LAB_SENTINEL
            ? "Whole lab"
            : `@${s.username}`}
          <span className="text-meta opacity-75">
            {s.level === "edit" ? "edit" : "read"}
          </span>
        </span>
      ))}

      {isEmpty && !hideWhenEmpty && (
        <span className="text-gray-400 dark:text-slate-400 italic">private</span>
      )}

      {onShareClick && (
        <button
          type="button"
          onClick={onShareClick}
          className="ml-1 px-2 py-0.5 rounded-full bg-brand-action text-white hover:bg-brand-action/90 text-meta font-medium"
          data-tour-target="sharing-chips-share-button"
        >
          Share…
        </button>
      )}
    </div>
  );
}
