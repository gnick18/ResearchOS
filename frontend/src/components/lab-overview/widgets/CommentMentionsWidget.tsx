"use client";

/**
 * Tool variants batch (Tool variants batch manager, 2026-05-24): the
 * `@-mentions` variant of the Comments Tool.
 *
 * Filters the same shared-notes comment cache CommentFeedWidget reads,
 * narrowing to entries whose `mentions: string[]` field includes the
 * current viewer. The denormalized `mentions` array is populated at
 * compose time (Lab Head Phase 2) so this filter is a clean `.includes()`
 * check, no body re-tokenization.
 *
 * Wiring: Tool = `comments`, variantId = `mentions`. Clicking the tile
 * opens the same Comments popup (the CommentFeedWidget ExpandedView)
 * as the canonical comment-feed tile.
 *
 * Data: shares `["lab", "notes-shared"]` React Query key with
 * CommentFeedWidget so no additional network read is incurred when the
 * variant is pinned alongside the canonical tile.
 *
 * Canvas + home surface (member-relevant: notifications about my own
 * @-mentions; PI-relevant: I want to see who's pinging me too).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { labApi } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import UserAvatar from "@/components/UserAvatar";
import type { Note, NoteComment } from "@/lib/types";
import type { SidebarTileProps, SnapshotTileProps } from "./types";
import SidebarStatTile from "./snapshot/SidebarStatTile";
import CommentFeedWidget from "./CommentFeedWidget";

// Touch the default export so the eager-import side effect (registering
// React Query keys) still fires when this variant file is loaded.
void CommentFeedWidget;

/** Chat-bubble icon — same shape CommentFeedWidget uses so the variant
 *  reads as a sibling of the canonical comments tile. */
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

/** Inbox-with-check empty-state icon. Friendly cue that there's nothing
 *  pinging the viewer today. */
const EMPTY_INBOX_SVG = (
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
    className="text-emerald-500"
  >
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

function truncatePreview(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/**
 * Build the flat list of mention-rows for the current viewer.
 *
 * Same shared-notes data source CommentFeedWidget reads; we just narrow
 * to comments whose `mentions` array contains the viewer. Note that
 * `mentions` is the canonical source — `LabComment` doesn't carry a
 * separate body-regex path. Pre-Phase-2 comments without the
 * denormalized field don't surface here, which matches the canonical
 * widget's "Mentions me" filter behavior.
 */
type MentionRow = {
  comment: NoteComment;
  sourceTitle: string;
};

function collectMentionRows(notes: Note[], currentUser: string | null): MentionRow[] {
  if (!currentUser) return [];
  const rows: MentionRow[] = [];
  for (const n of notes) {
    const cs = n.comments ?? [];
    for (const c of cs) {
      if ((c.mentions ?? []).includes(currentUser)) {
        rows.push({ comment: c, sourceTitle: n.title || "Untitled note" });
      }
    }
  }
  rows.sort((a, b) => b.comment.created_at.localeCompare(a.comment.created_at));
  return rows;
}

/**
 * SnapshotTile: mirrors the CommentFeedWidget SnapshotTile row layout
 * (avatar + "author on note-title" + 60-char preview), filtered to
 * comments that @-mention the viewer. Top 3 rows + total count pill.
 */
export function SnapshotTile(_props: SnapshotTileProps) {
  const profileMap = useLabUserProfileMap();
  const { currentUser } = useCurrentUser();
  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const rows = useMemo(
    () => collectMentionRows(notes, currentUser),
    [notes, currentUser],
  );
  const top3 = rows.slice(0, 3);
  const total = rows.length;

  return (
    <div className="relative h-full overflow-hidden flex flex-col">
      <div className="flex items-center gap-1.5 text-gray-500">
        <span aria-hidden="true" className="text-blue-500 flex-shrink-0">
          {CHAT_SVG}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-medium">
          @-mentions
        </span>
      </div>
      {total > 0 && (
        <span
          className="absolute top-0 right-0 text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-full font-medium"
          aria-label={`${total} mention${total === 1 ? "" : "s"}`}
        >
          {total} total
        </span>
      )}
      <div className="mt-2 flex-1 min-h-0 flex flex-col gap-2">
        {isLoading ? (
          <p className="text-xs text-gray-400 italic m-auto">Loading…</p>
        ) : top3.length === 0 ? (
          <div className="m-auto flex flex-col items-center gap-1 text-gray-400">
            <span aria-hidden="true">{EMPTY_INBOX_SVG}</span>
            <p className="text-xs italic">No mentions yet</p>
          </div>
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

/**
 * SidebarTile: slim row with chat icon + "Mentions" label + count badge.
 * Mirrors CommentFeedWidget.SidebarTile shape so the two sibling tiles
 * read consistently in the rail.
 */
export function SidebarTile({ onClick }: SidebarTileProps) {
  const { currentUser } = useCurrentUser();
  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const count = useMemo(
    () => collectMentionRows(notes, currentUser).length,
    [notes, currentUser],
  );
  return (
    <SidebarStatTile
      icon={CHAT_SVG}
      iconClassName="text-blue-500"
      label="Mentions"
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

/**
 * Mira PI R1 fix manager (Fix 3, 2026-05-25): help-badge copy for the
 * @-mentions variant of the Comments tile. Matches Chip B voice
 * (pedagogical, no em-dashes, no emojis).
 */
export const HELP_TEXT =
  "Comment threads where someone has tagged you with @. Skip to messages that need your reply.";

/** Default export: the Comments Tool popup body. Kept for back-compat
 *  with any consumer that still resolves the variant via the per-widget
 *  ExpandedView fallback path. The Tool registry is the canonical
 *  lookup. */
export default CommentFeedWidget;
