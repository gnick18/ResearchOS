// Tests for the grid row/column CRUD core (grid-crud phase 2a). Covers the pure
// guard + builder helpers, plus the doc-level mutators that drop a column's cells
// and insert at a position. The page handlers are thin wrappers around these, so
// the guards and shapes proven here are the behavior the right-click menus get.

import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";

import type {
  ColumnDef,
  DataHubDocContent,
  DataHubDocument,
  DataHubTableType,
  RowRecord,
} from "@/lib/datahub/model/types";
import {
  buildBlankColumn,
  buildBlankRow,
  buildDuplicateColumn,
  canDeleteColumn,
  canDeleteRow,
  canRenameColumn,
  columnIndex,
  columnNoun,
  dataColumns,
  isStructuralColumn,
  mintRowId,
  rowIndex,
  rowNoun,
} from "@/lib/datahub/grid-crud";
import {
  seedDataHubDoc,
  getDataHubContent,
  addRowAt,
  addColumnAt,
  removeColumnWithCells,
} from "@/lib/loro/datahub-doc";

// --- fixtures --------------------------------------------------------------

function meta(table_type: DataHubTableType): DataHubDocument {
  return {
    id: "t1",
    name: "Test",
    project_ids: [],
    folder_path: null,
    table_type,
    created_at: "2026-06-11T00:00:00.000Z",
  };
}

function content(
  table_type: DataHubTableType,
  columns: ColumnDef[],
  rows: RowRecord[],
): DataHubDocContent {
  return { meta: meta(table_type), columns, rows, analyses: [], plots: [] };
}

function columnTable(): DataHubDocContent {
  const columns: ColumnDef[] = [
    { id: "c1", name: "Group 1", role: "y", dataType: "number" },
    { id: "c2", name: "Group 2", role: "y", dataType: "number" },
  ];
  const rows: RowRecord[] = [
    { id: "r1", cells: { c1: 1, c2: 4 } },
    { id: "r2", cells: { c1: 2, c2: 5 } },
  ];
  return content("column", columns, rows);
}

function xyTable(): DataHubDocContent {
  const columns: ColumnDef[] = [
    { id: "x1", name: "X", role: "x", dataType: "number" },
    { id: "y1", name: "Y", role: "y", dataType: "number" },
  ];
  const rows: RowRecord[] = [{ id: "r1", cells: { x1: 1, y1: 10 } }];
  return content("xy", columns, rows);
}

function groupedTable(): DataHubDocContent {
  const columns: ColumnDef[] = [
    { id: "rowlabel", name: "Row", role: "x", dataType: "text" },
    { id: "g1-r1", name: "Group 1", role: "y", dataType: "number", datasetId: "g1", subcolumnKind: "replicate" },
    { id: "g2-r1", name: "Group 2", role: "y", dataType: "number", datasetId: "g2", subcolumnKind: "replicate" },
  ];
  const rows: RowRecord[] = [{ id: "r1", cells: { rowlabel: "A", "g1-r1": 1, "g2-r1": 2 } }];
  return content("grouped", columns, rows);
}

// --- label helpers ---------------------------------------------------------

describe("label helpers", () => {
  it("column noun is type-aware", () => {
    expect(columnNoun("column")).toBe("group");
    expect(columnNoun("grouped")).toBe("group");
    expect(columnNoun("xy")).toBe("Y column");
  });

  it("row noun calls a survival row a subject", () => {
    expect(rowNoun("survival")).toBe("subject");
    expect(rowNoun("column")).toBe("row");
    expect(rowNoun("xy")).toBe("row");
  });
});

// --- data columns + structural axes ----------------------------------------

describe("dataColumns / isStructuralColumn", () => {
  it("a column table exposes every column as data", () => {
    const c = columnTable();
    expect(dataColumns(c).map((col) => col.id)).toEqual(["c1", "c2"]);
  });

  it("an XY table excludes the X column from data columns", () => {
    const c = xyTable();
    expect(dataColumns(c).map((col) => col.id)).toEqual(["y1"]);
    expect(isStructuralColumn(c.columns[0])).toBe(true);
    expect(isStructuralColumn(c.columns[1])).toBe(false);
  });

  it("a grouped table excludes the row-label column from data columns", () => {
    const c = groupedTable();
    expect(dataColumns(c).map((col) => col.id)).toEqual(["g1-r1", "g2-r1"]);
  });
});

// --- delete-column guard ---------------------------------------------------

describe("canDeleteColumn", () => {
  it("allows deleting a data column when more than one remains", () => {
    expect(canDeleteColumn(columnTable(), "c1")).toBe(true);
  });

  it("blocks deleting the last remaining data column", () => {
    const c = content(
      "column",
      [{ id: "c1", name: "Group 1", role: "y", dataType: "number" }],
      [{ id: "r1", cells: { c1: 1 } }],
    );
    expect(canDeleteColumn(c, "c1")).toBe(false);
  });

  it("blocks deleting the X column of an XY table", () => {
    expect(canDeleteColumn(xyTable(), "x1")).toBe(false);
  });

  it("blocks deleting the only Y column of an XY table", () => {
    // x1 is structural, y1 is the lone data column, so y1 is not deletable either.
    expect(canDeleteColumn(xyTable(), "y1")).toBe(false);
  });

  it("blocks deleting the row-label column of a grouped table", () => {
    expect(canDeleteColumn(groupedTable(), "rowlabel")).toBe(false);
  });

  it("is a no-op false for an unknown column id", () => {
    expect(canDeleteColumn(columnTable(), "nope")).toBe(false);
  });
});

// --- rename-column guard ---------------------------------------------------

describe("canRenameColumn", () => {
  it("allows renaming a data column", () => {
    expect(canRenameColumn(columnTable(), "c1")).toBe(true);
  });

  it("blocks renaming the X column of an XY table as a data column", () => {
    expect(canRenameColumn(xyTable(), "x1")).toBe(false);
  });

  it("blocks renaming the grouped row-label column as a data column", () => {
    expect(canRenameColumn(groupedTable(), "rowlabel")).toBe(false);
  });
});

// --- delete-row guard ------------------------------------------------------

describe("canDeleteRow", () => {
  it("allows deleting a row when more than one remains", () => {
    expect(canDeleteRow(columnTable())).toBe(true);
  });

  it("blocks deleting the last remaining row", () => {
    const c = content(
      "column",
      [{ id: "c1", name: "Group 1", role: "y", dataType: "number" }],
      [{ id: "r1", cells: { c1: 1 } }],
    );
    expect(canDeleteRow(c)).toBe(false);
  });
});

// --- blank-row / blank-column builders -------------------------------------

describe("buildBlankRow", () => {
  it("gives every column a null cell", () => {
    const row = buildBlankRow(columnTable(), "rNew");
    expect(row.id).toBe("rNew");
    expect(row.cells).toEqual({ c1: null, c2: null });
  });

  it("includes structural columns so an XY blank row has the X cell", () => {
    const row = buildBlankRow(xyTable(), "rNew");
    expect(Object.keys(row.cells).sort()).toEqual(["x1", "y1"]);
  });
});

describe("buildBlankColumn", () => {
  it("names a column-table column Group N counting existing data columns", () => {
    const col = buildBlankColumn(columnTable(), "cNew");
    expect(col).toMatchObject({ id: "cNew", name: "Group 3", role: "y", dataType: "number" });
  });

  it("names an XY column Y N counting only Y data columns", () => {
    const col = buildBlankColumn(xyTable(), "cNew");
    expect(col).toMatchObject({ id: "cNew", name: "Y2", role: "y" });
  });
});

// --- duplicate-column ------------------------------------------------------

describe("buildDuplicateColumn", () => {
  it("copies role / type and suffixes the name", () => {
    const copy = buildDuplicateColumn(columnTable(), "c1", "cDup");
    expect(copy).toEqual({ id: "cDup", name: "Group 1 copy", role: "y", dataType: "number" });
  });

  it("carries datasetId and subcolumnKind for a grouped replicate column", () => {
    const copy = buildDuplicateColumn(groupedTable(), "g1-r1", "cDup");
    expect(copy).toMatchObject({
      id: "cDup",
      name: "Group 1 copy",
      datasetId: "g1",
      subcolumnKind: "replicate",
    });
  });

  it("returns null for an unknown source column", () => {
    expect(buildDuplicateColumn(columnTable(), "nope", "cDup")).toBeNull();
  });
});

// --- index helpers ---------------------------------------------------------

describe("index helpers", () => {
  it("columnIndex / rowIndex find declared positions", () => {
    const c = columnTable();
    expect(columnIndex(c, "c2")).toBe(1);
    expect(rowIndex(c, "r2")).toBe(1);
    expect(columnIndex(c, "nope")).toBe(-1);
    expect(rowIndex(c, "nope")).toBe(-1);
  });
});

// --- doc-level mutators (the commit-path primitives) -----------------------

function openSeed(c: DataHubDocContent): LoroDoc {
  const snapshot = seedDataHubDoc(c);
  const doc = new LoroDoc();
  doc.import(snapshot);
  return doc;
}

describe("removeColumnWithCells", () => {
  it("removes the column and drops its cell from every row", () => {
    const doc = openSeed(columnTable());
    removeColumnWithCells(doc, "c1");
    doc.commit();
    const out = getDataHubContent(doc, "t1");
    expect(out.columns.map((col) => col.id)).toEqual(["c2"]);
    for (const row of out.rows) {
      expect(Object.prototype.hasOwnProperty.call(row.cells, "c1")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(row.cells, "c2")).toBe(true);
    }
  });

  it("is a no-op when the column is absent", () => {
    const doc = openSeed(columnTable());
    removeColumnWithCells(doc, "nope");
    doc.commit();
    const out = getDataHubContent(doc, "t1");
    expect(out.columns.map((col) => col.id)).toEqual(["c1", "c2"]);
  });
});

describe("addColumnAt / addRowAt insert at a position", () => {
  it("inserts a column right after the source index", () => {
    const doc = openSeed(columnTable());
    const newCol: ColumnDef = { id: "cMid", name: "Group 1 copy", role: "y", dataType: "number" };
    // index 1 = right after c1 (index 0)
    addColumnAt(doc, newCol, 1);
    doc.commit();
    const out = getDataHubContent(doc, "t1");
    expect(out.columns.map((col) => col.id)).toEqual(["c1", "cMid", "c2"]);
  });

  it("clamps an out-of-range column index to an append", () => {
    const doc = openSeed(columnTable());
    const newCol: ColumnDef = { id: "cEnd", name: "Group 3", role: "y", dataType: "number" };
    addColumnAt(doc, newCol, 99);
    doc.commit();
    const out = getDataHubContent(doc, "t1");
    expect(out.columns.map((col) => col.id)).toEqual(["c1", "c2", "cEnd"]);
  });

  it("inserts a row at a position with the provided cells", () => {
    const doc = openSeed(columnTable());
    addRowAt(doc, { id: "rMid", cells: { c1: 9, c2: 9 } }, 1);
    doc.commit();
    const out = getDataHubContent(doc, "t1");
    expect(out.rows.map((row) => row.id)).toEqual(["r1", "rMid", "r2"]);
    const mid = out.rows.find((row) => row.id === "rMid");
    expect(mid?.cells).toMatchObject({ c1: 9, c2: 9 });
  });
});

describe("mintRowId mints unique ids even within one millisecond", () => {
  it("never collides across a rapid-fire burst (the Add-row stress test)", () => {
    // Simulate rapid-clicking Add row: many ids minted back to back, which used
    // to share a single Date.now() value and produce duplicate React keys.
    const ids = Array.from({ length: 500 }, () => mintRowId());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the on-disk row-id shape (a row- string prefix)", () => {
    expect(mintRowId()).toMatch(/^row-\d+-\d+$/);
  });
});

describe("duplicate-column copies values (end to end via doc)", () => {
  it("the copied column carries each row's source value", () => {
    const doc = openSeed(columnTable());
    const copy = buildDuplicateColumn(getDataHubContent(doc, "t1"), "c1", "cDup")!;
    const src = columnIndex(getDataHubContent(doc, "t1"), "c1");
    addColumnAt(doc, copy, src + 1);
    // copy each row's c1 value into cDup (the page handler does this via setCell)
    const live = getDataHubContent(doc, "t1");
    const rows = doc.getMovableList("rows");
    for (let i = 0; i < rows.length; i++) {
      const map = rows.get(i) as import("loro-crdt").LoroMap;
      const rowId = map.get("id") as string;
      const sourceRow = live.rows.find((r) => r.id === rowId)!;
      map.set("cDup", sourceRow.cells.c1 ?? null);
    }
    doc.commit();
    const out = getDataHubContent(doc, "t1");
    expect(out.columns.map((c) => c.id)).toEqual(["c1", "cDup", "c2"]);
    expect(out.rows.find((r) => r.id === "r1")?.cells.cDup).toBe(1);
    expect(out.rows.find((r) => r.id === "r2")?.cells.cDup).toBe(2);
  });
});
