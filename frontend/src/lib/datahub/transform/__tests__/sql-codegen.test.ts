// datahub/transform/__tests__/sql-codegen.test.ts
//
// The SQL generator (sql-codegen.ts) is the DuckDB twin of the pandas generator.
// These tests assert the emitted SQL per op, the derive-formula SQL translation,
// and a multi-op pipeline compiled to one CTE chain. They are pure string
// assertions (no DuckDB worker, which cannot run under vitest), mirroring how
// codegen.test.ts asserts the pandas strings.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  transformOpToSql,
  recipeToSql,
  translateDeriveFormulaToSql,
  sqlIdent,
} from "../sql-codegen";
import type { TransformOp, DeriveOp } from "../pipeline";

const ctx = (from: string, columnNames: string[] = []) => ({ from, columnNames });

describe("sqlIdent", () => {
  it("double-quotes and escapes embedded quotes", () => {
    expect(sqlIdent("tpm")).toBe('"tpm"');
    expect(sqlIdent('a "b"')).toBe('"a ""b"""');
  });
});

describe("transformOpToSql per op", () => {
  it("filter, numeric inequality casts to double", () => {
    const op: TransformOp = {
      kind: "filter",
      node: { type: "condition", condition: { column: "pvalue", op: "lt", value: 0.05 } },
    };
    expect(transformOpToSql(op, ctx("__step0"))).toBe(
      'SELECT * FROM __step0 WHERE (TRY_CAST("pvalue" AS DOUBLE) < 0.05)',
    );
  });

  it("filter, is_empty", () => {
    const op: TransformOp = {
      kind: "filter",
      node: { type: "condition", condition: { column: "pvalue", op: "is_empty" } },
    };
    expect(transformOpToSql(op, ctx("__step0"))).toContain('"pvalue" IS NULL');
  });

  it("filter, AND of two conditions", () => {
    const op: TransformOp = {
      kind: "filter",
      node: {
        type: "and",
        children: [
          { type: "condition", condition: { column: "tpm", op: "gt", value: 10 } },
          { type: "condition", condition: { column: "sample", op: "eq", value: "ctrl" } },
        ],
      },
    };
    const sql = transformOpToSql(op, ctx("__step0"));
    expect(sql).toContain("AND");
    expect(sql).toContain(`"sample" = 'ctrl'`);
  });

  it("select keeps the named columns", () => {
    const op: TransformOp = { kind: "select", columns: ["gene_id", "tpm"] };
    expect(transformOpToSql(op, ctx("__step0"))).toBe(
      'SELECT "gene_id", "tpm" FROM __step0',
    );
  });

  it("drop uses EXCLUDE when the column list is unknown", () => {
    const op: TransformOp = { kind: "drop", columns: ["raw"] };
    expect(transformOpToSql(op, ctx("__step0"))).toBe(
      'SELECT * EXCLUDE ("raw") FROM __step0',
    );
  });

  it("drop names the kept columns when the list is known", () => {
    const op: TransformOp = { kind: "drop", columns: ["raw"] };
    expect(transformOpToSql(op, ctx("__step0", ["gene_id", "raw", "tpm"]))).toBe(
      'SELECT "gene_id", "tpm" FROM __step0',
    );
  });

  it("rename aliases the mapped column", () => {
    const op: TransformOp = { kind: "rename", mapping: { tpm: "expression" } };
    expect(transformOpToSql(op, ctx("__step0", ["gene_id", "tpm"]))).toBe(
      'SELECT "gene_id", "tpm" AS "expression" FROM __step0',
    );
  });

  it("sort emits ORDER BY with direction and nulls placement", () => {
    const op: TransformOp = { kind: "sort", by: [{ column: "tpm", direction: "desc" }] };
    expect(transformOpToSql(op, ctx("__step0"))).toBe(
      'SELECT * FROM __step0 ORDER BY "tpm" DESC NULLS FIRST',
    );
  });

  it("dedupe all-columns uses DISTINCT", () => {
    const op: TransformOp = { kind: "dedupe" };
    expect(transformOpToSql(op, ctx("__step0"))).toBe("SELECT DISTINCT * FROM __step0");
  });

  it("dedupe on a subset keeps one row per key", () => {
    const op: TransformOp = { kind: "dedupe", subset: ["gene_id"], keep: "first" };
    const sql = transformOpToSql(op, ctx("__step0"));
    expect(sql).toContain("ROW_NUMBER() OVER (PARTITION BY \"gene_id\"");
    expect(sql).toContain("__dedupe_rn = 1");
  });

  it("groupby emits aggregates with DOUBLE casts and GROUP BY", () => {
    const op: TransformOp = {
      kind: "groupby",
      by: ["cluster"],
      aggregations: [{ column: "tpm", func: "mean", outputName: "tpm_mean" }],
    };
    expect(transformOpToSql(op, ctx("__step0"))).toBe(
      'SELECT "cluster", avg(TRY_CAST("tpm" AS DOUBLE)) AS "tpm_mean" FROM __step0 GROUP BY "cluster"',
    );
  });

  it("derive appends the formula expression as a new column", () => {
    const op: TransformOp = { kind: "derive", outputName: "tpm_pct", formula: "tpm / 900 * 100" };
    expect(transformOpToSql(op, ctx("__step0", ["tpm"]))).toBe(
      'SELECT *, (TRY_CAST("tpm" AS DOUBLE) / 900 * 100) AS "tpm_pct" FROM __step0',
    );
  });

  it("union aligns by name with UNION ALL BY NAME", () => {
    const op: TransformOp = { kind: "union", otherRef: "src2" };
    const sql = transformOpToSql(op, { from: "__step0", otherRel: "__src2", columnNames: [] });
    expect(sql).toBe("SELECT * FROM __step0 UNION ALL BY NAME SELECT * FROM __src2");
  });

  it("join uses USING on the key columns", () => {
    const op: TransformOp = { kind: "join", rightRef: "src2", on: ["gene_id"], how: "left" };
    const sql = transformOpToSql(op, { from: "__step0", rightRel: "__src2", columnNames: [] });
    expect(sql).toBe('SELECT * FROM __step0 LEFT JOIN __src2 USING ("gene_id")');
  });

  it("pivot spreads the key column by mean of the value", () => {
    const op: TransformOp = { kind: "pivot", index: ["gene_id"], columns: "sample", values: "tpm" };
    expect(transformOpToSql(op, ctx("__step0"))).toBe(
      'PIVOT __step0 ON "sample" USING avg(TRY_CAST("tpm" AS DOUBLE)) GROUP BY "gene_id"',
    );
  });

  it("unpivot gathers value columns into a name/value pair", () => {
    const op: TransformOp = {
      kind: "unpivot",
      idVars: ["gene_id"],
      valueVars: ["ctrl", "treated"],
      varName: "sample",
      valueName: "tpm",
    };
    expect(transformOpToSql(op, ctx("__step0"))).toBe(
      'UNPIVOT __step0 ON "ctrl", "treated" INTO NAME "sample" VALUE "tpm"',
    );
  });
});

describe("translateDeriveFormulaToSql", () => {
  it("translates plain arithmetic with column refs and ^ to **", () => {
    const op: DeriveOp = { kind: "derive", outputName: "y", formula: "a ^ 2 + b / 2" };
    const r = translateDeriveFormulaToSql(op, ["a", "b"]);
    expect(r.plain).toBe(true);
    expect(r.expr).toBe('TRY_CAST("a" AS DOUBLE) ** 2 + TRY_CAST("b" AS DOUBLE) / 2');
  });

  it("matches longest column names first", () => {
    const op: DeriveOp = { kind: "derive", outputName: "z", formula: "ab + a" };
    const r = translateDeriveFormulaToSql(op, ["a", "ab"]);
    expect(r.expr).toBe('TRY_CAST("ab" AS DOUBLE) + TRY_CAST("a" AS DOUBLE)');
  });

  it("falls back to NULL for a non-arithmetic formula", () => {
    const op: DeriveOp = { kind: "derive", outputName: "y", formula: "mean(a, b)" };
    const r = translateDeriveFormulaToSql(op, ["a", "b"]);
    expect(r.plain).toBe(false);
    expect(r.expr).toContain("NULL");
  });
});

describe("recipeToSql pipeline", () => {
  it("empty recipe is a plain select over the source", () => {
    expect(recipeToSql([], "read_parquet('d.parquet')")).toBe(
      "SELECT * FROM read_parquet('d.parquet')",
    );
  });

  it("compiles a filter + derive + sort pipeline into a CTE chain", () => {
    const recipe: TransformOp[] = [
      {
        kind: "filter",
        node: { type: "condition", condition: { column: "pvalue", op: "lt", value: 0.05 } },
      },
      { kind: "derive", outputName: "tpm_pct", formula: "tpm / 900 * 100" },
      { kind: "sort", by: [{ column: "tpm", direction: "desc" }] },
    ];
    const sql = recipeToSql(recipe, "src", { columnNames: ["gene_id", "tpm", "pvalue"] });
    expect(sql.startsWith("WITH __step0 AS (SELECT * FROM src)")).toBe(true);
    expect(sql).toContain('__step1 AS (SELECT * FROM __step0 WHERE');
    expect(sql).toContain('__step2 AS (SELECT *, (TRY_CAST("tpm" AS DOUBLE) / 900 * 100) AS "tpm_pct" FROM __step1)');
    expect(sql).toContain('__step3 AS (SELECT * FROM __step2 ORDER BY "tpm" DESC');
    expect(sql.trimEnd().endsWith("SELECT * FROM __step3")).toBe(true);
  });

  it("threads a join's right relation from sourceRelations", () => {
    const recipe: TransformOp[] = [
      { kind: "join", rightRef: "src2", on: ["gene_id"], how: "inner" },
    ];
    const sql = recipeToSql(recipe, "src", {
      sourceRelations: { src2: "read_parquet('b.parquet')" },
      columnNames: ["gene_id"],
    });
    expect(sql).toContain(`INNER JOIN read_parquet('b.parquet') USING ("gene_id")`);
  });
});
