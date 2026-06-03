"use client";

import { useState } from "react";
import LabHeadPasswordModal from "./LabHeadPasswordModal";
import Tooltip from "./Tooltip";

interface RequestEditButtonProps {
  /** The lab head requesting the unlock (i.e. the active app user, who
   *  must have `account_type === "lab_head"`). The caller is responsible
   *  for only rendering this button for lab heads. */
  username: string;
  /** Optional context label for the password modal — e.g.
   *  `"alex's task: Mini-prep DNA"`. */
  targetLabel?: string;
  /** Optional callback after a successful unlock. The popup that wraps
   *  this button uses it to force a re-render so write inputs go from
   *  read-only to editable. */
  onUnlocked?: () => void;
  /** Override the rendered button style. Defaults to the "subtle pill"
   *  used inside record popup headers. */
  variant?: "subtle" | "primary";
}

/**
 * Lab Head Phase 5 (lab head Phase 5 manager, 2026-05-23): the generic
 * Request-edit affordance.
 *
 * Renders a small button in the popup header. On click, opens
 * `LabHeadPasswordModal` which verifies the lab-head password and (on
 * success) starts the 5-minute edit session.
 *
 * Members (account_type !== "lab_head") should never see this button.
 * The caller enforces visibility — this component intentionally doesn't
 * read `account_type` itself, so it can also be used in surfaces that
 * already know they have a lab head context (e.g. a future "Request
 * edit on archived user's data" surface from Phase 6).
 */
export default function RequestEditButton({
  username,
  targetLabel,
  onUnlocked,
  variant = "subtle",
}: RequestEditButtonProps) {
  const [open, setOpen] = useState(false);

  const baseClasses =
    "inline-flex items-center gap-1.5 rounded-md text-meta font-medium transition-colors";
  const classes =
    variant === "primary"
      ? `${baseClasses} px-3 py-1.5 bg-amber-600 text-white hover:bg-amber-700`
      : `${baseClasses} px-2 py-1 border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100`;

  return (
    <>
      <Tooltip
        label="Unlock edit mode for this record. Requires your lab-head password. All changes are attributed to you."
        placement="bottom"
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={classes}
          data-tour-target="lab-head-request-edit"
          aria-label="Request edit mode"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Request edit
        </button>
      </Tooltip>

      {open && (
        <LabHeadPasswordModal
          username={username}
          targetLabel={targetLabel}
          onClose={() => setOpen(false)}
          onUnlocked={onUnlocked}
        />
      )}
    </>
  );
}
