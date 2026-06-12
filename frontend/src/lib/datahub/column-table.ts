// Column-table view model for the Data Hub grid (slice 1).
//
// A Column table is the Prism archetype where each COLUMN is a treatment group
// and each ROW is a replicate. This module turns a DataHubDocContent into the
// shape the grid renders (group columns + a fixed replicate-row count), seeds a
// fresh empty Column table, parses a typed cell edit, and computes the footer
// summary (mean / SD / SEM / n) for every group through the already-built
// engine `describe`. Pure + browser-safe; the UI consumes only this surface so
// the recompute loop is unit-testable without a Loro doc.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe as engineDescribe } from "@/lib/datahub/engine";
import type {
  CellValue,
  ColumnDef,
  DataHubDocContent,
  RowRecord,
} from "@/lib/datahub/model/types";
import { isCellExcluded } from "@/lib/datahub/cell-exclusion";

/** A single group column in the Column-table grid. */
export interface GroupColumn {
  id: string;
  name: string;
}

/** The footer summary for one group column, straight from the engine. */
export interface GroupStats {
  /** mean of the finite replicate values, or null when the group is empty. */
  mean: number | null;
  /** sample SD, or null when fewer than two finite values. */
  sd: number | null;
  /** standard error of the mean, or null when fewer than two finite values. */
  sem: number | null;
  /** count of finite numeric values in the group. */
  n: number;
}

/** How many blank replicate rows a brand-new Column table starts with. */
export const DEFAULT_COLUMN_ROWS = 6;
/** How many group columns a brand-new Column table starts with. */
export const DEFAULT_COLUMN_GROUPS = 3;

/** Stable id for the nth group column / replicate row of a seeded table. */
function seedColumnId(i: number): string {
  return `col-${i + 1}`;
}
function seedRowId(i: number): string {
  return `row-${i + 1}`;
}

/**
 * Build the columns + rows for a fresh, empty Column table. Group columns are
 * named "Group 1", "Group 2", ... and every cell starts null. Deterministic ids
 * so the seed is stable across devices (the Loro seed requires it).
 */
export function buildEmptyColumnTable(
  groups = DEFAULT_COLUMN_GROUPS,
  rows = DEFAULT_COLUMN_ROWS,
): { columns: ColumnDef[]; rows: RowRecord[] } {
  const columns: ColumnDef[] = [];
  for (let i = 0; i < groups; i++) {
    columns.push({
      id: seedColumnId(i),
      name: `Group ${i + 1}`,
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
 * The group columns of a Column-table document, in declared order. Only the "y"
 * and "group" roles are treatment groups in a Column table; an "x" column (if a
 * later table type seeds one) is excluded from the group grid.
 */
export function groupColumns(content: DataHubDocContent): GroupColumn[] {
  return content.columns
    .filter((c) => c.role === "y" || c.role === "group")
    .map((c) => ({ id: c.id, name: c.name }));
}

/**
 * The finite numeric values in one group column, read across every row. Empty,
 * non-numeric, AND excluded cells are skipped so the engine only sees real,
 * not-excluded measurements (an excluded outlier is treated as absent).
 */
export function columnValues(
  content: DataHubDocContent,
  columnId: string,
): number[] {
  const out: number[] = [];
  for (const row of content.rows) {
    if (isCellExcluded(content, row.id, columnId)) continue;
    const v = row.cells[columnId];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    else if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

/**
 * Read several group columns ALIGNED BY ROW, dropping any row that is missing,
 * non-numeric, or excluded in ANY of the requested columns (listwise / complete
 * cases). Each returned inner array is one row's values across `columnIds` in the
 * given order, so the row pairing is preserved. This is the matrix a paired or
 * repeated-measures test reads (where each row is the same subject measured under
 * each condition column). Rows are returned in table order; column ids unknown to
 * the table contribute a non-finite cell and so drop every row, which the caller
 * guards by passing only resolved ids.
 */
export function rowAlignedValues(
  content: DataHubDocContent,
  columnIds: string[],
): number[][] {
  const out: number[][] = [];
  for (const row of content.rows) {
    const cells: number[] = [];
    let complete = true;
    for (const id of columnIds) {
      if (isCellExcluded(content, row.id, id)) {
        complete = false;
        break;
      }
      const v = row.cells[id];
      let num: number | null = null;
      if (typeof v === "number" && Number.isFinite(v)) num = v;
      else if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v);
        if (Number.isFinite(n)) num = n;
      }
      if (num === null) {
        complete = false;
        break;
      }
      cells.push(num);
    }
    if (complete) out.push(cells);
  }
  return out;
}

/**
 * Footer stats for one group, computed via the engine `describe`. Returns nulls
 * (not NaN) for the degenerate cases so the UI can render an em-free dash rather
 * than "NaN". n is always the real finite count.
 */
export function computeGroupStats(
  content: DataHubDocContent,
  columnId: string,
): GroupStats {
  const values = columnValues(content, columnId);
  const result = engineDescribe(values);
  if (!result.ok) {
    return { mean: null, sd: null, sem: null, n: values.length };
  }
  return {
    mean: Number.isFinite(result.mean) ? result.mean : null,
    sd: Number.isFinite(result.sd) ? result.sd : null,
    sem: Number.isFinite(result.sem) ? result.sem : null,
    n: result.n,
  };
}

/** Footer stats for every group column, keyed by column id. */
export function computeAllGroupStats(
  content: DataHubDocContent,
): Record<string, GroupStats> {
  const out: Record<string, GroupStats> = {};
  for (const col of groupColumns(content)) {
    out[col.id] = computeGroupStats(content, col.id);
  }
  return out;
}

/**
 * Parse a raw cell-edit string into the stored CellValue for a numeric group
 * column. A blank string clears the cell (null); a numeric string stores the
 * number; anything else is kept as the raw trimmed string so a typo is visible
 * and editable rather than silently dropped (the stats reader skips it).
 */
export function parseCellInput(raw: string): CellValue {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (Number.isFinite(n)) return n;
  return trimmed;
}

/** Render a stored cell value back into the editable string shown in a cell. */
export function cellDisplay(value: CellValue): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/** Format a footer stat for display, with a fixed precision and an em-free dash
 *  fallback when the value is null (too few values). */
export function formatStat(value: number | null, digits = 2): string {
  if (value === null) return "-";
  return value.toFixed(digits);
}
