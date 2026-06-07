"use client";

// One annotated record in a chunk 3 signal view (the filtered list shown when a
// health tile is active). Read-only by design: a colored left-bar per signal,
// the item name, a meta line, the signal annotation line, and a status chip.
// The whole row is the open affordance (Grant chose no dedicated open icon): it
// is a real <button> that jumps to the item in the normal list. No write
// actions live here in chunk 3 (the reorder-cart shortcut is deferred to chunk
// 4 and is intentionally absent).
//
// House style: semantic dark-mode tokens, amber expiring / slate stale / rose
// low, no emojis / em-dashes / mid-sentence colons.

import { CATEGORY_LABEL, STATUS_LABEL, statusChipClass } from "./inventory-ui";
import type { InventorySignalKind } from "./inventory-ui";
import type { InventoryItem, InventoryStockStatus } from "@/lib/types";

const LEFT_BAR: Record<InventorySignalKind, string> = {
  expiring: "border-l-amber-500 dark:border-l-amber-400",
  stale: "border-l-slate-500 dark:border-l-slate-400",
  low: "border-l-rose-500 dark:border-l-rose-400",
};

const SIGNAL_TEXT: Record<InventorySignalKind, string> = {
  expiring: "text-amber-700 dark:text-amber-300",
  stale: "text-slate-600 dark:text-slate-300",
  low: "text-rose-700 dark:text-rose-300",
};

export default function SignalRecordRow({
  kind,
  item,
  metaSuffix,
  annotation,
  chipStatus,
  onOpen,
}: {
  kind: InventorySignalKind;
  item: InventoryItem;
  /** Extra meta tail after the category (lot / location, or "total across
   *  stocks" for the item-level low signal). */
  metaSuffix: string;
  annotation: string;
  chipStatus: InventoryStockStatus;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${item.name} in the list`}
      className={`flex w-full items-center justify-between gap-3.5 rounded-lg border border-l-[3px] border-border bg-surface-raised px-4 py-3 text-left transition-colors hover:bg-surface-sunken ${LEFT_BAR[kind]}`}
    >
      <div className="min-w-0">
        <div className="truncate text-body font-semibold text-foreground">
          {item.name}
        </div>
        <div className="mt-0.5 truncate text-meta text-foreground-muted">
          {CATEGORY_LABEL[item.category]}
          {item.vendor ? ` · ${item.vendor}` : ""}
          {metaSuffix ? ` · ${metaSuffix}` : ""}
        </div>
        <div className={`mt-0.5 text-meta font-semibold ${SIGNAL_TEXT[kind]}`}>
          {annotation}
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <span
          className={`rounded-md px-2.5 py-1 text-meta font-medium ${statusChipClass(
            chipStatus,
          )}`}
        >
          {STATUS_LABEL[chipStatus]}
        </span>
      </div>
    </button>
  );
}
