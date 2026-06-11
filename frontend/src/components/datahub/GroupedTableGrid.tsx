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
import { groupDatasets, rowLabelColumn } from "@/lib/datahub/grouped-table";

export default function GroupedTableGrid({
  content,
  onCellCommit,
  onAddRow,
  onAddColumn,
  onRenameGroup,
}: {
  content: DataHubDocContent;
  onCellCommit: (rowId: string, columnId: string, raw: string) => void;
  onAddRow: () => void;
  /** Append a new column group (with the same replicate count as the others). */
  onAddColumn: () => void;
  /** Rename a column group (updates every replicate column in the group). */
  onRenameGroup: (datasetId: string, name: string) => void;
}) {
  const labelCol = useMemo(() => rowLabelColumn(content), [content]);
  const groups = useMemo(() => groupDatasets(content), [content]);
  const rows = content.rows;

  return (
    <div data-testid="datahub-grouped-grid">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onAddRow}
          className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
        >
          <Icon name="plus" className="h-3.5 w-3.5" />
          Add row
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
                  className="border border-border bg-surface-sunken px-2 py-1 text-center"
                >
                  <input
                    type="text"
                    defaultValue={g.name}
                    key={`${g.datasetId}:${g.name}`}
                    onBlur={(e) => onRenameGroup(g.datasetId, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    aria-label={`Group name ${g.name}`}
                    className="w-full bg-transparent text-center text-body font-semibold text-foreground outline-none focus:bg-accent-soft"
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
                <td className="border border-border bg-surface-sunken px-3 py-1 text-center text-meta text-foreground-muted">
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
                      onBlur={(e) =>
                        onCellCommit(row.id, labelCol.id, e.currentTarget.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      aria-label={`Row label ${r + 1}`}
                      placeholder="Label"
                      className="w-full bg-transparent px-3 py-1.5 text-center text-body text-foreground placeholder:text-foreground-muted outline-none focus:bg-accent-soft"
                    />
                  </td>
                )}
                {groups.flatMap((g) =>
                  g.replicateColumnIds.map((colId) => (
                    <td
                      key={colId}
                      className="border border-border bg-surface-raised p-0 text-center"
                    >
                      <input
                        type="text"
                        inputMode="decimal"
                        defaultValue={cellDisplay(row.cells[colId] ?? null)}
                        key={`${row.id}:${colId}:${cellDisplay(
                          row.cells[colId] ?? null,
                        )}`}
                        onBlur={(e) =>
                          onCellCommit(row.id, colId, e.currentTarget.value)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        aria-label={`${g.name} replicate, row ${r + 1}`}
                        className="w-full bg-transparent px-2 py-1.5 text-center text-body text-foreground outline-none focus:bg-accent-soft"
                      />
                    </td>
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
