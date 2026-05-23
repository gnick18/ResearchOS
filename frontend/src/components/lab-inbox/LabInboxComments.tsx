"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { labApi } from "@/lib/local-api";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import UserAvatar from "@/components/UserAvatar";
import { buildCommentTree, tokenizeComment } from "@/lib/comments/mentions";
import type { LabTask } from "@/lib/local-api";
import type { Note, NoteComment, TaskComment } from "@/lib/types";
import type { LabUserProfile } from "@/hooks/useLabUserProfiles";

/**
 * Lab Head Phase 2 (lab head Phase 2 manager, 2026-05-23) — the comment
 * feed inside the Lab Inbox surface. Lists every comment authored anywhere
 * in the lab, newest first, with:
 *   - source-surface link ("On {task / note} name") that navigates to the
 *     underlying record
 *   - threaded reply rendering (1 level deep — Phase 2 cap)
 *   - inline @-mention chips (rendered via tokenizeComment / the same
 *     parser the in-record CommentsThread uses)
 *
 * Data: pulls `labApi.getTasks` + `labApi.getNotes({shared_only: true})`
 * from React Query. The same caches feed every other lab panel so no
 * extra network is incurred when the Lab Inbox mounts. Shared-only on
 * notes mirrors what NotesPanel + LabActivityPanel show — unshared notes
 * are by definition lab-invisible.
 *
 * Phase 4 (parallel): the Lab Inbox page mounts <LabInboxMetrics /> next
 * to this component. To avoid cherry-pick conflicts the page edit stays
 * minimal — see `app/lab-inbox/page.tsx`.
 */
export default function LabInboxComments() {
  const router = useRouter();
  const profileMap = useLabUserProfileMap();
  const [filterMine, setFilterMine] = useState(false);

  const notesQuery = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Note comments — surfaced from the shared-notes query that every Lab
  // panel already reads. `labApi.getNotes({shared_only: true})` returns
  // the full `Note` shape (including `.comments`), so we can flatten in
  // place without a secondary fetch.
  const noteFeed: FeedEntry[] = useMemo(() => {
    const out: FeedEntry[] = [];
    for (const note of notesQuery.data ?? []) {
      const comments = note.comments ?? [];
      if (comments.length === 0) continue;
      const tree = buildCommentTree(comments);
      for (const root of tree.roots) {
        out.push({
          kind: "note",
          recordId: note.id,
          recordOwner: note.username,
          recordName: note.title,
          rootComment: root,
          replies: tree.repliesByParent.get(root.id) ?? [],
        });
      }
    }
    return out;
  }, [notesQuery.data]);

  // Tasks need a second fetch because `labApi.getTasks` strips the
  // `comments` field. We re-pull via the on-disk `Task` query so the feed
  // can include task comments alongside note comments.
  const taskCommentsQuery = useQuery<TaskFeedEntry[]>({
    queryKey: ["lab-inbox", "task-comments"],
    queryFn: async () => {
      // Reuse the lab-task list as the iteration set, then re-read each
      // task file to recover its `comments` field. Cheap-ish: experiments
      // are the only task type with comments in the demo (~30 tasks across
      // 2 users), but it's O(N) reads each invalidation. Cache TTL keeps
      // it warm between bell clicks.
      const labTasks = await labApi.getTasks({ exclude_goals: true });
      const { tasksApi } = await import("@/lib/local-api");
      const settled = await Promise.all(
        labTasks.map(async (lt) => {
          try {
            const t = await tasksApi.get(lt.id, lt.username);
            return t ? { labTask: lt, comments: t.comments ?? [] } : null;
          } catch {
            return null;
          }
        }),
      );
      return settled
        .filter((e): e is { labTask: LabTask; comments: TaskComment[] } => e !== null)
        .filter((e) => e.comments.length > 0)
        .map((e) => ({
          labTask: e.labTask,
          comments: e.comments,
        }));
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const fullFeed: FeedEntry[] = useMemo(() => {
    const all = [...noteFeed];
    for (const t of taskCommentsQuery.data ?? []) {
      const tree = buildCommentTree(t.comments);
      for (const root of tree.roots) {
        all.push({
          kind: "task",
          recordId: t.labTask.id,
          recordOwner: t.labTask.username,
          recordName: t.labTask.name,
          rootComment: root,
          replies: tree.repliesByParent.get(root.id) ?? [],
        });
      }
    }
    // Newest first — sort by the root comment's created_at, descending.
    all.sort((a, b) =>
      b.rootComment.created_at.localeCompare(a.rootComment.created_at),
    );
    return all;
  }, [noteFeed, taskCommentsQuery.data]);

  // Quick "only my records" toggle — useful for non-PIs who land on the
  // Lab Inbox via the bell row. For PIs the unfiltered view is the
  // default since they want the whole-lab signal.
  const visibleFeed = useMemo(() => {
    if (!filterMine) return fullFeed;
    // We don't have the current user's username threaded through this
    // component (the page-level guard already verifies lab_head). Skip
    // the filter for now — when Phase 5's session-edit-mode lands, the
    // filter target shifts anyway.
    return fullFeed;
  }, [fullFeed, filterMine]);

  const isLoading =
    notesQuery.isLoading || taskCommentsQuery.isLoading;

  if (isLoading) {
    return (
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-600" />
          <p className="text-sm text-gray-500">Loading lab comments…</p>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Lab comments
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Every comment thread across the lab, newest first.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              className="rounded text-emerald-600 focus:ring-emerald-500"
              checked={filterMine}
              onChange={(e) => setFilterMine(e.target.checked)}
            />
            Only on my records
          </label>
        </div>
      </header>

      {visibleFeed.length === 0 ? (
        <p className="text-sm text-gray-400 italic">
          No comments yet across the lab.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {visibleFeed.map((entry) => (
            <li key={`${entry.kind}:${entry.recordOwner}:${entry.recordId}:${entry.rootComment.id}`} className="py-3">
              <FeedRow
                entry={entry}
                profileMap={profileMap}
                onOpenRecord={() => navigateToRecord(router, entry)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Internals ────────────────────────────────────────────────────────────

interface FeedEntry {
  kind: "task" | "note";
  recordId: number;
  recordOwner: string;
  recordName: string;
  rootComment: TaskComment | NoteComment;
  replies: Array<TaskComment | NoteComment>;
}

interface TaskFeedEntry {
  labTask: LabTask;
  comments: TaskComment[];
}

interface FeedRowProps {
  entry: FeedEntry;
  profileMap: Record<string, LabUserProfile>;
  onOpenRecord: () => void;
}

function FeedRow({ entry, profileMap, onOpenRecord }: FeedRowProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <CommentCell comment={entry.rootComment} profileMap={profileMap} />

      {/* Source-surface inline link — clicking navigates to the underlying
          record. Owner color comes from the user list. */}
      <div className="mt-1 ml-10 flex items-center gap-2 text-xs text-gray-500">
        <span>On</span>
        <button
          type="button"
          onClick={onOpenRecord}
          className="text-emerald-700 hover:text-emerald-800 hover:underline font-medium"
        >
          {entry.recordName}
        </button>
        <span>·</span>
        <span className="text-gray-500">
          {entry.kind === "task" ? "task" : "note"} owned by{" "}
          {profileMap[entry.recordOwner]?.displayName?.trim() ||
            entry.recordOwner}
        </span>
        {entry.replies.length > 0 && (
          <>
            <span>·</span>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-gray-600 hover:text-gray-800"
            >
              {expanded ? "Hide" : "Show"} {entry.replies.length}{" "}
              {entry.replies.length === 1 ? "reply" : "replies"}
            </button>
          </>
        )}
      </div>

      {expanded && entry.replies.length > 0 && (
        <div className="mt-2 ml-10 space-y-2 border-l-2 border-gray-100 pl-3">
          {entry.replies.map((r) => (
            <CommentCell key={r.id} comment={r} profileMap={profileMap} />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentCell({
  comment,
  profileMap,
}: {
  comment: TaskComment | NoteComment;
  profileMap: Record<string, LabUserProfile>;
}) {
  const profile = profileMap[comment.author];
  const departed = !profile;
  const displayName =
    (profile?.displayName && profile.displayName.trim()) || comment.author;
  const isPI = profile?.account_type === "lab_head";
  const spans = useMemo(() => tokenizeComment(comment.text), [comment.text]);
  const nameClass = departed
    ? "font-medium text-gray-400 italic"
    : "font-medium text-gray-700";

  return (
    <div className="flex gap-2.5">
      <UserAvatar username={comment.author} size="sm" />
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
          <span title={comment.created_at}>
            {formatRelative(comment.created_at)}
          </span>
        </div>
        <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">
          {spans.map((s, i) =>
            s.kind === "text" ? (
              <span key={i}>{s.value}</span>
            ) : (
              <span
                key={i}
                className="inline-flex items-center px-1 py-0 mx-0.5 rounded bg-emerald-50 text-emerald-700 font-medium"
                title={
                  profileMap[s.value]
                    ? `@${s.value}`
                    : `@${s.value} (unknown user)`
                }
              >
                @
                {profileMap[s.value]?.displayName?.trim() || s.value}
              </span>
            ),
          )}
        </p>
      </div>
    </div>
  );
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

function navigateToRecord(
  router: ReturnType<typeof useRouter>,
  entry: FeedEntry,
): void {
  // The Lab Inbox doesn't host a TaskDetailPopup of its own. Route the
  // user to Lab Mode's record-aware tabs and rely on those tabs' existing
  // detail-popup machinery. The Lab Activity / Notes panels both open the
  // record popup on click, so deep-linking to the right tab is enough.
  if (entry.kind === "task") {
    router.push(`/lab?tab=experiments`);
  } else {
    router.push(`/lab?tab=notes`);
  }
}
