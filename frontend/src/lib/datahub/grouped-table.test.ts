import { describe, it, expect } from "vitest";

import type {
  DataHubDocContent,
  DataHubDocument,
  RowRecord,
} from "@/lib/datahub/model/types";
import {
  buildEmptyGroupedTable,
  groupDatasets,
  rowLabelColumn,
  rowFactorLevels,
  twoWayObservations,
  cellMean,
  DEFAULT_GROUPED_GROUPS,
  DEFAULT_GROUPED_REPLICATES,
} from "@/lib/datahub/grouped-table";

const META: DataHubDocument = {
  id: "1",
  name: "Two factor",
  project_ids: [],
  folder_path: null,
  table_type: "grouped",
  created_at: "2026-06-10T00:00:00.000Z",
};

function contentFrom(columns: DataHubContentColumns, rows: RowRecord[]): DataHubDocContent {
  return { meta: META, columns, rows, analyses: [], plots: [] };
}
type DataHubContentColumns = DataHubDocContent["columns"];

describe("grouped-table: empty seed", () => {
  it("seeds a row-label column plus groups of replicate subcolumns", () => {
    const { columns, rows } = buildEmptyGroupedTable();
    const label = columns[0];
    expect(label.role).toBe("x");
    expect(label.dataType).toBe("text");
    const replicates = columns.filter((c) => c.role === "y");
    expect(replicates).toHaveLength(
      DEFAULT_GROUPED_GROUPS * DEFAULT_GROUPED_REPLICATES,
    );
    // Every replicate carries a datasetId + subcolumnKind.
    for (const c of replicates) {
      expect(c.datasetId).toBeTruthy();
      expect(c.subcolumnKind).toBe("replicate");
    }
    expect(rows.length).toBeGreaterThan(0);
  });

  it("groups the replicate columns by datasetId", () => {
    const { columns, rows } = buildEmptyGroupedTable();
    const content = contentFrom(columns, rows);
    const groups = groupDatasets(content);
    expect(groups).toHaveLength(DEFAULT_GROUPED_GROUPS);
    for (const g of groups) {
      expect(g.replicateColumnIds).toHaveLength(DEFAULT_GROUPED_REPLICATES);
    }
    expect(rowLabelColumn(content)?.role).toBe("x");
  });
});

// The engine's pinned balanced 2x2x3 reference, entered through the grouped
// grid: two row levels (lo, hi) x two groups (Blo, Bhi) x 3 replicate columns.
// Cell means lo/lo=10, lo/hi=12, hi/lo=15, hi/hi=18 (deviations -1,0,+1).
function referenceContent(): DataHubDocContent {
  const columns: DataHubContentColumns = [
    { id: "rowlabel", name: "Row", role: "x", dataType: "text" },
    { id: "blo-r1", name: "Blo", role: "y", dataType: "number", datasetId: "grp-1", subcolumnKind: "replicate" },
    { id: "blo-r2", name: "Blo", role: "y", dataType: "number", datasetId: "grp-1", subcolumnKind: "replicate" },
    { id: "blo-r3", name: "Blo", role: "y", dataType: "number", datasetId: "grp-1", subcolumnKind: "replicate" },
    { id: "bhi-r1", name: "Bhi", role: "y", dataType: "number", datasetId: "grp-2", subcolumnKind: "replicate" },
    { id: "bhi-r2", name: "Bhi", role: "y", dataType: "number", datasetId: "grp-2", subcolumnKind: "replicate" },
    { id: "bhi-r3", name: "Bhi", role: "y", dataType: "number", datasetId: "grp-2", subcolumnKind: "replicate" },
  ];
  const rows: RowRecord[] = [
    { id: "r1", cells: { rowlabel: "lo", "blo-r1": 9, "blo-r2": 10, "blo-r3": 11, "bhi-r1": 11, "bhi-r2": 12, "bhi-r3": 13 } },
    { id: "r2", cells: { rowlabel: "hi", "blo-r1": 14, "blo-r2": 15, "blo-r3": 16, "bhi-r1": 17, "bhi-r2": 18, "bhi-r3": 19 } },
  ];
  return contentFrom(columns, rows);
}

describe("grouped-table: flattening to two-way observations", () => {
  const content = referenceContent();

  it("lists the row-factor levels in order", () => {
    expect(rowFactorLevels(content)).toEqual(["lo", "hi"]);
  });

  it("flattens to 12 (factorA, factorB, value) observations", () => {
    const obs = twoWayObservations(content);
    expect(obs).toHaveLength(12);
    // Spot check one cell.
    const loBlo = obs.filter((o) => o.factorA === "lo" && o.factorB === "Blo");
    expect(loBlo.map((o) => o.value).sort((a, b) => a - b)).toEqual([9, 10, 11]);
  });

  it("skips rows with a blank label", () => {
    const c = referenceContent();
    c.rows.push({ id: "r3", cells: { rowlabel: "", "blo-r1": 99 } });
    expect(twoWayObservations(c)).toHaveLength(12);
  });

  it("computes the cell mean + SD a bar chart would show", () => {
    const s = cellMean(content, "lo", "grp-1");
    expect(s.mean).toBeCloseTo(10, 9);
    expect(s.n).toBe(3);
    expect(s.sd).toBeCloseTo(1, 9);
  });
});
