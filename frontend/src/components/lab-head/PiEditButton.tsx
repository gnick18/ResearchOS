"use client";

import Tooltip from "@/components/Tooltip";

interface PiEditButtonProps {
  /** Owner of the record (the lab member), for the tooltip. */
  memberName: string | null;
  /** Opens the confirm dialog (gate.beginEdit). */
  onClick: () => void;
}

/**
 * PI capability revamp (2026-06-07): the affordance a lab head clicks to start
 * editing a member's record. It opens the once-per-session confirm. This
 * replaces the old "Request edit" + password button, there is no password.
 */
export default function PiEditButton({
  memberName,
  onClick,
}: PiEditButtonProps) {
  const who = memberName ?? "this member";
  return (
    <Tooltip
      label={`Edit ${who}'s record as lab head. Changes are logged to the audit trail.`}
      placement="bottom"
    >
      <button
        type="button"
        onClick={onClick}
        data-testid="pi-edit-button"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-meta font-medium rounded-full border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        Edit as lab head
      </button>
    </Tooltip>
  );
}
