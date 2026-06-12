/**
 * Folded column-transform parity tests (wrangle-2 phase 2, chunk 1).
 *
 * The five Prism column transforms (transform / normalize / transpose /
 * remove-baseline / fraction-of-total) now also exist as TransformOp variants
 * that the pipeline engine runs by DELEGATING to the pure functions in
 * transforms.ts. This file asserts the contract that makes phase 2 safe, that
 * running a folded op through the pipeline engine produces the SAME table
 * (columns, rows, table_type) as calling the standalone transforms.ts function
 * directly. If those ever diverge, a legacy single-op derived table would not
 * recompute byte-identically after chunk 2 widens the recipe.
 *
 * House voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import { describe, it, expect } from "vitest";
import { executePipeline } from "../engine";
import type { TransformOp } from "../pipeline";
import {
  transformValues,
  normalize,
  transpose,
  removeBaseline,
  fractionOfTotal,
} from "@/lib/datahub/transforms";
import type {
  DataHubDocContent,
  ColumnDef,
  CellValue,
} from "@/lib/datahub/model/types";

// ---------------------------------------------------------------------------
// Fixtures with real column roles (the folded ops are role-aware)
// ---------------------------------------------------------------------------

/** A Column-style table: two y data columns down the rows. */
function columnTable(): DataHubDocContent {
  const columns: ColumnDef[] = [
    { id: "y1", name: "Control", role: "y", dataType: "number" },
    { id: "y2", name: "Treated", role: "y", dataType: "number" },
  ];
  const data: Record<string, CellValue>[] = [
    { y1: 10, y2: 4 },
    { y1: 20, y2: 8 },
    { y1: 40, y2: 16 },
  ];
  return {
    meta: {
      id: "src",
      name: "src",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    columns,
    rows: data.map((r, i) => ({ id: `row-${i + 1}`, cells: { ...r } })),
    analyses: [],
    plots: [],
  };
}

/** An XY-style table: an x label axis plus one y data column. The x column must
 *  be carried through unchanged by transform / normalize / fraction-of-total. */
function xyTable(): DataHubDocContent {
  const columns: ColumnDef[] = [
    { id: "x1", name: "Dose", role: "x", dataType: "number" },
    { id: "y1", name: "Response", role: "y", dataType: "number" },
  ];
  const data: Record<string, CellValue>[] = [
    { x1: 1, y1: 2 },
    { x1: 2, y1: 8 },
    { x1: 3, y1: 10 },
  ];
  return {
    meta: {
      id: "xy",
      name: "xy",
      project_ids: [],
      folder_path: null,
      table_type: "xy",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    columns,
    rows: data.map((r, i) => ({ id: `row-${i + 1}`, cells: { ...r } })),
    analyses: [],
    plots: [],
  };
}

/** Compare only the data body the recompute path keeps (columns + rows +
 *  table_type). Meta id / name / timestamps are engine-minted and not compared. */
function expectSameBody(a: DataHubDocContent, b: DataHubDocContent) {
  expect(a.columns).toEqual(b.columns);
  expect(a.rows).toEqual(b.rows);
  expect(a.meta.table_type).toBe(b.meta.table_type);
}

function runOne(source: DataHubDocContent, op: TransformOp): DataHubDocContent {
  const result = executePipeline(source, { ops: [op] }, new Map());
  if ("error" in result) throw new Error(result.error);
  return result.content;
}

// ---------------------------------------------------------------------------
// One folded op == one direct transforms.ts call
// ---------------------------------------------------------------------------

describe("folded column transforms run through the pipeline engine", () => {
  it("column-transform (log10) equals transformValues", () => {
    const src = columnTable();
    const direct = transformValues(src, { func: "log10" });
    const piped = runOne(src, { kind: "column-transform", params: { func: "log10" } });
    expectSameBody(piped, direct);
  });

  it("column-transform (linear y*k+b) equals transformValues, x carried through", () => {
    const src = xyTable();
    const params = { func: "linear" as const, k: 2, b: 1 };
    const direct = transformValues(src, params);
    const piped = runOne(src, { kind: "column-transform", params });
    expectSameBody(piped, direct);
    // The x column survives unchanged through the folded op.
    expect(piped.columns.find((c) => c.role === "x")?.name).toBe("Dose");
  });

  it("normalize (max) equals normalize", () => {
    const src = columnTable();
    const direct = normalize(src, { mode: "max" });
    const piped = runOne(src, { kind: "normalize", params: { mode: "max" } });
    expectSameBody(piped, direct);
  });

  it("normalize (minMax) equals normalize on the xy table", () => {
    const src = xyTable();
    const direct = normalize(src, { mode: "minMax" });
    const piped = runOne(src, { kind: "normalize", params: { mode: "minMax" } });
    expectSameBody(piped, direct);
  });

  it("transpose equals transpose, including the flipped archetype", () => {
    const src = columnTable();
    const direct = transpose(src, {});
    const piped = runOne(src, { kind: "transpose", params: {} });
    expectSameBody(piped, direct);
    // transpose keeps table_type "column" but rebuilds columns (a label axis plus
    // one column per old row), so the body equality above is the real assertion.
    expect(piped.meta.table_type).toBe("column");
  });

  it("remove-baseline (firstRow) equals removeBaseline", () => {
    const src = columnTable();
    const direct = removeBaseline(src, { mode: "firstRow" });
    const piped = runOne(src, { kind: "remove-baseline", params: { mode: "firstRow" } });
    expectSameBody(piped, direct);
  });

  it("remove-baseline (column) equals removeBaseline, dropped baseline column", () => {
    const src = columnTable();
    const direct = removeBaseline(src, { mode: "column", baselineColumnId: "y2" });
    const piped = runOne(src, {
      kind: "remove-baseline",
      params: { mode: "column", baselineColumnId: "y2" },
    });
    expectSameBody(piped, direct);
    // The chosen baseline column is gone from both.
    expect(piped.columns.some((c) => c.id === "y2")).toBe(false);
  });

  it("fraction-of-total (column, percent) equals fractionOfTotal", () => {
    const src = columnTable();
    const direct = fractionOfTotal(src, { scope: "column", asPercent: true });
    const piped = runOne(src, {
      kind: "fraction-of-total",
      params: { scope: "column", asPercent: true },
    });
    expectSameBody(piped, direct);
  });

  it("fraction-of-total (grand) equals fractionOfTotal", () => {
    const src = columnTable();
    const direct = fractionOfTotal(src, { scope: "grand" });
    const piped = runOne(src, { kind: "fraction-of-total", params: { scope: "grand" } });
    expectSameBody(piped, direct);
  });
});

// ---------------------------------------------------------------------------
// Folded ops compose AFTER a relational op (the reshaped, no-content path)
// ---------------------------------------------------------------------------

describe("folded column transforms compose after a relational op", () => {
  it("filter then normalize runs, normalizing the filtered rows", () => {
    const src = columnTable();
    // Keep only rows where Control >= 20, then normalize to the column max.
    const result = executePipeline(
      src,
      {
        ops: [
          {
            kind: "filter",
            node: {
              type: "condition",
              condition: { column: "Control", op: "ge", value: 20 },
            },
          },
          { kind: "normalize", params: { mode: "max" } },
        ],
      },
      new Map(),
    );
    if ("error" in result) throw new Error(result.error);
    const byName = (n: string) => result.content.columns.find((c) => c.name === n);
    const controlId = byName("Control")!.id;
    const treatedId = byName("Treated")!.id;
    // Two rows survived (20/40 and 8/16). Normalize to column max (40 and 16)
    // yields 50 and 100 percent for each column.
    expect(result.content.rows.map((r) => r.cells[controlId])).toEqual([50, 100]);
    expect(result.content.rows.map((r) => r.cells[treatedId])).toEqual([50, 100]);
  });
});
