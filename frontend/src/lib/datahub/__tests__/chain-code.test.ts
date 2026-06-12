/**
 * Unit tests for chain-code.ts (the lineage walker + chain assembler).
 *
 * We assert the ORDER of the stitched script (base data to transforms to
 * analysis to graph), that imports are hoisted once to the top, that an entered
 * table gets the data-load preamble plus the unchanged emitter output, and that
 * a missing source degrades gracefully. We do NOT run Python; the script is for
 * a human to paste (the report eyeballs one run).
 *
 * House voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import { describe, it, expect } from "vitest";
import { chainCode, type ContentResolver } from "../chain-code";
import type {
  DataHubDocContent,
  ColumnDef,
  CellValue,
  AnalysisSpec,
  PlotSpec,
  DerivedFrom,
} from "@/lib/datahub/model/types";
import type { TransformOp } from "@/lib/datahub/transform/pipeline";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function table(
  id: string,
  name: string,
  columns: { name: string; type: "number" | "text" }[],
  rows: Record<string, CellValue>[],
  extra: Partial<DataHubDocContent> = {},
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
      ...(extra.meta ? {} : {}),
    },
    columns: colDefs,
    rows: rows.map((r, i) => {
      const cells: Record<string, CellValue> = {};
      for (const c of colDefs) cells[c.id] = r[c.name] ?? null;
      return { id: `${id}-r${i + 1}`, cells };
    }),
    analyses: extra.analyses ?? [],
    plots: extra.plots ?? [],
  };
}

function withDerived(
  content: DataHubDocContent,
  derivedFrom: DerivedFrom,
): DataHubDocContent {
  return { ...content, meta: { ...content.meta, derivedFrom } };
}

/** A resolver over an in-memory map of table id -> content. */
function resolverFor(...tables: DataHubDocContent[]): ContentResolver {
  const byId = new Map(tables.map((t) => [t.meta.id, t]));
  return async (id: string) => byId.get(id) ?? null;
}

// Two-group column table for an unpaired t-test.
function twoGroupTable(id: string, name: string): DataHubDocContent {
  return table(
    id,
    name,
    [
      { name: "Control", type: "number" },
      { name: "Treated", type: "number" },
    ],
    [
      { Control: 10, Treated: 14 },
      { Control: 11, Treated: 15 },
      { Control: 9, Treated: 13 },
    ],
  );
}

function ttestSpec(id: string, columnIds: string[]): AnalysisSpec {
  return {
    id,
    type: "unpairedTTest",
    params: {},
    inputs: { columnIds },
    resultCache: null,
    resultStale: false,
  };
}

// ---------------------------------------------------------------------------
// Derived table
// ---------------------------------------------------------------------------

describe("chainCode for a derived table", () => {
  it("emits base data then the transforms in order", async () => {
    const base = table(
      "t1",
      "Raw",
      [
        { name: "region", type: "text" },
        { name: "units", type: "number" },
      ],
      [
        { region: "North", units: 10 },
        { region: "North", units: 12 },
        { region: "South", units: 4 },
      ],
    );
    const recipe: TransformOp[] = [
      { kind: "filter", node: { type: "condition", condition: { column: "units", op: "ge", value: 5 } } },
      { kind: "groupby", by: ["region"], aggregations: [{ column: "units", func: "mean" }] },
    ];
    const derived = withDerived(
      table("t2", "Summary", [{ name: "region", type: "text" }], []),
      { sources: ["t1"], recipe },
    );
    const script = await chainCode(
      { kind: "table", tableId: "t2", content: derived },
      resolverFor(base, derived),
    );
    const idxLoad = script.indexOf("# Step 1, load the base data");
    const idxFilter = script.indexOf("# Step 2,");
    const idxGroup = script.indexOf("# Step 3,");
    expect(idxLoad).toBeGreaterThanOrEqual(0);
    expect(idxFilter).toBeGreaterThan(idxLoad);
    expect(idxGroup).toBeGreaterThan(idxFilter);
    expect(script).toContain("import pandas as pd");
    expect(script).toContain('"region": ["North", "North", "South"],');
  });

  it("flattens a derived-of-derived chain into one ordered recipe", async () => {
    const base = table("t1", "Raw", [{ name: "y", type: "number" }], [{ y: 2 }, { y: 4 }]);
    const mid = withDerived(table("t2", "Doubled", [{ name: "y", type: "number" }], []), {
      sources: ["t1"],
      recipe: [{ kind: "column-transform", params: { func: "linear", k: 2, b: 0 } }],
    });
    const top = withDerived(table("t3", "Logged", [{ name: "y", type: "number" }], []), {
      sources: ["t2"],
      recipe: [{ kind: "column-transform", params: { func: "log10" } }],
    });
    const script = await chainCode(
      { kind: "table", tableId: "t3", content: top },
      resolverFor(base, mid, top),
    );
    // Base load, then the parent transform (x2), then the child transform (log10).
    const idxLoad = script.indexOf("# Step 1,");
    const idxDouble = script.indexOf("* 2");
    const idxLog = script.indexOf("np.log10");
    expect(idxLoad).toBeGreaterThanOrEqual(0);
    expect(idxDouble).toBeGreaterThan(idxLoad);
    expect(idxLog).toBeGreaterThan(idxDouble);
  });
});

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

describe("chainCode for an analysis", () => {
  it("on an entered table emits the data-load preamble then the analysis", async () => {
    const content = twoGroupTable("t1", "Cells");
    const spec = ttestSpec("a1", [content.columns[0].id, content.columns[1].id]);
    const script = await chainCode(
      { kind: "analysis", tableId: "t1", content, analysis: spec },
      resolverFor(content),
    );
    const idxLoad = script.indexOf("# Step 1, load the base data");
    const idxAnalysis = script.indexOf("# Step 2,");
    expect(idxLoad).toBeGreaterThanOrEqual(0);
    expect(idxAnalysis).toBeGreaterThan(idxLoad);
    // The data-load preamble is present (the DataFrame), and the unchanged
    // analysis emitter output (the t-test) follows it.
    expect(script).toContain("df = pd.DataFrame({");
    expect(script).toContain("stats.ttest_ind");
    // scipy import is hoisted to the top, above the data-load step.
    const idxImport = script.indexOf("from scipy import stats");
    expect(idxImport).toBeGreaterThanOrEqual(0);
    expect(idxImport).toBeLessThan(idxLoad);
  });

  it("on a derived table emits base + transforms + analysis in order", async () => {
    const base = twoGroupTable("t1", "Raw");
    // A normalize transform produces the derived table the analysis runs on.
    const derived = withDerived(
      {
        ...twoGroupTable("t2", "Normalized"),
        meta: { ...twoGroupTable("t2", "Normalized").meta },
      },
      {
        sources: ["t1"],
        recipe: [{ kind: "normalize", params: { mode: "max" } }],
      },
    );
    const spec = ttestSpec("a1", [derived.columns[0].id, derived.columns[1].id]);
    const script = await chainCode(
      { kind: "analysis", tableId: "t2", content: derived, analysis: spec },
      resolverFor(base, derived),
    );
    const idxLoad = script.indexOf("# Step 1, load the base data");
    const idxNorm = script.indexOf("# Step 2,");
    const idxAnalysis = script.indexOf("# Step 3,");
    expect(idxLoad).toBeGreaterThanOrEqual(0);
    expect(idxNorm).toBeGreaterThan(idxLoad);
    expect(idxAnalysis).toBeGreaterThan(idxNorm);
    expect(script).toContain("stats.ttest_ind");
  });
});

// ---------------------------------------------------------------------------
// Figure
// ---------------------------------------------------------------------------

describe("chainCode for a figure", () => {
  it("a plain figure on an entered table is the preamble plus today's plot output", async () => {
    const content = twoGroupTable("t1", "Cells");
    const plot: PlotSpec = {
      id: "p1",
      type: "columnBar",
      style: { kind: "columnBar", errorBar: "sem" },
      source: { tableId: "t1", analysisId: null },
    };
    const script = await chainCode(
      { kind: "figure", tableId: "t1", content, plot },
      resolverFor(content),
    );
    // Data-load preamble plus the matplotlib block.
    expect(script).toContain("# Step 1, load the base data");
    expect(script).toContain("df = pd.DataFrame({");
    expect(script).toContain("import matplotlib.pyplot as plt");
    expect(script).toContain("fig.savefig");
    // The figure step comes after the data load.
    expect(script.indexOf("make the figure")).toBeGreaterThan(
      script.indexOf("# Step 1, load the base data"),
    );
  });

  it("a figure on a derived table emits base data + transforms + plot in order", async () => {
    const base = table(
      "t1",
      "Raw",
      [
        { name: "Control", type: "number" },
        { name: "Treated", type: "number" },
      ],
      [
        { Control: 10, Treated: 14 },
        { Control: 12, Treated: 16 },
      ],
    );
    const derived = withDerived(
      table("t2", "Normalized", [{ name: "Control", type: "number" }], []),
      { sources: ["t1"], recipe: [{ kind: "normalize", params: { mode: "max" } }] },
    );
    const plot: PlotSpec = {
      id: "p1",
      type: "columnBar",
      style: { kind: "columnBar", errorBar: "sd" },
      source: { tableId: "t2", analysisId: null },
    };
    const script = await chainCode(
      { kind: "figure", tableId: "t2", content: derived, plot },
      resolverFor(base, derived),
    );
    const idxLoad = script.indexOf("# Step 1, load the base data");
    const idxTransform = script.indexOf("# Step 2,");
    const idxFigure = script.indexOf("make the figure");
    expect(idxLoad).toBeGreaterThanOrEqual(0);
    expect(idxTransform).toBeGreaterThan(idxLoad);
    expect(idxFigure).toBeGreaterThan(idxTransform);
    // numpy + matplotlib imports both present, hoisted to the top once.
    expect(script).toContain("import matplotlib.pyplot as plt");
    expect((script.match(/import matplotlib\.pyplot as plt/g) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Graceful degradation
// ---------------------------------------------------------------------------

describe("chainCode degradation", () => {
  it("a missing source still emits a script with a note", async () => {
    const derived = withDerived(
      table("t2", "Summary", [{ name: "region", type: "text" }], []),
      { sources: ["gone"], recipe: [{ kind: "drop", columns: ["x"] }] },
    );
    const script = await chainCode(
      { kind: "table", tableId: "t2", content: derived },
      resolverFor(derived), // "gone" is not in the map
    );
    expect(script).toContain("could not be resolved");
  });

  it("reads a legacy single-op derivedFrom shape", async () => {
    const base = table("t1", "Raw", [{ name: "y", type: "number" }], [{ y: 4 }, { y: 9 }]);
    const derived: DataHubDocContent = withDerived(
      table("t2", "Sqrt", [{ name: "y", type: "number" }], []),
      // Legacy single-op fields (no sources / recipe arrays).
      { sourceTableId: "t1", transform: "transform", params: { func: "sqrt" } },
    );
    const script = await chainCode(
      { kind: "table", tableId: "t2", content: derived },
      resolverFor(base, derived),
    );
    expect(script).toContain("# Step 1, load the base data");
    expect(script).toContain("np.sqrt");
  });
});
