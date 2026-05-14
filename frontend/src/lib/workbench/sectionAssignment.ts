/**
 * Priority cascade for assigning a single-user workbench task to exactly
 * one of the five Workbench sections. Order matters — see EXPERIMENTS_STANDALONE_PROPOSAL.md.
 *
 *   1. complete + has result content        → recent
 *   2. complete + no result content         → awaiting
 *   3. !complete + blocked by parent task   → blocked
 *   4. !complete + within [start, end]      → running
 *   5. !complete + start <= today (overdue) → ready
 *   6. else (future-scheduled, etc.)        → scheduled
 *
 * "blocked" is computed per task: any parent in `dependencies` whose
 * own `is_complete=false` blocks the child. Dependencies live in the
 * current user's namespace (parent_id / child_id reference the user's
 * own task ids), so shared-into-me tasks never participate.
 */
import type { Dependency, Task } from "@/lib/types";
import { taskKey } from "@/lib/types";

export type WorkbenchSection =
  | "ready"
  | "blocked"
  | "running"
  | "awaiting"
  | "recent"
  | "scheduled";

export interface AssignContext {
  today: string; // YYYY-MM-DD
  hasResult: boolean;
  blockingParents: Task[]; // parent tasks that are NOT yet complete
}

export function assignSection(task: Task, ctx: AssignContext): WorkbenchSection {
  if (task.is_complete) {
    return ctx.hasResult ? "recent" : "awaiting";
  }
  if (ctx.blockingParents.length > 0) return "blocked";
  if (task.start_date <= ctx.today && task.end_date >= ctx.today) {
    return "running";
  }
  if (task.start_date <= ctx.today) {
    return "ready";
  }
  return "scheduled";
}

/**
 * Build a lookup `taskKey -> blocking parent tasks` for all current-user-owned
 * tasks. Shared-into-me tasks aren't represented in the dependency store at
 * all, so they always come back with an empty array (which is correct —
 * the workbench doesn't know about cross-namespace dependencies).
 */
export function computeBlockingParents(
  tasks: Task[],
  dependencies: Dependency[],
): Map<string, Task[]> {
  const byId = new Map<number, Task>();
  for (const t of tasks) {
    if (t.is_shared_with_me) continue;
    byId.set(t.id, t);
  }
  const parentsByChild = new Map<number, number[]>();
  for (const dep of dependencies) {
    const existing = parentsByChild.get(dep.child_id) ?? [];
    existing.push(dep.parent_id);
    parentsByChild.set(dep.child_id, existing);
  }

  const result = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.is_shared_with_me) continue;
    const parentIds = parentsByChild.get(t.id) ?? [];
    const blockers: Task[] = [];
    for (const pid of parentIds) {
      const parent = byId.get(pid);
      if (parent && !parent.is_complete) blockers.push(parent);
    }
    result.set(taskKey(t), blockers);
  }
  return result;
}

/**
 * Among a task's current-user-owned descendants, find the next sibling/child
 * task that is NOT yet complete. Used to populate the "Next: X" line on a
 * Running card.
 */
export function findNextInChain(
  task: Task,
  tasks: Task[],
  dependencies: Dependency[],
): Task | null {
  if (task.is_shared_with_me) return null;
  const byId = new Map<number, Task>();
  for (const t of tasks) {
    if (t.is_shared_with_me) continue;
    byId.set(t.id, t);
  }
  const childrenByParent = new Map<number, number[]>();
  for (const dep of dependencies) {
    const existing = childrenByParent.get(dep.parent_id) ?? [];
    existing.push(dep.child_id);
    childrenByParent.set(dep.parent_id, existing);
  }
  const visited = new Set<number>();
  const queue: number[] = [...(childrenByParent.get(task.id) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const t = byId.get(id);
    if (!t) continue;
    if (!t.is_complete) return t;
    for (const child of childrenByParent.get(id) ?? []) queue.push(child);
  }
  return null;
}
