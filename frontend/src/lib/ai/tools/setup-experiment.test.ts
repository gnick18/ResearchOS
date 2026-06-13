// Unit tests for the BeakerBot setup_experiment composite tool
// (ai setup-experiment bot, 2026-06-13).
//
// Strategy: inject stub deps, call execute() with representative arg sets, and
// assert the composite created the experiment, attached methods, created N prep
// tasks, linked each prep task to the experiment via createDependency, scaffolded
// the results file, and returned the correct highlight keys. No real FSA. The
// pure compute core (computeSetupPlan) is also tested independently.

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  setupExperimentTool,
  computeSetupPlan,
  overrideSetupExperimentDeps,
  type SetupExperimentResult,
} from "./setup-experiment";
import type { SetupExperimentDeps } from "./setup-experiment";
import type { Task, Project } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(id: number, name: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    name,
    project_id: 0,
    start_date: "2026-07-01",
    end_date: "2026-07-02",
    duration_days: 1,
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    weekend_override: null,
    method_ids: [],
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    owner: "testuser",
    shared_with: [],
    ...overrides,
  };
}

function makeProject(id: number, name: string): Project {
  return {
    id,
    name,
    owner: "testuser",
    description: "",
    tags: [],
    shared_with: [],
    created_at: "",
    updated_at: "",
    tasks: [],
    sort_order: 0,
    is_complete: false,
    source_uuid: null,
  } as unknown as Project;
}

function makeStubDeps(overrides: Partial<SetupExperimentDeps> = {}): SetupExperimentDeps {
  let nextId = 100;
  return {
    createTask: vi.fn().mockImplementation(async (data) => {
      const id = nextId++;
      return makeTask(id, data.name, {
        start_date: data.start_date,
        duration_days: data.duration_days,
        method_ids: data.method_ids ?? [],
        project_id: data.project_id ?? 0,
      });
    }),
    createDependency: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    getProject: vi.fn().mockResolvedValue(null),
    navigate: vi.fn(),
    ...overrides,
  };
}

async function run(
  args: Record<string, unknown>,
  deps: SetupExperimentDeps,
): Promise<SetupExperimentResult> {
  const restore = overrideSetupExperimentDeps(deps);
  try {
    return (await setupExperimentTool.execute(args)) as SetupExperimentResult;
  } finally {
    restore();
  }
}

// ---------------------------------------------------------------------------
// computeSetupPlan (pure)
// ---------------------------------------------------------------------------

describe("computeSetupPlan", () => {
  it("returns the experiment spec verbatim", () => {
    const plan = computeSetupPlan("PCR", "2026-07-01", 3, [1, 2], 5, []);
    expect(plan.experiment.name).toBe("PCR");
    expect(plan.experiment.startDate).toBe("2026-07-01");
    expect(plan.experiment.durationDays).toBe(3);
    expect(plan.experiment.methodIds).toEqual([1, 2]);
    expect(plan.experiment.projectId).toBe(5);
  });

  it("returns empty prepTasks when no names are given", () => {
    const plan = computeSetupPlan("PCR", "2026-07-01", 1, [], null, []);
    expect(plan.prepTasks).toHaveLength(0);
  });

  it("schedules one prep task ending on the experiment start date", () => {
    const plan = computeSetupPlan("PCR", "2026-07-01", 1, [], null, ["Order primers"]);
    expect(plan.prepTasks).toHaveLength(1);
    // Prep task starts 1 day before experiment start (pack right-to-left).
    expect(plan.prepTasks[0].startDate).toBe("2026-06-30");
    expect(plan.prepTasks[0].durationDays).toBe(1);
    expect(plan.prepTasks[0].name).toBe("Order primers");
  });

  it("schedules N prep tasks back-to-back before the experiment", () => {
    const plan = computeSetupPlan(
      "Western blot",
      "2026-07-05",
      2,
      [],
      null,
      ["Order antibodies", "Block membranes", "Run gel"],
    );
    expect(plan.prepTasks).toHaveLength(3);
    // Earliest prep starts 3 days before experiment start.
    expect(plan.prepTasks[0].startDate).toBe("2026-07-02");
    expect(plan.prepTasks[1].startDate).toBe("2026-07-03");
    expect(plan.prepTasks[2].startDate).toBe("2026-07-04");
  });
});

// ---------------------------------------------------------------------------
// setup_experiment execute
// ---------------------------------------------------------------------------

describe("setup_experiment: experiment creation", () => {
  it("creates the experiment with the correct fields", async () => {
    const deps = makeStubDeps();
    const result = await run(
      {
        name: "Western blot",
        startDate: "2026-07-10",
        durationDays: 2,
        methodIds: [7, 8],
        projectId: 3,
      },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(deps.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Western blot",
        start_date: "2026-07-10",
        duration_days: 2,
        task_type: "experiment",
        method_ids: [7, 8],
        project_id: 3,
      }),
    );
  });

  it("returns the experiment id and name in the result", async () => {
    const deps = makeStubDeps();
    const result = await run({ name: "Miniprep", startDate: "2026-07-01" }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.experimentId).toBeGreaterThan(0);
      expect(result.experimentName).toBe("Miniprep");
    }
  });

  it("defaults to durationDays 1 when omitted", async () => {
    const deps = makeStubDeps();
    await run({ name: "Colony screen", startDate: "2026-07-01" }, deps);
    expect(deps.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ duration_days: 1 }),
    );
  });

  it("defaults methodIds to [] when omitted", async () => {
    const deps = makeStubDeps();
    await run({ name: "Colony screen", startDate: "2026-07-01" }, deps);
    expect(deps.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ method_ids: [] }),
    );
  });

  it("returns ok:false when the experiment create throws", async () => {
    const deps = makeStubDeps({
      createTask: vi.fn().mockRejectedValue(new Error("disk full")),
    });
    const result = await run({ name: "PCR", startDate: "2026-07-01" }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("disk full");
    }
  });

  it("returns ok:false when name is empty", async () => {
    const deps = makeStubDeps();
    const result = await run({ name: "", startDate: "2026-07-01" }, deps);
    expect(result.ok).toBe(false);
  });
});

describe("setup_experiment: method attachment", () => {
  it("attaches methodIds to the experiment", async () => {
    const deps = makeStubDeps();
    const result = await run(
      { name: "qPCR", startDate: "2026-07-01", methodIds: [10, 11, 12] },
      deps,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.methodCount).toBe(3);
    }
    expect(deps.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ method_ids: [10, 11, 12] }),
    );
  });
});

describe("setup_experiment: prep tasks", () => {
  it("creates N prep tasks for N prepTaskNames", async () => {
    const deps = makeStubDeps();
    const result = await run(
      {
        name: "Western blot",
        startDate: "2026-07-10",
        prepTaskNames: ["Order antibodies", "Block membranes"],
      },
      deps,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prepTaskIds).toHaveLength(2);
    }
    // createTask called once for experiment + once per prep task = 3 total.
    expect(deps.createTask).toHaveBeenCalledTimes(3);
  });

  it("creates zero prep tasks when prepTaskNames is omitted", async () => {
    const deps = makeStubDeps();
    const result = await run({ name: "PCR", startDate: "2026-07-01" }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prepTaskIds).toHaveLength(0);
    }
    expect(deps.createTask).toHaveBeenCalledTimes(1);
  });

  it("passes the project id to each prep task", async () => {
    const deps = makeStubDeps();
    await run(
      {
        name: "PCR",
        startDate: "2026-07-01",
        projectId: 9,
        prepTaskNames: ["Order reagents"],
      },
      deps,
    );
    const calls = (deps.createTask as ReturnType<typeof vi.fn>).mock.calls;
    // Second call is the prep task.
    expect(calls[1][0]).toMatchObject({ project_id: 9 });
  });
});

describe("setup_experiment: dependency links", () => {
  it("links each prep task to the experiment with a FS dependency", async () => {
    const deps = makeStubDeps();
    const result = await run(
      {
        name: "Western blot",
        startDate: "2026-07-10",
        prepTaskNames: ["Order antibodies", "Block membranes"],
      },
      deps,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dependenciesCreated).toBe(2);
    }
    // Each prep task linked to the experiment: (prepId, experimentId).
    expect(deps.createDependency).toHaveBeenCalledTimes(2);
    if (result.ok) {
      for (const prepId of result.prepTaskIds) {
        expect(deps.createDependency).toHaveBeenCalledWith(prepId, result.experimentId);
      }
    }
  });

  it("still returns ok:true when a dependency write fails (best-effort)", async () => {
    const deps = makeStubDeps({
      createDependency: vi.fn().mockRejectedValue(new Error("network error")),
    });
    const result = await run(
      {
        name: "PCR",
        startDate: "2026-07-01",
        prepTaskNames: ["Order primers"],
      },
      deps,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dependenciesCreated).toBe(0);
      expect(result.note).toContain("linked");
    }
  });
});

describe("setup_experiment: results scaffold", () => {
  it("writes a results.md scaffold at the canonical path", async () => {
    const deps = makeStubDeps();
    const result = await run({ name: "Miniprep", startDate: "2026-07-01" }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resultsScaffolded).toBe(true);
    }
    expect(deps.writeFile).toHaveBeenCalledTimes(1);
    const [path, content] = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toContain("results.md");
    // The canonical path includes the task owner and id.
    expect(path).toMatch(/users\/.+\/results\/task-\d+\/results\.md/);
    // The scaffold contains the "# Results:" header.
    expect(content).toContain("# Results: Miniprep");
  });

  it("includes the project name in the stamp when a project id resolves", async () => {
    const deps = makeStubDeps({
      getProject: vi.fn().mockResolvedValue(makeProject(5, "My Lab")),
    });
    await run({ name: "PCR", startDate: "2026-07-01", projectId: 5 }, deps);
    const [_path, content] = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toContain("project folder: My Lab");
  });

  it("still returns ok:true when the results write fails (non-fatal)", async () => {
    const deps = makeStubDeps({
      writeFile: vi.fn().mockRejectedValue(new Error("permission denied")),
    });
    const result = await run({ name: "PCR", startDate: "2026-07-01" }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resultsScaffolded).toBe(false);
    }
  });
});

describe("setup_experiment: navigation and highlight keys", () => {
  it("navigates to the Gantt with all new task keys highlighted", async () => {
    const deps = makeStubDeps();
    const result = await run(
      {
        name: "Western blot",
        startDate: "2026-07-10",
        prepTaskNames: ["Order antibodies"],
      },
      deps,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.highlightKeys).toHaveLength(2);
      for (const key of result.highlightKeys) {
        expect(key).toMatch(/^self:\d+$/);
      }
    }
    expect(deps.navigate).toHaveBeenCalledTimes(1);
    const url = (deps.navigate as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/gantt?highlightTasks=");
    // The experiment id is first in the highlight list.
    if (result.ok) {
      expect(url).toContain(`self:${result.experimentId}`);
      for (const prepId of result.prepTaskIds) {
        expect(url).toContain(`self:${prepId}`);
      }
    }
  });

  it("highlight keys include only the experiment when there are no prep tasks", async () => {
    const deps = makeStubDeps();
    const result = await run({ name: "PCR", startDate: "2026-07-01" }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.highlightKeys).toHaveLength(1);
      expect(result.highlightKeys[0]).toBe(`self:${result.experimentId}`);
    }
  });
});

describe("setup_experiment: describeAction", () => {
  it("produces a summary that mentions the experiment name and each prep task", () => {
    const preview = setupExperimentTool.describeAction?.({
      name: "Western blot",
      startDate: "2026-07-10",
      durationDays: 2,
      prepTaskNames: ["Order antibodies", "Block membranes"],
    });
    expect(preview).toBeDefined();
    expect(preview?.summary).toContain("Western blot");
    expect(preview?.summary).toContain("Order antibodies");
    expect(preview?.summary).toContain("Block membranes");
    expect(preview?.summary).toContain("finish-to-start");
    expect(preview?.summary).toContain("results file");
  });
});
