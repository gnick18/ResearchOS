"use client";

// /inventory (chunk 2 of inventory v1). The catalog + stock CRUD surface for
// the count-first, low-maintenance inventory (design sections 2, 5). The whole
// route is gated behind INVENTORY_ENABLED (default off, on in Grant's working
// tree for dogfooding); when off it renders a minimal "not enabled" state.
//
// The three zero-upkeep signal widgets (expiring / stale / low) are chunk 3,
// the Purchases self-populate is chunk 4, history / trash / search are chunk 5,
// and the camera scanner is chunk 6. Barcode fields are plain text here.
//
// House style: <Icon> only, LivingPopup for the add/edit dialogs, Tooltip for
// icon-only buttons, brand + semantic (dark-mode) tokens, no emojis / em-dashes
// / mid-sentence colons.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import AppShell from "@/components/AppShell";
import LivingPopup from "@/components/ui/LivingPopup";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { INVENTORY_ENABLED } from "@/lib/inventory/config";
import {
  fetchAllInventoryItemsIncludingShared,
  fetchAllInventoryStocksIncludingShared,
  fetchAllStorageNodesIncludingShared,
  inventoryItemsApi,
  inventoryStocksApi,
} from "@/lib/local-api";
import { normalizeSharedWith, WHOLE_LAB_SENTINEL } from "@/lib/sharing/unified";
import type {
  InventoryItem,
  InventoryItemCreate,
  InventoryItemUpdate,
  InventoryStock,
  InventoryStockCreate,
  InventoryStockStatus,
  InventoryStockUpdate,
  StorageNode,
} from "@/lib/types";
import ItemFormDialog from "@/components/inventory/ItemFormDialog";
import ImportInventoryDialog from "@/components/inventory/ImportInventoryDialog";
import ScanFlow from "@/components/inventory/ScanFlow";
import StockFormDialog from "@/components/inventory/StockFormDialog";
import StockRow from "@/components/inventory/StockRow";
import StorageMap from "@/components/inventory/StorageMap";
import InventoryHealth from "@/components/inventory/InventoryHealth";
import SignalRecordRow from "@/components/inventory/SignalRecordRow";
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  computeInventorySignals,
  containerCountLabel,
  formatDate,
  statusChipClass,
  summarizeStocks,
  typedSummary,
} from "@/components/inventory/inventory-ui";
import type { InventorySignalKind } from "@/components/inventory/inventory-ui";

/** Owner to route a write through. A record shared INTO me at edit permission
 *  writes back to the owner's directory; my own records pass undefined and
 *  write to my own directory (mirrors effectiveOwnerOf in /methods). */
function effectiveOwnerOf(item: InventoryItem, currentUser: string | null) {
  return item.is_shared_with_me && item.owner !== currentUser
    ? item.owner
    : undefined;
}

/** Can the current viewer edit this item? Owner always; otherwise an edit-level
 *  entry for me or the whole-lab sentinel (mirrors canWrite in sharing/unified,
 *  without needing the full Viewer, which uses a different account_type union).
 */
function canEditItem(item: InventoryItem, currentUser: string | null): boolean {
  if (!currentUser) return false;
  if (item.owner === currentUser) return true;
  const list = normalizeSharedWith(item.shared_with);
  return list.some(
    (s) =>
      (s.username === currentUser || s.username === WHOLE_LAB_SENTINEL) &&
      s.level === "edit",
  );
}

type ItemDialogState =
  | { mode: "closed" }
  | { mode: "add"; prefillBarcode?: string }
  | { mode: "edit"; item: InventoryItem };

type StockDialogState =
  | { mode: "closed" }
  | { mode: "add"; item: InventoryItem }
  | { mode: "edit"; item: InventoryItem; stock: InventoryStock };

export default function InventoryPage() {
  // Supplies v2 chunk 7: when the unified Supplies page is live
  // (INVENTORY_ENABLED), /inventory is retired and redirects into /supplies,
  // mapping its known deep-link params so the loop-strip / search intent
  // survives. When the flag is OFF (prod default) this branch is never taken,
  // so the standalone page below renders its usual "not enabled" state and prod
  // is unchanged. INVENTORY_ENABLED is a module constant, so the same branch is
  // taken on every render (no Rules-of-Hooks issue).
  if (INVENTORY_ENABLED) {
    return <InventoryRedirect />;
  }
  return <InventoryPageContent />;
}

/** Redirect /inventory into the unified /supplies page (chunk 7). Maps the
 *  legacy health-tile deep-link (?signal=expiring|low|stale) onto the unified
 *  attention filter; every other param lands on the default list. */
function InventoryRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const signal = searchParams.get("signal");
  useEffect(() => {
    const target =
      signal === "expiring" || signal === "low" || signal === "stale"
        ? "/supplies?filter=attention"
        : "/supplies";
    router.replace(target);
  }, [router, signal]);
  return null;
}

function InventoryPageContent() {
  const { currentUser } = useCurrentUser();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState("");
  // List (the chunk-2 item list) vs Storage (the box-finder map). Defaults to
  // List per the design; the segmented control flips it.
  const [view, setView] = useState<"list" | "storage">("list");
  // A breadcrumb-jump request handed to the storage map: select this box cell.
  const [jumpTarget, setJumpTarget] = useState<{
    nodeId: number;
    position: string | null;
  } | null>(null);
  // Keyed on `${owner}:${item_id}` to avoid collision when two users each have
  // an item with the same numeric id (possible once SHARING_ENABLED goes live).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The active health-tile filter, or null for the normal item list (chunk 3).
  const [activeSignal, setActiveSignal] = useState<InventorySignalKind | null>(
    null,
  );

  // Supplies hub deep-link: a `?signal=expiring|low|stale` param (set by the
  // clickable loop-strip counts in SuppliesTabs) seeds the health-tile filter on
  // load, so a count is a one-click jump into exactly the items it counts. After
  // seeding, the in-page filter UI owns the state normally; we do not force the
  // URL to track every later in-page change.
  const searchParams = useSearchParams();
  const signalParam = searchParams.get("signal");
  useEffect(() => {
    if (signalParam === "expiring" || signalParam === "low" || signalParam === "stale") {
      setActiveSignal(signalParam);
    }
  }, [signalParam]);
  const [itemDialog, setItemDialog] = useState<ItemDialogState>({
    mode: "closed",
  });
  const [stockDialog, setStockDialog] = useState<StockDialogState>({
    mode: "closed",
  });
  const [deletingItem, setDeletingItem] = useState<InventoryItem | null>(null);
  // Guards against a double-click firing confirmDeleteItem twice (the second
  // call errors on already-gone stock ids).
  const [deletingInFlight, setDeletingInFlight] = useState(false);
  // Stock deletion gets a confirm step too (stocks carry lot numbers, expiry,
  // and location, so losing one on a misclick is costly). Holds the pending
  // item + stock; in-flight guards against a double-delete.
  const [deletingStock, setDeletingStock] = useState<{
    item: InventoryItem;
    stock: InventoryStock;
  } | null>(null);
  const [deletingStockInFlight, setDeletingStockInFlight] = useState(false);
  // The barcode scanner popup (chunk 6). Open holds the scanner + result flow.
  const [scanOpen, setScanOpen] = useState(false);
  // The spreadsheet-import popup (cold-start path, 2026-06-07).
  const [importOpen, setImportOpen] = useState(false);
  // The id of the stock currently mid-write (disables its row controls so a
  // double tap can't race two updates).
  const [busyStockId, setBusyStockId] = useState<number | null>(null);

  const itemsQuery = useQuery({
    queryKey: ["inventory-items", currentUser],
    queryFn: fetchAllInventoryItemsIncludingShared,
    enabled: INVENTORY_ENABLED && !!currentUser,
  });
  const stocksQuery = useQuery({
    queryKey: ["inventory-stocks", currentUser],
    queryFn: fetchAllInventoryStocksIncludingShared,
    enabled: INVENTORY_ENABLED && !!currentUser,
  });

  // Storage nodes power both the Storage view (StorageMap shares this same
  // query key, so React Query dedupes the fetch) and the location breadcrumb on
  // each list stock row.
  const nodesQuery = useQuery({
    queryKey: ["storage-nodes", currentUser],
    queryFn: fetchAllStorageNodesIncludingShared,
    enabled: INVENTORY_ENABLED && !!currentUser,
  });

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const stocks = useMemo(() => stocksQuery.data ?? [], [stocksQuery.data]);
  const nodes = useMemo(() => nodesQuery.data ?? [], [nodesQuery.data]);

  const nodesById = useMemo(() => {
    const m = new Map<number, StorageNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  // Group stocks under their item for the row list + the summary.
  // Key is `${owner}:${item_id}` to prevent collision when two users each have
  // a stock with the same item_id (possible once SHARING_ENABLED goes live).
  const stocksByItem = useMemo(() => {
    const map = new Map<string, InventoryStock[]>();
    for (const s of stocks) {
      const k = `${s.owner}:${s.item_id}`;
      const arr = map.get(k) ?? [];
      arr.push(s);
      map.set(k, arr);
    }
    return map;
  }, [stocks]);

  // The user's own items (not shared-in), the merge-don't-duplicate target for
  // the spreadsheet import. Import always writes into the current user's dir, so
  // only own items can be merged into.
  const ownItems = useMemo(
    () => items.filter((it) => !it.is_shared_with_me),
    [items],
  );

  // Vendor list for the item form's vendor datalist.
  const vendorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) if (it.vendor) set.add(it.vendor);
    return [...set].sort();
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...items].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    if (!q) return sorted;
    return sorted.filter((it) => {
      return (
        it.name.toLowerCase().includes(q) ||
        (it.vendor?.toLowerCase().includes(q) ?? false) ||
        (it.catalog_number?.toLowerCase().includes(q) ?? false) ||
        (it.cas?.toLowerCase().includes(q) ?? false) ||
        CATEGORY_LABEL[it.category].toLowerCase().includes(q)
      );
    });
  }, [items, query]);

  // The three zero-upkeep signals, computed at load from the already-fetched
  // items + stocks (chunk 3, design 2.4 / 10). `new Date()` is fine at runtime;
  // the pure functions take it as a parameter so tests stay deterministic.
  const signals = useMemo(
    () => computeInventorySignals(items, stocks, new Date()),
    [items, stocks],
  );

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
    queryClient.invalidateQueries({ queryKey: ["inventory-stocks"] });
    queryClient.invalidateQueries({ queryKey: ["storage-nodes"] });
  };

  // Breadcrumb jump: switch to the Storage view and ask the map to select that
  // box cell. The map consumes the target once and calls back to clear it.
  const jumpToCell = useCallback(
    (nodeId: number, position: string | null) => {
      // Clear any active signal filter (mirrors openItemInList) so returning to
      // List view doesn't drop the user back into the signal-filtered subset.
      setActiveSignal(null);
      setView("storage");
      setJumpTarget({ nodeId, position });
    },
    [],
  );

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // "Open" affordance on a signal record: clear the filter, expand that item in
  // the normal list, and scroll it into view. Reuses the existing expand state.
  // key is `${owner}:${item_id}`; the DOM id uses a hyphen separator instead.
  const openItemInList = useCallback((key: string) => {
    setActiveSignal(null);
    setQuery("");
    setView("list");
    setExpanded((prev) => new Set(prev).add(key));
    // Defer to the next frame so the normal list has re-rendered before scroll.
    requestAnimationFrame(() => {
      const el = document.getElementById(
        `inventory-item-${key.replace(":", "-")}`,
      );
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  const toggleSignal = (kind: InventorySignalKind) =>
    setActiveSignal((prev) => (prev === kind ? null : kind));

  // ── Item CRUD ──────────────────────────────────────────────────────────
  const submitItem = async (data: InventoryItemCreate | InventoryItemUpdate) => {
    if (itemDialog.mode === "edit") {
      const owner = effectiveOwnerOf(itemDialog.item, currentUser);
      await inventoryItemsApi.update(
        itemDialog.item.id,
        data as InventoryItemUpdate,
        owner,
      );
    } else {
      await inventoryItemsApi.create(data as InventoryItemCreate);
    }
    setItemDialog({ mode: "closed" });
    refresh();
  };

  const confirmDeleteItem = async () => {
    if (!deletingItem || deletingInFlight) return;
    setDeletingInFlight(true);
    try {
      const owner = effectiveOwnerOf(deletingItem, currentUser);
      // Soft-delete (chunk 5): moves records to _trash so they can be restored
      // from /trash. Delete stocks first so none are left pointing at a gone item.
      const itemStocks =
        stocksByItem.get(`${deletingItem.owner}:${deletingItem.id}`) ?? [];
      for (const s of itemStocks) {
        await inventoryStocksApi.delete(s.id, owner);
      }
      await inventoryItemsApi.delete(deletingItem.id, owner);
      setDeletingItem(null);
      refresh();
    } finally {
      setDeletingInFlight(false);
    }
  };

  const confirmDeleteStock = async () => {
    if (!deletingStock || deletingStockInFlight) return;
    setDeletingStockInFlight(true);
    try {
      const owner = effectiveOwnerOf(deletingStock.item, currentUser);
      await inventoryStocksApi.delete(deletingStock.stock.id, owner);
      setDeletingStock(null);
      refresh();
    } finally {
      setDeletingStockInFlight(false);
    }
  };

  // ── Stock CRUD ─────────────────────────────────────────────────────────
  const submitStock = async (
    data: InventoryStockCreate | InventoryStockUpdate,
  ) => {
    if (stockDialog.mode === "edit") {
      const owner = effectiveOwnerOf(stockDialog.item, currentUser);
      await inventoryStocksApi.update(
        stockDialog.stock.id,
        data as InventoryStockUpdate,
        owner,
      );
    } else if (stockDialog.mode === "add") {
      const owner = effectiveOwnerOf(stockDialog.item, currentUser);
      await inventoryStocksApi.create(data as InventoryStockCreate, owner);
    }
    setStockDialog({ mode: "closed" });
    refresh();
  };

  // One-tap status. Passes `status` so the API honors a manual low/empty tap;
  // deriveInventoryStatus stays in the data layer (chunk 1). We never recompute
  // it here.
  const setStockStatus = async (
    item: InventoryItem,
    stock: InventoryStock,
    status: InventoryStockStatus,
  ) => {
    setBusyStockId(stock.id);
    try {
      const owner = effectiveOwnerOf(item, currentUser);
      await inventoryStocksApi.update(stock.id, { status }, owner);
      refresh();
    } finally {
      setBusyStockId(null);
    }
  };

  // One-tap container-count step (3 -> 2 when a container is finished, or up
  // when one arrives). The API re-derives status from the new count.
  const stepStockCount = async (
    item: InventoryItem,
    stock: InventoryStock,
    next: number,
  ) => {
    setBusyStockId(stock.id);
    try {
      const owner = effectiveOwnerOf(item, currentUser);
      await inventoryStocksApi.update(
        stock.id,
        { container_count: Math.max(0, Math.floor(next)) },
        owner,
      );
      refresh();
    } finally {
      setBusyStockId(null);
    }
  };

  // ── Flag-off graceful state ──────────────────────────────────────────────
  if (!INVENTORY_ENABLED) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-md rounded-xl border border-border bg-surface-raised px-6 py-8 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken text-foreground-muted">
              <Icon name="list" className="h-6 w-6" />
            </div>
            <h2 className="text-title font-semibold text-foreground">
              Inventory is not enabled
            </h2>
            <p className="mt-1.5 text-body text-foreground-muted">
              Inventory is turned off for this workspace. Check back later or
              ask your lab head to enable it.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  const isLoading = itemsQuery.isLoading || stocksQuery.isLoading;

  return (
    <AppShell>
      <div className="flex-1 overflow-auto p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-heading font-semibold text-foreground">
              Inventory
            </h2>
            <p className="mt-0.5 text-body text-foreground-muted">
              Count containers, tap a status, type an expiry once. The inventory
              you will actually keep.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* List vs Storage map toggle (box-finder map UI). */}
            <div
              role="tablist"
              aria-label="Inventory view"
              className="inline-flex items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5 ros-seg-track border border-border"
            >
              <button
                type="button"
                role="tab"
                aria-selected={view === "list"}
                onClick={() => setView("list")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-meta font-medium transition-colors ${
                  view === "list"
                    ? "bg-surface-raised text-foreground ros-seg-active"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                <Icon name="list" className="h-3.5 w-3.5" />
                List
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "storage"}
                onClick={() => setView("storage")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-meta font-medium transition-colors ${
                  view === "storage"
                    ? "bg-surface-raised text-foreground ros-seg-active"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                <Icon name="box" className="h-3.5 w-3.5" />
                Storage map
              </button>
            </div>
            <Tooltip label="Refresh">
              <button
                type="button"
                onClick={refresh}
                aria-label="Refresh inventory"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
              >
                <Icon name="refresh" className="h-4 w-4" />
              </button>
            </Tooltip>
            <button
              type="button"
              onClick={() => setScanOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-2 text-body text-foreground hover:bg-surface-sunken"
            >
              <Icon name="scan" className="h-4 w-4" />
              Scan
            </button>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-2 text-body text-foreground hover:bg-surface-sunken"
            >
              <Icon name="import" className="h-4 w-4" />
              Import
            </button>
            <button
              type="button"
              onClick={() => setItemDialog({ mode: "add" })}
              className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-body"
            >
              <Icon name="plus" className="h-4 w-4" />
              Add item
            </button>
          </div>
        </div>

        {view === "storage" ? (
          <StorageMap
            items={items}
            stocks={stocks}
            currentUser={currentUser}
            onRefresh={refresh}
            onOpenItem={(item) =>
              openItemInList(`${item.owner}:${item.id}`)
            }
            jumpTarget={jumpTarget}
            onJumpConsumed={() => setJumpTarget(null)}
          />
        ) : (
          <>
        {/* Health strip (chunk 3): the three zero-upkeep signals, above search. */}
        {!isLoading && items.length > 0 && (
          <InventoryHealth
            signals={signals}
            activeKind={activeSignal}
            onSelect={toggleSignal}
          />
        )}

        {/* Search */}
        <div className="mb-5 max-w-md">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted">
              <Icon name="search" className="h-4 w-4" />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, vendor, catalog, CAS, category"
              className="w-full rounded-lg border border-border bg-surface-raised py-2 pl-9 pr-3 text-body text-foreground placeholder:text-foreground-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-action"
            />
          </div>
        </div>

        {/* Signal view (chunk 3): the filtered, annotated record list shown
            while a health tile is active, replacing the normal list. */}
        {!isLoading && activeSignal !== null ? (
          <SignalView
            kind={activeSignal}
            signals={signals}
            onClear={() => setActiveSignal(null)}
            onOpen={openItemInList}
          />
        ) : isLoading ? (
          <p className="text-body text-foreground-muted">Loading inventory.</p>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            hasItems={items.length > 0}
            onAdd={() => setItemDialog({ mode: "add" })}
            onImport={() => setImportOpen(true)}
          />
        ) : (
          <div className="space-y-3">
            {filteredItems.map((item) => {
              const itemKey = `${item.owner}:${item.id}`;
              const itemStocks = stocksByItem.get(itemKey) ?? [];
              const summary = summarizeStocks(itemStocks);
              const isOpen = expanded.has(itemKey);
              const editable = canEditItem(item, currentUser);
              return (
                <div
                  key={itemKey}
                  id={`inventory-item-${item.owner}-${item.id}`}
                  className="overflow-hidden rounded-xl border border-border bg-surface-raised"
                >
                  {/* Item summary row */}
                  <div className="flex items-center justify-between gap-4 px-5 py-4">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(itemKey)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      aria-expanded={isOpen}
                    >
                      <span
                        className={`flex h-6 w-6 flex-shrink-0 items-center justify-center text-foreground-muted transition-transform ${
                          isOpen ? "rotate-180" : ""
                        }`}
                      >
                        <Icon name="chevronDown" className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-title font-semibold text-foreground">
                            {item.name}
                          </span>
                          {item.is_shared_with_me && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-meta text-foreground-muted">
                              <Icon name="users" className="h-3 w-3" />
                              {item.owner}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-meta text-foreground-muted">
                          {CATEGORY_LABEL[item.category]}
                          {(() => {
                            // Typed items (plasmid / antibody) show their typed
                            // summary; everything else keeps the vendor / catalog
                            // line.
                            const typed = typedSummary(item);
                            if (typed) return ` · ${typed}`;
                            return `${item.vendor ? ` · ${item.vendor}` : ""}${
                              item.catalog_number
                                ? ` · ${item.catalog_number}`
                                : ""
                            }`;
                          })()}
                        </p>
                      </div>
                    </button>

                    {/* Stocks summary */}
                    <div className="flex flex-shrink-0 items-center gap-3">
                      <div className="hidden text-right sm:block">
                        <p className="text-body font-semibold text-foreground">
                          {containerCountLabel(
                            summary.totalContainers,
                            item.container_label,
                          )}
                        </p>
                        <p className="text-meta text-foreground-muted">
                          {summary.stockCount === 0
                            ? "No stocks yet"
                            : summary.soonestExpiry
                              ? `Soonest expiry ${formatDate(summary.soonestExpiry)}`
                              : `${summary.stockCount} stock${
                                  summary.stockCount === 1 ? "" : "s"
                                }`}
                        </p>
                      </div>
                      {summary.worstStatus && (
                        <span
                          className={`rounded-md px-2.5 py-1 text-meta font-medium ${statusChipClass(
                            summary.worstStatus,
                          )}`}
                        >
                          {STATUS_LABEL[summary.worstStatus]}
                        </span>
                      )}
                      {editable && (
                        <div className="flex items-center gap-1">
                          <Tooltip label="Edit item">
                            <button
                              type="button"
                              onClick={() =>
                                setItemDialog({ mode: "edit", item })
                              }
                              aria-label="Edit item"
                              className="flex h-8 w-8 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                            >
                              <Icon name="pencil" className="h-4 w-4" />
                            </button>
                          </Tooltip>
                          <Tooltip label="Delete item">
                            <button
                              type="button"
                              onClick={() => setDeletingItem(item)}
                              aria-label="Delete item"
                              className="flex h-8 w-8 items-center justify-center rounded-md text-foreground-muted hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/15"
                            >
                              <Icon name="trash" className="h-4 w-4" />
                            </button>
                          </Tooltip>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Expanded stock rows */}
                  {isOpen && (
                    <div className="border-t border-border bg-surface-sunken/50 px-5 py-4">
                      {item.notes && (
                        <p className="mb-3 text-meta text-foreground-muted">
                          {item.notes}
                        </p>
                      )}
                      {itemStocks.length === 0 ? (
                        <p className="text-meta text-foreground-muted">
                          No stocks recorded yet.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {itemStocks.map((stock) => (
                            <StockRow
                              key={stock.id}
                              item={item}
                              stock={stock}
                              canEdit={editable}
                              busy={busyStockId === stock.id}
                              nodesById={nodesById}
                              onJumpToLocation={jumpToCell}
                              onSetStatus={(status) =>
                                setStockStatus(item, stock, status)
                              }
                              onStepCount={(next) =>
                                stepStockCount(item, stock, next)
                              }
                              onEdit={() =>
                                setStockDialog({ mode: "edit", item, stock })
                              }
                              onDelete={() =>
                                setDeletingStock({ item, stock })
                              }
                            />
                          ))}
                        </div>
                      )}
                      {editable && (
                        <button
                          type="button"
                          onClick={() => setStockDialog({ mode: "add", item })}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-meta font-medium text-foreground hover:bg-surface-raised"
                        >
                          <Icon name="plus" className="h-3.5 w-3.5" />
                          Add stock
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
          </>
        )}
      </div>

      {/* Add / edit item */}
      <LivingPopup
        open={itemDialog.mode !== "closed"}
        onClose={() => setItemDialog({ mode: "closed" })}
        label={itemDialog.mode === "edit" ? "Edit item" : "Add item"}
        widthClassName="max-w-2xl"
        card
        closeOnScrimClick={false}
        fillHeight
      >
        {itemDialog.mode !== "closed" && (
          <div className="overflow-y-auto">
            <ItemFormDialog
              item={itemDialog.mode === "edit" ? itemDialog.item : null}
              vendorOptions={vendorOptions}
              initialBarcode={
                itemDialog.mode === "add" ? itemDialog.prefillBarcode : null
              }
              onCancel={() => setItemDialog({ mode: "closed" })}
              onSubmit={submitItem}
            />
          </div>
        )}
      </LivingPopup>

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

      {/* Delete item confirm */}
      <LivingPopup
        open={deletingItem !== null}
        onClose={() => setDeletingItem(null)}
        label="Delete item"
        widthClassName="max-w-md"
        card
        padded
      >
        {deletingItem && (
          <div>
            <h2 className="text-title font-semibold text-foreground">
              Delete {deletingItem.name}?
            </h2>
            <p className="mt-2 text-body text-foreground-muted">
              This moves the item and its{" "}
              {(
                stocksByItem.get(
                  `${deletingItem.owner}:${deletingItem.id}`,
                ) ?? []
              ).length}{" "}
              stock
              {(
                stocksByItem.get(
                  `${deletingItem.owner}:${deletingItem.id}`,
                ) ?? []
              ).length === 1
                ? ""
                : "s"}{" "}
              to Trash. You can restore them from the Trash page.
            </p>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingItem(null)}
                disabled={deletingInFlight}
                className="rounded-lg border border-border px-4 py-2 text-body text-foreground hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteItem}
                disabled={deletingInFlight}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-body font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="trash" className="h-4 w-4" />
                {deletingInFlight ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        )}
      </LivingPopup>

      {/* Delete stock confirm */}
      <LivingPopup
        open={deletingStock !== null}
        onClose={() => setDeletingStock(null)}
        label="Delete stock"
        widthClassName="max-w-md"
        card
        padded
      >
        {deletingStock && (
          <div>
            <h2 className="text-title font-semibold text-foreground">
              Delete this stock of {deletingStock.item.name}?
            </h2>
            <p className="mt-2 text-body text-foreground-muted">
              This permanently removes the stock
              {deletingStock.stock.lot_number
                ? ` (lot ${deletingStock.stock.lot_number})`
                : ""}{" "}
              along with its lot number, expiry, and location. This cannot be
              undone.
            </p>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingStock(null)}
                disabled={deletingStockInFlight}
                className="rounded-lg border border-border px-4 py-2 text-body text-foreground hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteStock}
                disabled={deletingStockInFlight}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-body font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="trash" className="h-4 w-4" />
                {deletingStockInFlight ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        )}
      </LivingPopup>

      {/* Spreadsheet import (cold-start path) */}
      <LivingPopup
        open={importOpen}
        onClose={() => setImportOpen(false)}
        label="Import inventory"
        widthClassName="max-w-2xl"
        card
        closeOnScrimClick={false}
        fillHeight
      >
        {importOpen && (
          <div className="overflow-y-auto">
            <ImportInventoryDialog
              existingItems={ownItems}
              onCancel={() => setImportOpen(false)}
              onDone={() => {
                setImportOpen(false);
                refresh();
              }}
            />
          </div>
        )}
      </LivingPopup>

      {/* Barcode scanner + scan flow (chunk 6) */}
      <LivingPopup
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        label="Scan a barcode"
        widthClassName="max-w-lg"
        card
        closeOnScrimClick={false}
      >
        {scanOpen && (
          <ScanFlow
            items={items}
            stocks={stocks}
            currentUser={currentUser}
            onRefresh={refresh}
            onClose={() => setScanOpen(false)}
            onCreateItemWithCode={(code) => {
              setScanOpen(false);
              setItemDialog({ mode: "add", prefillBarcode: code });
            }}
          />
        )}
      </LivingPopup>
    </AppShell>
  );
}

/** The chunk 3 filtered signal view: a filter chip, a clear button, and the
 *  annotated read-only record rows for the active signal. */
function SignalView({
  kind,
  signals,
  onClear,
  onOpen,
}: {
  kind: InventorySignalKind;
  signals: ReturnType<typeof computeInventorySignals>;
  onClear: () => void;
  onOpen: (key: string) => void;
}) {
  const meta = SIGNAL_CHIP[kind];
  const count =
    kind === "expiring"
      ? signals.expiring.length
      : kind === "stale"
        ? signals.stale.length
        : signals.low.length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-meta font-medium ${meta.chip}`}
        >
          <Icon name={meta.icon} className="h-3.5 w-3.5" />
          Showing {meta.label} ({count})
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-meta font-medium text-brand-action hover:underline"
        >
          Clear filter, show all
        </button>
      </div>

      {count === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface-raised px-5 py-8 text-center text-body text-foreground-muted">
          Nothing {meta.label} right now.
        </p>
      ) : (
        <div className="space-y-2">
          {kind === "expiring" &&
            signals.expiring.map((sig) => (
              <SignalRecordRow
                key={`exp-${sig.stock.id}`}
                kind="expiring"
                item={sig.item}
                metaSuffix={stockMetaSuffix(sig.stock)}
                annotation={sig.annotation}
                chipStatus={sig.expired ? "expired" : sig.stock.status}
                onOpen={() => onOpen(`${sig.item.owner}:${sig.item.id}`)}
              />
            ))}
          {kind === "stale" &&
            signals.stale.map((sig) => (
              <SignalRecordRow
                key={`stale-${sig.stock.id}`}
                kind="stale"
                item={sig.item}
                metaSuffix={stockMetaSuffix(sig.stock)}
                annotation={sig.annotation}
                chipStatus={sig.stock.status}
                onOpen={() => onOpen(`${sig.item.owner}:${sig.item.id}`)}
              />
            ))}
          {kind === "low" &&
            signals.low.map((sig) => (
              <SignalRecordRow
                key={`low-${sig.item.id}`}
                kind="low"
                item={sig.item}
                metaSuffix="total across stocks"
                annotation={sig.annotation}
                chipStatus={sig.chipStatus}
                onOpen={() => onOpen(`${sig.item.owner}:${sig.item.id}`)}
              />
            ))}
        </div>
      )}
    </div>
  );
}

/** Per-signal chip styling + label + icon for the filter chip. */
const SIGNAL_CHIP: Record<
  InventorySignalKind,
  { label: string; icon: Parameters<typeof Icon>[0]["name"]; chip: string }
> = {
  expiring: {
    label: "expiring soon",
    icon: "alarmClock",
    chip: "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
  },
  stale: {
    label: "stale",
    icon: "hourglass",
    chip: "bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:border-slate-500/30",
  },
  low: {
    label: "low or empty",
    icon: "dropletLow",
    chip: "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30",
  },
};

/** The lot / location tail for a stock-level signal record meta line. */
function stockMetaSuffix(stock: InventoryStock): string {
  const parts: string[] = [];
  if (stock.lot_number) parts.push(`Lot ${stock.lot_number}`);
  if (stock.location_text) parts.push(stock.location_text);
  return parts.join(" · ");
}

function EmptyState({
  hasItems,
  onAdd,
  onImport,
}: {
  hasItems: boolean;
  onAdd: () => void;
  onImport: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-raised px-6 py-12 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken text-foreground-muted">
        <Icon name="list" className="h-6 w-6" />
      </div>
      <h3 className="text-title font-semibold text-foreground">
        {hasItems ? "No items match your search" : "No inventory yet"}
      </h3>
      <p className="mx-auto mt-1.5 max-w-sm text-body text-foreground-muted">
        {hasItems
          ? "Try a different name, vendor, or category."
          : "Add the reagents and kits your lab keeps on hand. Containers, status, and expiry come next."}
      </p>
      {!hasItems && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onAdd}
            className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-body"
          >
            <Icon name="plus" className="h-4 w-4" />
            Add your first item
          </button>
          <button
            type="button"
            onClick={onImport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-4 py-2 text-body text-foreground hover:bg-surface-sunken"
          >
            <Icon name="import" className="h-4 w-4" />
            Import a spreadsheet
          </button>
        </div>
      )}
    </div>
  );
}
