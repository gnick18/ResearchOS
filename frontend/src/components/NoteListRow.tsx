"use client";

import type { Note, LabNote } from "@/lib/types";
import UserAvatar from "@/components/UserAvatar";
import ReceivedFromBadge from "@/components/ReceivedFromBadge";

interface NoteListRowProps {
  note: Note | LabNote;
  onClick: () => void;
  isLabMode?: boolean;
}

// Notes scale bot (2026-06-02). The dense list-view counterpart to NoteCard:
// a single compact ~52px row instead of a card, so a 700-note library reads
// as a navigable list rather than an unscannable sea of cards. Same click
// handler + same data as the card; just a leaner presentation. No card chrome
// — rows are separated by a hairline divider supplied by the parent's
// `divide-y` container.
export default function NoteListRow({ note, onClick, isLabMode = false }: NoteListRowProps) {
  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr ?? "";
    }
  };

  const isLabNote = (n: Note | LabNote): n is LabNote => "user_color" in n;
  // `shared_with` exists on Note but not LabNote; narrow before reading.
  const sharedWith =
    "shared_with" in note ? (note as Note).shared_with : undefined;
  const isShared =
    Boolean(note.is_shared) || Boolean(sharedWith && sharedWith.length > 0);
  const entryCount = note.entries?.length ?? 0;
  const commentCount = note.comments?.length ?? 0;
  // Provenance fields live on Note (not LabNote); narrow before reading.
  const received = "received_from" in note ? (note as Note) : undefined;

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={note.title || "Untitled note"}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="flex items-center gap-3 px-3 py-2.5 min-h-[52px] cursor-pointer hover:bg-surface-sunken transition-colors group"
    >
      {/* Type icon: single note vs running log */}
      {note.is_running_log ? (
        <div className="w-7 h-7 flex-shrink-0 rounded-lg bg-purple-100 dark:bg-purple-500/15 flex items-center justify-center">
          <svg className="w-3.5 h-3.5 text-purple-600 dark:text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
      ) : (
        <div className="w-7 h-7 flex-shrink-0 rounded-lg bg-blue-100 dark:bg-blue-500/15 flex items-center justify-center">
          <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
      )}

      {/* Title + one-line snippet (description). Both truncate; the snippet is
          muted and hidden on very narrow widths so the title always wins. */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-body text-foreground truncate group-hover:text-brand-action transition-colors">
            {note.title || "Untitled"}
          </span>
          {isShared && (
            <span className="flex-shrink-0 px-2 py-0.5 text-meta bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 rounded-full">
              Shared with lab
            </span>
          )}
          {received?.received_from && (
            <ReceivedFromBadge
              receivedFrom={received.received_from}
              fingerprint={received.received_from_fingerprint}
              receivedAt={received.received_at}
              small
            />
          )}
        </div>
        {note.description && (
          <span className="block text-meta text-foreground-muted truncate">{note.description}</span>
        )}
      </div>

      {/* Right rail: entry-count + comment-count chips, the updated date, and
          (lab mode) the author avatar. Hidden progressively on small widths. */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {note.is_running_log && entryCount > 0 && (
          <span className="hidden sm:inline text-meta text-foreground-muted bg-surface-sunken px-2 py-0.5 rounded">
            {entryCount} {entryCount === 1 ? "entry" : "entries"}
          </span>
        )}
        {commentCount > 0 && (
          <span
            className="hidden sm:inline-flex items-center gap-1 text-meta text-foreground-muted"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h6m-7 9l4-4h10a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h1v4z" />
            </svg>
            {commentCount}
          </span>
        )}
        <span className="text-meta text-foreground-muted whitespace-nowrap w-[88px] text-right">
          {formatDate(note.updated_at)}
        </span>
        {isLabMode && isLabNote(note) && (
          <UserAvatar username={note.username} size="xs" />
        )}
      </div>
    </div>
  );
}
