// Nested-table view model for the Data Hub grid (more-table-types slice).
//
// A Nested table is the Prism archetype for a HIERARCHICAL design. Each top-level
// GROUP is a treatment (Control, Drug). Within a group sit SUBGROUPS, the unit of
// biological replication (a mouse, a donor, a dish). Within a subgroup sit
// REPLICATE values, the technical repeats (cells measured per mouse). The classic
// case is technical replicates nested within biological replicates, and the
// nested test treats the SUBGROUP as the replication unit so it does not
// pseudo-replicate the technical repeats.
//
// THE MODEL mirrors the Grouped table's column-family shape, with one difference.
// In a Grouped table every replicate column under a group shares the group's name
// and the rows are the row-factor levels. In a Nested table each column under a
// group is a distinct SUBGROUP with its OWN name, and the rows are just replicate
// slots. So:
//   - each top-level group is a datasetId-keyed family of columns,
//   - each column in the family is one subgroup, role "y", numeric, subcolumnKind
//     "replicate", its `name` the subgroup label,
//   - the parent group's display name is carried on every subgroup column's
//     optional `groupName` field (repeated, the way Grouped repeats a group name),
//   - the table rows are replicate slots; a subgroup's replicate values are that
//     column read down the rows.
// This reuses the existing ColumnRole "subcolumn"/"y", datasetId, subcolumnKind,
// and the cell-level row model unchanged, so the Loro serializer needs no new
// container. The only additive field is ColumnDef.groupName, documented there.
//
// The resolver turns the grid into, per group, a list of subgroups each with its
// replicate values, exactly the shape the engine's nestedTTest / nestedOneWayAnova
// consume.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type {
  CellValue,
  ColumnDef,
  DataHubDocContent,
  RowRecord,
} from "@/lib/datahub/model/types";
import type { NestedGroup } from "@/lib/datahub/engine";
import { isCellExcluded } from "@/lib/datahub/cell-exclusion";

/** One top-level group of a nested table and its subgroup columns. */
export interface NestedGroupColumns {
  /** The shared datasetId every subgroup column in this group carries. */
  datasetId: string;
  /** The group's display name (carried on each subgroup column's groupName). */
  name: string;
  /** The subgroup columns of this group, in declared order. */
  subgroupColumnIds: string[];
}

/** Defaults for a fresh Nested table. */
export const DEFAULT_NESTED_GROUPS = 2;
export const DEFAULT_NESTED_SUBGROUPS = 3;
export const DEFAULT_NESTED_REPLICATES = 4;

function seedGroupId(i: number): string {
  return `grp-${i + 1}`;
}
function seedSubgroupId(g: number, s: number): string {
  return `g${g + 1}-s${s + 1}`;
}
function seedRowId(i: number): string {
  return `row-${i + 1}`;
}

/**
 * Build the columns + rows for a fresh, empty Nested table: `groups` top-level
 * groups, each with `subgroups` subgroup columns, and `replicates` blank rows.
 * Group names default to "Group 1", "Group 2", ...; subgroup names to "S1", "S2",
 * ... within each group. Every replicate cell starts null.
 */
export function buildEmptyNestedTable(
  groups = DEFAULT_NESTED_GROUPS,
  subgroups = DEFAULT_NESTED_SUBGROUPS,
  replicates = DEFAULT_NESTED_REPLICATES,
): { columns: ColumnDef[]; rows: RowRecord[] } {
  const columns: ColumnDef[] = [];
  for (let g = 0; g < groups; g++) {
    const datasetId = seedGroupId(g);
    const groupName = `Group ${g + 1}`;
    for (let s = 0; s < subgroups; s++) {
      columns.push({
        id: seedSubgroupId(g, s),
        name: `S${s + 1}`,
        role: "y",
        dataType: "number",
        datasetId,
        subcolumnKind: "replicate",
        groupName,
      });
    }
  }
  const rowRecords: RowRecord[] = [];
  for (let i = 0; i < replicates; i++) {
    const cells: Record<string, CellValue> = {};
    for (const col of columns) cells[col.id] = null;
    rowRecords.push({ id: seedRowId(i), cells });
  }
  return { columns, rows: rowRecords };
}

/**
 * The top-level groups of a Nested table, in declared order, each with its
 * subgroup column ids. A subgroup column is a role-"y" column carrying a
 * datasetId; columns are grouped by that datasetId. The group display name is the
 * first subgroup column's `groupName` (they share it), falling back to a
 * positional label when unset.
 */
export function nestedGroupColumns(
  content: DataHubDocContent,
): NestedGroupColumns[] {
  const order: string[] = [];
  const byId = new Map<string, NestedGroupColumns>();
  let positional = 0;
  for (const c of content.columns) {
    if (c.role !== "y" || !c.datasetId) continue;
    let g = byId.get(c.datasetId);
    if (!g) {
      positional += 1;
      g = {
        datasetId: c.datasetId,
        name:
          typeof c.groupName === "string" && c.groupName.trim() !== ""
            ? c.groupName.trim()
            : `Group ${positional}`,
        subgroupColumnIds: [],
      };
      byId.set(c.datasetId, g);
      order.push(c.datasetId);
    }
    g.subgroupColumnIds.push(c.id);
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

/** The subgroup display name for a column, falling back to a positional label. */
function subgroupName(col: ColumnDef, indexInGroup: number): string {
  if (typeof col.name === "string" && col.name.trim() !== "") return col.name.trim();
  return `S${indexInGroup + 1}`;
}

/**
 * Resolve the grid into the nested hierarchy the engine consumes: per group, a
 * list of subgroups each with its finite replicate values read down its column.
 * An EXCLUDED cell is dropped (treated absent), exactly like the other grids. A
 * subgroup keeps every finite cell of its column; the engine drops empty
 * subgroups and empty groups itself, so this resolver passes the raw structure
 * straight through.
 */
export function nestedGroups(content: DataHubDocContent): NestedGroup[] {
  const groups = nestedGroupColumns(content);
  return groups.map((g) => ({
    name: g.name,
    subgroups: g.subgroupColumnIds.map((colId, i) => {
      const col = content.columns.find((c) => c.id === colId)!;
      const values: number[] = [];
      for (const row of content.rows) {
        if (isCellExcluded(content, row.id, colId)) continue;
        const v = asFiniteNumber(row.cells[colId]);
        if (v !== null) values.push(v);
      }
      return { name: subgroupName(col, i), values };
    }),
  }));
}

/** The distinct top-level group names of a Nested table, in declared order. */
export function nestedGroupNames(content: DataHubDocContent): string[] {
  return nestedGroupColumns(content).map((g) => g.name);
}

/** True when the table holds at least one finite replicate value (enough to run). */
export function hasNestedData(content: DataHubDocContent): boolean {
  return nestedGroups(content).some((g) =>
    g.subgroups.some((s) => s.values.length > 0),
  );
}

/** True when the content describes a Nested table. */
export function isNestedTable(content: DataHubDocContent): boolean {
  return content.meta.table_type === "nested";
}
