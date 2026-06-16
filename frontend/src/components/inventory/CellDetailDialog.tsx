"use client";

// CellDetailDialog (box-finder map UI). The body of the cell popover raised
// when a box cell is clicked on the storage map. Two modes:
//
//   - OCCUPIED: shows the stock sitting in the cell (item name, lot, container
//     count, expiry) with three actions: Open item, Move (reassign to another
//     empty cell in this box), Remove (clear location_node_id + position).
//   - EMPTY: a "place a stock here" picker over the unplaced stocks (those with
//     no location_node_id), with a search box; choosing one sets its
//     location_node_id + position to this box + cell.
//
// The dialog only collects the intent; the parent (StorageMap) runs the write
// via inventoryStocksApi.update. House style: <Icon> only (no inline svg),
// Tooltip on icon-only buttons, brand + semantic dark-mode tokens, no emojis /
// em-dashes / mid-sentence colons.

import { useMemo, useState } from "react";

import { Icon } from "@/components/icons";
import type {
  InventoryItem,
  InventoryStock,
  StorageNode,
} from "@/lib/types";
import {
  STATUS_LABEL,
  containerCountLabel,
  formatDate,
  statusChipClass,
  type BoxCellOccupant,
} from "./inventory-ui";

interface CellDetailDialogProps {
  box: StorageNode;
  position: string;
  occupant: BoxCellOccupant | null;
  /** The free cells in this box (for the Move target picker). A1 cell ids. */
  emptyCells: string[];
  /** Stocks not yet placed anywhere (location_node_id == null), for the place
   *  picker, each paired with its parent item for display. */
  unplaced: { stock: InventoryStock; item: InventoryItem | null }[];
  onOpenItem: (item: InventoryItem) => void;
  onPlace: (stock: InventoryStock, position: string) => Promise<void>;
  onMove: (stock: InventoryStock, position: string) => Promise<void>;
  onRemove: (stock: InventoryStock) => Promise<void>;
  onClose: () => void;
}

export default function CellDetailDialog(props: CellDetailDialogProps) {
  return props.occupant ? (
    <OccupiedView {...props} occupant={props.occupant} />
  ) : (
    <EmptyView {...props} />
  );
}

function OccupiedView({
  box,
  position,
  occupant,
  emptyCells,
  onOpenItem,
  onMove,
  onRemove,
  onClose,
}: CellDetailDialogProps & { occupant: BoxCellOccupant }) {
  const { stock, item } = occupant;
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);

  const expires = formatDate(stock.expiration_date);

  return (
    <div className="p-5">
      <p className="text-meta text-foreground-muted">
        {box.name} · Position {position}
      </p>
      <h3 className="mt-1 text-title font-semibold text-foreground">
        {item?.name ?? "Stock"}
      </h3>
      <p className="mt-1 text-meta text-foreground-muted">
        {[
          stock.lot_number ? `Lot ${stock.lot_number}` : null,
          containerCountLabel(stock.container_count, item?.container_label),
          expires ? `expires ${expires}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="mt-2">
        <span
          className={`inline-block rounded-md px-2 py-0.5 text-meta font-medium ${statusChipClass(
            stock.status,
          )}`}
        >
          {STATUS_LABEL[stock.status]}
        </span>
      </div>

      {moving ? (
        <div className="mt-4">
          <p className="text-meta font-medium text-foreground mb-2">
            Move to which cell?
          </p>
          {emptyCells.length === 0 ? (
            <p className="text-meta text-foreground-muted">
              This box is full. Free a cell first.
            </p>
          ) : (
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {emptyCells.map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onMove(stock, id);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="rounded-md border border-border px-2 py-1 text-meta text-foreground hover:bg-surface-sunken disabled:opacity-50"
                >
                  {id}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setMoving(false)}
            className="mt-3 text-meta font-medium text-brand-action hover:underline"
          >
            Cancel move
          </button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {item && (
            <button
              type="button"
              onClick={() => onOpenItem(item)}
              className="ros-btn-neutral inline-flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium text-foreground"
            >
              <Icon name="eye" className="h-3.5 w-3.5" />
              Open item
            </button>
          )}
          <button
            type="button"
            onClick={() => setMoving(true)}
            className="ros-btn-neutral inline-flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium text-foreground"
          >
            <Icon name="move" className="h-3.5 w-3.5" />
            Move
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onRemove(stock);
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-meta font-medium text-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/15 disabled:opacity-50"
          >
            <Icon name="trash" className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="text-meta font-medium text-foreground-muted hover:text-foreground"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function EmptyView({
  box,
  position,
  unplaced,
  onPlace,
  onClose,
}: CellDetailDialogProps) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return unplaced;
    return unplaced.filter(({ stock, item }) => {
      return (
        (item?.name.toLowerCase().includes(q) ?? false) ||
        (stock.lot_number?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [unplaced, query]);

  return (
    <div className="p-5">
      <p className="text-meta text-foreground-muted">
        {box.name} · Position {position}
      </p>
      <h3 className="mt-1 text-title font-semibold text-foreground">
        Place a stock here
      </h3>
      <p className="mt-1 text-meta text-foreground-muted">
        Pick an unplaced stock to drop into this cell.
      </p>

      <div className="relative mt-3">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted">
          <Icon name="search" className="h-4 w-4" />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by item or lot"
          className="w-full rounded-lg border border-border bg-surface-raised py-2 pl-9 pr-3 text-body text-foreground placeholder:text-foreground-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-action"
        />
      </div>

      <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
        {unplaced.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-meta text-foreground-muted">
            Every stock is already placed. Add a stock to an item first, or move
            one from another cell.
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-4 text-center text-meta text-foreground-muted">
            No unplaced stock matches that search.
          </p>
        ) : (
          filtered.map(({ stock, item }) => (
            <button
              key={stock.id}
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onPlace(stock, position);
                } finally {
                  setBusy(false);
                }
              }}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left hover:bg-surface-sunken disabled:opacity-50"
            >
              <div className="min-w-0">
                <p className="truncate text-meta font-medium text-foreground">
                  {item?.name ?? "Stock"}
                </p>
                <p className="truncate text-meta text-foreground-muted">
                  {[
                    stock.lot_number ? `Lot ${stock.lot_number}` : null,
                    containerCountLabel(
                      stock.container_count,
                      item?.container_label,
                    ),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <span className="flex-shrink-0 text-meta font-medium text-brand-action">
                Place
              </span>
            </button>
          ))
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="text-meta font-medium text-foreground-muted hover:text-foreground"
        >
          Close
        </button>
      </div>
    </div>
  );
}
