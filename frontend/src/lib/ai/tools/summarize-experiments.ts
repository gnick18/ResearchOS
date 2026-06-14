// BeakerBot summarize_experiments tool (BeakerAI lane, 2026-06-12).
//
// Layer 2 of the summary suite (docs/proposals/beakerbot-summary-suite.md). A
// read-only tool that aggregates ACROSS many experiments and hands the model a
// compact, structured tally so it can write one grounded narrative.
//
// THE HARD RULE (the whole point of this tool): the TOOL computes every count,
// every group-by, and the month timeline DETERMINISTICALLY in TypeScript. The
// model NEVER counts records, never derives a status, never invents a date. It
// only narrates from the aggregate this tool returns. The result echoes the
// exact filter applied, the deterministic aggregates, and a CAPPED list of the
// matched experiments (with ids + deep links), flagged when truncated, plus a
// clean "no matching records" path. This is BeakerBot's global no-interpretation
// scope: a summary reports STRUCTURE (counts, dates, titles, status), never a
// finding.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  experimentToBrief,
  filterArtifacts,
  periodToDateRange,
  resolveProjectRefsToIds,
  resolveOwnerRefsToUsernames,
  type ArtifactBrief,
  type ArtifactFilter,
} from "@/lib/ai/artifact-index";
import {
  fetchAllProjectsIncludingShared,
  fetchAllTasksIncludingShared,
  usersApi,
} from "@/lib/local-api";
import { attachRecordSetIfBig, periodLabel, RECORD_SET_UI_CAP, type RecordSetRow } from "@/lib/ai/record-set";
import type { Project, Task } from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable deps seam (mirrors artifactIndexDeps / readArtifactDeps). A test
// stubs listExperiments and listProjects with fixtures and never touches a
// real folder.
// ---------------------------------------------------------------------------

export type SummarizeExperimentsDeps = {
  /** Load every experiment Task the current user may see (own + shared-in),
   *  ACL-enforced by fetchAllTasksIncludingShared upstream. */
  listExperiments: () => Promise<Task[]>;
  /** Load all projects visible to the current user (own + shared), used to
   *  resolve project ids to human-readable names in the byProject breakdown. */
  listProjects: () => Promise<Project[]>;
  /** The lab member usernames, used to resolve owner NAMES the model passed
   *  ("Kritika") to real usernames before scoping. */
  listMemberUsernames: () => Promise<string[]>;
};

export const summarizeExperimentsDeps: SummarizeExperimentsDeps = {
  listExperiments: async () => {
    const all = await fetchAllTasksIncludingShared();
    return all.filter((t) => t.task_type === "experiment");
  },
  listProjects: () => fetchAllProjectsIncludingShared(),
  listMemberUsernames: async () => {
    try {
      return (await usersApi.list()).users;
    } catch {
      return [];
    }
  },
};

// ---------------------------------------------------------------------------
// Aggregate shape. This is the ENTIRE structured payload the model narrates from.
// It contains numbers the tool computed, never raw record dumps.
// ---------------------------------------------------------------------------

/** One matched experiment, capped + deep-linked, for the model to list / chip. */
export type ExperimentSummaryItem = {
  id: string;
  title: string;
  status: "complete" | "active" | "overdue" | "upcoming";
  startDate: string | null;
  endDate: string | null;
  projectId: string | null;
  /** Resolved human-readable project name. Narrate this, not the raw id. Falls
   *  back to the id string if no project record exists for that id. Null when
   *  the experiment has no project. */
  projectName: string | null;
  owner: string | null;
  deepLink: string;
};

export type ExperimentSummary = {
  /** The exact filter applied, echoed so the user sees the scope. */
  filter: ArtifactFilter;
  /** Total matched experiments (the tool's count, never the model's). */
  total: number;
  /** Deterministic status tally. overdue = not complete and end date < today;
   *  upcoming = not complete and start date > today; active = the rest of the
   *  not-complete ones. complete = is_complete. */
  byStatus: {
    complete: number;
    active: number;
    overdue: number;
    upcoming: number;
  };
  /** Count per project, resolved to a human name. Only projects with at least
   *  one match appear. The model MUST narrate the projectName, never the raw
   *  projectId. Falls back to the id string only when no project record exists
   *  for that id. */
  byProject: Array<{ projectId: string; projectName: string; count: number }>;
  /** Count per owning member (only owners with at least one match appear). */
  byOwner: Record<string, number>;
  /** Count per calendar month (YYYY-MM) by start date, plus an "undated" bucket
   *  for experiments with no usable start date. Sorted ascending by key. */
  byMonth: Array<{ month: string; count: number }>;
  /** How many not-complete experiments END within the next 7 days (today
   *  inclusive). The "what is finishing this week" signal. */
  finishingThisWeek: number;
  /** The "today" the tool used to derive overdue / upcoming / this-week, as a
   *  YYYY-MM-DD string, echoed so the narration is reproducible. */
  asOf: string;
  /** Up to `cap` most-recent matched experiments with deep links. */
  items: ExperimentSummaryItem[];
  /** True when more experiments matched than `items` carries. */
  truncated: boolean;
};

// ---------------------------------------------------------------------------
// Pure deterministic aggregation. Exported for direct unit testing so a test
// asserts the COUNTS / TALLIES the tool produces from a fixture, never the model.
// ---------------------------------------------------------------------------

const DEFAULT_ITEM_CAP = 15;

/** The YYYY-MM-DD day prefix of an ISO-ish string, or null. Local copy kept
 *  pure so the aggregator never reaches into the index module's internals. */
function dayOf(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

/** Add `days` to a YYYY-MM-DD day string and return a new YYYY-MM-DD string.
 *  UTC math so it is timezone-stable and matches the day-granular comparisons. */
function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the experiment summary from a list of tasks, a filter, and a fixed
 * "today". Pure and deterministic, so a test passes a fixture + a frozen today
 * and asserts the exact counts. The runtime tool resolves `today` from the real
 * Date; the test pins it.
 *
 * Pass `projectNames` (a Map from project id string to project name) to
 * resolve byProject buckets to human names. The runtime tool builds this map
 * from the project list returned by the deps seam. Tests that do not care about
 * name resolution may omit it (defaults to an empty map, falling back to ids).
 */
export function aggregateExperiments(
  tasks: Task[],
  filter: ArtifactFilter,
  today: string,
  cap: number = DEFAULT_ITEM_CAP,
  projectNames: Map<string, string> = new Map(),
): ExperimentSummary {
  // Convert to briefs (carrying owner) and keep a compound-key map (owner + ":"
  // + id) so experiments from different owners that share the same per-user
  // numeric id never collide. Each brief carries the synthetic compound key in
  // its id field so filterArtifacts routes back to exactly one record; the map
  // value keeps the REAL-id brief for downstream display. A plain-id map kept the
  // total count right but double-counted one owner's experiment and dropped the
  // other in the byStatus / byProject / byOwner breakdowns.
  const byCompoundKey = new Map<string, { brief: ArtifactBrief; task: Task }>();
  const briefs: ArtifactBrief[] = [];
  for (const task of tasks) {
    if (task.task_type !== "experiment") continue;
    const brief = experimentToBrief(task);
    const compoundKey = `${task.owner ?? ""}:${brief.id}`;
    briefs.push({ ...brief, id: compoundKey });
    byCompoundKey.set(compoundKey, { brief, task });
  }

  const matched = filterArtifacts(briefs, filter)
    .map((b) => byCompoundKey.get(b.id))
    .filter((x): x is { brief: ArtifactBrief; task: Task } => x !== undefined);

  const byStatus = { complete: 0, active: 0, overdue: 0, upcoming: 0 };
  const byProjectCounts = new Map<string, number>();
  const byOwner: Record<string, number> = {};
  const monthCounts = new Map<string, number>();
  const weekEnd = addDays(today, 7);
  let finishingThisWeek = 0;

  const statusOf = (task: Task): ExperimentSummaryItem["status"] => {
    if (task.is_complete) return "complete";
    const start = dayOf(task.start_date);
    const end = dayOf(task.end_date);
    if (end !== null && end < today) return "overdue";
    if (start !== null && start > today) return "upcoming";
    return "active";
  };

  for (const { task } of matched) {
    const status = statusOf(task);
    byStatus[status] += 1;

    const projectId = task.project_id ? String(task.project_id) : null;
    if (projectId) byProjectCounts.set(projectId, (byProjectCounts.get(projectId) ?? 0) + 1);

    const owner = task.owner || null;
    if (owner) byOwner[owner] = (byOwner[owner] ?? 0) + 1;

    const startDay = dayOf(task.start_date);
    const monthKey = startDay ? startDay.slice(0, 7) : "undated";
    monthCounts.set(monthKey, (monthCounts.get(monthKey) ?? 0) + 1);

    // Finishing this week: not complete and end date in [today, today + 7).
    if (!task.is_complete) {
      const endDay = dayOf(task.end_date);
      if (endDay !== null && endDay >= today && endDay < weekEnd) {
        finishingThisWeek += 1;
      }
    }
  }

  const byMonth = Array.from(monthCounts.entries())
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // Most-recent-first by start date for the capped list.
  const sorted = [...matched].sort((a, b) => {
    const da = dayOf(a.task.start_date) ?? "";
    const db = dayOf(b.task.start_date) ?? "";
    return db.localeCompare(da);
  });

  // Resolve byProject id map to named buckets. Fall back to the id string only
  // when no project record exists (e.g. the project was deleted after sharing).
  const byProject = Array.from(byProjectCounts.entries()).map(([projectId, count]) => ({
    projectId,
    projectName: projectNames.get(projectId) ?? projectId,
    count,
  }));

  const items: ExperimentSummaryItem[] = sorted.slice(0, cap).map(({ brief, task }) => {
    const projectId = task.project_id ? String(task.project_id) : null;
    return {
      id: brief.id,
      title: brief.title,
      status: statusOf(task),
      startDate: dayOf(task.start_date),
      endDate: dayOf(task.end_date),
      projectId,
      projectName: projectId ? (projectNames.get(projectId) ?? projectId) : null,
      owner: task.owner || null,
      deepLink: brief.deepLink,
    };
  });

  return {
    filter,
    total: matched.length,
    byStatus,
    byProject,
    byOwner,
    byMonth,
    finishingThisWeek,
    asOf: today,
    items,
    truncated: matched.length > items.length,
  };
}

// ---------------------------------------------------------------------------
// Argument parsing. The model passes absolute YYYY-MM-DD dates (it resolves
// relative phrasing via the date-context line, exactly like search_my_work).
// ---------------------------------------------------------------------------

function parseFilter(args: Record<string, unknown>): ArtifactFilter {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : undefined;
  // Experiments are a single type; the summarize tool never widens it.
  return {
    types: ["experiment"],
    since: str(args.since),
    until: str(args.until),
    owners: strArr(args.owners),
    projectIds: strArr(args.projectIds),
    status: str(args.status),
    keywords: str(args.keywords),
  };
}

/** Today as a YYYY-MM-DD string from the real Date at call time. */
function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export const summarizeExperimentsTool: AiTool = {
  name: "summarize_experiments",
  description:
    "Aggregate the user's experiments across a filter and return a deterministic summary (counts, status tally, by-project and by-owner breakdowns, a month timeline, how many finish this week, and the most recent matches with deep links). " +
    "Call this when the user asks you to summarize, count, tally, or review experiments over a scope, for example \"summarize my experiments this quarter\", \"how many experiments did Kritika run in May\", \"what is finishing this week\". " +
    "Read-only, it changes nothing and runs straight away with no approval step. " +
    "THE TOOL owns every count, status, and total; you NEVER count records, derive a status, or invent a date yourself. You only relay the numbers it returns and never interpret them into a finding. " +
    "Pass absolute YYYY-MM-DD dates for since / until; resolve relative phrasing (\"this quarter\", \"last month\") to absolute dates yourself using the current date in the context line first. " +
    "Pass owners (usernames) to scope to one or more members; the whole lab is the default (own plus everything shared with the user, never a member's private work). Pass projectIds to scope to projects, status to scope to complete / active / overdue / upcoming, and keywords for a free-text match. " +
    "Returns { ok, summary } where summary echoes the filter and carries total, byStatus, byProject (an array of { projectId, projectName, count } objects), byOwner, byMonth, finishingThisWeek, asOf, and a capped items list (flagged truncated). Each byProject entry and each item now carries a projectName field; always narrate the projectName, never the raw projectId. If nothing matches, summary.total is 0, say so plainly.",
  parameters: {
    type: "object",
    properties: {
      since: {
        type: "string",
        description:
          "Optional inclusive lower bound as YYYY-MM-DD. Only experiments whose start date is on or after this day are counted. Resolve relative phrasing to an absolute date yourself first.",
      },
      until: {
        type: "string",
        description:
          "Optional inclusive upper bound as YYYY-MM-DD. Only experiments whose start date is on or before this day are counted.",
      },
      owners: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional. Lab members to scope to, by NAME or username (for example [\"Kritika\"]). The tool resolves names to usernames itself, tolerating case and small typos, so just pass what the user said; you do NOT need to call list_lab_members first. Omit for the whole lab (own plus everything shared with the current user). Never reaches a member's private work, only what is shared.",
      },
      projects: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional. Projects to scope to, by NAME or by numeric id. The tool resolves names to ids itself, so just pass what the user said (for example [\"cyp51A knockout\"]). You do NOT need to look up the id first. An experiment in any listed project is counted.",
      },
      projectIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional. Project ids to scope to (the resolved-id form of `projects`). Prefer `projects` with names; this is only for when you already hold ids.",
      },
      status: {
        type: "string",
        description:
          "Optional. Scope to one status: \"complete\", \"active\", \"overdue\", or \"upcoming\". Omit to count every status.",
      },
      keywords: {
        type: "string",
        description:
          "Optional free-text match on the experiment name and tags, for example \"miniprep\" or \"cyp51A\".",
      },
      period: {
        type: "string",
        description:
          "Optional relative date window the TOOL resolves to since/until for you, so you never compute dates yourself. One of: today, this_week, last_week, this_month, last_month, this_quarter, last_quarter, this_year, last_year, all_time. Prefer this over computing since/until by hand whenever the user says a relative window (\"last month\", \"this quarter\"). An explicit since/until you also pass wins over the period for that bound.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  execute: async (args) => {
    const today = todayString();
    const baseFilter = parseFilter(args);
    // Resolve a relative period token (last_month, this_quarter, ...) to dates
    // DETERMINISTICALLY in the tool, so the weak model never does date arithmetic.
    // An explicit since/until the model also passed wins over the period bound.
    const period = typeof args.period === "string" ? args.period : undefined;
    const range = periodToDateRange(period, today);
    const [tasks, projects, members] = await Promise.all([
      summarizeExperimentsDeps.listExperiments(),
      summarizeExperimentsDeps.listProjects(),
      summarizeExperimentsDeps.listMemberUsernames(),
    ]);
    // Resolve any project NAMES the model passed into ids, merged with any explicit
    // projectIds, so the model never has to chain a search_my_work lookup first.
    const nameRefs = Array.isArray(args.projects)
      ? (args.projects as Array<string | number>)
      : [];
    const resolvedIds = resolveProjectRefsToIds(nameRefs, projects);
    // Resolve owner NAMES the model passed ("Kritika", "kritka") to real usernames,
    // so the model never has to chain list_lab_members first. If owners were given
    // but none resolve (e.g. no member list), keep the raw strings rather than
    // silently widening the scope to the whole lab.
    const rawOwners = baseFilter.owners ?? [];
    const resolvedOwners = resolveOwnerRefsToUsernames(rawOwners, members);
    // Check 4 (live-verify 2026-06-14): the user named owner(s) but NONE resolved to
    // a real member. Do not silently filter by the raw unmatched name and return an
    // empty summary that reads like a real-but-empty member. Signal the miss so the
    // model asks who was meant. A real member with no records still has a resolved
    // username, so this never fires on a legitimate empty result. Guarded on a known
    // roster: when members is empty (solo user, or the roster API returned nothing)
    // we cannot tell a typo from a valid owner, so keep the raw filter as before.
    if (members.length > 0 && rawOwners.length > 0 && resolvedOwners.length === 0) {
      return {
        ok: false as const,
        error: `No lab member matched ${rawOwners.map((o) => `"${o}"`).join(", ")}. Ask the user who they mean, or call list_lab_members for the real names, instead of summarizing an empty set.`,
      };
    }
    const filter: ArtifactFilter = {
      ...baseFilter,
      since: baseFilter.since ?? range.since,
      until: baseFilter.until ?? range.until,
      owners: rawOwners.length > 0 ? (resolvedOwners.length > 0 ? resolvedOwners : rawOwners) : undefined,
      projectIds: [...new Set([...(baseFilter.projectIds ?? []), ...resolvedIds])],
    };
    const projectNames = new Map(
      projects.map((p) => [String(p.id), p.name || "Untitled project"]),
    );
    // Aggregate ONCE at the UI cap so the full matched list is available for the
    // inline record-set widget, then narrow the model-facing summary back to the
    // documented item cap (counts and tallies are cap-independent). The widget gets
    // every match; the model still gets only DEFAULT_ITEM_CAP items.
    const fullSummary = aggregateExperiments(
      tasks,
      filter,
      today,
      RECORD_SET_UI_CAP,
      projectNames,
    );
    const modelItems = fullSummary.items.slice(0, DEFAULT_ITEM_CAP);
    const summary: ExperimentSummary = {
      ...fullSummary,
      items: modelItems,
      truncated: fullSummary.total > modelItems.length,
    };

    // attachRecordSetIfBig gates the inline widget on the ">4" rule, so a summary of
    // 4 or fewer experiments shows inline chips and 5 or more renders the browser.
    const rows = fullSummary.items.map(
      (it): RecordSetRow => ({
        type: "experiment",
        id: String(it.id),
        title: it.title,
        ...(it.projectName ? { subtitle: it.projectName } : {}),
        ...(it.startDate ? { date: it.startDate } : {}),
        meta: it.status,
      }),
    );

    return attachRecordSetIfBig({ ok: true as const, summary }, rows, {
      kind: "summarize_experiments",
      title: periodLabel("Experiments", filter),
      total: fullSummary.total,
    });
  },
};
