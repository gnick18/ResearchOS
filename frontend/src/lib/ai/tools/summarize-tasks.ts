// BeakerBot summarize_tasks tool (BeakerAI lane, 2026-06-16).
//
// Layer 2 of the summary suite (docs/proposals/beakerbot-summary-suite.md), the
// cross-task-type DEADLINE / WORKLOAD view. Where summarize_experiments scopes to
// experiment-type tasks, this aggregates EVERY task (experiments, purchases /
// orders, and list items) into one timeline answer: what is overdue, what is due
// this week, what is upcoming, and who is it on. A read-only tool that hands the
// model a deterministic tally so the model only narrates.
//
// THE HARD RULE: the TOOL computes every count and every overdue / due-soon
// determination DETERMINISTICALLY against a fixed "today". The model NEVER counts a
// task, decides what is overdue, or invents a date. It relays the lists this tool
// returns and never interprets them into a priority call.
//
// REAL FIELDS (verified against types.ts Task):
//   task_type     -> "experiment" | "purchase" | "list" (the by-type tally).
//   is_complete   -> done flag; a complete task is never overdue / due.
//   end_date      -> YYYY-MM-DD; drives overdue / due-this-week / upcoming.
//   owner         -> the owning member (tasks carry a real owner + ACL).
//   assignee      -> optional PI assignment (set + != owner means delegated).
//   flagged       -> PI flag-for-review marker (presence = flagged).
//   project_id    -> the parent project (PROJECTS ARE COLLECTIONS).
// Sources: fetchAllTasksIncludingShared (own plus everything shared with the user).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { fetchAllTasksIncludingShared, fetchAllProjectsIncludingShared } from "@/lib/local-api";
import { attachSummaryUi, type RecordSetRow } from "@/lib/ai/record-set";
import { taskSummaryReport } from "@/lib/ai/summary-report";
import type { Task } from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable deps seam. A test stubs the loaders with fixtures.
// ---------------------------------------------------------------------------

export type SummarizeTasksDeps = {
  listTasks: () => Promise<Task[]>;
  listProjects: () => Promise<Array<{ id: number | string; name: string }>>;
};

export const summarizeTasksDeps: SummarizeTasksDeps = {
  listTasks: () => fetchAllTasksIncludingShared(),
  listProjects: () => fetchAllProjectsIncludingShared(),
};

// ---------------------------------------------------------------------------
// Aggregate shape. The ENTIRE structured payload the model narrates from.
// ---------------------------------------------------------------------------

/** One task in a flagged list (overdue / due this week), deep-linked to the Gantt. */
export type TaskFlagItem = {
  id: string;
  name: string;
  type: string;
  owner: string | null;
  assignee: string | null;
  endDate: string | null;
  projectName: string | null;
  flagged: boolean;
  deepLink: string;
};

export type TaskSummary = {
  /** Echoed scope so the user sees what was summarized. */
  filter: {
    owners: string[] | null;
    keywords: string | null;
    /** The "today" used to derive overdue / due-soon, YYYY-MM-DD. */
    asOf: string;
    /** Days-ahead window used for "due this week". */
    dueWithinDays: number;
  };
  /** Total matched tasks (the tool's count). */
  count: number;
  /** Status buckets, deterministic from is_complete + end_date vs today. */
  byStatus: {
    complete: number;
    overdue: number;
    dueThisWeek: number;
    upcoming: number;
  };
  /** Count per task_type, descending. */
  byType: Array<{ type: string; count: number }>;
  /** Count per owner, descending. */
  byOwner: Array<{ owner: string; count: number }>;
  /** Count per project (collection), resolved name, descending. */
  byProject: Array<{ projectId: string; projectName: string; count: number }>;
  /** Open tasks delegated to someone other than the owner (assignee set). */
  assignedCount: number;
  /** Open tasks the PI flagged for review. */
  flaggedCount: number;
  /** Overdue tasks (not complete, end_date before today), soonest-overdue first. */
  overdue: TaskFlagItem[];
  /** Tasks due within the window (not complete, today inclusive), soonest first. */
  dueThisWeek: TaskFlagItem[];
  /** True when a flag list was capped. */
  truncated: boolean;
};

// ---------------------------------------------------------------------------
// Pure deterministic aggregation. Exported for direct unit testing.
// ---------------------------------------------------------------------------

const DEFAULT_FLAG_CAP = 15;
const DEFAULT_DUE_DAYS = 7;

function dayOf(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function taskMatchesKeywords(t: Task, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = [t.name, t.task_type, ...(Array.isArray(t.tags) ? t.tags : [])]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(" ")
    .toLowerCase();
  return tokens.every((tok) => hay.includes(tok));
}

function countDesc<T extends string>(map: Map<T, number>): Array<{ key: T; count: number }> {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

/**
 * Compute the task workload summary from tasks, a filter, a project-name map, and a
 * fixed today. Pure and deterministic, so a test passes fixtures + a frozen today
 * and asserts the exact overdue / due-soon sets.
 */
export function aggregateTasks(
  tasks: Task[],
  filter: { owners?: string[] | null; keywords?: string },
  projectNames: Map<string, string>,
  today: string,
  opts?: { dueWithinDays?: number; flagCap?: number },
): TaskSummary {
  const dueWithinDays = opts?.dueWithinDays ?? DEFAULT_DUE_DAYS;
  const flagCap = opts?.flagCap ?? DEFAULT_FLAG_CAP;
  const dueHorizon = addDays(today, dueWithinDays);

  const ownerSet =
    filter.owners && filter.owners.length > 0 ? new Set(filter.owners) : null;
  const keywordTokens = (filter.keywords ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);

  const matched = tasks.filter((t) => {
    if (ownerSet && (!t.owner || !ownerSet.has(t.owner))) return false;
    if (!taskMatchesKeywords(t, keywordTokens)) return false;
    return true;
  });

  const byType = new Map<string, number>();
  const byOwner = new Map<string, number>();
  const byProject = new Map<string, number>();
  const status = { complete: 0, overdue: 0, dueThisWeek: 0, upcoming: 0 };
  const overdue: TaskFlagItem[] = [];
  const dueThisWeek: TaskFlagItem[] = [];
  let assignedCount = 0;
  let flaggedCount = 0;

  const flag = (t: Task): TaskFlagItem => ({
    id: String(t.id),
    name: t.name || "Untitled task",
    type: t.task_type,
    owner: t.owner || null,
    assignee: t.assignee || null,
    endDate: dayOf(t.end_date),
    projectName: projectNames.get(String(t.project_id)) ?? null,
    flagged: t.flagged != null,
    deepLink: "/gantt",
  });

  for (const t of matched) {
    byType.set(t.task_type, (byType.get(t.task_type) ?? 0) + 1);
    if (t.owner) byOwner.set(t.owner, (byOwner.get(t.owner) ?? 0) + 1);
    byProject.set(String(t.project_id), (byProject.get(String(t.project_id)) ?? 0) + 1);
    if (t.assignee && t.assignee !== t.owner && !t.is_complete) assignedCount += 1;
    if (t.flagged != null && !t.is_complete) flaggedCount += 1;

    if (t.is_complete) {
      status.complete += 1;
      continue;
    }
    const end = dayOf(t.end_date);
    if (end !== null && end < today) {
      status.overdue += 1;
      overdue.push(flag(t));
    } else if (end !== null && end <= dueHorizon) {
      status.dueThisWeek += 1;
      dueThisWeek.push(flag(t));
    } else {
      status.upcoming += 1;
    }
  }

  overdue.sort((a, b) => (a.endDate ?? "").localeCompare(b.endDate ?? ""));
  dueThisWeek.sort((a, b) => (a.endDate ?? "").localeCompare(b.endDate ?? ""));

  return {
    filter: {
      owners: filter.owners && filter.owners.length > 0 ? filter.owners : null,
      keywords: filter.keywords?.trim() || null,
      asOf: today,
      dueWithinDays,
    },
    count: matched.length,
    byStatus: status,
    byType: countDesc(byType).map((r) => ({ type: r.key, count: r.count })),
    byOwner: countDesc(byOwner).map((r) => ({ owner: r.key, count: r.count })),
    byProject: countDesc(byProject).map((r) => ({
      projectId: r.key,
      projectName: projectNames.get(r.key) ?? `Project ${r.key}`,
      count: r.count,
    })),
    assignedCount,
    flaggedCount,
    overdue: overdue.slice(0, flagCap),
    dueThisWeek: dueThisWeek.slice(0, flagCap),
    truncated: overdue.length > flagCap || dueThisWeek.length > flagCap,
  };
}

// ---------------------------------------------------------------------------
// Argument parsing + runtime today.
// ---------------------------------------------------------------------------

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export const summarizeTasksTool: AiTool = {
  name: "summarize_tasks",
  description:
    "Aggregate the user's tasks ACROSS every type (experiments, purchases / orders, and list items) into one deadline and workload view: the total count, a by-status tally (complete, overdue, due this week, upcoming), a by-type tally, a by-owner tally, a by-project tally, how many open tasks are delegated to someone, how many the PI flagged for review, plus the overdue and due-this-week lists. " +
    "Call this for cross-cutting deadline questions, for example \"what is overdue\", \"what is due this week\", \"what is on my plate\", \"how busy is the lab\". For experiments specifically use summarize_experiments; this is the everything-with-a-deadline view. " +
    "Read-only, it changes nothing and runs straight away with no approval step. " +
    "THE TOOL owns every count and every overdue / due determination against a fixed today; you NEVER count a task, decide what is overdue, or invent a date. You relay the lists it returns and never interpret them into a priority call. " +
    "Pass owners (usernames) to scope to members; the whole lab is the default (own plus everything shared with the user). Pass keywords for a free-text match on the task name, type, or tags. Pass dueWithinDays to widen or narrow the due-this-week window (default 7). " +
    "Returns { ok, summary } where summary echoes the scope and carries count, byStatus, byType, byOwner, byProject, assignedCount, flaggedCount, overdue, and dueThisWeek. If nothing matches, count is 0, say so plainly.",
  parameters: {
    type: "object",
    properties: {
      owners: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional. Usernames of the lab members to scope to. Omit for the whole lab (own plus everything shared with the current user).",
      },
      keywords: {
        type: "string",
        description:
          "Optional free-text match on the task name, type, or tags, for example \"cloning\" or \"order\".",
      },
      dueWithinDays: {
        type: "number",
        description:
          "Optional. How many days ahead counts as due this week. Default 7. A task whose end date is on or before today plus this many days is flagged due.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  execute: async (args) => {
    const owners = Array.isArray(args.owners)
      ? args.owners.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : undefined;
    const keywords =
      typeof args.keywords === "string" && args.keywords.trim() ? args.keywords.trim() : undefined;
    const dueWithinDays =
      typeof args.dueWithinDays === "number" && args.dueWithinDays > 0
        ? Math.round(args.dueWithinDays)
        : undefined;

    const [tasks, projects] = await Promise.all([
      summarizeTasksDeps.listTasks(),
      summarizeTasksDeps.listProjects(),
    ]);
    const projectNames = new Map(projects.map((p) => [String(p.id), p.name]));
    const summary = aggregateTasks(
      tasks,
      { owners, keywords },
      projectNames,
      todayString(),
      dueWithinDays ? { dueWithinDays } : undefined,
    );

    // Widget rows are the tasks the user acts on first: overdue, then due this week,
    // deduped by id. Tasks embed by type + id, so the inline browser shows a real
    // preview, and the status the tool computed becomes the meta.
    const seen = new Set<string>();
    const rows: RecordSetRow[] = [];
    for (const { list, meta } of [
      { list: summary.overdue, meta: "overdue" },
      { list: summary.dueThisWeek, meta: "due this week" },
    ]) {
      for (const t of list) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        rows.push({
          type: "task" as const,
          id: t.id,
          title: t.name,
          subtitle: t.projectName ? `${t.type}, ${t.projectName}` : t.type,
          ...(t.endDate ? { date: t.endDate } : {}),
          meta,
        });
      }
    }

    return attachSummaryUi(
      { ok: true as const, summary },
      rows,
      taskSummaryReport(summary),
      { kind: "summarize_tasks", title: "Tasks to watch", total: rows.length },
    );
  },
};
