"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usersApi } from "@/lib/local-api";
import UserAvatar from "@/components/UserAvatar";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import type { NoteComment, TaskComment } from "@/lib/types";

// NoteComment and TaskComment share an identical shape — `{id, author, text,
// created_at}`. The component accepts either, keyed by `entityKind` only for
// the collapse-state disambiguation.
export type CommentLike = NoteComment | TaskComment;

interface CommentsThreadProps {
  // Which entity owns this thread. Drives the collapse-state map key and
  // — for the unshared-entity hint copy — the noun in the message. No
  // rendering branches besides that; comments look identical for both
  // entity kinds by design (Grant's "same component" clickable).
  entityKind: "note" | "task";
  entityId: number;
  // The owner's username, when known. Used for the collapse-map key so
  // tasks of id 5 owned by different users don't collide. For Notes the
  // owner is `note.username`. For self-owned entities, pass undefined or
  // the current user.
  entityOwner?: string;
  comments: CommentLike[];
  // Whether the entity is currently visible to the lab. Drives the
  // "Turn on sharing" hint and gates the comment input — comments on a
  // private entity would never be seen by anyone but the owner.
  isShared: boolean;
  // Copy for the "not shared" hint; lets us word it appropriately for
  // notes ("Turn on sharing to let lab mates comment.") vs tasks ("Share
  // this task to let lab mates comment.").
  notSharedHint?: string;
  // Hide the input + delete buttons. Used for view-only shared entities
  // (`shared_permission === "view"` on tasks) where the receiver should
  // see comments but not modify them.
  readOnly?: boolean;
  // Async callbacks. The parent owns the mutation hooks + cache
  // invalidation; this component manages its own draft + pending state.
  onAdd: (text: string, author: string) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
}

// Session-scoped override map: tracks entities where the user has explicitly
// toggled the section away from its data-derived default. Mirror of the
// pendingCaptions pattern in lib/telegram/image-router.ts. Composite key
// `${entityKind}:${owner ?? "self"}:${id}` so notes and tasks (and shared
// entities from different owners) keep independent collapse state.
const userCollapseMap = new Map<string, boolean>();

function makeCollapseKey(
  entityKind: "note" | "task",
  entityId: number,
  entityOwner?: string,
): string {
  return `${entityKind}:${entityOwner ?? "self"}:${entityId}`;
}

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

export default function CommentsThread({
  entityKind,
  entityId,
  entityOwner,
  comments,
  isShared,
  notSharedHint,
  readOnly = false,
  onAdd,
  onDelete,
}: CommentsThreadProps) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

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
  const canComment = !readOnly && !!author && author !== "lab";

  // Lab Head Phase 1 (lab head Phase 1 manager, 2026-05-23): the per-comment
  // attribution row resolves each author's display name + account_type from
  // the lab user profile map. A missing lookup ("departed lab member")
  // renders the author name in gray with no badge — the demo fixture
  // doesn't have a departed user yet, but the fallback path lights up
  // automatically when one appears so Phase 2's full departure pipeline
  // doesn't need extra renderer changes here.
  const profileMap = useLabUserProfileMap();

  // Sort comments by created_at so new entries land at the bottom.
  const sorted = comments.slice().sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

  // Collapsible state. Default: collapsed when zero comments, expanded
  // otherwise. Once the user toggles, that choice wins until the entity
  // identity changes. The 0 -> 1 transition auto-expands an untouched
  // section because `userPreference` stays undefined and the derived value
  // flips with `comments.length`. When the entity changes between renders,
  // re-read the map in render (React's recommended "adjusting state on
  // prop change" pattern).
  const collapseKey = makeCollapseKey(entityKind, entityId, entityOwner);
  const [prevKey, setPrevKey] = useState(collapseKey);
  const [userPreference, setUserPreference] = useState<boolean | undefined>(
    () => userCollapseMap.get(collapseKey),
  );
  if (prevKey !== collapseKey) {
    setPrevKey(collapseKey);
    setUserPreference(userCollapseMap.get(collapseKey));
  }
  const collapsed =
    userPreference !== undefined ? userPreference : sorted.length === 0;
  const toggleCollapse = () => {
    const next = !collapsed;
    userCollapseMap.set(collapseKey, next);
    setUserPreference(next);
  };

  const handleSubmit = async () => {
    const text = draft.trim();
    if (!text || !canComment || posting) return;
    setPosting(true);
    try {
      await onAdd(text, author);
      setDraft("");
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (deleting) return;
    setDeleting(commentId);
    try {
      await onDelete(commentId);
    } finally {
      setDeleting(null);
    }
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
            {sorted.length > 0 && (
              <span className="ml-1 text-gray-400 font-normal">({sorted.length})</span>
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
          {!isShared && notSharedHint && (
            <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3">
              {notSharedHint}
            </div>
          )}

          {sorted.length === 0 ? (
            <p className="text-xs text-gray-400 mb-3">No comments yet.</p>
          ) : (
            <ul className="space-y-3 mb-3">
              {sorted.map((c) => {
                const mine = c.author === author;
                const profile = profileMap[c.author];
                const departed = !profile;
                // Display name fallback chain: settings.displayName ->
                // username. The username is the safest last-resort label;
                // never render an empty author row.
                const displayName =
                  (profile?.displayName && profile.displayName.trim()) ||
                  c.author;
                const isPI = profile?.account_type === "lab_head";
                // Departed-lab-head case: gray the name, drop the badge.
                // Per Grant's 2026-05-23 design decision (#5), departed
                // comments retain the author name so threads stay
                // historically intact.
                const nameClass = departed
                  ? "font-medium text-gray-400 italic"
                  : "font-medium text-gray-700";
                return (
                  <li key={c.id} className="flex gap-2.5">
                    <UserAvatar username={c.author} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className={nameClass}>{displayName}</span>
                        {isPI && !departed && (
                          <span
                            className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded bg-amber-100 text-amber-800"
                            title="Lab head / principal investigator"
                          >
                            PI
                          </span>
                        )}
                        <span>·</span>
                        <span title={c.created_at}>{formatRelative(c.created_at)}</span>
                        {mine && !readOnly && (
                          <button
                            type="button"
                            onClick={() => handleDelete(c.id)}
                            disabled={deleting === c.id}
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

          {isShared && !readOnly && (
            canComment ? (
              <div className="flex gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      void handleSubmit();
                    }
                  }}
                  placeholder={`Comment as ${author}…`}
                  rows={2}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
                />
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={!draft.trim() || posting}
                  className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed self-start"
                >
                  {posting ? "Posting…" : "Post"}
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
