// experiment-tools tests (ai experiment-tools bot, 2026-06-11;
// ai gantt-highlight bot, 2026-06-11).
//
// Tests cover:
//   - computeChainDates: pure scheduling math (back-to-back dates, gap days,
//     duration defaults, single experiment, empty list).
//   - parseIso / addDays / daysBetween: the date primitives the chain math depends on.
//   - create_experiment: describeAction preview, execute success + error paths,
//     navigate seam called with /gantt?highlightTasks=self:<id>.
//   - reschedule_experiment: describeAction preview, duration-preserve, explicit
//     new end date, not-found path, navigate seam called on success.
//   - create_experiment_chain: describeAction shows full schedule, execute creates
//     experiments + dep edges in order, dep-failure fallback, empty-list error,
//     navigate seam called with all chain ids on success.
//
// All tests stub experimentToolsDeps (the injectable seam), so no real folder or
// local-api is involved.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeChainDates,
  parseIso,
  formatIso,
  addDays,
  daysBetween,
  experimentToolsDeps,
  createExperimentTool,
  rescheduleExperimentTool,
  createExperimentChainTool,
  resolveMethodIdForTemplate,
  templateProvenanceTag,
  type ChainExperimentSpec,
} from "../tools/experiment-tools";
import type { Task, Method } from "@/lib/types";
import type { MethodCatalogTemplate } from "@/lib/methods/method-catalog";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    project_id: 0,
    name: "Test experiment",
    start_date: "2026-07-01",
    duration_days: 1,
    end_date: "2026-07-02",
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
    ...over,
  };
}

function makeMethod(over: Partial<Method> = {}): Method {
  return {
    id: 100,
    name: "Colony PCR screen",
    source_path: null,
    method_type: "markdown",
    folder_path: null,
    parent_method_id: null,
    tags: null,
    is_public: false,
    created_by: "testuser",
    owner: "testuser",
    shared_with: [],
    ...over,
  } as Method;
}

function makeTemplate(over: Partial<MethodCatalogTemplate> = {}): MethodCatalogTemplate {
  return {
    slug: "pcr-colony-screen",
    title: "Colony PCR screen",
    description: "Screen colonies by PCR",
    category: "PCR",
    method_type: "markdown",
    tags: ["pcr"],
    payload: { body: "Run colony PCR." },
    ...over,
  } as MethodCatalogTemplate;
}

// ---------------------------------------------------------------------------
// Date primitives
// ---------------------------------------------------------------------------

describe("parseIso", () => {
  it("parses a valid YYYY-MM-DD string to UTC midnight", () => {
    const d = parseIso("2026-07-01");
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(6);
    expect(d.getUTCDate()).toBe(1);
  });

  it("throws on invalid input", () => {
    expect(() => parseIso("07-01-2026")).toThrow();
    expect(() => parseIso("not-a-date")).toThrow();
  });
});

describe("addDays", () => {
  it("advances a date by the given days", () => {
    expect(addDays("2026-07-01", 1)).toBe("2026-07-02");
    expect(addDays("2026-07-01", 7)).toBe("2026-07-08");
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
  });

  it("handles zero gap (same day)", () => {
    expect(addDays("2026-07-01", 0)).toBe("2026-07-01");
  });
});

describe("daysBetween", () => {
  it("returns 1 for same-day start and end", () => {
    // daysBetween("2026-07-01", "2026-07-01") is 0ms => clamps to 1
    expect(daysBetween("2026-07-01", "2026-07-01")).toBe(1);
  });

  it("returns the correct day count for multi-day spans", () => {
    expect(daysBetween("2026-07-01", "2026-07-03")).toBe(2);
    expect(daysBetween("2026-07-01", "2026-07-08")).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// computeChainDates
// ---------------------------------------------------------------------------

describe("computeChainDates", () => {
  it("returns an empty array for an empty experiments list", () => {
    expect(computeChainDates([], "2026-07-01")).toEqual([]);
  });

  it("schedules a single experiment starting on startDate with default duration 1", () => {
    const result = computeChainDates([{ name: "PCR" }], "2026-07-01");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "PCR",
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      durationDays: 1,
    });
  });

  it("schedules back-to-back experiments with gapDays 0 (default)", () => {
    const specs: ChainExperimentSpec[] = [
      { name: "Transformation", durationDays: 1 },
      { name: "Miniprep", durationDays: 2 },
      { name: "Sequencing", durationDays: 1 },
    ];
    const result = computeChainDates(specs, "2026-07-01");
    expect(result).toHaveLength(3);
    // Transformation: July 1 -> July 2
    expect(result[0]).toMatchObject({ startDate: "2026-07-01", endDate: "2026-07-02", durationDays: 1 });
    // Miniprep starts when Transformation ends: July 2 -> July 4
    expect(result[1]).toMatchObject({ startDate: "2026-07-02", endDate: "2026-07-04", durationDays: 2 });
    // Sequencing starts when Miniprep ends: July 4 -> July 5
    expect(result[2]).toMatchObject({ startDate: "2026-07-04", endDate: "2026-07-05", durationDays: 1 });
  });

  it("respects gapDays between experiments", () => {
    const specs: ChainExperimentSpec[] = [
      { name: "Step 1", durationDays: 1 },
      { name: "Step 2", durationDays: 1 },
    ];
    const result = computeChainDates(specs, "2026-07-01", 2);
    // Step 1: July 1 -> July 2
    expect(result[0]).toMatchObject({ startDate: "2026-07-01", endDate: "2026-07-02" });
    // Step 2 starts 2 days after Step 1 ends: July 4 -> July 5
    expect(result[1]).toMatchObject({ startDate: "2026-07-04", endDate: "2026-07-05" });
  });

  it("defaults durationDays to 1 when not provided or zero", () => {
    const result = computeChainDates([{ name: "Unnamed" }], "2026-07-01");
    expect(result[0].durationDays).toBe(1);
  });

  it("passes methodIds through to the scheduled item", () => {
    const result = computeChainDates(
      [{ name: "PCR", durationDays: 1, methodIds: [5, 7] }],
      "2026-07-01",
    );
    expect(result[0].methodIds).toEqual([5, 7]);
  });

  it("defaults methodIds to an empty array when not provided", () => {
    const result = computeChainDates([{ name: "PCR" }], "2026-07-01");
    expect(result[0].methodIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// create_experiment
// ---------------------------------------------------------------------------

describe("create_experiment tool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("describeAction produces a readable summary", () => {
    const result = createExperimentTool.describeAction!({
      name: "Gibson Assembly",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
    });
    expect(result.summary).toContain("Gibson Assembly");
    expect(result.summary).toContain("2026-07-01");
    expect(result.summary).toContain("2026-07-03");
  });

  it("describeAction uses startDate as endDate when endDate is absent (one-day)", () => {
    const result = createExperimentTool.describeAction!({
      name: "PCR",
      startDate: "2026-07-01",
    });
    // Both start and end show as the same date, so no "to" range
    expect(result.summary).toContain("2026-07-01");
    expect(result.summary).not.toContain("to");
  });

  it("execute creates an experiment and returns the task data", async () => {
    const task = makeTask({ id: 42, name: "Gibson Assembly", start_date: "2026-07-01", end_date: "2026-07-03", duration_days: 2 });
    vi.spyOn(experimentToolsDeps, "createTask").mockResolvedValue(task);
    vi.spyOn(experimentToolsDeps, "navigate").mockImplementation(() => {});

    const result = await createExperimentTool.execute({
      name: "Gibson Assembly",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
    }) as { ok: boolean; id: number; name: string };

    expect(result.ok).toBe(true);
    expect(result.id).toBe(42);
    expect(result.name).toBe("Gibson Assembly");
  });

  it("execute navigates to /gantt?highlightTasks=self:<id> after a successful write", async () => {
    const task = makeTask({ id: 42, name: "Gibson Assembly", start_date: "2026-07-01", end_date: "2026-07-03", duration_days: 2 });
    vi.spyOn(experimentToolsDeps, "createTask").mockResolvedValue(task);
    const navSpy = vi.spyOn(experimentToolsDeps, "navigate").mockImplementation(() => {});

    await createExperimentTool.execute({ name: "Gibson Assembly", startDate: "2026-07-01" });

    expect(navSpy).toHaveBeenCalledTimes(1);
    expect(navSpy).toHaveBeenCalledWith("/gantt?highlightTasks=self:42");
  });

  it("execute does NOT navigate when the write fails", async () => {
    vi.spyOn(experimentToolsDeps, "createTask").mockRejectedValue(new Error("no folder"));
    const navSpy = vi.spyOn(experimentToolsDeps, "navigate").mockImplementation(() => {});

    await createExperimentTool.execute({ name: "PCR", startDate: "2026-07-01" });

    expect(navSpy).not.toHaveBeenCalled();
  });

  it("execute returns an error when name is empty", async () => {
    const result = await createExperimentTool.execute({ name: "", startDate: "2026-07-01" }) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("name");
  });

  it("execute returns an error when startDate is missing", async () => {
    const result = await createExperimentTool.execute({ name: "PCR" }) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("startDate");
  });

  it("execute relays an error from the api", async () => {
    vi.spyOn(experimentToolsDeps, "createTask").mockRejectedValue(new Error("no folder"));
    const result = await createExperimentTool.execute({
      name: "PCR",
      startDate: "2026-07-01",
    }) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no folder");
  });

  it("isDestructive returns false", () => {
    expect(createExperimentTool.isDestructive!({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reschedule_experiment
// ---------------------------------------------------------------------------

describe("reschedule_experiment tool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("describeAction produces a readable summary", () => {
    const result = rescheduleExperimentTool.describeAction!({
      experimentId: 7,
      newStartDate: "2026-07-10",
    });
    expect(result.summary).toContain("7");
    expect(result.summary).toContain("2026-07-10");
  });

  it("execute preserves duration when newEndDate is omitted", async () => {
    const existing = makeTask({
      id: 7,
      start_date: "2026-07-01",
      end_date: "2026-07-04",
      duration_days: 3,
      task_type: "experiment",
    });
    const updated = makeTask({
      id: 7,
      start_date: "2026-07-10",
      end_date: "2026-07-13",
      duration_days: 3,
      task_type: "experiment",
    });
    vi.spyOn(experimentToolsDeps, "getTask").mockResolvedValue(existing);
    const updateSpy = vi.spyOn(experimentToolsDeps, "updateTask").mockResolvedValue(updated);
    vi.spyOn(experimentToolsDeps, "navigate").mockImplementation(() => {});

    await rescheduleExperimentTool.execute({ experimentId: 7, newStartDate: "2026-07-10" });

    // duration_days should be the existing 3, not recomputed
    expect(updateSpy).toHaveBeenCalledWith(7, { start_date: "2026-07-10", duration_days: 3 });
  });

  it("execute navigates to /gantt?highlightTasks=self:<id> after a successful reschedule", async () => {
    const existing = makeTask({ id: 7, start_date: "2026-07-01", end_date: "2026-07-02", duration_days: 1, task_type: "experiment" });
    const updated = makeTask({ id: 7, start_date: "2026-07-10", end_date: "2026-07-11", duration_days: 1, task_type: "experiment" });
    vi.spyOn(experimentToolsDeps, "getTask").mockResolvedValue(existing);
    vi.spyOn(experimentToolsDeps, "updateTask").mockResolvedValue(updated);
    const navSpy = vi.spyOn(experimentToolsDeps, "navigate").mockImplementation(() => {});

    await rescheduleExperimentTool.execute({ experimentId: 7, newStartDate: "2026-07-10" });

    expect(navSpy).toHaveBeenCalledTimes(1);
    expect(navSpy).toHaveBeenCalledWith("/gantt?highlightTasks=self:7");
  });

  it("execute does NOT navigate when the experiment is not found", async () => {
    vi.spyOn(experimentToolsDeps, "getTask").mockResolvedValue(null);
    const navSpy = vi.spyOn(experimentToolsDeps, "navigate").mockImplementation(() => {});

    await rescheduleExperimentTool.execute({ experimentId: 99, newStartDate: "2026-07-10" });

    expect(navSpy).not.toHaveBeenCalled();
  });

  it("execute uses explicit newEndDate to set a new duration", async () => {
    const existing = makeTask({
      id: 7,
      start_date: "2026-07-01",
      end_date: "2026-07-02",
      duration_days: 1,
      task_type: "experiment",
    });
    const updated = makeTask({
      id: 7,
      start_date: "2026-07-10",
      end_date: "2026-07-15",
      duration_days: 5,
      task_type: "experiment",
    });
    vi.spyOn(experimentToolsDeps, "getTask").mockResolvedValue(existing);
    const updateSpy = vi.spyOn(experimentToolsDeps, "updateTask").mockResolvedValue(updated);
    vi.spyOn(experimentToolsDeps, "navigate").mockImplementation(() => {});

    await rescheduleExperimentTool.execute({
      experimentId: 7,
      newStartDate: "2026-07-10",
      newEndDate: "2026-07-15",
    });

    expect(updateSpy).toHaveBeenCalledWith(7, { start_date: "2026-07-10", duration_days: 5 });
  });

  it("execute returns an error when the task is not found", async () => {
    vi.spyOn(experimentToolsDeps, "getTask").mockResolvedValue(null);
    const result = await rescheduleExperimentTool.execute({
      experimentId: 99,
      newStartDate: "2026-07-10",
    }) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("99");
  });

  it("execute returns an error when the task is not an experiment", async () => {
    const purchase = makeTask({ id: 5, task_type: "purchase" });
    vi.spyOn(experimentToolsDeps, "getTask").mockResolvedValue(purchase);
    const result = await rescheduleExperimentTool.execute({
      experimentId: 5,
      newStartDate: "2026-07-10",
    }) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("purchase");
  });

  it("execute returns an error when experimentId is not a number", async () => {
    const result = await rescheduleExperimentTool.execute({
      experimentId: "not-a-number",
      newStartDate: "2026-07-10",
    }) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("experimentId");
  });
});

// ---------------------------------------------------------------------------
// create_experiment_chain
// ---------------------------------------------------------------------------

describe("create_experiment_chain tool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("describeAction shows the full proposed schedule", () => {
    const result = createExperimentChainTool.describeAction!({
      experiments: [
        { name: "Transformation", durationDays: 1 },
        { name: "Miniprep", durationDays: 2 },
        { name: "Sequencing", durationDays: 1 },
      ],
      startDate: "2026-07-01",
    });
    expect(result.summary).toContain("Transformation");
    expect(result.summary).toContain("Miniprep");
    expect(result.summary).toContain("Sequencing");
    expect(result.summary).toContain("2026-07-01");
    // Each experiment should have its own line
    expect(result.summary.split("\n").length).toBeGreaterThanOrEqual(4);
  });

  it("execute creates all experiments and dependency edges in order", async () => {
    const tasks = [
      makeTask({ id: 10, name: "Transformation", start_date: "2026-07-01", end_date: "2026-07-02", duration_days: 1 }),
      makeTask({ id: 11, name: "Miniprep", start_date: "2026-07-02", end_date: "2026-07-04", duration_days: 2 }),
      makeTask({ id: 12, name: "Sequencing", start_date: "2026-07-04", end_date: "2026-07-05", duration_days: 1 }),
    ];
    const createSpy = vi.spyOn(experimentToolsDeps, "createTask")
      .mockResolvedValueOnce(tasks[0])
      .mockResolvedValueOnce(tasks[1])
      .mockResolvedValueOnce(tasks[2]);
    const depSpy = vi.spyOn(experimentToolsDeps, "createDependency").mockResolvedValue(undefined);
    vi.spyOn(experimentToolsDeps, "navigate").mockImplementation(() => {});

    const result = await createExperimentChainTool.execute({
      experiments: [
        { name: "Transformation", durationDays: 1 },
        { name: "Miniprep", durationDays: 2 },
        { name: "Sequencing", durationDays: 1 },
      ],
      startDate: "2026-07-01",
    }) as { ok: boolean; experiments: Array<{ id: number }>; dependenciesCreated: number };

    expect(result.ok).toBe(true);
    expect(result.experiments).toHaveLength(3);
    expect(result.experiments[0].id).toBe(10);
    expect(result.experiments[1].id).toBe(11);
    expect(result.experiments[2].id).toBe(12);
    expect(result.dependenciesCreated).toBe(2);

    // Two FS edges: 10->11 and 11->12
    expect(depSpy).toHaveBeenCalledTimes(2);
    expect(depSpy).toHaveBeenNthCalledWith(1, 10, 11);
    expect(depSpy).toHaveBeenNthCalledWith(2, 11, 12);

    expect(createSpy).toHaveBeenCalledTimes(3);
  });

  it("execute navigates to /gantt?highlightTasks=self:10,self:11,self:12 after a successful chain write", async () => {
    const tasks = [
      makeTask({ id: 10, name: "Transformation", start_date: "2026-07-01", end_date: "2026-07-02", duration_days: 1 }),
      makeTask({ id: 11, name: "Miniprep", start_date: "2026-07-02", end_date: "2026-07-04", duration_days: 2 }),
      makeTask({ id: 12, name: "Sequencing", start_date: "2026-07-04", end_date: "2026-07-05", duration_days: 1 }),
    ];
    vi.spyOn(experimentToolsDeps, "createTask")
      .mockResolvedValueOnce(tasks[0])
      .mockResolvedValueOnce(tasks[1])
      .mockResolvedValueOnce(tasks[2]);
    vi.spyOn(experimentToolsDeps, "createDependency").mockResolvedValue(undefined);
    const navSpy = vi.spyOn(experimentToolsDeps, "navigate").mockImplementation(() => {});

    await createExperimentChainTool.execute({
      experiments: [
        { name: "Transformation", durationDays: 1 },
        { name: "Miniprep", durationDays: 2 },
        { name: "Sequencing", durationDays: 1 },
      ],
      startDate: "2026-07-01",
    });

    expect(navSpy).toHaveBeenCalledTimes(1);
    expect(navSpy).toHaveBeenCalledWith("/gantt?highlightTasks=self:10,self:11,self:12");
  });

  it("execute navigates even when dep creation fails (experiments created successfully)", async () => {
    const task1 = makeTask({ id: 20, name: "Step 1", start_date: "2026-07-01", end_date: "2026-07-02", duration_days: 1 });
    const task2 = makeTask({ id: 21, name: "Step 2", start_date: "2026-07-02", end_date: "2026-07-03", duration_days: 1 });
    vi.spyOn(experimentToolsDeps, "createTask")
      .mockResolvedValueOnce(task1)
      .mockResolvedValueOnce(task2);
    vi.spyOn(experimentToolsDeps, "createDependency").mockRejectedValue(new Error("dep store error"));
    const navSpy = vi.spyOn(experimentToolsDeps, "navigate").mockImplementation(() => {});

    await createExperimentChainTool.execute({
      experiments: [{ name: "Step 1" }, { name: "Step 2" }],
      startDate: "2026-07-01",
    });

    // Experiments created; dep failed. Navigation still fires for the created experiments.
    expect(navSpy).toHaveBeenCalledTimes(1);
    expect(navSpy).toHaveBeenCalledWith("/gantt?highlightTasks=self:20,self:21");
  });

  it("execute does NOT navigate when no experiments are specified", async () => {
    const navSpy = vi.spyOn(experimentToolsDeps, "navigate").mockImplementation(() => {});

    await createExperimentChainTool.execute({ experiments: [], startDate: "2026-07-01" });

    expect(navSpy).not.toHaveBeenCalled();
  });

  it("execute returns an error for an empty experiments list", async () => {
    const result = await createExperimentChainTool.execute({
      experiments: [],
      startDate: "2026-07-01",
    }) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No experiments");
  });

  it("execute returns an error when startDate is missing", async () => {
    const result = await createExperimentChainTool.execute({
      experiments: [{ name: "PCR" }],
    }) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("startDate");
  });

  it("execute still returns ok when dep creation fails (experiments stand)", async () => {
    const task = makeTask({ id: 20, name: "Step 1" });
    const task2 = makeTask({ id: 21, name: "Step 2" });
    vi.spyOn(experimentToolsDeps, "createTask")
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task2);
    vi.spyOn(experimentToolsDeps, "createDependency").mockRejectedValue(new Error("dep store error"));
    vi.spyOn(experimentToolsDeps, "navigate").mockImplementation(() => {});

    const result = await createExperimentChainTool.execute({
      experiments: [{ name: "Step 1" }, { name: "Step 2" }],
      startDate: "2026-07-01",
    }) as { ok: boolean; experiments: Array<{ id: number }>; dependenciesCreated: number; note?: string };

    expect(result.ok).toBe(true);
    expect(result.experiments).toHaveLength(2);
    expect(result.dependenciesCreated).toBe(0);
    expect(result.note).toContain("dependency links");
  });

  it("execute applies gapDays in the computed schedule", async () => {
    const task1 = makeTask({ id: 30, name: "A", start_date: "2026-07-01", end_date: "2026-07-02", duration_days: 1 });
    const task2 = makeTask({ id: 31, name: "B", start_date: "2026-07-04", end_date: "2026-07-05", duration_days: 1 });
    const createSpy = vi.spyOn(experimentToolsDeps, "createTask")
      .mockResolvedValueOnce(task1)
      .mockResolvedValueOnce(task2);
    vi.spyOn(experimentToolsDeps, "createDependency").mockResolvedValue(undefined);
    vi.spyOn(experimentToolsDeps, "navigate").mockImplementation(() => {});

    await createExperimentChainTool.execute({
      experiments: [{ name: "A" }, { name: "B" }],
      startDate: "2026-07-01",
      gapDays: 2,
    });

    // B should start on July 4 (July 2 end + 2 gap days)
    expect(createSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ start_date: "2026-07-04" }),
    );
  });

  it("isDestructive returns false", () => {
    expect(createExperimentChainTool.isDestructive!({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Method-template attach (reuse-or-instantiate)
// ---------------------------------------------------------------------------

describe("resolveMethodIdForTemplate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses an existing method stamped with the template's provenance tag", async () => {
    const tag = templateProvenanceTag("pcr-colony-screen");
    const existing = makeMethod({ id: 42, tags: ["pcr", tag] });
    vi.spyOn(experimentToolsDeps, "listMethods").mockResolvedValue([existing]);
    const fetchSpy = vi.spyOn(experimentToolsDeps, "fetchTemplate");
    const instSpy = vi.spyOn(experimentToolsDeps, "instantiateTemplate");

    const result = await resolveMethodIdForTemplate("pcr-colony-screen", experimentToolsDeps);
    expect(result).toEqual({ ok: true, id: 42, reused: true });
    // Reuse must not fetch or instantiate.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(instSpy).not.toHaveBeenCalled();
  });

  it("instantiates a fresh method when none carries the provenance tag, stamping the tag", async () => {
    vi.spyOn(experimentToolsDeps, "listMethods").mockResolvedValue([]);
    vi.spyOn(experimentToolsDeps, "fetchTemplate").mockResolvedValue(makeTemplate());
    const instSpy = vi
      .spyOn(experimentToolsDeps, "instantiateTemplate")
      .mockResolvedValue(makeMethod({ id: 77 }));

    const result = await resolveMethodIdForTemplate("pcr-colony-screen", experimentToolsDeps);
    expect(result).toEqual({ ok: true, id: 77, reused: false });
    // The provenance tag is stamped so a later chain reuses it.
    const opts = instSpy.mock.calls[0][1];
    expect(opts.tags).toContain(templateProvenanceTag("pcr-colony-screen"));
  });

  it("returns an error for an unknown slug (fetch fails)", async () => {
    vi.spyOn(experimentToolsDeps, "listMethods").mockResolvedValue([]);
    vi.spyOn(experimentToolsDeps, "fetchTemplate").mockRejectedValue(new Error("404"));
    const result = await resolveMethodIdForTemplate("nope", experimentToolsDeps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no method template/i);
  });

  it("falls through to instantiation when the reuse listing throws", async () => {
    vi.spyOn(experimentToolsDeps, "listMethods").mockRejectedValue(new Error("no folder"));
    vi.spyOn(experimentToolsDeps, "fetchTemplate").mockResolvedValue(makeTemplate());
    vi.spyOn(experimentToolsDeps, "instantiateTemplate").mockResolvedValue(makeMethod({ id: 9 }));
    const result = await resolveMethodIdForTemplate("pcr-colony-screen", experimentToolsDeps);
    expect(result).toEqual({ ok: true, id: 9, reused: false });
  });
});

describe("create_experiment_chain method-template attach", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches the resolved template method id to the experiment it creates", async () => {
    vi.spyOn(experimentToolsDeps, "listMethods").mockResolvedValue([]);
    vi.spyOn(experimentToolsDeps, "fetchTemplate").mockResolvedValue(makeTemplate());
    vi.spyOn(experimentToolsDeps, "instantiateTemplate").mockResolvedValue(makeMethod({ id: 55 }));
    const createSpy = vi
      .spyOn(experimentToolsDeps, "createTask")
      .mockResolvedValue(makeTask({ id: 1, method_ids: [55] }));
    vi.spyOn(experimentToolsDeps, "navigate").mockImplementation(() => {});

    const result = (await createExperimentChainTool.execute({
      experiments: [{ name: "Colony PCR", methodTemplateSlug: "pcr-colony-screen" }],
      startDate: "2026-07-01",
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    // The created task carries the resolved template method id.
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ method_ids: [55] }),
    );
  });

  it("fails the chain with a clear error when the template slug is unknown", async () => {
    vi.spyOn(experimentToolsDeps, "listMethods").mockResolvedValue([]);
    vi.spyOn(experimentToolsDeps, "fetchTemplate").mockRejectedValue(new Error("404"));
    const createSpy = vi.spyOn(experimentToolsDeps, "createTask");
    vi.spyOn(experimentToolsDeps, "navigate").mockImplementation(() => {});

    const result = (await createExperimentChainTool.execute({
      experiments: [{ name: "Mystery", methodTemplateSlug: "does-not-exist" }],
      startDate: "2026-07-01",
    })) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    // The bad slug is caught before the task write.
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("merges an explicit methodId and a template id without duplicating", async () => {
    const tag = templateProvenanceTag("pcr-colony-screen");
    vi.spyOn(experimentToolsDeps, "listMethods").mockResolvedValue([
      makeMethod({ id: 55, tags: [tag] }),
    ]);
    const createSpy = vi
      .spyOn(experimentToolsDeps, "createTask")
      .mockResolvedValue(makeTask());
    vi.spyOn(experimentToolsDeps, "navigate").mockImplementation(() => {});

    await createExperimentChainTool.execute({
      experiments: [
        { name: "PCR", methodIds: [3], methodTemplateSlug: "pcr-colony-screen" },
      ],
      startDate: "2026-07-01",
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ method_ids: [3, 55] }),
    );
  });
});
