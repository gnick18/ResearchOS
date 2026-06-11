import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  parseDelimited,
  transposeGrid,
  looksNumeric,
  detectHeader,
  inferColumnType,
  detectTable,
  importTextToTable,
  isXlsxFile,
} from "@/lib/datahub/import-table";

/**
 * Data Hub import parser pins. The parser is the zero-dependency half of import:
 * paste-from-Excel (tab-separated) and CSV / TSV text. Every common case is
 * pinned deterministically, plus the map onto a Column table that flows through
 * the same shape the store seed consumes.
 */

describe("detectDelimiter", () => {
  it("detects tab for Excel / Sheets clipboard data", () => {
    expect(detectDelimiter("Control\tDrug A\n10\t55")).toBe("\t");
  });

  it("detects comma for CSV", () => {
    expect(detectDelimiter("Control,Drug A\n10,55")).toBe(",");
  });

  it("defaults to comma for a single column (no delimiter present)", () => {
    expect(detectDelimiter("10\n20\n30")).toBe(",");
  });

  it("ignores commas inside quoted fields when choosing", () => {
    // Two real tab columns, plus a comma that lives only inside a quoted cell.
    expect(detectDelimiter('"a, b"\tx\n1\t2')).toBe("\t");
  });

  it("strips a leading BOM before counting", () => {
    expect(detectDelimiter("﻿a,b\n1,2")).toBe(",");
  });
});

describe("parseDelimited", () => {
  it("parses a simple TSV grid", () => {
    const { delimiter, grid } = parseDelimited("a\tb\n1\t2\n3\t4");
    expect(delimiter).toBe("\t");
    expect(grid).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("parses a simple CSV grid", () => {
    const { grid } = parseDelimited("a,b\n1,2");
    expect(grid).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a comma inside a quoted field", () => {
    const { grid } = parseDelimited('name,note\nAlice,"hello, world"');
    expect(grid).toEqual([
      ["name", "note"],
      ["Alice", "hello, world"],
    ]);
  });

  it("keeps a newline inside a quoted field", () => {
    const { grid } = parseDelimited('a,b\n"line1\nline2",2');
    expect(grid).toEqual([
      ["a", "b"],
      ["line1\nline2", "2"],
    ]);
  });

  it("decodes a doubled quote to a single quote", () => {
    const { grid } = parseDelimited('a\n"she said ""hi"""');
    expect(grid).toEqual([["a"], ['she said "hi"']]);
  });

  it("handles CRLF line endings", () => {
    const { grid } = parseDelimited("a,b\r\n1,2\r\n3,4");
    expect(grid).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("drops a trailing blank line from a trailing newline", () => {
    const { grid } = parseDelimited("a,b\n1,2\n");
    expect(grid).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("right-pads short rows so the grid is rectangular", () => {
    const { grid } = parseDelimited("a,b,c\n1,2");
    expect(grid).toEqual([
      ["a", "b", "c"],
      ["1", "2", ""],
    ]);
  });

  it("honors a forced delimiter", () => {
    // A comma is real text here; force tab so the row stays one column.
    const { grid } = parseDelimited("a,b\n1,2", "\t");
    expect(grid).toEqual([["a,b"], ["1,2"]]);
  });
});

describe("transposeGrid", () => {
  it("swaps rows and columns", () => {
    expect(
      transposeGrid([
        ["a", "b", "c"],
        ["1", "2", "3"],
      ]),
    ).toEqual([
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
    ]);
  });

  it("returns an empty grid unchanged", () => {
    expect(transposeGrid([])).toEqual([]);
  });
});

describe("looksNumeric", () => {
  it("treats finite numbers as numeric and blanks / text as not", () => {
    expect(looksNumeric("10")).toBe(true);
    expect(looksNumeric("-3.5")).toBe(true);
    expect(looksNumeric("1e3")).toBe(true);
    expect(looksNumeric("")).toBe(false);
    expect(looksNumeric("  ")).toBe(false);
    expect(looksNumeric("Control")).toBe(false);
  });
});

describe("detectHeader", () => {
  it("detects a text label row over numeric data", () => {
    expect(
      detectHeader([
        ["Control", "Drug A"],
        ["10", "55"],
        ["20", "60"],
      ]),
    ).toBe(true);
  });

  it("does NOT treat an all-numeric first row as a header", () => {
    expect(
      detectHeader([
        ["10", "55"],
        ["20", "60"],
      ]),
    ).toBe(false);
  });

  it("does not call a single row a header", () => {
    expect(detectHeader([["Control", "Drug A"]])).toBe(false);
  });

  it("requires the body to hold a number (all-text grids are not headered)", () => {
    expect(
      detectHeader([
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toBe(false);
  });
});

describe("inferColumnType", () => {
  it("calls an all-numeric column number, ignoring blanks", () => {
    expect(inferColumnType(["10", "", "20"])).toBe("number");
  });

  it("calls a column with any non-numeric value text", () => {
    expect(inferColumnType(["10", "n/a", "20"])).toBe("text");
  });
});

describe("detectTable", () => {
  it("maps a headered numeric block to named numeric group columns", () => {
    const grid = [
      ["Control", "Drug A"],
      ["10", "55"],
      ["20", "60"],
      ["30", "50"],
    ];
    const t = detectTable(grid);
    expect(t.headerUsed).toBe(true);
    expect(t.columns).toEqual([
      { id: "col-1", name: "Control", role: "y", dataType: "number" },
      { id: "col-2", name: "Drug A", role: "y", dataType: "number" },
    ]);
    expect(t.rows).toEqual([
      { id: "row-1", cells: { "col-1": 10, "col-2": 55 } },
      { id: "row-2", cells: { "col-1": 20, "col-2": 60 } },
      { id: "row-3", cells: { "col-1": 30, "col-2": 50 } },
    ]);
  });

  it("names columns Group N when there is no header", () => {
    const t = detectTable([
      ["10", "55"],
      ["20", "60"],
    ]);
    expect(t.headerUsed).toBe(false);
    expect(t.columns.map((c) => c.name)).toEqual(["Group 1", "Group 2"]);
    expect(t.rows).toEqual([
      { id: "row-1", cells: { "col-1": 10, "col-2": 55 } },
      { id: "row-2", cells: { "col-1": 20, "col-2": 60 } },
    ]);
  });

  it("infers a text column and keeps its string cells", () => {
    const t = detectTable([
      ["Sample", "Value"],
      ["A", "10"],
      ["B", "20"],
    ]);
    expect(t.columns[0].dataType).toBe("text");
    expect(t.columns[1].dataType).toBe("number");
    expect(t.rows[0].cells["col-1"]).toBe("A");
    expect(t.rows[0].cells["col-2"]).toBe(10);
  });

  it("stores a blank cell as null", () => {
    const t = detectTable([
      ["g1", "g2"],
      ["10", ""],
    ]);
    expect(t.rows[0].cells["col-2"]).toBeNull();
  });

  it("transposes before mapping when asked", () => {
    // Groups laid across a row instead of down a column.
    const grid = [
      ["Control", "10", "20", "30"],
      ["Drug A", "55", "60", "50"],
    ];
    const t = detectTable(grid, { transpose: true, header: true });
    expect(t.transposed).toBe(true);
    expect(t.columns.map((c) => c.name)).toEqual(["Control", "Drug A"]);
    expect(t.rows.map((r) => r.cells["col-1"])).toEqual([10, 20, 30]);
    expect(t.rows.map((r) => r.cells["col-2"])).toEqual([55, 60, 50]);
  });

  it("honors a forced header override of false on a label-looking grid", () => {
    const grid = [
      ["Control", "Drug A"],
      ["10", "55"],
    ];
    const t = detectTable(grid, { header: false });
    expect(t.headerUsed).toBe(false);
    expect(t.columns.map((c) => c.name)).toEqual(["Group 1", "Group 2"]);
    // The label row is now a (text) data row.
    expect(t.rows[0].cells["col-1"]).toBe("Control");
  });

  it("returns an empty table for an empty grid", () => {
    expect(detectTable([])).toEqual({
      columns: [],
      rows: [],
      headerUsed: false,
      transposed: false,
    });
  });
});

describe("importTextToTable (full pipeline)", () => {
  it("turns a pasted TSV block into a Column table", () => {
    const text = "Control\tDrug A\n10\t55\n20\t60\n30\t50";
    const t = importTextToTable(text);
    expect(t.delimiter).toBe("\t");
    expect(t.headerUsed).toBe(true);
    expect(t.columns.map((c) => c.name)).toEqual(["Control", "Drug A"]);
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0].cells["col-1"]).toBe(10);
  });

  it("turns a CSV file's text into a Column table", () => {
    const text = "x,y\n1,2\n3,4\n";
    const t = importTextToTable(text);
    expect(t.delimiter).toBe(",");
    expect(t.rows).toEqual([
      { id: "row-1", cells: { "col-1": 1, "col-2": 2 } },
      { id: "row-2", cells: { "col-1": 3, "col-2": 4 } },
    ]);
  });

  it("round-trips quoted commas through the full pipeline", () => {
    // A numeric column makes the first row read as a header; the quoted-comma
    // text column then carries its comma intact into the body cells.
    const text = 'note,value\n"x, y",10\n"z",20';
    const t = importTextToTable(text);
    expect(t.headerUsed).toBe(true);
    expect(t.columns.map((c) => c.name)).toEqual(["note", "value"]);
    expect(t.columns[0].dataType).toBe("text");
    expect(t.columns[1].dataType).toBe("number");
    expect(t.rows[0].cells["col-1"]).toBe("x, y");
    expect(t.rows[0].cells["col-2"]).toBe(10);
  });
});

describe("isXlsxFile", () => {
  it("flags binary workbook extensions and mime types", () => {
    expect(isXlsxFile({ name: "data.xlsx" })).toBe(true);
    expect(isXlsxFile({ name: "old.xls" })).toBe(true);
    expect(
      isXlsxFile({
        name: "noext",
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toBe(true);
  });

  it("does not flag csv / tsv / txt", () => {
    expect(isXlsxFile({ name: "data.csv", type: "text/csv" })).toBe(false);
    expect(isXlsxFile({ name: "data.tsv" })).toBe(false);
    expect(isXlsxFile({ name: "data.txt", type: "text/plain" })).toBe(false);
  });
});
