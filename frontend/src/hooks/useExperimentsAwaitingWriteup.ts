"use client";

import { useQuery } from "@tanstack/react-query";
import { useLabData } from "@/hooks/useLabData";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { probeTaskResults } from "@/lib/experiments/findTaskResultsBase";
import type { LabTask } from "@/lib/local-api";

const LAB_STALE_MS = 60_000;

/**
 * Ready-to-writeup refiner (Ready-to-writeup refiner manager, 2026-05-24):
 * the canonical "experiment is awaiting writeup" predicate.
 *
 * Previously the `experiments-ready-writeup` widget variant used an
 * in-data proxy (`is_complete === false && end_date < today` — really
 * "overdue experiments"). Per Grant's 2026-05-24 ruling the canonical
 * semantics are:
 *
 *   experiment IS complete  AND  no result attached on disk
 *
 * "No result" follows the same rule LabExperimentsPanel uses for its
 * `awaiting` section: no non-empty `results.md` AND no images in the
 * task's Images folders. The shared probe is
 * `probeTaskResults` (see `frontend/src/lib/experiments/findTaskResultsBase.ts`)
 * — a single-pass per-task scan that returns `hasResult: boolean` plus
 * hero-image + preview metadata. We only need `hasResult` here.
 *
 * Batching: per-task probes are batched via `Promise.all` over the
 * candidate set inside the queryFn, mirroring LabExperimentsPanel and
 * WorkbenchExperimentsPanel. React Query then caches the result for 60s
 * (matching the rest of the lab queries) so SnapshotTile + SidebarTile
 * mounts share a single fetch. Without the cache, mounting both tiles
 * on the canvas + sidebar would double-probe every completed experiment.
 *
 * FOLLOW-UP (Grant 2026-05-24): the probe is O(experiments-complete) per
 * cold render. For a lab with hundreds of completed experiments, a
 * cached `hasResult` boolean in the task sidecar (lib/types.ts Task +
 * the read/write pipeline) would make this O(1). Out of scope for this
 * chip — flagged for a future data-shape pass.
 */

export interface AwaitingWriteupRow {
  task: LabTask;
  /** Days since the experiment's scheduled `end_date`. Used as the
   *  "completed Nd ago" label. Note: LabTask has no completion
   *  timestamp (no `is_complete_at`, no `updated_at`), so we fall back
   *  to scheduled `end_date`. The label is therefore "scheduled to
   *  end Nd ago" rather than "marked complete Nd ago" — documented on
   *  the widget. Sort proxy: higher = more stale. */
  daysSinceEnd: number;
}

function todayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Compute the candidate set: experiment-typed tasks marked complete.
 * Pulled out so the queryKey can include a stable id-set (so adding /
 * completing / un-completing an experiment invalidates the cache).
 */
function candidateCompletedExperiments(
  tasks: ReadonlyArray<LabTask>,
): LabTask[] {
  const out: LabTask[] = [];
  for (const t of tasks) {
    if (t.task_type !== "experiment") continue;
    if (!t.is_complete) continue;
    out.push(t);
  }
  return out;
}

/**
 * React Query hook: returns completed experiments that have no
 * `results.md` AND no images on disk yet ("awaiting writeup"). Sorted
 * by days-since-end DESC so the most-stale rows surface first.
 *
 * The query key includes the current user (because probe paths are
 * per-user-namespaced via `taskResultsBase`) plus a stable signature
 * of the candidate id-set (`username:id` pairs joined) so completing
 * or un-completing an experiment refetches. The candidate id-set is
 * the right invalidation key (not the entire task list) because only
 * the `is_complete && task_type === "experiment"` subset participates.
 */
export function useExperimentsAwaitingWriteup() {
  const { tasks } = useLabData();
  const { currentUser } = useCurrentUser();

  const candidates = candidateCompletedExperiments(tasks);
  // Stable signature of the candidate id-set for the queryKey. Sorted
  // so order-of-arrival in `tasks` doesn't churn the cache key.
  const candidateKey = candidates
    .map((t) => `${t.username}:${t.id}`)
    .sort()
    .join(",");

  const query = useQuery({
    queryKey: [
      "lab",
      "experiments-awaiting-writeup",
      currentUser ?? "",
      candidateKey,
    ],
    enabled: currentUser !== null,
    queryFn: async (): Promise<AwaitingWriteupRow[]> => {
      const todayStartMs = todayMs();
      // Probe every candidate in parallel. The probe walks the per-user
      // canonical base + the legacy global base; no further batching
      // shape is available without changing the sidecar schema (the
      // FOLLOW-UP above).
      const probes = await Promise.all(
        candidates.map(async (t) => {
          const probe = await probeTaskResults({ id: t.id, owner: t.username });
          return { task: t, hasResult: probe.hasResult };
        }),
      );
      const rows: AwaitingWriteupRow[] = [];
      for (const { task, hasResult } of probes) {
        if (hasResult) continue;
        const endMs = task.end_date
          ? new Date(`${task.end_date}T00:00:00`).getTime()
          : NaN;
        const daysSinceEnd = Number.isFinite(endMs)
          ? Math.max(0, Math.round((todayStartMs - endMs) / 86_400_000))
          : 0;
        rows.push({ task, daysSinceEnd });
      }
      rows.sort((a, b) => b.daysSinceEnd - a.daysSinceEnd);
      return rows;
    },
    staleTime: LAB_STALE_MS,
    refetchOnWindowFocus: false,
  });

  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
