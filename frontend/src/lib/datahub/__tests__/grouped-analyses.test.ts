import { describe, it, expect } from "vitest";

import type {
  AnalysisSpec,
  DataHubDocContent,
  DataHubDocument,
  RowRecord,
} from "@/lib/datahub/model/types";
import {
  runAnalysis,
  validAnalysisTypes,
  type NormalizedTwoWayAnova,
} from "@/lib/datahub/run-analysis";
import {
  layoutGroupedBar,
  renderGroupedBarSvg,
  defaultPlotStyle,
} from "@/lib/datahub/plot-spec";

const META: DataHubDocument = {
  id: "1",
  name: "Two factor",
  project_ids: [],
  folder_path: null,
  table_type: "grouped",
  created_at: "2026-06-10T00:00:00.000Z",
};

type Cols = DataHubDocContent["columns"];

// The engine's pinned balanced 2x2x3 design, entered through the grouped grid.
function referenceContent(): DataHubDocContent {
  const columns: Cols = [
    { id: "rowlabel", name: "Stage", role: "x", dataType: "text" },
    { id: "blo-r1", name: "Vehicle", role: "y", dataType: "number", datasetId: "grp-1", subcolumnKind: "replicate" },
    { id: "blo-r2", name: "Vehicle", role: "y", dataType: "number", datasetId: "grp-1", subcolumnKind: "replicate" },
    { id: "blo-r3", name: "Vehicle", role: "y", dataType: "number", datasetId: "grp-1", subcolumnKind: "replicate" },
    { id: "bhi-r1", name: "Drug", role: "y", dataType: "number", datasetId: "grp-2", subcolumnKind: "replicate" },
    { id: "bhi-r2", name: "Drug", role: "y", dataType: "number", datasetId: "grp-2", subcolumnKind: "replicate" },
    { id: "bhi-r3", name: "Drug", role: "y", dataType: "number", datasetId: "grp-2", subcolumnKind: "replicate" },
  ];
  const rows: RowRecord[] = [
    { id: "r1", cells: { rowlabel: "lo", "blo-r1": 9, "blo-r2": 10, "blo-r3": 11, "bhi-r1": 11, "bhi-r2": 12, "bhi-r3": 13 } },
    { id: "r2", cells: { rowlabel: "hi", "blo-r1": 14, "blo-r2": 15, "blo-r3": 16, "bhi-r1": 17, "bhi-r2": 18, "bhi-r3": 19 } },
  ];
  return { meta: META, columns, rows, analyses: [], plots: [] };
}

function spec(): AnalysisSpec {
  return {
    id: "a1",
    type: "twoWayAnova",
    params: {},
    inputs: {},
    resultCache: null,
    resultStale: false,
  };
}

describe("run-analysis: grouped valid types", () => {
  it("offers two-way ANOVA once a grouped table has 2 levels and 2 groups", () => {
    expect(validAnalysisTypes(referenceContent())).toEqual(["twoWayAnova"]);
  });
});

describe("run-analysis: two-way ANOVA through the grouped pipe", () => {
  it("reproduces the pinned SS decomposition for the reference design", () => {
    const out = runAnalysis(spec(), referenceContent());
    if (!out.ok || out.kind !== "twoWayAnova") throw new Error("expected two-way");
    const r = out as NormalizedTwoWayAnova & { ok: true };
    const A = r.table.find((t) => t.source === "Factor A")!;
    const B = r.table.find((t) => t.source === "Factor B")!;
    const I = r.table.find((t) => t.source === "Interaction")!;
    const E = r.table.find((t) => t.source === "Within (error)")!;
    // Row factor (Stage lo/hi): SSA = 90.75; Group factor: SSB = 18.75;
    // Interaction = 0.75; Error = 8 with df 8. Matches the engine reference.
    expect(A.ss).toBeCloseTo(90.75, 6);
    expect(B.ss).toBeCloseTo(18.75, 6);
    expect(I.ss).toBeCloseTo(0.75, 6);
    expect(E.ss).toBeCloseTo(8, 6);
    expect(E.df).toBe(8);
    expect(r.factorAName).toBe("Stage");
  });

  it("fails clearly when the table has no replication yet", () => {
    const c = referenceContent();
    // Collapse to one observation per cell (no error / interaction df).
    c.columns = c.columns.filter(
      (col) => col.role !== "y" || col.id.endsWith("-r1"),
    );
    const out = runAnalysis(spec(), c);
    expect(out.ok).toBe(false);
  });
});

describe("plot-spec: grouped bar chart", () => {
  it("lays out one cluster per row level and one bar per group", () => {
    const content = referenceContent();
    const style = { ...defaultPlotStyle(), kind: "groupedBar" as const, errorBar: "sd" as const };
    const geo = layoutGroupedBar(content, style);
    expect(geo.clusters).toHaveLength(2); // lo, hi
    for (const cluster of geo.clusters) {
      expect(cluster.bars).toHaveLength(2); // Vehicle, Drug
      // The first cluster's first bar (lo / Vehicle, mean 10) has positive height.
      expect(cluster.bars[0].height).toBeGreaterThan(0);
      // SD error bars are present (sd = 1 per cell).
      expect(cluster.bars[0].error).not.toBeNull();
    }
    expect(geo.legend.map((l) => l.name)).toEqual(["Vehicle", "Drug"]);
    const svg = renderGroupedBarSvg(geo, style);
    expect(svg.startsWith("<" + "svg")).toBe(true);
    expect(svg).toContain("<rect");
  });
});
