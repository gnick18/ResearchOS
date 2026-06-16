// BeakerBot setup_project composite tool (BeakerAI lane, 2026-06-15).
//
// The project-level analog of setup_experiment. A single gated write that does
// everything the user would otherwise click through to stand up a whole project
// from scratch, with every experiment auto-assigned to the project it just made.
//
//   setup_project(name, experiments?, startDate?, gapDays?, chain?, tags?)
//
// In one atomic, consented call it:
//   1. Creates the Project (name + optional tags).
//   2. Creates each named experiment as a Task (task_type "experiment"),
//      scheduled back-to-back from startDate (gapDays between them), with the
//      NEW project's id set on every one. This back-reference (children pointing
//      at a parent that did not exist before the call) is the thing the model
//      cannot reliably do by chaining separate create_* calls, because it cannot
//      thread a just-created id into the next argument list.
//   3. Optionally links consecutive experiments with a finish-to-start
//      Dependency edge (chain = true), so the Gantt shows them flowing into one
//      another, exactly like create_experiment_chain.
//   4. Scaffolds each experiment's results.md using the same path and template as
//      the TaskModal (taskResultsBase / createNewFileContent), so every Results
//      tab opens with a real "# Results: <name>" header.
//   5. On completion, navigates to /gantt?highlightTasks=<all new taskKeys> so the
//      user immediately sees everything they just created, highlighted (or to the
//      project itself when no experiments were requested).
//
// The user consents ONCE. describeAction produces a numbered preview of every
// step before anything writes, matching the "one preview per composite action"
// principle used by setup_experiment and create_experiment_chain.
//
// computeProjectSetupPlan is a pure function (no I/O) that produces the full set
// of objects and links to create from the arguments, so it is unit-testable
// independently. It reuses computeChainDates from experiment-tools for scheduling
// so the back-to-back placement is identical to create_experiment_chain.
//
// Injectable seam so every export is unit-testable without a real folder.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { tasksApi, dependenciesApi, filesApi, projectsApi } from "@/lib/local-api";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import { objectDeepLink } from "@/lib/references";
import { taskResultsBase } from "@/lib/tasks/results-paths";
import { createNewFileContent } from "@/lib/stamp-utils";
import {
  computeChainDates,
  formatIso,
  type ChainExperimentSpec,
  type ScheduledChainItem,
} from "./experiment-tools";
import { parseTags } from "./method-tools";
import type { Task, Project, ProjectCreate } from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable seam
// ---------------------------------------------------------------------------

export type SetupProjectDeps = {
  /** Create the project. Returns the saved Project. */
  createProject: (data: ProjectCreate) => Promise<Project>;
  /** Create an experiment task inside the new project. Returns the saved Task. */
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
  /** Navigate the user to an internal path after a successful write. */
  navigate: (path: string) => void;
};

export const setupProjectDeps: SetupProjectDeps = {
  createProject: (data) => projectsApi.create(data),
  createTask: (data) => tasksApi.create(data),
  createDependency: (parentId, childId) =>
    dependenciesApi
      .create({ parent_id: parentId, child_id: childId, dep_type: "FS" })
      .then(() => undefined),
  writeFile: (path, content) => filesApi.writeFile(path, content).then(() => undefined),
  navigate: requestNavigation,
};

// ---------------------------------------------------------------------------
// Pure compute core (exported for tests)
// ---------------------------------------------------------------------------

/** The fully-resolved plan for what setup_project will create. Pure, no I/O. */
export interface ProjectSetupPlan {
  /** The project to create. */
  project: {
    name: string;
    tags: string[];
  };
  /** Experiments to create inside the project, scheduled back-to-back. */
  experiments: ScheduledChainItem[];
  /** Finish-to-start links between experiments, by index into `experiments`.
   *  Empty unless `chain` was requested. fromIndex is the earlier (parent)
   *  experiment, toIndex the later (child), so the Gantt arrow flows forward. */
  chainLinks: Array<{ fromIndex: number; toIndex: number }>;
}

const DEFAULT_DURATION_DAYS = 1;

/** Today as YYYY-MM-DD in UTC, used when no startDate is supplied. */
function todayIso(): string {
  return formatIso(new Date());
}

/**
 * Compute the full project setup plan from raw arguments. Pure function, no I/O.
 *
 * Experiments are scheduled back-to-back from startDate via computeChainDates
 * (the same scheduler create_experiment_chain uses), so placement is identical.
 * When `chain` is true, every consecutive pair gets a finish-to-start link.
 */
export function computeProjectSetupPlan(
  name: string,
  tags: string[],
  startDate: string,
  gapDays: number,
  experimentSpecs: ChainExperimentSpec[],
  chain: boolean,
): ProjectSetupPlan {
  const experiments = computeChainDates(experimentSpecs, startDate, gapDays);

  const chainLinks: ProjectSetupPlan["chainLinks"] = [];
  if (chain) {
    for (let i = 0; i + 1 < experiments.length; i++) {
      chainLinks.push({ fromIndex: i, toIndex: i + 1 });
    }
  }

  return {
    project: { name, tags },
    experiments,
    chainLinks,
  };
}

// ---------------------------------------------------------------------------
// Argument parsing (shared by describeAction + execute, pure)
// ---------------------------------------------------------------------------

interface ParsedSetupProjectArgs {
  name: string;
  tags: string[];
  startDate: string;
  gapDays: number;
  chain: boolean;
  experimentSpecs: ChainExperimentSpec[];
}

/** Normalize the raw model args into the typed shape the plan needs. Pure. */
function parseArgs(args: Record<string, unknown>): ParsedSetupProjectArgs {
  const name = String(args.name ?? "").trim();
  const tags = parseTags(args.tags);
  const startDate = String(args.startDate ?? todayIso()).trim();
  const gapDays =
    typeof args.gapDays === "number" && args.gapDays >= 0
      ? Math.round(args.gapDays)
      : 0;
  const chain = args.chain === true;

  const rawExperiments = Array.isArray(args.experiments) ? args.experiments : [];
  const experimentSpecs: ChainExperimentSpec[] = [];
  for (const raw of rawExperiments) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const expName = String(e.name ?? "").trim();
    if (!expName) continue;
    const durationDays =
      typeof e.durationDays === "number" && e.durationDays >= 1
        ? Math.round(e.durationDays)
        : DEFAULT_DURATION_DAYS;
    const methodIds: number[] = Array.isArray(e.methodIds)
      ? (e.methodIds as unknown[]).filter((x): x is number => typeof x === "number")
      : [];
    experimentSpecs.push({ name: expName, durationDays, methodIds });
  }

  return { name, tags, startDate, gapDays, chain, experimentSpecs };
}

// ---------------------------------------------------------------------------
// setup_project result type
// ---------------------------------------------------------------------------

export type SetupProjectResult =
  | {
      ok: true;
      projectId: number;
      projectName: string;
      experimentIds: number[];
      dependenciesCreated: number;
      resultsScaffolded: number;
      highlightKeys: string[];
      note?: string;
    }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// setup_project tool
// ---------------------------------------------------------------------------

/** The live mutable deps reference. Tests override individual fields here. */
const activeSetupProjectDeps: SetupProjectDeps = {
  ...setupProjectDeps,
};

/**
 * Override the deps for testing. Returns a cleanup function that restores the
 * original deps. Same pattern as overrideSetupExperimentDeps.
 */
export function overrideSetupProjectDeps(
  overrides: Partial<SetupProjectDeps>,
): () => void {
  const original = { ...activeSetupProjectDeps };
  Object.assign(activeSetupProjectDeps, overrides);
  return () => {
    Object.assign(activeSetupProjectDeps, original);
  };
}

export const setupProjectTool: AiTool = {
  name: "setup_project",
  description:
    "Set up a complete project in one step. Use this when the user asks to start, set up, or spin up a whole project that has several experiments in it, for example \"set up a cyp51A resistance project with a PCR, a miniprep, and a sequencing experiment\". In a single consented action it creates the project, then creates each experiment ALREADY ASSIGNED to that new project (scheduled back-to-back from the start date), optionally links the experiments as a finish-to-start chain on the Gantt, and scaffolds each experiment's results file. Prefer this over calling create_project and then several create_experiment calls, because this assigns every experiment to the brand new project for you in one step. After it writes, confirm the setup in one short sentence.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "The project name, for example \"cyp51A resistance\" or \"Protein expression screen\".",
      },
      experiments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "The experiment name, for example \"PCR amplification\".",
            },
            durationDays: {
              type: "number",
              description: "How many calendar days the experiment takes. Defaults to 1.",
            },
            methodIds: {
              type: "array",
              items: { type: "number" },
              description:
                "Numeric method ids to attach to this experiment. Optional. Get real ids from search_my_work if the user named a method.",
            },
          },
          required: ["name"],
          additionalProperties: false,
        },
        description:
          "The experiments to create inside the new project, in the order they should run. Each is scheduled back-to-back from startDate. Optional, omit to create just the empty project.",
      },
      startDate: {
        type: "string",
        description:
          "When the first experiment starts, as a YYYY-MM-DD ISO string. Map relative dates to real dates before calling. Defaults to today when omitted.",
      },
      gapDays: {
        type: "number",
        description:
          "Days to leave between consecutive experiments. Defaults to 0 (truly back-to-back).",
      },
      chain: {
        type: "boolean",
        description:
          "When true, link each experiment to the next with a finish-to-start dependency, so the Gantt shows them flowing into one another. Defaults to false (the experiments are placed back-to-back but not linked).",
      },
      tags: {
        type: "string",
        description:
          "Comma-separated tags for the project, for example \"fumigatus, resistance\". Optional.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const { name, tags, startDate, gapDays, chain, experimentSpecs } = parseArgs(args);
    const safeName = name || "Untitled project";
    const plan = computeProjectSetupPlan(
      safeName,
      tags,
      startDate,
      gapDays,
      experimentSpecs,
      chain,
    );

    const lines: string[] = [];
    const tagNote = plan.project.tags.length
      ? ` (tags ${plan.project.tags.join(", ")})`
      : "";
    lines.push(`1. Create project "${safeName}"${tagNote}`);

    plan.experiments.forEach((exp, i) => {
      const dateRange =
        exp.endDate === exp.startDate
          ? exp.startDate
          : `${exp.startDate} to ${exp.endDate}`;
      const methodNote = exp.methodIds.length
        ? `, ${exp.methodIds.length} method${exp.methodIds.length === 1 ? "" : "s"}`
        : "";
      lines.push(
        `${i + 2}. Create experiment "${exp.name}" on ${dateRange} in the new project${methodNote}`,
      );
    });

    let next = plan.experiments.length + 2;
    if (plan.chainLinks.length > 0) {
      lines.push(
        `${next}. Link the experiments as a finish-to-start chain on the Gantt`,
      );
      next++;
    }
    if (plan.experiments.length > 0) {
      lines.push(
        `${next}. Scaffold results files for the ${plan.experiments.length} experiment${plan.experiments.length === 1 ? "" : "s"}`,
      );
    }

    const summary = [`set up project "${safeName}"`, ...lines].join("\n");
    return { summary };
  },
  execute: async (args): Promise<SetupProjectResult> => {
    const deps = activeSetupProjectDeps;
    const { name, tags, startDate, gapDays, chain, experimentSpecs } = parseArgs(args);

    if (!name) {
      return { ok: false, error: "Project name is required." };
    }

    const plan = computeProjectSetupPlan(
      name,
      tags,
      startDate,
      gapDays,
      experimentSpecs,
      chain,
    );

    // Step 1: create the project.
    let project: Project;
    try {
      project = await deps.createProject({
        name: plan.project.name,
        ...(plan.project.tags.length ? { tags: plan.project.tags } : {}),
      });
    } catch (err) {
      return {
        ok: false,
        error: `Could not create the project. ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Step 2: create each experiment, assigned to the new project.
    const createdTasks: Task[] = [];
    let expFailNote: string | undefined;
    for (let i = 0; i < plan.experiments.length; i++) {
      const exp = plan.experiments[i];
      try {
        const task = await deps.createTask({
          name: exp.name,
          start_date: exp.startDate,
          duration_days: exp.durationDays,
          task_type: "experiment",
          project_id: project.id,
          method_ids: exp.methodIds,
        });
        createdTasks.push(task);
      } catch (err) {
        expFailNote = `Experiment "${exp.name}" could not be created (${err instanceof Error ? err.message : String(err)}). The project and ${createdTasks.length} earlier experiment${createdTasks.length === 1 ? " was" : "s were"} created.`;
        break;
      }
    }

    // Step 3: link consecutive experiments as FS dependencies (chain only).
    // Only link pairs where BOTH experiments were actually created (a mid-list
    // failure above could have stopped short of the full plan).
    let depsCreated = 0;
    let depFailNote: string | undefined;
    if (chain) {
      for (const link of plan.chainLinks) {
        const parent = createdTasks[link.fromIndex];
        const child = createdTasks[link.toIndex];
        if (!parent || !child) continue;
        try {
          await deps.createDependency(parent.id, child.id);
          depsCreated++;
        } catch {
          depFailNote =
            "Some experiments could not be linked into the chain on the Gantt.";
          break;
        }
      }
    }

    // Step 4: scaffold results.md per created experiment (non-fatal).
    let resultsScaffolded = 0;
    for (const task of createdTasks) {
      try {
        const resultsPath = `${taskResultsBase(task)}/results.md`;
        const content = createNewFileContent(task.name, project.name, "results");
        await deps.writeFile(resultsPath, content);
        resultsScaffolded++;
      } catch {
        // Non-fatal, the Results tab regenerates on first open.
      }
    }

    // Step 5: navigate so the user sees what they just created.
    const highlightKeys = createdTasks.map((t) => `self:${t.id}`);
    if (highlightKeys.length > 0) {
      deps.navigate(`/gantt?highlightTasks=${highlightKeys.join(",")}`);
    } else {
      deps.navigate(objectDeepLink("project", project.id));
    }

    const notes: string[] = [];
    if (expFailNote) notes.push(expFailNote);
    if (depFailNote) notes.push(depFailNote);

    return {
      ok: true,
      projectId: project.id,
      projectName: project.name,
      experimentIds: createdTasks.map((t) => t.id),
      dependenciesCreated: depsCreated,
      resultsScaffolded,
      highlightKeys,
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    };
  },
};
