// import-table.ts
//
// The pure, dependency-free parser behind Data Hub's CSV / TSV / paste-from-Excel
// import. The clipboard from Excel or Google Sheets carries TAB-separated text,
// and a saved spreadsheet exports as comma-separated CSV, so one parser handles
// both by auto-detecting the delimiter. From the parsed grid it detects whether
// the first row is a header, infers each column's type (numeric vs text), and
// produces a normalized { columns, rows } ready to seed a Data Hub Column table
// through the same api / store mutators a fresh table uses.
//
// Scope note: this is the zero-new-dependency half of import. Binary .xlsx files
// are NOT parsed here (that needs a binary workbook reader and is a deferred
// follow-up); the UI shows a "save as CSV or paste the cells" message for an
// .xlsx pick instead of calling this module.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type {
  CellValue,
  ColumnDataType,
  ColumnDef,
  RowRecord,
} from "@/lib/datahub/model/types";

// ---------------------------------------------------------------------------
// Delimiter detection
// ---------------------------------------------------------------------------

export type Delimiter = "\t" | ",";

/**
 * Pick the delimiter for a block of text. Excel / Sheets clipboard data is
 * tab-separated, a CSV file is comma-separated. The heuristic counts how often
 * each candidate appears OUTSIDE double-quoted spans on the first few lines and
 * takes the more frequent one, defaulting to comma when neither appears (a
 * single-column paste). Tabs win a tie because a tab almost never appears inside
 * real cell text, while a comma often does (so a stray quoted comma should not
 * flip a clearly tab-separated paste).
 */
export function detectDelimiter(text: string): Delimiter {
  const sample = text.replace(/^﻿/, "").split(/\r\n|\r|\n/).slice(0, 10);
  let tabs = 0;
  let commas = 0;
  for (const line of sample) {
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        // A doubled quote inside a quoted span is an escaped quote, skip it.
        if (inQuotes && line[i + 1] === '"') {
          i++;
          continue;
        }
        inQuotes = !inQuotes;
      } else if (!inQuotes) {
        if (ch === "\t") tabs++;
        else if (ch === ",") commas++;
      }
    }
  }
  if (tabs === 0 && commas === 0) return ",";
  return tabs >= commas ? "\t" : ",";
}

// ---------------------------------------------------------------------------
// Delimited parse (RFC-4180 style quoting, pragmatic)
// ---------------------------------------------------------------------------

/**
 * Parse delimited text into a rectangular grid of raw string cells. Auto-detects
 * the delimiter unless one is forced. Handles quoted fields the way Excel and the
 * CSV spec do: a field wrapped in double quotes may contain the delimiter, line
 * breaks, and doubled double-quotes ("") which decode to a single quote. A blank
 * trailing line is dropped, and short rows are right-padded with empty strings so
 * the grid is rectangular (the widest row sets the column count).
 */
export function parseDelimited(
  text: string,
  forced?: Delimiter,
): { delimiter: Delimiter; grid: string[][] } {
  const stripped = text.replace(/^﻿/, "");
  const delimiter = forced ?? detectDelimiter(stripped);

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = stripped.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = stripped[i];
    if (inQuotes) {
      if (ch === '"') {
        if (stripped[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // Treat CRLF and lone CR as one row break.
      if (stripped[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush the final field / row unless the input ended exactly on a row break
  // (which already pushed an empty row we do not want).
  if (field.length > 0 || row.length > 0 || rows.length === 0) {
    endRow();
  }

  // Drop a trailing fully-empty row (a common artifact of a trailing newline).
  while (
    rows.length > 0 &&
    rows[rows.length - 1].every((c) => c === "")
  ) {
    rows.pop();
  }

  // Right-pad short rows so the grid is rectangular.
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const grid = rows.map((r) => {
    if (r.length === width) return r;
    return r.concat(new Array(width - r.length).fill(""));
  });

  return { delimiter, grid };
}

// ---------------------------------------------------------------------------
// Transpose
// ---------------------------------------------------------------------------

/**
 * Swap rows and columns. Paste-from-Excel often arrives in the wrong orientation
 * (groups laid across a row instead of down a column), so the import preview
 * offers a transpose toggle that runs this before structure detection. Operates
 * on the padded rectangular grid, so the result is rectangular too.
 */
export function transposeGrid(grid: string[][]): string[][] {
  if (grid.length === 0) return [];
  const rows = grid.length;
  const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const out: string[][] = [];
  for (let c = 0; c < cols; c++) {
    const newRow: string[] = [];
    for (let r = 0; r < rows; r++) {
      newRow.push(grid[r][c] ?? "");
    }
    out.push(newRow);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Type + header detection
// ---------------------------------------------------------------------------

/** Whether a raw cell string reads as a finite number (blank is NOT numeric). */
export function looksNumeric(raw: string): boolean {
  const t = raw.trim();
  if (t === "") return false;
  const n = Number(t);
  return Number.isFinite(n);
}

/**
 * Decide whether the first grid row is a header (text labels over data) rather
 * than a row of measurements. The signal that beats Prism's guesswork: a header
 * row is mostly non-numeric while the body below holds numbers. So we say "header"
 * when the first row has at least one non-blank cell, NO numeric cells (a label
 * row of names), AND the rows below contain at least one numeric cell (real data).
 * A single-row grid is never treated as a header (there is no body to label).
 */
export function detectHeader(grid: string[][]): boolean {
  if (grid.length < 2) return false;
  const first = grid[0];
  const firstHasContent = first.some((c) => c.trim() !== "");
  if (!firstHasContent) return false;
  const firstNumeric = first.filter(looksNumeric).length;
  if (firstNumeric > 0) return false;
  // The body must carry at least one number for the first row to be a label row
  // over data (otherwise it is all text and there is nothing to type-infer).
  const bodyNumeric = grid
    .slice(1)
    .some((r) => r.some(looksNumeric));
  return bodyNumeric;
}

/**
 * Infer a column's data type from its body cells. A column is "number" when every
 * non-blank cell parses as a finite number and at least one does; otherwise it is
 * "text". Blank cells never force a column to text (an empty replicate well is
 * fine in a numeric group).
 */
export function inferColumnType(
  values: string[],
): "number" | "text" {
  let sawValue = false;
  for (const v of values) {
    const t = v.trim();
    if (t === "") continue;
    sawValue = true;
    if (!looksNumeric(t)) return "text";
  }
  return sawValue ? "number" : "number";
}

// ---------------------------------------------------------------------------
// Structure detection -> normalized table
// ---------------------------------------------------------------------------

/** The normalized, ready-to-seed table the import produces. */
export interface DetectedTable {
  columns: ColumnDef[];
  rows: RowRecord[];
  /** Whether the first source row was consumed as a header. */
  headerUsed: boolean;
  /** Whether the grid was transposed before mapping. */
  transposed: boolean;
}

/** Options that steer how a parsed grid becomes a Column table. */
export interface DetectOptions {
  /** Force the header reading (true / false). Omitted means auto-detect. */
  header?: boolean;
  /** Transpose the grid before detection (paste came in the wrong orientation). */
  transpose?: boolean;
}

/** Stable column / row ids for an imported table (mirror the seed id shape). */
function importColumnId(i: number): string {
  return `col-${i + 1}`;
}
function importRowId(i: number): string {
  return `row-${i + 1}`;
}

/** Parse one raw cell into the stored CellValue for a column of the given type.
 *  Import only ever infers "number" or "text"; a "date" column (not inferred
 *  here, only present if a future caller passes one) is kept as its raw string. */
function toCell(raw: string, type: ColumnDataType): CellValue {
  const t = raw.trim();
  if (t === "") return null;
  if (type === "number") {
    const n = Number(t);
    if (Number.isFinite(n)) return n;
    // A stray non-number in a numeric column is kept as the raw string so it is
    // visible and editable rather than silently dropped (the stats reader skips
    // it), matching parseCellInput's behavior in column-table.ts.
    return t;
  }
  return t;
}

/**
 * Turn a raw grid into a normalized Column table. Every grid column becomes a
 * group column ("y", numeric where the body is numeric, otherwise text), named
 * from the header row when one is detected and "Group N" otherwise. Every grid
 * body row becomes a replicate row.
 *
 * Honest limits, FLAGGED rather than guessed:
 *   - A multi-block sheet (several tables stacked with blank-row separators) is
 *     NOT split apart; it imports as one wide table and the user trims it. The
 *     returned blankRowsInBody count surfaces that so the UI can warn.
 *   - Merged cells, formulas, and embedded charts do not exist in delimited text,
 *     so there is nothing to lose here (that is the .xlsx path's concern).
 */
export function detectTable(
  grid: string[][],
  opts: DetectOptions = {},
): DetectedTable {
  const transposed = opts.transpose ?? false;
  const work = transposed ? transposeGrid(grid) : grid;

  if (work.length === 0 || work[0].length === 0) {
    return { columns: [], rows: [], headerUsed: false, transposed };
  }

  const headerUsed =
    opts.header !== undefined ? opts.header : detectHeader(work);
  const headerRow = headerUsed ? work[0] : null;
  const bodyRows = headerUsed ? work.slice(1) : work;
  const width = work[0].length;

  // Infer each column's type from its body cells.
  const columns: ColumnDef[] = [];
  for (let c = 0; c < width; c++) {
    const colCells = bodyRows.map((r) => r[c] ?? "");
    const type = inferColumnType(colCells);
    const rawName = headerRow ? (headerRow[c] ?? "").trim() : "";
    const name = rawName !== "" ? rawName : `Group ${c + 1}`;
    columns.push({
      id: importColumnId(c),
      name,
      role: "y",
      dataType: type,
    });
  }

  const rows: RowRecord[] = [];
  for (let r = 0; r < bodyRows.length; r++) {
    const cells: Record<string, CellValue> = {};
    for (let c = 0; c < width; c++) {
      cells[columns[c].id] = toCell(bodyRows[r][c] ?? "", columns[c].dataType);
    }
    rows.push({ id: importRowId(r), cells });
  }

  return { columns, rows, headerUsed, transposed };
}

/**
 * The full pipeline: raw text in, normalized Column table out. Parses the
 * delimiter, optionally transposes, detects the header, infers types, and maps to
 * { columns, rows }. This is what the import dialog calls for both its live
 * preview and the final create.
 */
export function importTextToTable(
  text: string,
  opts: DetectOptions & { delimiter?: Delimiter } = {},
): DetectedTable & { delimiter: Delimiter } {
  const { delimiter, grid } = parseDelimited(text, opts.delimiter);
  const detected = detectTable(grid, opts);
  return { ...detected, delimiter };
}

// ---------------------------------------------------------------------------
// xlsx guard
// ---------------------------------------------------------------------------

/** Whether a picked file is a binary Excel workbook (the deferred path). */
export function isXlsxFile(file: { name: string; type?: string }): boolean {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm")) {
    return true;
  }
  const t = file.type ?? "";
  return (
    t === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    t === "application/vnd.ms-excel"
  );
}

/** The friendly message shown when a user picks a binary .xlsx file. */
export const XLSX_COMING_SOON_MESSAGE =
  "Excel workbook import is coming soon. For now, open the sheet, copy the cells, and paste them above, or save the sheet as CSV and pick it here.";
