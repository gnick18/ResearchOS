// Cross-owner-collision coverage for the LabMethodsPanel rollup.
// Pre-fix the rollup map was keyed by bare numeric method id, so
// alex's method id=5 and morgan's method id=5 collapsed onto whichever
// was inserted last, and tasks attributing mid=5 always credited that
// single survivor. Resolver + composite-key map mirror the proven
// pattern in LabExperimentsPanel:112-128.

import { describe, expect, it } from "vitest";
import { buildMethodRows } from "./LabMethodsPanel";
import type { LabMethod, LabTask } from "@/lib/local-api";

function method(partial: Partial<LabMethod> & { id: number; username: string }): LabMethod {
  return {
    name: `${partial.username}-method-${partial.id}`,
    user_color: "#000000",
    is_public: partial.username === "public",
    ...partial,
  };
}

function task(partial: Partial<LabTask> & { id: number; username: string; method_ids: number[] }): LabTask {
  return {
    name: `task-${partial.id}`,
    project_id: 1,
    start_date: "2026-05-01",
    duration_days: 1,
    end_date: "2026-05-01",
    is_complete: false,
    task_type: "experiment",
    user_color: "#000000",
    experiment_color: null,
    notes: null,
    ...partial,
  };
}

describe("buildMethodRows", () => {
  it("keeps alex:5 / morgan:5 / public:5 as three distinct rollup rows", () => {
    const alex5 = method({ id: 5, username: "alex", name: "alex PCR" });
    const morgan5 = method({ id: 5, username: "morgan", name: "morgan plate" });
    const public5 = method({ id: 5, username: "public", name: "public miniprep" });

    const rows = buildMethodRows([alex5, morgan5, public5], []);

    // Pre-fix only the last-inserted survived; post-fix all three are rows.
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.method))).toEqual(
      new Set([alex5, morgan5, public5]),
    );
  });

  it("routes a task's mid=5 to that task owner's own method, not a sibling's", () => {
    const alex5 = method({ id: 5, username: "alex" });
    const morgan5 = method({ id: 5, username: "morgan" });
    const alexTask = task({ id: 1, username: "alex", method_ids: [5], start_date: "2026-05-10" });
    const morganTask = task({ id: 2, username: "morgan", method_ids: [5], start_date: "2026-05-11" });

    const rows = buildMethodRows([alex5, morgan5], [alexTask, morganTask]);

    const alexRow = rows.find((r) => r.method === alex5)!;
    const morganRow = rows.find((r) => r.method === morgan5)!;

    expect(alexRow.taskCount).toBe(1);
    expect(alexRow.tasks).toEqual([alexTask]);
    expect(alexRow.users).toEqual(new Set(["alex"]));
    expect(alexRow.lastUsed).toBe("2026-05-10");

    expect(morganRow.taskCount).toBe(1);
    expect(morganRow.tasks).toEqual([morganTask]);
    expect(morganRow.users).toEqual(new Set(["morgan"]));
    expect(morganRow.lastUsed).toBe("2026-05-11");
  });

  it("falls back to a public method when the task owner has no same-id private method", () => {
    const alex5 = method({ id: 5, username: "alex" });
    const public5 = method({ id: 5, username: "public" });
    // kritika has no method id=5; the resolver should land on public:5.
    const kritikaTask = task({ id: 3, username: "kritika", method_ids: [5] });

    const rows = buildMethodRows([alex5, public5], [kritikaTask]);

    const publicRow = rows.find((r) => r.method === public5)!;
    const alexRow = rows.find((r) => r.method === alex5)!;

    expect(publicRow.taskCount).toBe(1);
    expect(publicRow.tasks).toEqual([kritikaTask]);
    expect(alexRow.taskCount).toBe(0);
  });

  it("still credits singleton methods normally (no behavior change for non-collision case)", () => {
    const onlyOne = method({ id: 7, username: "alex" });
    const t = task({ id: 9, username: "alex", method_ids: [7], start_date: "2026-04-01" });

    const rows = buildMethodRows([onlyOne], [t]);
    expect(rows).toHaveLength(1);
    expect(rows[0].taskCount).toBe(1);
    expect(rows[0].lastUsed).toBe("2026-04-01");
  });

  it("returns rows with taskCount=0 for methods no visible task uses", () => {
    const m = method({ id: 11, username: "alex" });
    const rows = buildMethodRows([m], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].taskCount).toBe(0);
    expect(rows[0].lastUsed).toBeNull();
  });
});
