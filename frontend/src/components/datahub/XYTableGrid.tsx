"use client";

// The editable XY-table grid (more-table-types slice). The first column is the
// X (independent) variable, every following column is a Y (response). Each row
// is one observation, so the X value of a row pairs with the Y values of that
// same row. A cell edit calls back to the page (which writes it through the Loro
// store with a debounced commit); the footer shows the count of finite (x, y)
// pairs each Y column contributes, which is the n every XY analysis runs on.
//
// Like DataTableGrid this is a controlled view: it renders the passed content
// and reports edits up, so a Loro commit + reproject flows straight back in.
//
// House style: <Icon> only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useMemo } from "react";
import { Icon } from "@/components/icons";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import { cellDisplay } from "@/lib/datahub/column-table";
import { pairCount, xColumn, yColumns } from "@/lib/datahub/xy-table";

export default function XYTableGrid({
  content,
  onCellCommit,
  onAddRow,
  onAddColumn,
}: {
  content: DataHubDocContent;
  /** Persist a single cell edit (row id, column id, the raw input string). */
  onCellCommit: (rowId: string, columnId: string, raw: string) => void;
  onAddRow: () => void;
  /** Append a new Y (response) column. */
  onAddColumn: () => void;
}) {
  const xCol = useMemo(() => xColumn(content), [content]);
  const ys = useMemo(() => yColumns(content), [content]);
  const rows = content.rows;

  // The grid columns in render order: X first, then the Y columns.
  const columns = useMemo(
    () => (xCol ? [{ id: xCol.id, name: xCol.name, isX: true }] : []).concat(
      ys.map((c) => ({ id: c.id, name: c.name, isX: false })),
    ),
    [xCol, ys],
  );

  const pairCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of ys) out[c.id] = pairCount(content, c.id);
    return out;
  }, [ys, content]);

  return (
    <div data-testid="datahub-xy-grid">
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
          Add Y column
        </button>
      </div>

      <div className="overflow-auto rounded-lg border border-border">
        <table className="border-collapse text-body tabular-nums">
          <thead>
            <tr>
              <th className="border border-border bg-surface-sunken px-3 py-1.5 text-meta font-medium text-foreground-muted">
                #
              </th>
              {columns.map((col) => (
                <th
                  key={col.id}
                  className={`min-w-[96px] border border-border px-3 py-1.5 text-center text-body font-semibold ${
                    col.isX
                      ? "bg-accent-soft text-accent"
                      : "bg-surface-sunken text-foreground"
                  }`}
                >
                  {col.name}
                  {col.isX && (
                    <span className="ml-1 text-[10px] font-medium uppercase opacity-70">
                      X
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row.id}>
                <td className="border border-border bg-surface-sunken px-3 py-1 text-center text-meta text-foreground-muted">
                  {r + 1}
                </td>
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className="border border-border bg-surface-raised p-0 text-center"
                  >
                    <input
                      type="text"
                      inputMode="decimal"
                      defaultValue={cellDisplay(row.cells[col.id] ?? null)}
                      key={`${row.id}:${col.id}:${cellDisplay(
                        row.cells[col.id] ?? null,
                      )}`}
                      onBlur={(e) =>
                        onCellCommit(row.id, col.id, e.currentTarget.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      aria-label={`${col.name} row ${r + 1}`}
                      className="w-full bg-transparent px-3 py-1.5 text-center text-body text-foreground outline-none focus:bg-accent-soft"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="datahub-xy-footer-n">
              <td className="border border-border bg-surface-sunken px-3 py-1 text-right text-meta font-medium uppercase tracking-wide text-foreground-muted">
                n pairs
              </td>
              {columns.map((col) => (
                <td
                  key={col.id}
                  className="border border-border bg-surface-sunken px-3 py-1 text-center text-meta text-foreground-muted"
                >
                  {col.isX ? "" : String(pairCounts[col.id] ?? 0)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-3 max-w-xl text-meta text-foreground-muted">
        Each row pairs one X value with the Y values beside it. Correlation, a
        line of best fit, and a fitted curve all read these pairs live, so an
        edit re-runs the analysis without a separate step.
      </p>
    </div>
  );
}
