// Pins the own-only semantics of the home-page "Research Project Overview"
// headline counts after Persona 06 reported a shared-in project from morgan
// inflating alex's "5 active projects" total. The fix excludes anything
// is_shared_with_me === true from these three counts; cards still render.

import { describe, expect, it } from "vitest";
import {
  countOwnActiveProjects,
  countOwnActiveTasks,
  countOwnArchivedProjects,
} from "../page-counts";
import type { Project, Task } from "@/lib/types";

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: 1,
    name: "p",
    weekend_active: false,
    tags: null,
    color: null,
    created_at: "2026-01-01",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "alex",
    shared_with: [],
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 1,
    project_id: 1,
    name: "t",
    start_date: "2026-01-01",
    duration_days: 1,
    end_date: "2026-01-01",
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
    owner: "alex",
    shared_with: [],
    ...overrides,
  };
}

describe("home overview counts (own-only)", () => {
  it("excludes is_shared_with_me projects from active and archived counts", () => {
    const active: Project[] = [
      makeProject({ id: 1, owner: "alex" }),
      makeProject({ id: 2, owner: "alex" }),
      makeProject({ id: 3, owner: "alex" }),
      makeProject({ id: 4, owner: "alex" }),
      // Morgan's shared-in project — the Persona 06 case
      makeProject({ id: 5, owner: "morgan", is_shared_with_me: true }),
    ];
    const archived: Project[] = [
      makeProject({ id: 6, owner: "alex", is_archived: true }),
      makeProject({
        id: 7,
        owner: "morgan",
        is_archived: true,
        is_shared_with_me: true,
      }),
    ];

    expect(countOwnActiveProjects(active)).toBe(4);
    expect(countOwnArchivedProjects(archived)).toBe(1);
  });

  it("excludes shared-in and complete tasks from the active-tasks count", () => {
    const tasks: Task[] = [
      makeTask({ id: 1, owner: "alex", is_complete: false }),
      makeTask({ id: 2, owner: "alex", is_complete: false }),
      makeTask({ id: 3, owner: "alex", is_complete: true }), // complete: excluded
      makeTask({
        id: 4,
        owner: "morgan",
        is_shared_with_me: true,
        is_complete: false,
      }), // shared-in: excluded
    ];

    expect(countOwnActiveTasks(tasks)).toBe(2);
  });

  it("returns 0 when the viewer owns no projects or tasks (no NaN/fallback)", () => {
    const onlyShared: Project[] = [
      makeProject({ id: 1, owner: "morgan", is_shared_with_me: true }),
    ];
    const onlySharedTasks: Task[] = [
      makeTask({ id: 1, owner: "morgan", is_shared_with_me: true }),
    ];

    expect(countOwnActiveProjects(onlyShared)).toBe(0);
    expect(countOwnArchivedProjects([])).toBe(0);
    expect(countOwnActiveTasks(onlySharedTasks)).toBe(0);
  });
});
