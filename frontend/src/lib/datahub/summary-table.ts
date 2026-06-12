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
