// Grid row/column CRUD core for the Data Hub data tables (grid-crud phase 2a).
//
// The right-click menus on the grids (Rename / Duplicate / Insert / Delete) all
// run through these pure helpers, so the guards and the new-content shapes are
// unit-testable without a Loro doc or a React render. The page wires the doc
// commit path around them.
//
// The content model is uniform across every table type: content.columns[] +
// content.rows[] with cells keyed by column id. So the mutations are GENERIC over
// columns / rows; only the user-facing LABELS differ by table type (group / Y
// column / subject / replicate / point). The label helper here mirrors the
// existing toolbar Add-label logic so the menus read naturally per type.
//
// Guards (what a menu must disable, not just refuse):
//   - the X column of an XY table is never deletable or rename-as-data (it is the
//     independent axis, deleting it would orphan every pair);
//   - the row-label column of a Grouped table is the factor-A axis, not a data
//     column, so it is not offered as a deletable data column either;
//   - the LAST remaining data column cannot be deleted (a table needs one);
//   - the LAST remaining row cannot be deleted (a table needs one).
//
// No em-dashes, no emojis, no mid-sentence colons.

import type {
  CellValue,
  ColumnDef,
  DataHubDocContent,
  DataHubTableType,
  RowRecord,
} from "@/lib/datahub/model/types";

/**
 * The user-facing noun for a DATA column of a given table type, used in the
 * right-click menu labels ("Delete group", "Delete Y column", ...). Mirrors the
 * toolbar Add-label wording so the menus and the toolbar stay consistent. A
 * survival table has no second data axis, so its rows ARE the data and there is
 * no column noun (the menus do not offer column actions there).
 */
export function columnNoun(type: DataHubTableType): string {
  if (type === "xy") return "Y column";
  // column + grouped both read as a "group" in the existing toolbar copy.
  return "group";
}

/**
 * The user-facing noun for a ROW of a given table type. A survival table row is
 * a subject, a nested table row is a replicate; every other type calls a row a
 * "row".
 */
export function rowNoun(type: DataHubTableType): string {
  if (type === "survival") return "subject";
  if (type === "nested") return "replicate";
  return "row";
}

/**
 * The DATA columns of a table, in declared order. These are the columns a user
 * may delete / duplicate / rename as data. The X column of an XY table and the
 * factor-A row-label column of a Grouped table are STRUCTURAL axes, so they are
 * excluded here even though they live in content.columns.
 *
 * For a Column table every column is a data group. For an XY table the role-"x"
 * column is excluded. For a Grouped table the role-"x" row-label column is
 * excluded (its replicate columns are the data, grouped by datasetId elsewhere).
 */
export function dataColumns(content: DataHubDocContent): ColumnDef[] {
  return content.columns.filter((c) => c.role !== "x");
}

/** True when a column is a structural axis (XY X column, Grouped row label). */
export function isStructuralColumn(col: ColumnDef): boolean {
  return col.role === "x";
}

/**
 * True when the column may be DELETED right now. False for a structural axis, and
 * false when it is the last remaining data column (a table needs at least one).
 */
export function canDeleteColumn(
  content: DataHubDocContent,
  columnId: string,
): boolean {
  const col = content.columns.find((c) => c.id === columnId);
  if (!col || isStructuralColumn(col)) return false;
  return dataColumns(content).length > 1;
}

/**
 * True when the column may be RENAMED as a data column right now. A structural
 * axis is not renamed through the data-column path (the XY X column and the
 * Grouped row label have their own meaning), so this returns false for those.
 */
export function canRenameColumn(
  content: DataHubDocContent,
  columnId: string,
): boolean {
  const col = content.columns.find((c) => c.id === columnId);
  if (!col || isStructuralColumn(col)) return false;
  return true;
}

/**
 * True when the row may be DELETED right now. False when it is the last remaining
 * row (a table needs at least one row to edit into).
 */
export function canDeleteRow(content: DataHubDocContent): boolean {
  return content.rows.length > 1;
}

/**
 * Build a blank row (every existing column's cell null), with a caller-supplied
 * id. The same shape handleAddRow builds, lifted here so insert-at-position reuses
 * it. Pure, so a test can assert every column key is present and null.
 */
export function buildBlankRow(content: DataHubDocContent, id: string): RowRecord {
  const cells: Record<string, CellValue> = {};
  for (const col of content.columns) cells[col.id] = null;
  return { id, cells };
}

/**
 * Build a blank DATA column for a given table type, with a caller-supplied id.
 * The same naming handleAddColumn uses (a sequential "Group N" or "Y N"), lifted
 * here so insert-at-position reuses it. The name counts only existing DATA
 * columns so the sequence stays gap-free as columns are inserted. Returns the new
 * ColumnDef; the caller backfills a null cell per row.
 */
export function buildBlankColumn(
  content: DataHubDocContent,
  id: string,
): ColumnDef {
  const type = content.meta.table_type;
  const count = dataColumns(content).length;
  if (type === "xy") {
    return { id, name: `Y${count + 1}`, role: "y", dataType: "number" };
  }
  return { id, name: `Group ${count + 1}`, role: "y", dataType: "number" };
}

/**
 * Build a DUPLICATE of an existing column: a fresh id, the source column's role /
 * dataType / dataset metadata, and the name suffixed " copy". The caller copies
 * each row's source-cell value into the new column id and inserts it right after
 * the source. Returns null when the source column is missing. Pure, so a test can
 * assert the metadata carries over and the name is suffixed.
 */
export function buildDuplicateColumn(
  content: DataHubDocContent,
  sourceColumnId: string,
  newId: string,
): ColumnDef | null {
  const src = content.columns.find((c) => c.id === sourceColumnId);
  if (!src) return null;
  const copy: ColumnDef = {
    id: newId,
    name: `${src.name} copy`,
    role: src.role,
    dataType: src.dataType,
  };
  if (src.datasetId !== undefined) copy.datasetId = src.datasetId;
  if (src.subcolumnKind !== undefined) copy.subcolumnKind = src.subcolumnKind;
  return copy;
}

/** The declared index of a column in content.columns, or -1 when absent. */
export function columnIndex(content: DataHubDocContent, columnId: string): number {
  return content.columns.findIndex((c) => c.id === columnId);
}

/** The declared index of a row in content.rows, or -1 when absent. */
export function rowIndex(content: DataHubDocContent, rowId: string): number {
  return content.rows.findIndex((r) => r.id === rowId);
}
