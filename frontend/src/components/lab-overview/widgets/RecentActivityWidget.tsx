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
type Kind = "comment" | "task" | "flag" | "announcement";

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

const KIND_ICON: Record<Kind, string> = {
  comment: "💬",
  task: "🧪",
  flag: "🚩",
  announcement: "📣",
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
    // 6-row sidebar feed.
    for (const note of notes) {
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
    <ul className="space-y-1.5">
      {items.map((item, i) => {
        const row = (
          <div className="flex items-start gap-1.5 min-w-0">
            <span
              aria-hidden="true"
              className="text-xs flex-shrink-0 mt-0.5"
              title={item.kind}
            >
              {KIND_ICON[item.kind]}
            </span>
            <div className="flex-shrink-0">
              <UserAvatar username={item.username} size="sm" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-700 truncate" title={item.summary}>
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
