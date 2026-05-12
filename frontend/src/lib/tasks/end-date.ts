import { computeEndDate, formatDate, parseDate } from "../engine/dates";
import type { Task } from "../types";

// end_date is a derived/cached field. Always recompute it from
// (start_date, duration_days) so stale or corrupted on-disk values can't
// cause downstream consumers (e.g. GanttChart) to silently drop tasks.
//
// Lives in its own module so unit tests can exercise the canonical formula
// without pulling in the local-api dependency tree (file-service, JSZip,
// isomorphic-git, ...).
export function canonicalEndDate(task: Pick<Task, "start_date" | "duration_days">): string {
  return formatDate(computeEndDate(parseDate(task.start_date), task.duration_days, false));
}

export function computeTaskEndDate(task: Task): Task {
  const expected = canonicalEndDate(task);
  if (task.end_date === expected) return task;
  return { ...task, end_date: expected };
}
