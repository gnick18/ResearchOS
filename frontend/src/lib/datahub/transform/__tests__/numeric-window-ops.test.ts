/**
 * Unit tests for the Phase 2b-2 transform ops (numeric, window, filter helpers,
 * and summarize): clip, round, bin, map, rank, cumulative, lag, rolling, isin,
 * between, topn, sample, value_counts, describe, crosstab, pivot_table.
 *
 * Each op is checked three ways, matching the spec rule that a rule reads
 * identically at any size:
 *   - JS engine result (executePipeline over a small hand-built table),
 *   - pandas codegen (transformOpToPandas string),
 *   - DuckDB SQL codegen (transformOpToSql string).
 *
 * crosstab, pivot_table, and quantile binning are data-dependent in their spread
 * shape, so they run on the JS engine and emit a pass-through SQL note. Those
 * tests assert the JS result and that the SQL string carries the note.
 *
 * House voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import { describe, it, expect } from "vitest";
import { executePipeline } from "../engine";
import { transformOpToPandas } from "../codegen";
import { transformOpToSql } from "../sql-codegen";
import type { DataHubDocContent, ColumnDef, CellValue } from "@/lib/datahub/model/types";
import type { TransformOp, TransformPipeline } from "../pipeline";

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
      const byId: Record<string, CellValue> = {};
      for (const c of colDefs) byId[c.id] = r[c.name] ?? null;
      return { id: `r${i + 1}`, cells: byId };
    }),
    analyses: [],
    plots: [],
  };
}

function run(table: DataHubDocContent, ops: TransformOp[]) {
  const pipeline: TransformPipeline = { ops };
  const result = executePipeline(table, pipeline, new Map());
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

const ctx = (cols: string[] = []) => ({ from: "__step0", columnNames: cols });

// ---------------------------------------------------------------------------
// clip
// ---------------------------------------------------------------------------

describe("clip", () => {
  const table = makeTable([{ name: "x", type: "number" }], [{ x: -5 }, { x: 0.5 }, { x: 99 }, { x: null }]);

  it("JS clamps to the bounds and leaves empties empty", () => {
    const op: TransformOp = { kind: "clip", column: "x", lower: 0, upper: 1 };
    expect(run(table, [op]).rows.map((r) => r.x)).toEqual([0, 0.5, 1, null]);
  });

  it("pandas + SQL", () => {
    const op: TransformOp = { kind: "clip", column: "x", lower: 0, upper: 1 };
    expect(transformOpToPandas(op).code).toContain(".clip(lower=0, upper=1)");
    const sql = transformOpToSql(op, ctx(["x"]));
    expect(sql).toContain("greatest");
    expect(sql).toContain("least");
  });
});

// ---------------------------------------------------------------------------
// round
// ---------------------------------------------------------------------------

describe("round", () => {
  const table = makeTable([{ name: "x", type: "number" }], [{ x: 1.2345 }, { x: 2.5 }, { x: null }]);

  it("JS rounds to decimals", () => {
    const op: TransformOp = { kind: "round", column: "x", decimals: 2 };
    expect(run(table, [op]).rows.map((r) => r.x)).toEqual([1.23, 2.5, null]);
  });

  it("pandas + SQL", () => {
    const op: TransformOp = { kind: "round", column: "x", decimals: 2 };
    expect(transformOpToPandas(op).code).toContain(".round(2)");
    expect(transformOpToSql(op, ctx(["x"]))).toContain("round(");
  });
});

// ---------------------------------------------------------------------------
// bin
// ---------------------------------------------------------------------------

describe("bin", () => {
  const table = makeTable(
    [{ name: "x", type: "number" }],
    [{ x: 5 }, { x: 15 }, { x: 25 }, { x: null }],
  );

  it("JS ranges bin with explicit edges and labels", () => {
    const op: TransformOp = {
      kind: "bin",
      column: "x",
      mode: "ranges",
      edges: [0, 10, 20, 30],
      labels: ["low", "mid", "high"],
      outputName: "band",
    };
    const out = run(table, [op]);
    expect(out.columns).toContain("band");
    expect(out.rows.map((r) => r.band)).toEqual(["low", "mid", "high", null]);
  });

  it("JS quantile bin splits into equal-frequency buckets", () => {
    const t = makeTable(
      [{ name: "x", type: "number" }],
      [{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }],
    );
    const op: TransformOp = { kind: "bin", column: "x", mode: "quantiles", quantiles: 2, outputName: "q" };
    const out = run(t, [op]);
    expect(out.rows.map((r) => r.q)).toEqual(["Q1", "Q1", "Q2", "Q2"]);
  });

  it("pandas ranges + SQL CASE WHEN", () => {
    const op: TransformOp = {
      kind: "bin",
      column: "x",
      mode: "ranges",
      edges: [0, 10, 20],
      outputName: "band",
    };
    expect(transformOpToPandas(op).code).toContain("pd.cut");
    expect(transformOpToSql(op, ctx(["x"]))).toContain("CASE");
  });

  it("quantile bin emits a JS-engine SQL note", () => {
    const op: TransformOp = { kind: "bin", column: "x", mode: "quantiles", quantiles: 4, outputName: "q" };
    expect(transformOpToPandas(op).code).toContain("pd.qcut");
    expect(transformOpToSql(op, ctx(["x"]))).toContain("runs on the JS engine");
  });
});

// ---------------------------------------------------------------------------
// map
// ---------------------------------------------------------------------------

describe("map", () => {
  const table = makeTable([{ name: "g", type: "text" }], [{ g: "WT" }, { g: "mut" }, { g: "other" }]);

  it("JS replaces matched keys, keeps the rest", () => {
    const op: TransformOp = {
      kind: "map",
      column: "g",
      mapping: [
        { from: "WT", to: "wildtype" },
        { from: "mut", to: "mutant" },
      ],
    };
    expect(run(table, [op]).rows.map((r) => r.g)).toEqual(["wildtype", "mutant", "other"]);
  });

  it("JS fallback replaces unmatched cells", () => {
    const op: TransformOp = {
      kind: "map",
      column: "g",
      mapping: [{ from: "WT", to: "wildtype" }],
      fallback: "unknown",
    };
    expect(run(table, [op]).rows.map((r) => r.g)).toEqual(["wildtype", "unknown", "unknown"]);
  });

  it("pandas + SQL", () => {
    const op: TransformOp = { kind: "map", column: "g", mapping: [{ from: "WT", to: "wildtype" }] };
    expect(transformOpToPandas(op).code).toContain(".replace(");
    expect(transformOpToSql(op, ctx(["g"]))).toContain("CASE WHEN");
  });
});

// ---------------------------------------------------------------------------
// rank
// ---------------------------------------------------------------------------

describe("rank", () => {
  const table = makeTable([{ name: "x", type: "number" }], [{ x: 10 }, { x: 30 }, { x: 20 }, { x: 30 }]);

  it("JS descending min rank handles ties", () => {
    const op: TransformOp = { kind: "rank", column: "x", ascending: false, method: "min", outputName: "r" };
    // 30 ties at rank 1, 20 -> 3, 10 -> 4
    expect(run(table, [op]).rows.map((r) => r.r)).toEqual([4, 1, 3, 1]);
  });

  it("JS dense rank gives no gaps", () => {
    const op: TransformOp = { kind: "rank", column: "x", ascending: false, method: "dense", outputName: "r" };
    // distinct desc: 30->1, 20->2, 10->3
    expect(run(table, [op]).rows.map((r) => r.r)).toEqual([3, 1, 2, 1]);
  });

  it("pandas + SQL", () => {
    const op: TransformOp = { kind: "rank", column: "x", ascending: true, method: "dense", outputName: "r" };
    expect(transformOpToPandas(op).code).toContain(".rank(");
    expect(transformOpToSql(op, ctx(["x"]))).toContain("dense_rank() OVER");
  });
});

// ---------------------------------------------------------------------------
// cumulative
// ---------------------------------------------------------------------------

describe("cumulative", () => {
  const table = makeTable([{ name: "x", type: "number" }], [{ x: 1 }, { x: 2 }, { x: 3 }]);

  it("JS running sum", () => {
    const op: TransformOp = { kind: "cumulative", column: "x", func: "sum", outputName: "cs" };
    expect(run(table, [op]).rows.map((r) => r.cs)).toEqual([1, 3, 6]);
  });

  it("JS running max", () => {
    const t = makeTable([{ name: "x", type: "number" }], [{ x: 3 }, { x: 1 }, { x: 5 }]);
    const op: TransformOp = { kind: "cumulative", column: "x", func: "max", outputName: "cm" };
    expect(run(t, [op]).rows.map((r) => r.cm)).toEqual([3, 3, 5]);
  });

  it("pandas + SQL", () => {
    const op: TransformOp = { kind: "cumulative", column: "x", func: "sum", outputName: "cs" };
    expect(transformOpToPandas(op).code).toContain(".cumsum()");
    expect(transformOpToSql(op, ctx(["x"]))).toContain("UNBOUNDED PRECEDING AND CURRENT ROW");
  });
});

// ---------------------------------------------------------------------------
// lag
// ---------------------------------------------------------------------------

describe("lag", () => {
  const table = makeTable([{ name: "x", type: "number" }], [{ x: 10 }, { x: 12 }, { x: 15 }]);

  it("JS shift by 1", () => {
    const op: TransformOp = { kind: "lag", column: "x", mode: "shift", periods: 1, outputName: "p" };
    expect(run(table, [op]).rows.map((r) => r.p)).toEqual([null, 10, 12]);
  });

  it("JS diff by 1", () => {
    const op: TransformOp = { kind: "lag", column: "x", mode: "diff", periods: 1, outputName: "d" };
    expect(run(table, [op]).rows.map((r) => r.d)).toEqual([null, 2, 3]);
  });

  it("JS pct_change", () => {
    const op: TransformOp = { kind: "lag", column: "x", mode: "pct_change", periods: 1, outputName: "pc" };
    expect(run(table, [op]).rows.map((r) => r.pc)).toEqual([null, 0.2, 0.25]);
  });

  it("pandas + SQL", () => {
    const op: TransformOp = { kind: "lag", column: "x", mode: "diff", periods: 1, outputName: "d" };
    expect(transformOpToPandas(op).code).toContain(".diff(1)");
    expect(transformOpToSql(op, ctx(["x"]))).toContain("lag(");
  });
});

// ---------------------------------------------------------------------------
// rolling
// ---------------------------------------------------------------------------

describe("rolling", () => {
  const table = makeTable(
    [{ name: "x", type: "number" }],
    [{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }],
  );

  it("JS rolling mean over a 2-row window", () => {
    const op: TransformOp = { kind: "rolling", column: "x", size: 2, func: "mean", outputName: "rm" };
    expect(run(table, [op]).rows.map((r) => r.rm)).toEqual([null, 1.5, 2.5, 3.5]);
  });

  it("pandas + SQL", () => {
    const op: TransformOp = { kind: "rolling", column: "x", size: 3, func: "sum", outputName: "rs" };
    expect(transformOpToPandas(op).code).toContain(".rolling(3).sum()");
    const sql = transformOpToSql(op, ctx(["x"]));
    expect(sql).toContain("ROWS BETWEEN 2 PRECEDING AND CURRENT ROW");
  });
});

// ---------------------------------------------------------------------------
// isin
// ---------------------------------------------------------------------------

describe("isin", () => {
  const table = makeTable([{ name: "g", type: "text" }], [{ g: "WT" }, { g: "mut" }, { g: "ctrl" }]);

  it("JS keeps rows in the set", () => {
    const op: TransformOp = { kind: "isin", column: "g", values: ["WT", "mut"] };
    expect(run(table, [op]).rows.map((r) => r.g)).toEqual(["WT", "mut"]);
  });

  it("JS negate keeps rows not in the set", () => {
    const op: TransformOp = { kind: "isin", column: "g", values: ["WT"], negate: true };
    expect(run(table, [op]).rows.map((r) => r.g)).toEqual(["mut", "ctrl"]);
  });

  it("pandas + SQL", () => {
    const op: TransformOp = { kind: "isin", column: "g", values: ["WT", "mut"] };
    expect(transformOpToPandas(op).code).toContain(".isin(");
    expect(transformOpToSql(op, ctx(["g"]))).toContain("IN (");
  });
});

// ---------------------------------------------------------------------------
// between
// ---------------------------------------------------------------------------

describe("between", () => {
  const table = makeTable([{ name: "x", type: "number" }], [{ x: 1 }, { x: 5 }, { x: 10 }]);

  it("JS keeps rows within the inclusive range", () => {
    const op: TransformOp = { kind: "between", column: "x", lower: 2, upper: 10 };
    expect(run(table, [op]).rows.map((r) => r.x)).toEqual([5, 10]);
  });

  it("pandas + SQL", () => {
    const op: TransformOp = { kind: "between", column: "x", lower: 2, upper: 10 };
    expect(transformOpToPandas(op).code).toContain(".between(2, 10)");
    expect(transformOpToSql(op, ctx(["x"]))).toContain("BETWEEN 2 AND 10");
  });
});

// ---------------------------------------------------------------------------
// topn
// ---------------------------------------------------------------------------

describe("topn", () => {
  const table = makeTable([{ name: "x", type: "number" }], [{ x: 3 }, { x: 1 }, { x: 4 }, { x: 2 }]);

  it("JS keeps the N largest", () => {
    const op: TransformOp = { kind: "topn", column: "x", n: 2, which: "largest" };
    expect(run(table, [op]).rows.map((r) => r.x)).toEqual([4, 3]);
  });

  it("JS keeps the N smallest", () => {
    const op: TransformOp = { kind: "topn", column: "x", n: 2, which: "smallest" };
    expect(run(table, [op]).rows.map((r) => r.x)).toEqual([1, 2]);
  });

  it("pandas + SQL", () => {
    const op: TransformOp = { kind: "topn", column: "x", n: 5, which: "largest" };
    expect(transformOpToPandas(op).code).toContain(".nlargest(5,");
    expect(transformOpToSql(op, ctx(["x"]))).toContain("LIMIT 5");
  });
});

// ---------------------------------------------------------------------------
// sample
// ---------------------------------------------------------------------------

describe("sample", () => {
  const table = makeTable(
    [{ name: "x", type: "number" }],
    Array.from({ length: 10 }, (_, i) => ({ x: i })),
  );

  it("JS count sample returns exactly n rows, seeded for reproducibility", () => {
    const op: TransformOp = { kind: "sample", mode: "count", n: 3, seed: 7 };
    const a = run(table, [op]).rows.map((r) => r.x);
    const b = run(table, [op]).rows.map((r) => r.x);
    expect(a).toHaveLength(3);
    expect(a).toEqual(b);
  });

  it("JS fraction sample returns the right count", () => {
    const op: TransformOp = { kind: "sample", mode: "fraction", fraction: 0.5, seed: 1 };
    expect(run(table, [op]).rows).toHaveLength(5);
  });

  it("pandas + SQL", () => {
    const op: TransformOp = { kind: "sample", mode: "count", n: 100, seed: 7 };
    expect(transformOpToPandas(op).code).toContain(".sample(n=100, random_state=7)");
    expect(transformOpToSql(op, ctx(["x"]))).toContain("USING SAMPLE 100 ROWS");
  });
});

// ---------------------------------------------------------------------------
// value_counts
// ---------------------------------------------------------------------------

describe("value_counts", () => {
  const table = makeTable(
    [{ name: "g", type: "text" }],
    [{ g: "WT" }, { g: "mut" }, { g: "WT" }, { g: "WT" }, { g: null }],
  );

  it("JS counts each value descending", () => {
    const op: TransformOp = { kind: "value_counts", column: "g" };
    const out = run(table, [op]);
    expect(out.columns).toEqual(["value", "count"]);
    expect(out.rows).toEqual([
      { value: "WT", count: 3 },
      { value: "mut", count: 1 },
    ]);
  });

  it("pandas + SQL", () => {
    const op: TransformOp = { kind: "value_counts", column: "g" };
    expect(transformOpToPandas(op).code).toContain(".value_counts()");
    const sql = transformOpToSql(op, ctx(["g"]));
    expect(sql).toContain("count(*) AS count");
    expect(sql).toContain("GROUP BY");
  });
});

// ---------------------------------------------------------------------------
// describe
// ---------------------------------------------------------------------------

describe("describe", () => {
  const table = makeTable(
    [{ name: "x", type: "number" }],
    [{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }],
  );

  it("JS produces a statistic-by-column summary", () => {
    const op: TransformOp = { kind: "describe", columns: ["x"] };
    const out = run(table, [op]);
    expect(out.columns).toEqual(["statistic", "x"]);
    const byStat = Object.fromEntries(out.rows.map((r) => [r.statistic, r.x]));
    expect(byStat.count).toBe(4);
    expect(byStat.mean).toBe(2.5);
    expect(byStat.min).toBe(1);
    expect(byStat.max).toBe(4);
  });

  it("pandas code + SQL note", () => {
    const op: TransformOp = { kind: "describe", columns: ["x"] };
    expect(transformOpToPandas(op).code).toContain(".describe()");
    expect(transformOpToSql(op, ctx(["x"]))).toContain("SUMMARIZE");
  });
});

// ---------------------------------------------------------------------------
// crosstab
// ---------------------------------------------------------------------------

describe("crosstab", () => {
  const table = makeTable(
    [
      { name: "g", type: "text" },
      { name: "t", type: "text" },
    ],
    [
      { g: "WT", t: "A" },
      { g: "WT", t: "B" },
      { g: "mut", t: "A" },
      { g: "WT", t: "A" },
    ],
  );

  it("JS counts co-occurrences", () => {
    const op: TransformOp = { kind: "crosstab", row: "g", column: "t" };
    const out = run(table, [op]);
    expect(out.columns).toEqual(["g", "A", "B"]);
    const wt = out.rows.find((r) => r.g === "WT")!;
    expect(wt.A).toBe(2);
    expect(wt.B).toBe(1);
    const mut = out.rows.find((r) => r.g === "mut")!;
    expect(mut.A).toBe(1);
    expect(mut.B).toBe(0);
  });

  it("pandas code + SQL note", () => {
    const op: TransformOp = { kind: "crosstab", row: "g", column: "t" };
    expect(transformOpToPandas(op).code).toContain("pd.crosstab");
    expect(transformOpToSql(op, ctx(["g", "t"]))).toContain("runs on the JS engine");
  });
});

// ---------------------------------------------------------------------------
// pivot_table
// ---------------------------------------------------------------------------

describe("pivot_table", () => {
  const table = makeTable(
    [
      { name: "g", type: "text" },
      { name: "t", type: "text" },
      { name: "v", type: "number" },
    ],
    [
      { g: "WT", t: "A", v: 2 },
      { g: "WT", t: "A", v: 4 },
      { g: "WT", t: "B", v: 10 },
      { g: "mut", t: "A", v: 6 },
    ],
  );

  it("JS aggregates value across the spread", () => {
    const op: TransformOp = { kind: "pivot_table", index: "g", columns: "t", value: "v", agg: "mean" };
    const out = run(table, [op]);
    expect(out.columns).toEqual(["g", "A", "B"]);
    const wt = out.rows.find((r) => r.g === "WT")!;
    expect(wt.A).toBe(3); // mean of 2 and 4
    expect(wt.B).toBe(10);
    const mut = out.rows.find((r) => r.g === "mut")!;
    expect(mut.A).toBe(6);
    expect(mut.B).toBeNull();
  });

  it("pandas code + SQL note", () => {
    const op: TransformOp = { kind: "pivot_table", index: "g", columns: "t", value: "v", agg: "sum" };
    expect(transformOpToPandas(op).code).toContain("pd.pivot_table");
    expect(transformOpToSql(op, ctx(["g", "t", "v"]))).toContain("runs on the JS engine");
  });
});
