// import-xlsx.ts
//
// The binary half of Data Hub import. A .xlsx / .xls / .xlsm workbook is a zipped
// XML bundle, not text, so it needs a real workbook reader. We use exceljs for
// that, but import it LAZILY (a dynamic import) so the parser only loads when a
// user actually picks a workbook. The reader stays out of the main bundle and
// never weighs on a page that does not import Excel.
//
// What this module reads: cell VALUES, one sheet at a time, as a 2D grid of
// strings. For a formula cell it reads the cached result (the value Excel last
// computed and stored), falling back to the formula text only when no result was
// saved. From that grid it hands off to import-table.ts for header detection,
// type inference, and transpose, so a workbook import behaves identically to the
// CSV path once the grid is in hand. No logic is duplicated.
//
// Honest scope: we read DATA and re-plot it natively in Data Hub. We do NOT
// preserve embedded Excel charts, conditional formatting, or cell styles. A
// workbook with charts imports its numbers and the user re-creates the graph in
// Data Hub. That is intentional, not a gap to close.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { detectTable } from "@/lib/datahub/import-table";
import type { DetectedTable, DetectOptions } from "@/lib/datahub/import-table";
// Type-only import is erased at compile time, so it never pulls exceljs into the
// bundle. The runtime load is the dynamic import() inside parseXlsx.
import type { Worksheet } from "exceljs";

// ---------------------------------------------------------------------------
// Cell value -> string
// ---------------------------------------------------------------------------

/**
 * Render one exceljs cell value as the plain string the grid stores. exceljs
 * hands cells back as primitives for simple cells and as small tagged objects for
 * the rich kinds (formula, hyperlink, rich text, error, date). We unwrap each to
 * the human-visible text so downstream type inference sees the same string a CSV
 * export would carry.
 *
 * Formula cells are the load-bearing case: we take the cached RESULT (what Excel
 * computed and saved), and only fall back to the formula text when no result was
 * stored, so a numeric formula column infers as numbers rather than as "=A1+B1".
 */
function cellValueToString(value: unknown): string {
  if (value === null || value === undefined) return "";

  if (typeof value === "string") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    const v = value as Record<string, unknown>;

    // Formula cell: prefer the cached result, fall back to the formula text.
    if ("formula" in v || "sharedFormula" in v) {
      if ("result" in v && v.result !== null && v.result !== undefined) {
        return cellValueToString(v.result);
      }
      const f = (v.formula ?? v.sharedFormula) as unknown;
      return typeof f === "string" ? `=${f}` : "";
    }

    // Error cell (e.g. #DIV/0!) carries an { error } tag. Surface the code as
    // text so it is visible and editable rather than silently dropped.
    if ("error" in v && typeof v.error === "string") return v.error;

    // Hyperlink cell carries { text, hyperlink }; the text is what the user sees.
    if ("text" in v) {
      const t = v.text;
      if (typeof t === "string") return t;
      // Rich text arrives as { richText: [{ text }, ...] }.
      if (t && typeof t === "object" && "richText" in (t as object)) {
        return richTextToString((t as { richText: unknown }).richText);
      }
      return cellValueToString(t);
    }

    // Rich text cell at the top level.
    if ("richText" in v) return richTextToString(v.richText);
  }

  return String(value);
}

/** Flatten exceljs rich text ({ richText: [{ text }, ...] }) into plain text. */
function richTextToString(richText: unknown): string {
  if (!Array.isArray(richText)) return "";
  return richText
    .map((part) =>
      part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Trim trailing empties
// ---------------------------------------------------------------------------

/**
 * Drop fully-empty trailing rows and columns. exceljs reports dimensions out to
 * the furthest touched cell, so a sheet often carries a tail of blank rows or a
 * stray empty column past the data. Trimming them keeps detection focused on the
 * real block, the same way parseDelimited drops a trailing blank line. Interior
 * blank rows are LEFT in place so the multi-block warning still fires.
 */
function trimTrailingEmpty(grid: string[][]): string[][] {
  let rows = grid.map((r) => r.slice());

  // Drop trailing all-empty rows.
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) {
    rows.pop();
  }
  if (rows.length === 0) return [];

  // Drop trailing all-empty columns (every row blank in that column).
  let width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  while (width > 0 && rows.every((r) => (r[width - 1] ?? "") === "")) {
    width--;
  }

  // Normalize every row to the trimmed width (pad short rows, clip long ones).
  rows = rows.map((r) => {
    const out = r.slice(0, width);
    while (out.length < width) out.push("");
    return out;
  });

  return rows;
}

// ---------------------------------------------------------------------------
// Worksheet -> grid
// ---------------------------------------------------------------------------

/** One sheet's name plus its trimmed 2D grid of cell-value strings. */
export interface SheetGrid {
  name: string;
  grid: string[][];
}

/** The parsed workbook: the sheet list (in workbook order) the UI offers. */
export interface ParsedWorkbook {
  sheets: SheetGrid[];
}

/**
 * Read one exceljs worksheet into a rectangular grid of value strings. We walk
 * the reported row / column dimensions rather than only the cells exceljs chose
 * to materialize, so a blank cell in the middle of a block becomes "" instead of
 * shifting later columns left. Trailing empties are trimmed at the end.
 */
function worksheetToGrid(worksheet: Worksheet): string[][] {
  const rowCount = worksheet.rowCount ?? 0;
  const colCount = worksheet.columnCount ?? 0;
  const grid: string[][] = [];

  for (let r = 1; r <= rowCount; r++) {
    const row = worksheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= colCount; c++) {
      cells.push(cellValueToString(row.getCell(c).value));
    }
    grid.push(cells);
  }

  return trimTrailingEmpty(grid);
}

// ---------------------------------------------------------------------------
// Public parse
// ---------------------------------------------------------------------------

/**
 * Parse a binary workbook ArrayBuffer into its sheets. Loads exceljs lazily so
 * the reader is code-split out of the main bundle. Each sheet comes back as a
 * trimmed grid of value strings, in workbook order, so the UI can offer a sheet
 * picker when there is more than one. Embedded charts and styles are ignored by
 * design (Data Hub re-plots the data natively).
 */
export async function parseXlsx(data: ArrayBuffer): Promise<ParsedWorkbook> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);

  const sheets: SheetGrid[] = [];
  workbook.eachSheet((worksheet) => {
    sheets.push({
      name: worksheet.name,
      grid: worksheetToGrid(worksheet),
    });
  });

  return { sheets };
}

/**
 * Run the shared structure detection on one sheet's grid. This is the same
 * detectTable the CSV path uses, so header detection, type inference, and
 * transpose behave identically. Kept as a thin pass-through so a caller does not
 * have to import both modules.
 */
export function detectSheetTable(
  grid: string[][],
  opts: DetectOptions = {},
): DetectedTable {
  return detectTable(grid, opts);
}
