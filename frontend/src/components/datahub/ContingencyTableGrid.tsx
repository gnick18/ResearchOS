"use client";

// The editable Contingency-table grid (more-table-types slice). An R x C grid of
// non-negative integer counts. The first column is the row-label column (the
// categories of one factor, an editable text cell per row); every following
// column is a count column whose header is one category of the other factor
// (editable inline) and whose cells are the counts. Each cell edit calls back to
// the page (which writes it through the Loro store with a debounced commit).
//
// Like the other grids this is a controlled view: it renders the passed content
// and reports edits up, so a Loro commit + reproject flows straight back in. The
// footer shows each column's total so the margins are legible while editing.
//
// House style: <Icon> only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useMemo } from "react";
import { Icon } from "@/components/icons";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import { isCellExcluded } from "@/lib/datahub/cell-exclusion";
import DataCell, { type ToggleCellExclusion } from "@/components/datahub/DataCell";
import { rowLabelColumn, countColumns } from "@/lib/datahub/contingency-table";
import {
  useGridCrudMenu,
  ColumnRenameInput,
  type GridCrudHandlers,
} from "@/components/datahub/grid-crud-menu";

function columnTotal(content: DataHubDocContent, columnId: string): number {
  let total = 0;
  for (const row of content.rows) {
    if (isCellExcluded(content, row.id, columnId)) continue;
    const v = row.cells[columnId];
    const n =
      typeof v === "number"
        ? v
        : typeof v === "string" && v.trim() !== ""
          ? Number(v)
          : NaN;
    if (Number.isFinite(n) && n >= 0) total += Math.round(n);
  }
  return total;
}

export default function ContingencyTableGrid({
  content,
  onCellCommit,
  onToggleExclusion,
  onAddRow,
  onAddColumn,
  hideAddControls = false,
  readOnly = false,
  crud,
}: {
  content: DataHubDocContent;
  /** Persist a single cell edit (row id, column id, the raw input string). */
  onCellCommit: (rowId: string, columnId: string, raw: string) => void;
  /** Toggle whether one count cell is excluded from the test (reads as 0). */
  onToggleExclusion?: ToggleCellExclusion;
  /** Append a new category of the row factor (a new row). */
  onAddRow: () => void;
  /** Append a new category of the column factor (a new count column). */
  onAddColumn: () => void;
  /** Suppress the internal Add bar when the WorkspaceToolbar owns those actions. */
  hideAddControls?: boolean;
  /** Render the table as a computed, NON-editable view (a derived table). */
  readOnly?: boolean;
  /** Right-click row/column CRUD callbacks (see grid-crud-menu). */
  crud?: GridCrudHandlers;
}) {
  const labelCol = useMemo(() => rowLabelColumn(content), [content]);
  const counts = useMemo(() => countColumns(content), [content]);
  const rows = content.rows;
  const menu = useGridCrudMenu(content, readOnly ? {} : crud ?? {});

  const totals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of counts) out[c.id] = columnTotal(content, c.id);
    return out;
  }, [counts, content]);

  return (
    <div data-testid="datahub-contingency-grid">
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
            Add column
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
              {/* The row-label column header (the row factor's name). */}
              <th
                onContextMenu={
                  readOnly || !labelCol
                    ? undefined
                    : (e) => menu.openColumnMenu(e, labelCol.id)
                }
                onDoubleClick={() => {
                  if (!readOnly && labelCol) menu.beginRename(labelCol.id);
                }}
                className="min-w-[110px] border border-border bg-accent-soft px-3 py-1.5 text-center text-body font-semibold text-accent"
              >
                {labelCol && menu.renamingColumnId === labelCol.id ? (
                  <ColumnRenameInput
                    initialName={labelCol.name}
                    onCommit={(name) => menu.commitRename(labelCol.id, name)}
                    onCancel={menu.cancelRename}
                  />
                ) : (
                  labelCol?.name ?? "Group"
                )}
              </th>
              {/* The count columns (the column factor's categories). */}
              {counts.map((col) => (
                <th
                  key={col.id}
                  onContextMenu={
                    readOnly ? undefined : (e) => menu.openColumnMenu(e, col.id)
                  }
                  onDoubleClick={() => {
                    if (!readOnly) menu.beginRename(col.id);
                  }}
                  className="min-w-[96px] border border-border bg-surface-sunken px-3 py-1.5 text-center text-body font-semibold text-foreground"
                >
                  {menu.renamingColumnId === col.id ? (
                    <ColumnRenameInput
                      initialName={col.name}
                      onCommit={(name) => menu.commitRename(col.id, name)}
                      onCancel={menu.cancelRename}
                    />
                  ) : (
                    col.name
                  )}
                </th>
              ))}
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
                {/* The editable row-label cell (a category of the row factor). */}
                {labelCol && (
                  <DataCell
                    rowId={row.id}
                    columnId={labelCol.id}
                    value={row.cells[labelCol.id] ?? null}
                    excluded={false}
                    ariaLabel={`Row label ${r + 1}`}
                    onCellCommit={onCellCommit}
                    readOnly={readOnly}
                  />
                )}
                {counts.map((col) => (
                  <DataCell
                    key={col.id}
                    rowId={row.id}
                    columnId={col.id}
                    value={row.cells[col.id] ?? null}
                    excluded={isCellExcluded(content, row.id, col.id)}
                    onToggleExclusion={onToggleExclusion}
                    ariaLabel={`${col.name} count, row ${r + 1}`}
                    onCellCommit={onCellCommit}
                    readOnly={readOnly}
                  />
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="datahub-contingency-footer-totals">
              <td className="border border-border bg-surface-sunken px-3 py-1 text-center text-meta text-foreground-muted" />
              <td className="border border-border bg-surface-sunken px-3 py-1 text-right text-meta font-medium uppercase tracking-wide text-foreground-muted">
                Total
              </td>
              {counts.map((col) => (
                <td
                  key={col.id}
                  className="border border-border bg-surface-sunken px-3 py-1 text-center text-meta text-foreground-muted"
                >
                  {String(totals[col.id] ?? 0)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-3 max-w-xl text-meta text-foreground-muted">
        Each cell is a count of how many subjects fall in that row category and
        that column category. The chi-square test reads the whole grid live. A 2x2
        table also reports Fisher&apos;s exact p, the relative risk, and the odds
        ratio, reading the first row as exposed and the first column as the event.
      </p>
    </div>
  );
}
