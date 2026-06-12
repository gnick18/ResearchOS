"use client";

// The editable Column-table grid (datahub-tab-p1). Each group column is a
// treatment, each row a replicate. A cell edit calls back to the page (which
// writes it through the Loro store with a debounced commit); the footer shows
// mean / SD / SEM / n recomputed live from the current content via the engine.
//
// When the table is in a summary entry format (Mean + SD + N or Mean + SEM + N)
// the grid renders a COMPACT SUMMARY EDITOR instead of the replicate rows: one
// column per group, three labeled editable cells (Mean / SD or SEM / N) wired
// through the same cell-commit path. A summary table has no raw replicates, so
// the footer stats and the replicate rows do not apply there. The replicates
// rendering is unchanged when the table is not summary.
//
// The grid is a controlled view: it renders the passed DataHubDocContent and
// reports edits up. It does not own the data, so a Loro commit + reproject flows
// straight back in as new props and the footer re-derives.
//
// House style: <Icon> only, Tooltip on icon-only buttons, brand + semantic
// tokens, no emojis / em-dashes / mid-sentence colons.

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import {
  cellDisplay,
  computeAllGroupStats,
  formatStat,
  groupColumns,
} from "@/lib/datahub/column-table";
import {
  entryFormatOf,
  isSummaryFormat,
  readAllGroupSummaries,
  spreadKindOf,
  summaryColumnId,
} from "@/lib/datahub/summary-table";
import {
  useGridCrudMenu,
  ColumnRenameInput,
  type GridCrudHandlers,
} from "@/components/datahub/grid-crud-menu";

/** A single editable summary cell (Mean / spread / N). Mirrors the replicate
 *  cell idiom: defaultValue + key on the stored value so an external change
 *  reseeds it, commit on blur / Enter through the same cell-commit callback. */
function SummaryCell({
  rowId,
  columnId,
  value,
  ariaLabel,
  onCellCommit,
}: {
  rowId: string;
  columnId: string;
  value: number | null;
  ariaLabel: string;
  onCellCommit: (rowId: string, columnId: string, raw: string) => void;
}) {
  const display = value === null ? "" : String(value);
  return (
    <td className="border border-border bg-surface-raised p-0 text-center">
      <input
        type="text"
        inputMode="decimal"
        defaultValue={display}
        key={`${rowId}:${columnId}:${display}`}
        onBlur={(e) => onCellCommit(rowId, columnId, e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        aria-label={ariaLabel}
        className="w-full bg-transparent px-3 py-1.5 text-center text-body text-foreground outline-none focus:bg-accent-soft"
      />
    </td>
  );
}

/**
 * The summary editor: one column per group, three labeled rows (Mean, the
 * format's spread, N). Replaces the replicate rows when the table is in a
 * summary entry format. Group headers rename inline on double-click (Enter /
 * blur commits, Escape cancels -- same idiom as the replicate-mode header via
 * ColumnRenameInput). The rename flows to all three of the group's subcolumns
 * via onRenameSummaryGroup. There is exactly one summary row, so each cell is
 * keyed by (the single summary row id, the group's kind-subcolumn id).
 */
function SummaryEditor({
  content,
  onCellCommit,
  onRenameSummaryGroup,
}: {
  content: DataHubDocContent;
  onCellCommit: (rowId: string, columnId: string, raw: string) => void;
  onRenameSummaryGroup?: (datasetId: string, name: string) => void;
}) {
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const groups = useMemo(() => readAllGroupSummaries(content), [content]);
  const spreadKind = spreadKindOf(entryFormatOf(content));
  const spreadLabel = spreadKind === "sem" ? "SEM" : "SD";
  // The single summary row id (every group's three cells live on this one row).
  const rowId = content.rows[0]?.id ?? "row-1";

  const statRows: { key: "mean" | "sd" | "sem" | "n"; label: string }[] = [
    { key: "mean", label: "Mean" },
    { key: spreadKind, label: spreadLabel },
    { key: "n", label: "N" },
  ];

  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="border-collapse text-body tabular-nums">
        <thead>
          <tr>
            <th className="border border-border bg-surface-sunken px-3 py-1.5 text-meta font-medium text-foreground-muted">
              Stat
            </th>
            {groups.map((g) => (
              <th
                key={g.datasetId}
                onDoubleClick={() => {
                  if (!onRenameSummaryGroup) return;
                  setRenamingGroupId(g.datasetId);
                }}
                className="min-w-[96px] border border-border bg-surface-sunken px-3 py-1.5 text-center text-body font-semibold text-foreground"
              >
                {renamingGroupId === g.datasetId ? (
                  <ColumnRenameInput
                    initialName={g.name}
                    onCommit={(name) => {
                      setRenamingGroupId(null);
                      if (name.trim() !== "") {
                        onRenameSummaryGroup?.(g.datasetId, name.trim());
                      }
                    }}
                    onCancel={() => setRenamingGroupId(null)}
                  />
                ) : (
                  g.name
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {statRows.map((r) => (
            <tr key={r.key} data-testid={`datahub-summary-${r.key}`}>
              <td className="border border-border bg-surface-sunken px-3 py-1 text-right text-meta font-medium uppercase tracking-wide text-foreground-muted">
                {r.label}
              </td>
              {groups.map((g) => {
                const colId = summaryColumnId(g.datasetId, r.key);
                const value =
                  r.key === "mean" ? g.mean : r.key === "n" ? g.n : g.spread;
                return (
                  <SummaryCell
                    key={g.datasetId}
                    rowId={rowId}
                    columnId={colId}
                    value={value}
                    ariaLabel={`${g.name} ${r.label}`}
                    onCellCommit={onCellCommit}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DataTableGrid({
  content,
  onCellCommit,
  onAddRow,
  onAddColumn,
  onRenameSummaryGroup,
  hideAddControls = false,
  crud,
}: {
  content: DataHubDocContent;
  /** Persist a single cell edit (row id, column id, the raw input string; the
   *  page parses it into a typed CellValue before writing). */
  onCellCommit: (rowId: string, columnId: string, raw: string) => void;
  onAddRow: () => void;
  onAddColumn: () => void;
  /** Rename a summary group (renames all three of its subcolumns). Summary mode
   *  only; omitted in isolated renders / tests. */
  onRenameSummaryGroup?: (datasetId: string, name: string) => void;
  /** Suppress the internal Add row / Add group bar when the page renders the
   *  WorkspaceToolbar above the grid (the toolbar owns those actions there). */
  hideAddControls?: boolean;
  /** Right-click row/column CRUD callbacks. Omitted in isolated renders / tests
   *  that do not mount the ContextMenuProvider, in which case no menus attach. */
  crud?: GridCrudHandlers;
}) {
  const summary = isSummaryFormat(content.meta.entryFormat);
  const columns = useMemo(() => groupColumns(content), [content]);
  const stats = useMemo(() => computeAllGroupStats(content), [content]);
  const rows = content.rows;
  const menu = useGridCrudMenu(content, crud ?? {});

  return (
    <div data-testid="datahub-data-grid">
      {!hideAddControls && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {/* A summary table has a single fixed row (the entered descriptives),
              so Add row is hidden there; only Add group applies. */}
          {!summary && (
            <button
              type="button"
              onClick={onAddRow}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
            >
              <Icon name="plus" className="h-3.5 w-3.5" />
              Add row
            </button>
          )}
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

      {summary ? (
        <>
          <SummaryEditor
            content={content}
            onCellCommit={onCellCommit}
            onRenameSummaryGroup={onRenameSummaryGroup}
          />
          <p className="mt-3 max-w-xl text-meta text-foreground-muted">
            You entered each group's mean, spread, and n directly, so any graph
            and the summary-compatible tests draw from these numbers. There are
            no raw replicates in this format. Double-click a group name to rename
            it.
          </p>
        </>
      ) : (
        <>
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
                      onContextMenu={(e) => menu.openColumnMenu(e, col.id)}
                      onDoubleClick={() => menu.beginRename(col.id)}
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
                      onContextMenu={(e) => menu.openRowMenu(e, row.id)}
                      className="border border-border bg-surface-sunken px-3 py-1 text-center text-meta text-foreground-muted"
                    >
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
                      {kind === "sem"
                        ? "SEM"
                        : kind === "sd"
                          ? "SD"
                          : kind === "n"
                            ? "n"
                            : "Mean"}
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
            analysis step, so any graph of this table picks up the same numbers
            live.
          </p>
        </>
      )}
    </div>
  );
}
