"use client";

import type { Note, LabNote } from "@/lib/types";

interface NoteCardProps {
  note: Note | LabNote;
  onClick: () => void;
  isLabMode?: boolean;
}

export default function NoteCard({ note, onClick, isLabMode = false }: NoteCardProps) {
  // Format date for display
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  // Get the latest entry date for running logs
  const getLatestEntryDate = () => {
    if (note.entries && note.entries.length > 0) {
      const sortedEntries = [...note.entries].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      return formatDate(sortedEntries[0].date);
    }
    return formatDate(note.updated_at);
  };

  // Check if this is a LabNote (has user_color)
  const isLabNote = (n: Note | LabNote): n is LabNote => {
    return "user_color" in n;
  };

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:shadow-md hover:border-emerald-200 transition-all duration-200 group"
    >
      {/* Header with icon and type indicator */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {/* Icon based on type */}
          {note.is_running_log ? (
            <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-purple-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
          )}
          
          {/* Shared indicator */}
          {note.is_shared && (
            <span className="px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded-full">
              Shared
            </span>
          )}
        </div>
        
        {/* Running log entry count */}
        {note.is_running_log && note.entries && (
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
            {note.entries.length} {note.entries.length === 1 ? "entry" : "entries"}
          </span>
        )}
      </div>

      {/* Title */}
      <h3 className="font-semibold text-gray-900 mb-1 group-hover:text-emerald-600 transition-colors line-clamp-2">
        {note.title}
      </h3>

      {/* Description */}
      {note.description && (
        <p className="text-sm text-gray-500 mb-3 line-clamp-2">{note.description}</p>
      )}

      {/* Footer with date and user info */}
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-100">
        <span className="text-xs text-gray-400">{getLatestEntryDate()}</span>
        
        {/* User indicator in lab mode */}
        {isLabMode && isLabNote(note) && (
          <div className="flex items-center gap-1.5">
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-medium"
              style={{ backgroundColor: note.user_color }}
            >
              {note.username.charAt(0).toUpperCase()}
            </div>
            <span className="text-xs text-gray-500">{note.username}</span>
          </div>
        )}
      </div>
    </div>
  );
}
