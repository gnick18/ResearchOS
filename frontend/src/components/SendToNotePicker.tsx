"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { notesApi } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Note } from "@/lib/types";

/**
 * Modal that asks the user which note to file a batch of selected inbox
 * items into. Shape-for-shape mirror of `SendToTaskPicker`: same z-index,
 * same centered card, same search-on-top + scroll-list-below layout, same
 * confirm-on-click. The structural twin is intentional — keeping both
 * pickers visually identical lets users learn the gesture once and apply
 * it to either destination.
 *
 * The default view shows the 20 most-recently-updated notes (sorted by
 * `updated_at` desc, which is the same field the dashboard and lab feeds
 * key on). Each row pairs the note title with a short snippet from the
 * latest entry's content so a user with a half-dozen "Running log" notes
 * can tell which lives where. Snippet extraction is deliberately naive
 * (first ~80 chars of the latest entry's raw markdown, stripped of
 * leading whitespace and line breaks): markdown-aware preview rendering
 * lives in NoteDetailPopup and isn't worth pulling into a picker row.
 *
 * Selection is confirm-on-click — clicking a note row immediately
 * invokes `onPick({ id, owner, title })` and the parent closes the
 * modal. Matches SendToTaskPicker's no-confirm-button policy.
 */

interface SendToNotePickerProps {
  isOpen: boolean;
  selectedCount: number;
  onClose: () => void;
  onPick: (note: { id: number; owner: string; title: string }) => void;
}

const RECENT_LIMIT = 20;
const SNIPPET_CHARS = 80;

/** First-N-chars snippet from the latest entry's content. Strips leading
 *  whitespace and collapses every CR/LF run to a single space so the row
 *  stays one line. Returns the empty string when the note has no entries
 *  or the latest entry has no content (caller renders a placeholder). */
function snippetFromNote(note: Note): string {
  if (!note.entries || note.entries.length === 0) return "";
  // Pick the latest entry by updated_at (matches attachImageToNote's
  // pickLatestEntry — same source-of-truth for "latest"). Ties break
  // on array order which is also how notesStore returns them.
  let latest = note.entries[0];
  for (const e of note.entries) {
    if (new Date(e.updated_at).getTime() > new Date(latest.updated_at).getTime()) {
      latest = e;
    }
  }
  const raw = (latest.content ?? "").replace(/\s+/g, " ").trim();
  if (raw.length <= SNIPPET_CHARS) return raw;
  return `${raw.slice(0, SNIPPET_CHARS - 1)}…`;
}

export default function SendToNotePicker({
  isOpen,
  selectedCount,
  onClose,
  onPick,
}: SendToNotePickerProps) {
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";
  const [query, setQuery] = useState("");

  // Reuse the dashboard's notes query key so React Query hands us the
  // already-populated cache. NotesPanel uses `["notes"]` for the current
  // user's notes list.
  const { data: notes = [], isLoading: notesLoading } = useQuery({
    queryKey: ["notes", currentUser],
    queryFn: () => notesApi.list(),
    enabled: isOpen,
  });

  // Reset the search box every time the modal opens so the user lands
  // on the "recent 20" view by default.
  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
  }, [isOpen]);

  // Esc-to-close.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const trimmed = query.trim().toLowerCase();
  const matchesQuery = (n: Note): boolean => {
    if (!trimmed) return true;
    if (n.title.toLowerCase().includes(trimmed)) return true;
    // Also match against the snippet so a user can type a phrase from
    // the body and find the note. Pull from the latest entry only — the
    // picker shouldn't pretend to be a full-text search.
    const snip = snippetFromNote(n).toLowerCase();
    return snip.includes(trimmed);
  };

  const sortedByRecent = useMemo(() => {
    return [...notes].sort((a, b) => {
      // `updated_at` is an ISO timestamp; lexical compare on ISO is
      // chronological. Ties break on id desc (newer ids first).
      if (a.updated_at === b.updated_at) return b.id - a.id;
      return a.updated_at < b.updated_at ? 1 : -1;
    });
  }, [notes]);

  const filtered = useMemo(
    () => sortedByRecent.filter(matchesQuery),
    // matchesQuery references trimmed but is recomputed each render —
    // dep array uses the underlying inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortedByRecent, trimmed],
  );

  // Cap at RECENT_LIMIT both for the unsearched default view AND when
  // the search box is non-empty — keeping the picker fast even on a
  // user with hundreds of notes. The cap is comfortable: 20 rows fit
  // in the 80vh scroll area without paging.
  const visible = filtered.slice(0, RECENT_LIMIT);
  const truncated = filtered.length > RECENT_LIMIT;

  if (!isOpen) return null;

  const headerLabel =
    selectedCount === 1 ? "Send to note" : `Send ${selectedCount} items to note`;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{headerLabel}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Each photo appends a markdown link to the note&apos;s latest entry.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none p-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-100">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {notesLoading ? (
            <p className="text-sm text-gray-500 text-center py-6">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-gray-400 italic text-center py-6">
              {trimmed ? "No notes match." : "No notes yet."}
            </p>
          ) : (
            <ul className="space-y-1" data-testid="send-to-note-picker-list">
              {!trimmed && (
                <li className="px-3 pt-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  Recent
                </li>
              )}
              {visible.map((n) => {
                const snippet = snippetFromNote(n);
                const ctaLabel =
                  selectedCount <= 1 ? "Move here" : `Move ${selectedCount} here`;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      data-testid={`send-to-note-picker-row-${n.id}`}
                      onClick={() =>
                        onPick({ id: n.id, owner: n.username, title: n.title })
                      }
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-blue-50 focus:bg-blue-50 focus:outline-none flex items-center gap-3"
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full flex-shrink-0 bg-sky-400"
                        aria-hidden
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-gray-900 truncate">
                          {n.title || "Untitled note"}
                        </span>
                        <span className="block text-xs text-gray-500 truncate">
                          {snippet || (
                            <span className="italic text-gray-400">No content yet</span>
                          )}
                        </span>
                      </span>
                      <span className="text-xs text-blue-600 font-medium flex-shrink-0">
                        {ctaLabel}
                      </span>
                    </button>
                  </li>
                );
              })}
              {truncated && (
                <li className="px-3 pt-2 text-xs text-gray-400">
                  Showing the {RECENT_LIMIT} most recent. Type to search older notes.
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
