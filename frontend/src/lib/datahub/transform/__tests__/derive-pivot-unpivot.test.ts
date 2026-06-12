/**
 * Worked-example unit tests for the three foundation-1b transform ops
 * (derive, pivot, unpivot). These check the engine's own contract (domain
 * guards, collision behavior, default value variables, row order) with small
 * hand-built tables. The pandas EQUALITY gate for these ops lives in
 * transform.gate.test.ts; this file covers the edge cases pandas does not, such
 * as the derive null-on-bad-input guard and the pivot collision policy.
 *
 * House voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import { describe, it, expect } from "vitest";
import { executePipeline } from "../engine";
import type { DataHubDocContent, ColumnDef, CellValue } from "@/lib/datahub/model/types";
import type { TransformPipeline } from "../pipeline";

// ---------------------------------------------------------------------------
// Tiny table builder
// ---------------------------------------------------------------------------

function makeTable(
  columns: { name: string; type: "number" | "text" }[],
  rows: Record<string, CellValue>[],
): DataHubDocContent {
  const colDefs: ColumnDef[] = columns.map((c, i) => ({
    id: `c${i + 1}`,
    name: c.name,
    role: "y",
    dataType: c.type,
  }));
  const nameToId = new Map(colDefs.map((c) => [c.name, c.id]));
  return {
    meta: {
      id: "t",
      name: "t",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    columns: colDefs,
    rows: rows.map((r, i) => {
      const cells: Record<string, CellValue> = {};
      for (const c of colDefs) cells[c.id] = r[c.name] ?? null;
      return { id: `r${i + 1}`, cells };
    }),
    analyses: [],
    plots: [],
  };
}

/** Pull the result into a plain list-of-records keyed by column name. */
function toRecords(result: ReturnType<typeof executePipeline>): {
  columns: string[];
  rows: Record<string, CellValue>[];
} {
  if ("error" in result) throw new Error(result.error);
  const content = result.content;
  const cols = content.columns.map((c) => c.name);
  const rows = content.rows.map((row) => {
    const r: Record<string, CellValue> = {};
    for (const c of content.columns) r[c.name] = row.cells[c.id] ?? null;
    return r;
  });
  return { columns: cols, rows };
}

// ---------------------------------------------------------------------------
// derive
// ---------------------------------------------------------------------------

describe("derive (engine contract)", () => {
  const table = makeTable(
    [
      { name: "a", type: "number" },
      { name: "b", type: "number" },
      { name: "c", type: "number" },
    ],
    [
      { a: 1, b: 2, c: 3 },
      { a: 4, b: 5, c: 6 },
      { a: 7, b: 8, c: 9 },
    ],
  );

  it("appends a new column from a basic arithmetic formula", () => {
    const pipeline: TransformPipeline = {
      ops: [{ kind: "derive", outputName: "sum_ab", formula: "a + b" }],
    };
    const out = toRecords(executePipeline(table, pipeline, new Map()));
    expect(out.columns).toEqual(["a", "b", "c", "sum_ab"]);
    expect(out.rows.map((r) => r.sum_ab)).toEqual([3, 9, 15]);
  });

  it("handles a multi-operator formula (a * 2 - c)", () => {
    const pipeline: TransformPipeline = {
      ops: [{ kind: "derive", outputName: "d", formula: "a * 2 - c" }],
    };
    const out = toRecords(executePipeline(table, pipeline, new Map()));
    expect(out.rows.map((r) => r.d)).toEqual([-1, 2, 5]);
  });

  it("yields null for a row whose referenced cell is missing", () => {
    const t = makeTable(
      [
        { name: "a", type: "number" },
        { name: "b", type: "number" },
      ],
      [
        { a: 1, b: 2 },
        { a: 3, b: null },
        { a: 5, b: 6 },
      ],
    );
    const pipeline: TransformPipeline = {
      ops: [{ kind: "derive", outputName: "p", formula: "a + b" }],
    };
    const out = toRecords(executePipeline(t, pipeline, new Map()));
    expect(out.rows.map((r) => r.p)).toEqual([3, null, 11]);
  });

  it("yields null when the formula divides into a non-finite number", () => {
    const t = makeTable(
      [
        { name: "a", type: "number" },
        { name: "b", type: "number" },
      ],
      [
        { a: 6, b: 2 },
        { a: 5, b: 0 }, // 5 / 0 -> Infinity -> null
      ],
    );
    const pipeline: TransformPipeline = {
      ops: [{ kind: "derive", outputName: "q", formula: "a / b" }],
    };
    const out = toRecords(executePipeline(t, pipeline, new Map()));
    expect(out.rows.map((r) => r.q)).toEqual([3, null]);
  });

  it("coerces numeric-string cells before arithmetic", () => {
    const t = makeTable(
      [
        { name: "a", type: "text" },
        { name: "b", type: "text" },
      ],
      [
        { a: "2", b: "3" },
        { a: "10", b: "5" },
      ],
    );
    const pipeline: TransformPipeline = {
      ops: [{ kind: "derive", outputName: "s", formula: "a + b" }],
    };
    const out = toRecords(executePipeline(t, pipeline, new Map()));
    expect(out.rows.map((r) => r.s)).toEqual([5, 15]);
  });

  it("returns an error on an empty outputName", () => {
    const pipeline: TransformPipeline = {
      ops: [{ kind: "derive", outputName: "", formula: "a + b" }],
    };
    expect("error" in executePipeline(table, pipeline, new Map())).toBe(true);
  });

  it("returns an error on an empty formula", () => {
    const pipeline: TransformPipeline = {
      ops: [{ kind: "derive", outputName: "x", formula: "  " }],
    };
    expect("error" in executePipeline(table, pipeline, new Map())).toBe(true);
  });

  it("does not crash on a malformed formula (yields all nulls)", () => {
    const pipeline: TransformPipeline = {
      ops: [{ kind: "derive", outputName: "bad", formula: "a +" }],
    };
    const out = toRecords(executePipeline(table, pipeline, new Map()));
    expect(out.rows.map((r) => r.bad)).toEqual([null, null, null]);
  });

  it("composes after a filter in a chain", () => {
    const pipeline: TransformPipeline = {
      ops: [
        { kind: "filter", node: { type: "condition", condition: { column: "a", op: "gt", value: 1 } } },
        { kind: "derive", outputName: "ab", formula: "a + b" },
      ],
    };
    const out = toRecords(executePipeline(table, pipeline, new Map()));
    expect(out.rows.map((r) => r.ab)).toEqual([9, 15]);
  });
});

// ---------------------------------------------------------------------------
// pivot
// ---------------------------------------------------------------------------

describe("pivot (engine contract)", () => {
  it("spreads a key column into sorted new columns (no collision)", () => {
    const t = makeTable(
      [
        { name: "sample", type: "text" },
        { name: "gene", type: "text" },
        { name: "level", type: "number" },
      ],
      [
        { sample: "S1", gene: "actin", level: 10 },
        { sample: "S1", gene: "tubulin", level: 20 },
        { sample: "S2", gene: "actin", level: 30 },
        { sample: "S2", gene: "tubulin", level: 40 },
      ],
    );
    const pipeline: TransformPipeline = {
      ops: [{ kind: "pivot", index: ["sample"], columns: "gene", values: "level" }],
    };
    const out = toRecords(executePipeline(t, pipeline, new Map()));
    // gene values sorted ascending: actin, tubulin
    expect(out.columns).toEqual(["sample", "actin", "tubulin"]);
    expect(out.rows).toEqual([
      { sample: "S1", actin: 10, tubulin: 20 },
      { sample: "S2", actin: 30, tubulin: 40 },
    ]);
  });

  it("fills missing (index, key) combinations with null", () => {
    const t = makeTable(
      [
        { name: "sample", type: "text" },
        { name: "gene", type: "text" },
        { name: "level", type: "number" },
      ],
      [
        { sample: "S1", gene: "actin", level: 10 },
        { sample: "S2", gene: "tubulin", level: 40 },
      ],
    );
    const pipeline: TransformPipeline = {
      ops: [{ kind: "pivot", index: ["sample"], columns: "gene", values: "level" }],
    };
    const out = toRecords(executePipeline(t, pipeline, new Map()));
    expect(out.columns).toEqual(["sample", "actin", "tubulin"]);
    expect(out.rows).toEqual([
      { sample: "S1", actin: 10, tubulin: null },
      { sample: "S2", actin: null, tubulin: 40 },
    ]);
  });

  it("aggregates a duplicate (index, key) collision with mean", () => {
    const t = makeTable(
      [
        { name: "sample", type: "text" },
        { name: "gene", type: "text" },
        { name: "level", type: "number" },
      ],
      [
        { sample: "S1", gene: "actin", level: 10 },
        { sample: "S1", gene: "actin", level: 30 }, // collision with the row above
        { sample: "S1", gene: "tubulin", level: 20 },
      ],
    );
    const pipeline: TransformPipeline = {
      ops: [{ kind: "pivot", index: ["sample"], columns: "gene", values: "level" }],
    };
    const out = toRecords(executePipeline(t, pipeline, new Map()));
    // actin collides: mean(10, 30) = 20
    expect(out.rows).toEqual([{ sample: "S1", actin: 20, tubulin: 20 }]);
  });

  it("sorts numeric key columns numerically, not lexically", () => {
    const t = makeTable(
      [
        { name: "g", type: "text" },
        { name: "k", type: "number" },
        { name: "v", type: "number" },
      ],
      [
        { g: "A", k: 2, v: 1 },
        { g: "A", k: 10, v: 2 },
        { g: "A", k: 1, v: 3 },
      ],
    );
    const pipeline: TransformPipeline = {
      ops: [{ kind: "pivot", index: ["g"], columns: "k", values: "v" }],
    };
    const out = toRecords(executePipeline(t, pipeline, new Map()));
    expect(out.columns).toEqual(["g", "1", "2", "10"]);
  });

  it("returns an error on a missing index column", () => {
    const t = makeTable(
      [
        { name: "a", type: "text" },
        { name: "k", type: "text" },
        { name: "v", type: "number" },
      ],
      [{ a: "x", k: "p", v: 1 }],
    );
    const pipeline: TransformPipeline = {
      ops: [{ kind: "pivot", index: ["missing"], columns: "k", values: "v" }],
    };
    expect("error" in executePipeline(t, pipeline, new Map())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// unpivot
// ---------------------------------------------------------------------------

describe("unpivot (engine contract)", () => {
  const wide = makeTable(
    [
      { name: "sample", type: "text" },
      { name: "actin", type: "number" },
      { name: "tubulin", type: "number" },
    ],
    [
      { sample: "S1", actin: 10, tubulin: 20 },
      { sample: "S2", actin: 30, tubulin: 40 },
    ],
  );

  it("gathers explicit value columns in melt row order (by variable then row)", () => {
    const pipeline: TransformPipeline = {
      ops: [{
        kind: "unpivot",
        idVars: ["sample"],
        valueVars: ["actin", "tubulin"],
        varName: "gene",
        valueName: "level",
      }],
    };
    const out = toRecords(executePipeline(wide, pipeline, new Map()));
    expect(out.columns).toEqual(["sample", "gene", "level"]);
    expect(out.rows).toEqual([
      { sample: "S1", gene: "actin", level: 10 },
      { sample: "S2", gene: "actin", level: 30 },
      { sample: "S1", gene: "tubulin", level: 20 },
      { sample: "S2", gene: "tubulin", level: 40 },
    ]);
  });

  it("defaults valueVars to all non-id columns, in table order", () => {
    const pipeline: TransformPipeline = {
      ops: [{ kind: "unpivot", idVars: ["sample"] }],
    };
    const out = toRecords(executePipeline(wide, pipeline, new Map()));
    expect(out.columns).toEqual(["sample", "variable", "value"]);
    expect(out.rows).toEqual([
      { sample: "S1", variable: "actin", value: 10 },
      { sample: "S2", variable: "actin", value: 30 },
      { sample: "S1", variable: "tubulin", value: 20 },
      { sample: "S2", variable: "tubulin", value: 40 },
    ]);
  });

  it("defaults varName and valueName to variable / value", () => {
    const pipeline: TransformPipeline = {
      ops: [{ kind: "unpivot", idVars: ["sample"], valueVars: ["actin"] }],
    };
    const out = toRecords(executePipeline(wide, pipeline, new Map()));
    expect(out.columns).toEqual(["sample", "variable", "value"]);
  });

  it("carries null cells through as null", () => {
    const t = makeTable(
      [
        { name: "id", type: "text" },
        { name: "x", type: "number" },
      ],
      [
        { id: "A", x: null },
        { id: "B", x: 5 },
      ],
    );
    const pipeline: TransformPipeline = {
      ops: [{ kind: "unpivot", idVars: ["id"], valueVars: ["x"] }],
    };
    const out = toRecords(executePipeline(t, pipeline, new Map()));
    expect(out.rows).toEqual([
      { id: "A", variable: "x", value: null },
      { id: "B", variable: "x", value: 5 },
    ]);
  });

  it("returns an error on a missing id column", () => {
    const pipeline: TransformPipeline = {
      ops: [{ kind: "unpivot", idVars: ["missing"], valueVars: ["actin"] }],
    };
    expect("error" in executePipeline(wide, pipeline, new Map())).toBe(true);
  });

  it("round-trips with pivot (unpivot then pivot restores the wide table)", () => {
    const pipeline: TransformPipeline = {
      ops: [
        { kind: "unpivot", idVars: ["sample"], valueVars: ["actin", "tubulin"], varName: "gene", valueName: "level" },
        { kind: "pivot", index: ["sample"], columns: "gene", values: "level" },
      ],
    };
    const out = toRecords(executePipeline(wide, pipeline, new Map()));
    expect(out.columns).toEqual(["sample", "actin", "tubulin"]);
    expect(out.rows).toEqual([
      { sample: "S1", actin: 10, tubulin: 20 },
      { sample: "S2", actin: 30, tubulin: 40 },
    ]);
  });
});
