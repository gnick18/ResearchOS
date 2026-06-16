// Unit tests for the BeakerBot setup_project composite tool
// (BeakerAI lane, 2026-06-15).
//
// Strategy: inject stub deps, call execute() with representative arg sets, and
// assert the composite created the project, created each experiment ALREADY
// assigned to that new project (the back-reference), optionally chained them via
// createDependency, scaffolded each results file, and returned the correct
// highlight keys. No real FSA. The pure compute core (computeProjectSetupPlan)
// is also tested independently.

import { describe, it, expect, vi } from "vitest";

import {
  setupProjectTool,
  computeProjectSetupPlan,
  overrideSetupProjectDeps,
  type SetupProjectResult,
  type SetupProjectDeps,
} from "./setup-project";
import type { ChainExperimentSpec } from "./experiment-tools";
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

function makeProject(id: number, name: string, tags: string[] = []): Project {
  return {
    id,
    name,
    owner: "testuser",
    description: "",
    tags,
    shared_with: [],
    created_at: "",
    updated_at: "",
    tasks: [],
    sort_order: 0,
    is_complete: false,
    source_uuid: null,
  } as unknown as Project;
}

function makeStubDeps(overrides: Partial<SetupProjectDeps> = {}): SetupProjectDeps {
  let nextProjectId = 50;
  let nextTaskId = 100;
  return {
    createProject: vi.fn().mockImplementation(async (data) => {
      const id = nextProjectId++;
      return makeProject(id, data.name, data.tags ?? []);
    }),
    createTask: vi.fn().mockImplementation(async (data) => {
      const id = nextTaskId++;
      return makeTask(id, data.name, {
        start_date: data.start_date,
        duration_days: data.duration_days,
        method_ids: data.method_ids ?? [],
        project_id: data.project_id ?? 0,
      });
    }),
    createDependency: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn(),
    ...overrides,
  };
}

async function run(
  args: Record<string, unknown>,
  deps: SetupProjectDeps,
): Promise<SetupProjectResult> {
  const restore = overrideSetupProjectDeps(deps);
  try {
    return (await setupProjectTool.execute(args)) as SetupProjectResult;
  } finally {
    restore();
  }
}

const EXP = (name: string, durationDays?: number, methodIds?: number[]): ChainExperimentSpec => ({
  name,
  ...(durationDays !== undefined ? { durationDays } : {}),
  ...(methodIds !== undefined ? { methodIds } : {}),
});

// ---------------------------------------------------------------------------
// computeProjectSetupPlan (pure)
// ---------------------------------------------------------------------------

describe("computeProjectSetupPlan", () => {
  it("returns the project name and tags verbatim", () => {
    const plan = computeProjectSetupPlan("cyp51A", ["fungus", "resistance"], "2026-07-01", 0, [], false);
    expect(plan.project.name).toBe("cyp51A");
    expect(plan.project.tags).toEqual(["fungus", "resistance"]);
    expect(plan.experiments).toHaveLength(0);
    expect(plan.chainLinks).toHaveLength(0);
  });

  it("schedules experiments back-to-back from the start date", () => {
    const plan = computeProjectSetupPlan(
      "P",
      [],
      "2026-07-01",
      0,
      [EXP("PCR", 2), EXP("Miniprep", 1), EXP("Sequencing", 3)],
      false,
    );
    expect(plan.experiments).toHaveLength(3);
    expect(plan.experiments[0]).toMatchObject({ name: "PCR", startDate: "2026-07-01", durationDays: 2 });
    // Next starts when the previous ends (start + duration).
    expect(plan.experiments[1].startDate).toBe("2026-07-03");
    expect(plan.experiments[2].startDate).toBe("2026-07-04");
  });

  it("honours gapDays between experiments", () => {
    const plan = computeProjectSetupPlan("P", [], "2026-07-01", 2, [EXP("A", 1), EXP("B", 1)], false);
    // A: 07-01 (1d, ends 07-02). B starts ends+gap = 07-02 + 2 = 07-04.
    expect(plan.experiments[1].startDate).toBe("2026-07-04");
  });

  it("emits no chain links when chain is false", () => {
    const plan = computeProjectSetupPlan("P", [], "2026-07-01", 0, [EXP("A"), EXP("B"), EXP("C")], false);
    expect(plan.chainLinks).toHaveLength(0);
  });

  it("links every consecutive pair when chain is true", () => {
    const plan = computeProjectSetupPlan("P", [], "2026-07-01", 0, [EXP("A"), EXP("B"), EXP("C")], true);
    expect(plan.chainLinks).toEqual([
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
    ]);
  });

  it("emits no chain links for a single experiment even when chain is true", () => {
    const plan = computeProjectSetupPlan("P", [], "2026-07-01", 0, [EXP("only")], true);
    expect(plan.chainLinks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// setup_project execute: project creation
// ---------------------------------------------------------------------------

describe("setup_project: project creation", () => {
  it("creates the project with name and parsed tags", async () => {
    const deps = makeStubDeps();
    const result = await run({ name: "cyp51A resistance", tags: "fungus, resistance" }, deps);
    expect(result.ok).toBe(true);
    expect(deps.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "cyp51A resistance", tags: ["fungus", "resistance"] }),
    );
    if (result.ok) {
      expect(result.projectId).toBeGreaterThan(0);
      expect(result.projectName).toBe("cyp51A resistance");
    }
  });

  it("omits tags from the create payload when none are given", async () => {
    const deps = makeStubDeps();
    await run({ name: "Bare project" }, deps);
    const payload = (deps.createProject as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).not.toHaveProperty("tags");
  });

  it("creates just the project when no experiments are given", async () => {
    const deps = makeStubDeps();
    const result = await run({ name: "Empty project" }, deps);
    expect(result.ok).toBe(true);
    expect(deps.createProject).toHaveBeenCalledTimes(1);
    expect(deps.createTask).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.experimentIds).toHaveLength(0);
    }
  });

  it("returns ok:false when name is empty", async () => {
    const deps = makeStubDeps();
    const result = await run({ name: "   " }, deps);
    expect(result.ok).toBe(false);
    expect(deps.createProject).not.toHaveBeenCalled();
  });

  it("returns ok:false when the project create throws", async () => {
    const deps = makeStubDeps({
      createProject: vi.fn().mockRejectedValue(new Error("disk full")),
    });
    const result = await run({ name: "P", experiments: [{ name: "PCR" }] }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("disk full");
    }
    // No experiment should be attempted once the project failed.
    expect(deps.createTask).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setup_project execute: the back-reference (the whole point)
// ---------------------------------------------------------------------------

describe("setup_project: experiments assigned to the new project", () => {
  it("assigns the NEW project's id to every experiment", async () => {
    const deps = makeStubDeps();
    const result = await run(
      {
        name: "Screen",
        startDate: "2026-07-10",
        experiments: [{ name: "PCR" }, { name: "Miniprep" }],
      },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const newProjectId = result.projectId;
    const calls = (deps.createTask as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    for (const [data] of calls) {
      expect(data.project_id).toBe(newProjectId);
      expect(data.task_type).toBe("experiment");
    }
  });

  it("returns one experiment id per requested experiment", async () => {
    const deps = makeStubDeps();
    const result = await run(
      { name: "Screen", experiments: [{ name: "A" }, { name: "B" }, { name: "C" }] },
      deps,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.experimentIds).toHaveLength(3);
    }
  });

  it("attaches per-experiment methodIds", async () => {
    const deps = makeStubDeps();
    await run(
      { name: "Screen", experiments: [{ name: "qPCR", methodIds: [10, 11] }] },
      deps,
    );
    expect(deps.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ method_ids: [10, 11] }),
    );
  });

  it("reports a partial result when an experiment create fails mid-list", async () => {
    let n = 0;
    const deps = makeStubDeps({
      createTask: vi.fn().mockImplementation(async (data) => {
        n++;
        if (n === 2) throw new Error("quota exceeded");
        return makeTask(200 + n, data.name, { project_id: data.project_id ?? 0 });
      }),
    });
    const result = await run(
      { name: "Screen", experiments: [{ name: "A" }, { name: "B" }, { name: "C" }] },
      deps,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Only the first experiment was created before B failed.
      expect(result.experimentIds).toHaveLength(1);
      expect(result.note).toContain("B");
    }
  });
});

// ---------------------------------------------------------------------------
// setup_project execute: chain linking
// ---------------------------------------------------------------------------

describe("setup_project: chain linking", () => {
  it("does not link experiments when chain is omitted", async () => {
    const deps = makeStubDeps();
    const result = await run(
      { name: "Screen", experiments: [{ name: "A" }, { name: "B" }] },
      deps,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dependenciesCreated).toBe(0);
    }
    expect(deps.createDependency).not.toHaveBeenCalled();
  });

  it("links consecutive experiments earlier->later when chain is true", async () => {
    const deps = makeStubDeps();
    const result = await run(
      { name: "Screen", chain: true, experiments: [{ name: "A" }, { name: "B" }, { name: "C" }] },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dependenciesCreated).toBe(2);
    const ids = result.experimentIds;
    const calls = (deps.createDependency as ReturnType<typeof vi.fn>).mock.calls;
    // parent is the earlier experiment, child the later one.
    expect(calls[0]).toEqual([ids[0], ids[1]]);
    expect(calls[1]).toEqual([ids[1], ids[2]]);
  });

  it("still returns ok:true and notes when a dependency write fails", async () => {
    const deps = makeStubDeps({
      createDependency: vi.fn().mockRejectedValue(new Error("network error")),
    });
    const result = await run(
      { name: "Screen", chain: true, experiments: [{ name: "A" }, { name: "B" }] },
      deps,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dependenciesCreated).toBe(0);
      expect(result.note).toContain("chain");
    }
  });
});

// ---------------------------------------------------------------------------
// setup_project execute: results scaffold
// ---------------------------------------------------------------------------

describe("setup_project: results scaffold", () => {
  it("writes a results.md scaffold per experiment at the canonical path", async () => {
    const deps = makeStubDeps();
    const result = await run(
      { name: "My Lab", experiments: [{ name: "PCR" }, { name: "Miniprep" }] },
      deps,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resultsScaffolded).toBe(2);
    }
    expect(deps.writeFile).toHaveBeenCalledTimes(2);
    const [path, content] = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toMatch(/users\/.+\/results\/task-\d+\/results\.md/);
    expect(content).toContain("# Results: PCR");
    // The new project's name flows into the stamp.
    expect(content).toContain("project folder: My Lab");
  });

  it("still returns ok:true when a results write fails (non-fatal)", async () => {
    const deps = makeStubDeps({
      writeFile: vi.fn().mockRejectedValue(new Error("permission denied")),
    });
    const result = await run(
      { name: "P", experiments: [{ name: "PCR" }] },
      deps,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resultsScaffolded).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// setup_project execute: navigation and highlight keys
// ---------------------------------------------------------------------------

describe("setup_project: navigation and highlight keys", () => {
  it("navigates to the Gantt with every new experiment highlighted", async () => {
    const deps = makeStubDeps();
    const result = await run(
      { name: "Screen", experiments: [{ name: "A" }, { name: "B" }] },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.highlightKeys).toHaveLength(2);
    for (const key of result.highlightKeys) {
      expect(key).toMatch(/^self:\d+$/);
    }
    expect(deps.navigate).toHaveBeenCalledTimes(1);
    const url = (deps.navigate as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/gantt?highlightTasks=");
    for (const id of result.experimentIds) {
      expect(url).toContain(`self:${id}`);
    }
  });

  it("navigates to the project itself when there are no experiments", async () => {
    const deps = makeStubDeps();
    const result = await run({ name: "Empty" }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.highlightKeys).toHaveLength(0);
    }
    expect(deps.navigate).toHaveBeenCalledTimes(1);
    const url = (deps.navigate as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).not.toContain("/gantt?highlightTasks=");
    expect(typeof url).toBe("string");
    expect(url.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// setup_project: describeAction preview
// ---------------------------------------------------------------------------

describe("setup_project: describeAction", () => {
  it("previews the project, each experiment, the chain, and the results step", () => {
    const preview = setupProjectTool.describeAction?.({
      name: "cyp51A resistance",
      tags: "fungus",
      startDate: "2026-07-10",
      chain: true,
      experiments: [{ name: "PCR" }, { name: "Miniprep" }],
    });
    expect(preview).toBeDefined();
    const s = preview?.summary ?? "";
    expect(s).toContain("cyp51A resistance");
    expect(s).toContain("PCR");
    expect(s).toContain("Miniprep");
    expect(s).toContain("finish-to-start chain");
    expect(s).toContain("results files");
    expect(s).toContain("in the new project");
  });

  it("omits the chain and results lines when only the project is created", () => {
    const preview = setupProjectTool.describeAction?.({ name: "Empty" });
    const s = preview?.summary ?? "";
    expect(s).toContain("Empty");
    expect(s).not.toContain("finish-to-start chain");
    expect(s).not.toContain("results files");
  });
});
