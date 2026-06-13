"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { notesApi } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import LivingPopup from "@/components/ui/LivingPopup";
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
  /** Override the modal header (e.g. "Send map image to a note"). Defaults to
   *  the inbox's "Send to note" / "Send N items to note" copy. */
  headerLabel?: string;
  /** Override the per-row call-to-action label (e.g. "Add map here"). Defaults
   *  to the inbox's "Move here" / "Move N here". */
  ctaLabel?: string;
  /** Override the sub-header explainer line. */
  subLabel?: string;
  /** When provided, renders a "New note" row at the top of the list. Clicking
   *  it creates a fresh note (titled `newNoteTitle`, falling back to "New
   *  note") via `notesApi.create`, then routes the new note through `onPick`
   *  exactly like an existing row. The sequence editor's "Send map image to a
   *  note" flow sets this so the user can file the map into a brand-new note
   *  without leaving the picker. Omitting it preserves the inbox's
   *  existing-notes-only behavior. */
  allowCreateNew?: boolean;
  /** Default title for a note created via the "New note" row. */
  newNoteTitle?: string;
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
  headerLabel: headerLabelProp,
  ctaLabel: ctaLabelProp,
  subLabel,
  allowCreateNew = false,
  newNoteTitle = "New note",
}: SendToNotePickerProps) {
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";
  const [query, setQuery] = useState("");
  // True while a "New note" create+attach round-trip is in flight, so the row
  // disables and shows a working label instead of firing twice.
  const [creating, setCreating] = useState(false);

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
    setCreating(false);
  }, [isOpen]);

  // "New note" row handler: create a fresh note in the current user's folder
  // then route it through `onPick` exactly like an existing row. The created
  // note carries one empty entry dated today so attachImageToNote appends the
  // map link to that entry instead of synthesizing a "Photos" entry.
  const handleCreateNew = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const created = await notesApi.create({
        title: newNoteTitle,
        entries: [{ title: newNoteTitle, date: today }],
      });
      onPick({ id: created.id, owner: created.username, title: created.title });
    } catch {
      alert("Failed to create the note.");
      setCreating(false);
    }
  };


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
    headerLabelProp ??
    (selectedCount === 1 ? "Send to note" : `Send ${selectedCount} items to note`);
  const subLabelText =
    subLabel ?? "Each photo appends a markdown link to the note's latest entry.";
  const rowCtaLabel =
    ctaLabelProp ?? (selectedCount <= 1 ? "Move here" : `Move ${selectedCount} here`);

  return (
    <LivingPopup
      open
      onClose={onClose}
      label={headerLabel}
      selfSize
      showClose={false}
    >
      <div
        className="pointer-events-auto bg-surface-raised rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-title font-semibold text-foreground">{headerLabel}</h3>
            <p className="text-meta text-foreground-muted mt-0.5">{subLabelText}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground text-heading leading-none p-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            className="w-full px-3 py-2 text-body border border-border rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {/* "New note" row: shown above the list (and on its own when the user
              has no notes yet) whenever the caller opts in. Search does not
              hide it — typing then picking "New note" creates the note with
              the picker's default title, not the query. */}
          {allowCreateNew && !notesLoading && (
            <ul className="space-y-1 mb-1" data-testid="send-to-note-picker-create">
              <li>
                <button
                  type="button"
                  disabled={creating}
                  data-testid="send-to-note-picker-new"
                  onClick={handleCreateNew}
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-emerald-50 dark:hover:bg-emerald-500/20 focus:bg-emerald-50 dark:focus:bg-emerald-500/20 focus:outline-none flex items-center gap-3 disabled:opacity-50 disabled:cursor-wait"
                >
                  <span
                    className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 flex-shrink-0"
                    aria-hidden
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-body font-medium text-foreground truncate">
                      {creating ? "Creating note…" : "New note"}
                    </span>
                    <span className="block text-meta text-foreground-muted truncate">
                      Create &ldquo;{newNoteTitle}&rdquo; and add the map
                    </span>
                  </span>
                </button>
              </li>
            </ul>
          )}
          {notesLoading ? (
            <p className="text-body text-foreground-muted text-center py-6">Loading…</p>
          ) : visible.length === 0 ? (
            allowCreateNew ? null : (
              <p className="text-body text-foreground-muted italic text-center py-6">
                {trimmed ? "No notes match." : "No notes yet."}
              </p>
            )
          ) : (
            <ul className="space-y-1" data-testid="send-to-note-picker-list">
              {!trimmed && (
                <li className="px-3 pt-1 pb-1 text-meta font-medium uppercase tracking-wide text-foreground-muted">
                  Recent
                </li>
              )}
              {visible.map((n) => {
                const snippet = snippetFromNote(n);
                const ctaLabel = rowCtaLabel;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      data-testid={`send-to-note-picker-row-${n.id}`}
                      onClick={() =>
                        onPick({ id: n.id, owner: n.username, title: n.title })
                      }
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-blue-50 dark:hover:bg-brand-action/20 focus:bg-blue-50 dark:focus:bg-brand-action/20 focus:outline-none flex items-center gap-3"
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full flex-shrink-0 bg-sky-400"
                        aria-hidden
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-body text-foreground truncate">
                          {n.title || "Untitled note"}
                        </span>
                        <span className="block text-meta text-foreground-muted truncate">
                          {snippet || (
                            <span className="italic text-foreground-muted">No content yet</span>
                          )}
                        </span>
                      </span>
                      <span className="text-meta text-blue-600 dark:text-blue-300 font-medium flex-shrink-0">
                        {ctaLabel}
                      </span>
                    </button>
                  </li>
                );
              })}
              {truncated && (
                <li className="px-3 pt-2 text-meta text-foreground-muted">
                  Showing the {RECENT_LIMIT} most recent. Type to search older notes.
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </LivingPopup>
  );
}
