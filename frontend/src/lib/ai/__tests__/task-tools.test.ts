// task-tools tests (ai task-tools bot, 2026-06-12).
//
// Tests cover:
//   - resolveProject / resolveTask / ownTasks: pure resolution by name + id,
//     case-insensitivity, the own-tasks-only filter.
//   - create_task: describeAction preview, project resolution by name/id, the
//     duration vs end-date precedence, createTask called with the resolved id,
//     navigate seam, the bad-project error path.
//   - reschedule_task: describeAction preview, moveTask called with the resolved
//     id + confirmed flag, the dependency cascade surfaced (dependentsMoved +
//     cascade), navigate seam, the not-an-own-task error path.
//   - update_task: describeAction preview, updateTask called with the resolved
//     name/complete/project fields, the empty-string project clear, the
//     nothing-to-update guard, the not-found path.
//
// All tests stub taskToolsDeps (the injectable seam), so no real folder or
// local-api is involved. These tools WRITE real data, so the actual create /
// move / update needs Grant's :3000 pass; here we pin the wiring + the args
// each api method receives.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  taskToolsDeps,
  resolveProject,
  resolveTask,
  ownTasks,
  ownTaskNames,
  resolveDepType,
  createTaskTool,
  rescheduleTaskTool,
  updateTaskTool,
  linkTasksTool,
  deleteTaskTool,
} from "../tools/task-tools";
import type { Project, Task, ShiftResult } from "@/lib/types";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: "Cloning",
    weekend_active: false,
    tags: null,
    color: null,
    created_at: "2026-06-12T00:00:00.000Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "testuser",
    shared_with: [],
    ...over,
  };
}

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 10,
    project_id: 1,
    name: "Order primers",
    start_date: "2026-07-01",
    duration_days: 1,
    end_date: "2026-07-02",
    is_high_level: false,
    is_complete: false,
    task_type: "list",
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

function makeShift(over: Partial<ShiftResult> = {}): ShiftResult {
  return {
    affected_tasks: [],
    warnings: [],
    requires_confirmation: false,
    ...over,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pure resolution helpers
// ---------------------------------------------------------------------------

describe("resolveProject", () => {
  const projects = [makeProject({ id: 1, name: "Cloning" }), makeProject({ id: 2, name: "Imaging" })];
  it("resolves by numeric id", () => {
    expect(resolveProject(projects, 2)?.name).toBe("Imaging");
  });
  it("resolves by numeric string id", () => {
    expect(resolveProject(projects, "1")?.name).toBe("Cloning");
  });
  it("resolves by name, case-insensitive", () => {
    expect(resolveProject(projects, "imaging")?.id).toBe(2);
  });
  it("returns null for no match and for an empty ref", () => {
    expect(resolveProject(projects, "nope")).toBeNull();
    expect(resolveProject(projects, "")).toBeNull();
    expect(resolveProject(projects, undefined)).toBeNull();
  });
});

describe("ownTasks / resolveTask", () => {
  const tasks = [
    makeTask({ id: 10, name: "Order primers" }),
    makeTask({ id: 11, name: "Shared one", is_shared_with_me: true }),
  ];
  it("filters out tasks shared WITH the user", () => {
    expect(ownTasks(tasks).map((t) => t.id)).toEqual([10]);
  });
  it("resolves an own task by id and by name", () => {
    expect(resolveTask(tasks, 10)?.name).toBe("Order primers");
    expect(resolveTask(tasks, "order primers")?.id).toBe(10);
  });
  it("never resolves a shared-with-me task", () => {
    expect(resolveTask(tasks, 11)).toBeNull();
    expect(resolveTask(tasks, "Shared one")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// create_task
// ---------------------------------------------------------------------------

describe("create_task tool", () => {
  it("is a gated action, not destructive", () => {
    expect(createTaskTool.action).toBe(true);
    expect(createTaskTool.isDestructive?.({})).toBe(false);
    expect(typeof createTaskTool.describeAction).toBe("function");
  });

  it("describeAction summarizes title, project, and a duration range", () => {
    const { summary } = createTaskTool.describeAction!({
      title: "Analyze gel",
      project: "Cloning",
      startDate: "2026-07-01",
      durationDays: 3,
    });
    expect(summary).toMatch(/Analyze gel/);
    expect(summary).toMatch(/Cloning/);
    expect(summary).toMatch(/for 3 days/);
  });

  it("resolves the project by name and calls createTask with its id", async () => {
    vi.spyOn(taskToolsDeps, "listProjects").mockResolvedValue([
      makeProject({ id: 7, name: "Cloning" }),
    ]);
    const create = vi
      .spyOn(taskToolsDeps, "createTask")
      .mockResolvedValue(makeTask({ id: 42, project_id: 7, name: "Order primers" }));
    const navigate = vi.spyOn(taskToolsDeps, "navigate").mockImplementation(() => {});

    const out = (await createTaskTool.execute({
      title: "Order primers",
      project: "cloning",
      startDate: "2026-07-01",
    })) as { ok: boolean; id: number };

    expect(out.ok).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Order primers",
        start_date: "2026-07-01",
        duration_days: 1,
        project_id: 7,
        task_type: "list",
      }),
    );
    expect(navigate).toHaveBeenCalledWith("/gantt?highlightTasks=self:42");
  });

  it("derives duration from an explicit end date (which overrides durationDays)", async () => {
    vi.spyOn(taskToolsDeps, "listProjects").mockResolvedValue([]);
    const create = vi
      .spyOn(taskToolsDeps, "createTask")
      .mockResolvedValue(makeTask({ id: 1 }));
    vi.spyOn(taskToolsDeps, "navigate").mockImplementation(() => {});

    await createTaskTool.execute({
      title: "Long task",
      startDate: "2026-07-01",
      endDate: "2026-07-05",
      durationDays: 99,
    });
    // 2026-07-01 to 2026-07-05 is 4 days; endDate wins over durationDays.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ duration_days: 4 }),
    );
  });

  it("errors when the named project does not resolve", async () => {
    vi.spyOn(taskToolsDeps, "listProjects").mockResolvedValue([makeProject({ name: "Cloning" })]);
    const create = vi.spyOn(taskToolsDeps, "createTask");
    const out = (await createTaskTool.execute({
      title: "X",
      project: "Nonexistent",
      startDate: "2026-07-01",
    })) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/could not find a project/i);
    expect(create).not.toHaveBeenCalled();
  });

  it("requires a title and a start date", async () => {
    expect(((await createTaskTool.execute({ startDate: "2026-07-01" })) as { ok: boolean }).ok).toBe(false);
    expect(((await createTaskTool.execute({ title: "X" })) as { ok: boolean }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reschedule_task
// ---------------------------------------------------------------------------

describe("reschedule_task tool", () => {
  it("is a gated action, not destructive, and warns about cascade in the preview", () => {
    expect(rescheduleTaskTool.action).toBe(true);
    expect(rescheduleTaskTool.isDestructive?.({})).toBe(false);
    const { summary } = rescheduleTaskTool.describeAction!({
      task: "Order primers",
      newStartDate: "2026-07-10",
    });
    expect(summary).toMatch(/Order primers/);
    expect(summary).toMatch(/2026-07-10/);
    expect(summary).toMatch(/dependent/i);
  });

  it("moves the resolved task with confirmed:true and surfaces the dependency cascade", async () => {
    vi.spyOn(taskToolsDeps, "listTasks").mockResolvedValue([
      makeTask({ id: 10, name: "Order primers" }),
    ]);
    const move = vi.spyOn(taskToolsDeps, "moveTask").mockResolvedValue(
      makeShift({
        affected_tasks: [
          { task_id: 10, name: "Order primers", old_start: "2026-07-01", new_start: "2026-07-10", old_end: "2026-07-02", new_end: "2026-07-11" },
          { task_id: 11, name: "Run PCR", old_start: "2026-07-03", new_start: "2026-07-12", old_end: "2026-07-04", new_end: "2026-07-13" },
          { task_id: 12, name: "Image", old_start: "2026-07-05", new_start: "2026-07-14", old_end: "2026-07-06", new_end: "2026-07-15" },
        ],
        warnings: [{ task_id: 12, name: "Image", message: "lands on a weekend" }],
      }),
    );
    const navigate = vi.spyOn(taskToolsDeps, "navigate").mockImplementation(() => {});

    const out = (await rescheduleTaskTool.execute({
      task: "Order primers",
      newStartDate: "2026-07-10",
    })) as {
      ok: boolean;
      dependentsMoved: number;
      newStartDate: string;
      cascade: { id: number }[];
      warnings: string[];
    };

    expect(out.ok).toBe(true);
    expect(move).toHaveBeenCalledWith(10, { new_start_date: "2026-07-10", confirmed: true });
    // 3 affected total minus the moved task itself = 2 dependents.
    expect(out.dependentsMoved).toBe(2);
    expect(out.newStartDate).toBe("2026-07-10");
    expect(out.cascade.map((c) => c.id)).toEqual([10, 11, 12]);
    expect(out.warnings).toEqual(["lands on a weekend"]);
    expect(navigate).toHaveBeenCalledWith("/gantt?highlightTasks=self:10,self:11,self:12");
  });

  it("reports zero dependents when only the task itself moves", async () => {
    vi.spyOn(taskToolsDeps, "listTasks").mockResolvedValue([makeTask({ id: 10 })]);
    vi.spyOn(taskToolsDeps, "moveTask").mockResolvedValue(
      makeShift({
        affected_tasks: [
          { task_id: 10, name: "Order primers", old_start: "2026-07-01", new_start: "2026-07-10", old_end: "2026-07-02", new_end: "2026-07-11" },
        ],
      }),
    );
    vi.spyOn(taskToolsDeps, "navigate").mockImplementation(() => {});
    const out = (await rescheduleTaskTool.execute({ task: 10, newStartDate: "2026-07-10" })) as {
      dependentsMoved: number;
    };
    expect(out.dependentsMoved).toBe(0);
  });

  it("errors when the task is not one of the user's own tasks", async () => {
    vi.spyOn(taskToolsDeps, "listTasks").mockResolvedValue([
      makeTask({ id: 11, name: "Shared", is_shared_with_me: true }),
    ]);
    const move = vi.spyOn(taskToolsDeps, "moveTask");
    const out = (await rescheduleTaskTool.execute({ task: "Shared", newStartDate: "2026-07-10" })) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/could not find one of your tasks/i);
    expect(move).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// update_task
// ---------------------------------------------------------------------------

describe("update_task tool", () => {
  it("is a gated action, not destructive", () => {
    expect(updateTaskTool.action).toBe(true);
    expect(updateTaskTool.isDestructive?.({})).toBe(false);
  });

  it("describeAction lists the changes", () => {
    const { summary } = updateTaskTool.describeAction!({
      task: "Order primers",
      title: "Order new primers",
      complete: true,
    });
    expect(summary).toMatch(/rename to "Order new primers"/);
    expect(summary).toMatch(/mark complete/);
  });

  it("renames + marks complete + moves project via updateTask with resolved ids", async () => {
    vi.spyOn(taskToolsDeps, "listTasks").mockResolvedValue([makeTask({ id: 10 })]);
    vi.spyOn(taskToolsDeps, "listProjects").mockResolvedValue([makeProject({ id: 5, name: "Imaging" })]);
    const update = vi
      .spyOn(taskToolsDeps, "updateTask")
      .mockResolvedValue(makeTask({ id: 10, name: "Renamed", is_complete: true, project_id: 5 }));
    const navigate = vi.spyOn(taskToolsDeps, "navigate").mockImplementation(() => {});

    const out = (await updateTaskTool.execute({
      task: 10,
      title: "Renamed",
      complete: true,
      project: "Imaging",
    })) as { ok: boolean };

    expect(out.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(10, {
      name: "Renamed",
      is_complete: true,
      project_id: 5,
    });
    expect(navigate).toHaveBeenCalledWith("/gantt?highlightTasks=self:10");
  });

  it("clears the project when project is the empty string", async () => {
    vi.spyOn(taskToolsDeps, "listTasks").mockResolvedValue([makeTask({ id: 10 })]);
    const listProjects = vi.spyOn(taskToolsDeps, "listProjects");
    const update = vi.spyOn(taskToolsDeps, "updateTask").mockResolvedValue(makeTask({ id: 10, project_id: 0 }));
    vi.spyOn(taskToolsDeps, "navigate").mockImplementation(() => {});

    await updateTaskTool.execute({ task: 10, project: "" });
    expect(update).toHaveBeenCalledWith(10, { project_id: null });
    // No project lookup needed to clear.
    expect(listProjects).not.toHaveBeenCalled();
  });

  it("guards against an empty update", async () => {
    vi.spyOn(taskToolsDeps, "listTasks").mockResolvedValue([makeTask({ id: 10 })]);
    const update = vi.spyOn(taskToolsDeps, "updateTask");
    const out = (await updateTaskTool.execute({ task: 10 })) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/nothing to update/i);
    expect(update).not.toHaveBeenCalled();
  });

  it("errors when the task does not resolve to an own task", async () => {
    vi.spyOn(taskToolsDeps, "listTasks").mockResolvedValue([]);
    const out = (await updateTaskTool.execute({ task: "ghost", title: "x" })) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/could not find one of your tasks/i);
  });
});

describe("resolveTask robustness + ownTaskNames", () => {
  const tasks = [
    makeTask({ id: 10, name: "run PCR" }),
    makeTask({ id: 11, name: "order primers" }),
  ];
  it("falls back to a normalized contains match for the model's phrasing", () => {
    expect(resolveTask(tasks, "the run PCR task")?.id).toBe(10);
    expect(resolveTask(tasks, "run pcr")?.id).toBe(10);
  });
  it("returns null when a contains match is ambiguous", () => {
    const t2 = [makeTask({ id: 1, name: "run PCR a" }), makeTask({ id: 2, name: "run PCR b" })];
    expect(resolveTask(t2, "run PCR")).toBeNull();
  });
  it("lists own task names for the not-found error", () => {
    expect(ownTaskNames(tasks)).toEqual(["run PCR", "order primers"]);
  });
});

describe("resolveDepType", () => {
  it("defaults to finish-to-start", () => {
    expect(resolveDepType(undefined)).toBe("FS");
    expect(resolveDepType("finish-to-start")).toBe("FS");
    expect(resolveDepType("anything else")).toBe("FS");
  });
  it("maps start-to-start and start-to-finish", () => {
    expect(resolveDepType("start-to-start")).toBe("SS");
    expect(resolveDepType("SS")).toBe("SS");
    expect(resolveDepType("start-to-finish")).toBe("SF");
    expect(resolveDepType("SF")).toBe("SF");
  });
});

describe("link_tasks tool", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("creates a finish-to-start dependency parent=predecessor child=successor", async () => {
    vi.spyOn(taskToolsDeps, "listTasks").mockResolvedValue([
      makeTask({ id: 1, name: "order primers" }),
      makeTask({ id: 2, name: "run PCR" }),
    ]);
    const create = vi
      .spyOn(taskToolsDeps, "createDependency")
      .mockResolvedValue({ id: 5, parent_id: 1, child_id: 2, dep_type: "FS" });
    vi.spyOn(taskToolsDeps, "navigate").mockImplementation(() => {});

    const res = (await linkTasksTool.execute({
      predecessor: "order primers",
      successor: "run PCR",
    })) as { ok: boolean; depType?: string };

    expect(res.ok).toBe(true);
    expect(res.depType).toBe("FS");
    expect(create).toHaveBeenCalledWith({ parent_id: 1, child_id: 2, dep_type: "FS" });
  });

  it("errors and lists names when a task is not found", async () => {
    vi.spyOn(taskToolsDeps, "listTasks").mockResolvedValue([
      makeTask({ id: 1, name: "order primers" }),
    ]);
    const create = vi.spyOn(taskToolsDeps, "createDependency");

    const res = (await linkTasksTool.execute({
      predecessor: "order primers",
      successor: "nonexistent",
    })) as { ok: boolean; error?: string };

    expect(res.ok).toBe(false);
    expect(res.error).toContain("order primers");
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses to link a task to itself", async () => {
    vi.spyOn(taskToolsDeps, "listTasks").mockResolvedValue([
      makeTask({ id: 1, name: "order primers" }),
    ]);
    const create = vi.spyOn(taskToolsDeps, "createDependency");
    const res = (await linkTasksTool.execute({
      predecessor: "order primers",
      successor: "order primers",
    })) as { ok: boolean };
    expect(res.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("is a gated action with a clear describeAction summary", () => {
    expect(linkTasksTool.action).toBe(true);
    const d = linkTasksTool.describeAction!({
      predecessor: "order primers",
      successor: "run PCR",
    });
    expect(d.summary).toContain("run PCR");
    expect(d.summary).toContain("order primers");
  });
});

describe("delete_task tool", () => {
  it("is a destructive gated action (hard-stop confirm)", () => {
    expect(deleteTaskTool.action).toBe(true);
    expect(deleteTaskTool.isDestructive?.({})).toBe(true);
  });
  it("soft-deletes the resolved own task (covers experiments)", async () => {
    vi.spyOn(taskToolsDeps, "listTasks").mockResolvedValue([makeTask({ id: 10, name: "Order primers" })]);
    const del = vi.spyOn(taskToolsDeps, "deleteTask").mockResolvedValue(undefined);
    const r = (await deleteTaskTool.execute({ task: "order primers" })) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(del).toHaveBeenCalledWith(10);
  });
  it("never deletes a shared-with-me task", async () => {
    vi.spyOn(taskToolsDeps, "listTasks").mockResolvedValue([makeTask({ id: 11, name: "Shared", is_shared_with_me: true })]);
    const del = vi.spyOn(taskToolsDeps, "deleteTask");
    const r = (await deleteTaskTool.execute({ task: 11 })) as { ok: boolean };
    expect(r.ok).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });
});
