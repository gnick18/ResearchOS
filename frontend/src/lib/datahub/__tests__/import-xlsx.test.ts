import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  parseXlsx,
  detectSheetTable,
  type ParsedWorkbook,
} from "@/lib/datahub/import-xlsx";

/**
 * Data Hub binary-import pins. parseXlsx is the .xlsx half of import: it reads a
 * workbook's cell values (and cached formula results) into a 2D grid of strings,
 * then hands off to the SAME detectTable the CSV path uses. Every case is pinned
 * deterministically by writing a workbook to a buffer in the test, then reading
 * it back, so there is no fixture file to drift.
 *
 * Honest scope note baked into the tests: we assert VALUES and formula RESULTS.
 * We do not assert charts or styles, because the parser intentionally ignores
 * them (the user re-plots in Data Hub).
 */

/** Write a workbook to an ArrayBuffer parseXlsx can read. */
async function toBuffer(wb: ExcelJS.Workbook): Promise<ArrayBuffer> {
  const buf = await wb.xlsx.writeBuffer();
  // exceljs returns a Node Buffer here; hand parseXlsx the exact bytes.
  return buf as ArrayBuffer;
}

/** Build a single-sheet workbook with a header row over numeric / text data. */
async function singleSheetBuffer(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Assay");
  ws.addRow(["Control", "Drug A", "Label"]);
  ws.addRow([10, 55, "a"]);
  ws.addRow([20, 60, "b"]);
  return toBuffer(wb);
}

describe("parseXlsx single sheet", () => {
  it("reads the grid as strings with one sheet listed", async () => {
    const parsed = await parseXlsx(await singleSheetBuffer());
    expect(parsed.sheets).toHaveLength(1);
    expect(parsed.sheets[0].name).toBe("Assay");
    expect(parsed.sheets[0].grid).toEqual([
      ["Control", "Drug A", "Label"],
      ["10", "55", "a"],
      ["20", "60", "b"],
    ]);
  });

  it("maps the chosen sheet onto a Column table identically to the CSV path", async () => {
    const parsed = await parseXlsx(await singleSheetBuffer());
    const table = detectSheetTable(parsed.sheets[0].grid);

    // Header row consumed, two numeric columns plus a text column.
    expect(table.headerUsed).toBe(true);
    expect(table.transposed).toBe(false);
    expect(table.columns.map((c) => c.name)).toEqual([
      "Control",
      "Drug A",
      "Label",
    ]);
    expect(table.columns.map((c) => c.dataType)).toEqual([
      "number",
      "number",
      "text",
    ]);

    // Two body rows, numbers stored as numbers, text stored as text.
    expect(table.rows).toHaveLength(2);
    const [c0, c1, c2] = table.columns.map((c) => c.id);
    expect(table.rows[0].cells[c0]).toBe(10);
    expect(table.rows[0].cells[c1]).toBe(55);
    expect(table.rows[0].cells[c2]).toBe("a");
    expect(table.rows[1].cells[c0]).toBe(20);
  });

  it("honors a transpose request through the shared detector", async () => {
    const parsed = await parseXlsx(await singleSheetBuffer());
    const table = detectSheetTable(parsed.sheets[0].grid, { transpose: true });
    expect(table.transposed).toBe(true);
    // Transposed, the first column becomes a row, so the shape changes.
    expect(table.columns.length).toBe(parsed.sheets[0].grid.length);
  });
});

describe("parseXlsx formula cells", () => {
  it("reads the cached formula RESULT, not the formula text", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Calc");
    ws.addRow(["A", "B", "Sum"]);
    ws.addRow([2, 3, { formula: "A2+B2", result: 5 }]);
    ws.addRow([10, 7, { formula: "A3+B3", result: 17 }]);

    const parsed = await parseXlsx(await toBuffer(wb));
    expect(parsed.sheets[0].grid).toEqual([
      ["A", "B", "Sum"],
      ["2", "3", "5"],
      ["10", "7", "17"],
    ]);

    // The Sum column infers numeric from the cached results.
    const table = detectSheetTable(parsed.sheets[0].grid);
    const sumCol = table.columns[2];
    expect(sumCol.dataType).toBe("number");
    expect(table.rows[0].cells[sumCol.id]).toBe(5);
    expect(table.rows[1].cells[sumCol.id]).toBe(17);
  });

  it("falls back to the formula text when no result was cached", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("NoResult");
    ws.addRow(["X"]);
    // A formula with no cached result (a workbook saved without recalculation).
    ws.getCell("A2").value = { formula: "1+1" } as ExcelJS.CellValue;

    const parsed = await parseXlsx(await toBuffer(wb));
    expect(parsed.sheets[0].grid).toEqual([["X"], ["=1+1"]]);
  });
});

describe("parseXlsx multiple sheets", () => {
  it("lists every sheet in workbook order with its own grid", async () => {
    const wb = new ExcelJS.Workbook();
    const a = wb.addWorksheet("First");
    a.addRow(["p", "q"]);
    a.addRow([1, 2]);
    const b = wb.addWorksheet("Second");
    b.addRow(["m"]);
    b.addRow([9]);
    b.addRow([8]);

    const parsed: ParsedWorkbook = await parseXlsx(await toBuffer(wb));
    expect(parsed.sheets.map((s) => s.name)).toEqual(["First", "Second"]);
    expect(parsed.sheets[0].grid).toEqual([
      ["p", "q"],
      ["1", "2"],
    ]);
    expect(parsed.sheets[1].grid).toEqual([["m"], ["9"], ["8"]]);
  });
});

describe("parseXlsx trailing-empty trimming", () => {
  it("drops trailing empty rows and columns but keeps interior blanks", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Trim");
    ws.addRow(["a", "b", ""]); // a trailing empty column
    ws.addRow([1, 2, ""]);
    ws.addRow(["", "", ""]); // an interior blank row (kept)
    ws.addRow([3, 4, ""]);
    ws.addRow(["", "", ""]); // trailing blank row (dropped)
    ws.addRow(["", "", ""]); // trailing blank row (dropped)

    const parsed = await parseXlsx(await toBuffer(wb));
    // Trailing empty column trimmed, trailing blank rows dropped, interior kept.
    expect(parsed.sheets[0].grid).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["", ""],
      ["3", "4"],
    ]);
  });

  it("pads short interior rows so the grid stays rectangular", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Ragged");
    ws.addRow(["a", "b", "c"]);
    ws.addRow([1, 2]); // short row, exceljs leaves the 3rd cell empty
    const parsed = await parseXlsx(await toBuffer(wb));
    expect(parsed.sheets[0].grid).toEqual([
      ["a", "b", "c"],
      ["1", "2", ""],
    ]);
  });
});

describe("parseXlsx value kinds", () => {
  it("renders booleans and avoids dropping non-numeric labels", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Kinds");
    ws.addRow(["flag", "note"]);
    ws.addRow([true, "ok"]);
    ws.addRow([false, "bad"]);
    const parsed = await parseXlsx(await toBuffer(wb));
    expect(parsed.sheets[0].grid).toEqual([
      ["flag", "note"],
      ["TRUE", "ok"],
      ["FALSE", "bad"],
    ]);
  });
});
