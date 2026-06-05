/**
 * Loro version restore: write a past version back into the live doc as a
 * FORWARD commit, never a destructive rewind. History keeps moving forward;
 * the sidecar grows a new commit on top.
 *
 * Two public functions:
 *   restoreLoroVersion  -- restore targetVersion as a forward commit
 *   undoLoroRestore     -- reverse a prior restore (also a forward commit),
 *                          clears the revert_undo_window on the result
 *
 * React-free: no hooks, no JSX, no client-only imports.
 */

import { listVersions, reconstructNoteAt } from "./history";
import {
  syncEntrySet,
  setEntryContent,
  syncNoteMetadataToDoc,
  listEntries,
} from "./note-doc";
import { persistNote } from "./sidecar-store";
import type { NoteHandle } from "./store";
import type { Note, RevertUndoWindow } from "@/lib/types";

// ---------------------------------------------------------------------------
// restoreLoroVersion
// ---------------------------------------------------------------------------

/**
 * Restore a past version of a note by applying its content to the live doc as
 * a FORWARD commit (restore-is-a-forward-commit-not-a-rewind: the live
 * history continues growing; the sidecar gains a new commit on top of HEAD
 * rather than truncating or rewinding to the target version).
 *
 * Steps:
 *   1. Compute the pre-restore HEAD index (for the undo window's from_version).
 *   2. Reconstruct the note state at targetVersion (read-only clone, no live touch).
 *   3. Apply the reconstructed state to handle.doc:
 *      a. syncEntrySet aligns which entries exist in the live doc to the target
 *         (handles entries added or removed since the target).
 *      b. For each restored entry, find its position in the live doc and call
 *         setEntryContent so existing entries get the target's content.
 *      c. syncNoteMetadataToDoc restores title, description, is_running_log,
 *         and per-entry title/date.
 *   4. Commit the combined changes FORWARD with message "restore-vN".
 *   5. Build the result Note with the 24h revert_undo_window stamped.
 *   6. Persist the sidecar + mirror (persistNote writes both).
 *   7. Return the result so the caller updates React state.
 */
export async function restoreLoroVersion(
  handle: NoteHandle,
  owner: string,
  base: Note,
  targetVersion: number,
  revertedBy: string,
): Promise<Note> {
  // Step 1: capture the pre-restore HEAD index BEFORE anything changes.
  const versions = await listVersions(owner, base);
  const headVersion = versions.length - 1;

  // Step 2: reconstruct the note state at the target (throwaway clone, safe).
  const restored = await reconstructNoteAt(owner, base, targetVersion);

  // Step 3a: align the entry SET in the live doc to the target.
  // syncEntrySet handles additions (new entries are seeded with their content)
  // and removals (entries that did not exist at the target are deleted).
  syncEntrySet(handle.doc, restored);

  // Step 3b: overwrite content of every entry that exists in the restored note.
  // We look up each restored entry by its id in the LIVE doc (the set is now
  // aligned from step 3a) so we use the correct live index, not the
  // reconstructed-doc index (which may differ if entries were reordered).
  const liveEntries = listEntries(handle.doc);
  for (const restoredEntry of restored.entries) {
    const liveIndex = liveEntries.findIndex((e) => e.id === restoredEntry.id);
    if (liveIndex !== -1) {
      setEntryContent(handle.doc, liveIndex, restoredEntry.content);
    }
  }

  // Step 3c: restore note-level and per-entry metadata (title, description,
  // is_running_log, per-entry title/date).
  syncNoteMetadataToDoc(handle.doc, restored);

  // Step 4: commit FORWARD with a restore message. This is the load-bearing
  // forward-commit: the history file gains a new commit that records this
  // restore without truncating or rewinding to the target.
  handle.doc.commit({ message: `restore-v${targetVersion}` });

  // Step 5: build the result note with the 24h undo window stamped.
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const undoWindow: RevertUndoWindow = {
    from_version: headVersion,
    to_version: targetVersion,
    reverted_at: nowIso,
    expires_at: expiresIso,
    reverted_by: revertedBy,
  };

  const result: Note = {
    ...restored,
    id: base.id,
    revert_undo_window: undoWindow,
  };

  // Step 6: write the sidecar (authoritative CRDT) then the readable mirror.
  // persistNote writes sidecar-before-mirror so a crash mid-write leaves the
  // CRDT on disk and the mirror can be re-projected from it.
  await persistNote(owner, handle.doc, result);

  // Step 7: return so the caller can update React state.
  return result;
}

// ---------------------------------------------------------------------------
// undoLoroRestore
// ---------------------------------------------------------------------------

/**
 * Undo a prior restore by restoring back to fromVersion as another FORWARD
 * commit, then clearing the revert_undo_window on the result.
 *
 * The undo is itself a forward commit (the doc keeps growing forward). The
 * caller is responsible for checking that the undo window is still active
 * before calling this.
 */
export async function undoLoroRestore(
  handle: NoteHandle,
  owner: string,
  base: Note,
  fromVersion: number,
  revertedBy: string,
): Promise<Note> {
  // Restore back to fromVersion (the pre-restore HEAD). This is a full restore,
  // so it produces a forward commit and stamps a new undo window internally.
  const intermediate = await restoreLoroVersion(
    handle,
    owner,
    base,
    fromVersion,
    revertedBy,
  );

  // Clear the revert_undo_window: the undo is complete, there is nothing left
  // to undo from. Persist the cleared window to the sidecar + mirror.
  // Cast to satisfy Note's typed field (Note uses `RevertUndoWindow | undefined`
  // but null is the runtime sentinel for "cleared"; projectToNote preserves it).
  const result: Note = { ...intermediate, revert_undo_window: undefined };
  await persistNote(owner, handle.doc, result);

  return result;
}
