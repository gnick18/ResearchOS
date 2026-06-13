// BeakerBot setup_experiment composite tool (ai setup-experiment bot, 2026-06-13).
//
// A single gated write that does everything the user would otherwise click through
// to set up an experiment from scratch.
//
//   setup_experiment(name, methodIds?, prepTaskNames?, projectId?, startDate?, durationDays?)
//
// In one atomic, consented call it:
//   1. Creates the experiment Task (task_type "experiment", canonical start_date +
//      duration_days + method_ids + project_id).
//   2. Creates each named prep task as a Task (task_type "experiment") scheduled
//      to finish on the experiment's start date (back-to-back upstream prep).
//   3. Links each prep task to the experiment with a finish-to-start Dependency
//      edge so the Gantt shows the prep arrow flowing into the experiment.
//   4. Scaffolds the results.md file for the experiment using the same path and
//      template as the TaskModal (taskResultsBase / createNewFileContent), so the
//      Results tab opens with a real "# Results: <name>" header.
//   5. On completion, navigates to /gantt?highlightTasks=<all new taskKeys> so the
//      user immediately sees everything they just created, highlighted.
//
// The user consents ONCE. describeAction produces a numbered preview of every
// step before anything writes, matching the "one preview per composite action"
// principle used by create_experiment_chain.
//
// computeSetupPlan is a pure function (no I/O) that produces the full set of tasks
// and links to create from the arguments, so it is unit-testable independently.
//
// Key field names (confirmed from types.ts and local-api.ts):
//   Task.start_date     -- YYYY-MM-DD ISO string
//   Task.duration_days  -- canonical length (end_date is a derived cache)
//   Task.task_type      -- "experiment" | "purchase" | "list"
//   Task.project_id     -- 0 = no project
//   Task.method_ids     -- number[]
//   Task.owner          -- owner username (for taskResultsBase path)
//
// Injectable seam so every export is unit-testable without a real folder.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { tasksApi, dependenciesApi, filesApi, projectsApi } from "@/lib/local-api";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import { taskResultsBase } from "@/lib/tasks/results-paths";
import { createNewFileContent } from "@/lib/stamp-utils";
import { addDays, formatIso } from "./experiment-tools";
import type { Task, Project } from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable seam
// ---------------------------------------------------------------------------

export type SetupExperimentDeps = {
  /** Create a task (experiment or prep). Returns the saved Task. */
  createTask: (data: {
    name: string;
    start_date: string;
    duration_days: number;
    task_type: "experiment";
    project_id?: number | null;
    method_ids?: number[];
  }) => Promise<Task>;
  /** Create a finish-to-start dependency edge. */
  createDependency: (parentId: number, childId: number) => Promise<void>;
  /** Write a file at path with content. Non-fatal failure is acceptable. */
  writeFile: (path: string, content: string) => Promise<void>;
  /** Fetch a project by id (to resolve the project name for the stamp). */
  getProject: (id: number) => Promise<Project | null>;
  /** Navigate the user to an internal path after a successful write. */
  navigate: (path: string) => void;
};

export const setupExperimentDeps: SetupExperimentDeps = {
  createTask: (data) => tasksApi.create(data),
  createDependency: (parentId, childId) =>
    dependenciesApi
      .create({ parent_id: parentId, child_id: childId, dep_type: "FS" })
      .then(() => undefined),
  writeFile: (path, content) => filesApi.writeFile(path, content).then(() => undefined),
  getProject: (id) => projectsApi.get(id),
  navigate: requestNavigation,
};

// ---------------------------------------------------------------------------
// Pure compute core (exported for tests)
// ---------------------------------------------------------------------------

/** The fully-resolved plan for what setup_experiment will create. Pure, no I/O. */
export interface SetupPlan {
  /** The main experiment to create. */
  experiment: {
    name: string;
    startDate: string;
    durationDays: number;
    methodIds: number[];
    projectId: number | null;
  };
  /** Prep tasks to create, each finishing no later than the experiment's start.
   *  Each has durationDays 1 and is scheduled immediately before the experiment
   *  (they pack right-to-left against the experiment start, back-to-back). */
  prepTasks: Array<{
    name: string;
    startDate: string;
    durationDays: number;
  }>;
}

const DEFAULT_DURATION_DAYS = 1;

/**
 * Compute the full setup plan from raw arguments. Pure function, no I/O.
 *
 * Prep tasks are scheduled back-to-back from the most-distant to the nearest,
 * so the prep chain finishes on the experiment's start date. Each prep task
 * has durationDays 1. With N prep tasks the earliest starts (N) days before
 * the experiment (minimum; a 1-day experiment start date plus N prep days).
 */
export function computeSetupPlan(
  name: string,
  startDate: string,
  durationDays: number,
  methodIds: number[],
  projectId: number | null,
  prepTaskNames: string[],
): SetupPlan {
  // Pack prep tasks right-to-left against the experiment start.
  // prepTasks[0] is the earliest (furthest out), prepTasks[N-1] ends on experiment start.
  const prepTasks: SetupPlan["prepTasks"] = [];
  const count = prepTaskNames.length;
  for (let i = 0; i < count; i++) {
    // Offset from experiment start (in days before), earliest first.
    const daysOffset = count - i;
    const prepStart = addDays(startDate, -daysOffset);
    prepTasks.push({
      name: prepTaskNames[i],
      startDate: prepStart,
      durationDays: DEFAULT_DURATION_DAYS,
    });
  }
  return {
    experiment: { name, startDate, durationDays, methodIds, projectId },
    prepTasks,
  };
}

// ---------------------------------------------------------------------------
// setup_experiment result type
// ---------------------------------------------------------------------------

export type SetupExperimentResult =
  | {
      ok: true;
      experimentId: number;
      experimentName: string;
      startDate: string;
      endDate: string;
      durationDays: number;
      methodCount: number;
      prepTaskIds: number[];
      dependenciesCreated: number;
      resultsScaffolded: boolean;
      highlightKeys: string[];
      note?: string;
    }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// setup_experiment tool
// ---------------------------------------------------------------------------

/** Today as YYYY-MM-DD in UTC, used when no startDate is supplied. */
function todayIso(): string {
  return formatIso(new Date());
}

/**
 * Override the deps for testing. Tests call this to inject stubs before
 * invoking setupExperimentTool.execute. In production the module-level
 * setupExperimentDeps is used directly (the same pattern as experiment-tools.ts).
 *
 * Returns a cleanup function that restores the original deps.
 */
export function overrideSetupExperimentDeps(
  overrides: Partial<SetupExperimentDeps>,
): () => void {
  const original = { ...activeSetupDeps };
  Object.assign(activeSetupDeps, overrides);
  return () => {
    Object.assign(activeSetupDeps, original);
  };
}

/** The live mutable deps reference. Tests override individual fields here. */
const activeSetupDeps: SetupExperimentDeps = {
  ...setupExperimentDeps,
};

export const setupExperimentTool: AiTool = {
  name: "setup_experiment",
  description:
    "Set up a complete experiment in one step. Use this when the user asks to set up, prepare, or configure an experiment rather than just creating a bare scheduled slot. In a single consented action it creates the experiment, attaches the given methods, creates named prep tasks linked as finish-to-start dependencies on the Gantt (so the prep arrow flows into the experiment), and scaffolds the results file so the Results tab opens with a real header. After it writes, confirm the setup in one short sentence. Do NOT call create_experiment and then multiple create_task calls when the user is setting up a whole experiment workflow, use this tool instead.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "The experiment name, for example \"Western blot\" or \"qPCR protein expression\".",
      },
      methodIds: {
        type: "array",
        items: { type: "number" },
        description:
          "Numeric method ids to attach to the experiment. Optional. Get real ids from search_my_work if the user named a method.",
      },
      prepTaskNames: {
        type: "array",
        items: { type: "string" },
        description:
          "Names of prep tasks to create and link as upstream dependencies, in order from earliest to latest. For example [\"Order antibodies\", \"Block membranes\"]. Optional. Each prep task is scheduled back-to-back before the experiment and linked with a finish-to-start Gantt arrow.",
      },
      projectId: {
        type: "number",
        description:
          "The numeric project id to attach the experiment to. Optional. Omit to leave it unassigned.",
      },
      startDate: {
        type: "string",
        description:
          "When the experiment starts, as a YYYY-MM-DD ISO string. Map relative dates to real dates before calling. Defaults to today when omitted.",
      },
      durationDays: {
        type: "number",
        description:
          "How many calendar days the experiment takes. Defaults to 1.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const name = String(args.name ?? "Untitled experiment");
    const startDate = String(args.startDate ?? todayIso());
    const durationDays =
      typeof args.durationDays === "number" && args.durationDays >= 1
        ? Math.round(args.durationDays)
        : DEFAULT_DURATION_DAYS;
    const methodIds: number[] = Array.isArray(args.methodIds)
      ? (args.methodIds as unknown[]).filter((x): x is number => typeof x === "number")
      : [];
    const prepTaskNames: string[] = Array.isArray(args.prepTaskNames)
      ? (args.prepTaskNames as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
      : [];
    const projectId =
      typeof args.projectId === "number" ? args.projectId : null;

    const plan = computeSetupPlan(
      name,
      startDate,
      durationDays,
      methodIds,
      projectId,
      prepTaskNames,
    );

    const lines: string[] = [];
    const projectNote = projectId ? ` in project ${projectId}` : "";
    const endDate = addDays(startDate, durationDays);
    lines.push(
      `1. Create experiment "${name}" from ${startDate} to ${endDate} (${durationDays} day${durationDays === 1 ? "" : "s"})${projectNote}`,
    );
    if (methodIds.length > 0) {
      lines.push(`2. Attach ${methodIds.length} method${methodIds.length === 1 ? "" : "s"} (id${methodIds.length === 1 ? "" : "s"} ${methodIds.join(", ")})`);
    }
    const methodOffset = methodIds.length > 0 ? 1 : 0;
    plan.prepTasks.forEach((pt, i) => {
      lines.push(
        `${i + 2 + methodOffset}. Create prep task "${pt.name}" on ${pt.startDate} and link it as a finish-to-start dependency`,
      );
    });
    const depLine = plan.prepTasks.length > 0 ? lines.length : lines.length + 1;
    lines.push(`${depLine}. Scaffold results file for the Results tab`);

    const summary = [`set up experiment "${name}"`, ...lines].join("\n");
    return { summary };
  },
  execute: async (args): Promise<SetupExperimentResult> => {
    const deps = activeSetupDeps;

    const name = String(args.name ?? "").trim();
    if (!name) {
      return { ok: false, error: "Experiment name is required." };
    }
    const startDate = String(args.startDate ?? todayIso()).trim();
    const durationDays =
      typeof args.durationDays === "number" && args.durationDays >= 1
        ? Math.round(args.durationDays)
        : DEFAULT_DURATION_DAYS;
    const methodIds: number[] = Array.isArray(args.methodIds)
      ? (args.methodIds as unknown[]).filter((x): x is number => typeof x === "number")
      : [];
    const prepTaskNames: string[] = Array.isArray(args.prepTaskNames)
      ? (args.prepTaskNames as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
      : [];
    const projectId =
      typeof args.projectId === "number" ? args.projectId : null;

    const plan = computeSetupPlan(
      name,
      startDate,
      durationDays,
      methodIds,
      projectId,
      prepTaskNames,
    );

    // Step 1: create the experiment.
    let experiment: Task;
    try {
      experiment = await deps.createTask({
        name: plan.experiment.name,
        start_date: plan.experiment.startDate,
        duration_days: plan.experiment.durationDays,
        task_type: "experiment",
        project_id: plan.experiment.projectId,
        method_ids: plan.experiment.methodIds,
      });
    } catch (err) {
      return {
        ok: false,
        error: `Could not create the experiment. ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Step 2: create prep tasks.
    const createdPrepIds: number[] = [];
    let prepFailNote: string | undefined;
    for (let i = 0; i < plan.prepTasks.length; i++) {
      const pt = plan.prepTasks[i];
      try {
        const prepTask = await deps.createTask({
          name: pt.name,
          start_date: pt.startDate,
          duration_days: pt.durationDays,
          task_type: "experiment",
          project_id: plan.experiment.projectId,
        });
        createdPrepIds.push(prepTask.id);
      } catch (err) {
        prepFailNote = `Prep task "${pt.name}" could not be created (${err instanceof Error ? err.message : String(err)}). The experiment and ${createdPrepIds.length} earlier prep task${createdPrepIds.length === 1 ? " was" : "s were"} created.`;
        break;
      }
    }

    // Step 3: link each prep task to the experiment as FS dependency.
    let depsCreated = 0;
    let depFailNote: string | undefined;
    for (const prepId of createdPrepIds) {
      try {
        await deps.createDependency(prepId, experiment.id);
        depsCreated++;
      } catch {
        depFailNote =
          "Some prep tasks could not be linked to the experiment on the Gantt.";
        break;
      }
    }

    // Step 4: scaffold results.md (non-fatal).
    let resultsScaffolded = false;
    try {
      // Resolve the project name for the stamp, fall back to "(no project)" on
      // any failure so the scaffold always proceeds.
      let projectName = "(no project)";
      if (plan.experiment.projectId) {
        try {
          const proj = await deps.getProject(plan.experiment.projectId);
          if (proj) projectName = proj.name;
        } catch {
          // Non-fatal, continue with default.
        }
      }
      const resultsPath = `${taskResultsBase(experiment)}/results.md`;
      const content = createNewFileContent(name, projectName, "results");
      await deps.writeFile(resultsPath, content);
      resultsScaffolded = true;
    } catch {
      // Non-fatal, the Results tab regenerates on first open.
    }

    // Step 5: navigate to Gantt with all new task ids highlighted.
    const allIds = [experiment.id, ...createdPrepIds];
    const highlightKeys = allIds.map((id) => `self:${id}`);
    deps.navigate(`/gantt?highlightTasks=${highlightKeys.join(",")}`);

    const notes: string[] = [];
    if (prepFailNote) notes.push(prepFailNote);
    if (depFailNote) notes.push(depFailNote);

    return {
      ok: true,
      experimentId: experiment.id,
      experimentName: experiment.name,
      startDate: experiment.start_date,
      endDate: experiment.end_date,
      durationDays: experiment.duration_days,
      methodCount: experiment.method_ids.length,
      prepTaskIds: createdPrepIds,
      dependenciesCreated: depsCreated,
      resultsScaffolded,
      highlightKeys,
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    };
  },
};
