"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { labApi } from "@/lib/local-api";
import { useLabData } from "@/hooks/useLabData";
import { listAnnouncements } from "@/lib/lab/announcements";
import UserAvatar from "@/components/UserAvatar";
import type { Note } from "@/lib/types";

/**
 * Lab Mode retirement R3 (R3 widget catalog manager, 2026-05-23):
 * compact recent-activity feed for the customizable sidebar. Replaces
 * the R2 stub.
 *
 * Aggregates the newest signals across the lab into a single 6-row
 * feed, newest first:
 *   - new comments (on shared notes + tasks that carry comments)
 *   - new task creations (proxy: tasks whose start_date is the most
 *     recent — LabTask doesn't denormalize a created_at, so we use
 *     start_date as a "scheduling date" proxy)
 *   - flagged records (records with `flagged?.at` recent)
 *   - new announcements (read via listAnnouncements)
 *
 * Shares (R1b sharing primitive): there's no cross-lab "shared_with
 * mutation feed" today; the share event isn't durably journaled. The
 * R5 brief noted this as aspirational. Skipped here rather than fake
 * it — the comment / task / flag / announcement signal already
 * over-covers the "what's new" intent.
 *
 * Compact UX: top 6 rows, icon + avatar + 1-line summary + relative
 * time. Clicking an item opens the surface that owns it (Lab
 * Overview's announcements widget, the lab inbox, etc.). Sidebar
 * width is narrow so labels truncate aggressively.
 */
// Note created_at field manager (2026-05-24): added the "note" kind
// for shared-note creation events. Now that Note carries `created_at`,
// the sidebar feed surfaces note births as their own row instead of
// only the downstream comment activity.
type Kind = "comment" | "note" | "task" | "flag" | "announcement";

interface FeedItem {
  kind: Kind;
  /** Username (avatar source) — the user the row "belongs to". */
  username: string;
  /** Short summary text, truncated to one line at render time. */
  summary: string;
  /** ISO timestamp used for sort + relative-time display. */
  timestamp: string;
  /** Optional target route on click — falls back to /lab-overview. */
  href?: string;
}

/**
 * Inline SVG icons (project does not depend on lucide-react). Each
 * icon renders inside a 14px square next to the activity row. Stroke
 * inherits `currentColor` so the parent's text color drives the tint.
 * Replaces the earlier emoji set (Grant rule: no emojis in production
 * UI, they read tacky on the dashboard).
 */
const KIND_ICON: Record<Kind, React.ReactElement> = {
  // chat bubble (comment)
  comment: (
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
  ),
  // document — note-creation event (Note created_at field manager 2026-05-24)
  note: (
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
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="14" y2="17" />
    </svg>
  ),
  // beaker (task / experiment)
  task: (
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
      <path d="M10 2v7.31" />
      <path d="M14 9.3V2" />
      <path d="M8.5 2h7" />
      <path d="M14 9.3a6.5 6.5 0 1 1-4 0" />
    </svg>
  ),
  // flag
  flag: (
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
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  ),
  // megaphone (announcement)
  announcement: (
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
      <path d="M3 11l18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </svg>
  ),
};

const KIND_ICON_COLOR: Record<Kind, string> = {
  comment: "text-blue-500",
  note: "text-sky-500",
  task: "text-emerald-500",
  flag: "text-amber-500",
  announcement: "text-purple-500",
};

export default function RecentActivityWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  const { tasks } = useLabData();

  // Shared notes (carry their `.comments` field — same query the
  // CommentFeedWidget uses, so the cache is warm).
  const { data: notes = [] } = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Announcements — same key the canvas + sidebar TodaysAnnouncements
  // widget uses, so it dedupes through React Query.
  const { data: announcements = [] } = useQuery({
    queryKey: ["lab-announcements"],
    queryFn: listAnnouncements,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const items: FeedItem[] = useMemo(() => {
    const out: FeedItem[] = [];

    // Comments on shared notes. We don't pull task comments here —
    // CommentFeedWidget owns that deeper fetch, and the cost (one
    // `tasksApi.get` per lab task) is not worth paying just for a
    // 6-row sidebar feed. Note-creation events (Note created_at field
    // manager 2026-05-24) come from the same query: `note.created_at`
    // is the canonical signal, older notes without it are skipped.
    for (const note of notes) {
      if (note.created_at) {
        out.push({
          kind: "note",
          username: note.username,
          summary: `created note “${note.title || "Untitled note"}”`,
          timestamp: note.created_at,
          href: "/lab-overview",
        });
      }
      for (const c of note.comments ?? []) {
        out.push({
          kind: "comment",
          username: c.author,
          summary: `commented on “${note.title || "Untitled note"}”`,
          timestamp: c.created_at,
          href: "/lab-overview",
        });
      }
    }

    // Newly created tasks — LabTask has no `created_at`, so we use
    // `start_date` as a "newest-scheduled" proxy. Filter to entries
    // within the last 30 days so this section doesn't get drowned by
    // ancient backfilled tasks.
    const cutoff = isoDaysAgo(30);
    for (const t of tasks) {
      if (!t.start_date) continue;
      if (t.start_date < cutoff) continue;
      const label =
        t.task_type === "experiment"
          ? "started experiment"
          : t.task_type === "purchase"
            ? "added purchase"
            : "added task";
      out.push({
        kind: "task",
        username: t.username,
        summary: `${label}: ${t.name}`,
        // Promote the date to a 00:00:00 ISO so the relative-time
        // formatter handles it the same as full timestamps.
        timestamp: `${t.start_date}T00:00:00`,
        href: "/lab-overview",
      });
    }

    // Flagged tasks. The `flagged` field is present on LabTask via the
    // raw `Task` shape it comes from, but LabTask doesn't surface it.
    // We probe at the loose typing layer — TasksWidget reads the same
    // way. Notes are skipped for the same reason as task comments
    // (extra per-record fetch not justified for a 6-row sidebar).
    for (const t of tasks as Array<typeof tasks[number] & { flagged?: { by: string; at: string; reason?: string | null } | null }>) {
      const flag = t.flagged;
      if (!flag || !flag.at) continue;
      out.push({
        kind: "flag",
        username: flag.by,
        summary: `flagged ${t.task_type === "purchase" ? "purchase" : t.task_type === "experiment" ? "experiment" : "task"}: ${t.name}`,
        timestamp: flag.at,
        href: "/lab-overview",
      });
    }

    // Announcements.
    for (const a of announcements) {
      out.push({
        kind: "announcement",
        username: a.author,
        summary:
          a.text.split("\n")[0].slice(0, 80) +
          (a.text.length > 80 || a.text.includes("\n") ? "…" : ""),
        timestamp: a.created_at,
        href: "/lab-overview",
      });
    }

    // Newest first, take 6.
    out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return out.slice(0, 6);
  }, [notes, tasks, announcements]);

  if (items.length === 0) {
    return (
      <div className="text-xs text-gray-400 italic">
        No recent activity yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="space-y-1.5">
        {items.map((item, i) => {
          const row = (
            <div className="flex items-start gap-1.5 min-w-0">
              <span
                aria-hidden="true"
                className={`flex-shrink-0 mt-0.5 ${KIND_ICON_COLOR[item.kind]}`}
                title={item.kind}
              >
                {KIND_ICON[item.kind]}
              </span>
              <div className="flex-shrink-0">
                <UserAvatar username={item.username} size="sm" />
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className="text-xs text-gray-700 truncate"
                  title={item.summary}
                >
                  <span className="font-medium text-gray-900">
                    {item.username}
                  </span>{" "}
                  {item.summary}
                </p>
                <p className="text-[10px] text-gray-400">
                  {formatRelative(item.timestamp)}
                </p>
              </div>
            </div>
          );
          return (
            <li key={`${item.kind}:${item.username}:${item.timestamp}:${i}`}>
              {item.href ? (
                <Link
                  href={item.href}
                  className="block rounded hover:bg-gray-50 -mx-1 px-1 py-1"
                >
                  {row}
                </Link>
              ) : (
                row
              )}
            </li>
          );
        })}
      </ul>
      {/* Phase B Batch B3: footer link to the deep canvas feed.
       *
       * The compact sidebar widget shows the 6 most-recent rows; the
       * deeper feed (filters, day-grouped headers, infinite-scroll)
       * lives in `LabActivityWidget` on the canvas. There's no global
       * registry → popup event channel today, so we link to the canvas
       * route and let the user click the lab-activity tile. A future
       * pass could surface a `?widget=lab-activity` query the canvas
       * auto-opens, but that's a registry-shape change that's out of
       * scope for this batch.
       *
       * FOLLOW-UP: wire a `?widget=<id>` autoload param on the canvas
       * so this link opens the lab-activity popup directly. Tracked
       * with a sub-bot chip when the canvas surface owner picks it up.
       */}
      <Link
        href="/lab-overview"
        className="text-[11px] text-blue-600 hover:text-blue-700 hover:underline self-start pl-1"
      >
        View full activity
      </Link>
    </div>
  );
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatRelative(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
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
// Phase B Batch B3 (Phase B Batch B3 manager, 2026-05-23): unique
// per-widget tile designs.
// ─────────────────────────────────────────────────────────────────────────────
// The widget body above is unchanged from R3 + the emoji-SVG sweep
// (KIND_ICON + KIND_ICON_COLOR maps preserved). Phase A shipped a
// generic <StatTile> placeholder ("12 events in the last 7 days");
// Phase B replaces it with a mini-feed: a 3-row preview of the same
// rows the ExpandedView shows. Reads the exact same React Query keys,
// so the cache is dedupes one fetch across surfaces.
import type { SnapshotTileProps, SidebarTileProps } from "./types";

/**
 * Shared aggregator used by both tiles. Mirrors the body's logic but
 * returns the items list directly so the tiles can render the top-N
 * preview rows themselves (a count alone doesn't convey "what's new").
 */
function useRecentItems() {
  const { tasks } = useLabData();
  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const { data: announcements = [] } = useQuery({
    queryKey: ["lab-announcements"],
    queryFn: listAnnouncements,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const items = useMemo(() => {
    const out: FeedItem[] = [];
    for (const note of notes) {
      // Note-creation event (Note created_at field manager 2026-05-24).
      // Older notes without `created_at` fall through gracefully.
      if (note.created_at) {
        out.push({
          kind: "note",
          username: note.username,
          summary: `created note “${note.title || "Untitled note"}”`,
          timestamp: note.created_at,
        });
      }
      for (const c of note.comments ?? []) {
        out.push({
          kind: "comment",
          username: c.author,
          summary: `commented on “${note.title || "Untitled note"}”`,
          timestamp: c.created_at,
        });
      }
    }
    const cutoff = isoDaysAgo(30);
    for (const t of tasks) {
      if (!t.start_date) continue;
      if (t.start_date < cutoff) continue;
      const label =
        t.task_type === "experiment"
          ? "started experiment"
          : t.task_type === "purchase"
            ? "added purchase"
            : "added task";
      out.push({
        kind: "task",
        username: t.username,
        summary: `${label}: ${t.name}`,
        timestamp: `${t.start_date}T00:00:00`,
      });
    }
    type WithFlag = { flagged?: { by: string; at: string } | null };
    for (const t of tasks as Array<typeof tasks[number] & WithFlag>) {
      const flag = t.flagged;
      if (!flag || !flag.at) continue;
      out.push({
        kind: "flag",
        username: flag.by,
        summary: `flagged ${
          t.task_type === "purchase"
            ? "purchase"
            : t.task_type === "experiment"
              ? "experiment"
              : "task"
        }: ${t.name}`,
        timestamp: flag.at,
      });
    }
    for (const a of announcements) {
      out.push({
        kind: "announcement",
        username: a.author,
        summary:
          a.text.split("\n")[0].slice(0, 80) +
          (a.text.length > 80 || a.text.includes("\n") ? "…" : ""),
        timestamp: a.created_at,
      });
    }
    out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return out;
  }, [notes, tasks, announcements]);
  // "today" cutoff = midnight ISO. Used to badge "X today" on the
  // snapshot tile so the eye latches onto fresh activity even when
  // the all-time count is large.
  const todayCutoff = new Date();
  todayCutoff.setHours(0, 0, 0, 0);
  const todayIso = todayCutoff.toISOString();
  const todayCount = items.filter((it) => it.timestamp >= todayIso).length;
  return { items, todayCount, isLoading };
}

/**
 * Truncate a feed row's summary so the snapshot tile reads as a
 * scannable mini-feed. Brief specs ~30 chars; we leave a little
 * headroom for the avatar + ellipsis.
 */
function trimSummary(s: string, max = 32): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

export function SnapshotTile(_props: SnapshotTileProps) {
  const { items, todayCount, isLoading } = useRecentItems();
  // 3-row preview (brief: "3 most-recent items"). The tile itself is
  // the click target — the canvas wraps each tile in a clickable
  // <Widget> frame, so we don't wrap rows in Links here.
  const preview = items.slice(0, 3);
  return (
    <div className="flex flex-col h-full min-h-0 gap-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden="true"
          className="flex items-center justify-center flex-shrink-0 text-blue-500"
        >
          {/* clock icon — "recent" semantic distinct from the chat
              icon the rows already carry */}
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
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </span>
        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-medium truncate flex-1">
          Recent activity
        </span>
        {todayCount > 0 && (
          <span className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 flex-shrink-0">
            {todayCount} today
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0 flex flex-col justify-center">
        {isLoading ? (
          <div className="text-xs text-gray-400">Loading…</div>
        ) : preview.length === 0 ? (
          <div className="text-xs text-gray-400 italic">Quiet right now</div>
        ) : (
          <ul className="space-y-1">
            {preview.map((item, i) => (
              <li
                key={`${item.kind}:${item.username}:${item.timestamp}:${i}`}
                className="flex items-center gap-1.5 min-w-0"
              >
                <span
                  aria-hidden="true"
                  className={`flex-shrink-0 ${KIND_ICON_COLOR[item.kind]}`}
                  title={item.kind}
                >
                  {KIND_ICON[item.kind]}
                </span>
                <span className="flex-shrink-0">
                  <UserAvatar username={item.username} size="sm" />
                </span>
                <span
                  className="text-[11px] text-gray-700 truncate min-w-0 flex-1"
                  title={item.summary}
                >
                  {trimSummary(item.summary)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export const ExpandedView = RecentActivityWidget;

// ─────────────────────────────────────────────────────────────────────────────
// SidebarTile — narrow vertical 2-row preview.
// ─────────────────────────────────────────────────────────────────────────────
// Brief: top row = clock-arrow icon + "Activity" label; bottom row =
// most-recent item one-liner with avatar + relative time. Shares the
// useRecentItems hook so React Query dedupes the fetches.

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { items, isLoading } = useRecentItems();
  const newest = items[0];
  const interactive = !!onClick;
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={`w-full flex flex-col gap-1 px-2.5 py-2 rounded-md transition-colors ${
        interactive
          ? "cursor-pointer hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
          : ""
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden="true"
          className="flex items-center justify-center flex-shrink-0 text-blue-500"
        >
          {/* clock-with-arrow icon — "recent + history" affordance */}
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
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <polyline points="3 4 3 10 9 10" />
            <polyline points="12 7 12 12 15 14" />
          </svg>
        </span>
        <span className="text-xs font-medium text-gray-700 truncate flex-1 min-w-0">
          Activity
        </span>
      </div>
      {isLoading ? (
        <div className="text-[10px] text-gray-400 pl-6">Loading…</div>
      ) : !newest ? (
        <div className="text-[10px] text-gray-400 italic pl-6">
          Quiet right now
        </div>
      ) : (
        <div className="flex items-center gap-1.5 pl-6 min-w-0">
          <span className="flex-shrink-0">
            <UserAvatar username={newest.username} size="sm" />
          </span>
          <span
            className="text-[10px] text-gray-600 truncate min-w-0 flex-1"
            title={newest.summary}
          >
            {trimSummary(newest.summary, 24)}
          </span>
          <span className="text-[10px] text-gray-400 flex-shrink-0 tabular-nums">
            {formatRelative(newest.timestamp)}
          </span>
        </div>
      )}
    </div>
  );
}
