"use client";

import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";

interface PiEditConfirmDialogProps {
  open: boolean;
  /** Owner of the record being edited (the lab member). */
  memberName: string | null;
  /** Short label for the record, e.g. "task Mini-prep DNA" or "note". */
  recordLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * PI capability revamp (2026-06-07): the once-per-session are-you-sure a lab
 * head crosses before editing a member's record. It replaces the old password
 * modal, there is no password and no session, just one confirmation that stops
 * an accidental edit. After the PI confirms, that record edits freely for the
 * rest of the session (the gate is remembered by `pi-edit-guard`).
 */
export default function PiEditConfirmDialog({
  open,
  memberName,
  recordLabel,
  onConfirm,
  onCancel,
}: PiEditConfirmDialogProps) {
  const who = memberName ?? "this member";
  const what = recordLabel ? ` ${recordLabel}` : " record";
  return (
    <LivingPopup
      open={open}
      onClose={onCancel}
      label="Edit as lab head"
      widthClassName="max-w-md"
      padded
      closeOnScrimClick={false}
    >
      <div data-testid="pi-edit-confirm-dialog" className="space-y-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 text-amber-600 dark:text-amber-400"
          >
            <Icon name="alert" className="w-[22px] h-[22px]" />
          </span>
          <div>
            <h3 className="text-heading font-semibold text-foreground">
              Edit {who}&apos;s record?
            </h3>
            <p className="text-meta text-muted-foreground mt-1 leading-relaxed">
              You are about to edit {who}&apos;s{what} as the lab head. Your
              changes save to their folder and are logged to the lab audit
              trail. You will not be asked again for this record this session.
            </p>
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-body rounded-lg border border-border bg-surface text-foreground hover:bg-surface-raised"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="pi-edit-confirm-button"
            className="ros-btn-raise px-4 py-2 text-body font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700"
          >
            Edit as lab head
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}
