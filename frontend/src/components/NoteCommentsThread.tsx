"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notesApi, usersApi } from "@/lib/local-api";
import UserAvatar from "@/components/UserAvatar";
import type { Note, NoteComment } from "@/lib/types";

interface NoteCommentsThreadProps {
  note: Note;
}

// Session-scoped override map: tracks notes where the user has explicitly
// toggled the section away from its data-derived default. Mirror of the
// pendingCaptions pattern in lib/telegram/image-router.ts. Keyed by note.id;
// value `true` = user forced collapsed, `false` = user forced expanded.
const userCollapseMap = new Map<number, boolean>();

function formatRelative(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NoteCommentsThread({ note }: NoteCommentsThreadProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  // Resolve the real author. In lab mode the "current user" is literally
  // the lab shared account, so we prefer `main_user` (the actual person on
  // this machine) when set; otherwise fall back to `current_user`.
  const { data: identity } = useQuery({
    queryKey: ["users", "identity"],
    queryFn: usersApi.getMainUser,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const author = identity?.main_user || identity?.current_user || "";
  const canComment = author && author !== "lab";

  // Persisted color map so commenter avatars match the rest of the lab UI.
  const invalidateNotes = () => {
    queryClient.invalidateQueries({ queryKey: ["notes"] });
    queryClient.invalidateQueries({ queryKey: ["lab-notes"] });
    queryClient.invalidateQueries({ queryKey: ["lab", "notes-shared"] });
    // Per-user notes cache used by LabUserDetailPanel (queryKey: ["lab","notes",username]).
    queryClient.invalidateQueries({ queryKey: ["lab", "notes"] });
  };

  const addCommentMutation = useMutation({
    mutationFn: (text: string) =>
      notesApi.addComment(note.id, note.username, text, author),
    onSuccess: () => {
      setDraft("");
      invalidateNotes();
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) =>
      notesApi.deleteComment(note.id, note.username, commentId),
    onSuccess: invalidateNotes,
  });

  // Reuse the note's in-memory comments. Mutations will surface via the
  // invalidations above on the next render of the parent list.
  const comments = (note.comments ?? []).slice().sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

  // Collapsible state. Default: collapsed when zero comments, expanded
  // otherwise. Once the user toggles, that choice wins until note.id changes.
  // The 0 -> 1 transition auto-expands an untouched section because
  // userPreference stays undefined and the derived value flips with
  // comments.length. When note.id changes between renders, re-read the map in
  // render (React's recommended "adjusting state on prop change" pattern).
  const [prevNoteId, setPrevNoteId] = useState(note.id);
  const [userPreference, setUserPreference] = useState<boolean | undefined>(
    () => userCollapseMap.get(note.id),
  );
  if (prevNoteId !== note.id) {
    setPrevNoteId(note.id);
    setUserPreference(userCollapseMap.get(note.id));
  }
  const collapsed =
    userPreference !== undefined ? userPreference : comments.length === 0;
  const toggleCollapse = () => {
    const next = !collapsed;
    userCollapseMap.set(note.id, next);
    setUserPreference(next);
  };

  const handleSubmit = () => {
    const text = draft.trim();
    if (!text || !canComment || addCommentMutation.isPending) return;
    addCommentMutation.mutate(text);
  };

  return (
    <div className="border-t border-gray-200 mt-4 pt-4 px-4 pb-4">
      <button
        type="button"
        onClick={toggleCollapse}
        aria-expanded={!collapsed}
        className="w-full flex items-center justify-between gap-3 py-1 -mx-2 px-2 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h6m-7 9l4-4h10a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h1v4z" />
          </svg>
          <span className="text-sm font-semibold text-gray-700">
            Lab comments
            {comments.length > 0 && (
              <span className="ml-1 text-gray-400 font-normal">({comments.length})</span>
            )}
          </span>
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${collapsed ? "" : "rotate-180"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && (
        <div className="mt-3">
          {!note.is_shared && (
            <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3">
              This note isn&apos;t shared with the lab. Turn on sharing to let lab mates comment.
            </div>
          )}

          {comments.length === 0 ? (
            <p className="text-xs text-gray-400 mb-3">No comments yet.</p>
          ) : (
            <ul className="space-y-3 mb-3">
              {comments.map((c: NoteComment) => {
                const mine = c.author === author;
                return (
                  <li key={c.id} className="flex gap-2.5">
                    <UserAvatar username={c.author} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="font-medium text-gray-700">{c.author}</span>
                        <span>·</span>
                        <span title={c.created_at}>{formatRelative(c.created_at)}</span>
                        {mine && (
                          <button
                            type="button"
                            onClick={() => deleteCommentMutation.mutate(c.id)}
                            disabled={deleteCommentMutation.isPending}
                            className="ml-auto text-gray-400 hover:text-red-600 disabled:opacity-50"
                            title="Delete this comment"
                          >
                            delete
                          </button>
                        )}
                      </div>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                        {c.text}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {note.is_shared && (
            canComment ? (
              <div className="flex gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                  placeholder={`Comment as ${author}…`}
                  rows={2}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
                />
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!draft.trim() || addCommentMutation.isPending}
                  className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed self-start"
                >
                  {addCommentMutation.isPending ? "Posting…" : "Post"}
                </button>
              </div>
            ) : (
              <div className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Set a main user to comment as yourself (Settings → Main User).
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
