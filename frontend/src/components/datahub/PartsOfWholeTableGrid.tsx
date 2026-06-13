"use client";

// The editable Parts-of-whole table grid (more-table-types slice). Each ROW is
// one CATEGORY of a single whole: an editable text label and one non-negative
// VALUE (the size of that slice). A read-only "% of total" column shows each
// category's percent of the total live (value / sum * 100), the way GraphPad's
// Parts-of-whole table surfaces the percentages next to the entered values. Each
// cell edit calls back to the page (which writes it through the Loro store with a
// debounced commit).
//
// Like the other grids this is a controlled view: it renders the passed content
// and reports edits up, so a Loro commit + reproject flows straight back in. The
// percent column is computed, not entered, so there is no figure / test to gate.
//
// House style: <Icon> only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useMemo } from "react";
import { Icon } from "@/components/icons";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import { isCellExcluded } from "@/lib/datahub/cell-exclusion";
import DataCell, { type ToggleCellExclusion } from "@/components/datahub/DataCell";
import {
  categoryLabelColumn,
  valueColumn,
  partsOfWhole,
} from "@/lib/datahub/parts-of-whole-table";
import {
  useGridCrudMenu,
  ColumnRenameInput,
  type GridCrudHandlers,
} from "@/components/datahub/grid-crud-menu";

export default function PartsOfWholeTableGrid({
  content,
  onCellCommit,
  onToggleExclusion,
  onAddRow,
  hideAddControls = false,
  readOnly = false,
  crud,
}: {
  content: DataHubDocContent;
  /** Persist a single cell edit (row id, column id, the raw input string). */
  onCellCommit: (rowId: string, columnId: string, raw: string) => void;
  /** Toggle whether one value cell is excluded from the total (reads as absent). */
  onToggleExclusion?: ToggleCellExclusion;
  /** Append a new category (a new row). */
  onAddRow: () => void;
  /** Suppress the internal Add bar when the WorkspaceToolbar owns those actions. */
  hideAddControls?: boolean;
  /** Render the table as a computed, NON-editable view (a derived table). */
  readOnly?: boolean;
  /** Right-click row/column CRUD callbacks (see grid-crud-menu). */
  crud?: GridCrudHandlers;
}) {
  const labelCol = useMemo(() => categoryLabelColumn(content), [content]);
  const valCol = useMemo(() => valueColumn(content), [content]);
  const { categories, total } = useMemo(() => partsOfWhole(content), [content]);
  const rows = content.rows;
  const menu = useGridCrudMenu(content, readOnly ? {} : crud ?? {});

  return (
    <div data-testid="datahub-parts-of-whole-grid">
      {!hideAddControls && !readOnly && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onAddRow}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add category
          </button>
        </div>
      )}

      <div className="overflow-auto rounded-lg border border-border">
        <table className="border-collapse text-body tabular-nums">
          <thead>
            <tr>
              <th className="border border-border bg-surface-sunken px-3 py-1.5 text-meta font-medium text-foreground-muted">
                #
              </th>
              {/* The category-label column header. */}
              <th
                onContextMenu={
                  readOnly || !labelCol
                    ? undefined
                    : (e) => menu.openColumnMenu(e, labelCol.id)
                }
                onDoubleClick={() => {
                  if (!readOnly && labelCol) menu.beginRename(labelCol.id);
                }}
                className="min-w-[130px] border border-border bg-accent-soft px-3 py-1.5 text-center text-body font-semibold text-accent"
              >
                {labelCol && menu.renamingColumnId === labelCol.id ? (
                  <ColumnRenameInput
                    initialName={labelCol.name}
                    onCommit={(name) => menu.commitRename(labelCol.id, name)}
                    onCancel={menu.cancelRename}
                  />
                ) : (
                  labelCol?.name ?? "Category"
                )}
              </th>
              {/* The single value column. */}
              <th
                onContextMenu={
                  readOnly || !valCol
                    ? undefined
                    : (e) => menu.openColumnMenu(e, valCol.id)
                }
                onDoubleClick={() => {
                  if (!readOnly && valCol) menu.beginRename(valCol.id);
                }}
                className="min-w-[96px] border border-border bg-surface-sunken px-3 py-1.5 text-center text-body font-semibold text-foreground"
              >
                {valCol && menu.renamingColumnId === valCol.id ? (
                  <ColumnRenameInput
                    initialName={valCol.name}
                    onCommit={(name) => menu.commitRename(valCol.id, name)}
                    onCancel={menu.cancelRename}
                  />
                ) : (
                  valCol?.name ?? "Value"
                )}
              </th>
              {/* The computed percent-of-total column (read only). */}
              <th className="min-w-[96px] border border-border bg-surface-sunken px-3 py-1.5 text-center text-body font-semibold text-foreground-muted">
                % of total
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const cat = categories[r];
              return (
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
                    <DataCell
                      rowId={row.id}
                      columnId={labelCol.id}
                      value={row.cells[labelCol.id] ?? null}
                      excluded={false}
                      ariaLabel={`Category ${r + 1}`}
                      onCellCommit={onCellCommit}
                      readOnly={readOnly}
                    />
                  )}
                  {valCol && (
                    <DataCell
                      rowId={row.id}
                      columnId={valCol.id}
                      value={row.cells[valCol.id] ?? null}
                      excluded={isCellExcluded(content, row.id, valCol.id)}
                      onToggleExclusion={onToggleExclusion}
                      ariaLabel={`Value, category ${r + 1}`}
                      onCellCommit={onCellCommit}
                      readOnly={readOnly}
                    />
                  )}
                  <td className="border border-border bg-surface-raised px-3 py-1 text-center text-body text-foreground-muted">
                    {cat && cat.percent !== null
                      ? `${cat.percent.toFixed(1)}%`
                      : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr data-testid="datahub-parts-of-whole-footer-total">
              <td className="border border-border bg-surface-sunken px-3 py-1 text-center text-meta text-foreground-muted" />
              <td className="border border-border bg-surface-sunken px-3 py-1 text-right text-meta font-medium uppercase tracking-wide text-foreground-muted">
                Total
              </td>
              <td className="border border-border bg-surface-sunken px-3 py-1 text-center text-meta text-foreground-muted">
                {Number.isInteger(total) ? String(total) : total.toFixed(2)}
              </td>
              <td className="border border-border bg-surface-sunken px-3 py-1 text-center text-meta text-foreground-muted">
                {total > 0 ? "100%" : ""}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-3 max-w-xl text-meta text-foreground-muted">
        Each row is one slice of a single whole, a label and a non-negative value.
        The percent of total recomputes live as you type. Make a pie, a donut, or
        a 100-percent stacked bar from the New graph button, and the figure reads
        these slices straight from the table.
      </p>
    </div>
  );
}
