"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notesApi, labApi } from "@/lib/api";
import type { Note, NoteCreate, LabNote } from "@/lib/types";
import NoteCard from "./NoteCard";
import NoteDetailPopup from "./NoteDetailPopup";

interface NotesPanelProps {
  // If true, this is in Lab Mode and should show all users' shared notes
  isLabMode?: boolean;
  // For Lab Mode: filter by specific usernames
  selectedUsernames?: Set<string>;
  // For Lab Mode: user colors for display
  userColors?: Record<string, string>;
}

export default function NotesPanel({
  isLabMode = false,
  selectedUsernames,
  userColors = {},
}: NotesPanelProps) {
  const queryClient = useQueryClient();
  const [selectedNote, setSelectedNote] = useState<Note | LabNote | null>(null);
  const [showNewNoteDropdown, setShowNewNoteDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "single" | "running">("all");

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

  // Update note mutation
  const updateNoteMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<NoteCreate> }) =>
      notesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["lab-notes"] });
    },
  });

  // Delete note mutation
  const deleteNoteMutation = useMutation({
    mutationFn: (id: number) => notesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["lab-notes"] });
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

  // Handle note delete
  const handleNoteDelete = useCallback((noteId: number) => {
    deleteNoteMutation.mutate(noteId);
    if (selectedNote?.id === noteId) {
      setSelectedNote(null);
    }
  }, [deleteNoteMutation, selectedNote]);

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

  return (
    <div className="h-full flex flex-col">
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
          {sortedNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onClick={() => setSelectedNote(note)}
              isLabMode={isLabMode}
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
    </div>
  );
}
