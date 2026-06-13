"use client";

// The editable Nested-table grid (more-table-types slice). Each top-level GROUP
// is a column-family with a shared header (a treatment); under it sit SUBGROUP
// columns (biological replicates, e.g. animals), each with its own editable name;
// the rows are replicate slots (technical replicates, e.g. cells). The nested
// t-test and nested one-way ANOVA treat each subgroup as the unit of replication.
// A cell edit, a group rename, or a subgroup rename calls back to the page (which
// writes through the Loro store with a debounced commit).
//
// Like the other grids this is a controlled view: it renders the passed content
// and reports edits up, so a Loro commit + reproject flows straight back in.
//
// House style: <Icon> only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useMemo } from "react";
import { Icon } from "@/components/icons";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import { isCellExcluded } from "@/lib/datahub/cell-exclusion";
import DataCell, { type ToggleCellExclusion } from "@/components/datahub/DataCell";
import { nestedGroupColumns } from "@/lib/datahub/nested-table";
import {
  useGridCrudMenu,
  type GridCrudHandlers,
} from "@/components/datahub/grid-crud-menu";

export default function NestedTableGrid({
  content,
  onCellCommit,
  onToggleExclusion,
  onAddRow,
  onAddColumn,
  onRenameGroup,
  onRenameSubgroup,
  hideAddControls = false,
  readOnly = false,
  crud,
}: {
  content: DataHubDocContent;
  onCellCommit: (rowId: string, columnId: string, raw: string) => void;
  /** Toggle whether one replicate cell is excluded from analyses and plots. */
  onToggleExclusion?: ToggleCellExclusion;
  onAddRow: () => void;
  /** Append a new group (with the same subgroup count as the others). */
  onAddColumn: () => void;
  /** Rename a top-level group (updates every subgroup column's groupName). */
  onRenameGroup: (datasetId: string, name: string) => void;
  /** Rename one subgroup column (its own column name). */
  onRenameSubgroup: (columnId: string, name: string) => void;
  /** Suppress the internal Add bar when the WorkspaceToolbar owns those actions. */
  hideAddControls?: boolean;
  /** Render the table as a computed, NON-editable view (a derived table). */
  readOnly?: boolean;
  /** Right-click CRUD callbacks. A Nested table's columns are subgroup columns
   *  bound into datasetId groups, so the generic per-column menu would orphan a
   *  group; the GROUP-aware menu (delete / duplicate group, add / remove subgroup,
   *  insert group) lives on the group header, the row menu on the row-number cell. */
  crud?: GridCrudHandlers;
}) {
  const groups = useMemo(() => nestedGroupColumns(content), [content]);
  const rows = content.rows;
  const nestedCrud = useMemo<GridCrudHandlers>(
    () => ({
      onDeleteRow: crud?.onDeleteRow,
      onInsertRowAt: crud?.onInsertRowAt,
      onDeleteGroup: crud?.onDeleteGroup,
      onDuplicateGroup: crud?.onDuplicateGroup,
      onAddReplicate: crud?.onAddReplicate,
      onRemoveReplicate: crud?.onRemoveReplicate,
      onInsertGroupAt: crud?.onInsertGroupAt,
    }),
    [
      crud?.onDeleteRow,
      crud?.onInsertRowAt,
      crud?.onDeleteGroup,
      crud?.onDuplicateGroup,
      crud?.onAddReplicate,
      crud?.onRemoveReplicate,
      crud?.onInsertGroupAt,
    ],
  );
  const menu = useGridCrudMenu(content, readOnly ? {} : nestedCrud);

  return (
    <div data-testid="datahub-nested-grid">
      {!hideAddControls && !readOnly && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onAddRow}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add replicate
          </button>
          <button
            type="button"
            onClick={onAddColumn}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add group
          </button>
        </div>
      )}

      <div className="overflow-auto rounded-lg border border-border">
        <table className="border-collapse text-body tabular-nums">
          <thead>
            <tr>
              <th
                rowSpan={2}
                className="border border-border bg-surface-sunken px-3 py-1.5 text-meta font-medium text-foreground-muted"
              >
                #
              </th>
              {groups.map((g) => (
                <th
                  key={g.datasetId}
                  colSpan={g.subgroupColumnIds.length}
                  onContextMenu={
                    readOnly ? undefined : (e) => menu.openGroupMenu(e, g.datasetId)
                  }
                  className="border border-border bg-surface-sunken px-2 py-1 text-center"
                >
                  <input
                    type="text"
                    defaultValue={g.name}
                    key={`${g.datasetId}:${g.name}`}
                    readOnly={readOnly}
                    onBlur={
                      readOnly
                        ? undefined
                        : (e) => onRenameGroup(g.datasetId, e.currentTarget.value)
                    }
                    onKeyDown={(e) => {
                      if (!readOnly && e.key === "Enter") e.currentTarget.blur();
                    }}
                    aria-label={`Group name ${g.name}`}
                    className={`w-full bg-transparent text-center text-body font-semibold text-foreground outline-none ${
                      readOnly ? "cursor-default" : "focus:bg-accent-soft"
                    }`}
                  />
                </th>
              ))}
            </tr>
            <tr>
              {groups.flatMap((g) =>
                g.subgroupColumnIds.map((colId) => {
                  const col = content.columns.find((c) => c.id === colId);
                  return (
                    <th
                      key={colId}
                      className="min-w-[70px] border border-border bg-surface-sunken px-2 py-0.5 text-center"
                    >
                      <input
                        type="text"
                        defaultValue={col?.name ?? ""}
                        key={`${colId}:${col?.name ?? ""}`}
                        readOnly={readOnly}
                        onBlur={
                          readOnly
                            ? undefined
                            : (e) => onRenameSubgroup(colId, e.currentTarget.value)
                        }
                        onKeyDown={(e) => {
                          if (!readOnly && e.key === "Enter") e.currentTarget.blur();
                        }}
                        aria-label={`Subgroup name ${col?.name ?? colId}`}
                        placeholder="Subgroup"
                        className={`w-full bg-transparent text-center text-[11px] font-medium uppercase tracking-wide text-foreground-muted outline-none ${
                          readOnly ? "cursor-default" : "focus:bg-accent-soft"
                        }`}
                      />
                    </th>
                  );
                }),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row.id}>
                <td
                  onContextMenu={
                    readOnly ? undefined : (e) => menu.openRowMenu(e, row.id)
                  }
                  className="border border-border bg-surface-sunken px-3 py-1 text-center text-meta text-foreground-muted"
                >
                  {r + 1}
                </td>
                {groups.flatMap((g) =>
                  g.subgroupColumnIds.map((colId) => {
                    const col = content.columns.find((c) => c.id === colId);
                    return (
                      <DataCell
                        key={colId}
                        rowId={row.id}
                        columnId={colId}
                        value={row.cells[colId] ?? null}
                        excluded={isCellExcluded(content, row.id, colId)}
                        onToggleExclusion={onToggleExclusion}
                        ariaLabel={`${g.name} ${col?.name ?? "subgroup"} replicate, row ${r + 1}`}
                        onCellCommit={onCellCommit}
                        readOnly={readOnly}
                      />
                    );
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 max-w-xl text-meta text-foreground-muted">
        Each group is a treatment; each subgroup column is one biological
        replicate (a mouse, a donor); each row is a technical replicate. The
        nested test treats the subgroup as the unit of replication, so it does
        not pseudo-replicate the technical repeats.
      </p>
    </div>
  );
}
