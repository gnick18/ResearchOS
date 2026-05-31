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
  const isOwner = isNoteOwnedByCurrentUser(currentUser, noteOwner);
  return isOwner || labHeadUnlocked;
}

/**
 * VC Phase 2 (vc-entry-history sub-bot of HR, 2026-05-30): resolve note
 * ownership for the restore gate.
 *
 * The primary owner check is `currentUser === noteOwner`. But notes created
 * before this fix carry `username: ""` (notesApi.create used to leave the
 * author field empty), so `currentUser === ""` was false and the owner could
 * not restore their OWN note. An empty / null `noteOwner` means an
 * unattributed note, and the store only ever surfaces such a note from the
 * CURRENT user's own folder (the popup reaches this path only for the viewer's
 * own note; a PI cross-owner view always carries the member's NON-EMPTY
 * username as `noteOwner`). So an empty owner resolves to "owned by the current
 * user," which restores the affordance for legacy own-notes WITHOUT weakening
 * the PI gate: a PI viewing a member note has a non-empty mismatched owner here
 * and still falls through to requiring `labHeadUnlocked`.
 *
 * Guard: requires a signed-in `currentUser`, so a read-only / signed-out view
 * of an empty-owner note does not spuriously resolve to owned.
 */
export function isNoteOwnedByCurrentUser(
  currentUser: string | null | undefined,
  noteOwner: string | null | undefined,
): boolean {
  if (!currentUser) return false;
  if (!noteOwner) return true;
  return currentUser === noteOwner;
}
