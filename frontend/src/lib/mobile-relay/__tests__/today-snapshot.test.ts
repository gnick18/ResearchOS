import { describe, expect, it } from "vitest";

import { classifyToday } from "../today-snapshot";

// A fixed "today" so the buckets are deterministic regardless of wall clock.
const TODAY = "2026-06-07";

function task(over: Partial<Parameters<typeof classifyToday>[0][number]>) {
  return {
    id: "t",
    name: "task",
    start_date: TODAY,
    end_date: TODAY,
    task_type: "experiment",
    is_complete: false,
    ...over,
  };
}

describe("classifyToday", () => {
  it("buckets a task spanning today as active", () => {
    const { active, overdue, upcoming } = classifyToday(
      [task({ id: "a", start_date: "2026-06-06", end_date: "2026-06-08" })],
      TODAY,
    );
    expect(active.map((t) => t.id)).toEqual(["a"]);
    expect(overdue).toHaveLength(0);
    expect(upcoming).toHaveLength(0);
  });

  it("treats a task starting and ending today as active (boundaries inclusive)", () => {
    const { active } = classifyToday([task({ id: "b" })], TODAY);
    expect(active.map((t) => t.id)).toEqual(["b"]);
  });

  it("buckets an end_date in the past as overdue", () => {
    const { overdue, active } = classifyToday(
      [task({ id: "c", start_date: "2026-06-01", end_date: "2026-06-06" })],
      TODAY,
    );
    expect(overdue.map((t) => t.id)).toEqual(["c"]);
    expect(active).toHaveLength(0);
  });

  it("buckets a future start_date as upcoming", () => {
    const { upcoming } = classifyToday(
      [task({ id: "d", start_date: "2026-06-08", end_date: "2026-06-09" })],
      TODAY,
    );
    expect(upcoming.map((t) => t.id)).toEqual(["d"]);
  });

  it("drops completed tasks from every bucket", () => {
    const { active, overdue, upcoming } = classifyToday(
      [
        task({ id: "done-active", is_complete: true }),
        task({ id: "done-overdue", end_date: "2026-06-01", is_complete: true }),
        task({ id: "done-upcoming", start_date: "2026-07-01", end_date: "2026-07-02", is_complete: true }),
      ],
      TODAY,
    );
    expect(active).toHaveLength(0);
    expect(overdue).toHaveLength(0);
    expect(upcoming).toHaveLength(0);
  });

  it("splits a mixed list correctly", () => {
    const { active, overdue, upcoming } = classifyToday(
      [
        task({ id: "a", start_date: "2026-06-06", end_date: "2026-06-08" }),
        task({ id: "o", start_date: "2026-05-01", end_date: "2026-06-05" }),
        task({ id: "u", start_date: "2026-06-10", end_date: "2026-06-11" }),
        task({ id: "done", is_complete: true }),
      ],
      TODAY,
    );
    expect(active.map((t) => t.id)).toEqual(["a"]);
    expect(overdue.map((t) => t.id)).toEqual(["o"]);
    expect(upcoming.map((t) => t.id)).toEqual(["u"]);
  });
});
