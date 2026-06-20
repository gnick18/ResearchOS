"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { labApi } from "@/lib/local-api";
import { useLabData } from "@/hooks/useLabData";
import { listAnnouncements } from "@/lib/lab/announcements";
import UserAvatar from "@/components/UserAvatar";
import { usePopupActions } from "@/lib/lab-overview/popup-actions";
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
 *   - shared-note creations (via `note.created_at` — added by the Note
 *     created_at field manager 2026-05-24) and shared-note comments
 *     (both pulled from `labApi.getNotes({ shared_only: true })`)
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

// Note created_at field manager (2026-05-24): added the "note" kind for
// shared-note creation events. Now that Note carries `created_at`, we
// can surface "Alex created 'PCR optimization' note" as its own row
// alongside the existing comment-on-note rows. The two signals are
// independent — a creation event fires once at note birth; comment
// events fire per comment thereafter.
type Kind = "comment" | "note" | "task" | "flag" | "announcement";
type Filter = "all" | Kind;
/** Phase B Batch B1: time-window selector on the ExpandedView header. */
type DateRange = "today" | "yesterday" | "week" | "all";

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
  note: "text-sky-500",
  task: "text-emerald-500",
  flag: "text-amber-500",
  announcement: "text-purple-500",
};

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  comment: "Comments",
  note: "Notes",
  task: "Tasks",
  flag: "Flags",
  announcement: "Announcements",
};

const DATE_RANGE_LABEL: Record<DateRange, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  all: "All time",
};

export default function LabActivityWidget(props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
  /** Full-width lab-overview surface: flow date groups into columns. */
  wide?: boolean;
}) {
  const wide = props?.wide;
  const { tasks } = useLabData();
  const [filter, setFilter] = useState<Filter>("all");
  // Phase B Batch B1: time-range pre-filter applied BEFORE the kind
  // filter, so the kind chips' counts reflect "of the items in this
  // window". Default "week" matches the long-tail feed expectation
  // ("recent stuff") without flooding with months of legacy task
  // creations.
  const [dateRange, setDateRange] = useState<DateRange>("week");
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
      // Note-creation event (Note created_at field manager 2026-05-24).
      // Older notes that pre-date the field are skipped — `created_at`
      // is optional + nullable on the type, and the truthiness check
      // here is the graceful-degradation path.
      if (note.created_at) {
        out.push({
          kind: "note",
          username: note.username,
          summary: `created note “${note.title || "Untitled note"}”`,
          timestamp: note.created_at,
          href: "/lab-overview",
          key: `note:${note.username}:${note.id}`,
        });
      }
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

  // Phase B Batch B1: apply the time-range pre-filter FIRST so the
  // kind-chip counts and the "Showing X of Y" indicator both reflect
  // the active window.
  const rangedItems = useMemo(
    () => filterByRange(allItems, dateRange),
    [allItems, dateRange],
  );

  const filteredItems = useMemo(() => {
    if (filter === "all") return rangedItems;
    return rangedItems.filter((i) => i.kind === filter);
  }, [rangedItems, filter]);

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
      all: rangedItems.length,
      comment: 0,
      note: 0,
      task: 0,
      flag: 0,
      announcement: 0,
    };
    for (const it of rangedItems) c[it.kind]++;
    return c;
  }, [rangedItems]);

  const stillLoading = notesLoading || announcementsLoading;
  const hasMore = visibleItems.length < filteredItems.length;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Phase B Batch B1: date-range selector. Pre-filters the feed
          before kind-chip counts are computed, so the chip counts
          always reflect "of items inside the active window". */}
      <div className="flex items-center justify-between gap-2 mb-2 flex-shrink-0 flex-wrap">
        <div
          role="tablist"
          aria-label="Date range"
          className="inline-flex border border-border rounded-full overflow-hidden bg-surface-raised"
        >
          {(["today", "yesterday", "week", "all"] as const).map((r, idx) => {
            const active = dateRange === r;
            return (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setDateRange(r);
                  setPageCount(1);
                }}
                className={`px-3 py-1 text-meta transition-colors ${
                  idx > 0 ? "border-l border-border" : ""
                } ${
                  active
                    ? "bg-gray-900 text-white dark:bg-foreground dark:text-background"
                    : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
                }`}
              >
                {DATE_RANGE_LABEL[r]}
              </button>
            );
          })}
        </div>
        <span className="text-meta text-foreground-muted tabular-nums">
          {visibleItems.length === filteredItems.length
            ? `Showing all ${filteredItems.length} event${filteredItems.length === 1 ? "" : "s"}`
            : `Showing ${visibleItems.length} of ${filteredItems.length} events`}
        </span>
      </div>

      {/* Kind filter chips with per-kind counts. */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3 flex-shrink-0">
        {(["all", "comment", "note", "task", "flag", "announcement"] as const).map(
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
                className={`px-2.5 py-1 text-meta rounded-full border transition-colors ${
                  active
                    ? "bg-gray-900 text-white border-gray-900 dark:bg-foreground dark:text-background dark:border-foreground"
                    : "bg-surface-raised text-foreground border-border hover:border-border"
                }`}
              >
                {FILTER_LABEL[f]}
                <span
                  className={`ml-1 tabular-nums ${
                    active ? "text-foreground-muted" : "text-foreground-muted"
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
          <div className="flex items-center gap-2 text-body text-foreground-muted py-6 justify-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-600" />
            Loading lab activity…
          </div>
        ) : visibleItems.length === 0 ? (
          <p className="text-body text-foreground-muted italic py-6 text-center">
            No {filter === "all" ? "activity" : FILTER_LABEL[filter].toLowerCase()}{" "}
            yet.
          </p>
        ) : (
          <div
            className={
              wide
                ? "gap-x-8 lg:columns-2 xl:columns-3 [&>section]:mb-4 [&>section]:break-inside-avoid"
                : "space-y-4"
            }
          >
            {groupedByDay.map(({ day, items }) => (
              <section key={day}>
                <h3
                  className={`text-meta uppercase tracking-wider text-foreground-muted font-semibold mb-1.5 bg-surface-raised py-1 ${
                    wide ? "" : "sticky top-0"
                  }`}
                >
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
                  className="text-meta text-foreground-muted hover:text-foreground border border-border hover:border-border rounded-full px-3 py-1 transition-colors"
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
  // popup-close hook: close the SnapshotTilePopup before navigating to
  // the linked surface so the user doesn't land back on a popup overlay.
  // No-op outside a popup.
  const { closePopup } = usePopupActions();
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
        <p className="text-meta text-foreground truncate" title={item.summary}>
          <span className="font-medium text-foreground">{item.username}</span>{" "}
          {item.summary}
        </p>
        <p className="text-meta text-foreground-muted">{formatTime(item.timestamp)}</p>
      </div>
    </div>
  );
  if (item.href) {
    return (
      <Link
        href={item.href}
        onClick={() => closePopup()}
        className="block rounded hover:bg-surface-sunken -mx-1 px-1 py-1"
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

/** Phase B Batch B1: time-window pre-filter for the activity feed. */
function filterByRange(items: FeedItem[], range: DateRange): FeedItem[] {
  if (range === "all") return items;
  const today = startOfTodayISO();
  if (range === "today") {
    return items.filter((i) => i.timestamp.slice(0, 10) === today);
  }
  if (range === "yesterday") {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yIso = y.toISOString().slice(0, 10);
    return items.filter((i) => i.timestamp.slice(0, 10) === yIso);
  }
  // "week" — last 7 days inclusive of today.
  const cutoff = isoDaysAgo(6);
  return items.filter((i) => i.timestamp.slice(0, 10) >= cutoff);
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
// Phase B Batch B1 — unique SnapshotTile + SidebarTile (Phase B Batch
// B1 manager, 2026-05-23). The snapshot tile gives the PI a 2-row
// glance: count of events today + a mini preview of the most-recent
// event (avatar + verb, truncated). The sidebar tile takes a more
// vertical shape: icon + "Activity" label + count + two stacked
// avatar pills for the most-recent actors. Both share the body's
// feed-item construction (factored into `buildFeedItems`) so the
// tile data stays in lockstep with the timeline.
// ─────────────────────────────────────────────────────────────────────
import HeroNumberTile from "./snapshot/HeroNumberTile";
import type { SidebarTileProps } from "./types";

const ACTIVITY_ICON = (
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
);

const QUIET_ICON = (
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
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15 14" />
  </svg>
);

const ACTIVITY_SIDEBAR_ICON = (
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
    <path d="M3 12a9 9 0 1 0 9-9" />
    <polyline points="3 4 3 12 11 12" />
  </svg>
);

interface FeedSources {
  tasks: ReturnType<typeof useLabData>["tasks"];
  notes: Note[];
  announcements: Awaited<ReturnType<typeof listAnnouncements>>;
}

/** Shared feed-item construction so the snapshot + sidebar tiles see
 *  exactly the same shape the ExpandedView body does. Mirrors the
 *  `allItems` useMemo in `LabActivityWidget` above. */
function buildFeedItems({ tasks, notes, announcements }: FeedSources): FeedItem[] {
  const out: FeedItem[] = [];
  for (const note of notes) {
    // Note-creation event (Note created_at field manager 2026-05-24).
    // See `allItems` above for the parallel branch + rationale.
    if (note.created_at) {
      out.push({
        kind: "note",
        username: note.username,
        summary: `created note “${note.title || "Untitled note"}”`,
        timestamp: note.created_at,
        href: "/lab-overview",
        key: `note:${note.username}:${note.id}`,
      });
    }
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
}

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

  const items = useMemo(
    () => buildFeedItems({ tasks, notes, announcements }),
    [tasks, notes, announcements],
  );
  const today = startOfTodayISO();
  const todayItems = useMemo(
    () => items.filter((i) => i.timestamp.slice(0, 10) === today),
    [items, today],
  );
  const todayCount = todayItems.length;
  const mostRecent = items[0]; // newest-first sort guaranteed by builder

  // 0 events today → muted "Quiet today" with the clock icon. Anything
  // else → big count + a 2-line preview of the most-recent event so the
  // tile is more than a number.
  if (isLoading && items.length === 0) {
    return (
      <HeroNumberTile
        icon={ACTIVITY_ICON}
        label="Lab activity"
        primary="—"
        secondary=""
        accent="calm"
      />
    );
  }

  if (todayCount === 0) {
    return (
      <HeroNumberTile
        icon={QUIET_ICON}
        label="Lab activity"
        primary="Quiet today"
        secondary={
          mostRecent
            ? `last: ${mostRecent.username} ${truncate(mostRecent.summary, 36)}`
            : "No activity yet"
        }
        accent="calm"
      />
    );
  }

  // todayCount > 0 — render the standard hero plus a custom preview
  // line. We bypass HeroNumberTile's flat layout for the "preview"
  // case so we can include an avatar inline.
  const previewItem = todayItems[0] ?? mostRecent;
  return (
    <div className="flex flex-col h-full min-h-0 gap-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span aria-hidden="true" className="text-emerald-600 dark:text-emerald-300 flex-shrink-0">
          {ACTIVITY_ICON}
        </span>
        <span className="text-meta uppercase tracking-wide text-foreground-muted font-medium truncate">
          Activity today
        </span>
      </div>
      <div className="flex-1 flex flex-col justify-center min-h-0 gap-1.5">
        <div className="text-4xl font-semibold text-emerald-700 dark:text-emerald-300 leading-none tabular-nums">
          {todayCount}
        </div>
        {previewItem && (
          <div className="flex items-start gap-1.5 min-w-0">
            <span className="flex-shrink-0 mt-0.5">
              <UserAvatar username={previewItem.username} size="sm" />
            </span>
            <p
              className="text-meta text-foreground-muted leading-tight line-clamp-2 min-w-0"
              title={`${previewItem.username} ${previewItem.summary}`}
            >
              <span className="font-medium text-foreground">{previewItem.username}</span>{" "}
              {previewItem.summary}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export const ExpandedView = LabActivityWidget;

/**
 * Lab overview PI tooltips (Chip B, 2026-05-25): help-badge copy for
 * the Lab activity feed.
 */
export const HELP_TEXT =
  "A deep, paginated feed of everything happening in the lab. Comments, task changes, flags, and announcements all interleaved by time, filterable by type.";

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

  const items = useMemo(
    () => buildFeedItems({ tasks, notes, announcements }),
    [tasks, notes, announcements],
  );
  const today = startOfTodayISO();
  const todayItems = useMemo(
    () => items.filter((i) => i.timestamp.slice(0, 10) === today),
    [items, today],
  );
  const todayCount = todayItems.length;

  // Stack the two most-recent unique actors as avatar pills (no text).
  // We pull from the full feed (not just `todayItems`) so the row
  // never reads empty when the lab is quiet today but has activity in
  // recent days.
  const recentActors = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const it of items) {
      if (seen.has(it.username)) continue;
      seen.add(it.username);
      out.push(it.username);
      if (out.length === 2) break;
    }
    return out;
  }, [items]);

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
      className={`w-full flex flex-col gap-1.5 px-2.5 py-2 rounded-md transition-colors ${
        interactive
          ? "cursor-pointer hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none"
          : ""
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span aria-hidden="true" className="text-emerald-600 dark:text-emerald-300 flex-shrink-0 flex items-center justify-center">
          {ACTIVITY_SIDEBAR_ICON}
        </span>
        <span className="text-meta font-medium text-foreground truncate flex-1 min-w-0">
          Activity
        </span>
        <span className="text-body font-semibold text-foreground tabular-nums flex-shrink-0">
          {isLoading ? "—" : `${todayCount} today`}
        </span>
      </div>
      {recentActors.length > 0 && (
        <div className="flex items-center gap-1 pl-6">
          {recentActors.map((username) => (
            <span key={username} title={username} className="block">
              <UserAvatar username={username} size="sm" />
            </span>
          ))}
          <span className="text-meta text-foreground-muted truncate">
            recent
          </span>
        </div>
      )}
    </div>
  );
}

/** Local truncate to avoid pulling in a util just for the preview text. */
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
