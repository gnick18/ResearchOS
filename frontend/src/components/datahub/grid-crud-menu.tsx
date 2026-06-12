"use client";

// Shared right-click CRUD menus for the Data Hub grids (grid-crud phase 2a).
//
// Every grid (Column / XY / Grouped / Survival) wants the SAME two menus: one on
// a column header (Rename / Duplicate / Insert before / Insert after / Delete)
// and one on the row-number cell (Insert above / Insert below / Delete). The menu
// VOCABULARY is uniform; only the type-aware noun differs (group / Y column /
// subject), which the page passes down via the existing label helpers. This hook
// builds the EditMenuItem lists and drives an inline header-rename so each grid
// stays thin and the behavior is identical across the four.
//
// The menus attach to the <th> and the row-number <td> only, never to a cell
// <input>: an editable input falls through to the browser's native menu (copy /
// paste / spellcheck), which the shared ContextMenuProvider already preserves.
//
// House style: <Icon> only (none needed here, the menu is text-label based),
// Tooltip on icon-only buttons, no emojis / em-dashes / mid-sentence colons.

import { useCallback, useEffect, useRef, useState } from "react";
import { useOptionalContextMenu } from "@/components/context-menu/ContextMenuProvider";
import type { EditMenuItem } from "@/components/sequences/SequenceEditMenu";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import {
  canDeleteColumn,
  canDeleteRow,
  canRenameColumn,
  columnIndex,
  columnNoun,
  rowIndex,
  rowNoun,
} from "@/lib/datahub/grid-crud";

/** The CRUD callbacks a grid forwards from the page. All optional so a grid that
 *  only wires a safe subset (e.g. a corrupting action is withheld) can omit one;
 *  a missing callback drops that menu item rather than rendering a dead one. */
export interface GridCrudHandlers {
  onDeleteRow?: (rowId: string) => void;
  onInsertRowAt?: (index: number) => void;
  onDeleteColumn?: (columnId: string) => void;
  onRenameColumn?: (columnId: string, name: string) => void;
  onDuplicateColumn?: (columnId: string) => void;
  onInsertColumnAt?: (index: number) => void;
}

export interface GridCrudMenu {
  /** Open the column-header menu for a column at the pointer. */
  openColumnMenu: (
    e: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number },
    columnId: string,
  ) => void;
  /** Open the row-number menu for a row at the pointer. */
  openRowMenu: (
    e: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number },
    rowId: string,
  ) => void;
  /** The column id currently being renamed inline, or null. */
  renamingColumnId: string | null;
  /** Begin an inline rename on a column header. */
  beginRename: (columnId: string) => void;
  /** Commit the inline rename (no-op when the name is unchanged / blank). */
  commitRename: (columnId: string, name: string) => void;
  /** Cancel the inline rename (Escape / blur with no change). */
  cancelRename: () => void;
}

/**
 * Build the shared CRUD menus + inline-rename state for a grid. `content` drives
 * the guards (which item is disabled), `handlers` are the page callbacks. The
 * menus open through the app-wide ContextMenuProvider.
 */
export function useGridCrudMenu(
  content: DataHubDocContent,
  handlers: GridCrudHandlers,
): GridCrudMenu {
  // Optional so a grid rendered without the app-wide provider (isolated unit
  // renders) does not throw; the menus simply never open there.
  const ctx = useOptionalContextMenu();
  const openMenu = ctx?.openMenu ?? (() => {});
  const [renamingColumnId, setRenamingColumnId] = useState<string | null>(null);

  const beginRename = useCallback((columnId: string) => {
    setRenamingColumnId(columnId);
  }, []);
  const cancelRename = useCallback(() => setRenamingColumnId(null), []);
  const commitRename = useCallback(
    (columnId: string, name: string) => {
      setRenamingColumnId(null);
      handlers.onRenameColumn?.(columnId, name);
    },
    [handlers],
  );

  const type = content.meta.table_type;
  const colNoun = columnNoun(type);
  const rNoun = rowNoun(type);

  const openColumnMenu = useCallback<GridCrudMenu["openColumnMenu"]>(
    (e, columnId) => {
      const idx = columnIndex(content, columnId);
      const items: EditMenuItem[] = [];
      if (handlers.onRenameColumn && canRenameColumn(content, columnId)) {
        items.push({
          id: "rename",
          label: `Rename ${colNoun}`,
          enabled: true,
          onRun: () => setRenamingColumnId(columnId),
        });
      }
      // Duplicate is gated behind the same non-structural check as rename: copying
      // a structural axis (the XY X column, the Grouped row label) would mint a
      // second role-x column and corrupt the table, so it is withheld there.
      if (handlers.onDuplicateColumn && canRenameColumn(content, columnId)) {
        items.push({
          id: "duplicate",
          label: `Duplicate ${colNoun}`,
          enabled: true,
          onRun: () => handlers.onDuplicateColumn?.(columnId),
        });
      }
      if (handlers.onInsertColumnAt) {
        items.push({
          id: "insert-before",
          label: `Insert ${colNoun} before`,
          enabled: true,
          group: true,
          onRun: () => handlers.onInsertColumnAt?.(idx),
        });
        items.push({
          id: "insert-after",
          label: `Insert ${colNoun} after`,
          enabled: true,
          onRun: () => handlers.onInsertColumnAt?.(idx + 1),
        });
      }
      if (handlers.onDeleteColumn) {
        items.push({
          id: "delete",
          label: `Delete ${colNoun}`,
          enabled: canDeleteColumn(content, columnId),
          destructive: true,
          group: true,
          onRun: () => handlers.onDeleteColumn?.(columnId),
        });
      }
      openMenu(e, items);
    },
    [content, handlers, colNoun, openMenu],
  );

  const openRowMenu = useCallback<GridCrudMenu["openRowMenu"]>(
    (e, rowId) => {
      const idx = rowIndex(content, rowId);
      const items: EditMenuItem[] = [];
      if (handlers.onInsertRowAt) {
        items.push({
          id: "insert-above",
          label: `Insert ${rNoun} above`,
          enabled: true,
          onRun: () => handlers.onInsertRowAt?.(idx),
        });
        items.push({
          id: "insert-below",
          label: `Insert ${rNoun} below`,
          enabled: true,
          onRun: () => handlers.onInsertRowAt?.(idx + 1),
        });
      }
      if (handlers.onDeleteRow) {
        items.push({
          id: "delete-row",
          label: `Delete ${rNoun}`,
          enabled: canDeleteRow(content),
          destructive: true,
          group: true,
          onRun: () => handlers.onDeleteRow?.(rowId),
        });
      }
      openMenu(e, items);
    },
    [content, handlers, rNoun, openMenu],
  );

  return {
    openColumnMenu,
    openRowMenu,
    renamingColumnId,
    beginRename,
    commitRename,
    cancelRename,
  };
}

/**
 * The inline rename input shown in place of a column header label while that
 * column is being renamed. Auto-focuses + selects, commits on Enter / blur,
 * cancels on Escape. Styled to sit flush inside the <th> like the existing
 * group-rename input on the grouped grid.
 */
export function ColumnRenameInput({
  initialName,
  onCommit,
  onCancel,
}: {
  initialName: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  // Escape sets a flag so the blur that follows does not also commit the value.
  const cancelledRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => ref.current?.select(), 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <input
      ref={ref}
      type="text"
      defaultValue={initialName}
      aria-label="Rename column"
      onBlur={(e) => {
        if (cancelledRef.current) {
          cancelledRef.current = false;
          onCancel();
          return;
        }
        onCommit(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          cancelledRef.current = true;
          e.currentTarget.blur();
        }
      }}
      className="w-full bg-transparent text-center text-body font-semibold text-foreground outline-none focus:bg-accent-soft"
    />
  );
}
