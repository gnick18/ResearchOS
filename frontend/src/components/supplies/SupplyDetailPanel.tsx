"use client";

// Supplies v2 (SUPPLIES_V2_UNIFIED.md), chunk 3 + 4: the two-section detail
// panel. Click a Supply row -> this panel shows the two orthogonal sections
// that define a supply: On hand (its stocks) and Ordering (its open order
// lines). Sections render only when that side exists.
//
// Chunk 4 makes the On-hand section actionable: the read rows become full
// StockRow controls (tap status, count steppers, edit, delete) wired to the
// same inventoryStocksApi /inventory uses, plus an "Add stock" affordance, so
// the panel is the place to adjust on-hand without leaving /supplies. A
// "Reorder" action seeds a draft-order line from the supply identity (prefilled
// quantity from the on-hand gap) and adds it to the cart.
//
// House style: <Icon> only, brand + semantic dark-mode tokens, Tooltip on
// icon-only buttons, no emojis / em-dashes / mid-sentence colons.

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import StockRow from "@/components/inventory/StockRow";
import StockFormDialog from "@/components/inventory/StockFormDialog";
import { CATEGORY_LABEL } from "@/components/inventory/inventory-ui";
import { inventoryStocksApi } from "@/lib/local-api";
import { normalizeSharedWith, WHOLE_LAB_SENTINEL } from "@/lib/sharing/unified";
import type {
  InventoryItem,
  InventoryStock,
  InventoryStockCreate,
  InventoryStockStatus,
  InventoryStockUpdate,
  StorageNode,
} from "@/lib/types";
import { normalizeOrderStatus, PURCHASE_ORDER_STATUS_LABEL } from "@/lib/types";
import type { Supply } from "@/lib/supplies/supply-model";
import { seedFromSupply } from "@/lib/supplies/reorder";
import { useReorderCart } from "./ReorderCartContext";

function categoryLabel(cat: string | null): string {
  if (!cat) return "";
  return (CATEGORY_LABEL as Record<string, string>)[cat] ?? cat;
}

/** Owner to route a stock write into (the owner's folder for a shared-into-me
 *  record, else the cheap current-user path). Mirrors /inventory. */
function effectiveOwnerOf(
  item: InventoryItem,
  currentUser: string | null,
): string | undefined {
  return item.is_shared_with_me && item.owner !== currentUser
    ? item.owner
    : undefined;
}

/** Whole-lab-edit sharing default carries over from inventory. */
function canEditItem(item: InventoryItem, currentUser: string | null): boolean {
  if (!currentUser) return false;
  if (item.owner === currentUser) return true;
  return normalizeSharedWith(item.shared_with).some(
    (s) =>
      (s.username === currentUser || s.username === WHOLE_LAB_SENTINEL) &&
      s.level === "edit",
  );
}

type StockDialog =
  | { mode: "closed" }
  | { mode: "add"; item: InventoryItem }
  | { mode: "edit"; item: InventoryItem; stock: InventoryStock };

export default function SupplyDetailPanel({
  supply,
  stocks,
  items,
  nodes,
  currentUser,
  onClose,
}: {
  supply: Supply;
  /** All loaded stocks; the panel filters to this supply's item(s). */
  stocks: InventoryStock[];
  /** All loaded inventory items; the panel resolves the backing item(s). */
  items: InventoryItem[];
  /** Storage-node index, for StockRow's location breadcrumb. */
  nodes: StorageNode[];
  currentUser: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const cart = useReorderCart();
  const [busyStockId, setBusyStockId] = useState<number | null>(null);
  const [stockDialog, setStockDialog] = useState<StockDialog>({ mode: "closed" });

  const itemsById = useMemo(() => {
    const m = new Map<number, InventoryItem>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const nodesById = useMemo(() => {
    const m = new Map<number, StorageNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const backingItem = supply.onHand
    ? itemsById.get(supply.onHand.itemIds[0]) ?? null
    : null;

  const onHandStocks = supply.onHand
    ? stocks.filter((st) => supply.onHand!.itemIds.includes(st.item_id))
    : [];

  const meta = [
    categoryLabel(supply.identity.category),
    supply.identity.vendor,
    supply.identity.catalogNumber,
  ]
    .filter((p) => p && String(p).trim())
    .join(" · ");

  const refreshInventory = () => {
    void queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
    void queryClient.invalidateQueries({ queryKey: ["inventory-stocks"] });
  };

  const setStockStatus = async (
    item: InventoryItem,
    stock: InventoryStock,
    status: InventoryStockStatus,
  ) => {
    setBusyStockId(stock.id);
    try {
      await inventoryStocksApi.update(
        stock.id,
        { status },
        effectiveOwnerOf(item, currentUser),
      );
      refreshInventory();
    } finally {
      setBusyStockId(null);
    }
  };

  const stepStockCount = async (
    item: InventoryItem,
    stock: InventoryStock,
    next: number,
  ) => {
    setBusyStockId(stock.id);
    try {
      await inventoryStocksApi.update(
        stock.id,
        { container_count: Math.max(0, Math.floor(next)) },
        effectiveOwnerOf(item, currentUser),
      );
      refreshInventory();
    } finally {
      setBusyStockId(null);
    }
  };

  const deleteStock = async (item: InventoryItem, stock: InventoryStock) => {
    setBusyStockId(stock.id);
    try {
      await inventoryStocksApi.delete(stock.id, effectiveOwnerOf(item, currentUser));
      refreshInventory();
    } finally {
      setBusyStockId(null);
    }
  };

  const submitStock = async (
    data: InventoryStockCreate | InventoryStockUpdate,
  ) => {
    if (stockDialog.mode === "edit") {
      await inventoryStocksApi.update(
        stockDialog.stock.id,
        data as InventoryStockUpdate,
        effectiveOwnerOf(stockDialog.item, currentUser),
      );
    } else if (stockDialog.mode === "add") {
      await inventoryStocksApi.create(
        data as InventoryStockCreate,
        effectiveOwnerOf(stockDialog.item, currentUser),
      );
    }
    setStockDialog({ mode: "closed" });
    refreshInventory();
  };

  const inCart = cart.has(supply.key);
  const handleReorder = () => {
    if (inCart) return;
    cart.add(supply.key, seedFromSupply(supply, backingItem));
  };

  return (
    <LivingPopup open onClose={onClose} fillHeight label={`Supply details, ${supply.identity.name}`}>
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-title font-semibold text-foreground">{supply.identity.name}</h2>
              {meta ? <p className="truncate text-meta text-foreground-muted">{meta}</p> : null}
              {supply.identity.cas ? (
                <p className="text-meta text-foreground-muted">CAS {supply.identity.cas}</p>
              ) : null}
            </div>
            <div className="flex flex-none items-center gap-2">
              {inCart ? (
                <span className="inline-flex items-center gap-1 rounded-lg border border-brand-action/40 bg-brand-action/10 px-2.5 py-1 text-meta font-medium text-brand-action">
                  <Icon name="check" className="h-3.5 w-3.5" />
                  In cart
                </span>
              ) : (
                <Tooltip label="Add to the reorder cart">
                  <button
                    type="button"
                    onClick={handleReorder}
                    className="ros-btn-neutral inline-flex items-center gap-1.5 px-2.5 py-1 text-meta font-medium text-foreground"
                  >
                    <Icon name="refresh" className="h-3.5 w-3.5" />
                    Reorder
                  </button>
                </Tooltip>
              )}
              <Tooltip label="Close">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="rounded-md p-1 text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                >
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto px-5 py-4">
          {/* On hand */}
          {supply.onHand ? (
            <section>
              <h3 className="mb-2 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
                On hand
              </h3>
              {onHandStocks.length === 0 ? (
                <p className="text-meta text-foreground-muted">No stocks recorded.</p>
              ) : (
                <div className="space-y-2">
                  {onHandStocks.map((st) => {
                    const stItem = itemsById.get(st.item_id);
                    if (!stItem) return null;
                    const editable = canEditItem(stItem, currentUser);
                    return (
                      <StockRow
                        key={st.id}
                        item={stItem}
                        stock={st}
                        canEdit={editable}
                        busy={busyStockId === st.id}
                        nodesById={nodesById}
                        onJumpToLocation={() => router.push("/inventory")}
                        onSetStatus={(status) => setStockStatus(stItem, st, status)}
                        onStepCount={(next) => stepStockCount(stItem, st, next)}
                        onEdit={() => setStockDialog({ mode: "edit", item: stItem, stock: st })}
                        onDelete={() => deleteStock(stItem, st)}
                      />
                    );
                  })}
                </div>
              )}
              {backingItem && canEditItem(backingItem, currentUser) ? (
                <button
                  type="button"
                  onClick={() => setStockDialog({ mode: "add", item: backingItem })}
                  className="ros-btn-neutral mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium text-foreground"
                >
                  <Icon name="plus" className="h-3.5 w-3.5" />
                  Add stock
                </button>
              ) : null}
            </section>
          ) : null}

          {/* Ordering */}
          {supply.ordering ? (
            <section>
              <h3 className="mb-2 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
                Ordering
              </h3>
              <ul className="space-y-2">
                {supply.ordering.openLines.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface-sunken px-3 py-2"
                  >
                    <span className="inline-flex rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-meta font-medium text-sky-700 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-300">
                      {PURCHASE_ORDER_STATUS_LABEL[normalizeOrderStatus(p.order_status)]}
                    </span>
                    <span className="text-meta text-foreground-muted">Qty {p.quantity}</span>
                    {p.total_price ? (
                      <span className="text-meta text-foreground-muted">${p.total_price.toFixed(2)}</span>
                    ) : null}
                    {p.funding_string ? <span className="text-meta text-foreground-muted">{p.funding_string}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>

      {/* Add / edit stock */}
      <LivingPopup
        open={stockDialog.mode !== "closed"}
        onClose={() => setStockDialog({ mode: "closed" })}
        label={stockDialog.mode === "edit" ? "Edit stock" : "Add stock"}
        widthClassName="max-w-2xl"
        card
        closeOnScrimClick={false}
        fillHeight
      >
        {stockDialog.mode !== "closed" && (
          <div className="overflow-y-auto">
            <StockFormDialog
              item={stockDialog.item}
              stock={stockDialog.mode === "edit" ? stockDialog.stock : null}
              nodes={nodes}
              onCancel={() => setStockDialog({ mode: "closed" })}
              onSubmit={submitStock}
            />
          </div>
        )}
      </LivingPopup>
    </LivingPopup>
  );
}
