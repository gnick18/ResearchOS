// Group-aware column CRUD for the Data Hub Grouped grid (grid-crud phase 2a
// follow-up).
//
// A Grouped table's columns are not free-standing data columns. They are
// REPLICATE subcolumns bound into datasetId groups (see grouped-table.ts:
// groupDatasets), so the generic per-column delete / duplicate / insert in
// grid-crud.ts would leave uneven replicate counts and orphan a group. The group
// menu instead operates on a WHOLE group at once (delete every replicate column
// of a datasetId, clone all of them under a new datasetId) or on a group's
// replicate COUNT (grow / shrink by one), so the table never lands in a torn
// state.
//
// Like grid-crud.ts these are pure helpers (no Loro doc, no React), so the guards
// and the new-column shapes are unit-testable. The page wires the doc commit path
// around them, reusing the same primitives (addColumnAt, removeColumnWithCells,
// setCell) the generic menus use.
//
// Guards (what a menu must disable, not just refuse):
//   - the LAST remaining group cannot be deleted (a grouped table needs one);
//   - a group's LAST remaining replicate cannot be removed (a group needs one).
//
// No em-dashes, no emojis, no mid-sentence colons.

import type { ColumnDef, DataHubDocContent } from "@/lib/datahub/model/types";
import { columnIndex } from "@/lib/datahub/grid-crud";
import {
  DEFAULT_GROUPED_REPLICATES,
  groupDatasets,
} from "@/lib/datahub/grouped-table";

/**
 * True when this group may be DELETED right now. A grouped table needs at least
 * one group, so the last remaining group is not deletable; an unknown datasetId
 * is false.
 */
export function canDeleteGroup(
  content: DataHubDocContent,
  datasetId: string,
): boolean {
  const groups = groupDatasets(content);
  if (!groups.some((g) => g.datasetId === datasetId)) return false;
  return groups.length > 1;
}

/**
 * True when one replicate may be REMOVED from this group right now. A group needs
 * at least one replicate, so a single-replicate group cannot shrink; an unknown
 * datasetId is false.
 */
export function canRemoveReplicate(
  content: DataHubDocContent,
  datasetId: string,
): boolean {
  const group = groupDatasets(content).find((g) => g.datasetId === datasetId);
  if (!group) return false;
  return group.replicateColumnIds.length > 1;
}

/**
 * The replicate count a fresh group should inherit so every group stays even: the
 * first existing group's count, or the default when the table somehow has no
 * group yet.
 */
export function groupReplicateCount(content: DataHubDocContent): number {
  const groups = groupDatasets(content);
  return groups[0]?.replicateColumnIds.length ?? DEFAULT_GROUPED_REPLICATES;
}

/** The next gap-free "Group N" name, counting existing groups. */
export function nextGroupName(content: DataHubDocContent): string {
  return `Group ${groupDatasets(content).length + 1}`;
}

/** The replicate column ids of a group, in declared order, or [] when unknown. */
export function groupColumnIds(
  content: DataHubDocContent,
  datasetId: string,
): string[] {
  const group = groupDatasets(content).find((g) => g.datasetId === datasetId);
  return group ? [...group.replicateColumnIds] : [];
}

/**
 * The absolute column index of a group's FIRST replicate column, the insert point
 * for an "insert group before", or -1 when the group is unknown / empty.
 */
export function groupStartIndex(
  content: DataHubDocContent,
  datasetId: string,
): number {
  const group = groupDatasets(content).find((g) => g.datasetId === datasetId);
  if (!group || group.replicateColumnIds.length === 0) return -1;
  return columnIndex(content, group.replicateColumnIds[0]);
}

/**
 * The absolute column index right AFTER a group's last replicate column, the
 * insert point for appending a replicate or for an "insert group after", or -1
 * when the group is unknown / empty.
 */
export function groupEndIndex(
  content: DataHubDocContent,
  datasetId: string,
): number {
  const group = groupDatasets(content).find((g) => g.datasetId === datasetId);
  if (!group || group.replicateColumnIds.length === 0) return -1;
  const last = group.replicateColumnIds[group.replicateColumnIds.length - 1];
  return columnIndex(content, last) + 1;
}

/**
 * Build `replicates` replicate ColumnDefs for one group: the shared group name and
 * datasetId, role "y" / number, subcolumnKind "replicate". The caller supplies the
 * column ids (mintColumnId) so the builder stays pure (no Date.now). Used by both
 * Duplicate group and Insert group.
 */
export function buildGroupColumns(
  datasetId: string,
  name: string,
  replicates: number,
  mintColumnId: (index: number) => string,
): ColumnDef[] {
  const columns: ColumnDef[] = [];
  for (let r = 0; r < replicates; r++) {
    columns.push({
      id: mintColumnId(r),
      name,
      role: "y",
      dataType: "number",
      datasetId,
      subcolumnKind: "replicate",
    });
  }
  return columns;
}

/**
 * Plan a DUPLICATE of a group. Clones each source replicate column under a fresh
 * datasetId with the name "<name> copy", and reports which source column each new
 * column copies its per-row values from (valueSourceByNewId) plus where to insert
 * the clone (insertAt, right after the source group). Returns null when the group
 * is unknown. Pure, so a test can assert the metadata carries over and the value
 * map pairs new columns to their sources.
 */
export function buildDuplicateGroupPlan(
  content: DataHubDocContent,
  datasetId: string,
  newDatasetId: string,
  mintColumnId: (index: number) => string,
): {
  columns: ColumnDef[];
  valueSourceByNewId: Record<string, string>;
  insertAt: number;
} | null {
  const group = groupDatasets(content).find((g) => g.datasetId === datasetId);
  if (!group) return null;
  const name = `${group.name} copy`;
  const columns: ColumnDef[] = [];
  const valueSourceByNewId: Record<string, string> = {};
  group.replicateColumnIds.forEach((srcId, i) => {
    const id = mintColumnId(i);
    columns.push({
      id,
      name,
      role: "y",
      dataType: "number",
      datasetId: newDatasetId,
      subcolumnKind: "replicate",
    });
    valueSourceByNewId[id] = srcId;
  });
  return { columns, valueSourceByNewId, insertAt: groupEndIndex(content, datasetId) };
}

/**
 * Build the replicate columns for a fresh empty group to INSERT (before / after
 * an existing group, at an index the menu computes via groupStartIndex /
 * groupEndIndex). The new group inherits the table's current replicate count so
 * every group stays even, and is named the next "Group N".
 */
export function buildInsertGroupColumns(
  content: DataHubDocContent,
  newDatasetId: string,
  mintColumnId: (index: number) => string,
): ColumnDef[] {
  return buildGroupColumns(
    newDatasetId,
    nextGroupName(content),
    groupReplicateCount(content),
    mintColumnId,
  );
}

/**
 * Build the single replicate ColumnDef to ADD to a group (grow its replicate
 * count by one): the group's shared name and datasetId, inserted right after the
 * group's last replicate column. Returns null when the group is unknown.
 */
export function buildAddedReplicate(
  content: DataHubDocContent,
  datasetId: string,
  newColumnId: string,
): { column: ColumnDef; insertAt: number } | null {
  const group = groupDatasets(content).find((g) => g.datasetId === datasetId);
  if (!group) return null;
  const column: ColumnDef = {
    id: newColumnId,
    name: group.name,
    role: "y",
    dataType: "number",
    datasetId,
    subcolumnKind: "replicate",
  };
  return { column, insertAt: groupEndIndex(content, datasetId) };
}

/**
 * The replicate column id to REMOVE when shrinking a group by one (its LAST
 * replicate column). Returns null when the group is unknown or guarded down to its
 * last replicate (see canRemoveReplicate).
 */
export function replicateToRemove(
  content: DataHubDocContent,
  datasetId: string,
): string | null {
  if (!canRemoveReplicate(content, datasetId)) return null;
  const group = groupDatasets(content).find((g) => g.datasetId === datasetId)!;
  return group.replicateColumnIds[group.replicateColumnIds.length - 1];
}
