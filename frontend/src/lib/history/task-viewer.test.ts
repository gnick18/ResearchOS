// VC Phase 3 (VC-Phase3-Task sub-bot of HR, 2026-05-31): unit tests for the
// Task viewer adapter. task-viewer.ts projects a reconstructed canonical Task
// state to a diffable body + summarizes a change into a row label. These pin the
// projection (name + deviation_log + the per-variant content: per-method prose
// for experiments, sub_tasks for lists), the tolerance to malformed input, and
// the task_type-aware one-line summary precedence.
//
// task-viewer-polish sub-bot of HR (2026-05-31): version history is live for ALL
// three task_type variants, so the list / purchase cases below pin that a list
// edit diffs its sub_tasks and a purchase edit diffs name + notes, each with the
// right summary noun. The experiment cases stay byte-for-byte as the regression
// canary (an absent task_type projects as "experiment").
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
  task_type?: "experiment" | "list" | "purchase";
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
  sub_tasks?: { id: string; text: string; is_complete?: boolean }[];
}): string {
  const record: Record<string, unknown> = {
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
  };
  // Only stamp the new fields when the case opts in, so the experiment cases
  // serialize byte-for-byte as before (absent task_type projects as experiment).
  if (fields.task_type !== undefined) record.task_type = fields.task_type;
  if (fields.sub_tasks !== undefined) {
    record.sub_tasks = fields.sub_tasks.map((s) => ({
      id: s.id,
      text: s.text,
      is_complete: s.is_complete ?? false,
    }));
  }
  return canonicalize(record);
}

describe("projectTaskState", () => {
  it("projects an empty / malformed canonical to all-empty fields", () => {
    for (const bad of [null, undefined, "", "   ", "{not json"]) {
      const p = projectTaskState(bad);
      expect(p.taskType).toBe("experiment");
      expect(p.name).toBe("");
      expect(p.deviationLog).toBe("");
      expect(p.methods).toEqual([]);
      expect(p.subTasks).toEqual([]);
      expect(p.body).toBe("");
      expect(p.isComplete).toBe(false);
    }
  });

  it("defaults an absent task_type to 'experiment' so the pilot canonicals project unchanged", () => {
    const p = projectTaskState(taskCanonical({ name: "Legacy" }));
    expect(p.taskType).toBe("experiment");
    expect(p.subTasks).toEqual([]);
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

  it("projects a list task's sub_tasks (text + checked state) into the diff body", () => {
    const p = projectTaskState(
      taskCanonical({
        task_type: "list",
        name: "Reagent restock",
        deviation_log: "Reorder the Taq before Friday.",
        sub_tasks: [
          { id: "a", text: "Order Taq polymerase", is_complete: true },
          { id: "b", text: "Aliquot dNTPs", is_complete: false },
        ],
      }),
    );
    expect(p.taskType).toBe("list");
    expect(p.subTasks).toHaveLength(2);
    expect(p.subTasks[0]).toMatchObject({
      id: "a",
      text: "Order Taq polymerase",
      isComplete: true,
    });
    // The body carries the common name + notes PLUS the sub-task checklist so a
    // sub-task edit (the real list content) renders a non-empty localized diff.
    expect(p.body).toContain("# Reagent restock");
    expect(p.body).toContain("Reorder the Taq before Friday.");
    expect(p.body).toContain("## Sub-tasks");
    expect(p.body).toContain("- [x] Order Taq polymerase");
    expect(p.body).toContain("- [ ] Aliquot dNTPs");
    // A list task does not surface the experiment-only method anchoring.
    expect(p.body).not.toContain("## Method");
  });

  it("projects a purchase task's task-level fields (name + notes) into the diff body", () => {
    const p = projectTaskState(
      taskCanonical({
        task_type: "purchase",
        name: "Antibody order",
        deviation_log: "Switch vendor: backorder on the primary.",
      }),
    );
    expect(p.taskType).toBe("purchase");
    // Purchase line items are separate PurchaseItem entities, so the task record
    // itself only carries name + deviation_log content for the body.
    expect(p.subTasks).toEqual([]);
    expect(p.methods).toEqual([]);
    expect(p.body).toContain("# Antibody order");
    expect(p.body).toContain("Switch vendor: backorder on the primary.");
    expect(p.body).not.toContain("## Method");
    expect(p.body).not.toContain("## Sub-tasks");
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

  it("uses task_type-aware nouns for create / rename / fallback", () => {
    const listBase = projectTaskState(taskCanonical({ task_type: "list", name: "A" }));
    expect(summarizeTaskChange(null, listBase)).toBe("created list");
    const listRenamed = projectTaskState(
      taskCanonical({ task_type: "list", name: "B" }),
    );
    expect(summarizeTaskChange(listBase, listRenamed)).toBe("renamed list");
    expect(summarizeTaskChange(listBase, listBase)).toBe("edited list");

    const purchaseBase = projectTaskState(
      taskCanonical({ task_type: "purchase", name: "A" }),
    );
    expect(summarizeTaskChange(null, purchaseBase)).toBe("created purchase");
    const purchaseRenamed = projectTaskState(
      taskCanonical({ task_type: "purchase", name: "B" }),
    );
    expect(summarizeTaskChange(purchaseBase, purchaseRenamed)).toBe(
      "renamed purchase",
    );
    expect(summarizeTaskChange(purchaseBase, purchaseBase)).toBe(
      "edited purchase",
    );
  });

  it("drops the 'lab' qualifier on the notes label outside experiments", () => {
    const purchaseBase = projectTaskState(
      taskCanonical({ task_type: "purchase", name: "A" }),
    );
    const purchaseNotes = projectTaskState(
      taskCanonical({
        task_type: "purchase",
        name: "A",
        deviation_log: "Vendor backordered.",
      }),
    );
    // Experiments keep "edited lab notes"; a purchase / list reads "edited notes".
    expect(summarizeTaskChange(purchaseBase, purchaseNotes)).toBe("edited notes");

    const listBase = projectTaskState(
      taskCanonical({ task_type: "list", name: "A" }),
    );
    const listNotes = projectTaskState(
      taskCanonical({
        task_type: "list",
        name: "A",
        deviation_log: "Check stock first.",
      }),
    );
    expect(summarizeTaskChange(listBase, listNotes)).toBe("edited notes");
  });

  it("summarizes list sub-task add / remove / toggle / edit", () => {
    const one = projectTaskState(
      taskCanonical({
        task_type: "list",
        name: "A",
        sub_tasks: [{ id: "a", text: "Order Taq" }],
      }),
    );
    const two = projectTaskState(
      taskCanonical({
        task_type: "list",
        name: "A",
        sub_tasks: [
          { id: "a", text: "Order Taq" },
          { id: "b", text: "Aliquot dNTPs" },
        ],
      }),
    );
    expect(summarizeTaskChange(one, two)).toBe("added a sub-task");
    expect(summarizeTaskChange(two, one)).toBe("removed a sub-task");

    const checked = projectTaskState(
      taskCanonical({
        task_type: "list",
        name: "A",
        sub_tasks: [{ id: "a", text: "Order Taq", is_complete: true }],
      }),
    );
    expect(summarizeTaskChange(one, checked)).toBe("checked off a sub-task");
    expect(summarizeTaskChange(checked, one)).toBe("reopened a sub-task");

    const renamedSub = projectTaskState(
      taskCanonical({
        task_type: "list",
        name: "A",
        sub_tasks: [{ id: "a", text: "Order Taq polymerase" }],
      }),
    );
    expect(summarizeTaskChange(one, renamedSub)).toBe("edited a sub-task");
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
