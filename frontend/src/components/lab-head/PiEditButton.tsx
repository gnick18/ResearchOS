"use client";

import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";

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
        <Icon name="pencil" className="w-[13px] h-[13px]" />
        Edit as lab head
      </button>
    </Tooltip>
  );
}
