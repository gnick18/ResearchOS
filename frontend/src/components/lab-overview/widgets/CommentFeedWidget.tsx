"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { labApi, notesApi, tasksApi } from "@/lib/local-api";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import UserAvatar from "@/components/UserAvatar";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import NoteDetailPopup from "@/components/NoteDetailPopup";
import { buildCommentTree, tokenizeComment } from "@/lib/comments/mentions";
import type { LabTask } from "@/lib/local-api";
import type { Note, NoteComment, Task, TaskComment } from "@/lib/types";
import type { LabUserProfile } from "@/hooks/useLabUserProfiles";

/**
 * Lab Head Phase 2 (lab head Phase 2 manager, 2026-05-23) — the comment
 * feed inside the Lab Inbox surface. Lists every comment authored anywhere
 * in the lab, newest first, with:
 *   - source-surface link ("On {task / note} name") that opens an in-place
 *     popup over the Lab Inbox so context isn't lost (Lab Inbox R1, 2026-
 *     05-23 — lab inbox R1 manager). Before R1 the click navigated to
 *     `/lab?tab=…`, which dropped the user out of the inbox entirely; the
 *     comment without its source record was effectively meaningless.
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
/**
 * Phase B Batch B2 (Phase B Batch B2 manager, 2026-05-23): adds a
 * three-way filter group (All lab / Only on my records / Mentions me)
 * to the ExpandedView. "Mentions me" reads the denormalized
 * `mentions?: string[]` field on each comment — populated by the
 * compose path — so we don't need to re-tokenize the body on every
 * render.
 *
 * `filterMine` is preserved as a state slot for Mira-Literal P0
 * compatibility; the new tri-state filter just sets it indirectly.
 */
type CommentFilter = "all" | "mine" | "mentions";

export default function CommentFeedWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  const profileMap = useLabUserProfileMap();
  const { currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  // Phase B Batch B2: tri-state filter. The historical Mira-Literal P0
  // "Only on my records" behavior is preserved as the `"mine"` arm of
  // the new filter; the visibleFeed memo still narrows by `recordOwner`
  // when the user picks it.
  const [filter, setFilter] = useState<CommentFilter>("all");
  const [activePopup, setActivePopup] = useState<ActivePopup | null>(null);

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
  // default since they want the whole-lab signal. When the toggle is
  // on we narrow `visibleFeed` to entries whose source record is owned
  // by the active user (Mira Batch 1 polish, 2026-05-23).
  //
  // Phase B Batch B2: "Mentions me" filter — narrow to entries whose
  // root comment OR any reply mentions the current user (denormalized
  // `mentions?: string[]` on each comment, populated at compose time).
  const visibleFeed = useMemo(() => {
    if (!currentUser) return fullFeed;
    if (filter === "mine") {
      return fullFeed.filter((entry) => entry.recordOwner === currentUser);
    }
    if (filter === "mentions") {
      return fullFeed.filter((entry) => {
        const all = [entry.rootComment, ...entry.replies];
        return all.some((c) =>
          (c.mentions ?? []).includes(currentUser),
        );
      });
    }
    return fullFeed;
  }, [fullFeed, filter, currentUser]);

  const isLoading =
    notesQuery.isLoading || taskCommentsQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex items-center gap-3">
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-600" />
        <p className="text-sm text-gray-500">Loading lab comments…</p>
      </div>
    );
  }

  // R2 (R2 widget framework manager, 2026-05-23): outer card chrome
  // moved into the canonical `<Widget>` frame. The "Lab comments"
  // header copy is now the widget title; the filter chips stay in-body
  // since they're interactive filters, not chrome.
  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label="Filter comments"
        className="flex items-center gap-1 flex-wrap"
      >
        <CommentFilterChip
          label="All lab"
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <CommentFilterChip
          label="Only on my records"
          active={filter === "mine"}
          onClick={() => setFilter("mine")}
        />
        <CommentFilterChip
          label="Mentions me"
          active={filter === "mentions"}
          onClick={() => setFilter("mentions")}
        />
      </div>

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
                onOpenRecord={() =>
                  setActivePopup({
                    kind: entry.kind,
                    recordId: entry.recordId,
                    recordOwner: entry.recordOwner,
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}

      {/* Lab Inbox R1 (lab inbox R1 manager, 2026-05-23): in-place record
          popup. Click "On {name}" → open TaskDetailPopup / NoteDetailPopup
          over the Lab Inbox so the user reads context without losing the
          feed scroll position. Close (X or Esc) clears activePopup → user
          is back on the feed exactly where they left off. */}
      {activePopup && (
        <ActivePopupMount
          popup={activePopup}
          currentUser={currentUser}
          onClose={() => {
            setActivePopup(null);
            // Refresh underlying feed in case the popup mutated the record
            // (comments added, fields edited via PI edit-mode, etc.) so the
            // inbox reflects the new state without a manual reload.
            void queryClient.refetchQueries({ queryKey: ["lab", "notes-shared"] });
            void queryClient.refetchQueries({ queryKey: ["lab-inbox", "task-comments"] });
          }}
        />
      )}
    </div>
  );
}

// ── Popup orchestration ──────────────────────────────────────────────────

type ActivePopup =
  | { kind: "task"; recordId: number; recordOwner: string }
  | { kind: "note"; recordId: number; recordOwner: string };

/**
 * Loads the full record for the active popup target and mounts the right
 * detail popup component.
 *
 * Records are owner-routed reads — the comment feed exposes the
 * `recordOwner`, and the underlying file lives in that user's directory.
 * For lab-head viewers this is exactly the cross-owner read pattern
 * LabInboxMetrics already uses; for members it lines up with the
 * shared-with-me read path that NotesPanel + WorkbenchExperimentsPanel
 * have always followed.
 *
 * Read-only gating: when the viewer is NOT the record owner, the popup is
 * mounted with `readOnly={true}` so write affordances are suppressed.
 * Lab Head Phase 5 layers PI edit-mode on top inside the popup itself
 * via `useLabHeadEditGate`, so PIs see "Request edit" exactly as they do
 * on the regular lab surfaces — nothing extra needed here.
 */
function ActivePopupMount({
  popup,
  currentUser,
  onClose,
}: {
  popup: ActivePopup;
  currentUser: string | null;
  onClose: () => void;
}) {
  const isOwner = !!currentUser && currentUser === popup.recordOwner;
  // Cross-owner reads require explicit owner routing so the record file is
  // looked up in the target user's directory.
  const ownerArg = isOwner ? undefined : popup.recordOwner;

  const taskQuery = useQuery<Task | null>({
    queryKey: ["lab-inbox", "popup-task", popup.recordOwner, popup.recordId],
    queryFn: () => tasksApi.get(popup.recordId, ownerArg),
    enabled: popup.kind === "task",
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const noteQuery = useQuery<Note | null>({
    queryKey: ["lab-inbox", "popup-note", popup.recordOwner, popup.recordId],
    queryFn: async () => {
      const n = await notesApi.get(popup.recordId, ownerArg);
      if (!n) return null;
      // Mirror labApi.getNotes — stamp `.username` so the popup's owner
      // routing (Phase 5 PI edit-mode) reads the right value.
      return { ...n, username: n.username || popup.recordOwner };
    },
    enabled: popup.kind === "note",
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  if (popup.kind === "task") {
    if (taskQuery.isLoading) {
      return <PopupLoading onClose={onClose} />;
    }
    if (!taskQuery.data) {
      return <PopupMissing kind="task" onClose={onClose} />;
    }
    // Open straight to the Items tab for purchase tasks so the user lands
    // on the relevant context (mirrors SpendingDashboard's TaskDetailPopup
    // mount at SpendingDashboard.tsx:803).
    const initialTab =
      taskQuery.data.task_type === "purchase" ? "purchases" : undefined;
    return (
      <TaskDetailPopup
        task={taskQuery.data}
        onClose={onClose}
        readOnly={!isOwner}
        username={isOwner ? undefined : popup.recordOwner}
        initialTab={initialTab}
      />
    );
  }

  if (noteQuery.isLoading) {
    return <PopupLoading onClose={onClose} />;
  }
  if (!noteQuery.data) {
    return <PopupMissing kind="note" onClose={onClose} />;
  }
  return (
    <NoteDetailPopup
      note={noteQuery.data}
      onClose={onClose}
      // For cross-owner views these callbacks are effectively no-ops — the
      // popup's readOnly gate suppresses every write path that would call
      // them. For owner views we still want the popup to refresh the feed
      // by invalidating the query keys above, which `onClose` already does.
      onUpdate={() => {}}
      onDelete={onClose}
      readOnly={!isOwner}
    />
  );
}

function PopupLoading({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl px-6 py-5 flex items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-600" />
        <p className="text-sm text-gray-500">Loading record…</p>
      </div>
    </div>
  );
}

function PopupMissing({
  kind,
  onClose,
}: {
  kind: "task" | "note";
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl px-6 py-5 max-w-sm flex flex-col gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-medium text-gray-900">
          {kind === "task" ? "Task" : "Note"} not found
        </p>
        <p className="text-xs text-gray-500">
          The source record may have been deleted or renamed. Close this
          message and refresh the inbox.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="self-end mt-1 text-xs text-emerald-700 hover:text-emerald-800 font-medium"
        >
          Close
        </button>
      </div>
    </div>
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
  // Phase B Batch B2: make the whole row a click target for the source
  // record. We keep the existing in-row "On {name}" affordance because
  // it's the legible click-cue (the row otherwise looks read-only); the
  // big click area is a usability win for mouse users. Reply toggle
  // and inline link still stopPropagation so they don't double-fire.
  const handleRowClick = (e: MouseEvent) => {
    // Don't hijack clicks on the inner buttons / links inside the row.
    if ((e.target as HTMLElement).closest("button, a")) return;
    onOpenRecord();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleRowClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpenRecord();
        }
      }}
      className="rounded-md -mx-2 px-2 py-1 cursor-pointer hover:bg-gray-50 focus:bg-gray-50 focus:outline-none transition-colors"
    >
      <CommentCell comment={entry.rootComment} profileMap={profileMap} />

      {/* Source-surface inline link — clicking opens the underlying
          record in an in-place popup (Lab Inbox R1, 2026-05-23). Visual
          treatment leans into "this is interactive": pointer cursor, hover
          underline, plus a small open-in-popup glyph so the affordance is
          legible at a glance. Owner color comes from the user list. */}
      <div className="mt-1 ml-10 flex items-center gap-2 text-xs text-gray-500">
        <span>On</span>
        <button
          type="button"
          onClick={onOpenRecord}
          className="inline-flex items-center gap-1 cursor-pointer text-emerald-700 hover:text-emerald-800 hover:underline font-medium rounded focus:outline-none focus:ring-2 focus:ring-emerald-300"
          title={`Open ${entry.kind === "task" ? "task" : "note"} in a popup`}
        >
          <span>{entry.recordName}</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 3h6v6" />
            <path d="M10 14L21 3" />
            <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
          </svg>
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
              className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-800"
              title="PI"
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

function CommentFilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
        active
          ? "bg-emerald-100 text-emerald-700 font-medium"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      }`}
    >
      {label}
    </button>
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase B redesign (Phase B redesign manager, 2026-05-23): content-rich
// SnapshotTile that shows the 3 most-recent comments as mini rows
// (avatar, author + source-record title, comment preview). Drops the
// HeroNumberTile shape; the conversation IS the signal.
// - SidebarTile: unchanged from Batch B2 (chat-bubble + count badge).
// - Reads the same notes-shared cache for parity with the body.
//   `filterMine` and the rest of the body wiring (Mira-Literal P0) are
//   untouched.
import SidebarStatTile from "./snapshot/SidebarStatTile";
import type { SnapshotTileProps, SidebarTileProps } from "./types";

const CHAT_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const CHECK_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="text-emerald-500"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

function truncatePreview(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/**
 * SnapshotTile: 3 most-recent lab comments rendered as mini rows
 * (avatar, author + source-record title, comment preview). Note-only
 * for parity with the body's warm cache. The body's heavier
 * lab-inbox/task-comments query would force the tile to wait on N
 * extra reads — keep the glance-only tile bound to the shared-notes
 * cache.
 */
export function SnapshotTile(_props: SnapshotTileProps) {
  const profileMap = useLabUserProfileMap();
  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  type Row = {
    comment: NoteComment;
    sourceTitle: string;
  };
  let total = 0;
  const rows: Row[] = [];
  for (const n of notes) {
    const cs = n.comments ?? [];
    total += cs.length;
    for (const c of cs) {
      rows.push({ comment: c, sourceTitle: n.title || "Untitled note" });
    }
  }
  rows.sort((a, b) =>
    b.comment.created_at.localeCompare(a.comment.created_at),
  );
  const top3 = rows.slice(0, 3);

  return (
    <div className="relative h-full overflow-hidden flex flex-col">
      <div className="flex items-center gap-1.5 text-gray-500">
        <span aria-hidden="true" className="text-blue-500 flex-shrink-0">
          {CHAT_SVG}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-medium">
          Comments
        </span>
      </div>
      {total > 0 ? (
        <span className="absolute top-0 right-0 text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-full font-medium">
          {total} total
        </span>
      ) : (
        !isLoading && (
          <span className="absolute bottom-0 left-0 flex items-center gap-1 text-[10px] text-gray-500">
            {CHECK_SVG}
            <span>all caught up</span>
          </span>
        )
      )}
      <div className="mt-2 flex-1 min-h-0 flex flex-col gap-2">
        {isLoading ? (
          <p className="text-xs text-gray-400 italic m-auto">Loading…</p>
        ) : top3.length === 0 ? (
          <p className="text-xs text-gray-400 italic m-auto">
            No comments yet
          </p>
        ) : (
          top3.map((row) => {
            const author =
              profileMap[row.comment.author]?.displayName?.trim() ||
              row.comment.author;
            return (
              <div
                key={row.comment.id}
                className="flex items-start gap-2 min-w-0"
              >
                <UserAvatar username={row.comment.author} size="xs" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] truncate">
                    <span className="font-medium text-gray-700">{author}</span>
                    <span className="text-gray-400"> on </span>
                    <span className="text-gray-500 truncate">
                      {row.sourceTitle}
                    </span>
                  </p>
                  <p className="text-xs text-gray-600 truncate">
                    {truncatePreview(row.comment.text)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export const ExpandedView = CommentFeedWidget;

/**
 * Lab overview PI tooltips (Chip B, 2026-05-25): help-badge copy for
 * the Lab comments feed.
 */
export const HELP_TEXT =
  "Every comment thread across the lab, newest first. Tabs split it into all comments, @-mentions of you, and threads on notes you authored.";

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  let count = 0;
  for (const n of notes) count += (n.comments ?? []).length;
  return (
    <SidebarStatTile
      icon={CHAT_SVG}
      iconClassName="text-blue-500"
      label="Comments"
      stat={
        isLoading ? (
          "—"
        ) : count > 0 ? (
          <span className="inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 text-[11px] font-semibold tabular-nums">
            {count}
          </span>
        ) : (
          <span className="inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 text-[11px] font-semibold tabular-nums">
            0
          </span>
        )
      }
      onClick={onClick}
    />
  );
}
