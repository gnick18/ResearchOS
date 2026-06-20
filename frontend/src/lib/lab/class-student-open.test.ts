// Tests for the CT-2 student-open action (class-student-open.ts).
//
// The load-bearing assertions:
//   1. First open CREATES a student-owned notebook with the assignment back-link,
//      the copied checklist, the template method, and the assignment's visibility.
//   2. A second open REUSES the existing notebook (idempotent, no duplicate).
//   3. Flag OFF refuses (no create).
//   4. The instructor opening their own assignment is refused (the C2 planner rule).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";

vi.mock("./class-mode-config", () => ({ CLASS_MODE_ENABLED: true }));

import { openAssignmentNotebook, type StudentOpenTasksApi } from "./class-student-open";
import type { ClassAssignmentRecord } from "./class-assignment";
import type { Task } from "@/lib/types";

const ASSIGNMENT: ClassAssignmentRecord = {
  assignmentId: "asg-7",
  title: "Assignment 7",
  description: "Run the protocol.",
  templateMethodId: 42,
  checklist: [
    { id: "s1", label: "Prepare master mix" },
    { id: "s2", label: "Run the gel" },
  ],
  visibility: "private",
  instructor: "prof",
  assignedAt: "2026-06-20T00:00:00.000Z",
};

function fakeTask(over: Partial<Task>): Task {
  // Only the fields the action reads are meaningful; the rest are filler.
  return { id: 1, assignment_id: undefined, ...over } as unknown as Task;
}

function makeApi(existing: Task[] = []): {
  api: StudentOpenTasksApi;
  createArgs: Array<Record<string, unknown>>;
} {
  const createArgs: Array<Record<string, unknown>> = [];
  const api: StudentOpenTasksApi = {
    listAllForUser: vi.fn(async () => existing),
    create: vi.fn(async (data: Record<string, unknown>) => {
      createArgs.push(data);
      return fakeTask({ id: 99, assignment_id: data.assignment_id as string });
    }) as unknown as StudentOpenTasksApi["create"],
  };
  return { api, createArgs };
}

describe("openAssignmentNotebook: first open creates the student notebook", () => {
  it("creates with the assignment link, checklist, template, and visibility", async () => {
    const { api, createArgs } = makeApi([]);
    const res = await openAssignmentNotebook({
      assignment: ASSIGNMENT,
      student: "alice",
      today: "2026-06-20",
      tasksApiImpl: api,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.created).toBe(true);
    expect(res.task.assignment_id).toBe("asg-7");

    expect(createArgs).toHaveLength(1);
    const arg = createArgs[0];
    expect(arg.name).toBe("Assignment 7");
    expect(arg.assignment_id).toBe("asg-7");
    expect(arg.template_method_id).toBe(42);
    expect(arg.class_visibility).toBe("private");
    expect(arg.start_date).toBe("2026-06-20");
    expect(arg.sub_tasks).toEqual([
      { id: "s1", text: "Prepare master mix", is_complete: false },
      { id: "s2", text: "Run the gel", is_complete: false },
    ]);
  });
});

describe("openAssignmentNotebook: idempotent reuse", () => {
  it("reuses an existing notebook for the assignment and does NOT create again", async () => {
    const existing = fakeTask({ id: 55, assignment_id: "asg-7" });
    const { api, createArgs } = makeApi([existing]);
    const res = await openAssignmentNotebook({
      assignment: ASSIGNMENT,
      student: "alice",
      tasksApiImpl: api,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.created).toBe(false);
    expect(res.task.id).toBe(55);
    expect(createArgs).toHaveLength(0);
    expect(api.create).not.toHaveBeenCalled();
  });

  it("does not collide with a DIFFERENT assignment's notebook", async () => {
    const otherNotebook = fakeTask({ id: 55, assignment_id: "asg-OTHER" });
    const { api, createArgs } = makeApi([otherNotebook]);
    const res = await openAssignmentNotebook({
      assignment: ASSIGNMENT,
      student: "alice",
      tasksApiImpl: api,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.created).toBe(true); // a fresh notebook for asg-7
    expect(createArgs).toHaveLength(1);
  });
});

describe("openAssignmentNotebook: refusals", () => {
  it("refuses the instructor opening their own assignment (C2 planner rule)", async () => {
    const { api } = makeApi([]);
    const res = await openAssignmentNotebook({
      assignment: ASSIGNMENT,
      student: "prof", // the instructor is never a student of their own class
      tasksApiImpl: api,
    });
    expect(res.ok).toBe(false);
    expect(api.create).not.toHaveBeenCalled();
  });

  it("flag OFF refuses with no create", async () => {
    vi.resetModules();
    vi.doMock("./class-mode-config", () => ({ CLASS_MODE_ENABLED: false }));
    const { openAssignmentNotebook: openOff } = await import("./class-student-open");
    const { api } = makeApi([]);
    const res = await openOff({
      assignment: ASSIGNMENT,
      student: "alice",
      tasksApiImpl: api,
    });
    expect(res.ok).toBe(false);
    expect(api.create).not.toHaveBeenCalled();
    vi.doUnmock("./class-mode-config");
    vi.resetModules();
  });
});
