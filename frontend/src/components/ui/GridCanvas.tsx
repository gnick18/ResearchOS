"use client";

import { useCallback, useMemo, useRef } from "react";
import Tooltip from "@/components/Tooltip";

/**
 * GridCanvas — a neutral, role/color-agnostic rows × cols paintable grid.
 *
 * Extracted from `PlateLayoutEditor` (design `plans/INVENTORY_DESIGN.md`
 * §4 / FLAG-G) so the plate editor and the future freezer-box map (`BoxGrid`)
 * speak the same `A1` cell-id language and share one paint/click engine. This
 * primitive bakes in NOTHING about plates, box sizes, statuses, or roles: the
 * caller supplies, per cell, a className (fill), a short label, a tooltip, and
 * what happens on click/paint. The grid only owns:
 *
 *   - the cell-id scheme (`wellId` / `parseWellId` / `rowLabel`, re-exported),
 *   - the row-letter header column + 1-indexed column header row,
 *   - the rows × cols table render,
 *   - the click + drag-to-paint interaction (Shift/Alt = "erase" gesture,
 *     surfaced to the caller as `erase: true`),
 *   - read-only mode (no painting; cells render `cursor-default`).
 *
 * The plate editor keeps every plate-specific concern (brushes, role colors,
 * diff highlighting, per-row sample-id inputs, the 384-well dense/compact
 * sizing) by passing the right props down: `cell()` returns the role fill +
 * label + tooltip, `onCellPaint` writes the brushed annotation, the header
 * click handlers fill a row/column, and `rowExtra()` injects the per-row
 * sample-id input cell. Cell + header sizing is fully caller-controlled via
 * `cellClassName` / `colHeaderClassName` / `rowHeaderClassName` so the dense
 * 384-well scaling is preserved verbatim.
 */

/** Row label: 0 → "A", 1 → "B", … (A–P spans the 16 rows a 384-well plate has). */
export function rowLabel(row: number): string {
  return String.fromCharCode(65 + row);
}

/** Build the `A1`-style cell id from a 0-indexed (row, col). Columns display
 *  1-indexed; rows display as letters. Reused verbatim from the plate editor so
 *  a freezer-box position is the same string a plate well uses. */
export function wellId(row: number, col: number): string {
  return `${rowLabel(row)}${col + 1}`;
}

/** Parse an `A1`-style cell id back to a 0-indexed (row, col), or null when it
 *  doesn't match. Rows run A–P (up to 16); columns are 1-indexed. */
export function parseWellId(id: string): { row: number; col: number } | null {
  const m = id.match(/^([A-P])(\d+)$/);
  if (!m) return null;
  return { row: m[1].charCodeAt(0) - 65, col: Number(m[2]) - 1 };
}

/** Per-cell render description the caller supplies for a given cell id. */
export interface GridCellRender {
  /** Tailwind/utility classes layered onto the cell button (the "fill"). */
  className?: string;
  /** Short text shown inside the cell (a single glyph / 1–3 chars). */
  label?: string;
  /** Native title tooltip for the cell. */
  title?: string;
  /** Accessible label for the cell button; defaults to `Cell ${id}`. */
  ariaLabel?: string;
}

export interface GridCanvasProps {
  rows: number;
  cols: number;

  /** Describe a single cell (fill class, label, tooltip). Called per cell on
   *  render. Keep it cheap / memoized by the caller. */
  cell: (id: string, row: number, col: number) => GridCellRender;

  /** When false, the grid is read-only: no paint, cells are `cursor-default`,
   *  header buttons render as plain text. Defaults to true. */
  editable?: boolean;

  /** Fired on mouse-down on a cell and on drag-enter while painting. `erase`
   *  is true when the Shift or Alt modifier is held (the plate editor's
   *  erase gesture); the caller decides what erase means. */
  onCellPaint?: (id: string, opts: { erase: boolean }) => void;

  /** Optional row-header (letter) click — the plate editor fills the row. */
  onRowHeaderClick?: (row: number) => void;
  /** Tooltip for the row-header button (e.g. "Fill row A"). */
  rowHeaderTooltip?: (row: number) => string;
  /** Optional column-header (number) click — the plate editor fills the col. */
  onColHeaderClick?: (col: number) => void;
  /** Tooltip for the column-header button (e.g. "Fill column 3"). */
  colHeaderTooltip?: (col: number) => string;

  /** Optional extra header cell rendered to the LEFT of the column numbers
   *  (the plate editor's "Row sample id" column header). Rendered only when
   *  `rowExtra` is also supplied. */
  extraHeader?: React.ReactNode;
  /** Optional extra cell rendered at the start of each row, before the grid
   *  cells (the plate editor's per-row sample-id input). */
  rowExtra?: (row: number) => React.ReactNode;

  // --- Sizing (caller-controlled so the 384-well dense scaling is preserved) ---
  /** Classes for each grid cell button. Default: `w-8 h-8 text-meta`. */
  cellClassName?: string;
  /** Classes for the column-header buttons/spans. Default: `w-8`. */
  colHeaderClassName?: string;
  /** Classes for the row-header buttons/spans. Default: `w-6`. */
  rowHeaderClassName?: string;
  /** When false, the column-header numbers shrink to `text-[8px]` (dense /
   *  384-well). Defaults to true (`text-meta`). */
  largeColHeaderText?: boolean;

  /** Accessible label for the whole table. Default: "Grid". */
  ariaLabel?: string;
  /** Extra classes on the outer scroll container. */
  className?: string;
}

/**
 * The shared grid render + paint engine. Stateless apart from the in-flight
 * "is the mouse button down" ref; all cell state lives with the caller.
 */
export default function GridCanvas({
  rows,
  cols,
  cell,
  editable = true,
  onCellPaint,
  onRowHeaderClick,
  rowHeaderTooltip,
  onColHeaderClick,
  colHeaderTooltip,
  extraHeader,
  rowExtra,
  cellClassName = "w-8 h-8 text-meta",
  colHeaderClassName = "w-8",
  rowHeaderClassName = "w-6",
  largeColHeaderText = true,
  ariaLabel = "Grid",
  className,
}: GridCanvasProps) {
  const paintingRef = useRef(false);

  const paint = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (!editable || !onCellPaint) return;
      onCellPaint(id, { erase: e.shiftKey || e.altKey });
    },
    [editable, onCellPaint],
  );

  const handleCellMouseDown = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (!editable) return;
      paintingRef.current = true;
      paint(id, e);
    },
    [editable, paint],
  );

  const handleCellMouseEnter = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (!paintingRef.current || !editable) return;
      paint(id, e);
    },
    [editable, paint],
  );

  const stopPainting = useCallback(() => {
    paintingRef.current = false;
  }, []);

  const showExtraColumn = !!rowExtra;
  const colHeaderTextClass = largeColHeaderText ? "text-meta" : "text-[8px]";

  const rowsArr = useMemo(() => Array.from({ length: rows }), [rows]);
  const colsArr = useMemo(() => Array.from({ length: cols }), [cols]);

  return (
    <div
      className={`border border-border rounded-lg p-3 bg-surface-raised overflow-x-auto${
        className ? ` ${className}` : ""
      }`}
      onMouseUp={stopPainting}
      onMouseLeave={stopPainting}
    >
      <table className="border-collapse select-none" aria-label={ariaLabel}>
        <thead>
          <tr>
            <th className="p-0.5 w-7"></th>
            {showExtraColumn && extraHeader !== undefined && (
              <th className="p-0.5 text-left">{extraHeader}</th>
            )}
            {colsArr.map((_, c) => (
              <th key={c} className="p-0.5 text-center">
                {editable && onColHeaderClick ? (
                  <Tooltip
                    label={colHeaderTooltip ? colHeaderTooltip(c) : `Fill column ${c + 1}`}
                    placement="top"
                  >
                    <button
                      onClick={() => onColHeaderClick(c)}
                      className={`${colHeaderClassName} ${colHeaderTextClass} font-medium text-foreground-muted hover:text-emerald-600 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded px-0.5 py-0.5`}
                    >
                      {c + 1}
                    </button>
                  </Tooltip>
                ) : (
                  <span className="text-meta font-medium text-foreground-muted">{c + 1}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowsArr.map((_, r) => (
            <tr key={r}>
              <th className="p-0.5 align-middle">
                {editable && onRowHeaderClick ? (
                  <Tooltip
                    label={rowHeaderTooltip ? rowHeaderTooltip(r) : `Fill row ${rowLabel(r)}`}
                    placement="right"
                  >
                    <button
                      onClick={() => onRowHeaderClick(r)}
                      className={`${rowHeaderClassName} text-meta font-medium text-foreground-muted hover:text-emerald-600 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded px-0.5 py-0.5`}
                    >
                      {rowLabel(r)}
                    </button>
                  </Tooltip>
                ) : (
                  <span className="text-meta font-medium text-foreground-muted">{rowLabel(r)}</span>
                )}
              </th>
              {showExtraColumn && (
                <td className="p-0.5 align-middle">{rowExtra ? rowExtra(r) : null}</td>
              )}
              {colsArr.map((_, c) => {
                const id = wellId(r, c);
                const render = cell(id, r, c);
                return (
                  <td key={c} className="p-0.5">
                    <button
                      type="button"
                      disabled={!editable}
                      onMouseDown={(e) => handleCellMouseDown(id, e)}
                      onMouseEnter={(e) => handleCellMouseEnter(id, e)}
                      title={render.title}
                      className={`${cellClassName} rounded-full border border-border ${
                        render.className ?? "bg-surface-raised text-foreground-muted"
                      } flex items-center justify-center ${
                        editable ? "cursor-pointer hover:ring-2 hover:ring-emerald-300" : "cursor-default"
                      }`}
                      aria-label={render.ariaLabel ?? `Cell ${id}`}
                    >
                      {render.label ?? ""}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
