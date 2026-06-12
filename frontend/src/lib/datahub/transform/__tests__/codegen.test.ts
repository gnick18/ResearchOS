/**
 * Unit tests for transform/codegen.ts (TransformOp -> pandas).
 *
 * Each op kind emits a recognizable pandas expression plus a plain-language
 * comment. We assert the shape of the emitted code (the pandas call and the key
 * arguments) and the comment voice, plus a 2-3 step chain through recipeToPandas
 * with inline base data. We do NOT run Python here; the emitted script is meant
 * for a human to paste into a notebook (the chain-code report eyeballs one run).
 *
 * House voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import { describe, it, expect } from "vitest";
import {
  transformOpToPandas,
  recipeToPandas,
  tableToDataFrame,
  translateDeriveFormula,
  type RecipeSource,
} from "../codegen";
import type { TransformOp, DeriveOp } from "../pipeline";
import type { DataHubDocContent, ColumnDef, CellValue } from "@/lib/datahub/model/types";

// ---------------------------------------------------------------------------
// Tiny table builder (same shape as the engine tests)
// ---------------------------------------------------------------------------

function makeTable(
  id: string,
  name: string,
  columns: { name: string; type: "number" | "text" }[],
  rows: Record<string, CellValue>[],
): DataHubDocContent {
  const colDefs: ColumnDef[] = columns.map((c, i) => ({
    id: `${id}-c${i + 1}`,
    name: c.name,
    role: "y",
    dataType: c.type,
  }));
  return {
    meta: {
      id,
      name,
      project_ids: [],
      folder_path: null,
      table_type: "column",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    columns: colDefs,
    rows: rows.map((r, i) => {
      const cells: Record<string, CellValue> = {};
      for (const c of colDefs) cells[c.id] = r[c.name] ?? null;
      return { id: `${id}-r${i + 1}`, cells };
    }),
    analyses: [],
    plots: [],
  };
}

// ---------------------------------------------------------------------------
// tableToDataFrame
// ---------------------------------------------------------------------------

describe("tableToDataFrame", () => {
  it("inlines columns by name with cell lists and None for nulls", () => {
    const t = makeTable("t1", "Sales", [
      { name: "region", type: "text" },
      { name: "units", type: "number" },
    ], [
      { region: "North", units: 10 },
      { region: "South", units: null },
    ]);
    const code = tableToDataFrame(t, "df");
    expect(code).toContain("df = pd.DataFrame({");
    expect(code).toContain('"region": ["North", "South"],');
    expect(code).toContain('"units": [10, None],');
  });

  it("emits an empty DataFrame for a table with no columns", () => {
    const t = makeTable("t0", "Empty", [], []);
    expect(tableToDataFrame(t, "df")).toBe("df = pd.DataFrame()");
  });
});

// ---------------------------------------------------------------------------
// Per-op codegen
// ---------------------------------------------------------------------------

describe("transformOpToPandas per op", () => {
  it("join -> pd.merge with on / how / suffixes", () => {
    const op: TransformOp = {
      kind: "join",
      rightRef: "s2",
      on: ["sample_id"],
      how: "left",
    };
    const { code, comment } = transformOpToPandas(op, { rightVar: "df_samples" });
    expect(code).toContain("pd.merge(df, df_samples, on=[\"sample_id\"], how=\"left\"");
    expect(comment).toContain("Join with df_samples on sample_id");
  });

  it("filter -> boolean mask + reset_index", () => {
    const op: TransformOp = {
      kind: "filter",
      node: { type: "condition", condition: { column: "qty", op: "gt", value: 5 } },
    };
    const { code, comment } = transformOpToPandas(op);
    expect(code).toContain("df = df[");
    expect(code).toContain('pd.to_numeric(df["qty"], errors="coerce") > 5');
    expect(code).toContain(".reset_index(drop=True)");
    expect(comment).toContain("qty is greater than 5");
  });

  it("filter and/not -> combined mask", () => {
    const op: TransformOp = {
      kind: "filter",
      node: {
        type: "and",
        children: [
          { type: "condition", condition: { column: "a", op: "eq", value: "x" } },
          { type: "not", child: { type: "condition", condition: { column: "b", op: "is_empty" } } },
        ],
      },
    };
    const { code } = transformOpToPandas(op);
    expect(code).toContain('(df["a"] == "x")');
    expect(code).toContain("&");
    expect(code).toContain("~");
  });

  it("groupby -> groupby(...).agg with named aggregations and std for sd", () => {
    const op: TransformOp = {
      kind: "groupby",
      by: ["region"],
      aggregations: [
        { column: "units", func: "mean" },
        { column: "units", func: "sd", outputName: "spread" },
      ],
    };
    const { code, comment } = transformOpToPandas(op);
    expect(code).toContain('df.groupby(["region"], sort=False, as_index=False).agg(**{');
    expect(code).toContain('"units_mean": ("units", "mean"),');
    expect(code).toContain('"spread": ("units", "std"),');
    expect(comment).toContain("Group by region");
  });

  it("select / drop / rename", () => {
    expect(transformOpToPandas({ kind: "select", columns: ["a", "b"] }).code).toBe(
      'df = df[["a", "b"]]',
    );
    expect(transformOpToPandas({ kind: "drop", columns: ["c"] }).code).toBe(
      'df = df.drop(columns=["c"])',
    );
    expect(
      transformOpToPandas({ kind: "rename", mapping: { old: "new" } }).code,
    ).toBe('df = df.rename(columns={"old": "new"})');
  });

  it("sort -> sort_values with ascending list and stable kind", () => {
    const op: TransformOp = {
      kind: "sort",
      by: [{ column: "score", direction: "desc" }],
    };
    const { code } = transformOpToPandas(op);
    expect(code).toContain('df.sort_values(by=["score"], ascending=[False]');
    expect(code).toContain('kind="stable"');
  });

  it("dedupe -> drop_duplicates with subset and keep", () => {
    const op: TransformOp = { kind: "dedupe", subset: ["id"], keep: "last" };
    const { code } = transformOpToPandas(op);
    expect(code).toContain('df.drop_duplicates(subset=["id"], keep="last")');
  });

  it("union -> pd.concat with ignore_index", () => {
    const op: TransformOp = { kind: "union", otherRef: "s2" };
    const { code } = transformOpToPandas(op, { otherVar: "df_more" });
    expect(code).toBe("df = pd.concat([df, df_more], ignore_index=True)");
  });

  it("pivot -> pivot_table aggfunc mean", () => {
    const op: TransformOp = {
      kind: "pivot",
      index: ["sample"],
      columns: "gene",
      values: "ct",
    };
    const { code } = transformOpToPandas(op);
    expect(code).toContain('df.pivot_table(index=["sample"], columns="gene", values="ct", aggfunc="mean")');
  });

  it("unpivot -> melt with id_vars and names", () => {
    const op: TransformOp = {
      kind: "unpivot",
      idVars: ["sample"],
      valueVars: ["a", "b"],
      varName: "gene",
      valueName: "ct",
    };
    const { code } = transformOpToPandas(op);
    expect(code).toContain('df.melt(id_vars=["sample"], value_vars=["a", "b"], var_name="gene", value_name="ct")');
  });

  it("folded column-transform log10 -> np.log10 over numeric columns", () => {
    const op: TransformOp = { kind: "column-transform", params: { func: "log10" } };
    const { code, comment } = transformOpToPandas(op);
    expect(code).toContain('cols = df.select_dtypes(include="number").columns');
    expect(code).toContain("np.log10(df[cols].where(df[cols] > 0))");
    expect(comment).toContain("log base 10");
  });

  it("normalize max -> divide by column max times 100", () => {
    const op: TransformOp = { kind: "normalize", params: { mode: "max" } };
    const { code } = transformOpToPandas(op);
    expect(code).toContain("df[cols] / df[cols].max() * 100");
  });

  it("fraction-of-total row scope as percent", () => {
    const op: TransformOp = {
      kind: "fraction-of-total",
      params: { scope: "row", asPercent: true },
    };
    const { code } = transformOpToPandas(op);
    expect(code).toContain("df[cols].div(df[cols].sum(axis=1), axis=0) * 100");
  });
});

// ---------------------------------------------------------------------------
// derive formula translation
// ---------------------------------------------------------------------------

describe("translateDeriveFormula", () => {
  it("plain arithmetic maps column names to df[...] and ^ to **", () => {
    const op: DeriveOp = { kind: "derive", outputName: "ratio", formula: "a / b * 2 ^ 2" };
    const t = translateDeriveFormula("df", op, ["a", "b"]);
    expect(t.plain).toBe(true);
    expect(t.code).toBe('df["ratio"] = df["a"] / df["b"] * 2 ** 2');
  });

  it("does not partially match a name that is a prefix of another", () => {
    const op: DeriveOp = { kind: "derive", outputName: "x", formula: "ab + abc" };
    const t = translateDeriveFormula("df", op, ["ab", "abc"]);
    expect(t.code).toBe('df["x"] = df["ab"] + df["abc"]');
  });

  it("falls back to a comment + placeholder for a function call", () => {
    const op: DeriveOp = { kind: "derive", outputName: "m", formula: "mean(a, b)" };
    const t = translateDeriveFormula("df", op, ["a", "b"]);
    expect(t.plain).toBe(false);
    expect(t.code).toContain("# Derived column \"m\" = mean(a, b)");
    expect(t.code).toContain("TODO adapt");
  });
});

// ---------------------------------------------------------------------------
// recipeToPandas: a 2-3 step chain with inline base data
// ---------------------------------------------------------------------------

describe("recipeToPandas chain", () => {
  it("loads the base data then threads filter -> groupby with numbered steps", () => {
    const primary = makeTable("t1", "Raw qPCR", [
      { name: "region", type: "text" },
      { name: "units", type: "number" },
    ], [
      { region: "North", units: 10 },
      { region: "North", units: 12 },
      { region: "South", units: 4 },
    ]);
    const recipe: TransformOp[] = [
      { kind: "filter", node: { type: "condition", condition: { column: "units", op: "ge", value: 5 } } },
      { kind: "groupby", by: ["region"], aggregations: [{ column: "units", func: "mean" }] },
    ];
    const sources: RecipeSource[] = [{ id: "t1", content: primary }];
    const { code, resultVar, imports } = recipeToPandas(sources, recipe);

    expect(resultVar).toBe("df");
    expect(imports).toContain("import pandas as pd");
    // Step ordering: load is step 1, the two transforms are steps 2 and 3.
    const idxLoad = code.indexOf("# Step 1, load the base data");
    const idxFilter = code.indexOf("# Step 2,");
    const idxGroup = code.indexOf("# Step 3,");
    expect(idxLoad).toBeGreaterThanOrEqual(0);
    expect(idxFilter).toBeGreaterThan(idxLoad);
    expect(idxGroup).toBeGreaterThan(idxFilter);
    // The base data is inlined before the transforms.
    expect(code).toContain('"region": ["North", "North", "South"],');
    expect(code).toContain("df = df[");
    expect(code).toContain("df.groupby");
  });

  it("inlines a joined-in second source before the join step", () => {
    const left = makeTable("t1", "Results", [
      { name: "sample_id", type: "text" },
      { name: "ct", type: "number" },
    ], [{ sample_id: "S1", ct: 22 }]);
    const right = makeTable("t2", "Sample Sheet", [
      { name: "sample_id", type: "text" },
      { name: "treatment", type: "text" },
    ], [{ sample_id: "S1", treatment: "drug" }]);
    const recipe: TransformOp[] = [
      { kind: "join", rightRef: "t2", on: ["sample_id"], how: "inner" },
    ];
    const sources: RecipeSource[] = [
      { id: "t1", content: left },
      { id: "t2", content: right },
    ];
    const { code } = recipeToPandas(sources, recipe);
    // The second table is loaded into a named var and merged in.
    expect(code).toContain("df_sample_sheet = pd.DataFrame({");
    expect(code).toContain("pd.merge(df, df_sample_sheet, on=[\"sample_id\"]");
    // The joined-table load comes before the merge step in the script.
    expect(code.indexOf("df_sample_sheet = pd.DataFrame")).toBeLessThan(
      code.indexOf("pd.merge"),
    );
  });

  it("numpy import is added when a folded op needs it", () => {
    const primary = makeTable("t1", "T", [{ name: "y", type: "number" }], [{ y: 4 }]);
    const recipe: TransformOp[] = [{ kind: "normalize", params: { mode: "max" } }];
    const { imports } = recipeToPandas([{ id: "t1", content: primary }], recipe);
    expect(imports).toContain("import numpy as np");
  });
});
