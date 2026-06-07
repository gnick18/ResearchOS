// Owner-scoped wrapper around `notesApi` mutations.
//
// Peer editing inside a shared notebook (notebook-note-edit sub-bot of HR,
// 2026-06-02): when the viewer holds an explicit edit-level share on another
// member's notebook note, mutations route to THAT owner's folder so the change
// lands where the owner reads it. Plain own-note edits pass no peer owner and
// fall through to the unwrapped notesApi (current user's folder).
//
// Lives here (not inside NoteDetailPopup) so the shape matches the tasks
// wrapper and any future popup-internal component can import it without
// pulling in the popup itself.
//
// The old PI edit-session / audited soft-write branch was removed with the
// PI edit-mode feature; a lab head now edits only records they own or that
// are shared with them at edit permission, same as any other user.

import { notesApi as rawNotesApi } from "@/lib/local-api";
import type { NoteUpdate } from "@/lib/local-api";
import type { HistoryEditKind } from "@/lib/history";

/**
 * Args for the wrapper. `notebookPeerOwner` is the note-owner folder for a
 * PEER edit inside a shared notebook (both members hold an explicit edit-level
 * share via `pairingSharedWith`, so either may edit the other's notebook note).
 * When set, mutations route to that owner's folder so the change lands where
 * the owner reads it. Absent / unset = the unchanged current-user-folder
 * behavior.
 */
export interface OwnerScopedNotesArgs {
  notebookPeerOwner?: string | null | undefined;
}

/**
 * Build an owner-scoped `notesApi`. Returns the same shape as the underlying
 * `notesApi` (so consumers don't change call sites) but with each mutation
 * routed to the notebook peer owner's folder when one is supplied.
 */
export function ownerScopedNotesApi(args: OwnerScopedNotesArgs) {
  const { notebookPeerOwner } = args;
  // Empty string is treated as "no peer owner" so an own-note (peerOwner ===
  // currentUser falls out at the caller) or a missing owner never misroutes.
  const peerOwner =
    typeof notebookPeerOwner === "string" && notebookPeerOwner.length > 0
      ? notebookPeerOwner
      : undefined;
  return {
    ...rawNotesApi,
    // VC Phase 2 (FLAG-5): the wrapper exposes the SAME 3-arg
    // (id, data, historyMeta) update shape so NoteDetailPopup can call
    // `notesApi.update(id, payload, historyMeta)` unconditionally. The raw API
    // takes (id, data, owner, historyMeta); here `owner` is the notebook peer
    // owner (or undefined = current-user folder), and historyMeta forwards
    // through. Without this shim a 3-arg call would bind historyMeta to the raw
    // `owner` param and silently misroute.
    update: (
      id: number,
      data: NoteUpdate,
      historyMeta: {
        kind: HistoryEditKind;
        revert_target_version?: number;
      } = { kind: "update" },
    ) => rawNotesApi.update(id, data, peerOwner, historyMeta),
    get: peerOwner
      ? (id: number, owner?: string) => rawNotesApi.get(id, owner ?? peerOwner)
      : rawNotesApi.get,
    addEntry: peerOwner
      ? (
          noteId: number,
          data: { title: string; date: string; content?: string },
        ) => rawNotesApi.addEntry(noteId, data, peerOwner)
      : rawNotesApi.addEntry,
    updateEntry: peerOwner
      ? (
          noteId: number,
          entryId: string,
          data: { title?: string; date?: string; content?: string },
        ) => rawNotesApi.updateEntry(noteId, entryId, data, peerOwner)
      : rawNotesApi.updateEntry,
    deleteEntry: peerOwner
      ? (noteId: number, entryId: string) =>
          rawNotesApi.deleteEntry(noteId, entryId, peerOwner)
      : rawNotesApi.deleteEntry,
  };
}
