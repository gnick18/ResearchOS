"use client";

import { useCurrentUser } from "./useCurrentUser";
import { useAccountType } from "./useAccountType";
import { useEditSession } from "./useEditSession";

/**
 * Lab Head Phase 5 (lab head Phase 5 manager, 2026-05-23): single source
 * of truth for "should this read-only popup show the Request edit affordance
 * and, when unlocked, treat itself as writable?"
 *
 * Returned shape:
 *   - `isLabHead`: true iff the active user has `account_type === "lab_head"`.
 *   - `canRequestEdit`: true iff the popup is currently in lab-mode read-only
 *     (caller passes `readOnly`) AND the active user is a lab head AND the
 *     record is owned by some other user (or `recordOwner` is unset).
 *   - `unlocked`: true iff there's an unlocked session belonging to the
 *     active user AND `canRequestEdit` would be true (so a session for
 *     a different user doesn't accidentally elevate this popup).
 *   - `effectiveReadOnly`: the value the caller should ACTUALLY use for
 *     readOnly. Equal to the passed-in `readOnly` flag XOR an active
 *     unlock — i.e. `readOnly && !unlocked`. The original `readOnly`
 *     prop typically also covers "shared with view permission only,"
 *     which the session does NOT bypass; callers should preserve their
 *     existing share-permission checks alongside this hook.
 *   - `activeUser`: the active username (for audit attribution).
 *
 * The caller is responsible for actually rendering the Request edit
 * button + the timer banner. This hook is just the state.
 */
export function useLabHeadEditGate(args: {
  /** The `readOnly` prop passed into the popup. True for lab-mode views of
   *  another member's records. */
  readOnly: boolean;
  /** Owner of the record being viewed. When equal to the active user
   *  there's no edit-mode need (the user is editing their own data
   *  through the normal flow). */
  recordOwner?: string | null;
}) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const session = useEditSession();

  const isLabHead = accountType === "lab_head";
  const isOtherUser = !!args.recordOwner && !!currentUser && args.recordOwner !== currentUser;

  // Only PI viewing another member's record under lab-mode readOnly can
  // request edits. PI editing their OWN record uses the standard flow.
  const canRequestEdit = args.readOnly && isLabHead && isOtherUser;

  const unlocked =
    canRequestEdit &&
    session.state === "unlocked" &&
    session.active?.username === currentUser;

  const effectiveReadOnly = args.readOnly && !unlocked;

  return {
    isLabHead,
    canRequestEdit,
    unlocked,
    effectiveReadOnly,
    activeUser: currentUser,
    sessionId: session.active?.id ?? null,
  };
}
