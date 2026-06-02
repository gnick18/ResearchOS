"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notesApi, labApi } from "@/lib/local-api";
import type { Note, NoteCreate, LabNote, SharedNotebook } from "@/lib/types";
import NoteCard from "./NoteCard";
import NoteDetailPopup from "./NoteDetailPopup";
import { emitNoteDeleted } from "@/lib/notes/delete-toast-bus";
import SharedNotebookView from "./notebooks/SharedNotebookView";
import StartSharedNotebookDialog from "./notebooks/StartSharedNotebookDialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface NotesPanelProps {
  // If true, this is in Lab Mode and should show all users' shared notes
  isLabMode?: boolean;
  // For Lab Mode: filter by specific usernames
  selectedUsernames?: Set<string>;
  // For Lab Mode: user colors for display
  userColors?: Record<string, string>;
  // Shared Notebooks Phase 4 (notebooks-phase4-widget sub-bot, 2026-06-02):
  // a notebook id to pre-select on mount, used when the Shared Notebook home/
  // dashboard widget deep-links here (`/workbench?tab=notes&notebook=<id>`).
  // Absent / null = the default Personal section. The id only seeds the INITIAL
  // selection; the user can switch away freely afterward.
  initialNotebookId?: string | null;
}

export default function NotesPanel({
  isLabMode = false,
  selectedUsernames,
  initialNotebookId = null,
}: NotesPanelProps) {
  const queryClient = useQueryClient();
  const { currentUser } = useCurrentUser();
  const [selectedNote, setSelectedNote] = useState<Note | LabNote | null>(null);
  const [showNewNoteDropdown, setShowNewNoteDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "single" | "running">("all");

  // Shared Notebooks Phase 2 (notebooks-phase2 sub-bot, 2026-06-02). The Notes
  // tab becomes NOTEBOOK-AWARE: a switcher section lists "Personal" (today's
  // notes, unchanged) plus every shared 1:1 notebook the viewer is in. The
  // switcher + the shared-notebook view are PERSONAL-mode only; Lab Mode keeps
  // the existing shared-notes browser untouched.
  // `null` = the Personal section (default); a notebook id = that notebook's
  // shared view. Phase 4: seed from `initialNotebookId` so a deep-link from the
  // Shared Notebook widget lands on the chosen notebook. The id is resolved
  // against the LIVE list below, so a stale / no-longer-shared id harmlessly
  // falls back to Personal.
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(
    initialNotebookId,
  );
  const [showStartDialog, setShowStartDialog] = useState(false);

  const { data: sharedNotebooks = [] } = useQuery<SharedNotebook[]>({
    queryKey: ["shared-notebooks", "mine"],
    queryFn: () => labApi.getSharedNotebooks(),
    enabled: !isLabMode,
  });

  // Resolve the selected notebook from the LIVE list. If the stored id no
  // longer matches a notebook the viewer is in (e.g. the other member deleted
  // it, or the list has not loaded yet), this is simply `null`, so the view
  // falls back to Personal without any setState-in-effect churn. The stale id
  // stays in state harmlessly and re-resolves if the notebook reappears.
  const activeNotebook =
    activeNotebookId !== null
      ? (sharedNotebooks.find((n) => n.id === activeNotebookId) ?? null)
      : null;

  // Fetch notes based on mode
  const { data: notes = [], isLoading, error } = useQuery({
    queryKey: isLabMode ? ["lab-notes", selectedUsernames] : ["notes"],
    queryFn: isLabMode
      ? () => labApi.getNotes({
          usernames: selectedUsernames ? Array.from(selectedUsernames).join(",") : undefined,
          shared_only: true
        })
      : () => notesApi.list(),
  });

  // Create note mutation
  const createNoteMutation = useMutation({
    mutationFn: (data: NoteCreate) => notesApi.create(data),
    onSuccess: (newNote) => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      setSelectedNote(newNote);
      setShowNewNoteDropdown(false);
    },
    onError: (error) => {
      console.error("Failed to create note:", error);
      alert("Failed to create note. Please try again.");
    },
  });

  // Update note mutation. Sharing toggles affect lab-mode caches too, so
  // bust those (activity feed, per-user dashboard) in addition to the
  // regular notes lists.
  const updateNoteMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<NoteCreate> }) =>
      notesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["lab-notes"] });
      queryClient.invalidateQueries({ queryKey: ["lab", "notes-shared"] });
      queryClient.invalidateQueries({ queryKey: ["lab", "notes"] });
    },
  });

  // Delete note mutation
  const deleteNoteMutation = useMutation({
    mutationFn: (id: number) => notesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["lab-notes"] });
      queryClient.invalidateQueries({ queryKey: ["lab", "notes-shared"] });
      queryClient.invalidateQueries({ queryKey: ["lab", "notes"] });
    },
  });

  // Handle creating a new note
  const handleCreateNote = useCallback((isRunningLog: boolean) => {
    const today = new Date().toISOString().split("T")[0];
    const defaultTitle = isRunningLog ? "New Running Log" : "New Note";
    
    createNoteMutation.mutate({
      title: defaultTitle,
      description: "",
      is_running_log: isRunningLog,
      is_shared: false,
      entries: [
        {
          title: isRunningLog ? `Entry - ${today}` : "Note",
          date: today,
          content: "",
        },
      ],
    });
  }, [createNoteMutation]);

  // Handle note update
  const handleNoteUpdate = useCallback((updatedNote: Note) => {
    updateNoteMutation.mutate({ id: updatedNote.id, data: updatedNote });
    setSelectedNote(updatedNote);
  }, [updateNoteMutation]);

  // Handle note delete. Bug 3 (lab head UX polish manager, 2026-05-24):
  // `notesApi.delete` is now a soft-delete (file moves to
  // `users/<owner>/notes_trash/`). We pop a 10s "Undo" toast so the
  // user can restore the note from the trash directory without
  // touching disk by hand.
  const handleNoteDelete = useCallback((noteId: number) => {
    const note = notes.find((n) => n.id === noteId);
    const title = note?.title ?? "";
    // The user field on the lab-notes wrapper is `username`; fall back
    // to undefined so notesApi.delete uses the current viewer.
    const owner =
      (note && "username" in note ? (note as { username?: string }).username : undefined) ||
      undefined;
    deleteNoteMutation.mutate(noteId, {
      onSuccess: () => {
        emitNoteDeleted({
          noteId,
          noteTitle: title,
          owner,
          onRestored: () => {
            queryClient.invalidateQueries({ queryKey: ["notes"] });
            queryClient.invalidateQueries({ queryKey: ["lab-notes"] });
            queryClient.invalidateQueries({ queryKey: ["lab", "notes-shared"] });
            queryClient.invalidateQueries({ queryKey: ["lab", "notes"] });
          },
        });
      },
    });
    if (selectedNote?.id === noteId) {
      setSelectedNote(null);
    }
  }, [deleteNoteMutation, selectedNote, notes, queryClient]);

  // Filter notes based on search and type
  const filteredNotes = notes.filter((note) => {
    // Type filter
    if (filterType === "single" && note.is_running_log) return false;
    if (filterType === "running" && !note.is_running_log) return false;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const titleMatch = note.title.toLowerCase().includes(query);
      const descMatch = note.description?.toLowerCase().includes(query);
      const entryMatch = note.entries.some(
        (e) =>
          e.title.toLowerCase().includes(query) ||
          e.content.toLowerCase().includes(query)
      );
      if (!titleMatch && !descMatch && !entryMatch) return false;
    }

    return true;
  });

  // Sort notes by updated_at (most recent first)
  const sortedNotes = [...filteredNotes].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showNewNoteDropdown) {
        const target = event.target as HTMLElement;
        if (!target.closest(".new-note-dropdown")) {
          setShowNewNoteDropdown(false);
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showNewNoteDropdown]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 mb-4">Failed to load notes</p>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ["notes"] })}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
        >
          Retry
        </button>
      </div>
    );
  }

  // The notebook switcher: "Personal" + one chip per shared notebook + a
  // "Start a shared notebook" action. Personal-mode only (Lab Mode renders the
  // existing shared-notes browser, no switcher).
  const notebookSwitcher = !isLabMode ? (
    <div
      className="flex flex-wrap items-center gap-2 mb-4"
      data-testid="notebook-switcher"
    >
      <button
        type="button"
        onClick={() => setActiveNotebookId(null)}
        aria-pressed={activeNotebook === null}
        data-testid="notebook-switch-personal"
        className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
          activeNotebook === null
            ? "bg-emerald-100 text-emerald-700"
            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
        }`}
      >
        Personal
      </button>
      {sharedNotebooks.map((nb) => {
        const partner =
          nb.members.find((m) => m !== currentUser) ?? nb.members[1];
        const label = nb.title?.trim() ? nb.title : `1:1 with ${partner}`;
        const isActive = activeNotebook?.id === nb.id;
        return (
          <button
            key={nb.id}
            type="button"
            onClick={() => setActiveNotebookId(nb.id)}
            aria-pressed={isActive}
            data-testid={`notebook-switch-${nb.id}`}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors max-w-[220px] truncate ${
              isActive
                ? "bg-sky-100 text-sky-700"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setShowStartDialog(true)}
        data-testid="notebook-start-button"
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-dashed border-gray-300 text-gray-600 hover:border-sky-400 hover:text-sky-600 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Start a shared notebook
      </button>
    </div>
  ) : null;

  const startDialog =
    !isLabMode && showStartDialog ? (
      <StartSharedNotebookDialog
        existingPartners={
          new Set(
            sharedNotebooks
              .map((nb) => nb.members.find((m) => m !== currentUser))
              .filter((m): m is string => Boolean(m)),
          )
        }
        onClose={() => setShowStartDialog(false)}
        onCreated={(nb) => {
          setShowStartDialog(false);
          queryClient.invalidateQueries({
            queryKey: ["shared-notebooks", "mine"],
          });
          setActiveNotebookId(nb.id);
        }}
      />
    ) : null;

  // When a shared notebook is selected, render the switcher + its dedicated
  // view in place of the personal notes list. Personal stays byte-for-byte
  // unchanged.
  if (!isLabMode && activeNotebook) {
    return (
      <div className="h-full flex flex-col">
        {notebookSwitcher}
        <div className="flex-1 min-h-0">
          <SharedNotebookView notebook={activeNotebook} />
        </div>
        {startDialog}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {notebookSwitcher}
      {/* Header with search and filters */}
      <div className="flex items-center justify-between mb-4 gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notes..."
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-emerald-500 text-sm"
          />
        </div>

        {/* Filter buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterType("all")}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              filterType === "all"
                ? "bg-emerald-100 text-emerald-700"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilterType("single")}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              filterType === "single"
                ? "bg-blue-100 text-blue-700"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Single
          </button>
          <button
            onClick={() => setFilterType("running")}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              filterType === "running"
                ? "bg-purple-100 text-purple-700"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Running Logs
          </button>
        </div>

        {/* New note button (not in Lab Mode) */}
        {!isLabMode && (
          <div className="relative new-note-dropdown">
            <button
              onClick={() => setShowNewNoteDropdown(!showNewNoteDropdown)}
              data-tour-target="workbench-new-note-button"
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-2 text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Note
            </button>

            {showNewNoteDropdown && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[180px]">
                <button
                  onClick={() => handleCreateNote(false)}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <div className="w-6 h-6 rounded bg-blue-100 flex items-center justify-center">
                    <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium">Single Note</p>
                    <p className="text-xs text-gray-400">One-time meeting notes</p>
                  </div>
                </button>
                <button
                  onClick={() => handleCreateNote(true)}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <div className="w-6 h-6 rounded bg-purple-100 flex items-center justify-center">
                    <svg className="w-3 h-3 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium">Running Log</p>
                    <p className="text-xs text-gray-400">Multiple timestamped entries</p>
                  </div>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Notes grid */}
      {sortedNotes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-gray-500 mb-2">
              {searchQuery || filterType !== "all"
                ? "No notes match your filters"
                : isLabMode
                ? "No shared notes found"
                : "No notes yet"}
            </p>
            {!isLabMode && !searchQuery && filterType === "all" && (
              <p className="text-sm text-gray-400 mb-4">
                Create your first note to get started
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sortedNotes.map((note, idx) => (
            <NoteCard
              key={`${note.username}:${note.id}`}
              note={note}
              onClick={() => setSelectedNote(note)}
              isLabMode={isLabMode}
              tourTarget={
                // Lab Mode fix manager R1 (2026-05-22): the
                // lab-mode-notes cursor demo clicks the first card.
                // Only stamp in lab mode so the tour target doesn't
                // leak into the per-user /notes page.
                isLabMode && idx === 0
                  ? "lab-mode-notes-first-card"
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {/* Note Detail Popup */}
      {selectedNote && (
        <NoteDetailPopup
          note={selectedNote as Note}
          onClose={() => setSelectedNote(null)}
          onUpdate={handleNoteUpdate}
          onDelete={handleNoteDelete}
          readOnly={isLabMode}
        />
      )}

      {startDialog}
    </div>
  );
}
