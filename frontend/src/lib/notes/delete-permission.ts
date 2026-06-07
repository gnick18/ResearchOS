// frontend/src/lib/notes/delete-permission.ts
//
// delete-affordances bot, 2026-05-29. The single predicate that gates the
// note Delete affordance in NoteDetailPopup. Both the header trash icon
// (the discoverable fix) and the legacy footer "Delete Note" text button
// read from this so they can never drift apart.
//
// Rule:
//   show Delete IFF the popup is not read-only AND the viewer owns the note.
//
// A shared-edit receiver (who is not the owner) never sees Delete — their
// writes go through the unwrapped notesApi.update but they cannot destroy
// another member's note. The old PI Phase 5 edit-session unlock path was
// removed with the PI edit-mode feature.
//
// VC Phase 2 (vc-entry-history sub-bot of HR, 2026-05-30): the owner check
// shares `isNoteOwnedByCurrentUser` with the restore gate so the two write
// gates read identically and both handle legacy empty-username own-notes.

import { isNoteOwnedByCurrentUser } from "./restore-permission";

export function canDeleteNoteFromPopup(params: {
  readOnly: boolean;
  currentUser: string | null | undefined;
  noteOwner: string | null | undefined;
}): boolean {
  const { readOnly, currentUser, noteOwner } = params;
  if (readOnly) return false;
  return isNoteOwnedByCurrentUser(currentUser, noteOwner);
}
