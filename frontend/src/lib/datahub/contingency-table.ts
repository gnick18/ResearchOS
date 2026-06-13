// Contingency-table view model for the Data Hub grid (more-table-types slice).
//
// A Contingency table is an R x C grid of non-negative integer counts. Each ROW
// is one category of the first factor (e.g. "Exposed" / "Not exposed") and each
// COLUMN is one category of the second factor (e.g. "Disease" / "No disease").
// Both the row labels and the column labels are editable text headers; the cells
// are counts. The engine turns this grid into the count matrix it tests for an
// association (chi-square, and for a 2x2 table Fisher's exact plus the relative
// risk and odds ratio).
//
// THE MODEL reuses the existing column shape, the same way the Grouped table
// does: a single role-"x" TEXT column holds the row labels (one cell per row),
// and each role-"y" NUMBER column is one category of the column factor (its
// `name` is the column header, its cells are the counts down that column). A
// fresh table seeds a 2x2 grid with placeholder labels and zero counts.
//
// THE CELL CONVENTION the engine documents (row 1 = exposed, col 1 = event) is a
// READING convention on the resolved matrix, not a constraint the model enforces.
// The matrix is read row-major in the table's visible order, so the first data
// row is row 1 and the first count column is column 1.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type {
  CellValue,
  ColumnDef,
  DataHubDocContent,
  RowRecord,
} from "@/lib/datahub/model/types";
import { isCellExcluded } from "@/lib/datahub/cell-exclusion";

/** The fixed id of the role-"x" text column that holds the row labels. */
export const ROW_LABEL_COLUMN_ID = "rowlabel";

export const DEFAULT_CONTINGENCY_ROWS = 2;
export const DEFAULT_CONTINGENCY_COLS = 2;

function countColumnId(i: number): string {
  return `col-${i + 1}`;
}

function seedRowId(i: number): string {
  return `row-${i + 1}`;
}

/**
 * Build the columns + rows for a fresh, empty 2x2 Contingency table: a role-"x"
 * text row-label column ("Group 1" / "Group 2" by default) plus two role-"y"
 * count columns ("Outcome 1" / "Outcome 2"), every count cell seeded to 0.
 */
export function buildEmptyContingencyTable(
  rows = DEFAULT_CONTINGENCY_ROWS,
  cols = DEFAULT_CONTINGENCY_COLS,
): { columns: ColumnDef[]; rows: RowRecord[] } {
  const columns: ColumnDef[] = [
    { id: ROW_LABEL_COLUMN_ID, name: "Group", role: "x", dataType: "text" },
  ];
  for (let j = 0; j < cols; j++) {
    columns.push({
      id: countColumnId(j),
      name: `Outcome ${j + 1}`,
      role: "y",
      dataType: "number",
    });
  }
  const rowRecords: RowRecord[] = [];
  for (let i = 0; i < rows; i++) {
    const cells: Record<string, CellValue> = {};
    cells[ROW_LABEL_COLUMN_ID] = `Group ${i + 1}`;
    for (let j = 0; j < cols; j++) cells[countColumnId(j)] = 0;
    rowRecords.push({ id: seedRowId(i), cells });
  }
  return { columns, rows: rowRecords };
}

/** The role-"x" text column that carries the row labels, if present. */
export function rowLabelColumn(content: DataHubDocContent): ColumnDef | null {
  return (
    content.columns.find((c) => c.id === ROW_LABEL_COLUMN_ID) ??
    content.columns.find((c) => c.role === "x") ??
    null
  );
}

/** The role-"y" count columns (the column-factor categories), in table order. */
export function countColumns(content: DataHubDocContent): ColumnDef[] {
  return content.columns.filter((c) => c.role === "y");
}

/** Read one cell as a non-negative integer count, or null when blank / invalid. */
function asCount(v: CellValue | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v >= 0 ? Math.round(v) : null;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  return null;
}

/** A resolved contingency matrix with its row and column labels. */
export interface ContingencyMatrix {
  /** The row labels, in table order. */
  rowLabels: string[];
  /** The column labels (count-column names), in table order. */
  colLabels: string[];
  /** The R x C count matrix, row-major. */
  matrix: number[][];
}

/**
 * Resolve the grid into the count matrix the engine consumes. Reads the role-"y"
 * count columns in table order as the columns and the table rows as the rows. A
 * blank or non-numeric count reads as 0 (an unfilled cell of a count table is an
 * absence of that joint event). An EXCLUDED cell also reads as 0, so the same
 * exclusion gesture the other grids use drops a count from the test. The row
 * label is the role-"x" cell value (or a positional fallback when blank).
 */
export function contingencyMatrix(
  content: DataHubDocContent,
): ContingencyMatrix {
  const labelCol = rowLabelColumn(content);
  const cols = countColumns(content);
  const colLabels = cols.map((c) => c.name);
  const rowLabels: string[] = [];
  const matrix: number[][] = [];
  content.rows.forEach((row, r) => {
    const rawLabel = labelCol ? row.cells[labelCol.id] : null;
    const label =
      typeof rawLabel === "string" && rawLabel.trim() !== ""
        ? rawLabel.trim()
        : typeof rawLabel === "number" && Number.isFinite(rawLabel)
          ? String(rawLabel)
          : `Row ${r + 1}`;
    rowLabels.push(label);
    const counts = cols.map((c) => {
      if (isCellExcluded(content, row.id, c.id)) return 0;
      return asCount(row.cells[c.id]) ?? 0;
    });
    matrix.push(counts);
  });
  return { rowLabels, colLabels, matrix };
}

/** True when the table holds at least one positive count (enough to run). */
export function hasContingencyData(content: DataHubDocContent): boolean {
  const { matrix } = contingencyMatrix(content);
  return matrix.some((row) => row.some((v) => v > 0));
}

/** True when the content describes a Contingency table. */
export function isContingencyTable(content: DataHubDocContent): boolean {
  return content.meta.table_type === "contingency";
}
