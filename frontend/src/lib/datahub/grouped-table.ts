// Grouped-table view model for the Data Hub grid (more-table-types slice).
//
// A Grouped table is the Prism archetype for two factors at once. Each ROW is a
// level of the row factor (factor A, for example a time point or a genotype),
// labeled in the first column. Each COLUMN GROUP is a level of the column factor
// (factor B, for example a treatment), and a group holds one or more REPLICATE
// subcolumns so every (row, group) cell carries repeats. That replication is
// what lets a two-way ANOVA estimate the interaction and the error term.
//
// The model reuses the existing column shape: a role-"x" text column holds the
// row label, and each replicate subcolumn is a role-"y" numeric column tagged
// with a datasetId (the group it belongs to) and subcolumnKind "replicate". The
// group's display name is shared across its replicate columns, so renaming the
// group renames them together. This module turns the content into the grouped
// shape the grid renders, seeds a fresh table, and flattens the cells into the
// (factorA, factorB, value) observations the engine's twoWayAnova consumes.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type {
  CellValue,
  ColumnDef,
  DataHubDocContent,
  RowRecord,
} from "@/lib/datahub/model/types";
import type { TwoWayCell } from "@/lib/datahub/engine";

/** One column group (a factor-B level) and its replicate subcolumns. */
export interface GroupDataset {
  /** The shared datasetId every replicate column in this group carries. */
  datasetId: string;
  /** The group's display name (shared across its replicate columns). */
  name: string;
  /** The replicate column ids, in declared order. */
  replicateColumnIds: string[];
}

/** Defaults for a fresh Grouped table. */
export const DEFAULT_GROUPED_GROUPS = 2;
export const DEFAULT_GROUPED_REPLICATES = 3;
export const DEFAULT_GROUPED_ROWS = 3;

/** The reserved id / name of the row-label (factor A) column. */
export const ROW_LABEL_COLUMN_ID = "rowlabel";

function seedGroupId(i: number): string {
  return `grp-${i + 1}`;
}
function seedReplicateId(g: number, r: number): string {
  return `g${g + 1}-r${r + 1}`;
}
function seedRowId(i: number): string {
  return `row-${i + 1}`;
}

/**
 * Build the columns + rows for a fresh, empty Grouped table: a row-label column
 * followed by `groups` groups, each with `replicates` replicate subcolumns, and
 * `rows` blank rows. Group names default to "Group 1", "Group 2", ...; the row
 * label column is named "Group" by convention (the factor A axis).
 */
export function buildEmptyGroupedTable(
  groups = DEFAULT_GROUPED_GROUPS,
  replicates = DEFAULT_GROUPED_REPLICATES,
  rows = DEFAULT_GROUPED_ROWS,
): { columns: ColumnDef[]; rows: RowRecord[] } {
  const columns: ColumnDef[] = [
    {
      id: ROW_LABEL_COLUMN_ID,
      name: "Row",
      role: "x",
      dataType: "text",
    },
  ];
  for (let g = 0; g < groups; g++) {
    const datasetId = seedGroupId(g);
    const name = `Group ${g + 1}`;
    for (let r = 0; r < replicates; r++) {
      columns.push({
        id: seedReplicateId(g, r),
        name,
        role: "y",
        dataType: "number",
        datasetId,
        subcolumnKind: "replicate",
      });
    }
  }
  const rowRecords: RowRecord[] = [];
  for (let i = 0; i < rows; i++) {
    const cells: Record<string, CellValue> = {};
    for (const col of columns) cells[col.id] = null;
    rowRecords.push({ id: seedRowId(i), cells });
  }
  return { columns, rows: rowRecords };
}

/** The row-label (factor A) column, or null when the table has none. */
export function rowLabelColumn(content: DataHubDocContent): ColumnDef | null {
  return (
    content.columns.find(
      (c) => c.id === ROW_LABEL_COLUMN_ID || (c.role === "x" && c.dataType === "text"),
    ) ?? null
  );
}

/**
 * The column groups (factor-B levels) of a Grouped table, in declared order,
 * each with its replicate column ids. A replicate column is a role-"y" column
 * carrying a datasetId; columns are grouped by that datasetId. The group name is
 * read from the first replicate column of each group (they share it).
 */
export function groupDatasets(content: DataHubDocContent): GroupDataset[] {
  const order: string[] = [];
  const byId = new Map<string, GroupDataset>();
  for (const c of content.columns) {
    if (c.role !== "y" || !c.datasetId) continue;
    let g = byId.get(c.datasetId);
    if (!g) {
      g = { datasetId: c.datasetId, name: c.name, replicateColumnIds: [] };
      byId.set(c.datasetId, g);
      order.push(c.datasetId);
    }
    g.replicateColumnIds.push(c.id);
  }
  return order.map((id) => byId.get(id)!);
}

/** Coerce a stored cell into a finite number, or null when not numeric. */
function asFiniteNumber(v: CellValue | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Read the row-label text for a row, or "" when unset. */
function rowLabelValue(
  content: DataHubDocContent,
  row: RowRecord,
  labelColId: string,
): string {
  const v = row.cells[labelColId];
  return typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v);
}

/**
 * Flatten the grid into the (factorA, factorB, value) observations the engine's
 * twoWayAnova consumes. factorA is the row label, factorB is the group name, and
 * every finite replicate cell of that (row, group) is one observation. Rows with
 * a blank label are skipped (an unlabeled row is not a factor-A level yet).
 */
export function twoWayObservations(content: DataHubDocContent): TwoWayCell[] {
  const labelCol = rowLabelColumn(content);
  if (!labelCol) return [];
  const groups = groupDatasets(content);
  const out: TwoWayCell[] = [];
  for (const row of content.rows) {
    const factorA = rowLabelValue(content, row, labelCol.id);
    if (factorA === "") continue;
    for (const g of groups) {
      for (const colId of g.replicateColumnIds) {
        const value = asFiniteNumber(row.cells[colId]);
        if (value === null) continue;
        out.push({ factorA, factorB: g.name, value });
      }
    }
  }
  return out;
}

/** The distinct, non-empty row-factor levels in declared row order. */
export function rowFactorLevels(content: DataHubDocContent): string[] {
  const labelCol = rowLabelColumn(content);
  if (!labelCol) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of content.rows) {
    const v = rowLabelValue(content, row, labelCol.id);
    if (v === "" || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * The mean of one (row level, group) cell across its replicates, or null when
 * the cell has no finite values. Used by the grouped bar chart so the bar height
 * is the same number a footer would show.
 */
export function cellMean(
  content: DataHubDocContent,
  rowLevel: string,
  datasetId: string,
): { mean: number | null; sd: number | null; n: number } {
  const labelCol = rowLabelColumn(content);
  const group = groupDatasets(content).find((g) => g.datasetId === datasetId);
  if (!labelCol || !group) return { mean: null, sd: null, n: 0 };
  const values: number[] = [];
  for (const row of content.rows) {
    if (rowLabelValue(content, row, labelCol.id) !== rowLevel) continue;
    for (const colId of group.replicateColumnIds) {
      const v = asFiniteNumber(row.cells[colId]);
      if (v !== null) values.push(v);
    }
  }
  if (values.length === 0) return { mean: null, sd: null, n: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) return { mean, sd: null, n: values.length };
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return { mean, sd: Math.sqrt(variance), n: values.length };
}

/** True when the content describes a Grouped table. */
export function isGroupedTable(content: DataHubDocContent): boolean {
  return content.meta.table_type === "grouped";
}
