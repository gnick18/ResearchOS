/**
 * Unit tests for the Phase 2b-1 data-cleaning ops (the everyday "edit with code"
 * set): fillna, dropna, set-where, the str-op modes, astype, to-date, date-parts.
 *
 * Each op is checked three ways, matching the spec rule that a rule reads
 * identically at any size:
 *   - JS engine result (executePipeline over a small hand-built table),
 *   - pandas codegen (transformOpToPandas string),
 *   - DuckDB SQL codegen (transformOpToSql string).
 *
 * These cover the spec's headline examples ("set empty cells to X", "rows where y
 * starts with sbc, replace the first three characters with dog"). The SQL and
 * pandas assertions are pure string checks (no DuckDB worker under vitest).
 *
 * House voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import { describe, it, expect } from "vitest";
import { executePipeline } from "../engine";
import { transformOpToPandas } from "../codegen";
import { transformOpToSql } from "../sql-codegen";
import type { DataHubDocContent, ColumnDef, CellValue } from "@/lib/datahub/model/types";
import type { TransformOp, TransformPipeline } from "../pipeline";

// ---------------------------------------------------------------------------
// Tiny table builder + result reader (mirrors derive-pivot-unpivot.test.ts)
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
// fillna
// ---------------------------------------------------------------------------

describe("fillna", () => {
  const table = makeTable(
    [{ name: "pvalue", type: "number" }],
    [{ pvalue: 0.01 }, { pvalue: null }, { pvalue: 0.5 }, { pvalue: null }],
  );

  it("constant fill replaces every empty cell (the 'set empty to X' example)", () => {
    const op: TransformOp = { kind: "fillna", column: "pvalue", method: "constant", value: 1.0 };
    const out = run(table, [op]);
    expect(out.rows.map((r) => r.pvalue)).toEqual([0.01, 1.0, 0.5, 1.0]);
  });

  it("ffill carries the previous value forward", () => {
    const op: TransformOp = { kind: "fillna", column: "pvalue", method: "ffill" };
    expect(run(table, [op]).rows.map((r) => r.pvalue)).toEqual([0.01, 0.01, 0.5, 0.5]);
  });

  it("bfill carries the next value backward", () => {
    const op: TransformOp = { kind: "fillna", column: "pvalue", method: "bfill" };
    expect(run(table, [op]).rows.map((r) => r.pvalue)).toEqual([0.01, 0.5, 0.5, null]);
  });

  it("mean fills with the column mean over non-empty cells", () => {
    const op: TransformOp = { kind: "fillna", column: "pvalue", method: "mean" };
    // mean of 0.01 and 0.5 = 0.255
    expect(run(table, [op]).rows.map((r) => r.pvalue)).toEqual([0.01, 0.255, 0.5, 0.255]);
  });

  it("pandas + SQL for constant fill", () => {
    const op: TransformOp = { kind: "fillna", column: "pvalue", method: "constant", value: 1 };
    expect(transformOpToPandas(op).code).toContain('.fillna(1)');
    const sql = transformOpToSql(op, ctx(["pvalue"]));
    expect(sql).toContain("REPLACE");
    expect(sql).toContain("THEN 1 ELSE");
  });

  it("SQL ffill uses an ordered window with IGNORE NULLS", () => {
    const op: TransformOp = { kind: "fillna", column: "pvalue", method: "ffill" };
    expect(transformOpToSql(op, ctx(["pvalue"]))).toContain("last_value");
    expect(transformOpToSql(op, ctx(["pvalue"]))).toContain("IGNORE NULLS");
  });
});

// ---------------------------------------------------------------------------
// dropna
// ---------------------------------------------------------------------------

describe("dropna", () => {
  const table = makeTable(
    [
      { name: "a", type: "number" },
      { name: "b", type: "number" },
    ],
    [
      { a: 1, b: 2 },
      { a: null, b: 3 },
      { a: 4, b: null },
      { a: null, b: null },
    ],
  );

  it("how any drops a row when any selected column is empty", () => {
    const op: TransformOp = { kind: "dropna", columns: ["a", "b"], how: "any" };
    const out = run(table, [op]);
    expect(out.rows).toEqual([{ a: 1, b: 2 }]);
  });

  it("how all drops a row only when all selected columns are empty", () => {
    const op: TransformOp = { kind: "dropna", columns: ["a", "b"], how: "all" };
    const out = run(table, [op]);
    expect(out.rows).toEqual([
      { a: 1, b: 2 },
      { a: null, b: 3 },
      { a: 4, b: null },
    ]);
  });

  it("pandas + SQL for dropna", () => {
    const op: TransformOp = { kind: "dropna", columns: ["a"], how: "any" };
    expect(transformOpToPandas(op).code).toContain('.dropna(subset=["a"], how="any")');
    expect(transformOpToSql(op, ctx(["a", "b"]))).toContain("WHERE NOT");
  });
});

// ---------------------------------------------------------------------------
// set-where (the headline conditional edit)
// ---------------------------------------------------------------------------

describe("set-where", () => {
  const table = makeTable(
    [{ name: "pvalue", type: "number" }],
    [{ pvalue: 0.01 }, { pvalue: null }, { pvalue: 0.5 }],
  );

  it("sets a constant where the predicate holds (where empty set to 1.0)", () => {
    const op: TransformOp = {
      kind: "set-where",
      column: "pvalue",
      where: { type: "condition", condition: { column: "pvalue", op: "is_empty" } },
      valueKind: "constant",
      value: 1.0,
    };
    expect(run(table, [op]).rows.map((r) => r.pvalue)).toEqual([0.01, 1.0, 0.5]);
  });

  it("sets a formula result where the predicate holds", () => {
    const t = makeTable(
      [
        { name: "x", type: "number" },
        { name: "y", type: "number" },
      ],
      [
        { x: 1, y: 10 },
        { x: 5, y: 20 },
      ],
    );
    const op: TransformOp = {
      kind: "set-where",
      column: "y",
      where: { type: "condition", condition: { column: "x", op: "gt", value: 3 } },
      valueKind: "formula",
      formula: "x * 2",
    };
    // Only the second row (x=5>3) is touched: y becomes 10.
    expect(run(t, [op]).rows.map((r) => r.y)).toEqual([10, 10]);
  });

  it("pandas uses .loc[mask], SQL uses CASE WHEN over REPLACE", () => {
    const op: TransformOp = {
      kind: "set-where",
      column: "pvalue",
      where: { type: "condition", condition: { column: "pvalue", op: "is_empty" } },
      valueKind: "constant",
      value: 1,
    };
    expect(transformOpToPandas(op).code).toContain('.loc[mask, "pvalue"] = 1');
    const sql = transformOpToSql(op, ctx(["pvalue"]));
    expect(sql).toContain("CASE WHEN");
    expect(sql).toContain("THEN 1 ELSE");
  });
});

// ---------------------------------------------------------------------------
// str-op
// ---------------------------------------------------------------------------

describe("str-op slice (replace first N chars)", () => {
  const table = makeTable(
    [{ name: "y", type: "text" }],
    [{ y: "sbc123" }, { y: "sbcXYZ" }, { y: null }],
  );

  it("replaces the first 3 chars with dog (the spec example)", () => {
    const op: TransformOp = {
      kind: "str-op",
      mode: "slice",
      column: "y",
      sliceMode: "replaceFirst",
      n: 3,
      replacement: "dog",
    };
    expect(run(table, [op]).rows.map((r) => r.y)).toEqual(["dog123", "dogXYZ", null]);
  });

  it("substring keeps a [start, end) window", () => {
    const op: TransformOp = {
      kind: "str-op",
      mode: "slice",
      column: "y",
      sliceMode: "substring",
      start: 0,
      end: 3,
    };
    expect(run(table, [op]).rows.map((r) => r.y)).toEqual(["sbc", "sbc", null]);
  });

  it("pandas slice_replace + SQL substr concat", () => {
    const op: TransformOp = {
      kind: "str-op",
      mode: "slice",
      column: "y",
      sliceMode: "replaceFirst",
      n: 3,
      replacement: "dog",
    };
    expect(transformOpToPandas(op).code).toContain("slice_replace(0, 3, \"dog\")");
    expect(transformOpToSql(op, ctx(["y"]))).toContain("'dog' || substr");
  });
});

describe("str-op replace / case / strip", () => {
  const table = makeTable(
    [{ name: "g", type: "text" }],
    [{ g: " Abc " }, { g: "aXa" }],
  );

  it("literal replace swaps every occurrence", () => {
    const op: TransformOp = { kind: "str-op", mode: "replace", column: "g", pattern: "a", replacement: "Z", regex: false };
    expect(run(table, [op]).rows.map((r) => r.g)).toEqual([" Abc ", "ZXZ"]);
  });

  it("upper case", () => {
    const op: TransformOp = { kind: "str-op", mode: "case", column: "g", caseMode: "upper" };
    expect(run(table, [op]).rows.map((r) => r.g)).toEqual([" ABC ", "AXA"]);
  });

  it("strip trims both sides", () => {
    const op: TransformOp = { kind: "str-op", mode: "strip", column: "g", stripMode: "both" };
    expect(run(table, [op]).rows.map((r) => r.g)).toEqual(["Abc", "aXa"]);
  });

  it("SQL uses regexp_replace for regex, replace for literal, trim for strip", () => {
    const lit: TransformOp = { kind: "str-op", mode: "replace", column: "g", pattern: "a", replacement: "Z", regex: false };
    const rx: TransformOp = { kind: "str-op", mode: "replace", column: "g", pattern: "a+", replacement: "Z", regex: true };
    expect(transformOpToSql(lit, ctx(["g"]))).toContain("replace(");
    expect(transformOpToSql(rx, ctx(["g"]))).toContain("regexp_replace(");
    const strip: TransformOp = { kind: "str-op", mode: "strip", column: "g", stripMode: "both" };
    expect(transformOpToSql(strip, ctx(["g"]))).toContain("trim(");
  });
});

describe("str-op extract / split / cat (new columns)", () => {
  const table = makeTable(
    [{ name: "code", type: "text" }],
    [{ code: "AB-12" }, { code: "CD-99" }],
  );

  it("extract pulls a regex group into a new column", () => {
    const op: TransformOp = {
      kind: "str-op",
      mode: "extract",
      column: "code",
      pattern: "(\\d+)",
      group: 1,
      outputName: "num",
    };
    const out = run(table, [op]);
    expect(out.columns).toContain("num");
    expect(out.rows.map((r) => r.num)).toEqual(["12", "99"]);
  });

  it("split makes N new columns by delimiter", () => {
    const op: TransformOp = {
      kind: "str-op",
      mode: "split",
      column: "code",
      separator: "-",
      parts: 2,
      outputPrefix: "code_part",
    };
    const out = run(table, [op]);
    expect(out.columns).toEqual(["code", "code_part_1", "code_part_2"]);
    expect(out.rows[0]).toMatchObject({ code_part_1: "AB", code_part_2: "12" });
  });

  it("cat concatenates columns with a separator, skipping empties", () => {
    const t = makeTable(
      [
        { name: "a", type: "text" },
        { name: "b", type: "text" },
      ],
      [
        { a: "x", b: "y" },
        { a: "x", b: null },
      ],
    );
    const op: TransformOp = {
      kind: "str-op",
      mode: "cat",
      columns: ["a", "b"],
      separator: "_",
      outputName: "combined",
    };
    const out = run(t, [op]);
    expect(out.rows.map((r) => r.combined)).toEqual(["x_y", "x"]);
  });

  it("SQL uses regexp_extract / str_split / concat_ws", () => {
    const ex: TransformOp = { kind: "str-op", mode: "extract", column: "code", pattern: "(\\d+)", group: 1, outputName: "num" };
    expect(transformOpToSql(ex, ctx(["code"]))).toContain("regexp_extract(");
    const sp: TransformOp = { kind: "str-op", mode: "split", column: "code", separator: "-", parts: 2 };
    expect(transformOpToSql(sp, ctx(["code"]))).toContain("str_split(");
    const cat: TransformOp = { kind: "str-op", mode: "cat", columns: ["a", "b"], separator: "_", outputName: "c" };
    expect(transformOpToSql(cat, ctx(["a", "b"]))).toContain("concat_ws(");
  });
});

// ---------------------------------------------------------------------------
// astype
// ---------------------------------------------------------------------------

describe("astype", () => {
  it("casts text to number, non-numeric becomes null", () => {
    const t = makeTable([{ name: "v", type: "text" }], [{ v: "12" }, { v: "x" }, { v: "3.5" }]);
    const op: TransformOp = { kind: "astype", column: "v", to: "number" };
    expect(run(t, [op]).rows.map((r) => r.v)).toEqual([12, null, 3.5]);
  });

  it("pandas to_numeric + SQL TRY_CAST", () => {
    const op: TransformOp = { kind: "astype", column: "v", to: "number" };
    expect(transformOpToPandas(op).code).toContain("pd.to_numeric");
    expect(transformOpToSql(op, ctx(["v"]))).toContain("TRY_CAST");
    expect(transformOpToSql(op, ctx(["v"]))).toContain("AS DOUBLE");
  });
});

// ---------------------------------------------------------------------------
// to-date + date-parts
// ---------------------------------------------------------------------------

describe("to-date", () => {
  it("parses a text column by format into an ISO date string", () => {
    const t = makeTable([{ name: "d", type: "text" }], [{ d: "03/14/2026" }, { d: "bad" }]);
    const op: TransformOp = { kind: "to-date", column: "d", format: "%m/%d/%Y" };
    expect(run(t, [op]).rows.map((r) => r.d)).toEqual(["2026-03-14", null]);
  });

  it("pandas to_datetime + SQL strptime", () => {
    const op: TransformOp = { kind: "to-date", column: "d", format: "%Y-%m-%d" };
    expect(transformOpToPandas(op).code).toContain("pd.to_datetime");
    expect(transformOpToSql(op, ctx(["d"]))).toContain("strptime(");
  });
});

describe("date-parts", () => {
  it("extracts year / month / weekday into new columns", () => {
    // 2026-03-14 is a Saturday (ISO weekday 6).
    const t = makeTable([{ name: "d", type: "text" }], [{ d: "2026-03-14" }]);
    const op: TransformOp = { kind: "date-parts", column: "d", parts: ["year", "month", "weekday"] };
    const out = run(t, [op]);
    expect(out.columns).toEqual(["d", "d_year", "d_month", "d_weekday"]);
    expect(out.rows[0]).toMatchObject({ d_year: 2026, d_month: 3, d_weekday: 6 });
  });

  it("SQL uses date_part with isodow for weekday", () => {
    const op: TransformOp = { kind: "date-parts", column: "d", parts: ["weekday"] };
    expect(transformOpToSql(op, ctx(["d"]))).toContain("date_part('isodow'");
  });
});

// ---------------------------------------------------------------------------
// A chained recipe (the spec's combined example)
// ---------------------------------------------------------------------------

describe("chained cleaning recipe", () => {
  it("fillna then set-where then str slice run in order", () => {
    const t = makeTable(
      [
        { name: "y", type: "text" },
        { name: "score", type: "number" },
      ],
      [
        { y: "sbc1", score: null },
        { y: "sbc2", score: 0.9 },
      ],
    );
    const ops: TransformOp[] = [
      { kind: "fillna", column: "score", method: "constant", value: 0 },
      {
        kind: "str-op",
        mode: "slice",
        column: "y",
        sliceMode: "replaceFirst",
        n: 3,
        replacement: "dog",
      },
    ];
    const out = run(t, ops);
    expect(out.rows).toEqual([
      { y: "dog1", score: 0 },
      { y: "dog2", score: 0.9 },
    ]);
  });
});
