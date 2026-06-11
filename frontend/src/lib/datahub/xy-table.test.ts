import { describe, it, expect } from "vitest";

import type {
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";
import {
  buildEmptyXYTable,
  xColumn,
  yColumns,
  xyPairs,
  pairCount,
  isXYTable,
  DEFAULT_XY_ROWS,
} from "@/lib/datahub/xy-table";

const META: DataHubDocument = {
  id: "1",
  name: "Dose response",
  project_ids: [],
  folder_path: null,
  table_type: "xy",
  created_at: "2026-06-10T00:00:00.000Z",
};

/** Build an XY content from a single X column and one or more named Y columns. */
function xyContent(
  x: (number | null)[],
  ys: { id: string; name: string; values: (number | null)[] }[],
): DataHubDocContent {
  const columns = [
    { id: "x", name: "X", role: "x" as const, dataType: "number" as const },
    ...ys.map((y) => ({
      id: y.id,
      name: y.name,
      role: "y" as const,
      dataType: "number" as const,
    })),
  ];
  const rows = x.map((xv, i) => {
    const cells: Record<string, number | string | null> = { x: xv };
    for (const y of ys) cells[y.id] = y.values[i] ?? null;
    return { id: `row-${i + 1}`, cells };
  });
  return { meta: META, columns, rows, analyses: [], plots: [] };
}

describe("xy-table: empty seed", () => {
  it("seeds one X column, one Y column, and the default row count", () => {
    const { columns, rows } = buildEmptyXYTable();
    expect(columns).toHaveLength(2);
    expect(columns[0].role).toBe("x");
    expect(columns[0].name).toBe("X");
    expect(columns[1].role).toBe("y");
    expect(columns[1].name).toBe("Y");
    expect(rows).toHaveLength(DEFAULT_XY_ROWS);
    // Every cell starts null.
    for (const row of rows) {
      for (const col of columns) expect(row.cells[col.id]).toBeNull();
    }
  });

  it("seeds numbered Y columns when more than one is requested", () => {
    const { columns } = buildEmptyXYTable(3);
    expect(columns.map((c) => c.name)).toEqual(["X", "Y1", "Y2", "Y3"]);
  });
});

describe("xy-table: column resolution", () => {
  const content = xyContent(
    [1, 2, 3],
    [{ id: "y1", name: "Signal", values: [10, 20, 30] }],
  );

  it("finds the single X column and the Y columns", () => {
    expect(xColumn(content)?.id).toBe("x");
    expect(yColumns(content)).toEqual([{ id: "y1", name: "Signal" }]);
  });

  it("reports an XY table by its table_type", () => {
    expect(isXYTable(content)).toBe(true);
  });
});

describe("xy-table: pairing", () => {
  it("pairs an X with its Y row by row", () => {
    const content = xyContent(
      [1, 2, 3],
      [{ id: "y1", name: "Y", values: [2, 4, 6] }],
    );
    const p = xyPairs(content, "y1");
    expect(p.x).toEqual([1, 2, 3]);
    expect(p.y).toEqual([2, 4, 6]);
  });

  it("drops a row when either the X or the Y cell is missing", () => {
    const content = xyContent(
      [1, null, 3, 4],
      [{ id: "y1", name: "Y", values: [10, 20, null, 40] }],
    );
    // Row 2 has no X, row 3 has no Y, so only rows 1 and 4 pair.
    const p = xyPairs(content, "y1");
    expect(p.x).toEqual([1, 4]);
    expect(p.y).toEqual([10, 40]);
    expect(pairCount(content, "y1")).toBe(2);
  });

  it("parses numeric strings and skips non-numeric junk", () => {
    const content = xyContent(
      [1, 2, 3],
      [{ id: "y1", name: "Y", values: ["2.5" as unknown as number, "bad" as unknown as number, 6] }],
    );
    const p = xyPairs(content, "y1");
    expect(p.x).toEqual([1, 3]);
    expect(p.y).toEqual([2.5, 6]);
  });
});
