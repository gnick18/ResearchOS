"use client";

// DataCell -- the shared editable data cell for every Data Hub grid (Column / XY
// / Grouped / Survival). It owns three things the four grids used to repeat:
//   1. The uncontrolled <input> idiom (defaultValue + key on the stored value so
//      a debounced Loro commit + reproject does not fight the caret; commit on
//      blur / Enter through onCellCommit).
//   2. The EXCLUDE-VALUE right-click menu. A data cell's <input> would normally
//      fall through to the browser's native menu (the ContextMenuProvider passes
//      editable inputs straight through), so we attach our OWN onContextMenu that
//      preventDefaults and opens our menu with "Exclude value" / "Include value",
//      a divider, then Cut / Copy / Paste, so the native editing actions are not
//      lost. Toggling persists through the chunk-1 helper + the cell-commit path.
//   3. The EXCLUDED rendering. An excluded cell keeps its value VISIBLE (it is
//      excluded, not deleted) but reads greyed + struck through on a subtle
//      ground, with a Tooltip explaining it. Editing an excluded cell is allowed
//      and KEEPS the exclusion (the value is still an outlier you are correcting,
//      not re-including), so the exclusion is only cleared by Include value.
//
// House style: <Icon> only (none needed here), Tooltip on the excluded cell, no
// emojis / em-dashes / mid-sentence colons.

import { useCallback } from "react";
import Tooltip from "@/components/Tooltip";
import { useOptionalContextMenu } from "@/components/context-menu/ContextMenuProvider";
import type { EditMenuItem } from "@/components/sequences/SequenceEditMenu";
import type { CellValue } from "@/lib/datahub/model/types";
import { cellDisplay } from "@/lib/datahub/column-table";

/** The exclude / include callback a grid forwards from the page. Toggles whether
 *  one cell is excluded from analyses and plots. Omitted in isolated renders /
 *  tests and on read-only (derived) tables, where no exclude menu attaches. */
export type ToggleCellExclusion = (rowId: string, columnId: string) => void;

export default function DataCell({
  rowId,
  columnId,
  excludeColumnId,
  value,
  ariaLabel,
  onCellCommit,
  excluded = false,
  onToggleExclusion,
  readOnly = false,
}: {
  rowId: string;
  columnId: string;
  /** The column id the EXCLUDE toggle targets, when it differs from the cell's
   *  own value column. The Survival grid uses this so a subject's Time and Event
   *  cells both toggle the SAME (Time) key, keeping exclude / include symmetric.
   *  Defaults to columnId, so every other grid toggles its own cell. */
  excludeColumnId?: string;
  value: CellValue;
  ariaLabel: string;
  onCellCommit: (rowId: string, columnId: string, raw: string) => void;
  /** True when this cell is in the document's excluded set. */
  excluded?: boolean;
  /** Toggle this cell's exclusion. Omitted disables the Exclude menu item. */
  onToggleExclusion?: ToggleCellExclusion;
  readOnly?: boolean;
}) {
  const ctx = useOptionalContextMenu();
  const display = cellDisplay(value ?? null);

  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLInputElement>) => {
      // A read-only cell offers nothing of ours; let the native menu show (so a
      // derived table still copies). No exclusion handler means no exclude menu;
      // without a context provider there is nothing to open either.
      if (readOnly || !ctx || !onToggleExclusion) return;
      const items: EditMenuItem[] = [];
      items.push({
        id: "exclude",
        label: excluded ? "Include value" : "Exclude value",
        enabled: true,
        onRun: () => onToggleExclusion(rowId, excludeColumnId ?? columnId),
      });
      // Cut / Copy / Paste keep the native editing actions a cell normally has,
      // since we are stealing the native menu with preventDefault. They route
      // through the clipboard + the cell-commit path (Cut / Paste write the cell;
      // Copy just reads it). Paste is best-effort (the async clipboard read can
      // be blocked by permissions), in which case it is a no-op.
      items.push({
        id: "copy",
        label: "Copy",
        enabled: true,
        group: true,
        onRun: () => {
          void navigator.clipboard?.writeText(display).catch(() => {});
        },
      });
      items.push({
        id: "cut",
        label: "Cut",
        enabled: true,
        onRun: () => {
          void navigator.clipboard?.writeText(display).catch(() => {});
          onCellCommit(rowId, columnId, "");
        },
      });
      items.push({
        id: "paste",
        label: "Paste",
        enabled: true,
        onRun: () => {
          void navigator.clipboard
            ?.readText()
            .then((text) => onCellCommit(rowId, columnId, text))
            .catch(() => {});
        },
      });
      ctx.openMenu(e, items);
    },
    [
      ctx,
      readOnly,
      onToggleExclusion,
      excluded,
      rowId,
      columnId,
      excludeColumnId,
      display,
      onCellCommit,
    ],
  );

  const input = (
    <input
      type="text"
      inputMode="decimal"
      defaultValue={display}
      // defaultValue + onBlur (uncontrolled per render) so the debounced Loro
      // commit + reproject does not fight the caret while the user is mid-type.
      // The key includes the stored value AND the excluded flag so an external
      // change (a collaborator's edit, or an exclude toggle) reseeds the input.
      key={`${rowId}:${columnId}:${display}:${excluded ? "x" : ""}`}
      readOnly={readOnly}
      onContextMenu={onContextMenu}
      onBlur={
        readOnly
          ? undefined
          : (e) => onCellCommit(rowId, columnId, e.currentTarget.value)
      }
      onKeyDown={(e) => {
        if (!readOnly && e.key === "Enter") e.currentTarget.blur();
      }}
      aria-label={ariaLabel}
      data-excluded={excluded ? "true" : undefined}
      className={`w-full bg-transparent px-3 py-1.5 text-center text-body outline-none ${
        excluded
          ? "text-foreground-muted line-through decoration-foreground-muted/70"
          : "text-foreground"
      } ${
        readOnly
          ? "cursor-default text-foreground-muted"
          : excluded
            ? "focus:bg-surface-sunken"
            : "focus:bg-accent-soft"
      }`}
    />
  );

  return (
    <td
      data-testid={excluded ? "datahub-cell-excluded" : undefined}
      className={`border border-border p-0 text-center ${
        excluded ? "bg-surface-sunken/60" : "bg-surface-raised"
      }`}
    >
      {excluded ? (
        <Tooltip label="Excluded from analysis. Right-click to include.">
          {input}
        </Tooltip>
      ) : (
        input
      )}
    </td>
  );
}
