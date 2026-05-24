"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { labApi } from "@/lib/local-api";
import { useLabData } from "@/hooks/useLabData";
import { listAnnouncements } from "@/lib/lab/announcements";
import UserAvatar from "@/components/UserAvatar";
import StatTile from "./snapshot/StatTile";
import type { Note } from "@/lib/types";
import type { SnapshotTileProps } from "./types";

/**
 * Widget catalog cleanup (widget catalog cleanup manager, 2026-05-23):
 * canvas-surface, comprehensive activity feed. Modelled on the deleted
 * R5 `LabActivityPanel` (the "old activity page" Grant misses) and on
 * the data layer of the sidebar `RecentActivityWidget`, but rendered
 * as a deep, scrollable timeline rather than a compact 6-row tile.
 *
 * The compact sidebar widget remains for at-a-glance "what's new";
 * this canvas widget is the full feed for lab heads (and shared-folder
 * members) who want to drill into everything happening across the lab.
 *
 * Aggregation buckets. Same signals as the sidebar widget so the
 * caches stay shared:
 *   - shared-note comments (via `labApi.getNotes({ shared_only: true })`)
 *   - newly scheduled tasks (proxied off `start_date` since LabTask
 *     has no `created_at`)
 *   - flagged records (the `flagged` sidecar on tasks)
 *   - announcements (via `listAnnouncements`)
 *
 * UX:
 *   - default 30 rows, "Load more" appends another 30 at a time
 *   - filter chips at the top: All / Comments / Tasks / Flags /
 *     Announcements
 *   - day-grouped headers ("Today", "Yesterday", "Mon Apr 14") so the
 *     feed reads chronologically even at long range
 *
 * `memberVisible: true` in the registry. Even though some buckets
 * (flags) are PI-leaning, the existing sidebar `RecentActivityWidget`
 * already surfaces flag rows to members and nothing here exposes
 * lab-head-only fields. If a future refinement adds PI-only signals
 * (purchase approvals, audit entries) the catalog entry should be
 * flipped to `memberVisible: false`.
 */

type Kind = "comment" | "task" | "flag" | "announcement";
type Filter = "all" | Kind;

interface FeedItem {
  kind: Kind;
  username: string;
  /** Short summary text. Truncated at render time. */
  summary: string;
  /** ISO timestamp used for sort + grouping. */
  timestamp: string;
  /** Optional target route on click. */
  href?: string;
  /** Stable key, caller derives it once. */
  key: string;
}

const PAGE_SIZE = 30;

const KIND_ICON: Record<Kind, React.ReactElement> = {
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
  task: "text-emerald-500",
  flag: "text-amber-500",
  announcement: "text-purple-500",
};

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  comment: "Comments",
  task: "Tasks",
  flag: "Flags",
  announcement: "Announcements",
};

export default function LabActivityWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  const { tasks } = useLabData();
  const [filter, setFilter] = useState<Filter>("all");
  const [pageCount, setPageCount] = useState(1);

  const { data: notes = [], isLoading: notesLoading } = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: announcements = [], isLoading: announcementsLoading } =
    useQuery({
      queryKey: ["lab-announcements"],
      queryFn: listAnnouncements,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    });

  const allItems: FeedItem[] = useMemo(() => {
    const out: FeedItem[] = [];

    for (const note of notes) {
      for (const c of note.comments ?? []) {
        out.push({
          kind: "comment",
          username: c.author,
          summary: `commented on “${note.title || "Untitled note"}”`,
          timestamp: c.created_at,
          href: "/lab-overview",
          key: `comment:${note.username}:${note.id}:${c.id}`,
        });
      }
    }

    for (const t of tasks) {
      if (!t.start_date) continue;
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
        href: "/lab-overview",
        key: `task:${t.username}:${t.id}`,
      });
    }

    // Flagged tasks. The `flagged` field is on the underlying `Task`
    // shape; LabTask doesn't surface it, so we widen the type locally
    // (same trick the sidebar RecentActivityWidget + PiActionsWidget
    // use). Skipping flagged notes / purchase items here for the same
    // reason the sidebar widget skips them: the extra per-record fetch
    // is not justified for the timeline.
    for (const t of tasks as Array<
      typeof tasks[number] & {
        flagged?: { by: string; at: string; reason?: string | null } | null;
      }
    >) {
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
        href: "/lab-overview",
        key: `flag:${t.username}:${t.id}:${flag.at}`,
      });
    }

    for (const a of announcements) {
      out.push({
        kind: "announcement",
        username: a.author,
        summary:
          a.text.split("\n")[0].slice(0, 120) +
          (a.text.length > 120 || a.text.includes("\n") ? "…" : ""),
        timestamp: a.created_at,
        href: "/lab-overview",
        key: `announcement:${a.id}`,
      });
    }

    out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return out;
  }, [notes, tasks, announcements]);

  const filteredItems = useMemo(() => {
    if (filter === "all") return allItems;
    return allItems.filter((i) => i.kind === filter);
  }, [allItems, filter]);

  const visibleItems = useMemo(
    () => filteredItems.slice(0, pageCount * PAGE_SIZE),
    [filteredItems, pageCount],
  );

  const groupedByDay = useMemo(
    () => groupByDay(visibleItems),
    [visibleItems],
  );

  const counts: Record<Filter, number> = useMemo(() => {
    const c: Record<Filter, number> = {
      all: allItems.length,
      comment: 0,
      task: 0,
      flag: 0,
      announcement: 0,
    };
    for (const it of allItems) c[it.kind]++;
    return c;
  }, [allItems]);

  const stillLoading = notesLoading || announcementsLoading;
  const hasMore = visibleItems.length < filteredItems.length;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3 flex-shrink-0">
        {(["all", "comment", "task", "flag", "announcement"] as const).map(
          (f) => {
            const active = filter === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setFilter(f);
                  setPageCount(1);
                }}
                className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
                  active
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
                }`}
              >
                {FILTER_LABEL[f]}
                <span
                  className={`ml-1 tabular-nums ${
                    active ? "text-gray-300" : "text-gray-400"
                  }`}
                >
                  {counts[f]}
                </span>
              </button>
            );
          },
        )}
      </div>

      {/* Feed body */}
      <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
        {stillLoading && allItems.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-600" />
            Loading lab activity…
          </div>
        ) : visibleItems.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-6 text-center">
            No {filter === "all" ? "activity" : FILTER_LABEL[filter].toLowerCase()}{" "}
            yet.
          </p>
        ) : (
          <div className="space-y-4">
            {groupedByDay.map(({ day, items }) => (
              <section key={day}>
                <h3 className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5 sticky top-0 bg-white py-1">
                  {day}
                </h3>
                <ul className="space-y-1">
                  {items.map((item) => (
                    <li key={item.key}>
                      <ActivityRow item={item} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {hasMore && (
              <div className="pt-2 pb-1 flex justify-center">
                <button
                  type="button"
                  onClick={() => setPageCount((c) => c + 1)}
                  className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 rounded-full px-3 py-1 transition-colors"
                >
                  Load more
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityRow({ item }: { item: FeedItem }) {
  const body = (
    <div className="flex items-start gap-2 min-w-0">
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
        <p className="text-xs text-gray-700 truncate" title={item.summary}>
          <span className="font-medium text-gray-900">{item.username}</span>{" "}
          {item.summary}
        </p>
        <p className="text-[10px] text-gray-400">{formatTime(item.timestamp)}</p>
      </div>
    </div>
  );
  if (item.href) {
    return (
      <Link
        href={item.href}
        className="block rounded hover:bg-gray-50 -mx-1 px-1 py-1"
      >
        {body}
      </Link>
    );
  }
  return <div className="-mx-1 px-1 py-1">{body}</div>;
}

// ── Helpers ───────────────────────────────────────────────────────────

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatTime(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function dayLabel(iso: string): string {
  const today = startOfTodayISO();
  const date = iso.slice(0, 10);
  if (date === today) return "Today";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (date === y.toISOString().slice(0, 10)) return "Yesterday";
  try {
    return new Date(`${date}T00:00:00`).toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year:
        new Date(`${date}T00:00:00`).getFullYear() === new Date().getFullYear()
          ? undefined
          : "numeric",
    });
  } catch {
    return date;
  }
}

interface DayBucket {
  day: string;
  items: FeedItem[];
}

function groupByDay(items: FeedItem[]): DayBucket[] {
  const buckets = new Map<string, FeedItem[]>();
  for (const it of items) {
    const day = dayLabel(it.timestamp);
    const list = buckets.get(day) ?? [];
    list.push(it);
    buckets.set(day, list);
  }
  // Preserve insertion order (already newest-first via the source sort)
  // so the bucket headers come out in the right order.
  return Array.from(buckets, ([day, list]) => ({ day, items: list }));
}

// ─────────────────────────────────────────────────────────────────────
// Phase A snapshot + expanded contract
// ─────────────────────────────────────────────────────────────────────

export function SnapshotTile(_props: SnapshotTileProps) {
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

  // Headline reads "X events today". The snapshot's job is to signal
  // current-day activity volume. Comments + announcements are stamped
  // with full ISO timestamps; tasks use start_date as a "scheduled on
  // this day" proxy (same convention as the body + the sidebar
  // RecentActivityWidget).
  const today = startOfTodayISO();
  const cutoff24h = isoDaysAgo(0);
  // Match the comment-counting precision used by the body (full
  // timestamp). For tasks + announcements we count anything stamped
  // today.
  let todayCount = 0;
  for (const n of notes) {
    for (const c of n.comments ?? []) {
      if (c.created_at && c.created_at.slice(0, 10) === today) todayCount++;
    }
  }
  for (const t of tasks) {
    if (t.start_date && t.start_date >= cutoff24h) todayCount++;
  }
  for (const a of announcements) {
    if (a.created_at && a.created_at.slice(0, 10) === today) todayCount++;
  }

  return (
    <StatTile
      icon={
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      }
      iconClassName="text-emerald-600"
      label="Lab activity"
      stat={isLoading ? "—" : todayCount}
      sub={
        todayCount === 0
          ? "Quiet today"
          : `event${todayCount === 1 ? "" : "s"} today`
      }
    />
  );
}

export const ExpandedView = LabActivityWidget;

// ─────────────────────────────────────────────────────────────────────────────
// SidebarTile (customizable PI sidebar manager #146, 2026-05-23)
// ─────────────────────────────────────────────────────────────────────────────
import SidebarStatTile from "./snapshot/SidebarStatTile";
import type { SidebarTileProps } from "./types";

export function SidebarTile({ onClick }: SidebarTileProps) {
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
  const today = startOfTodayISO();
  const cutoff24h = isoDaysAgo(0);
  let todayCount = 0;
  for (const n of notes) {
    for (const c of n.comments ?? []) {
      if (c.created_at && c.created_at.slice(0, 10) === today) todayCount++;
    }
  }
  for (const t of tasks) {
    if (t.start_date && t.start_date >= cutoff24h) todayCount++;
  }
  for (const a of announcements) {
    if (a.created_at && a.created_at.slice(0, 10) === today) todayCount++;
  }
  return (
    <SidebarStatTile
      icon={
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
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      }
      iconClassName="text-emerald-600"
      label="Activity today"
      stat={isLoading ? "—" : todayCount}
      sub={todayCount === 0 ? "Quiet today" : undefined}
      onClick={onClick}
    />
  );
}
