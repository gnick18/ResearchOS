"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sharedNotebooksApi, labApi } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import Tooltip from "@/components/Tooltip";
import UserAvatar from "@/components/UserAvatar";
import NoteCard from "@/components/NoteCard";
import NoteDetailPopup from "@/components/NoteDetailPopup";
import { Icon } from "@/components/icons";
import type { Note, SharedNotebook } from "@/lib/types";

// Shared Notebooks view (notebooks-phase2 sub-bot, 2026-06-02; stripped to a
// notes-only container by the oneonone data+strip bot, 2026-06-07). See
// docs/proposals/NOTEBOOKS_AND_ONE_ON_ONE_REVAMP.md.
//
// A notebook is a PLAIN shared NOTE container now. The weekly-task + meeting
// machinery that used to live here moved to the distinct 1:1 surface
// (`oneOnOnesApi`). This view renders the notebook's NOTES
// (`labApi.getNotebookNotes`, across every member's folder) under a members
// chip; both members can add and edit any note.
//
// NOTE EDITING: BOTH members can add AND edit any note in the notebook. A
// member's OWN notebook notes open fully editable (writes route to their own
// folder). The OTHER member's notebook notes open read-only here (we pass
// `readOnly={!noteIsMine}`); NoteDetailPopup relaxes that for notebook notes the
// viewer can write (the pair-shared-at-edit grant IS the authorization).

const notebookKeys = {
  notes: (id: string) => ["notebook", id, "notes"] as const,
};

interface SharedNotebookViewProps {
  notebook: SharedNotebook;
}

export default function SharedNotebookView({ notebook }: SharedNotebookViewProps) {
  const queryClient = useQueryClient();
  const { currentUser } = useCurrentUser();
  const me = currentUser ?? "";

  // The other member is whichever of the two `members` is not the current user.
  // Falls back to members[1] when the viewer is somehow not in the pair so the
  // chip is never blank.
  const otherMember = useMemo(
    () => notebook.members.find((m) => m !== me) ?? notebook.members[1],
    [notebook.members, me],
  );

  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: notes = [], isLoading: notesLoading } = useQuery<Note[]>({
    queryKey: notebookKeys.notes(notebook.id),
    queryFn: () => labApi.getNotebookNotes(notebook.id),
  });

  const sortedNotes = useMemo(
    () =>
      [...notes].sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      ),
    [notes],
  );

  const refreshNotes = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: notebookKeys.notes(notebook.id),
      }),
    [queryClient, notebook.id],
  );

  const handleAddNote = useCallback(
    async (isRunningLog: boolean) => {
      if (busy) return;
      setBusy(true);
      const today = new Date().toISOString().split("T")[0];
      try {
        const created = await sharedNotebooksApi.createNote({
          notebookId: notebook.id,
          title: isRunningLog ? "New Running Log" : "New Note",
          is_running_log: isRunningLog,
          // Running-log notes start with no entries so the user names the first
          // entry via "Add Entry" like every later entry. Single notes keep
          // their one implicit entry.
          entries: isRunningLog
            ? []
            : [
                {
                  title: "Note",
                  date: today,
                },
              ],
        });
        await refreshNotes();
        setSelectedNote(created);
      } catch (err) {
        console.error("Failed to add notebook note:", err);
        alert("Failed to create note. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [busy, notebook.id, refreshNotes],
  );

  // A note opens editable only when the viewer owns it; the other member's
  // notes open read-only (cross-owner body edits are out of scope this phase).
  const noteIsMine = selectedNote
    ? (selectedNote.username ?? "") === me
    : false;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Members chip */}
      <div
        className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-4 py-2.5"
        data-testid="notebook-shared-banner"
      >
        <span aria-hidden="true" className="text-sky-500">
          <Icon name="users" className="h-4 w-4" />
        </span>
        <UserAvatar username={otherMember} size="sm" />
        <p className="text-body text-foreground">
          Shared with{" "}
          <span className="font-semibold">{otherMember}</span>. Every note here
          is visible to both of you.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto pb-2">
        {/* Notes */}
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-body font-semibold text-foreground">Notes</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleAddNote(false)}
                disabled={busy}
                data-testid="notebook-add-note"
                className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-body font-medium disabled:opacity-40"
              >
                <Icon name="plus" className="h-4 w-4" />
                Note
              </button>
              <button
                type="button"
                onClick={() => void handleAddNote(true)}
                disabled={busy}
                data-testid="notebook-add-running-log"
                className="ros-btn-neutral flex items-center gap-1.5 px-3 py-1.5 text-body font-medium text-foreground-muted disabled:opacity-40"
              >
                <Icon name="plus" className="h-4 w-4" />
                Running log
              </button>
            </div>
          </div>

          {notesLoading ? (
            <p className="text-body italic text-foreground-muted">Loading notes…</p>
          ) : sortedNotes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface-sunken/40 px-4 py-6 text-center">
              <p className="text-body font-medium text-foreground">No notes yet</p>
              <p className="mt-1 text-meta text-foreground-muted">
                Add a note to start this shared notebook.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {sortedNotes.map((note) => (
                <NoteCard
                  key={`${note.username}:${note.id}`}
                  note={note}
                  onClick={() => setSelectedNote(note)}
                  // Surface authorship + lock cross-owner cards like lab mode.
                  isLabMode={(note.username ?? "") !== me}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {selectedNote && (
        <NoteDetailPopup
          note={selectedNote}
          onClose={() => setSelectedNote(null)}
          onUpdate={(updated) => {
            setSelectedNote(updated);
            void refreshNotes();
          }}
          onDelete={() => {
            setSelectedNote(null);
            void refreshNotes();
          }}
          // The other member's notes open read-only; your own are editable.
          readOnly={!noteIsMine}
        />
      )}
    </div>
  );
}
