// frontend/src/lib/notes/delete-permission.ts
//
// delete-affordances bot, 2026-05-29. The single predicate that gates the
// note Delete affordance in NoteDetailPopup. Both the header trash icon
// (the discoverable fix) and the legacy footer "Delete Note" text button
// read from this so they can never drift apart.
//
// Rule (unchanged from the footer's original VCP R1 OQ9 gate):
//   show Delete IFF the popup is not read-only AND
//   (the viewer owns the note OR a PI Phase 5 edit session is unlocked).
//
// A shared-edit receiver (who is not the owner and has no PI unlock) never
// sees Delete — their writes go through the unwrapped notesApi.update but
// they cannot destroy another member's note.
//
// VC Phase 2 (vc-entry-history sub-bot of HR, 2026-05-30): the owner check
// shares `isNoteOwnedByCurrentUser` with the restore gate so the two write
// gates read identically (the project invariant) and both handle legacy
// empty-username own-notes. An empty / null `noteOwner` resolves to the
// current user (the popup only ever reaches this for the viewer's own note);
// a PI cross-owner view carries the member's non-empty username so it still
// requires the PI unlock.

import { isNoteOwnedByCurrentUser } from "./restore-permission";

export function canDeleteNoteFromPopup(params: {
  readOnly: boolean;
  currentUser: string | null | undefined;
  noteOwner: string | null | undefined;
  labHeadUnlocked: boolean;
}): boolean {
  const { readOnly, currentUser, noteOwner, labHeadUnlocked } = params;
  if (readOnly) return false;
  const isOwner = isNoteOwnedByCurrentUser(currentUser, noteOwner);
  return isOwner || labHeadUnlocked;
}
