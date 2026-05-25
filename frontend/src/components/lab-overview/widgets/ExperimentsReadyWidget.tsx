"use client";

/**
 * Tool variants batch (Tool variants batch manager, 2026-05-24): the
 * `ready-writeup` variant of the Experiments Tool.
 *
 * Ready-to-writeup refiner (Ready-to-writeup refiner manager, 2026-05-24):
 * the initial v1 of this tile used an in-data proxy
 * (`is_complete === false && end_date < today` — really "overdue
 * experiments"). The canonical semantics, per Grant 2026-05-24, are:
 *
 *   experiment IS complete  AND  no result attached on disk
 *
 * "No result" follows the same rule LabExperimentsPanel's `awaiting`
 * section uses: no non-empty `results.md` AND no images in either
 * `Images/` folder. The probe lives in
 * `frontend/src/lib/experiments/findTaskResultsBase.ts:probeTaskResults`
 * and is reused here via the `useExperimentsAwaitingWriteup` React
 * Query hook (which batches the per-task probes with Promise.all and
 * caches the result for 60s so SnapshotTile + SidebarTile share one
 * fetch). FOLLOW-UP also lives on that hook: the probe is
 * O(experiments-complete) per cold render; a `hasResult` sidecar
 * cache would make it O(1).
 *
 * "completed Nd ago" caveat: LabTask has no completion timestamp
 * field (no `is_complete_at`, no `updated_at`), so the sub-label uses
 * scheduled `end_date` as the fallback. The phrase reads "completed
 * Nd ago" but is technically "scheduled to end Nd ago" — close enough
 * for the awaiting-writeup signal since the writeup nudge only
 * matters when the run is past its planned window.
 *
 * Wiring: Tool = `experiments`, variantId = `ready-writeup`. Clicking
 * the tile opens the same Experiments popup
 * (LabExperimentsWidget.ExpandedView) as the canonical experiments
 * tile.
 *
 * Canvas + home surface (member-relevant: my own completed work, time
 * to file the writeup; PI-relevant: lab-wide backlog at a glance).
 */

import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import {
  useExperimentsAwaitingWriteup,
  type AwaitingWriteupRow,
} from "@/hooks/useExperimentsAwaitingWriteup";
import UserAvatar from "@/components/UserAvatar";
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

function formatCompletedAgo(days: number): string {
  if (days === 0) return "completed today";
  if (days === 1) return "completed 1d ago";
  return `completed ${days}d ago`;
}

/**
 * SnapshotTile: top 3 experiments awaiting writeup (completed, no
 * results.md / Images). Each row shows the experiment name, owner
 * avatar + name, and a "completed Nd ago" cue.
 * "X awaiting writeup" pill in the top-right when count > 0; full-width
 * "All caught up" empty state with a green check otherwise.
 */
export function SnapshotTile(_props: SnapshotTileProps) {
  const { rows } = useExperimentsAwaitingWriteup();
  const profileMap = useLabUserProfileMap();
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
          top3.map((row: AwaitingWriteupRow) => {
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
                      {formatCompletedAgo(row.daysSinceEnd)}
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
  const { rows } = useExperimentsAwaitingWriteup();
  const count = rows.length;
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

/**
 * Mira PI R1 fix manager (Fix 3, 2026-05-25): help-badge copy for the
 * ready-to-writeup variant of the Experiments tile. Matches Chip B
 * voice (pedagogical, no em-dashes, no emojis).
 */
export const HELP_TEXT =
  "Experiments with a completed result row and no draft yet. Click any tile to start the write-up; PIs see these across every member.";

/** Default export: the Experiments Tool popup body (back-compat
 *  fallback; Tool registry is canonical). */
export default LabExperimentsWidget;
