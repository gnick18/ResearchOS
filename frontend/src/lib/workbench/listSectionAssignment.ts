/**
 * Priority cascade for assigning a single-user list task to exactly one of
 * the five Workbench Lists-tab sections. Order matters — see
 * LISTS_TAB_PROPOSAL.md (Proposal A).
 *
 *   1. complete + end_date within last 30 days → recentlyDone
 *   2. complete + end_date older than 30 days  → earlier
 *   3. !complete + end_date < today            → overdue
 *   4. !complete + start_date <= today <= end_date → doing
 *   5. !complete + start_date > today          → upcoming
 *
 * Lighter than the Experiments-tab counterpart (no dep graph, no result
 * probe). Pure date math against `today`. The function returns null for
 * any task that is_complete + null/invalid end_date — caller decides
 * whether to drop or assign to a fallback section.
 */
import type { Task } from "@/lib/types";

export type ListSection =
  | "overdue"
  | "doing"
  | "upcoming"
  | "recentlyDone"
  | "earlier";

export const RECENT_WINDOW_DAYS = 30;

export interface AssignContext {
  today: string; // YYYY-MM-DD
}

export function assignListSection(
  task: Task,
  ctx: AssignContext,
): ListSection {
  const { today } = ctx;

  if (task.is_complete) {
    if (!task.end_date) return "recentlyDone";
    const days = daysBetween(today, task.end_date);
    return days >= 0 && days <= RECENT_WINDOW_DAYS
      ? "recentlyDone"
      : "earlier";
  }

  if (task.end_date && task.end_date < today) return "overdue";
  if (task.start_date <= today && (!task.end_date || task.end_date >= today)) {
    return "doing";
  }
  return "upcoming";
}

export interface ListSectionBuckets {
  overdue: Task[];
  doing: Task[];
  upcoming: Task[];
  recentlyDone: Task[];
  earlier: Task[];
}

/**
 * Run the priority cascade against an entire task list and return per-section
 * buckets. Each task lands in exactly one bucket. Tasks are sorted within
 * each section per the proposal:
 *
 *   - overdue: end_date ascending (oldest-overdue first)
 *   - doing: start_date descending (most-recently-started first)
 *   - upcoming: start_date ascending (soonest first)
 *   - recentlyDone: end_date descending (newest-completed first)
 *   - earlier: end_date descending
 */
export function bucketListTasks(
  tasks: Task[],
  ctx: AssignContext,
): ListSectionBuckets {
  const buckets: ListSectionBuckets = {
    overdue: [],
    doing: [],
    upcoming: [],
    recentlyDone: [],
    earlier: [],
  };
  for (const t of tasks) {
    buckets[assignListSection(t, ctx)].push(t);
  }
  buckets.overdue.sort((a, b) => a.end_date.localeCompare(b.end_date));
  buckets.doing.sort((a, b) => b.start_date.localeCompare(a.start_date));
  buckets.upcoming.sort((a, b) => a.start_date.localeCompare(b.start_date));
  buckets.recentlyDone.sort((a, b) => b.end_date.localeCompare(a.end_date));
  buckets.earlier.sort((a, b) => b.end_date.localeCompare(a.end_date));
  return buckets;
}

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + "T00:00:00Z").getTime();
  const b = new Date(bIso + "T00:00:00Z").getTime();
  return Math.round((a - b) / 86_400_000);
}
