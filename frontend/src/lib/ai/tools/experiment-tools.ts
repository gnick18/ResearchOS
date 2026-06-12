// BeakerBot experiment coworker tools (ai experiment-tools bot, 2026-06-11).
//
// Three gated WRITE tools that let BeakerBot create and schedule experiments
// (Tasks with task_type "experiment") on behalf of the user.
//
//   - create_experiment: create a single experiment with name + dates.
//   - reschedule_experiment: move an existing experiment's dates.
//   - create_experiment_chain: create a series of back-to-back experiments
//     and link them with FS dependency edges so they appear on the Gantt.
//
// All three are ACTION tools (action: true). The user sees a preview of
// exactly what will be created or moved before ANYTHING writes, so there is
// no ambiguity about what they approved.
//
// The Gantt supports real dependency edges (Dependency records with
// parent_id / child_id / dep_type "FS" | "SS" | "SF" stored separately in
// dependencies/). create_experiment_chain creates those "finish-to-start"
// (FS) edges between consecutive chain members so the relationship is visible
// on the Gantt. If the dependency write fails, the experiments themselves
// still stand and an informational note is returned.
//
// Key field names (confirmed from types.ts and local-api.ts):
//   Task.start_date  -- YYYY-MM-DD ISO string
//   Task.end_date    -- derived, always stored; recomputed from start_date + duration_days
//   Task.duration_days -- the canonical length field (end_date is a cache)
//   Task.task_type   -- "experiment" | "purchase" | "list"
//   Task.project_id  -- 0 = no project
//   Task.method_ids  -- number[]
//
// Injectable seam so every export is unit-testable without a real folder.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { tasksApi, dependenciesApi, methodsApi } from "@/lib/local-api";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import {
  fetchMethodCatalogTemplate,
  instantiateMethodFromTemplate,
  type MethodCatalogTemplate,
  type InstantiateTemplateOptions,
} from "@/lib/methods/method-catalog";
import type { Task, Method } from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable seam
// ---------------------------------------------------------------------------

export type ExperimentToolsDeps = {
  /** Create a new experiment (task_type "experiment"). Returns the saved Task. */
  createTask: (data: {
    name: string;
    start_date: string;
    duration_days: number;
    task_type: "experiment";
    project_id?: number | null;
    method_ids?: number[];
  }) => Promise<Task>;
  /** Fetch an existing task by its numeric id. Returns null when not found. */
  getTask: (id: number) => Promise<Task | null>;
  /** Update a task's dates. Returns null when the id is not found. */
  updateTask: (
    id: number,
    data: { start_date: string; duration_days: number },
  ) => Promise<Task | null>;
  /** Create a finish-to-start dependency edge between two task ids. */
  createDependency: (parentId: number, childId: number) => Promise<void>;
  /** List the user's existing methods (for template-reuse lookup). */
  listMethods: () => Promise<Method[]>;
  /** Fetch a catalog template payload by slug. */
  fetchTemplate: (slug: string) => Promise<MethodCatalogTemplate>;
  /** Instantiate a catalog template as a new private user method. */
  instantiateTemplate: (
    template: MethodCatalogTemplate,
    options: InstantiateTemplateOptions,
  ) => Promise<Method>;
  /** Navigate the user to an internal path after a successful write.
   *  Defaults to the navigation bridge (soft SPA router.push).
   *  Injected so tests assert the call without a real router. */
  navigate: (path: string) => void;
};

export const experimentToolsDeps: ExperimentToolsDeps = {
  createTask: (data) => tasksApi.create(data),
  getTask: (id) => tasksApi.get(id),
  updateTask: (id, data) => tasksApi.update(id, data),
  createDependency: (parentId, childId) =>
    dependenciesApi.create({ parent_id: parentId, child_id: childId, dep_type: "FS" }).then(() => undefined),
  listMethods: () => methodsApi.list(),
  fetchTemplate: (slug) => fetchMethodCatalogTemplate(slug),
  instantiateTemplate: (template, options) =>
    instantiateMethodFromTemplate(template, options),
  navigate: requestNavigation,
};

// ---------------------------------------------------------------------------
// Method-template attach (reuse-or-instantiate)
// ---------------------------------------------------------------------------

/** Prefix of the tag stamped on a method instantiated from a catalog template,
 *  so a later experiment chain can REUSE it instead of creating a duplicate. The
 *  full tag is `from-template:<slug>`. Living in the AI tool layer keeps the
 *  convention additive (the instantiate path takes it as a plain tag override).
 */
export const TEMPLATE_PROVENANCE_PREFIX = "from-template:";

/** The provenance tag for one template slug. */
export function templateProvenanceTag(slug: string): string {
  return `${TEMPLATE_PROVENANCE_PREFIX}${slug}`;
}

/**
 * Resolve a catalog template slug to a method id to attach. Reuses an existing
 * method stamped with this template's provenance tag when one is present (so a
 * chain does not pile up duplicate methods), otherwise fetches the template and
 * instantiates a fresh private method tagged with the provenance tag. A reuse-
 * lookup failure falls through to instantiation; a fetch / instantiate failure
 * is returned as an error so the caller can surface it without aborting the
 * whole chain.
 */
export async function resolveMethodIdForTemplate(
  slug: string,
  deps: ExperimentToolsDeps,
): Promise<{ ok: true; id: number; reused: boolean } | { ok: false; error: string }> {
  const tag = templateProvenanceTag(slug);

  // Reuse an existing instantiation when one carries the provenance tag.
  try {
    const methods = await deps.listMethods();
    const existing = methods.find((m) => (m.tags ?? []).includes(tag));
    if (existing) return { ok: true, id: existing.id, reused: true };
  } catch {
    // A listing failure is not fatal; fall through and instantiate fresh.
  }

  let template: MethodCatalogTemplate;
  try {
    template = await deps.fetchTemplate(slug);
  } catch {
    return {
      ok: false,
      error: `There is no method template "${slug}" in the catalog. Use a slug from the template library, or omit it.`,
    };
  }

  try {
    const method = await deps.instantiateTemplate(template, {
      tags: [...(template.tags ?? []), tag],
    });
    return { ok: true, id: method.id, reused: false };
  } catch (err) {
    return {
      ok: false,
      error: `Could not create a method from template "${slug}". ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Date utilities (pure, exported for tests)
// ---------------------------------------------------------------------------

/** Parse a YYYY-MM-DD string to a UTC midnight Date. Throws on bad input. */
export function parseIso(date: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid ISO date: "${date}"`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Format a Date to YYYY-MM-DD (UTC). */
export function formatIso(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Return the number of calendar days between two YYYY-MM-DD strings (inclusive start, exclusive end).
 *  That matches how Task.duration_days is used: a 1-day experiment that
 *  starts and ends on the same date has duration_days 1. */
export function daysBetween(startIso: string, endIso: string): number {
  const start = parseIso(startIso);
  const end = parseIso(endIso);
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

/** Advance a YYYY-MM-DD date by `days` calendar days. */
export function addDays(dateIso: string, days: number): string {
  const d = parseIso(dateIso);
  d.setUTCDate(d.getUTCDate() + days);
  return formatIso(d);
}

// ---------------------------------------------------------------------------
// Chain scheduling (pure, exported for tests)
// ---------------------------------------------------------------------------

export interface ChainExperimentSpec {
  name: string;
  durationDays?: number;
  methodIds?: number[];
  /** Optional catalog template slug to attach (reuse-or-instantiate). */
  methodTemplateSlug?: string;
}

export interface ScheduledChainItem {
  name: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  methodIds: number[];
  /** Carried through from the spec so the execute step can resolve + attach. */
  methodTemplateSlug?: string;
}

/**
 * Compute the back-to-back schedule for a chain of experiments.
 * Each experiment starts when the previous one ends (plus gapDays).
 * durationDays defaults to 1 when not supplied.
 *
 * Pure function, no I/O.
 */
export function computeChainDates(
  experiments: ChainExperimentSpec[],
  startDate: string,
  gapDays = 0,
): ScheduledChainItem[] {
  if (experiments.length === 0) return [];

  const result: ScheduledChainItem[] = [];
  let cursor = startDate;

  for (const exp of experiments) {
    const duration = Math.max(1, exp.durationDays ?? 1);
    const endDate = addDays(cursor, duration);
    result.push({
      name: exp.name,
      startDate: cursor,
      endDate,
      durationDays: duration,
      methodIds: exp.methodIds ?? [],
      methodTemplateSlug: exp.methodTemplateSlug,
    });
    // Next experiment starts at the end of this one, plus gap.
    cursor = addDays(endDate, gapDays);
  }

  return result;
}

// ---------------------------------------------------------------------------
// create_experiment
// ---------------------------------------------------------------------------

export const createExperimentTool: AiTool = {
  name: "create_experiment",
  description:
    "Create a new experiment in the user's ResearchOS folder. An experiment is a scheduled lab task with a name and date range. Use this when the user asks you to create, add, or schedule an experiment, for example \"create a PCR experiment starting Monday\" or \"add a miniprep experiment next week\". Call it with a name, a start date (ISO YYYY-MM-DD), and optionally an end date, project id, and method ids. The app shows the user a preview of the experiment BEFORE it writes anything, so they confirm the name and dates first. After it writes, confirm in one short sentence what was created.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "The experiment name, for example \"PCR amplification\" or \"miniprep\".",
      },
      startDate: {
        type: "string",
        description:
          "When the experiment starts, as a YYYY-MM-DD ISO date string. Map relative dates like \"next Monday\" or \"in two weeks\" to real dates yourself before calling.",
      },
      endDate: {
        type: "string",
        description:
          "When the experiment ends, as a YYYY-MM-DD ISO date string. Optional. Defaults to the same day as startDate (a one-day experiment). Must be on or after startDate.",
      },
      projectId: {
        type: "number",
        description:
          "The numeric project id to attach this experiment to. Optional. Omit to leave it unassigned.",
      },
      methodIds: {
        type: "array",
        items: { type: "number" },
        description:
          "Numeric method ids to attach to the experiment. Optional. Get real ids from search_my_work if the user named a method.",
      },
    },
    required: ["name", "startDate"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const name = String(args.name ?? "Untitled experiment");
    const startDate = String(args.startDate ?? "");
    const endDate = args.endDate ? String(args.endDate) : startDate;
    const projectId =
      typeof args.projectId === "number" ? args.projectId : null;
    const projectNote = projectId ? ` in project ${projectId}` : "";
    const dateRange =
      endDate === startDate
        ? startDate
        : `${startDate} to ${endDate}`;
    return {
      summary: `create experiment "${name}" from ${dateRange}${projectNote}`,
    };
  },
  execute: async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) {
      return { ok: false as const, error: "Experiment name is required." };
    }
    const startDate = String(args.startDate ?? "").trim();
    if (!startDate) {
      return { ok: false as const, error: "startDate is required (YYYY-MM-DD)." };
    }
    const endDate = args.endDate ? String(args.endDate).trim() : startDate;
    const durationDays = daysBetween(startDate, endDate);
    const projectId =
      typeof args.projectId === "number" ? args.projectId : null;
    const methodIds: number[] = Array.isArray(args.methodIds)
      ? (args.methodIds as unknown[]).filter((x): x is number => typeof x === "number")
      : [];

    let task: Task;
    try {
      task = await experimentToolsDeps.createTask({
        name,
        start_date: startDate,
        duration_days: durationDays,
        task_type: "experiment",
        project_id: projectId,
        method_ids: methodIds,
      });
    } catch (err) {
      return {
        ok: false as const,
        error: `Could not create the experiment. ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Navigate the user to the Gantt so they see the new bar highlighted.
    // Hard-wired here (not left to the model), like run_datahub_analysis.
    // Own tasks always use the "self" namespace in taskKey: self:<id>.
    experimentToolsDeps.navigate(`/gantt?highlightTasks=self:${task.id}`);

    return {
      ok: true as const,
      id: task.id,
      name: task.name,
      startDate: task.start_date,
      endDate: task.end_date,
      durationDays: task.duration_days,
      projectId: task.project_id || null,
      methodCount: task.method_ids.length,
    };
  },
};

// ---------------------------------------------------------------------------
// reschedule_experiment
// ---------------------------------------------------------------------------

export const rescheduleExperimentTool: AiTool = {
  name: "reschedule_experiment",
  description:
    "Move an existing experiment to new dates. Use this when the user asks to reschedule, move, or push back an experiment, for example \"move the miniprep to next week\" or \"push the PCR to July 15th\". To find the experiment, call search_my_work first to get its id. Do not guess an id. The app shows the user a preview of the old and new dates BEFORE anything is written. After it writes, confirm in one short sentence what was moved and to when.",
  parameters: {
    type: "object",
    properties: {
      experimentId: {
        type: "number",
        description:
          "The numeric id of the experiment to reschedule. Get this from search_my_work, never guess it.",
      },
      newStartDate: {
        type: "string",
        description:
          "The new start date as a YYYY-MM-DD ISO string. Map relative dates to real dates before calling.",
      },
      newEndDate: {
        type: "string",
        description:
          "The new end date as a YYYY-MM-DD ISO string. Optional. When omitted, the experiment's original duration is preserved (it is shifted but not resized). When given, must be on or after newStartDate.",
      },
    },
    required: ["experimentId", "newStartDate"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const id = typeof args.experimentId === "number" ? args.experimentId : "?";
    const newStart = String(args.newStartDate ?? "");
    const newEnd = args.newEndDate ? String(args.newEndDate) : null;
    const rangeDesc = newEnd && newEnd !== newStart
      ? `${newStart} to ${newEnd}`
      : newStart;
    return {
      summary: `reschedule experiment ${id} to start ${rangeDesc}`,
    };
  },
  execute: async (args) => {
    const id =
      typeof args.experimentId === "number" ? args.experimentId : NaN;
    if (!Number.isFinite(id)) {
      return {
        ok: false as const,
        error:
          "experimentId must be a number. Call search_my_work to find the experiment id.",
      };
    }

    const newStart = String(args.newStartDate ?? "").trim();
    if (!newStart) {
      return { ok: false as const, error: "newStartDate is required (YYYY-MM-DD)." };
    }

    // Load the existing experiment so we can preserve duration and show the
    // old dates in the describeAction preview (called before execute).
    const existing = await experimentToolsDeps.getTask(id);
    if (!existing) {
      return {
        ok: false as const,
        error: `Experiment ${id} was not found. Check the id with search_my_work.`,
      };
    }
    if (existing.task_type !== "experiment") {
      return {
        ok: false as const,
        error: `Task ${id} is a ${existing.task_type}, not an experiment.`,
      };
    }

    // Determine new duration: use provided newEndDate if given, else preserve original.
    const newEnd = args.newEndDate ? String(args.newEndDate).trim() : null;
    const newDuration = newEnd
      ? daysBetween(newStart, newEnd)
      : existing.duration_days;

    let updated: Task | null;
    try {
      updated = await experimentToolsDeps.updateTask(id, {
        start_date: newStart,
        duration_days: newDuration,
      });
    } catch (err) {
      return {
        ok: false as const,
        error: `Could not update the experiment. ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!updated) {
      return {
        ok: false as const,
        error: `Experiment ${id} disappeared during the update.`,
      };
    }

    // Navigate to the Gantt so the user sees the rescheduled bar in its new
    // position, highlighted. Only fires after a successful update.
    experimentToolsDeps.navigate(`/gantt?highlightTasks=self:${updated.id}`);

    return {
      ok: true as const,
      id: updated.id,
      name: updated.name,
      oldStartDate: existing.start_date,
      oldEndDate: existing.end_date,
      newStartDate: updated.start_date,
      newEndDate: updated.end_date,
      durationDays: updated.duration_days,
    };
  },
};

// ---------------------------------------------------------------------------
// create_experiment_chain
// ---------------------------------------------------------------------------

export type ChainResult =
  | {
      ok: true;
      experiments: Array<{
        id: number;
        name: string;
        startDate: string;
        endDate: string;
      }>;
      dependenciesCreated: number;
      note?: string;
    }
  | { ok: false; error: string };

export const createExperimentChainTool: AiTool = {
  name: "create_experiment_chain",
  description:
    "Create a series of experiments scheduled back-to-back, linked as finish-to-start dependencies on the Gantt. Use this when the user asks to set up a workflow or sequence of experiments, for example \"create a cloning workflow: transformation, then miniprep, then sequencing\" or \"schedule three sequential experiments starting Monday\". Each experiment in the chain is linked to the next with a finish-to-start dependency so the Gantt shows the chain relationship. The app shows the user the FULL proposed schedule, with every experiment and its dates, as a preview BEFORE anything is written. Each experiment can also carry a methodTemplateSlug to attach a protocol from the template library, the tool reuses the user's existing method made from that template or instantiates a fresh one and attaches it. After it writes, confirm the chain in one short sentence. Do NOT also call propose_plan, this preview IS the consent.",
  parameters: {
    type: "object",
    properties: {
      experiments: {
        type: "array",
        description:
          "The experiments in the chain, in order. Each item is an object with a name (required), an optional durationDays (defaults to 1), and optional methodIds.",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The experiment name.",
            },
            durationDays: {
              type: "number",
              description:
                "How many calendar days this experiment takes. Defaults to 1.",
            },
            methodIds: {
              type: "array",
              items: { type: "number" },
              description:
                "Optional numeric method ids to attach to this experiment.",
            },
            methodTemplateSlug: {
              type: "string",
              description:
                "Optional catalog template slug to attach as the experiment's protocol (for example \"pcr-colony-screen\"). The tool reuses the user's existing method made from this template if one exists, otherwise it instantiates the template as a new private method and attaches it. Use a real slug from the template library; an unknown slug fails the chain. Use this when the user names a protocol that matches a template rather than an existing method id.",
            },
          },
          required: ["name"],
          additionalProperties: false,
        },
      },
      startDate: {
        type: "string",
        description:
          "When the FIRST experiment in the chain starts, as a YYYY-MM-DD ISO string.",
      },
      projectId: {
        type: "number",
        description:
          "Optional project id to assign every experiment in the chain to.",
      },
      gapDays: {
        type: "number",
        description:
          "Calendar days to leave between consecutive experiments. Defaults to 0 (back-to-back).",
      },
    },
    required: ["experiments", "startDate"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    // Build a full readable preview so the user can review the entire proposed
    // schedule before anything is written. This IS the consent, like write_note.
    const rawExperiments = Array.isArray(args.experiments)
      ? (args.experiments as Array<Record<string, unknown>>)
      : [];
    const startDate = String(args.startDate ?? "");
    const gapDays =
      typeof args.gapDays === "number" ? Math.max(0, args.gapDays) : 0;
    const projectId =
      typeof args.projectId === "number" ? args.projectId : null;

    const specs: ChainExperimentSpec[] = rawExperiments.map((e) => ({
      name: String(e.name ?? "Unnamed"),
      durationDays:
        typeof e.durationDays === "number" ? e.durationDays : undefined,
      methodIds: Array.isArray(e.methodIds)
        ? (e.methodIds as unknown[]).filter((x): x is number => typeof x === "number")
        : undefined,
      methodTemplateSlug:
        typeof e.methodTemplateSlug === "string" && e.methodTemplateSlug.trim()
          ? e.methodTemplateSlug.trim()
          : undefined,
    }));

    const scheduled = computeChainDates(specs, startDate, gapDays);

    const lines = scheduled.map((s, i) => {
      const templateNote = s.methodTemplateSlug
        ? ` (+ method template "${s.methodTemplateSlug}")`
        : "";
      return `${i + 1}. "${s.name}" — ${s.startDate} to ${s.endDate} (${s.durationDays} day${s.durationDays === 1 ? "" : "s"})${templateNote}`;
    });

    const projectNote = projectId ? ` (project ${projectId})` : "";
    const gapNote = gapDays > 0 ? ` with ${gapDays}-day gap between steps` : "";
    const chainCount = scheduled.length;
    const summaryLine = `create a chain of ${chainCount} experiment${chainCount === 1 ? "" : "s"}${projectNote}${gapNote}`;

    return {
      summary: [summaryLine, ...lines].join("\n"),
    };
  },
  execute: async (args) => {
    const rawExperiments = Array.isArray(args.experiments)
      ? (args.experiments as Array<Record<string, unknown>>)
      : [];

    if (rawExperiments.length === 0) {
      return {
        ok: false as const,
        error: "No experiments were specified. Pass at least one in the experiments array.",
      } satisfies ChainResult;
    }

    const startDate = String(args.startDate ?? "").trim();
    if (!startDate) {
      return { ok: false as const, error: "startDate is required (YYYY-MM-DD)." } satisfies ChainResult;
    }

    const gapDays =
      typeof args.gapDays === "number" ? Math.max(0, args.gapDays) : 0;
    const projectId =
      typeof args.projectId === "number" ? args.projectId : null;

    const specs: ChainExperimentSpec[] = rawExperiments.map((e) => ({
      name: String(e.name ?? "Unnamed"),
      durationDays:
        typeof e.durationDays === "number" ? Math.max(1, e.durationDays) : 1,
      methodIds: Array.isArray(e.methodIds)
        ? (e.methodIds as unknown[]).filter((x): x is number => typeof x === "number")
        : [],
      methodTemplateSlug:
        typeof e.methodTemplateSlug === "string" && e.methodTemplateSlug.trim()
          ? e.methodTemplateSlug.trim()
          : undefined,
    }));

    const scheduled = computeChainDates(specs, startDate, gapDays);

    // Create experiments sequentially, tracking ids in order.
    const created: Array<{ id: number; name: string; startDate: string; endDate: string }> = [];
    for (let i = 0; i < scheduled.length; i++) {
      const s = scheduled[i];

      // Resolve an attached method template (reuse-or-instantiate) BEFORE the
      // experiment write, then merge its id into this step's method_ids. A bad
      // slug fails the chain here, before any task is created for this step.
      let methodIds = s.methodIds;
      if (s.methodTemplateSlug) {
        const resolved = await resolveMethodIdForTemplate(
          s.methodTemplateSlug,
          experimentToolsDeps,
        );
        if (!resolved.ok) {
          const partialNote =
            created.length > 0
              ? ` ${created.length} experiment${created.length === 1 ? " was" : "s were"} created before this.`
              : "";
          return {
            ok: false as const,
            error: `${resolved.error}${partialNote}`,
          } satisfies ChainResult;
        }
        methodIds = methodIds.includes(resolved.id)
          ? methodIds
          : [...methodIds, resolved.id];
      }

      let task: Task;
      try {
        task = await experimentToolsDeps.createTask({
          name: s.name,
          start_date: s.startDate,
          duration_days: s.durationDays,
          task_type: "experiment",
          project_id: projectId,
          method_ids: methodIds,
        });
      } catch (err) {
        // Some experiments already created at this point. Report partial failure.
        const partialNote =
          created.length > 0
            ? ` ${created.length} experiment${created.length === 1 ? " was" : "s were"} created before the failure.`
            : "";
        return {
          ok: false as const,
          error: `Failed creating experiment ${i + 1} ("${s.name}").${partialNote} ${err instanceof Error ? err.message : String(err)}`,
        } satisfies ChainResult;
      }
      created.push({
        id: task.id,
        name: task.name,
        startDate: task.start_date,
        endDate: task.end_date,
      });
    }

    // Wire finish-to-start dependencies between consecutive experiments.
    // Best-effort: if a dep write fails, the experiments themselves stand.
    let depsCreated = 0;
    let depFailNote: string | undefined;
    if (created.length > 1) {
      for (let i = 0; i < created.length - 1; i++) {
        try {
          await experimentToolsDeps.createDependency(created[i].id, created[i + 1].id);
          depsCreated++;
        } catch {
          depFailNote =
            "The experiments were created but some Gantt dependency links could not be saved.";
          break;
        }
      }
    }

    // Navigate to the Gantt so the user sees the full chain highlighted.
    // All created experiment ids as self:<id>, in chain order.
    // Only fires after ALL experiments are successfully created.
    const highlightParam = created.map((e) => `self:${e.id}`).join(",");
    experimentToolsDeps.navigate(`/gantt?highlightTasks=${highlightParam}`);

    return {
      ok: true as const,
      experiments: created,
      dependenciesCreated: depsCreated,
      ...(depFailNote ? { note: depFailNote } : {}),
    } satisfies ChainResult;
  },
};
