// Unit tests for the BeakerBot summarize_tasks tool (BeakerAI lane, 2026-06-16).
//
// Strategy: drive the pure aggregateTasks core with fixtures + a frozen project
// map + a fixed today and assert the exact status buckets, then assert
// taskSummaryReport lifts the numbers verbatim.

import { describe, it, expect } from "vitest";
import { aggregateTasks } from "./summarize-tasks";
import { taskSummaryReport } from "@/lib/ai/summary-report";
import type { Task } from "@/lib/types";

function task(partial: Partial<Task> & { id: number }): Task {
  return {
    project_id: 1,
    name: `task-${partial.id}`,
    start_date: "2026-06-01",
    duration_days: 1,
    end_date: "2026-06-20",
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
    // partial (which always carries the required id) overrides the defaults above.
    ...partial,
  };
}

const PROJECT_NAMES = new Map<string, string>([["1", "Cloning"]]);
const TODAY = "2026-06-16"; // window: due this week = through 2026-06-23

function sampleTasks(): Task[] {
  return [
    task({ id: 1, name: "overdue exp", end_date: "2026-06-10", task_type: "experiment" }), // overdue
    task({ id: 2, name: "order tips", end_date: "2026-06-18", task_type: "purchase" }), // due this week
    task({ id: 3, name: "list item", end_date: "2026-06-30", task_type: "list" }), // upcoming
    task({ id: 4, name: "done exp", end_date: "2026-06-05", is_complete: true }), // complete (not overdue)
    task({ id: 5, name: "delegated", end_date: "2026-06-12", owner: "me", assignee: "alice", flagged: { by: "pi", at: "x" } as any }), // overdue + assigned + flagged
  ];
}

describe("aggregateTasks", () => {
  it("returns an empty summary for no tasks", () => {
    const s = aggregateTasks([], {}, PROJECT_NAMES, TODAY);
    expect(s.count).toBe(0);
    expect(s.byStatus).toEqual({ complete: 0, overdue: 0, dueThisWeek: 0, upcoming: 0 });
    expect(s.overdue).toEqual([]);
  });

  it("buckets by status against a fixed today", () => {
    const s = aggregateTasks(sampleTasks(), {}, PROJECT_NAMES, TODAY);
    expect(s.count).toBe(5);
    expect(s.byStatus).toEqual({ complete: 1, overdue: 2, dueThisWeek: 1, upcoming: 1 });
    expect(s.overdue.map((t) => t.name)).toEqual(["overdue exp", "delegated"]); // soonest-overdue first
    expect(s.dueThisWeek.map((t) => t.name)).toEqual(["order tips"]);
  });

  it("counts assigned and flagged open tasks", () => {
    const s = aggregateTasks(sampleTasks(), {}, PROJECT_NAMES, TODAY);
    expect(s.assignedCount).toBe(1); // delegated (assignee != owner, not complete)
    expect(s.flaggedCount).toBe(1); // delegated
  });

  it("tallies by type, owner, and project", () => {
    const s = aggregateTasks(sampleTasks(), {}, PROJECT_NAMES, TODAY);
    expect(Object.fromEntries(s.byType.map((b) => [b.type, b.count]))).toEqual({
      experiment: 3,
      purchase: 1,
      list: 1,
    });
    expect(s.byOwner).toEqual([{ owner: "me", count: 5 }]);
    expect(s.byProject).toEqual([{ projectId: "1", projectName: "Cloning", count: 5 }]);
  });

  it("respects a custom dueWithinDays window", () => {
    // Widen to 20 days: the upcoming list item (06-30) is still beyond, exp at 06-30
    const s = aggregateTasks(sampleTasks(), {}, PROJECT_NAMES, TODAY, { dueWithinDays: 20 });
    // 06-18 and 06-30: 06-30 is within 20 days (through 07-06), so dueThisWeek grows.
    expect(s.byStatus.dueThisWeek).toBe(2);
    expect(s.byStatus.upcoming).toBe(0);
  });

  it("scopes to specific owners", () => {
    const tasks = [task({ id: 1, owner: "me" }), task({ id: 2, owner: "alice" })];
    const s = aggregateTasks(tasks, { owners: ["alice"] }, PROJECT_NAMES, TODAY);
    expect(s.count).toBe(1);
    expect(s.byOwner).toEqual([{ owner: "alice", count: 1 }]);
  });
});

describe("taskSummaryReport", () => {
  it("lifts the status buckets verbatim into the report", () => {
    const s = aggregateTasks(sampleTasks(), {}, PROJECT_NAMES, TODAY);
    const report = taskSummaryReport(s);
    expect(report.kind).toBe("summarize_tasks");
    const stat = (label: string) => report.stats.find((t) => t.label === label)?.value;
    expect(stat("tasks")).toBe("5");
    expect(stat("overdue")).toBe("2");
    expect(stat("due this week")).toBe("1");
    const statusGroup = report.barGroups.find((g) => g.title === "By status");
    expect(statusGroup?.rows.find((r) => r.label === "Overdue")?.value).toBe(2);
  });
});
