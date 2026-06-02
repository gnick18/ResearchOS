// frontend/src/lib/notes/notebook-edit-permission.ts
//
// notebook-note-edit sub-bot of HR, 2026-06-02. The single predicate that
// carves a SHARED-NOTEBOOK note out of the lab-head edit-session read-only
// gate in NoteDetailPopup. Mirrors the shape of `delete-permission.ts` and
// `restore-permission.ts` so the note write gates read identically.
//
// Shared 1:1 notebooks (docs/proposals/SHARED_NOTEBOOKS_PROPOSAL.md) put a
// note in a notebook that is ALWAYS shared between exactly two members at
// EDIT level (both usernames in `shared_with` at level "edit", via
// `pairingSharedWith`). Grant locked "both can add AND edit": inside a
// notebook either member edits any note freely. The pair-shared-at-edit grant
// IS the authorization; it does NOT ride the lab-head PI-passcode unlock.
//
// Rule:
//   editable IFF the note carries a `notebook_id` AND the viewer `canWrite`
//   it under the unified sharing primitive WITHOUT the PI bypass.
//
// We pass `NEVER_UNLOCKED` into `canWrite` on purpose: the carve-out must be
// the EXPLICIT edit-level share entry (the pair grant), never a transient PI
// passcode session. The owner of the note trivially satisfies `canWrite`
// (owner always writes), so this also keeps a member's OWN notebook note
// editable through the same predicate.
//
// SCOPE: this returns `false` for any note that lacks a `notebook_id`, so an
// ordinary (non-notebook) shared note is untouched and keeps the existing
// lab-head edit-session / PI-unlock posture. The carve-out cannot leak.

import { canWrite, NEVER_UNLOCKED } from "@/lib/sharing/unified";
import type { SharedUser } from "@/lib/types";

export function canEditNotebookNote(params: {
  /** The note's `notebook_id`. Absent / empty = a personal note (no carve-out). */
  notebookId: string | null | undefined;
  /** The note owner (the creator / owner-folder routing target). */
  noteOwner: string | null | undefined;
  /** The signed-in viewer. */
  currentUser: string | null | undefined;
  /** The note's `shared_with` (both members at level "edit" for a notebook note). */
  sharedWith: SharedUser[] | null | undefined;
}): boolean {
  const { notebookId, noteOwner, currentUser, sharedWith } = params;
  // Carve-out applies ONLY to notebook notes.
  if (typeof notebookId !== "string" || notebookId.length === 0) return false;
  // A signed-in viewer is required (no editable view for a signed-out reader).
  if (!currentUser) return false;
  // The pair-sharing grant is the authorization. `NEVER_UNLOCKED` keeps the
  // PI passcode bypass out of this path: only the explicit edit-level share
  // entry (or being the owner) grants edit.
  return canWrite(
    { owner: noteOwner ?? "", shared_with: sharedWith ?? [] },
    { username: currentUser, account_type: "lab" },
    NEVER_UNLOCKED,
  );
}
