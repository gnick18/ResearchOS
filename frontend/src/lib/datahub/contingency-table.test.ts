// Resolver tests for the Contingency table view model: the empty-table seed, the
// grid -> count matrix resolution (ignoring blank and excluded cells), and the
// has-data guard.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";

import type {
  CellValue,
  DataHubDocContent,
  DataHubDocument,
  RowRecord,
} from "@/lib/datahub/model/types";
import {
  buildEmptyContingencyTable,
  ROW_LABEL_COLUMN_ID,
  rowLabelColumn,
  countColumns,
  contingencyMatrix,
  hasContingencyData,
  isContingencyTable,
} from "@/lib/datahub/contingency-table";

const META: DataHubDocument = {
  id: "1",
  name: "Exposure by outcome",
  project_ids: [],
  folder_path: null,
  table_type: "contingency",
  created_at: "2026-06-12T00:00:00.000Z",
};

function content(
  rows: RowRecord[],
  excludedCells: string[] = [],
): DataHubDocContent {
  const { columns } = buildEmptyContingencyTable(0, 2);
  return {
    meta: { ...META, excludedCells },
    columns,
    rows,
    analyses: [],
    plots: [],
  };
}

function row(id: string, label: string, ...counts: CellValue[]): RowRecord {
  const cells: Record<string, CellValue> = { [ROW_LABEL_COLUMN_ID]: label };
  counts.forEach((c, j) => {
    cells[`col-${j + 1}`] = c;
  });
  return { id, cells };
}

describe("contingency-table: empty seed", () => {
  it("seeds a 2x2 grid with a row-label column and two count columns", () => {
    const { columns, rows } = buildEmptyContingencyTable();
    expect(columns[0].id).toBe(ROW_LABEL_COLUMN_ID);
    expect(columns[0].role).toBe("x");
    expect(countColumns({ ...content([]), columns }).length).toBe(2);
    expect(rows.length).toBe(2);
    // Every count cell is seeded to 0.
    for (const r of rows) {
      expect(r.cells["col-1"]).toBe(0);
      expect(r.cells["col-2"]).toBe(0);
    }
  });

  it("seeds R x C dimensions when asked", () => {
    const { columns, rows } = buildEmptyContingencyTable(3, 4);
    expect(columns.filter((c) => c.role === "y").length).toBe(4);
    expect(rows.length).toBe(3);
  });
});

describe("contingency-table: matrix resolution", () => {
  it("reads the grid into a row-major count matrix with labels", () => {
    const c = content([
      row("r1", "Exposed", 30, 10),
      row("r2", "Not exposed", 12, 28),
    ]);
    const m = contingencyMatrix(c);
    expect(m.rowLabels).toEqual(["Exposed", "Not exposed"]);
    expect(m.colLabels).toEqual(["Outcome 1", "Outcome 2"]);
    expect(m.matrix).toEqual([
      [30, 10],
      [12, 28],
    ]);
  });

  it("reads a blank or non-numeric count as 0", () => {
    const c = content([
      row("r1", "A", 5, null),
      row("r2", "B", "", "oops"),
    ]);
    const m = contingencyMatrix(c);
    expect(m.matrix).toEqual([
      [5, 0],
      [0, 0],
    ]);
  });

  it("reads a numeric string count", () => {
    const c = content([
      row("r1", "A", "7", 3),
      row("r2", "B", 2, 8),
    ]);
    expect(contingencyMatrix(c).matrix).toEqual([
      [7, 3],
      [2, 8],
    ]);
  });

  it("treats an excluded count cell as 0", () => {
    const c = content(
      [
        row("r1", "A", 30, 10),
        row("r2", "B", 12, 28),
      ],
      ["r1:col-2"],
    );
    expect(contingencyMatrix(c).matrix).toEqual([
      [30, 0],
      [12, 28],
    ]);
  });

  it("falls back to a positional row label when the label cell is blank", () => {
    const c = content([
      row("r1", "", 1, 2),
      row("r2", "B", 3, 4),
    ]);
    expect(contingencyMatrix(c).rowLabels).toEqual(["Row 1", "B"]);
  });
});

describe("contingency-table: guards", () => {
  it("hasContingencyData is true only with a positive count", () => {
    expect(
      hasContingencyData(
        content([row("r1", "A", 0, 0), row("r2", "B", 0, 0)]),
      ),
    ).toBe(false);
    expect(
      hasContingencyData(
        content([row("r1", "A", 0, 1), row("r2", "B", 0, 0)]),
      ),
    ).toBe(true);
  });

  it("isContingencyTable reads the table_type", () => {
    expect(isContingencyTable(content([]))).toBe(true);
  });

  it("rowLabelColumn resolves the role-x column", () => {
    expect(rowLabelColumn(content([]))?.id).toBe(ROW_LABEL_COLUMN_ID);
  });
});
