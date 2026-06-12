// Summary-stats view model for a Data Hub Column table (subcolumn foundation).
//
// A Column table normally holds raw replicates (one measurement per row). Prism
// also lets you ENTER the group summary directly (Mean + SD + N, or Mean + SEM +
// N) when you only have the published / already-calculated values, not the raw
// replicates. This module is the typed accessor for that summary entry format.
//
// STORAGE (see EntryFormat in model/types.ts for the full rationale). In a
// summary mode each GROUP is a parent Y dataset (a datasetId). The group's three
// numbers live in three ColumnDefs of role "subcolumn" that share that datasetId:
//   - subcolumnKind "mean"          the group mean
//   - subcolumnKind "sd" or "sem"   the spread (which one is fixed by the table's
//                                   entryFormat)
//   - subcolumnKind "n"            the replicate count
// The table holds a SINGLE row, so each group is one (mean, spread, n) triple
// read out of that row's three cells. This reuses the existing subcolumn model,
// the cell-level row, and the Loro serializer with no new container.
//
// Pure + browser-safe. No grid / plot UI here (that is the next phase); this is
// only the read / write surface plus a typed group-summary reader.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type {
  CellValue,
  ColumnDef,
  DataHubDocContent,
  EntryFormat,
  RowRecord,
} from "@/lib/datahub/model/types";
import {
  buildEmptyColumnTable,
  computeGroupStats,
  groupColumns,
} from "@/lib/datahub/column-table";

/** Whether an entry format is one of the two summary modes (not "replicates"). */
export function isSummaryFormat(format: EntryFormat | undefined): boolean {
  return format === "mean-sd-n" || format === "mean-sem-n";
}

/**
 * The effective entry format of a document. Absent (or any non-summary value on a
 * non-Column table) reads back as "replicates" so a document written before this
 * field existed behaves byte-identically to the current engine.
 */
export function entryFormatOf(content: DataHubDocContent): EntryFormat {
  const f = content.meta.entryFormat;
  if (f === "mean-sd-n" || f === "mean-sem-n") return f;
  return "replicates";
}

/** The spread kind a summary format stores ("sd" or "sem"). */
export function spreadKindOf(format: EntryFormat): "sd" | "sem" {
  return format === "mean-sem-n" ? "sem" : "sd";
}

/** One resolved group summary read out of the single summary row. */
export interface GroupSummary {
  /** The group's parent dataset id (the group identity). */
  datasetId: string;
  /** The group's display name (the parent dataset's name). */
  name: string;
  /** The entered mean, or null when the cell is blank / non-numeric. */
  mean: number | null;
  /** The entered spread (SD or SEM per the table format), or null when blank. */
  spread: number | null;
  /** Which spread the value is (fixed by the table's entryFormat). */
  spreadKind: "sd" | "sem";
  /** The entered replicate count, or null when blank / non-numeric. */
  n: number | null;
}

/** Read a stored cell as a finite number, or null for blank / non-numeric. */
function numericCell(value: CellValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** The first (and only) summary row, or undefined for an empty table. */
function summaryRow(content: DataHubDocContent): RowRecord | undefined {
  return content.rows[0];
}

/**
 * The summary subcolumns grouped by datasetId, in the declared column order. Each
 * group keeps its parent name (read off any of its subcolumns) plus the column id
 * carrying each kind. Only role "subcolumn" columns with a datasetId participate.
 */
interface GroupColumns {
  datasetId: string;
  name: string;
  meanColId?: string;
  spreadColId?: string;
  spreadKind?: "sd" | "sem";
  nColId?: string;
}

function groupColumnsByDataset(content: DataHubDocContent): GroupColumns[] {
  const order: string[] = [];
  const byId = new Map<string, GroupColumns>();
  for (const col of content.columns) {
    if (col.role !== "subcolumn") continue;
    const datasetId = col.datasetId;
    if (datasetId === undefined) continue;
    let group = byId.get(datasetId);
    if (!group) {
      group = { datasetId, name: col.name };
      byId.set(datasetId, group);
      order.push(datasetId);
    }
    if (col.subcolumnKind === "mean") {
      group.meanColId = col.id;
      // The mean column's name is the canonical group name (all three share it).
      group.name = col.name;
    } else if (col.subcolumnKind === "sd") {
      group.spreadColId = col.id;
      group.spreadKind = "sd";
    } else if (col.subcolumnKind === "sem") {
      group.spreadColId = col.id;
      group.spreadKind = "sem";
    } else if (col.subcolumnKind === "n") {
      group.nColId = col.id;
    }
  }
  return order.map((id) => byId.get(id)!);
}

/** The dataset ids of the summary groups, in declared order. */
export function summaryGroupIds(content: DataHubDocContent): string[] {
  return groupColumnsByDataset(content).map((g) => g.datasetId);
}

/**
 * Read one group's entered summary by its dataset id. Returns null when the
 * dataset id is not a summary group in this table. The spreadKind reflects the
 * table's entryFormat (mean-sd-n -> "sd", mean-sem-n -> "sem"); a group whose
 * spread column kind disagrees with the table format still reports the table
 * format's kind, since the table format is the source of truth for the spread.
 */
export function readGroupSummary(
  content: DataHubDocContent,
  groupId: string,
): GroupSummary | null {
  const group = groupColumnsByDataset(content).find(
    (g) => g.datasetId === groupId,
  );
  if (!group) return null;
  const row = summaryRow(content);
  const cells = row?.cells ?? {};
  const tableSpread = spreadKindOf(entryFormatOf(content));
  return {
    datasetId: group.datasetId,
    name: group.name,
    mean: group.meanColId ? numericCell(cells[group.meanColId]) : null,
    spread: group.spreadColId ? numericCell(cells[group.spreadColId]) : null,
    spreadKind: tableSpread,
    n: group.nColId ? numericCell(cells[group.nColId]) : null,
  };
}

/** Read every summary group, in declared order. */
export function readAllGroupSummaries(
  content: DataHubDocContent,
): GroupSummary[] {
  return summaryGroupIds(content)
    .map((id) => readGroupSummary(content, id))
    .filter((g): g is GroupSummary => g !== null);
}

/** Stable column id for a group's kind subcolumn (deterministic seed ids). */
export function summaryColumnId(
  datasetId: string,
  kind: "mean" | "sd" | "sem" | "n",
): string {
  return `${datasetId}-${kind}`;
}

/**
 * Build the columns + single row for a summary Column table from a list of named
 * groups. Each group becomes a parent dataset with three role-"subcolumn"
 * ColumnDefs (mean, the format's spread, n) sharing that datasetId, plus one cell
 * each in the single row. Deterministic ids so two devices seed identical bytes.
 * Cell values that are null seed an empty (un-entered) summary the user fills in.
 */
export function buildSummaryColumnTable(
  groups: Array<{
    datasetId: string;
    name: string;
    mean?: number | null;
    spread?: number | null;
    n?: number | null;
  }>,
  format: EntryFormat,
): { columns: ColumnDef[]; rows: RowRecord[] } {
  const spreadKind = spreadKindOf(
    format === "replicates" ? "mean-sd-n" : format,
  );
  const columns: ColumnDef[] = [];
  const cells: Record<string, CellValue> = {};
  for (const g of groups) {
    const meanId = summaryColumnId(g.datasetId, "mean");
    const spreadId = summaryColumnId(g.datasetId, spreadKind);
    const nId = summaryColumnId(g.datasetId, "n");
    columns.push(
      {
        id: meanId,
        name: g.name,
        role: "subcolumn",
        dataType: "number",
        datasetId: g.datasetId,
        subcolumnKind: "mean",
      },
      {
        id: spreadId,
        name: g.name,
        role: "subcolumn",
        dataType: "number",
        datasetId: g.datasetId,
        subcolumnKind: spreadKind,
      },
      {
        id: nId,
        name: g.name,
        role: "subcolumn",
        dataType: "number",
        datasetId: g.datasetId,
        subcolumnKind: "n",
      },
    );
    cells[meanId] = g.mean ?? null;
    cells[spreadId] = g.spread ?? null;
    cells[nId] = g.n ?? null;
  }
  return { columns, rows: [{ id: "row-1", cells }] };
}

/**
 * Write one group's summary cells into a content's single row, returning a NEW
 * content (pure; does not mutate). Missing kinds are left untouched. This is the
 * content-level helper a future grid edit path uses before persisting through the
 * Loro setCell mutators. A value of null clears the cell.
 */
export function writeGroupSummaryCells(
  content: DataHubDocContent,
  groupId: string,
  patch: { mean?: number | null; spread?: number | null; n?: number | null },
): DataHubDocContent {
  const group = groupColumnsByDataset(content).find(
    (g) => g.datasetId === groupId,
  );
  if (!group) return content;
  const baseRow = summaryRow(content);
  const cells: Record<string, CellValue> = { ...(baseRow?.cells ?? {}) };
  if (patch.mean !== undefined && group.meanColId) {
    cells[group.meanColId] = patch.mean;
  }
  if (patch.spread !== undefined && group.spreadColId) {
    cells[group.spreadColId] = patch.spread;
  }
  if (patch.n !== undefined && group.nColId) {
    cells[group.nColId] = patch.n;
  }
  const rowId = baseRow?.id ?? "row-1";
  const rows: RowRecord[] =
    content.rows.length === 0
      ? [{ id: rowId, cells }]
      : content.rows.map((r, i) => (i === 0 ? { id: r.id, cells } : r));
  return { ...content, rows };
}

// ---------------------------------------------------------------------------
// Entry-format conversions (used by the grid Table-format control)
//
// Switching a Column table between replicates and a summary mode is a STRUCTURAL
// rewrite of its columns + rows, not a metadata flip. These pure planners compute
// the new { columns, rows } so the page can apply them through the Loro mutators
// and write the new entryFormat in one commit. They never touch the engine math;
// they only reshape the stored grid. Each is lossy in one direction (replicates
// to summary drops the raw values; summary to replicates cannot recover them),
// so the calling UI confirms before applying.
// ---------------------------------------------------------------------------

/** SD from a stored SEM (SD = SEM * sqrt(n)); null when n is missing / invalid. */
export function sdFromSem(sem: number, n: number | null): number | null {
  if (n === null || !Number.isFinite(n) || n < 1) return null;
  return sem * Math.sqrt(n);
}

/** SEM from a stored SD (SEM = SD / sqrt(n)); null when n is missing / invalid. */
export function semFromSd(sd: number, n: number | null): number | null {
  if (n === null || !Number.isFinite(n) || n < 1) return null;
  return sd / Math.sqrt(n);
}

/**
 * Build the summary { columns, rows } for a replicates Column table, computing
 * each group's mean + spread (SD or SEM per the target format) + n from its raw
 * replicates via the same engine the footer uses. A group with too few finite
 * values seeds a blank spread (null) the user can fill in. The datasetId is the
 * existing column id so the group keeps its identity (and any figure that names
 * groups by name keeps matching). This DROPS the raw replicate values, which is
 * why the caller confirms first.
 */
export function replicatesToSummaryPlan(
  content: DataHubDocContent,
  format: EntryFormat,
): { columns: ColumnDef[]; rows: RowRecord[] } {
  const spreadKind = spreadKindOf(
    format === "replicates" ? "mean-sd-n" : format,
  );
  const groups = groupColumns(content).map((col) => {
    const s = computeGroupStats(content, col.id);
    const spread = spreadKind === "sem" ? s.sem : s.sd;
    return {
      datasetId: col.id,
      name: col.name,
      mean: s.mean,
      spread: spread,
      n: s.n > 0 ? s.n : null,
    };
  });
  return buildSummaryColumnTable(groups, format);
}

/**
 * Build the replicates { columns, rows } from a summary Column table. The raw
 * replicates cannot be recovered from a mean + spread + n, so this keeps each
 * group's entered MEAN as a single replicate (row 1) under a plain "y" column,
 * preserving the group name and identity, and seeds the remaining replicate rows
 * blank. A group with no entered mean seeds entirely blank. The caller confirms
 * the data loss (the spread + n are dropped) before applying.
 */
export function summaryToReplicatesPlan(
  content: DataHubDocContent,
  rows = 6,
): { columns: ColumnDef[]; rows: RowRecord[] } {
  const summaries = readAllGroupSummaries(content);
  const groupCount = Math.max(1, summaries.length);
  const base = buildEmptyColumnTable(groupCount, Math.max(1, rows));
  // Rename the seeded "Group N" columns to the entered group names and seed the
  // first row with each group's mean (the only number a summary can carry into
  // a replicate grid). The seeded ids are col-1, col-2, ... in order.
  const columns: ColumnDef[] = base.columns.map((col, i) => {
    const s = summaries[i];
    return s ? { ...col, name: s.name } : col;
  });
  const rowRecords: RowRecord[] = base.rows.map((row, r) => {
    if (r !== 0) return row;
    const cells: Record<string, CellValue> = { ...row.cells };
    columns.forEach((col, i) => {
      const s = summaries[i];
      cells[col.id] = s && s.mean !== null ? s.mean : null;
    });
    return { id: row.id, cells };
  });
  return { columns, rows: rowRecords };
}

/**
 * Build the summary { columns, rows } for switching a summary table's spread
 * between SD and SEM (mean-sd-n <-> mean-sem-n). This is LOSSLESS, converting
 * each group's stored spread with its n (SEM = SD / sqrt(n) and back), so no
 * confirm is needed. A group whose n is missing keeps a blank spread rather than
 * dividing by an unknown count. The mean and n carry over unchanged.
 */
export function convertSpreadKindPlan(
  content: DataHubDocContent,
  toFormat: EntryFormat,
): { columns: ColumnDef[]; rows: RowRecord[] } {
  const fromKind = spreadKindOf(entryFormatOf(content));
  const toKind = spreadKindOf(
    toFormat === "replicates" ? "mean-sd-n" : toFormat,
  );
  const summaries = readAllGroupSummaries(content);
  const groups = summaries.map((s) => {
    let spread = s.spread;
    if (spread !== null && fromKind !== toKind) {
      spread =
        toKind === "sem"
          ? semFromSd(spread, s.n)
          : sdFromSem(spread, s.n);
    }
    return {
      datasetId: s.datasetId,
      name: s.name,
      mean: s.mean,
      spread,
      n: s.n,
    };
  });
  return buildSummaryColumnTable(groups, toFormat);
}
