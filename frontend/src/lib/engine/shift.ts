import { addDays, subDays, parseISO, isValid } from "date-fns";
import { parseDate, formatDate, resolveWeekend, computeEndDate, isWeekendActiveForTask, computeStartDateFromEnd } from "./dates";
import { JsonStore } from "../storage/json-store";
import type { Task, Dependency, Project, ShiftedTask, ShiftWarning, ShiftResult } from "../schemas";

type TaskDict = Task & { [key: string]: unknown };
type DependencyDict = Dependency;

const projectsStore = new JsonStore<Project>("projects");
const tasksStore = new JsonStore<Task>("tasks");
const dependenciesStore = new JsonStore<Dependency>("dependencies");

function getProjectWeekend(projectId: number, owner?: string): Promise<boolean> {
  const reader = owner
    ? projectsStore.getForUser(projectId, owner)
    : projectsStore.get(projectId);
  return reader.then((proj) => proj?.weekend_active ?? false);
}

async function getTaskWeekendActive(task: TaskDict, owner?: string): Promise<boolean> {
  const projectWeekend = await getProjectWeekend(task.project_id, owner);
  return isWeekendActiveForTask(task.weekend_override, projectWeekend);
}

async function listOwnerDeps(owner?: string): Promise<DependencyDict[]> {
  return owner ? dependenciesStore.listAllForUser(owner) : dependenciesStore.listAll();
}

function detectCycleSync(
  parentId: number,
  childId: number,
  allDeps: DependencyDict[]
): boolean {
  const adj: Map<number, number[]> = new Map();
  for (const d of allDeps) {
    const children = adj.get(d.parent_id) || [];
    children.push(d.child_id);
    adj.set(d.parent_id, children);
  }

  const visited: Set<number> = new Set();
  const queue: number[] = [childId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === parentId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const children = adj.get(current) || [];
    for (const cid of children) {
      if (!visited.has(cid)) {
        queue.push(cid);
      }
    }
  }

  return false;
}

async function getTaskForOwner(taskId: number, owner?: string): Promise<TaskDict | null> {
  const task = owner ? await tasksStore.getForUser(taskId, owner) : await tasksStore.get(taskId);
  return task as TaskDict | null;
}

async function saveTaskForOwner(taskId: number, task: TaskDict, owner?: string): Promise<void> {
  if (owner) {
    await tasksStore.saveForUser(taskId, task, owner);
  } else {
    await tasksStore.save(taskId, task);
  }
}

async function getDependencyChildren(
  taskId: number,
  owner?: string
): Promise<Array<{ childTask: TaskDict; dep: DependencyDict }>> {
  const allDeps = (await listOwnerDeps(owner)).filter((d) => d.parent_id === taskId);
  const results: Array<{ childTask: TaskDict; dep: DependencyDict }> = [];

  for (const dep of allDeps) {
    const child = await getTaskForOwner(dep.child_id, owner);
    if (child) {
      results.push({ childTask: child, dep });
    }
  }

  return results;
}

async function getDependencyParents(
  taskId: number,
  owner?: string
): Promise<Array<{ parentTask: TaskDict; dep: DependencyDict }>> {
  const allDeps = (await listOwnerDeps(owner)).filter((d) => d.child_id === taskId);
  const results: Array<{ parentTask: TaskDict; dep: DependencyDict }> = [];

  for (const dep of allDeps) {
    const parent = await getTaskForOwner(dep.parent_id, owner);
    if (parent) {
      results.push({ parentTask: parent, dep });
    }
  }

  return results;
}

async function findSSSiblings(taskId: number, owner?: string): Promise<TaskDict[]> {
  const siblings: TaskDict[] = [];
  const allDeps = await listOwnerDeps(owner);

  for (const dep of allDeps) {
    if (dep.dep_type === "SS") {
      if (dep.parent_id === taskId) {
        const sibling = await getTaskForOwner(dep.child_id, owner);
        if (sibling) siblings.push(sibling);
      } else if (dep.child_id === taskId) {
        const sibling = await getTaskForOwner(dep.parent_id, owner);
        if (sibling) siblings.push(sibling);
      }
    }
  }

  return siblings;
}

/**
 * Shift a task's start date and cascade through its dependency graph.
 *
 * When `owner` is provided (a receiver shifting a task that was shared to
 * them with `permission: "edit"`), every read and write — including
 * dependency lookups and weekend-active resolution — is routed through
 * that owner's directory instead of the current user's. Cross-user
 * dependencies aren't supported; the cascade only traverses tasks in
 * the same `users/{owner}/` namespace.
 */
export async function shiftTask(
  taskId: number,
  newStartDate: Date,
  confirmed: boolean = false,
  owner?: string
): Promise<ShiftResult> {
  const task = await getTaskForOwner(taskId, owner);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  const wa = await getTaskWeekendActive(task, owner);
  const resolvedStart = resolveWeekend(newStartDate, wa);

  const oldStart = parseDate(task.start_date);
  const oldEnd = computeEndDate(oldStart, task.duration_days, wa);

  // end_date on disk is a derived/cached value (see Task.end_date in
  // ../types.ts). Recompute and persist it alongside start_date so we don't
  // leave a stale end_date behind — that's the bug that caused tasks to
  // silently drop from the gantt when end_date < start_date.
  task.start_date = formatDate(resolvedStart);
  task.end_date = formatDate(computeEndDate(resolvedStart, task.duration_days, false));
  await saveTaskForOwner(taskId, task, owner);

  const newEnd = computeEndDate(resolvedStart, task.duration_days, wa);

  const affected: ShiftedTask[] = [
    {
      task_id: task.id,
      name: task.name,
      old_start: formatDate(oldStart),
      new_start: formatDate(resolvedStart),
      old_end: formatDate(oldEnd),
      new_end: formatDate(newEnd),
    },
  ];
  const warnings: ShiftWarning[] = [];

  const upstreamQueue: number[] = [taskId];
  const upstreamVisited: Set<number> = new Set([taskId]);

  while (upstreamQueue.length > 0) {
    const currentId = upstreamQueue.shift()!;
    const currentTask = await getTaskForOwner(currentId, owner);
    if (!currentTask) continue;

    const parents = await getDependencyParents(currentId, owner);

    for (const { parentTask, dep } of parents) {
      if (parentTask.id === undefined || upstreamVisited.has(parentTask.id)) continue;
      upstreamVisited.add(parentTask.id);

      const parentWa = await getTaskWeekendActive(parentTask, owner);
      const parentOldStart = parseDate(parentTask.start_date);
      const parentOldEnd = computeEndDate(parentOldStart, parentTask.duration_days, parentWa);

      const currentStart = parseDate(currentTask.start_date);
      const currentEnd = computeEndDate(
        currentStart,
        currentTask.duration_days,
        await getTaskWeekendActive(currentTask, owner)
      );

      const depType = dep.dep_type;
      let parentNewStart: Date | null = null;

      if (depType === "FS") {
        const requiredParentEnd = subDays(currentStart, 1);
        if (formatDate(parentOldEnd) !== formatDate(requiredParentEnd)) {
          if (parentWa) {
            parentNewStart = subDays(requiredParentEnd, parentTask.duration_days - 1);
          } else {
            parentNewStart = computeStartDateFromEnd(requiredParentEnd, parentTask.duration_days, false);
          }
        }
      } else if (depType === "SS") {
        if (parentOldStart > currentStart) {
          parentNewStart = currentStart;
        }
      } else if (depType === "SF") {
        if (formatDate(parentOldStart) !== formatDate(currentEnd)) {
          parentNewStart = currentEnd;
        }
      }

      if (parentNewStart) {
        parentNewStart = resolveWeekend(parentNewStart, parentWa);
        const parentNewEnd = computeEndDate(parentNewStart, parentTask.duration_days, parentWa);

        parentTask.start_date = formatDate(parentNewStart);
        parentTask.end_date = formatDate(computeEndDate(parentNewStart, parentTask.duration_days, false));
        await saveTaskForOwner(parentTask.id!, parentTask, owner);

        affected.push({
          task_id: parentTask.id!,
          name: parentTask.name,
          old_start: formatDate(parentOldStart),
          new_start: formatDate(parentNewStart),
          old_end: formatDate(parentOldEnd),
          new_end: formatDate(parentNewEnd),
        });

        upstreamQueue.push(parentTask.id!);
      }
    }
  }

  const queue: number[] = [taskId];
  const visited: Set<number> = new Set([taskId]);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentTask = await getTaskForOwner(currentId, owner);
    if (!currentTask) continue;

    const currentWa = await getTaskWeekendActive(currentTask, owner);
    const currentStart = parseDate(currentTask.start_date);
    const currentEnd = computeEndDate(currentStart, currentTask.duration_days, currentWa);

    const children = await getDependencyChildren(currentId, owner);

    for (const { childTask, dep } of children) {
      if (childTask.id === undefined || visited.has(childTask.id)) continue;
      visited.add(childTask.id);

      const childWa = await getTaskWeekendActive(childTask, owner);
      const childOldStart = parseDate(childTask.start_date);
      const childOldEnd = computeEndDate(childOldStart, childTask.duration_days, childWa);

      const allParents = await getDependencyParents(childTask.id, owner);
      const requiredStarts: Date[] = [];

      for (const { parentTask: pt, dep: parentDep } of allParents) {
        const parentWa = await getTaskWeekendActive(pt, owner);
        const parentStart = parseDate(pt.start_date);
        const parentEnd = computeEndDate(parentStart, pt.duration_days, parentWa);

        const parentDepType = parentDep.dep_type;

        if (parentDepType === "FS") {
          let latestEnd = parentEnd;

          const ssSiblings = await findSSSiblings(pt.id!, owner);
          for (const sibling of ssSiblings) {
            const siblingWa = await getTaskWeekendActive(sibling, owner);
            const siblingStart = parseDate(sibling.start_date);
            const siblingEnd = computeEndDate(siblingStart, sibling.duration_days, siblingWa);
            if (siblingEnd > latestEnd) {
              latestEnd = siblingEnd;
            }
          }

          requiredStarts.push(addDays(latestEnd, 1));
        } else if (parentDepType === "SS") {
          requiredStarts.push(parentStart);
        } else if (parentDepType === "SF") {
          if (childWa) {
            requiredStarts.push(subDays(parentStart, childTask.duration_days - 1));
          } else {
            const computedStart = computeStartDateFromEnd(parentStart, childTask.duration_days, false);
            requiredStarts.push(computedStart);
          }
        }
      }

      if (requiredStarts.length === 0) continue;

      let childNewStart = requiredStarts[0];
      for (let i = 1; i < requiredStarts.length; i++) {
        if (requiredStarts[i] > childNewStart) {
          childNewStart = requiredStarts[i];
        }
      }

      childNewStart = resolveWeekend(childNewStart, childWa);
      const childNewEnd = computeEndDate(childNewStart, childTask.duration_days, childWa);

      const depType = dep.dep_type;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (depType === "SF" && childNewStart < today) {
        warnings.push({
          task_id: childTask.id!,
          name: childTask.name,
          message: `SF dependency shifts task '${childTask.name}' start date to ${formatDate(childNewStart)}, which is in the past.`,
        });

        if (!confirmed) {
          return {
            affected_tasks: affected,
            warnings,
            requires_confirmation: true,
          };
        }
      }

      childTask.start_date = formatDate(childNewStart);
      childTask.end_date = formatDate(computeEndDate(childNewStart, childTask.duration_days, false));
      await saveTaskForOwner(childTask.id!, childTask, owner);

      affected.push({
        task_id: childTask.id!,
        name: childTask.name,
        old_start: formatDate(childOldStart),
        new_start: formatDate(childNewStart),
        old_end: formatDate(childOldEnd),
        new_end: formatDate(childNewEnd),
      });

      queue.push(childTask.id!);
    }
  }

  return {
    affected_tasks: affected,
    warnings,
    requires_confirmation: false,
  };
}

export { detectCycleSync as detectCycle };
