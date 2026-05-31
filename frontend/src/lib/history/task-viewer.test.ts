// VC Phase 3 (VC-Phase3-Task sub-bot of HR, 2026-05-31): unit tests for the
// Task / Experiment viewer adapter. task-viewer.ts projects a reconstructed
// canonical Task state to a diffable body + summarizes a change into a row
// label. These pin the projection (name + deviation_log + per-method prose), the
// tolerance to malformed input, and the one-line summary precedence.
//
// Pure: every projection is a caller-supplied canonical string (no engine calls,
// no Date.now), so the assertions are deterministic.

import { describe, it, expect } from "vitest";
import { canonicalize } from "./canonicalize";
import {
  projectTaskState,
  summarizeTaskChange,
  taskAdapter,
} from "./task-viewer";

function taskCanonical(fields: {
  name?: string;
  deviation_log?: string | null;
  is_complete?: boolean;
  start_date?: string;
  duration_days?: number;
  method_attachments?: {
    method_id: number;
    body_override?: string | null;
    variation_notes?: string | null;
  }[];
}): string {
  return canonicalize({
    id: 7,
    name: fields.name ?? "PCR run",
    deviation_log: fields.deviation_log ?? null,
    is_complete: fields.is_complete ?? false,
    start_date: fields.start_date ?? "2026-05-01",
    duration_days: fields.duration_days ?? 1,
    method_attachments: (fields.method_attachments ?? []).map((m) => ({
      method_id: m.method_id,
      body_override: m.body_override ?? null,
      variation_notes: m.variation_notes ?? null,
    })),
  });
}

describe("projectTaskState", () => {
  it("projects an empty / malformed canonical to all-empty fields", () => {
    for (const bad of [null, undefined, "", "   ", "{not json"]) {
      const p = projectTaskState(bad);
      expect(p.name).toBe("");
      expect(p.deviationLog).toBe("");
      expect(p.methods).toEqual([]);
      expect(p.body).toBe("");
      expect(p.isComplete).toBe(false);
    }
  });

  it("projects name + deviation_log + per-method prose into the diff body", () => {
    const p = projectTaskState(
      taskCanonical({
        name: "Transfection v2",
        deviation_log: "Used 2x reagent on day 3.",
        method_attachments: [
          {
            method_id: 4,
            body_override: "Annealing at 58C",
            variation_notes: "lot #221",
          },
        ],
      }),
    );
    expect(p.name).toBe("Transfection v2");
    expect(p.deviationLog).toBe("Used 2x reagent on day 3.");
    expect(p.methods).toHaveLength(1);
    expect(p.methods[0]).toMatchObject({
      methodId: 4,
      bodyOverride: "Annealing at 58C",
      variationNotes: "lot #221",
    });
    // The body anchors each surface so a line-diff localizes a change.
    expect(p.body).toContain("# Transfection v2");
    expect(p.body).toContain("Used 2x reagent on day 3.");
    expect(p.body).toContain("## Method 4");
    expect(p.body).toContain("Annealing at 58C");
    expect(p.body).toContain("lot #221");
  });

  it("drops a method with no prose from the body but keeps it in the methods list", () => {
    const p = projectTaskState(
      taskCanonical({
        name: "Run",
        method_attachments: [{ method_id: 9 }],
      }),
    );
    expect(p.methods).toHaveLength(1);
    // Heading-only method (no override / notes) does not bloat the diff body.
    expect(p.body).not.toContain("## Method 9");
  });
});

describe("summarizeTaskChange", () => {
  const base = projectTaskState(taskCanonical({ name: "A" }));

  it("special-cases restore / undo rows ahead of any content diff", () => {
    expect(summarizeTaskChange(base, base, "revert")).toBe(
      "Restored an earlier version",
    );
    expect(summarizeTaskChange(base, base, "undo-revert")).toBe(
      "Undid a restore",
    );
  });

  it("labels the first version 'created experiment'", () => {
    expect(summarizeTaskChange(null, base)).toBe("created experiment");
  });

  it("detects rename, completion toggle, reschedule, lab-notes, and method edits", () => {
    const renamed = projectTaskState(taskCanonical({ name: "B" }));
    expect(summarizeTaskChange(base, renamed)).toBe("renamed experiment");

    const done = projectTaskState(taskCanonical({ name: "A", is_complete: true }));
    expect(summarizeTaskChange(base, done)).toBe("marked complete");
    expect(summarizeTaskChange(done, base)).toBe("reopened");

    const moved = projectTaskState(
      taskCanonical({ name: "A", start_date: "2026-06-01" }),
    );
    expect(summarizeTaskChange(base, moved)).toBe("rescheduled");

    const longer = projectTaskState(
      taskCanonical({ name: "A", duration_days: 5 }),
    );
    expect(summarizeTaskChange(base, longer)).toBe("rescheduled");

    const notes = projectTaskState(
      taskCanonical({ name: "A", deviation_log: "Spilled buffer." }),
    );
    expect(summarizeTaskChange(base, notes)).toBe("edited lab notes");

    const withMethod = projectTaskState(
      taskCanonical({ name: "A", method_attachments: [{ method_id: 2 }] }),
    );
    expect(summarizeTaskChange(base, withMethod)).toBe("added method");
    expect(summarizeTaskChange(withMethod, base)).toBe("removed method");

    const methodEdited = projectTaskState(
      taskCanonical({
        name: "A",
        method_attachments: [{ method_id: 2, variation_notes: "new note" }],
      }),
    );
    expect(summarizeTaskChange(withMethod, methodEdited)).toBe(
      "edited method 2 notes",
    );
  });

  it("falls back to 'edited experiment' when nothing detectable changed", () => {
    expect(summarizeTaskChange(base, base)).toBe("edited experiment");
  });
});

describe("taskAdapter", () => {
  it("wraps the projection + summary so the generic sidebar consumes it", () => {
    expect(taskAdapter.projectBody).toBe(projectTaskState);
    expect(taskAdapter.summarize).toBe(summarizeTaskChange);
    const p = taskAdapter.projectBody(taskCanonical({ name: "Z" }));
    expect(p.body).toContain("# Z");
  });
});
