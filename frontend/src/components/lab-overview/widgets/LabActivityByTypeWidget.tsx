"use client";

/**
 * Tool variants batch (Tool variants batch manager, 2026-05-24): the
 * `by-type` variant of the Lab Activity Tool.
 *
 * Splits today's activity (last 24h, anchored at start-of-today) into
 * three at-a-glance buckets: Tasks, Notes, Purchases. The intent is a
 * visual rhythm of "what kind of work happened today" without scrolling
 * the full timeline.
 *
 * Wiring: Tool = `lab-activity`, variantId = `by-type`. Clicking the
 * tile opens the same Lab Activity popup (LabActivityWidget
 * ExpandedView) as the canonical activity tile.
 *
 * Data sources (all shared with canonical siblings via React Query):
 *   - `useLabData().tasks` (tasks + purchases — purchase items live on
 *     purchase-type tasks, but we count by task.task_type to keep the
 *     three buckets cleanly separated)
 *   - `["lab", "notes-shared"]` for note-creations: the Notes bucket
 *     counts shared notes whose own `note.created_at` falls on today,
 *     not note-comments. The Note created_at field manager (2026-05-24)
 *     added the field so we can count true creations instead of the
 *     prior comment-timestamp stopgap (a freshly-created note with no
 *     comments now registers as activity). Old on-disk notes that
 *     pre-date the field read as `undefined` and never match today's
 *     filter, which is fine — they weren't visible under the stopgap
 *     either.
 *
 * "Today" = the last 24h, but anchored at start-of-today (00:00 local).
 * This matches the canonical LabActivityWidget SnapshotTile's
 * `todayItems` definition so the variant's totals roll up to the same
 * count the canonical tile shows in its hero number.
 *
 * Canvas + home surface (member-relevant: at-a-glance lab pulse;
 * PI-relevant: same signal at higher density).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { labApi } from "@/lib/local-api";
import { useLabData } from "@/hooks/useLabData";
import type { Note } from "@/lib/types";
import type { SidebarTileProps, SnapshotTileProps } from "./types";
import SidebarStatTile from "./snapshot/SidebarStatTile";
import LabActivityWidget from "./LabActivityWidget";

void LabActivityWidget;

// ── Icons ────────────────────────────────────────────────────────────────

/** Activity bolt — sidebar icon. */
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
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

/** Beaker — Tasks bucket (matches LabActivityWidget KIND_ICON.task). */
const TASKS_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
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
);

/** Document — Notes bucket. */
const NOTES_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
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
);

/** Dollar sign — Purchases bucket. */
const PURCHASES_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
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

// ── Bucketing helpers ────────────────────────────────────────────────────

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

interface BucketCounts {
  tasks: number;
  notes: number;
  purchases: number;
}

/**
 * Build today's by-type counts from the same data sources the canonical
 * LabActivityWidget consumes. Same time-window definition (anchored at
 * start-of-today) so the per-bucket totals roll up to the canonical
 * tile's `todayCount`.
 *
 * Buckets:
 *   - tasks: task_type === "experiment" or "list" with start_date === today
 *     (mirrors canonical "added task / experiment started" rows)
 *   - notes: notes whose `created_at` falls on today's date. The Note
 *     created_at field manager (2026-05-24) added the field so we count
 *     true note creations instead of the prior note-comment proxy. Old
 *     notes (no `created_at`) are skipped gracefully — they never match
 *     today's filter, which is the intended degradation.
 *   - purchases: task_type === "purchase" with start_date === today
 *     (purchase items don't carry timestamps; the parent task's
 *     start_date is the canonical proxy LabActivityWidget already uses)
 */
function countByType(
  tasks: ReturnType<typeof useLabData>["tasks"],
  notes: Note[],
): BucketCounts {
  const today = startOfTodayIso();
  let tasksCount = 0;
  let purchasesCount = 0;
  let notesCount = 0;

  for (const t of tasks) {
    if (!t.start_date) continue;
    if (t.start_date !== today) continue;
    if (t.task_type === "purchase") {
      purchasesCount++;
    } else {
      tasksCount++;
    }
  }

  for (const n of notes) {
    if (n.created_at && n.created_at.startsWith(today)) {
      notesCount++;
    }
  }

  return { tasks: tasksCount, notes: notesCount, purchases: purchasesCount };
}

// ── Tile column ──────────────────────────────────────────────────────────

interface ColumnProps {
  icon: React.ReactNode;
  iconColor: string;
  count: number;
  label: string;
}

function Column({ icon, iconColor, count, label }: ColumnProps) {
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center justify-between gap-1 px-1">
      <span aria-hidden="true" className={`flex-shrink-0 ${iconColor}`}>
        {icon}
      </span>
      <span className="text-2xl font-semibold text-gray-800 tabular-nums leading-none">
        {count}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-gray-500 font-medium truncate w-full text-center">
        {label}
      </span>
    </div>
  );
}

// ── Snapshot + Sidebar tiles ─────────────────────────────────────────────

/**
 * SnapshotTile: three columns (Tasks / Notes / Purchases) with subtle
 * vertical dividers. Each column shows an icon at the top, a count in
 * the middle, and a label at the bottom. When all three counts are 0
 * we collapse to a single "Quiet day" empty state spanning the tile
 * width.
 */
export function SnapshotTile(_props: SnapshotTileProps) {
  const { tasks } = useLabData();
  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const counts = useMemo(() => countByType(tasks, notes), [tasks, notes]);
  const total = counts.tasks + counts.notes + counts.purchases;

  return (
    <div className="relative h-full overflow-hidden flex flex-col">
      <div className="flex items-center gap-1.5 text-gray-500">
        <span aria-hidden="true" className="text-emerald-600 flex-shrink-0">
          {ACTIVITY_SIDEBAR_ICON}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-medium">
          Activity by area
        </span>
      </div>
      <div className="mt-2 flex-1 min-h-0 flex flex-col">
        {isLoading && total === 0 ? (
          <p className="text-xs text-gray-400 italic m-auto">Loading…</p>
        ) : total === 0 ? (
          <div className="m-auto flex flex-col items-center gap-1 text-gray-400">
            <span aria-hidden="true">{QUIET_ICON}</span>
            <p className="text-xs italic">Quiet day</p>
          </div>
        ) : (
          <div className="flex items-stretch divide-x divide-gray-100 h-full">
            <Column
              icon={TASKS_ICON}
              iconColor="text-emerald-500"
              count={counts.tasks}
              label="Tasks"
            />
            <Column
              icon={NOTES_ICON}
              iconColor="text-blue-500"
              count={counts.notes}
              label="Notes"
            />
            <Column
              icon={PURCHASES_ICON}
              iconColor="text-amber-500"
              count={counts.purchases}
              label="Purchases"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * SidebarTile: the rail is too narrow for three columns. Collapse to a
 * single row: total event count + the dominant area name. When the day
 * is quiet, fall back to a sum-of-zeros message.
 */
export function SidebarTile({ onClick }: SidebarTileProps) {
  const { tasks } = useLabData();
  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const counts = useMemo(() => countByType(tasks, notes), [tasks, notes]);
  const total = counts.tasks + counts.notes + counts.purchases;

  // Dominant area (largest bucket). Ties resolved by the declaration
  // order tasks > notes > purchases — matches the column order so the
  // sidebar reads consistently with the snapshot tile.
  let dominant: "tasks" | "notes" | "purchases" = "tasks";
  if (counts.notes > counts.tasks && counts.notes >= counts.purchases) {
    dominant = "notes";
  } else if (
    counts.purchases > counts.tasks &&
    counts.purchases > counts.notes
  ) {
    dominant = "purchases";
  }

  const statText =
    isLoading && total === 0
      ? "—"
      : total === 0
        ? "Quiet"
        : `${total} today`;

  const subText =
    total === 0
      ? undefined
      : `mostly ${dominant}`;

  return (
    <SidebarStatTile
      icon={ACTIVITY_SIDEBAR_ICON}
      iconClassName="text-emerald-600"
      label="By area"
      stat={statText}
      sub={subText}
      onClick={onClick}
    />
  );
}

/** Default export: the Lab Activity Tool popup body (back-compat
 *  fallback; Tool registry is canonical). */
export default LabActivityWidget;
