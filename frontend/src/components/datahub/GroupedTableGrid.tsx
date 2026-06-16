"use client";

// The editable Grouped-table grid (more-table-types slice). The first column
// holds the row label (factor A); each remaining group is a factor-B level with
// one or more replicate subcolumns under a group header. Every (row, group) cell
// therefore carries repeats, which is what a two-way ANOVA needs. A cell edit or
// a group rename calls back to the page (which writes through the Loro store with
// a debounced commit).
//
// Like the other grids this is a controlled view: it renders the passed content
// and reports edits up, so a Loro commit + reproject flows straight back in.
//
// House style: <Icon> only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useMemo } from "react";
import { Icon } from "@/components/icons";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import { cellDisplay } from "@/lib/datahub/column-table";
import { isCellExcluded } from "@/lib/datahub/cell-exclusion";
import DataCell, { type ToggleCellExclusion } from "@/components/datahub/DataCell";
import { groupDatasets, rowLabelColumn } from "@/lib/datahub/grouped-table";
import {
  useGridCrudMenu,
  type GridCrudHandlers,
} from "@/components/datahub/grid-crud-menu";

export default function GroupedTableGrid({
  content,
  onCellCommit,
  onToggleExclusion,
  onAddRow,
  onAddColumn,
  onRenameGroup,
  hideAddControls = false,
  readOnly = false,
  crud,
}: {
  content: DataHubDocContent;
  onCellCommit: (rowId: string, columnId: string, raw: string) => void;
  /** Toggle whether one replicate cell is excluded from analyses and plots. The
   *  row-label (factor A) cell is a category, not a value, so it is not
   *  excludable; only the replicate cells offer the menu item. */
  onToggleExclusion?: ToggleCellExclusion;
  onAddRow: () => void;
  /** Append a new column group (with the same replicate count as the others). */
  onAddColumn: () => void;
  /** Rename a column group (updates every replicate column in the group). */
  onRenameGroup: (datasetId: string, name: string) => void;
  /** Suppress the internal Add bar when the WorkspaceToolbar owns those actions. */
  hideAddControls?: boolean;
  /** Render the table as a computed, NON-editable view (a derived table). */
  readOnly?: boolean;
  /** Right-click CRUD callbacks. A Grouped table's columns are REPLICATE
   *  subcolumns bound into datasetId groups, not free-standing data columns, so a
   *  generic per-column delete / duplicate / insert would leave uneven replicate
   *  counts and orphan a group. The generic per-column menu is therefore NOT
   *  attached here; instead the row menu (insert / delete row) lives on the
   *  row-number cell and a GROUP-aware menu (delete / duplicate group, add /
   *  remove replicate, insert group before / after) lives on the group header. */
  crud?: GridCrudHandlers;
}) {
  const labelCol = useMemo(() => rowLabelColumn(content), [content]);
  const groups = useMemo(() => groupDatasets(content), [content]);
  const rows = content.rows;
  // Row + group menus only (see the crud prop note): the generic column menu
  // would corrupt the replicate-group structure, so its handlers are not
  // forwarded. The group handlers operate on a whole datasetId or its replicate
  // count, which keeps the groups even.
  const groupedCrud = useMemo<GridCrudHandlers>(
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
  const menu = useGridCrudMenu(content, readOnly ? {} : groupedCrud);

  return (
    <div data-testid="datahub-grouped-grid">
      {!hideAddControls && !readOnly && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onAddRow}
            className="ros-btn-neutral flex items-center gap-1 px-2.5 py-1.5 text-meta font-medium text-foreground"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add row
          </button>
          <button
            type="button"
            onClick={onAddColumn}
            className="ros-btn-neutral flex items-center gap-1 px-2.5 py-1.5 text-meta font-medium text-foreground"
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
              <th
                rowSpan={2}
                className="min-w-[110px] border border-border bg-surface-sunken px-3 py-1.5 text-center text-body font-semibold text-foreground"
              >
                {labelCol?.name ?? "Row"}
              </th>
              {groups.map((g) => (
                <th
                  key={g.datasetId}
                  colSpan={g.replicateColumnIds.length}
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
                g.replicateColumnIds.map((colId, i) => (
                  <th
                    key={colId}
                    className="min-w-[70px] border border-border bg-surface-sunken px-2 py-0.5 text-center text-[10px] font-medium uppercase tracking-wide text-foreground-muted"
                  >
                    r{i + 1}
                  </th>
                )),
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
                {labelCol && (
                  <td className="border border-border bg-surface-raised p-0 text-center">
                    <input
                      type="text"
                      defaultValue={cellDisplay(row.cells[labelCol.id] ?? null)}
                      key={`${row.id}:${labelCol.id}:${cellDisplay(
                        row.cells[labelCol.id] ?? null,
                      )}`}
                      readOnly={readOnly}
                      onBlur={
                        readOnly
                          ? undefined
                          : (e) =>
                              onCellCommit(
                                row.id,
                                labelCol.id,
                                e.currentTarget.value,
                              )
                      }
                      onKeyDown={(e) => {
                        if (!readOnly && e.key === "Enter")
                          e.currentTarget.blur();
                      }}
                      aria-label={`Row label ${r + 1}`}
                      placeholder="Label"
                      className={`w-full bg-transparent px-3 py-1.5 text-center text-body text-foreground placeholder:text-foreground-muted outline-none ${
                        readOnly ? "cursor-default" : "focus:bg-accent-soft"
                      }`}
                    />
                  </td>
                )}
                {groups.flatMap((g) =>
                  g.replicateColumnIds.map((colId) => (
                    <DataCell
                      key={colId}
                      rowId={row.id}
                      columnId={colId}
                      value={row.cells[colId] ?? null}
                      excluded={isCellExcluded(content, row.id, colId)}
                      onToggleExclusion={onToggleExclusion}
                      ariaLabel={`${g.name} replicate, row ${r + 1}`}
                      onCellCommit={onCellCommit}
                      readOnly={readOnly}
                    />
                  )),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 max-w-xl text-meta text-foreground-muted">
        Label each row with its category in the first column and enter the
        replicates under each group. A two-way ANOVA reads the row factor, the
        groups, and their interaction straight from these cells.
      </p>
    </div>
  );
}
