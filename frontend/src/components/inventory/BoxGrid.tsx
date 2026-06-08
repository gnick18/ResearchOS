"use client";

// BoxGrid (box-finder map UI). Renders one `box` StorageNode (box_rows x
// box_cols) as the shared plate-style grid (GridCanvas), each cell colored by
// the status of the stock sitting in it. A cell at position `id` (an A1 cell
// id, the same scheme the plate editor + InventoryStock.position use) is
// occupied iff some stock has `location_node_id === box.id && position === id`.
//
// Click a FILLED cell -> the caller opens the cell-detail popover for that
// stock. Click an EMPTY cell -> the caller opens the "place a stock here" flow.
// We drive the click through GridCanvas's `onCellPaint` callback (its single
// "the user pressed this cell" signal) with editable left on so the cell
// buttons stay enabled + hoverable. We do NOT wire a drag-paint here: a box
// finder selects one cell at a time, and onCellPaint firing on a drag simply
// re-selects whichever cell the pointer last entered, which is harmless. This
// keeps GridCanvas's API untouched.
//
// House style: no inline icon markup (Icon registry only), brand + semantic
// dark-mode tokens (the cell fills theme via boxCellToneClass), no emojis /
// em-dashes / mid-sentence colons.

import { useCallback, useMemo } from "react";

import GridCanvas, { type GridCellRender } from "@/components/ui/GridCanvas";
import type { InventoryItem, InventoryStock, StorageNode } from "@/lib/types";
import {
  boxCellToneClass,
  buildBoxOccupancy,
  type BoxCellOccupant,
} from "./inventory-ui";

interface BoxGridProps {
  box: StorageNode;
  stocks: InventoryStock[];
  itemsById: Map<string, InventoryItem>; // keyed `${owner}:${item_id}`
  /** The currently-selected cell id (highlighted), or null. */
  selectedPosition?: string | null;
  /** Click handler. `occupant` is the stock sitting in the cell, or null for an
   *  empty cell (the caller opens "place a stock here"). */
  onCellClick: (position: string, occupant: BoxCellOccupant | null) => void;
  now?: Date;
}

/** Build the occupancy map and render the box grid through GridCanvas. */
export default function BoxGrid({
  box,
  stocks,
  itemsById,
  selectedPosition,
  onCellClick,
  now,
}: BoxGridProps) {
  const rows = box.box_rows && box.box_rows > 0 ? box.box_rows : 9;
  const cols = box.box_cols && box.box_cols > 0 ? box.box_cols : 9;
  const clock = now ?? new Date();

  const occupancy = useMemo(
    () => buildBoxOccupancy(box.id, stocks, itemsById, clock),
    [box.id, stocks, itemsById, clock],
  );

  const cell = useCallback(
    (id: string): GridCellRender => {
      const occ = occupancy.get(id);
      const tone = occ ? occ.tone : "empty";
      const selected = selectedPosition === id;
      const fill = boxCellToneClass(tone);
      const ring = selected
        ? " ring-2 ring-brand-action ring-offset-1 ring-offset-surface-raised"
        : "";
      const title = occ
        ? `${id} · ${occ.item?.name ?? "Stock"}${
            occ.stock.lot_number ? ` · Lot ${occ.stock.lot_number}` : ""
          }`
        : `${id} · empty`;
      return {
        className: `${fill}${ring}`,
        title,
        ariaLabel: occ
          ? `Cell ${id}, ${occ.item?.name ?? "stock"}`
          : `Cell ${id}, empty`,
      };
    },
    [occupancy, selectedPosition],
  );

  const handleCell = useCallback(
    (id: string) => {
      onCellClick(id, occupancy.get(id) ?? null);
    },
    [occupancy, onCellClick],
  );

  return (
    <GridCanvas
      rows={rows}
      cols={cols}
      cell={cell}
      editable
      onCellPaint={handleCell}
      cellClassName="w-7 h-7 text-[9px]"
      ariaLabel={`Box ${box.name}`}
      className="inline-block w-auto"
    />
  );
}
