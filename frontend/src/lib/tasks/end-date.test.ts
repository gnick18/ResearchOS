import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { canonicalEndDate, computeTaskEndDate } from "./end-date";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    project_id: 0,
    name: "test",
    start_date: "2026-05-14",
    duration_days: 2,
    end_date: "2026-05-15",
    is_high_level: false,
    is_complete: false,
    task_type: "list",
    weekend_override: null,
    method_id: null,
    method_ids: [],
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    pcr_gradient: null,
    pcr_ingredients: null,
    method_attachments: [],
    owner: "",
    shared_with: [],
    ...overrides,
  };
}

describe("canonicalEndDate", () => {
  it("returns start_date when duration_days is 1", () => {
    expect(canonicalEndDate({ start_date: "2026-05-14", duration_days: 1 })).toBe("2026-05-14");
  });

  it("advances by duration_days - 1 weekdays for weekday starts", () => {
    // Thursday 2026-05-14 + 1 weekday = Friday 2026-05-15
    expect(canonicalEndDate({ start_date: "2026-05-14", duration_days: 2 })).toBe("2026-05-15");
  });

  it("skips weekends when straddling Friday → Monday", () => {
    // Friday 2026-05-15 + 1 weekday = Monday 2026-05-18 (weekends skipped)
    expect(canonicalEndDate({ start_date: "2026-05-15", duration_days: 2 })).toBe("2026-05-18");
  });
});

describe("computeTaskEndDate", () => {
  it("returns the same reference when end_date already matches canonical", () => {
    const task = makeTask({ start_date: "2026-05-14", duration_days: 2, end_date: "2026-05-15" });
    expect(computeTaskEndDate(task)).toBe(task);
  });

  it("fixes the bug-of-record: end_date inverted before start_date", () => {
    // This is the exact corrupted task that motivated the heal logic.
    const corrupted = makeTask({
      start_date: "2026-05-14",
      duration_days: 2,
      end_date: "2026-05-12",
    });
    const fixed = computeTaskEndDate(corrupted);
    expect(fixed).not.toBe(corrupted);
    expect(fixed.end_date).toBe("2026-05-15");
    expect(fixed.end_date >= fixed.start_date).toBe(true);
  });

  it("backfills an empty end_date", () => {
    const task = makeTask({ start_date: "2026-05-14", duration_days: 2, end_date: "" });
    const fixed = computeTaskEndDate(task);
    expect(fixed.end_date).toBe("2026-05-15");
  });

  it("treats stale end_date (e.g. after a shift that didn't recompute) as corrupted", () => {
    // Simulates the pre-fix shiftTask bug: start_date updated but end_date left behind.
    const stale = makeTask({
      start_date: "2026-05-20",
      duration_days: 3,
      end_date: "2026-05-15",
    });
    const fixed = computeTaskEndDate(stale);
    // Wed 2026-05-20 + 2 weekdays = Fri 2026-05-22
    expect(fixed.end_date).toBe("2026-05-22");
  });

  it("does not mutate the input task", () => {
    const corrupted = makeTask({
      start_date: "2026-05-14",
      duration_days: 2,
      end_date: "2026-05-12",
    });
    const snapshot = { ...corrupted };
    computeTaskEndDate(corrupted);
    expect(corrupted).toEqual(snapshot);
  });
});
