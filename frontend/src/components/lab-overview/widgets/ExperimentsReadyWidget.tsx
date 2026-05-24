"use client";

/**
 * Tool variants batch (Tool variants batch manager, 2026-05-24): the
 * `ready-writeup` variant of the Experiments Tool.
 *
 * Filters the same `useLabData().tasks` set LabExperimentsWidget reads,
 * narrowing to experiments that look ready for a writeup pass:
 * `is_complete === false` AND `end_date < today` (the existing
 * `awaiting_writeup` proxy mirrored from LabExperimentsWidget's
 * `useExperimentData` helper). This is the model's best in-data signal
 * for "experiment ran past its window but the writeup hasn't landed"
 * without adding a per-task filesystem probe — Task has no explicit
 * writeup field today (`frontend/src/lib/types.ts` Task interface).
 *
 * Pragmatic trade-off: an experiment marked `is_complete === true` with
 * no results.md / Images would be the strictest reading of "ready to
 * write up". Detecting that requires per-task fs probes (the gallery
 * pattern in LabExperimentsPanel) which would dominate the snapshot
 * tile's latency. Sticking to the in-data `awaiting_writeup` proxy keeps
 * the tile snappy and shares the `useLabData` cache with every other
 * task-aware widget. FOLLOW-UP: a single batched `probeTaskResults`
 * query keyed by experiment-id-set could refine this if Grant wants the
 * stricter definition.
 *
 * Wiring: Tool = `experiments`, variantId = `ready-writeup`. Clicking
 * the tile opens the same Experiments popup
 * (LabExperimentsWidget.ExpandedView) as the canonical experiments
 * tile.
 *
 * Canvas + home surface (member-relevant: my own completed work, time
 * to file the writeup; PI-relevant: lab-wide backlog at a glance).
 */

import { useMemo } from "react";
import { useLabData } from "@/hooks/useLabData";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import UserAvatar from "@/components/UserAvatar";
import type { LabTask } from "@/lib/local-api";
import type { SidebarTileProps, SnapshotTileProps } from "./types";
import SidebarStatTile from "./snapshot/SidebarStatTile";
import LabExperimentsWidget from "./LabExperimentsWidget";

void LabExperimentsWidget;

/** Beaker icon (matches LabExperimentsWidget so the variant reads as a
 *  sibling of the canonical experiments tile). */
const BEAKER_ICON_14 = (
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
);

/** Green check, empty-state cue. */
const CHECK_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
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

type ReadyRow = {
  task: LabTask;
  /** Days since the experiment's end_date passed (positive = past). */
  daysSinceEnd: number;
};

function todayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function todayIso(): string {
  return new Date(todayMs()).toISOString().slice(0, 10);
}

/**
 * Build the ready-for-writeup row list from the lab task set.
 *
 * Same predicate the canonical LabExperimentsWidget uses for its
 * `awaiting_writeup` bucket (end_date in the past, not yet marked
 * complete). Sorted by days-since-end DESC so the most-overdue rows
 * surface first (the user-actionable ordering).
 */
function collectReadyRows(tasks: ReadonlyArray<LabTask>): ReadyRow[] {
  const today = todayIso();
  const todayStartMs = todayMs();
  const out: ReadyRow[] = [];
  for (const t of tasks) {
    if (t.task_type !== "experiment") continue;
    if (t.is_complete) continue;
    if (!t.end_date || t.end_date >= today) continue;
    const endMs = new Date(`${t.end_date}T00:00:00`).getTime();
    const daysSinceEnd = Number.isFinite(endMs)
      ? Math.max(0, Math.round((todayStartMs - endMs) / 86_400_000))
      : 0;
    out.push({ task: t, daysSinceEnd });
  }
  out.sort((a, b) => b.daysSinceEnd - a.daysSinceEnd);
  return out;
}

function formatDaysAgo(days: number): string {
  if (days === 0) return "ended today";
  if (days === 1) return "ended 1d ago";
  return `ended ${days}d ago`;
}

/**
 * SnapshotTile: top 3 ready-to-write-up experiments. Each row shows the
 * experiment name, owner avatar + name, and an "ended Nd ago" cue.
 * "X awaiting writeup" pill in the top-right when count > 0; full-width
 * "All caught up" empty state with a green check otherwise.
 */
export function SnapshotTile(_props: SnapshotTileProps) {
  const { tasks } = useLabData();
  const profileMap = useLabUserProfileMap();
  const rows = useMemo(() => collectReadyRows(tasks), [tasks]);
  const top3 = rows.slice(0, 3);
  const total = rows.length;

  return (
    <div className="relative h-full overflow-hidden flex flex-col">
      <div className="flex items-center gap-1.5 text-gray-500">
        <span aria-hidden="true" className="text-purple-500 flex-shrink-0">
          {BEAKER_ICON_14}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-medium">
          Ready to write up
        </span>
      </div>
      {total > 0 && (
        <span
          className="absolute top-0 right-0 text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full font-medium tabular-nums"
          aria-label={`${total} awaiting writeup`}
        >
          {total} awaiting writeup
        </span>
      )}
      <div className="mt-2 flex-1 min-h-0 flex flex-col gap-1.5">
        {top3.length === 0 ? (
          <div className="m-auto flex flex-col items-center gap-1 text-gray-400">
            <span aria-hidden="true">{CHECK_SVG}</span>
            <p className="text-xs italic">All caught up</p>
          </div>
        ) : (
          top3.map((row) => {
            const owner =
              profileMap[row.task.username]?.displayName?.trim() ||
              row.task.username;
            return (
              <div
                key={`${row.task.username}:${row.task.id}`}
                className="flex items-start gap-2 min-w-0"
              >
                <UserAvatar username={row.task.username} size="xs" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] truncate">
                    <span className="font-medium text-gray-800 truncate">
                      {row.task.name}
                    </span>
                  </p>
                  <p className="text-[10px] text-gray-500 truncate">
                    <span>{owner}</span>
                    <span className="text-gray-400"> · </span>
                    <span className="tabular-nums">
                      {formatDaysAgo(row.daysSinceEnd)}
                    </span>
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
 * SidebarTile: slim row with the beaker icon + "Ready writeup" label +
 * count badge.
 */
export function SidebarTile({ onClick }: SidebarTileProps) {
  const { tasks } = useLabData();
  const count = useMemo(() => collectReadyRows(tasks).length, [tasks]);
  return (
    <SidebarStatTile
      icon={BEAKER_ICON_14}
      iconClassName="text-purple-500"
      label="Ready writeup"
      stat={
        count > 0 ? (
          <span className="inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold tabular-nums">
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

/** Default export: the Experiments Tool popup body (back-compat
 *  fallback; Tool registry is canonical). */
export default LabExperimentsWidget;
