"use client";

import { useCallback, useMemo, useState } from "react";
import { useCurrentUser } from "./useCurrentUser";
import { useAccountType } from "./useAccountType";
import {
  type ShareableRecord,
  canWriteIgnoringPiRole,
} from "@/lib/sharing/unified";
import {
  isPiEditConfirmed,
  markPiEditConfirmed,
  piEditKey,
} from "@/lib/lab/pi-edit-guard";

/**
 * PI capability revamp (2026-06-07): the per-record gate a lab head crosses
 * before editing a MEMBER's record. There is no password and no session, just a
 * single once-per-session are-you-sure that prevents accidental edits.
 *
 * The hook decides whether this is a "PI editing a member's record purely on
 * the role" situation. It is NOT when the PI owns the record or holds an
 * explicit edit-share (those edit like anyone, no confirm). When it IS, the
 * popup should treat the record as read-only until `confirmEdit` runs, then
 * edit freely for the rest of the session.
 *
 * Usage in a record popup:
 *   const gate = usePiEditGate({ record: note, recordType: "note", recordId: note.id, propReadOnly });
 *   // render inputs with gate.effectiveReadOnly
 *   // when gate.isPiEdit && !gate.confirmed, show an "Edit as lab head" button -> gate.beginEdit()
 *   // render <PiEditConfirmDialog open={gate.confirmDialogOpen} ... onConfirm={gate.confirmEdit} onCancel={gate.cancelEdit} />
 *   // while editing, show <PiEditAuditNote owner={gate.targetOwner} /> if gate.isPiEdit
 */
export function usePiEditGate(args: {
  record: ShareableRecord | null | undefined;
  recordType: "note" | "task" | "purchase";
  recordId: number | string;
  /** The read-only flag the popup would otherwise use (share-permission based). */
  propReadOnly: boolean;
}) {
  const { record, recordType, recordId, propReadOnly } = args;
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);

  const targetOwner = record?.owner ?? null;

  // "PI editing a member's record on the role alone": active user is a lab head,
  // the record belongs to someone else, and they could NOT write it without the
  // role (not owner, no explicit edit-share). Only then do we gate + audit.
  const isPiEdit = useMemo(() => {
    if (accountType !== "lab_head") return false;
    if (!record || !currentUser) return false;
    if (!targetOwner || targetOwner === currentUser) return false;
    return !canWriteIgnoringPiRole(record, {
      username: currentUser,
      account_type: "lab_head",
    });
  }, [accountType, record, currentUser, targetOwner]);

  const key = useMemo(
    () => (targetOwner ? piEditKey(targetOwner, recordType, recordId) : null),
    [targetOwner, recordType, recordId],
  );

  // Local mirror of the session store so a confirm re-renders this popup.
  const [confirmedTick, setConfirmedTick] = useState(0);
  const confirmed = useMemo(() => {
    void confirmedTick; // re-evaluate after a confirm
    return key ? isPiEditConfirmed(key) : false;
  }, [key, confirmedTick]);

  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  const beginEdit = useCallback(() => {
    if (!isPiEdit) return;
    if (confirmed) return;
    setConfirmDialogOpen(true);
  }, [isPiEdit, confirmed]);

  const confirmEdit = useCallback(() => {
    if (key) markPiEditConfirmed(key);
    setConfirmedTick((t) => t + 1);
    setConfirmDialogOpen(false);
  }, [key]);

  const cancelEdit = useCallback(() => setConfirmDialogOpen(false), []);

  // The popup uses this as its readOnly. A PI on a member record stays read-only
  // until they confirm; everything else is just the passed-in flag.
  const effectiveReadOnly = isPiEdit ? propReadOnly || !confirmed : propReadOnly;

  return {
    isPiEdit,
    confirmed,
    effectiveReadOnly,
    targetOwner,
    confirmDialogOpen,
    beginEdit,
    confirmEdit,
    cancelEdit,
  };
}
