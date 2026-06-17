"use client";

// One stock row under an inventory item (chunk 2). Surfaces the count-first
// model: the container count with a one-tap step-down (3 -> 2, the "finished a
// container" event from design Move 1), the one-tap status control (in_stock /
// low / empty, design Move 2), plus the lot / dates / location detail. The
// status and the count both call the chunk 1 update API and let the API's
// deriveInventoryStatus do the derivation; a manual low/empty tap is passed as
// `status` so the API honors it. House style: <Icon> only (the step-down uses
// the `minus` glyph to mirror the `plus` increment button), brand + semantic
// tokens, Tooltip for icon-only buttons, no emojis / em-dashes / mid-sentence
// colons.

import type {
  InventoryItem,
  InventoryStock,
  InventoryStockStatus,
  StorageNode,
} from "@/lib/types";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { SPATIAL_INVENTORY_ENABLED } from "@/lib/inventory/spatial-config";
import {
  STATUS_LABEL,
  TAPPABLE_STATUSES,
  containerWord,
  formatDate,
  statusChipClass,
  stockLocationDisplay,
} from "./inventory-ui";

interface StockRowProps {
  item: InventoryItem;
  stock: InventoryStock;
  /** When false the record is shared in read-only; all mutations are hidden. */
  canEdit: boolean;
  busy: boolean;
  /** The full storage-node index, for the location breadcrumb. */
  nodesById: Map<number, StorageNode>;
  onSetStatus: (status: InventoryStockStatus) => void;
  onStepCount: (next: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Jump to the storage map and select this stock's cell (only fired for a
   *  node-based location). */
  onJumpToLocation: (nodeId: number, position: string | null) => void;
}

export default function StockRow({
  item,
  stock,
  canEdit,
  busy,
  nodesById,
  onSetStatus,
  onStepCount,
  onEdit,
  onDelete,
  onJumpToLocation,
}: StockRowProps) {
  const word = containerWord(item.container_label);
  const count = Number.isFinite(stock.container_count)
    ? stock.container_count
    : 0;

  // Location: prefer the node-based breadcrumb (clickable, jumps to the map),
  // fall back to the v1 free-text note (plain text).
  const location = stockLocationDisplay(stock, nodesById);

  const details: string[] = [];
  if (stock.lot_number) details.push(`Lot ${stock.lot_number}`);
  if (stock.concentration) details.push(stock.concentration);
  const received = formatDate(stock.received_date);
  const expires = formatDate(stock.expiration_date);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      {/* Count + step-down */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          {canEdit && (
            <Tooltip label={`Use one ${word} (count down)`}>
              <button
                type="button"
                onClick={() => onStepCount(Math.max(0, count - 1))}
                disabled={busy || count <= 0}
                aria-label={`Use one ${word}`}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-foreground hover:bg-surface-sunken disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Icon name="minus" className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
          <span className="min-w-[2.5rem] text-center text-title font-semibold tabular-nums text-foreground">
            {count}
          </span>
          {canEdit && (
            <Tooltip label={`Add one ${word} (count up)`}>
              <button
                type="button"
                onClick={() => onStepCount(count + 1)}
                disabled={busy}
                aria-label={`Add one ${word}`}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-foreground hover:bg-surface-sunken disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Icon name="plus" className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
        <span className="text-meta text-foreground-muted">
          {word}
          {count === 1 ? "" : "s"}
        </span>
      </div>

      {/* Detail line */}
      <div className="min-w-0 flex-1 sm:px-4">
        {details.length > 0 && (
          <p className="truncate text-meta text-foreground">
            {details.join(" · ")}
          </p>
        )}
        {location &&
          (SPATIAL_INVENTORY_ENABLED &&
          location.kind === "node" &&
          location.nodeId != null ? (
            <Tooltip label="Show on the storage map">
              <button
                type="button"
                onClick={() =>
                  onJumpToLocation(location.nodeId!, location.position)
                }
                className="inline-flex max-w-full items-center gap-1 truncate text-meta font-medium text-brand-action hover:underline"
              >
                <Icon name="box" className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{location.text}</span>
              </button>
            </Tooltip>
          ) : (
            <p className="truncate text-meta text-foreground-muted">
              {location.text}
            </p>
          ))}
        <p className="text-meta text-foreground-muted">
          {received && <span>Received {received}</span>}
          {received && expires && <span> {"·"} </span>}
          {expires && <span>Expires {expires}</span>}
          {!received && !expires && <span>No dates recorded</span>}
        </p>
      </div>

      {/* Status + actions */}
      <div className="flex items-center gap-2">
        {stock.status === "expired" ? (
          // Expired is derived from the expiry date, not a tappable status.
          // Show a single read-only chip regardless of edit permission so the
          // user knows the stock is past its date and cannot accidentally clear
          // it via a tap.
          <span
            className={`rounded-md px-2.5 py-1 text-meta font-medium ${statusChipClass(
              "expired",
            )}`}
          >
            {STATUS_LABEL.expired}
          </span>
        ) : canEdit ? (
          <div className="flex items-center gap-1 rounded-lg bg-surface-sunken p-0.5">
            {TAPPABLE_STATUSES.map((s) => {
              const active = stock.status === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSetStatus(s)}
                  disabled={busy}
                  aria-pressed={active}
                  className={`rounded-md px-2.5 py-1 text-meta font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    active
                      ? statusChipClass(s)
                      : "text-foreground-muted hover:text-foreground"
                  }`}
                >
                  {STATUS_LABEL[s]}
                </button>
              );
            })}
          </div>
        ) : (
          <span
            className={`rounded-md px-2.5 py-1 text-meta font-medium ${statusChipClass(
              stock.status,
            )}`}
          >
            {STATUS_LABEL[stock.status]}
          </span>
        )}

        {canEdit && (
          <>
            <Tooltip label="Edit stock">
              <button
                type="button"
                onClick={onEdit}
                disabled={busy}
                aria-label="Edit stock"
                className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-sunken hover:text-foreground disabled:opacity-40"
              >
                <Icon name="pencil" className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip label="Delete stock">
              <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                aria-label="Delete stock"
                className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/15 disabled:opacity-40"
              >
                <Icon name="trash" className="h-4 w-4" />
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}
