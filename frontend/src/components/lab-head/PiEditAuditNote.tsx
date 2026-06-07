"use client";

import { Icon } from "@/components/icons";

interface PiEditAuditNoteProps {
  /** Owner of the record (the lab member). */
  memberName: string | null;
  className?: string;
}

/**
 * PI capability revamp (2026-06-07): the small inline note shown in a record
 * popup header while a lab head is editing a member's record. It keeps the
 * accountability visible (changes are attributed + logged) without any unlock
 * affordance, the edit is already permitted by the role.
 */
export default function PiEditAuditNote({
  memberName,
  className,
}: PiEditAuditNoteProps) {
  const who = memberName ?? "this member";
  return (
    <div
      data-testid="pi-edit-audit-note"
      className={`flex items-center gap-1.5 text-meta text-amber-700 dark:text-amber-300 ${className ?? ""}`}
    >
      <Icon name="file" className="w-3.5 h-3.5" />
      <span>
        Editing {who}&apos;s record as lab head. Changes are logged to the lab
        audit trail.
      </span>
    </div>
  );
}
