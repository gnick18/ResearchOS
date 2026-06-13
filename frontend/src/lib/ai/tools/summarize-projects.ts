// BeakerBot summarize_projects tool (BeakerAI lane, 2026-06-12).
//
// Layer 2 of the summary suite (docs/proposals/beakerbot-summary-suite.md). A
// read-only tool that rolls up the user's PROJECTS and, per project, the task
// counts by status, the percent complete, the next due date, and a blocked /
// overdue flag, so the model can write one grounded "where do my projects stand"
// narrative.
//
// THE HARD RULE: the TOOL computes every count, every percent, every next-due
// date DETERMINISTICALLY in TypeScript against a fixed "today". The model NEVER
// counts a task, derives a status, computes a percent, or invents a date. It only
// relays the aggregate this tool returns and never interprets it into a judgment
// about whether a project is "on track".
//
// Sources: projectsApi.list (own) + fetchAllProjectsIncludingShared for the lab
// view, rolled up against fetchAllTasksIncludingShared filtered by project_id. The
// rollup counts SCHEDULABLE work items (experiment + list tasks); the synthetic
// "purchase" task_type rows are order ledger entries, not schedulable work, so
// they are excluded from the task status math.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  fetchAllProjectsIncludingShared,
  fetchAllTasksIncludingShared,
  projectsApi,
} from "@/lib/local-api";
import type { Project, Task } from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable deps seam. A test stubs both loaders with fixtures and never
// touches a real folder.
// ---------------------------------------------------------------------------

export type SummarizeProjectsDeps = {
  /** Load the projects in scope (own, or own + shared). */
  listProjects: (includeShared: boolean) => Promise<Project[]>;
  /** Load every task the current user may see (own + shared-in). */
  listTasks: () => Promise<Task[]>;
};

export const summarizeProjectsDeps: SummarizeProjectsDeps = {
  listProjects: (includeShared) =>
    includeShared ? fetchAllProjectsIncludingShared() : projectsApi.list(),
  listTasks: () => fetchAllTasksIncludingShared(),
};

// ---------------------------------------------------------------------------
// Aggregate shape. The ENTIRE structured payload the model narrates from.
// ---------------------------------------------------------------------------

/** A per-project rollup. Every number here is the tool's, never the model's. */
export type ProjectSummaryItem = {
  id: string;
  name: string;
  owner: string | null;
  archived: boolean;
  /** Task counts by status, the same derivation as summarize_experiments. */
  byStatus: {
    complete: number;
    active: number;
    overdue: number;
    upcoming: number;
  };
  /** Total schedulable tasks rolled up for this project. */
  totalTasks: number;
  /** complete / totalTasks as a whole-number percent (0 when no tasks). */
  percentComplete: number;
  /** The earliest end date among not-complete tasks at or after today (the next
   *  thing due), as YYYY-MM-DD, or null when nothing is upcoming. */
  nextDueDate: string | null;
  /** The earliest START date among not-complete tasks that start after today
   *  (the nearest upcoming task), as YYYY-MM-DD, or null. */
  nearestUpcomingStart: string | null;
  /** True when at least one task is overdue (blocked / behind signal). */
  overdue: boolean;
  deepLink: string;
};

export type ProjectsSummary = {
  /** Echoed scope flags so the user sees what was summarized. */
  filter: {
    includeShared: boolean;
    includeArchived: boolean;
    /** The "today" the tool used, YYYY-MM-DD, echoed for reproducibility. */
    asOf: string;
  };
  /** Total projects in the rollup (the tool's count). */
  totalProjects: number;
  /** How many projects have at least one overdue task. */
  projectsWithOverdue: number;
  /** Per-project rollups, sorted by overdue-first then by name. */
  projects: ProjectSummaryItem[];
};

// ---------------------------------------------------------------------------
// Pure deterministic aggregation. Exported for direct unit testing.
// ---------------------------------------------------------------------------

/** The YYYY-MM-DD day prefix of an ISO-ish string, or null. */
function dayOf(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

type ProjectStatus = "complete" | "active" | "overdue" | "upcoming";

/** Status of one task against a fixed today (same rule as summarize_experiments). */
function taskStatus(task: Task, today: string): ProjectStatus {
  if (task.is_complete) return "complete";
  const start = dayOf(task.start_date);
  const end = dayOf(task.end_date);
  if (end !== null && end < today) return "overdue";
  if (start !== null && start > today) return "upcoming";
  return "active";
}

/** A schedulable work item (experiment or list task). The synthetic "purchase"
 *  task_type is an order ledger row, not schedulable work, so it is excluded. */
function isSchedulable(task: Task): boolean {
  return task.task_type === "experiment" || task.task_type === "list";
}

/**
 * Compute the projects summary from a list of projects, the full task list, and a
 * fixed "today". Pure and deterministic, so a test passes fixtures and a frozen
 * today and asserts the exact counts / percents / due dates.
 */
export function aggregateProjects(
  projects: Project[],
  tasks: Task[],
  today: string,
  opts: { includeShared: boolean; includeArchived: boolean },
): ProjectsSummary {
  // Group schedulable tasks by project id once.
  const tasksByProject = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!isSchedulable(task)) continue;
    if (task.project_id == null) continue;
    const key = String(task.project_id);
    const bucket = tasksByProject.get(key);
    if (bucket) bucket.push(task);
    else tasksByProject.set(key, [task]);
  }

  const inScope = projects.filter((p) => opts.includeArchived || !p.is_archived);

  const rollups: ProjectSummaryItem[] = inScope.map((project) => {
    const key = String(project.id);
    const projTasks = tasksByProject.get(key) ?? [];
    const byStatus = { complete: 0, active: 0, overdue: 0, upcoming: 0 };
    let nextDueDate: string | null = null;
    let nearestUpcomingStart: string | null = null;

    for (const task of projTasks) {
      const status = taskStatus(task, today);
      byStatus[status] += 1;

      if (!task.is_complete) {
        const end = dayOf(task.end_date);
        // Next due: earliest end date at or after today among open tasks.
        if (end !== null && end >= today) {
          if (nextDueDate === null || end < nextDueDate) nextDueDate = end;
        }
        const start = dayOf(task.start_date);
        // Nearest upcoming: earliest start strictly after today.
        if (start !== null && start > today) {
          if (nearestUpcomingStart === null || start < nearestUpcomingStart) {
            nearestUpcomingStart = start;
          }
        }
      }
    }

    const totalTasks = projTasks.length;
    const percentComplete =
      totalTasks > 0 ? Math.round((byStatus.complete / totalTasks) * 100) : 0;

    return {
      id: key,
      name: project.name || "Untitled project",
      owner: project.owner || null,
      archived: !!project.is_archived,
      byStatus,
      totalTasks,
      percentComplete,
      nextDueDate,
      nearestUpcomingStart,
      overdue: byStatus.overdue > 0,
      deepLink: `/?project=${project.id}`,
    };
  });

  // Overdue projects first, then alphabetical by name.
  rollups.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    filter: {
      includeShared: opts.includeShared,
      includeArchived: opts.includeArchived,
      asOf: today,
    },
    totalProjects: rollups.length,
    projectsWithOverdue: rollups.filter((r) => r.overdue).length,
    projects: rollups,
  };
}

// ---------------------------------------------------------------------------
// Argument parsing + runtime today.
// ---------------------------------------------------------------------------

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export const summarizeProjectsTool: AiTool = {
  name: "summarize_projects",
  description:
    "Roll up the user's projects and, per project, the deterministic task counts by status (complete / active / overdue / upcoming), the percent complete, the next due date, the nearest upcoming task start, and a blocked / overdue flag, plus an overall project count and how many projects have overdue work. " +
    "Call this when the user asks where their projects stand, for example \"summarize my projects\", \"which projects are behind\", \"what is overdue\", \"how far along is the cyp51A project\". " +
    "Read-only, it changes nothing and runs straight away with no approval step. " +
    "THE TOOL owns every count, percent, and due date; you NEVER count a task, derive a status, compute a percent, or invent a date yourself. You relay the numbers it returns and never interpret them into a verdict like \"on track\" or \"at risk\". " +
    "Set includeShared true to roll up the whole lab (own plus shared projects, never a member's private work); the default is your own projects. Set includeArchived true to include archived projects; the default excludes them. " +
    "Returns { ok, summary } where summary echoes the scope (includeShared, includeArchived, asOf) and carries totalProjects, projectsWithOverdue, and a per-project list (byStatus, totalTasks, percentComplete, nextDueDate, nearestUpcomingStart, overdue), sorted overdue-first. If there are no projects, totalProjects is 0, say so plainly.",
  parameters: {
    type: "object",
    properties: {
      includeShared: {
        type: "boolean",
        description:
          "Optional. true rolls up the whole lab (own plus everything shared with the user). Omit or false for your own projects only.",
      },
      includeArchived: {
        type: "boolean",
        description:
          "Optional. true includes archived projects. Omit or false to count only active projects.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  execute: async (args) => {
    const includeShared = args.includeShared === true;
    const includeArchived = args.includeArchived === true;
    const [projects, tasks] = await Promise.all([
      summarizeProjectsDeps.listProjects(includeShared),
      summarizeProjectsDeps.listTasks(),
    ]);
    const summary = aggregateProjects(projects, tasks, todayString(), {
      includeShared,
      includeArchived,
    });
    return { ok: true as const, summary };
  },
};
