import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/types";
import {
  assignListSection,
  bucketListTasks,
  RECENT_WINDOW_DAYS,
} from "./listSectionAssignment";

const TODAY = "2026-05-14";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    project_id: 0,
    name: "test",
    start_date: "2026-05-14",
    duration_days: 1,
    end_date: "2026-05-14",
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

describe("assignListSection", () => {
  it("classifies an incomplete past-end task as overdue", () => {
    const t = makeTask({
      start_date: "2026-05-08",
      end_date: "2026-05-10",
      is_complete: false,
    });
    expect(assignListSection(t, { today: TODAY })).toBe("overdue");
  });

  it("classifies an in-window incomplete task as doing", () => {
    const t = makeTask({
      start_date: "2026-05-13",
      end_date: "2026-05-15",
      is_complete: false,
    });
    expect(assignListSection(t, { today: TODAY })).toBe("doing");
  });

  it("classifies a future incomplete task as upcoming", () => {
    const t = makeTask({
      start_date: "2026-05-20",
      end_date: "2026-05-20",
      is_complete: false,
    });
    expect(assignListSection(t, { today: TODAY })).toBe("upcoming");
  });

  it("classifies a recently-completed task as recentlyDone", () => {
    const t = makeTask({
      start_date: "2026-05-08",
      end_date: "2026-05-10",
      is_complete: true,
    });
    expect(assignListSection(t, { today: TODAY })).toBe("recentlyDone");
  });

  it("classifies a long-completed task as earlier", () => {
    const t = makeTask({
      start_date: "2026-03-01",
      end_date: "2026-03-05",
      is_complete: true,
    });
    expect(assignListSection(t, { today: TODAY })).toBe("earlier");
  });

  it("treats end_date exactly RECENT_WINDOW_DAYS ago as recentlyDone (boundary inclusive)", () => {
    const t = makeTask({
      start_date: "2026-04-13",
      end_date: "2026-04-14",
      is_complete: true,
    });
    expect(RECENT_WINDOW_DAYS).toBe(30);
    expect(assignListSection(t, { today: TODAY })).toBe("recentlyDone");
  });

  it("treats end_date one day past RECENT_WINDOW_DAYS as earlier", () => {
    const t = makeTask({
      start_date: "2026-04-12",
      end_date: "2026-04-13",
      is_complete: true,
    });
    expect(assignListSection(t, { today: TODAY })).toBe("earlier");
  });

  it("treats today's incomplete task with same start/end as doing", () => {
    const t = makeTask({
      start_date: TODAY,
      end_date: TODAY,
      is_complete: false,
    });
    expect(assignListSection(t, { today: TODAY })).toBe("doing");
  });
});

describe("bucketListTasks", () => {
  it("partitions tasks across all five sections, no double-counts", () => {
    const tasks: Task[] = [
      makeTask({ id: 1, start_date: "2026-05-08", end_date: "2026-05-10" }), // overdue
      makeTask({ id: 2, start_date: "2026-05-13", end_date: "2026-05-15" }), // doing
      makeTask({ id: 3, start_date: "2026-05-25", end_date: "2026-05-25" }), // upcoming
      makeTask({
        id: 4,
        start_date: "2026-05-09",
        end_date: "2026-05-09",
        is_complete: true,
      }), // recentlyDone
      makeTask({
        id: 5,
        start_date: "2026-03-01",
        end_date: "2026-03-05",
        is_complete: true,
      }), // earlier
    ];
    const result = bucketListTasks(tasks, { today: TODAY });
    expect(result.overdue.map((t) => t.id)).toEqual([1]);
    expect(result.doing.map((t) => t.id)).toEqual([2]);
    expect(result.upcoming.map((t) => t.id)).toEqual([3]);
    expect(result.recentlyDone.map((t) => t.id)).toEqual([4]);
    expect(result.earlier.map((t) => t.id)).toEqual([5]);
    const total =
      result.overdue.length +
      result.doing.length +
      result.upcoming.length +
      result.recentlyDone.length +
      result.earlier.length;
    expect(total).toBe(tasks.length);
  });

  it("sorts overdue oldest-first", () => {
    const tasks: Task[] = [
      makeTask({ id: 1, start_date: "2026-05-10", end_date: "2026-05-12" }),
      makeTask({ id: 2, start_date: "2026-05-05", end_date: "2026-05-07" }),
      makeTask({ id: 3, start_date: "2026-05-08", end_date: "2026-05-09" }),
    ];
    const result = bucketListTasks(tasks, { today: TODAY });
    expect(result.overdue.map((t) => t.id)).toEqual([2, 3, 1]);
  });

  it("sorts upcoming soonest-first and recentlyDone newest-first", () => {
    const tasks: Task[] = [
      makeTask({ id: 1, start_date: "2026-06-01", end_date: "2026-06-01" }),
      makeTask({ id: 2, start_date: "2026-05-20", end_date: "2026-05-20" }),
      makeTask({
        id: 3,
        start_date: "2026-05-09",
        end_date: "2026-05-09",
        is_complete: true,
      }),
      makeTask({
        id: 4,
        start_date: "2026-05-12",
        end_date: "2026-05-12",
        is_complete: true,
      }),
    ];
    const result = bucketListTasks(tasks, { today: TODAY });
    expect(result.upcoming.map((t) => t.id)).toEqual([2, 1]);
    expect(result.recentlyDone.map((t) => t.id)).toEqual([4, 3]);
  });
});
