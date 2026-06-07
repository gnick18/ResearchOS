"use client";

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
      <span aria-hidden>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M9 15h6" />
        </svg>
      </span>
      <span>
        Editing {who}&apos;s record as lab head. Changes are logged to the lab
        audit trail.
      </span>
    </div>
  );
}
