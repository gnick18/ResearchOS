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
import { isCellExcluded } from "@/lib/datahub/cell-exclusion";
import DataCell, { type ToggleCellExclusion } from "@/components/datahub/DataCell";
import {
  timeColumn,
  eventColumn,
  groupColumn,
} from "@/lib/datahub/survival-table";
import {
  useGridCrudMenu,
  type GridCrudHandlers,
} from "@/components/datahub/grid-crud-menu";

/** True when a subject (its Time / Event pair) is excluded. Excluding either of
 *  the two data cells drops the whole subject (see survival-table.survivalGroups),
 *  so a Time / Event cell reads excluded when EITHER key is in the set. */
function isSubjectExcluded(
  content: DataHubDocContent,
  rowId: string,
  timeId: string,
  eventId: string,
): boolean {
  return (
    isCellExcluded(content, rowId, timeId) ||
    isCellExcluded(content, rowId, eventId)
  );
}

export default function SurvivalTableGrid({
  content,
  onCellCommit,
  onToggleExclusion,
  onAddRow,
  hideAddControls = false,
  readOnly = false,
  crud,
}: {
  content: DataHubDocContent;
  onCellCommit: (rowId: string, columnId: string, raw: string) => void;
  /** Toggle whether a subject is excluded from the Kaplan-Meier curve and the
   *  log-rank test. Only the Time and Event cells offer it (they are the
   *  subject's data, and excluding either drops the subject); the Group cell is a
   *  label, not a value, so it is not excludable. */
  onToggleExclusion?: ToggleCellExclusion;
  onAddRow: () => void;
  /** Suppress the internal Add bar when the WorkspaceToolbar owns those actions. */
  hideAddControls?: boolean;
  /** Render the table as a computed, NON-editable view (a derived table). */
  readOnly?: boolean;
  /** Right-click CRUD callbacks. A Survival table has THREE fixed columns (Time,
   *  Event, Group), so only the ROW menu (insert / delete subject) is wired here;
   *  deleting or duplicating a fixed column would corrupt the Kaplan-Meier inputs,
   *  so the column menu is deliberately withheld on this grid. */
  crud?: GridCrudHandlers;
}) {
  const cols = useMemo(() => {
    const t = timeColumn(content);
    const e = eventColumn(content);
    const g = groupColumn(content);
    // excludable marks the data columns (Time, Event) whose cells carry the
    // subject's measurement. Excluding either drops the subject. The Group column
    // is a label, not a value, so it is not excludable.
    const out: { id: string; name: string; hint: string; excludable: boolean }[] = [];
    if (t) out.push({ id: t.id, name: t.name, hint: "time", excludable: true });
    if (e) out.push({ id: e.id, name: e.name, hint: "1 = event, 0 = censored", excludable: true });
    if (g) out.push({ id: g.id, name: g.name, hint: "optional arm", excludable: false });
    return out;
  }, [content]);
  // The Time / Event ids drive subject exclusion. Exclude / include is keyed on
  // the Time cell as the canonical subject key, so toggling from either the Time
  // or the Event cell hits the SAME key and stays symmetric (include undoes
  // exactly what exclude set). The read path still drops the subject when either
  // key is present, which keeps a hand-edited mirror working too.
  const timeId = useMemo(() => timeColumn(content)?.id ?? null, [content]);
  const eventId = useMemo(() => eventColumn(content)?.id ?? null, [content]);
  const rows = content.rows;
  // Row-only menu: pass through just the row handlers so the column menu can never
  // surface on this grid's fixed Time / Event / Group headers. Memoized so the
  // hook's callbacks stay stable across renders.
  const rowOnlyCrud = useMemo<GridCrudHandlers>(
    () => ({ onDeleteRow: crud?.onDeleteRow, onInsertRowAt: crud?.onInsertRowAt }),
    [crud?.onDeleteRow, crud?.onInsertRowAt],
  );
  const menu = useGridCrudMenu(content, readOnly ? {} : rowOnlyCrud);

  return (
    <div data-testid="datahub-survival-grid">
      {!hideAddControls && !readOnly && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onAddRow}
            className="ros-btn-neutral flex items-center gap-1 px-2.5 py-1.5 text-meta font-medium text-foreground"
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
                <td
                  onContextMenu={
                    readOnly ? undefined : (e) => menu.openRowMenu(e, row.id)
                  }
                  className="border border-border bg-surface-sunken px-3 py-1 text-center text-meta text-foreground-muted"
                >
                  {r + 1}
                </td>
                {cols.map((col) => (
                  <DataCell
                    key={col.id}
                    rowId={row.id}
                    // A Time / Event cell toggles on the Time key (the canonical
                    // subject key) so exclude / include are symmetric; the cell
                    // still edits its own value via onCellCommit (its real id).
                    columnId={col.id}
                    excludeColumnId={col.excludable ? timeId ?? col.id : col.id}
                    value={row.cells[col.id] ?? null}
                    // The whole subject is excluded when its Time or Event cell is,
                    // so a Time / Event cell renders excluded whenever EITHER of the
                    // subject's data cells is in the set. The Group cell is a label,
                    // so it never reads excluded.
                    excluded={
                      col.excludable &&
                      timeId !== null &&
                      eventId !== null &&
                      isSubjectExcluded(content, row.id, timeId, eventId)
                    }
                    onToggleExclusion={col.excludable ? onToggleExclusion : undefined}
                    ariaLabel={`${col.name} subject ${r + 1}`}
                    onCellCommit={onCellCommit}
                    readOnly={readOnly}
                  />
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
