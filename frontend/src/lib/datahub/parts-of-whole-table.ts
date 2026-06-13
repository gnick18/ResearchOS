// Parts-of-whole table view model for the Data Hub grid (more-table-types slice).
//
// A Parts-of-whole table records the COMPOSITION of a single whole. Each ROW is
// one CATEGORY (a slice of the pie), with a text label and one non-negative
// VALUE (the size of that slice). The descriptive readout is each category's
// PERCENT OF TOTAL (value / sum * 100), the way GraphPad's Parts-of-whole table
// shows the percentages next to the entered values. There is NO inferential
// statistic here (no test, no p-value), so this table type never offers an
// analysis, only the pie / donut / stacked-bar figures.
//
// THE MODEL reuses the existing column shape the same way the Contingency table
// does: a single role-"x" TEXT column holds the category labels (one cell per
// row), and a single role-"y" NUMBER column holds the slice values. A fresh
// table seeds four category rows with a label column and a value column.
//
// THE PERCENT CONVENTION mirrors the wrangling engine's fractionOfTotal
// transform (transforms.ts), value / total * 100, where a zero total yields a
// null percent for every row rather than dividing by zero. An EXCLUDED value
// cell reads as absent (it drops out of the total and gets a null percent),
// exactly like the other grids.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type {
  CellValue,
  ColumnDef,
  DataHubDocContent,
  RowRecord,
} from "@/lib/datahub/model/types";
import { isCellExcluded } from "@/lib/datahub/cell-exclusion";

/** The fixed id of the role-"x" text column that holds the category labels. */
export const CATEGORY_LABEL_COLUMN_ID = "category";
/** The fixed id of the single role-"y" number column that holds the slice values. */
export const VALUE_COLUMN_ID = "value";

/** A fresh Parts-of-whole table seeds this many category rows. */
export const DEFAULT_PARTS_OF_WHOLE_ROWS = 4;

function seedRowId(i: number): string {
  return `row-${i + 1}`;
}

/**
 * Build the columns + rows for a fresh, empty Parts-of-whole table: a role-"x"
 * text label column ("Category") plus a single role-"y" value column ("Value"),
 * with `rows` blank category rows seeded with positional labels ("Category 1",
 * ...) and a null value each.
 */
export function buildEmptyPartsOfWholeTable(
  rows = DEFAULT_PARTS_OF_WHOLE_ROWS,
): { columns: ColumnDef[]; rows: RowRecord[] } {
  const columns: ColumnDef[] = [
    { id: CATEGORY_LABEL_COLUMN_ID, name: "Category", role: "x", dataType: "text" },
    { id: VALUE_COLUMN_ID, name: "Value", role: "y", dataType: "number" },
  ];
  const rowRecords: RowRecord[] = [];
  for (let i = 0; i < rows; i++) {
    const cells: Record<string, CellValue> = {};
    cells[CATEGORY_LABEL_COLUMN_ID] = `Category ${i + 1}`;
    cells[VALUE_COLUMN_ID] = null;
    rowRecords.push({ id: seedRowId(i), cells });
  }
  return { columns, rows: rowRecords };
}

/** The role-"x" text column that carries the category labels, if present. */
export function categoryLabelColumn(content: DataHubDocContent): ColumnDef | null {
  return (
    content.columns.find((c) => c.id === CATEGORY_LABEL_COLUMN_ID) ??
    content.columns.find((c) => c.role === "x") ??
    null
  );
}

/** The single role-"y" value column (the slice sizes), if present. */
export function valueColumn(content: DataHubDocContent): ColumnDef | null {
  return (
    content.columns.find((c) => c.id === VALUE_COLUMN_ID) ??
    content.columns.find((c) => c.role === "y") ??
    null
  );
}

/** Coerce a stored cell into a finite, non-negative number, or null otherwise. */
function asNonNegative(v: CellValue | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v >= 0 ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/** One resolved category of a Parts-of-whole table. */
export interface PartCategory {
  /** The category label (or a positional fallback when blank). */
  label: string;
  /** The slice value, or null when the cell is blank / excluded / negative. */
  value: number | null;
  /**
   * The category's percent of the total (value / sum * 100), or null when the
   * value is absent or the total is zero. Mirrors fractionOfTotal (asPercent).
   */
  percent: number | null;
}

/** The full resolved composition of a Parts-of-whole table. */
export interface PartsOfWhole {
  /** Every category row, in table order. */
  categories: PartCategory[];
  /** The sum of every present (finite, non-negative, non-excluded) value. */
  total: number;
}

/**
 * Resolve the grid into its categories plus their percent of total. The value
 * column is read down the rows; a blank, excluded, or negative value reads as
 * absent (null) and drops out of the total. The percent is value / total * 100
 * (the fractionOfTotal convention), null when the value is absent or the total
 * is zero. The label is the role-"x" cell value, or a positional fallback.
 */
export function partsOfWhole(content: DataHubDocContent): PartsOfWhole {
  const labelCol = categoryLabelColumn(content);
  const valCol = valueColumn(content);

  // First pass: read each row's label + present value.
  const raw: { label: string; value: number | null }[] = [];
  content.rows.forEach((row, r) => {
    const rawLabel = labelCol ? row.cells[labelCol.id] : null;
    const label =
      typeof rawLabel === "string" && rawLabel.trim() !== ""
        ? rawLabel.trim()
        : typeof rawLabel === "number" && Number.isFinite(rawLabel)
          ? String(rawLabel)
          : `Category ${r + 1}`;
    let value: number | null = null;
    if (valCol && !isCellExcluded(content, row.id, valCol.id)) {
      value = asNonNegative(row.cells[valCol.id]);
    }
    raw.push({ label, value });
  });

  const total = raw.reduce((acc, c) => acc + (c.value ?? 0), 0);

  // Second pass: the percent of total, null when the value is absent or the
  // total is zero (the fractionOfTotal zero-total guard).
  const categories: PartCategory[] = raw.map((c) => ({
    label: c.label,
    value: c.value,
    percent: c.value === null || total === 0 ? null : (c.value / total) * 100,
  }));

  return { categories, total };
}

/** The categories that contribute a positive slice, in table order. */
export function presentParts(content: DataHubDocContent): PartCategory[] {
  return partsOfWhole(content).categories.filter(
    (c) => c.value !== null && c.value > 0,
  );
}

/** True when the table holds at least one positive value (enough to draw). */
export function hasPartsOfWholeData(content: DataHubDocContent): boolean {
  return partsOfWhole(content).categories.some(
    (c) => c.value !== null && c.value > 0,
  );
}

/** True when the content describes a Parts-of-whole table. */
export function isPartsOfWholeTable(content: DataHubDocContent): boolean {
  return content.meta.table_type === "partsOfWhole";
}
