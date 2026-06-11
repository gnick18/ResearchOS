// BeakerBot read-your-work tools (ai tools bot, 2026-06-10).
//
// The first tools BeakerBot can call, both READ-ONLY. They let the assistant
// answer "what am I working on" from the user's real folder instead of guessing,
// which is the whole point of the orchestrates-not-computes rule.
//
// Wiring, the Workbench TODAY panel loads tasks via `fetchAllTasksIncludingShared`
// from `@/lib/local-api`, the same reader the Workbench list uses, and projects
// via `projectsApi.list`. We call those existing readers directly (not the React
// hooks), so the tool runs outside React in the agent loop. We only READ, we never
// write, and we do not touch the shared store layer.
//
// The model-facing result is deliberately compact, a small array of plain objects,
// not raw Task/Project records. The shaping functions are pure so they unit-test
// against mock data with no folder and no network.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { fetchAllTasksIncludingShared, projectsApi } from "@/lib/local-api";
import type { Project, Task } from "@/lib/types";
import type { AiTool } from "./types";

// The compact, model-friendly view of one task. Only the fields the assistant
// needs to reason about and talk about, so the payload stays small and the model
// never sees internal sidecar machinery.
export type TaskBrief = {
  title: string;
  status: "complete" | "overdue" | "active" | "upcoming";
  start: string;
  due: string;
  project: string | null;
  shared: boolean;
};

export type ProjectBrief = {
  name: string;
  archived: boolean;
  shared: boolean;
};

/** Today as YYYY-MM-DD in the user's local timezone. Matches the date strings the
 *  task records store, so comparisons are plain string compares. Injectable for
 *  deterministic tests. */
export function localTodayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Map one Task to its brief, resolving the project name from a lookup and deriving
// a coarse status the model can speak to. Pure, no I/O.
function toTaskBrief(
  task: Task,
  projectsById: Map<number, string>,
  today: string,
): TaskBrief {
  let status: TaskBrief["status"];
  if (task.is_complete) {
    status = "complete";
  } else if (task.end_date && task.end_date < today) {
    status = "overdue";
  } else if (task.start_date && task.start_date > today) {
    status = "upcoming";
  } else {
    status = "active";
  }
  return {
    title: task.name,
    status,
    start: task.start_date,
    due: task.end_date,
    project: projectsById.get(task.project_id) ?? null,
    shared: task.is_shared_with_me === true,
  };
}

/** Shape the raw tasks + projects into the model-facing result for get_my_tasks.
 *  Pure, so tests feed mock arrays. Drops list-type rows (those are checklist
 *  items, not bench work) and, unless `includeCompleted`, completed tasks, so the
 *  assistant sees the open work that "what am I working on" asks about. */
export function shapeMyTasks(
  tasks: Task[],
  projects: Project[],
  options: { includeCompleted?: boolean; today?: string } = {},
): { today: string; count: number; tasks: TaskBrief[] } {
  const today = options.today ?? localTodayIso();
  const projectsById = new Map<number, string>(
    projects.map((p) => [p.id, p.name]),
  );
  const briefs = tasks
    .filter((t) => t.task_type !== "list")
    .map((t) => toTaskBrief(t, projectsById, today))
    .filter((b) => options.includeCompleted || b.status !== "complete")
    // Soonest due first, so the most pressing work leads the list.
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return { today, count: briefs.length, tasks: briefs };
}

/** Shape the raw projects into the model-facing result for get_my_projects.
 *  Pure. Drops hidden projects (the internal `_misc_purchases` backing project)
 *  and, unless asked, archived ones. */
export function shapeMyProjects(
  projects: Project[],
  options: { includeArchived?: boolean } = {},
): { count: number; projects: ProjectBrief[] } {
  const briefs = projects
    .filter((p) => p.is_hidden !== true)
    .filter((p) => options.includeArchived || !p.is_archived)
    .map((p) => ({
      name: p.name,
      archived: p.is_archived === true,
      shared: p.is_shared_with_me === true,
    }));
  return { count: briefs.length, projects: briefs };
}

// get_my_tasks, the user's current tasks, the same data the Workbench TODAY panel
// shows. Read-only.
export const getMyTasksTool: AiTool = {
  name: "get_my_tasks",
  description:
    "Get the user's current experiments and tasks from their ResearchOS folder, the same work the Workbench shows. Returns each task's title, status (active, overdue, upcoming, or complete), start date, due date, and project. Call this to answer anything about what the user is working on, what is due, or what is overdue. Read-only.",
  parameters: {
    type: "object",
    properties: {
      includeCompleted: {
        type: "boolean",
        description:
          "Include already-completed tasks. Defaults to false, so only open work is returned.",
      },
    },
    additionalProperties: false,
  },
  execute: async (args) => {
    const includeCompleted = args.includeCompleted === true;
    const [tasks, projects] = await Promise.all([
      fetchAllTasksIncludingShared(),
      projectsApi.list(),
    ]);
    return shapeMyTasks(tasks, projects, { includeCompleted });
  },
};

// get_my_projects, the user's projects. Cheap, read-only, gives the assistant the
// shape of the user's work when a task list alone is not the question.
export const getMyProjectsTool: AiTool = {
  name: "get_my_projects",
  description:
    "Get the user's projects from their ResearchOS folder. Returns each project's name and whether it is archived or shared with the user. Call this to answer what projects the user has or to scope a question to a project. Read-only.",
  parameters: {
    type: "object",
    properties: {
      includeArchived: {
        type: "boolean",
        description:
          "Include archived projects. Defaults to false, so only active projects are returned.",
      },
    },
    additionalProperties: false,
  },
  execute: async (args) => {
    const includeArchived = args.includeArchived === true;
    const projects = await projectsApi.list();
    return shapeMyProjects(projects, { includeArchived });
  },
};
