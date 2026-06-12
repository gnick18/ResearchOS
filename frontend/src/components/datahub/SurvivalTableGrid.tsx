"use client";

// The editable Survival-table grid (more-table-types slice). Three columns: the
// Time the subject was observed, the Event indicator (1 = the event happened,
// 0 = right censored), and an optional Group label so arms can be compared. Each
// row is one subject. A cell edit calls back to the page (which writes through
// the Loro store with a debounced commit).
//
// House style: <Icon> only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useMemo } from "react";
import { Icon } from "@/components/icons";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import { cellDisplay } from "@/lib/datahub/column-table";
import {
  timeColumn,
  eventColumn,
  groupColumn,
} from "@/lib/datahub/survival-table";

export default function SurvivalTableGrid({
  content,
  onCellCommit,
  onAddRow,
  hideAddControls = false,
}: {
  content: DataHubDocContent;
  onCellCommit: (rowId: string, columnId: string, raw: string) => void;
  onAddRow: () => void;
  /** Suppress the internal Add bar when the WorkspaceToolbar owns those actions. */
  hideAddControls?: boolean;
}) {
  const cols = useMemo(() => {
    const t = timeColumn(content);
    const e = eventColumn(content);
    const g = groupColumn(content);
    const out: { id: string; name: string; hint: string }[] = [];
    if (t) out.push({ id: t.id, name: t.name, hint: "time" });
    if (e) out.push({ id: e.id, name: e.name, hint: "1 = event, 0 = censored" });
    if (g) out.push({ id: g.id, name: g.name, hint: "optional arm" });
    return out;
  }, [content]);
  const rows = content.rows;

  return (
    <div data-testid="datahub-survival-grid">
      {!hideAddControls && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onAddRow}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add subject
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
              {cols.map((col) => (
                <th
                  key={col.id}
                  className="min-w-[110px] border border-border bg-surface-sunken px-3 py-1.5 text-center text-body font-semibold text-foreground"
                >
                  {col.name}
                  <span className="mt-0.5 block text-[10px] font-normal normal-case text-foreground-muted">
                    {col.hint}
                  </span>
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
                {cols.map((col) => (
                  <td
                    key={col.id}
                    className="border border-border bg-surface-raised p-0 text-center"
                  >
                    <input
                      type="text"
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
                      aria-label={`${col.name} subject ${r + 1}`}
                      className="w-full bg-transparent px-3 py-1.5 text-center text-body text-foreground outline-none focus:bg-accent-soft"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 max-w-xl text-meta text-foreground-muted">
        Enter each subject's follow-up time and whether the event occurred (1) or
        the subject was censored (0). Add a Group label to compare arms with a
        Kaplan-Meier curve and the log-rank test.
      </p>
    </div>
  );
}
