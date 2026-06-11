import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Project, Task } from "@/lib/types";
import { toToolDefinition } from "../tools/types";

// Pins for the read-your-work tools, the first READ-ONLY tools BeakerBot can call.
// The pure shapers are tested against mock Task/Project arrays, and the tool
// execute path is tested with the local-api readers mocked, so no folder and no
// network are involved.

// Mock the data layer the tools read from. The shaping is what we assert, the
// readers themselves are existing, separately tested code.
vi.mock("@/lib/local-api", () => ({
  fetchAllTasksIncludingShared: vi.fn(),
  projectsApi: { list: vi.fn() },
}));

import { fetchAllTasksIncludingShared, projectsApi } from "@/lib/local-api";
import {
  shapeMyTasks,
  shapeMyProjects,
  getMyTasksTool,
  getMyProjectsTool,
} from "../tools/read-my-work";

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 1,
    project_id: 10,
    name: "A task",
    start_date: "2026-06-01",
    duration_days: 1,
    end_date: "2026-06-10",
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
    owner: "me",
    shared_with: [],
    ...overrides,
  } as Task;
}

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: 10,
    name: "PCR optimization",
    weekend_active: false,
    tags: null,
    color: null,
    created_at: "2026-06-01",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "me",
    shared_with: [],
    ...overrides,
  } as Project;
}

describe("shapeMyTasks", () => {
  const today = "2026-06-10";

  it("resolves the project name, derives status, and drops completed tasks by default", () => {
    const tasks = [
      makeTask({ id: 1, name: "Run gel", project_id: 10, end_date: "2026-06-12" }),
      makeTask({ id: 2, name: "Old prep", project_id: 10, end_date: "2026-06-05" }),
      makeTask({ id: 3, name: "Done thing", project_id: 10, is_complete: true }),
    ];
    const projects = [makeProject({ id: 10, name: "PCR optimization" })];

    const result = shapeMyTasks(tasks, projects, { today });

    expect(result.today).toBe(today);
    expect(result.count).toBe(2);
    const titles = result.tasks.map((t) => t.title);
    expect(titles).toContain("Run gel");
    expect(titles).toContain("Old prep");
    expect(titles).not.toContain("Done thing");

    const overdue = result.tasks.find((t) => t.title === "Old prep");
    expect(overdue?.status).toBe("overdue");
    expect(overdue?.project).toBe("PCR optimization");

    const active = result.tasks.find((t) => t.title === "Run gel");
    expect(active?.status).toBe("active");
  });

  it("includes completed tasks when asked, and marks upcoming work", () => {
    const tasks = [
      makeTask({
        id: 4,
        name: "Future task",
        start_date: "2026-06-20",
        end_date: "2026-06-21",
      }),
      makeTask({ id: 5, name: "Finished", is_complete: true }),
    ];
    const result = shapeMyTasks(tasks, [], {
      today,
      includeCompleted: true,
    });
    expect(result.count).toBe(2);
    expect(result.tasks.find((t) => t.title === "Future task")?.status).toBe(
      "upcoming",
    );
    expect(result.tasks.find((t) => t.title === "Finished")?.status).toBe(
      "complete",
    );
  });

  it("drops list-type rows (checklist items, not bench work) and sorts by due date", () => {
    const tasks = [
      makeTask({ id: 6, name: "Later", end_date: "2026-06-15" }),
      makeTask({ id: 7, name: "Sooner", end_date: "2026-06-11" }),
      makeTask({ id: 8, name: "A checklist row", task_type: "list" }),
    ];
    const result = shapeMyTasks(tasks, [], { today });
    expect(result.tasks.map((t) => t.title)).toEqual(["Sooner", "Later"]);
  });

  it("marks tasks shared with the user", () => {
    const tasks = [
      makeTask({ id: 9, name: "Shared one", is_shared_with_me: true }),
    ];
    const result = shapeMyTasks(tasks, [], { today });
    expect(result.tasks[0].shared).toBe(true);
  });
});

describe("shapeMyProjects", () => {
  it("drops hidden and archived projects by default", () => {
    const projects = [
      makeProject({ id: 1, name: "Active" }),
      makeProject({ id: 2, name: "Archived", is_archived: true }),
      makeProject({ id: 3, name: "Misc", is_hidden: true }),
    ];
    const result = shapeMyProjects(projects);
    expect(result.count).toBe(1);
    expect(result.projects[0].name).toBe("Active");
  });

  it("includes archived projects when asked, but never hidden ones", () => {
    const projects = [
      makeProject({ id: 1, name: "Active" }),
      makeProject({ id: 2, name: "Archived", is_archived: true }),
      makeProject({ id: 3, name: "Misc", is_hidden: true }),
    ];
    const result = shapeMyProjects(projects, { includeArchived: true });
    expect(result.count).toBe(2);
    const names = result.projects.map((p) => p.name);
    expect(names).toContain("Archived");
    expect(names).not.toContain("Misc");
    expect(result.projects.find((p) => p.name === "Archived")?.archived).toBe(
      true,
    );
  });
});

describe("getMyTasksTool.execute", () => {
  beforeEach(() => {
    vi.mocked(fetchAllTasksIncludingShared).mockReset();
    vi.mocked(projectsApi.list).mockReset();
  });

  it("calls the real readers and returns the shaped result", async () => {
    vi.mocked(fetchAllTasksIncludingShared).mockResolvedValue([
      makeTask({ id: 1, name: "Run gel", project_id: 10, end_date: "2999-01-01" }),
    ]);
    vi.mocked(projectsApi.list).mockResolvedValue([
      makeProject({ id: 10, name: "PCR optimization" }),
    ]);

    const result = (await getMyTasksTool.execute({})) as {
      count: number;
      tasks: Array<{ title: string; project: string | null }>;
    };

    expect(fetchAllTasksIncludingShared).toHaveBeenCalledTimes(1);
    expect(projectsApi.list).toHaveBeenCalledTimes(1);
    expect(result.count).toBe(1);
    expect(result.tasks[0].title).toBe("Run gel");
    expect(result.tasks[0].project).toBe("PCR optimization");
  });
});

describe("getMyProjectsTool.execute", () => {
  beforeEach(() => {
    vi.mocked(projectsApi.list).mockReset();
  });

  it("returns the shaped active projects", async () => {
    vi.mocked(projectsApi.list).mockResolvedValue([
      makeProject({ id: 1, name: "Active" }),
      makeProject({ id: 2, name: "Old", is_archived: true }),
    ]);
    const result = (await getMyProjectsTool.execute({})) as {
      count: number;
      projects: Array<{ name: string }>;
    };
    expect(result.count).toBe(1);
    expect(result.projects[0].name).toBe("Active");
  });
});

describe("tool definitions", () => {
  it("expose name, description, and JSON-Schema parameters but never execute", () => {
    const def = toToolDefinition(getMyTasksTool);
    expect(def.type).toBe("function");
    expect(def.function.name).toBe("get_my_tasks");
    expect(def.function.description.length).toBeGreaterThan(0);
    expect(def.function.parameters.type).toBe("object");
    expect((def.function as Record<string, unknown>).execute).toBeUndefined();
  });
});
