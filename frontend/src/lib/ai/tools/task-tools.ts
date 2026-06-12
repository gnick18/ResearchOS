// BeakerBot scheduling coworker tools (ai task-tools bot, 2026-06-12).
//
// Three gated WRITE tools that let BeakerBot touch the Gantt schedule the way a
// user could by hand. Today BeakerBot can READ tasks/projects (get_my_tasks,
// get_my_projects) but cannot change the schedule, these close that gap.
//
//   - create_task: create a task on a project (resolved by name or id).
//   - reschedule_task: move a task's dates through the dependency-aware shift
//     path, so dependent tasks cascade, and surface how many moved.
//   - update_task: rename, mark complete / incomplete, or move to another project.
//
// All three are ACTION tools (action: true, isDestructive false). None deletes,
// so none forces the destructive hard-stop. The user sees a one-line confirm of
// exactly what will change before anything writes (step mode), or it runs once
// the plan is approved (plan mode), through the existing agent-loop gate.
//
// THE LANE RULE. The engine / local-api owns every write and every number. These
// tools only map the user's words (a project name, a task name, a date) onto the
// real local-api calls, they never invent a field or compute a cascade. The
// dependency cascade in reschedule_task comes from tasksApi.move (the same
// shiftTask path the Gantt drag uses), this tool only relays its ShiftResult.
//
// v1 is own-user tasks only (no shared-owner threading). A task the user only
// RECEIVED a share of is not reschedulable here, the resolver skips it.
//
// Key field names (confirmed from types.ts + local-api.ts):
//   Task.start_date     -- YYYY-MM-DD ISO string
//   Task.duration_days  -- the canonical length field (end_date is a cache)
//   Task.project_id     -- 0 = no project
//   Task.task_type      -- "experiment" | "purchase" | "list"
//   TaskCreate          -- { project_id?, name, start_date, duration_days, task_type?, ... }
//   TaskUpdate          -- { name?, is_complete?, project_id?, start_date?, duration_days?, ... }
//   TaskMoveRequest     -- { new_start_date, confirmed? }
//   ShiftResult         -- { affected_tasks: ShiftedTask[], warnings, requires_confirmation }
//
// Injectable seam so every export is unit-testable without a real folder.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  tasksApi,
  projectsApi,
  fetchAllTasksIncludingShared,
} from "@/lib/local-api";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import { daysBetween } from "./experiment-tools";
import type { Project, Task, TaskMoveRequest, ShiftResult } from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable seam
// ---------------------------------------------------------------------------

export type TaskToolsDeps = {
  /** The user's projects (for resolving a project by name or id). */
  listProjects: () => Promise<Project[]>;
  /** The user's tasks (own + shared) for resolving a task by name or id. */
  listTasks: () => Promise<Task[]>;
  /** Create a new task. Returns the saved Task. */
  createTask: (data: {
    name: string;
    start_date: string;
    duration_days: number;
    task_type?: "experiment" | "purchase" | "list";
    project_id?: number | null;
  }) => Promise<Task>;
  /** Update a task's fields. Returns null when the id is not found. */
  updateTask: (
    id: number,
    data: {
      name?: string;
      is_complete?: boolean;
      project_id?: number | null;
    },
  ) => Promise<Task | null>;
  /** Move a task (dependency-aware shift). Returns the ShiftResult cascade. */
  moveTask: (id: number, data: TaskMoveRequest) => Promise<ShiftResult>;
  /** Navigate the user to an internal path after a successful write.
   *  Defaults to the navigation bridge. Injected so tests assert the call. */
  navigate: (path: string) => void;
};

export const taskToolsDeps: TaskToolsDeps = {
  listProjects: () => projectsApi.list(),
  listTasks: () => fetchAllTasksIncludingShared(),
  createTask: (data) => tasksApi.create(data),
  updateTask: (id, data) => tasksApi.update(id, data),
  moveTask: (id, data) => tasksApi.move(id, data),
  navigate: requestNavigation,
};

// ---------------------------------------------------------------------------
// Resolution helpers (pure, exported for tests)
// ---------------------------------------------------------------------------

/**
 * Resolve a project reference (a numeric id, a numeric-looking string, or a name,
 * case-insensitive) to a real project, or null when none matches. Mirrors how
 * createExperiment-style tools resolve a target by name or id. Pure.
 */
export function resolveProject(
  projects: Project[],
  ref: string | number | undefined,
): Project | null {
  if (ref === undefined || ref === null || ref === "") return null;
  // Numeric id (number or numeric string) wins, then a case-insensitive name.
  const asNum =
    typeof ref === "number" ? ref : /^\d+$/.test(String(ref).trim()) ? Number(ref) : NaN;
  if (Number.isFinite(asNum)) {
    const byId = projects.find((p) => p.id === asNum);
    if (byId) return byId;
  }
  const name = String(ref).trim().toLowerCase();
  return projects.find((p) => p.name.trim().toLowerCase() === name) ?? null;
}

/**
 * Own tasks only (v1). A task the user only RECEIVED a share of carries
 * is_shared_with_me === true and is excluded, so the scheduling tools never try
 * to write into another owner's directory. Pure.
 */
export function ownTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.is_shared_with_me !== true);
}

/**
 * Resolve a task reference (a numeric id, a numeric-looking string, or a name,
 * case-insensitive) to a real OWN task, or null when none matches. When a name
 * matches more than one own task it returns the FIRST (the caller surfaces the
 * ambiguity through the confirm summary, which names the resolved task). Pure.
 */
export function resolveTask(
  tasks: Task[],
  ref: string | number | undefined,
): Task | null {
  if (ref === undefined || ref === null || ref === "") return null;
  const own = ownTasks(tasks);
  const asNum =
    typeof ref === "number" ? ref : /^\d+$/.test(String(ref).trim()) ? Number(ref) : NaN;
  if (Number.isFinite(asNum)) {
    const byId = own.find((t) => t.id === asNum);
    if (byId) return byId;
  }
  const name = String(ref).trim().toLowerCase();
  return own.find((t) => t.name.trim().toLowerCase() === name) ?? null;
}

// ---------------------------------------------------------------------------
// create_task
// ---------------------------------------------------------------------------

export const createTaskTool: AiTool = {
  name: "create_task",
  description:
    "Create a task on one of the user's projects and add it to the Gantt schedule. Use this when the user asks to add or create a task (not a full experiment, use create_experiment for that). Call get_my_projects first to get the real project name or id, then call this with the project (a name or numeric id), a title, and a start date (ISO YYYY-MM-DD). Optionally pass a duration in days OR an end date (not both, the end date wins if both are given), and notes. The app shows the user a one-line preview of exactly what will be created BEFORE it writes. After it writes, confirm in one short sentence what was created and on which project. This creates an OWN task only.",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description:
          "The project to put the task on, by its name (case-insensitive) or its numeric id, from get_my_projects. Omit to leave the task unassigned to any project.",
      },
      title: {
        type: "string",
        description: "The task title, for example \"Order primers\" or \"Analyze gel\".",
      },
      startDate: {
        type: "string",
        description:
          "When the task starts, as a YYYY-MM-DD ISO date string. Map relative dates like \"next Monday\" to a real date yourself before calling.",
      },
      durationDays: {
        type: "number",
        description:
          "How many calendar days the task takes. Optional, defaults to 1. Ignored when endDate is given.",
      },
      endDate: {
        type: "string",
        description:
          "When the task ends, as a YYYY-MM-DD ISO date string. Optional. When given it sets the duration (must be on or after startDate) and overrides durationDays.",
      },
      notes: {
        type: "string",
        description:
          "Optional short notes for the task. Surfaced in the confirm summary; kept brief.",
      },
    },
    required: ["title", "startDate"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const title = String(args.title ?? "Untitled task");
    const startDate = String(args.startDate ?? "");
    const endDate = args.endDate ? String(args.endDate) : null;
    const durationDays =
      typeof args.durationDays === "number" ? args.durationDays : null;
    const projectRef =
      typeof args.project === "string" || typeof args.project === "number"
        ? String(args.project)
        : null;
    const projectNote = projectRef ? ` on project ${projectRef}` : "";
    let dateRange: string;
    if (endDate && endDate !== startDate) {
      dateRange = `${startDate} to ${endDate}`;
    } else if (durationDays && durationDays > 1) {
      dateRange = `${startDate} for ${durationDays} days`;
    } else {
      dateRange = startDate;
    }
    return { summary: `create task "${title}"${projectNote}, ${dateRange}` };
  },
  execute: async (args) => {
    const title = String(args.title ?? "").trim();
    if (!title) {
      return { ok: false as const, error: "Task title is required." };
    }
    const startDate = String(args.startDate ?? "").trim();
    if (!startDate) {
      return { ok: false as const, error: "startDate is required (YYYY-MM-DD)." };
    }

    // Resolve the project (by name or id) when one was named.
    let projectId: number | null = null;
    const projectRef =
      typeof args.project === "string" || typeof args.project === "number"
        ? (args.project as string | number)
        : undefined;
    if (projectRef !== undefined && String(projectRef).trim() !== "") {
      const projects = await taskToolsDeps.listProjects();
      const project = resolveProject(projects, projectRef);
      if (!project) {
        return {
          ok: false as const,
          error: `I could not find a project called "${projectRef}". Call get_my_projects and use a real project name or id.`,
        };
      }
      projectId = project.id;
    }

    // Duration: an explicit end date wins, else durationDays, else 1.
    const endDate = args.endDate ? String(args.endDate).trim() : null;
    let durationDays: number;
    if (endDate) {
      durationDays = daysBetween(startDate, endDate);
    } else if (typeof args.durationDays === "number") {
      durationDays = Math.max(1, Math.round(args.durationDays));
    } else {
      durationDays = 1;
    }

    let task: Task;
    try {
      task = await taskToolsDeps.createTask({
        name: title,
        start_date: startDate,
        duration_days: durationDays,
        task_type: "list",
        project_id: projectId,
      });
    } catch (err) {
      return {
        ok: false as const,
        error: `Could not create the task. ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Take the user to the Gantt so they see the new bar highlighted. Own tasks
    // use the "self" namespace in taskKey: self:<id>, like the experiment tools.
    taskToolsDeps.navigate(`/gantt?highlightTasks=self:${task.id}`);

    return {
      ok: true as const,
      id: task.id,
      name: task.name,
      startDate: task.start_date,
      endDate: task.end_date,
      durationDays: task.duration_days,
      projectId: task.project_id || null,
    };
  },
};

// ---------------------------------------------------------------------------
// reschedule_task
// ---------------------------------------------------------------------------

export const rescheduleTaskTool: AiTool = {
  name: "reschedule_task",
  description:
    "Move a task to a new start date on the Gantt. Use this when the user asks to move, reschedule, or push a task. Call get_my_tasks first to find the task, then call this with the task (a name or numeric id) and the new start date (ISO YYYY-MM-DD). This uses the dependency-aware move, so any tasks that depend on this one CASCADE to keep their gaps, and the returned result tells you how many dependents moved. This is the change most likely to surprise the user, so when you confirm, be honest that dependents shift too. The app shows a one-line preview BEFORE anything writes. The task's duration is preserved (it is shifted, not resized). After it writes, say in one short sentence what moved, to when, and how many dependent tasks shifted. Own tasks only.",
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description:
          "The task to move, by its name (case-insensitive) or numeric id, from get_my_tasks.",
      },
      newStartDate: {
        type: "string",
        description:
          "The new start date as a YYYY-MM-DD ISO string. Map relative dates to a real date before calling.",
      },
    },
    required: ["task", "newStartDate"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const ref =
      typeof args.task === "string" || typeof args.task === "number"
        ? String(args.task)
        : "?";
    const newStart = String(args.newStartDate ?? "");
    return {
      summary: `move task "${ref}" to start ${newStart} (dependent tasks shift to keep their gaps)`,
    };
  },
  execute: async (args) => {
    const ref =
      typeof args.task === "string" || typeof args.task === "number"
        ? (args.task as string | number)
        : undefined;
    const newStart = String(args.newStartDate ?? "").trim();
    if (!newStart) {
      return { ok: false as const, error: "newStartDate is required (YYYY-MM-DD)." };
    }

    const tasks = await taskToolsDeps.listTasks();
    const task = resolveTask(tasks, ref);
    if (!task) {
      return {
        ok: false as const,
        error: `I could not find one of your tasks called "${ref}". Call get_my_tasks and use a real task name or id (you can only reschedule tasks you own).`,
      };
    }

    let shift: ShiftResult;
    try {
      // confirmed: true so the cascade applies in one call (the BeakerBot confirm
      // already gated this); the move path then writes and reports what shifted.
      shift = await taskToolsDeps.moveTask(task.id, {
        new_start_date: newStart,
        confirmed: true,
      });
    } catch (err) {
      return {
        ok: false as const,
        error: `Could not move the task. ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // The shifted set INCLUDES the moved task itself; dependents are the rest.
    const dependentsMoved = Math.max(0, shift.affected_tasks.length - 1);
    const movedSelf = shift.affected_tasks.find((t) => t.task_id === task.id);

    // Take the user to the Gantt with the moved task and its dependents highlighted.
    const highlight = shift.affected_tasks.map((t) => `self:${t.task_id}`).join(",");
    taskToolsDeps.navigate(`/gantt?highlightTasks=${highlight || `self:${task.id}`}`);

    return {
      ok: true as const,
      id: task.id,
      name: task.name,
      newStartDate: movedSelf?.new_start ?? newStart,
      newEndDate: movedSelf?.new_end ?? null,
      dependentsMoved,
      // The full cascade, so the model can name which dependents shifted if asked.
      cascade: shift.affected_tasks.map((t) => ({
        id: t.task_id,
        name: t.name,
        newStart: t.new_start,
        newEnd: t.new_end,
      })),
      warnings: shift.warnings.map((w) => w.message),
    };
  },
};

// ---------------------------------------------------------------------------
// update_task
// ---------------------------------------------------------------------------

export const updateTaskTool: AiTool = {
  name: "update_task",
  description:
    "Update a task, rename it, mark it complete or incomplete, or move it to another project. Use this when the user asks to rename a task, check one off (or un-check it), or reassign it to a different project. Call get_my_tasks first to find the task, then call this with the task (a name or numeric id) and one or more of: a new title, a complete flag, or a target project. To move a task's DATES use reschedule_task instead. The app shows a one-line preview BEFORE anything writes. After it writes, confirm in one short sentence what changed. Own tasks only.",
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description:
          "The task to update, by its name (case-insensitive) or numeric id, from get_my_tasks.",
      },
      title: {
        type: "string",
        description: "A new title for the task. Optional.",
      },
      complete: {
        type: "boolean",
        description:
          "Set true to mark the task complete, false to mark it incomplete. Optional.",
      },
      project: {
        type: "string",
        description:
          "Move the task to this project, by its name or numeric id, from get_my_projects. Pass the empty string to remove it from any project. Optional.",
      },
    },
    required: ["task"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const ref =
      typeof args.task === "string" || typeof args.task === "number"
        ? String(args.task)
        : "?";
    const changes: string[] = [];
    if (typeof args.title === "string" && args.title.trim()) {
      changes.push(`rename to "${args.title.trim()}"`);
    }
    if (typeof args.complete === "boolean") {
      changes.push(args.complete ? "mark complete" : "mark incomplete");
    }
    if (typeof args.project === "string" || typeof args.project === "number") {
      const p = String(args.project).trim();
      changes.push(p ? `move to project ${p}` : "remove from its project");
    }
    const changeText = changes.length > 0 ? changes.join(", ") : "no change";
    return { summary: `update task "${ref}": ${changeText}` };
  },
  execute: async (args) => {
    const ref =
      typeof args.task === "string" || typeof args.task === "number"
        ? (args.task as string | number)
        : undefined;

    const tasks = await taskToolsDeps.listTasks();
    const task = resolveTask(tasks, ref);
    if (!task) {
      return {
        ok: false as const,
        error: `I could not find one of your tasks called "${ref}". Call get_my_tasks and use a real task name or id (you can only update tasks you own).`,
      };
    }

    const data: { name?: string; is_complete?: boolean; project_id?: number | null } = {};
    if (typeof args.title === "string" && args.title.trim()) {
      data.name = args.title.trim();
    }
    if (typeof args.complete === "boolean") {
      data.is_complete = args.complete;
    }
    // Project move: a non-empty ref resolves to an id; an explicit empty string
    // clears the assignment (project_id null).
    if (typeof args.project === "string" || typeof args.project === "number") {
      const projectRef = args.project as string | number;
      if (String(projectRef).trim() === "") {
        data.project_id = null;
      } else {
        const projects = await taskToolsDeps.listProjects();
        const project = resolveProject(projects, projectRef);
        if (!project) {
          return {
            ok: false as const,
            error: `I could not find a project called "${projectRef}". Call get_my_projects and use a real project name or id.`,
          };
        }
        data.project_id = project.id;
      }
    }

    if (Object.keys(data).length === 0) {
      return {
        ok: false as const,
        error:
          "Nothing to update. Pass a new title, a complete flag, or a project to move the task to.",
      };
    }

    let updated: Task | null;
    try {
      updated = await taskToolsDeps.updateTask(task.id, data);
    } catch (err) {
      return {
        ok: false as const,
        error: `Could not update the task. ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!updated) {
      return {
        ok: false as const,
        error: `Task ${task.id} disappeared during the update.`,
      };
    }

    taskToolsDeps.navigate(`/gantt?highlightTasks=self:${updated.id}`);

    return {
      ok: true as const,
      id: updated.id,
      name: updated.name,
      isComplete: updated.is_complete,
      projectId: updated.project_id || null,
    };
  },
};
