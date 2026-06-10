"use client";

// The editable Column-table grid (datahub-tab-p1). Each group column is a
// treatment, each row a replicate. A cell edit calls back to the page (which
// writes it through the Loro store with a debounced commit); the footer shows
// mean / SD / SEM / n recomputed live from the current content via the engine.
//
// The grid is a controlled view: it renders the passed DataHubDocContent and
// reports edits up. It does not own the data, so a Loro commit + reproject flows
// straight back in as new props and the footer re-derives.
//
// House style: <Icon> only, Tooltip on icon-only buttons, brand + semantic
// tokens, no emojis / em-dashes / mid-sentence colons.

import { useMemo } from "react";
import { Icon } from "@/components/icons";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import {
  cellDisplay,
  computeAllGroupStats,
  formatStat,
  groupColumns,
} from "@/lib/datahub/column-table";

export default function DataTableGrid({
  content,
  onCellCommit,
  onAddRow,
  onAddColumn,
}: {
  content: DataHubDocContent;
  /** Persist a single cell edit (row id, column id, the raw input string; the
   *  page parses it into a typed CellValue before writing). */
  onCellCommit: (rowId: string, columnId: string, raw: string) => void;
  onAddRow: () => void;
  onAddColumn: () => void;
}) {
  const columns = useMemo(() => groupColumns(content), [content]);
  const stats = useMemo(() => computeAllGroupStats(content), [content]);
  const rows = content.rows;

  return (
    <div data-testid="datahub-data-grid">
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
              <th className="border border-border bg-surface-sunken px-3 py-1.5 text-meta font-medium text-foreground-muted">
                #
              </th>
              {columns.map((col) => (
                <th
                  key={col.id}
                  className="min-w-[96px] border border-border bg-surface-sunken px-3 py-1.5 text-center text-body font-semibold text-foreground"
                >
                  {col.name}
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
                      // defaultValue + onBlur (uncontrolled per render) so the
                      // debounced Loro commit + reproject does not fight the
                      // caret while the user is mid-type. The key includes the
                      // stored value so an external change (a collaborator's
                      // edit) reseeds the input.
                      key={`${row.id}:${col.id}:${cellDisplay(
                        row.cells[col.id] ?? null,
                      )}`}
                      onBlur={(e) =>
                        onCellCommit(row.id, col.id, e.currentTarget.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      aria-label={`${col.name} replicate ${r + 1}`}
                      className="w-full bg-transparent px-3 py-1.5 text-center text-body text-foreground outline-none focus:bg-accent-soft"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            {(["mean", "sd", "sem", "n"] as const).map((kind) => (
              <tr key={kind} data-testid={`datahub-footer-${kind}`}>
                <td className="border border-border bg-surface-sunken px-3 py-1 text-right text-meta font-medium uppercase tracking-wide text-foreground-muted">
                  {kind === "sem" ? "SEM" : kind === "sd" ? "SD" : kind === "n" ? "n" : "Mean"}
                </td>
                {columns.map((col) => {
                  const s = stats[col.id];
                  const text =
                    kind === "n"
                      ? String(s?.n ?? 0)
                      : formatStat(s ? s[kind] : null);
                  return (
                    <td
                      key={col.id}
                      className="border border-border bg-surface-sunken px-3 py-1 text-center text-meta text-foreground-muted"
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tfoot>
        </table>
      </div>

      <p className="mt-3 max-w-xl text-meta text-foreground-muted">
        The mean, SD, SEM, and n are computed from the raw replicates with no
        analysis step, so any graph of this table picks up the same numbers live.
      </p>
    </div>
  );
}
