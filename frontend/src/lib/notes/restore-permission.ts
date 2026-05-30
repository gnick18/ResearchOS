// frontend/src/lib/notes/restore-permission.ts
//
// VC Phase 2 (restore-a-version sub-bot of HR, 2026-05-30). The single
// predicate that gates the note Restore + Undo-restore affordances in
// NoteVersionHistorySidebar / NoteDetailPopup. Mirrors the shape of
// `delete-permission.ts` so the two write-gates read identically.
//
// Three-way PI gate (design doc "PI gate"):
//   - Owner (currentUser === noteOwner), not read-only -> CAN restore.
//   - PI with an unlocked Phase 5 edit session -> CAN restore (routes to the
//     owner folder + emits audit via ownerScopedNotesApi automatically).
//   - PI viewing WITHOUT an unlock, or a read-only shared viewer -> CANNOT.
//
// The caller renders the affordance DISABLED (with an unlock Tooltip) for a PI
// who could unlock, and HIDDEN for a read-only shared viewer. Both map to a
// `false` return here; the disabled-vs-hidden distinction is a UI concern the
// caller derives from `labHeadCanRequestEdit`.

export function canRestoreNoteVersion(params: {
  /** The popup's EFFECTIVE read-only flag (lab-head gate OR history-open). */
  readOnly: boolean;
  currentUser: string | null | undefined;
  noteOwner: string | null | undefined;
  /** True when a PI Phase 5 edit session is unlocked for this note. */
  labHeadUnlocked: boolean;
}): boolean {
  const { readOnly, currentUser, noteOwner, labHeadUnlocked } = params;
  if (readOnly) return false;
  const isOwner = !!currentUser && currentUser === noteOwner;
  return isOwner || labHeadUnlocked;
}
