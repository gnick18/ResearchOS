// XY-table view model for the Data Hub grid (more-table-types slice).
//
// An XY table is the Prism archetype where one X column holds the independent
// variable (dose, time, concentration) and one or more Y columns hold the
// measured response. Each ROW is one observation. Unlike a Column table the X
// value matters per row, so the analyses that read it (correlation, linear
// regression, a fitted curve) pair the X value of a row with the Y value of the
// SAME row, keeping only rows where both are finite.
//
// This module turns a DataHubDocContent into the shape the XY grid renders,
// seeds a fresh empty XY table, and resolves the finite (x, y) pairs for one Y
// column through the same parse helpers the Column table uses. Pure and
// browser-safe, so the recompute loop is unit-testable without a Loro doc.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type {
  CellValue,
  ColumnDef,
  DataHubDocContent,
  RowRecord,
} from "@/lib/datahub/model/types";

/** A single Y (response) column in the XY grid. */
export interface YColumn {
  id: string;
  name: string;
}

/** A resolved set of finite (x, y) pairs for one Y column, ready for the engine. */
export interface XYPairs {
  /** The Y column id these pairs came from. */
  yColumnId: string;
  /** The X values, aligned index-for-index with y. */
  x: number[];
  /** The Y values, aligned index-for-index with x. */
  y: number[];
}

/** How many blank observation rows a brand-new XY table starts with. */
export const DEFAULT_XY_ROWS = 8;
/** How many Y columns a brand-new XY table starts with. */
export const DEFAULT_XY_Y_COLUMNS = 1;

/** Stable ids for a seeded XY table (deterministic, so the Loro seed is stable). */
function seedXColumnId(): string {
  return "x-1";
}
function seedYColumnId(i: number): string {
  return `y-${i + 1}`;
}
function seedRowId(i: number): string {
  return `row-${i + 1}`;
}

/**
 * Build the columns + rows for a fresh, empty XY table: one X column followed by
 * `yColumns` Y columns, all numeric, with every cell null. The X column carries
 * role "x" so the grid and the analyses can tell it apart from the responses.
 */
export function buildEmptyXYTable(
  yColumns = DEFAULT_XY_Y_COLUMNS,
  rows = DEFAULT_XY_ROWS,
): { columns: ColumnDef[]; rows: RowRecord[] } {
  const columns: ColumnDef[] = [
    { id: seedXColumnId(), name: "X", role: "x", dataType: "number" },
  ];
  for (let i = 0; i < yColumns; i++) {
    columns.push({
      id: seedYColumnId(i),
      name: yColumns === 1 ? "Y" : `Y${i + 1}`,
      role: "y",
      dataType: "number",
    });
  }
  const rowRecords: RowRecord[] = [];
  for (let r = 0; r < rows; r++) {
    const cells: Record<string, CellValue> = {};
    for (const col of columns) cells[col.id] = null;
    rowRecords.push({ id: seedRowId(r), cells });
  }
  return { columns, rows: rowRecords };
}

/**
 * The X column of an XY table (the first column with role "x"), or null when the
 * table has none yet. A well-formed XY table always has exactly one.
 */
export function xColumn(content: DataHubDocContent): ColumnDef | null {
  return content.columns.find((c) => c.role === "x") ?? null;
}

/** The Y (response) columns of an XY table, in declared order. */
export function yColumns(content: DataHubDocContent): YColumn[] {
  return content.columns
    .filter((c) => c.role === "y")
    .map((c) => ({ id: c.id, name: c.name }));
}

/** Coerce a stored cell into a finite number, or null when it is not numeric. */
function asFiniteNumber(v: CellValue | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Resolve the finite (x, y) pairs for one Y column. A row contributes a pair
 * only when BOTH its X cell and its Y cell are finite numbers, so a half-filled
 * row never skews the fit. The arrays come back aligned index-for-index.
 */
export function xyPairs(
  content: DataHubDocContent,
  yColumnId: string,
): XYPairs {
  const xCol = xColumn(content);
  const x: number[] = [];
  const y: number[] = [];
  if (!xCol) return { yColumnId, x, y };
  for (const row of content.rows) {
    const xv = asFiniteNumber(row.cells[xCol.id]);
    const yv = asFiniteNumber(row.cells[yColumnId]);
    if (xv === null || yv === null) continue;
    x.push(xv);
    y.push(yv);
  }
  return { yColumnId, x, y };
}

/** The count of finite (x, y) pairs for one Y column (the grid footer n). */
export function pairCount(content: DataHubDocContent, yColumnId: string): number {
  return xyPairs(content, yColumnId).x.length;
}

/** True when the content describes an XY table (has an X column). */
export function isXYTable(content: DataHubDocContent): boolean {
  return content.meta.table_type === "xy" || xColumn(content) !== null;
}
