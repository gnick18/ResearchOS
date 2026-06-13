"use client";

// /supplies (Supplies v2 unified page, SUPPLIES_V2_UNIFIED.md). One page where
// each row is a Supply, showing on-hand state (from Inventory) and on-order
// state (from Purchases) side by side, so identity lives once and the two daily
// questions (what do I have / what is on order) are answered in one list.
//
// Chunk 2 built the read list + filters + search. Chunk 3 added the two-section
// detail panel. Chunk 4 (this step) adds Reorder + the draft-order cart: a quick
// Reorder affordance on low/out rows and in the detail panel seeds a draft line
// from the supply identity, a "Reorder cart" chip opens the batch review where
// one funding account is set and the order is submitted. The whole route is
// gated behind INVENTORY_ENABLED.
//
// House style: <Icon> only, brand + semantic dark-mode tokens, Tooltip on
// icon-only buttons, no emojis / em-dashes / mid-sentence colons.

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import AppShell from "@/components/AppShell";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import LivingPopup from "@/components/ui/LivingPopup";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsLabHead } from "@/hooks/useIsLabHead";
import { usePiViewMode } from "@/hooks/usePiViewMode";
import { usePiRecordMenu } from "@/hooks/usePiRecordMenu";
import { useAppStore } from "@/lib/store";
import { INVENTORY_ENABLED } from "@/lib/inventory/config";
import {
  fetchAllInventoryItemsIncludingShared,
  fetchAllInventoryStocksIncludingShared,
  fetchAllStorageNodesIncludingShared,
  fetchAllProjectsIncludingShared,
  fetchAllTasksIncludingShared,
  inventoryItemsApi,
  labApi,
  purchasesApi,
} from "@/lib/local-api";
import {
  isPurchasePending,
  type InventoryItem,
  type InventoryItemCreate,
  type InventoryItemUpdate,
  type PurchaseItem,
} from "@/lib/types";
import { CATEGORY_LABEL, statusChipClass } from "@/components/inventory/inventory-ui";
import { normalizeSharedWith, WHOLE_LAB_SENTINEL } from "@/lib/sharing/unified";
import { buildSupplies, type Supply } from "@/lib/supplies/supply-model";
import { seedFromSupply } from "@/lib/supplies/reorder";
import ItemFormDialog from "@/components/inventory/ItemFormDialog";
import ScanFlow from "@/components/inventory/ScanFlow";
import ImportInventoryDialog from "@/components/inventory/ImportInventoryDialog";
import SupplyDetailPanel from "@/components/supplies/SupplyDetailPanel";
import { useSuppliesBeakerSource } from "./useSuppliesBeakerSource";
import type { SupplyFilter } from "./supplies-beaker-source";
import {
  ReorderCartProvider,
  useReorderCart,
} from "@/components/supplies/ReorderCartContext";
import ReorderCartReview from "@/components/supplies/ReorderCartReview";
import OrdersApprovalsLens, {
  isPendingApproval,
  type LabPurchaseItem,
} from "@/components/supplies/OrdersApprovalsLens";
import LabInventoryLens from "@/components/supplies/LabInventoryLens";
import SpendingDashboard from "@/components/SpendingDashboard";
import FundingAccountsManager from "@/components/FundingAccountsManager";
import { buildPurchaseAuditCsv } from "@/lib/purchases/audit-export";

// "awaiting_approval" is the lab-head-only "Orders & approvals" lens (decision
// 4.2): an order-grouped queue, NOT a per-supply view. Members never see it. The
// SupplyFilter union is owned by the BeakerSearch source (chunk 6, imported at
// the top) so the page + palette share one definition.

/** Days until an ISO date, UTC-day based (matches the inventory date handling). */
function daysUntil(iso: string): number {
  const exp = new Date(iso);
  if (Number.isNaN(exp.getTime())) return Number.POSITIVE_INFINITY;
  const expDay = Date.UTC(exp.getUTCFullYear(), exp.getUTCMonth(), exp.getUTCDate());
  const now = new Date();
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((expDay - nowDay) / 86_400_000);
}

const EXPIRING_WINDOW_DAYS = 30;

/** A supply "needs attention" when its on-hand is low/empty/expired or its
 *  soonest expiry is within the window (including already expired). */
function needsAttention(s: Supply): boolean {
  if (!s.onHand) return false;
  if (s.onHand.worstStatus === "low" || s.onHand.worstStatus === "empty" || s.onHand.worstStatus === "expired") {
    return true;
  }
  return s.onHand.soonestExpiry != null && daysUntil(s.onHand.soonestExpiry) <= EXPIRING_WINDOW_DAYS;
}

/** Low or out of stock, the case where a quick reorder affordance helps most. */
function isLowOrOut(s: Supply): boolean {
  return s.onHand != null && (s.onHand.worstStatus === "low" || s.onHand.worstStatus === "empty");
}

function categoryLabel(cat: string | null): string {
  if (!cat) return "";
  return (CATEGORY_LABEL as Record<string, string>)[cat] ?? cat;
}

function metaLine(s: Supply): string {
  const parts = [categoryLabel(s.identity.category), s.identity.vendor, s.identity.catalogNumber];
  return parts.filter((p) => p && String(p).trim()).join(" · ");
}

/** Whole-lab-edit sharing carries over from inventory. Mirrors SupplyDetailPanel
 *  / useSuppliesBeakerSource (each restated locally rather than threaded). */
function canEditInventoryItem(item: InventoryItem, currentUser: string | null): boolean {
  if (!currentUser) return false;
  if (item.owner === currentUser) return true;
  return normalizeSharedWith(item.shared_with).some(
    (sh) =>
      (sh.username === currentUser || sh.username === WHOLE_LAB_SENTINEL) &&
      sh.level === "edit",
  );
}

/** Owner to route an item write into (the owner's folder for a shared-into-me
 *  record, else the cheap current-user path). Mirrors /inventory. */
function effectiveOwnerOf(item: InventoryItem, currentUser: string | null): string | undefined {
  return item.is_shared_with_me && item.owner !== currentUser ? item.owner : undefined;
}

/** Read the owner the loader decorated onto a purchase line (supply-model types
 *  openLines as plain PurchaseItem[], but they come from listAllIncludingShared,
 *  which decorates owner). Falls back to the current user for an own line. */
function ownerOfLine(line: PurchaseItem, currentUser: string | null): string {
  return (line as PurchaseItem & { owner?: string }).owner ?? currentUser ?? "";
}

export default function SuppliesPage() {
  return (
    <ReorderCartProvider>
      <SuppliesPageInner />
    </ReorderCartProvider>
  );
}

function SuppliesPageInner() {
  const { currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const cart = useReorderCart();
  const isLabHead = useIsLabHead(currentUser ?? null) === true;
  const piMenu = usePiRecordMenu();
  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);
  const searchParams = useSearchParams();
  // Deep-link seed (chunk 7): /supplies?filter=all|attention|onorder seeds the
  // filter chip on load so the retired /inventory + /purchases routes can map
  // their legacy params (?signal=, ?stage=) into the unified surface. Read once
  // via the lazy initializer; thereafter the chips own the state. The lab-head
  // "awaiting_approval" lens is intentionally not a seedable target (it is not
  // a redirect destination and is role-gated).
  const [filter, setFilter] = useState<SupplyFilter>(() => {
    const f = searchParams.get("filter");
    return f === "attention" || f === "onorder" || f === "all" ? f : "all";
  });
  // RS-4: a PI in the lab lens lands on the "Orders & approvals" lens by default,
  // so reviewing the lab's pending orders is the first thing they see. Applied
  // once when the lab lens resolves, and never when an explicit ?filter= deep-link
  // is present (that wins) or after the PI picks another chip themselves.
  const { mode: piViewMode } = usePiViewMode();
  const labLens = isLabHead && piViewMode === "lab";
  const appliedApprovalsDefault = useRef(false);
  useEffect(() => {
    if (!labLens || appliedApprovalsDefault.current) return;
    appliedApprovalsDefault.current = true;
    if (!searchParams.get("filter")) setFilter("awaiting_approval");
  }, [labLens, searchParams]);
  const [query, setQuery] = useState("");
  // Deep-link (chunk 6 + global-index): /supplies?supply={identityKey} opens that
  // supply's detail. Read once via the lazy initializer so a click from global
  // search lands on the right row without a setState-in-effect cascade. The key
  // is URL-encoded (it may contain ":" / "|"); the router decodes it on read.
  const [selectedKey, setSelectedKey] = useState<string | null>(
    () => searchParams.get("supply"),
  );
  const [cartOpen, setCartOpen] = useState(false);
  // Add-item / scan / import surfaces (chunk 6): the BeakerSearch source + the
  // right-click menu drive these, mirroring /inventory's own affordances so the
  // unified page is self-sufficient (no bounce to /inventory).
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  // A barcode the scanner hands off to a fresh Add-item form (scan -> create).
  const [addBarcode, setAddBarcode] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Lab-head drawers (decision 4.5): spending is a drawer, not permanent page
  // height; the funding-budget cards live in the Manage Funding popup. Members
  // see neither (they cannot act on budgets).
  const [spendingOpen, setSpendingOpen] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);

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
  const purchasesQuery = useQuery({
    queryKey: ["purchases-all", currentUser],
    queryFn: () => purchasesApi.listAllIncludingShared(currentUser ?? ""),
    enabled: INVENTORY_ENABLED && !!currentUser,
  });
  const nodesQuery = useQuery({
    queryKey: ["inventory-nodes", currentUser],
    queryFn: fetchAllStorageNodesIncludingShared,
    enabled: INVENTORY_ENABLED && !!currentUser,
  });

  // Lab-head-only data. The approval lens reads the lab-wide purchase items +
  // task names; the spending drawer reuses SpendingDashboard's existing inputs.
  // All gated on isLabHead so a member never pays for the discovery walk and
  // never sees the lab-wide queue. Share the canonical ["lab","purchase-items"]
  // key with /purchases + Lab Overview so React Query dedupes the fetch.
  const labPurchaseItemsQuery = useQuery({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    enabled: INVENTORY_ENABLED && isLabHead,
  });
  const labTasksQuery = useQuery({
    queryKey: ["lab", "tasks"],
    queryFn: () => labApi.getTasks(),
    enabled: INVENTORY_ENABLED && isLabHead,
  });
  const projectsQuery = useQuery({
    queryKey: ["projects", currentUser, { includeHidden: true }],
    queryFn: () => fetchAllProjectsIncludingShared({ includeHidden: true }),
    enabled: INVENTORY_ENABLED && isLabHead,
  });
  const allTasksQuery = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasksIncludingShared,
    enabled: INVENTORY_ENABLED && isLabHead,
  });
  const fundingAccountsQuery = useQuery({
    queryKey: ["funding-accounts", currentUser],
    queryFn: purchasesApi.listFundingAccounts,
    enabled: INVENTORY_ENABLED && isLabHead,
  });
  // RS-4: lab-wide inventory (every member's items) for the PI's lab inventory
  // browse. Lab-head only, like the other lab-wide reads above.
  const labInventoryQuery = useQuery({
    queryKey: ["lab", "inventory-items-full"],
    queryFn: () => labApi.getInventoryItemsFull(),
    enabled: INVENTORY_ENABLED && isLabHead,
  });

  // By-grant audit CSV (PURCHASE_DOCS_AND_ROUTING.md). Moved here from the
  // retired /purchases page (which redirects into /supplies), so the export is
  // actually reachable. Downloads every purchase grouped by grant with its
  // attached-document references.
  const handleExportAudit = () => {
    const csv = buildPurchaseAuditCsv(
      purchasesQuery.data ?? [],
      fundingAccountsQuery.data ?? [],
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "researchos-purchases-audit.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const labPurchaseItems = useMemo(
    () => (labPurchaseItemsQuery.data ?? []) as LabPurchaseItem[],
    [labPurchaseItemsQuery.data],
  );
  const pendingApprovalCount = useMemo(
    () => labPurchaseItems.filter(isPendingApproval).length,
    [labPurchaseItems],
  );

  // The tiny inline spending summary (decision 4.5: keep a cheap "$total"
  // line, no charts on the main page). Lab-head only; the full breakdown lives
  // in the drawer.
  const purchasesTotal = useMemo(
    () =>
      (purchasesQuery.data ?? []).reduce(
        (sum, p) => sum + (p.total_price ?? 0),
        0,
      ),
    [purchasesQuery.data],
  );

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const itemsById = useMemo(() => {
    const m = new Map<number, InventoryItem>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const supplies = useMemo(
    () =>
      buildSupplies({
        items,
        stocks: stocksQuery.data ?? [],
        purchases: purchasesQuery.data ?? [],
      }),
    [items, stocksQuery.data, purchasesQuery.data],
  );

  const counts = useMemo(() => {
    let attention = 0;
    let onorder = 0;
    for (const s of supplies) {
      if (needsAttention(s)) attention += 1;
      if (s.ordering) onorder += 1;
    }
    return { all: supplies.length, attention, onorder };
  }, [supplies]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return supplies
      .filter((s) => {
        if (filter === "attention" && !needsAttention(s)) return false;
        if (filter === "onorder" && !s.ordering) return false;
        if (q) {
          const hay = [
            s.identity.name,
            s.identity.vendor,
            s.identity.catalogNumber,
            s.identity.cas,
            categoryLabel(s.identity.category),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Attention first, then on-order, then alphabetical.
        const aa = needsAttention(a) ? 0 : a.ordering ? 1 : 2;
        const ba = needsAttention(b) ? 0 : b.ordering ? 1 : 2;
        if (aa !== ba) return aa - ba;
        return a.identity.name.localeCompare(b.identity.name);
      });
  }, [supplies, filter, query]);

  const addToCart = (s: Supply) => {
    const backing = s.onHand ? itemsById.get(s.onHand.itemIds[0]) ?? null : null;
    cart.add(s.key, seedFromSupply(s, backing));
  };

  // Add-item form support (chunk 6). vendorOptions feeds the form's datalist;
  // ownItems is the merge-don't-duplicate target for the spreadsheet import
  // (import always writes into the current user's dir).
  const vendorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) if (it.vendor) set.add(it.vendor);
    return [...set].sort();
  }, [items]);
  const ownItems = useMemo(() => items.filter((it) => !it.is_shared_with_me), [items]);

  const refreshInventory = () => {
    void queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
    void queryClient.invalidateQueries({ queryKey: ["inventory-stocks"] });
  };

  const submitItem = async (data: InventoryItemCreate | InventoryItemUpdate) => {
    if (editItem) {
      await inventoryItemsApi.update(
        editItem.id,
        data as InventoryItemUpdate,
        effectiveOwnerOf(editItem, currentUser ?? null),
      );
    } else {
      await inventoryItemsApi.create(data as InventoryItemCreate);
    }
    closeItemForm();
    refreshInventory();
  };

  const openAddItem = (barcode?: string | null) => {
    setEditItem(null);
    setAddBarcode(barcode ?? null);
    setItemDialogOpen(true);
  };

  const closeItemForm = () => {
    setItemDialogOpen(false);
    setEditItem(null);
    setAddBarcode(null);
  };

  // The right-click menu record for a Supply (chunk 6). owner / id resolve to the
  // backing inventory item (its audit history), falling back to the first open
  // line for an order-only supply. linkedPurchase carries the first open line
  // (preferring a still-pending one) so the lab-head approve / decline / flag
  // rows act on it; null for an on-hand-only supply (no PI layer).
  const buildSupplyMenuRecord = (s: Supply) => {
    const backing = s.onHand ? itemsById.get(s.onHand.itemIds[0]) ?? null : null;
    const firstLine =
      s.ordering?.openLines.find((p) => isPurchasePending(p)) ??
      s.ordering?.openLines[0] ??
      null;
    const owner = backing
      ? backing.owner
      : firstLine
        ? ownerOfLine(firstLine, currentUser ?? null)
        : currentUser ?? "";
    const id = backing ? backing.id : firstLine ? firstLine.id : 0;
    return {
      owner,
      id,
      flagged: false,
      canEdit: backing ? canEditInventoryItem(backing, currentUser ?? null) : false,
      linkedPurchase: firstLine
        ? {
            owner: ownerOfLine(firstLine, currentUser ?? null),
            id: firstLine.id,
            approved: !!firstLine.approved,
            flagged: !!firstLine.flagged,
          }
        : null,
    };
  };

  const openSupplyContextMenu = (event: React.MouseEvent, s: Supply) => {
    const backing = s.onHand ? itemsById.get(s.onHand.itemIds[0]) ?? null : null;
    piMenu.handleContextMenu(event, {
      recordType: "inventory_item",
      record: buildSupplyMenuRecord(s),
      onEditAsPi: () => setSelectedKey(s.key),
      onReorder: cart.has(s.key) ? undefined : () => addToCart(s),
      onEditItem: backing ? () => setEditItem(backing) : undefined,
      onSetStatus: () => setSelectedKey(s.key),
    });
  };

  // Register the Supplies BeakerSearch source (chunk 6) while the page is mounted.
  // The pure builder + the thin wiring live in supplies-beaker-source.ts /
  // useSuppliesBeakerSource.ts; this hands it the page-owned UI state + the
  // create / scan / import / spending openers + the reorder-to-cart action.
  useSuppliesBeakerSource({
    supplies,
    visible,
    counts,
    items,
    stocks: stocksQuery.data ?? [],
    pendingApprovalCount,
    categoryLabelOf: categoryLabel,
    filter,
    setFilter,
    selectedKey,
    setSelectedKey,
    isInCart: (key) => cart.has(key),
    reorderSupply: addToCart,
    openAddItem,
    openScan: () => setScanOpen(true),
    openImport: () => setImportOpen(true),
    openSpending: () => setSpendingOpen(true),
  });

  // editItem opening the form is a single effect-free derived intent; keep the
  // dialog open whenever an item is staged for edit.
  const itemFormOpen = itemDialogOpen || editItem != null;

  if (!INVENTORY_ENABLED) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md py-20 text-center">
          <h2 className="text-heading font-semibold text-foreground">Supplies is not enabled</h2>
          <p className="mt-2 text-body text-foreground-muted">Check back soon.</p>
        </div>
      </AppShell>
    );
  }

  const isLoading =
    itemsQuery.isLoading ||
    stocksQuery.isLoading ||
    purchasesQuery.isLoading ||
    nodesQuery.isLoading;

  const labInventoryItems = labInventoryQuery.data ?? [];
  const chips: { key: SupplyFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "attention", label: "Needs attention", count: counts.attention },
    { key: "onorder", label: "On order", count: counts.onorder },
    // Lab-head-only: the order-grouped approval queue + the lab-wide inventory
    // browse. Members never see either.
    ...(isLabHead
      ? [
          {
            key: "awaiting_approval" as const,
            label: "Awaiting approval",
            count: pendingApprovalCount,
          },
          {
            key: "lab_inventory" as const,
            label: "Lab inventory",
            count: labInventoryItems.length,
          },
        ]
      : []),
  ];

  // Defend against a stale filter if the role read flips to member after a
  // lens chip was selected (e.g. a user switch). Fall back to the per-supply
  // default so a member can never land in a lab-head lens.
  const activeFilter: SupplyFilter =
    (filter === "awaiting_approval" || filter === "lab_inventory") && !isLabHead
      ? "all"
      : filter;
  const showApprovalLens = activeFilter === "awaiting_approval";
  const showLabInventoryLens = activeFilter === "lab_inventory";

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        {/* Hub header */}
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-sunken text-foreground-muted">
            <Icon name="box" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h1 className="text-title font-semibold text-foreground">Supplies</h1>
            <p className="text-meta text-foreground-muted">
              What you have and what you have on order, in one place.
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {/* Lab-head spending lives in a drawer, not inline (decision 4.5).
                Members do not see these (they cannot act on budgets). */}
            {isLabHead ? (
              <>
                <Tooltip label="Funding accounts and budgets">
                  <button
                    type="button"
                    onClick={() => setFundingOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-meta font-medium text-foreground hover:bg-surface-sunken"
                    data-testid="supplies-manage-funding"
                  >
                    <Icon name="folder" className="h-3.5 w-3.5" />
                    Manage funding
                  </button>
                </Tooltip>
                <Tooltip label="Open the spending dashboard">
                  <button
                    type="button"
                    onClick={() => setSpendingOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-meta font-medium text-foreground hover:bg-surface-sunken"
                    data-testid="supplies-view-spending"
                  >
                    <Icon name="eye" className="h-3.5 w-3.5" />
                    View spending
                  </button>
                </Tooltip>
                <Tooltip label="Download a CSV of all purchases grouped by grant, with their attached documents, for a grant audit">
                  <button
                    type="button"
                    onClick={handleExportAudit}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-meta font-medium text-foreground hover:bg-surface-sunken"
                    data-testid="supplies-export-audit"
                  >
                    <Icon name="download" className="h-3.5 w-3.5" />
                    Export audit CSV
                  </button>
                </Tooltip>
              </>
            ) : null}
            {cart.count > 0 ? (
              <button
                type="button"
                onClick={() => setCartOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-action/40 bg-brand-action/10 px-3 py-1.5 text-meta font-medium text-brand-action hover:bg-brand-action/15"
                data-testid="reorder-cart-chip"
              >
                <Icon name="refresh" className="h-3.5 w-3.5" />
                Reorder cart ({cart.count})
              </button>
            ) : null}
          </div>
        </div>

        {/* Tiny inline spend summary (decision 4.5). Lab-head only; the charts
            live in the drawer. */}
        {isLabHead ? (
          <p className="mb-3 text-meta text-foreground-muted" data-testid="supplies-spend-summary">
            ${purchasesTotal.toFixed(2)} total in purchases
          </p>
        ) : null}

        {/* Filters */}
        <nav
          className="mb-3 inline-flex gap-1 rounded-xl border border-border bg-surface-sunken p-1"
          aria-label="Supplies filters"
          role="tablist"
        >
          {chips.map((c) => {
            const active = filter === c.key;
            return (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(c.key)}
                className={`rounded-lg px-3.5 py-1.5 text-body font-medium transition-colors ${
                  active
                    ? "bg-surface-raised text-foreground shadow-sm"
                    : "text-foreground-muted hover:text-foreground hover:bg-surface-raised/60"
                }`}
              >
                {c.label} <span className="text-foreground-muted">{c.count}</span>
              </button>
            );
          })}
        </nav>

        {/* Search. Hidden in the approval lens, which is order-grouped and has
            its own queue, not the per-supply search index. */}
        {!showApprovalLens ? (
          <div className="mb-4 flex max-w-md items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2">
            <Icon name="search" className="h-4 w-4 text-foreground-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search supplies by name, vendor, catalog, CAS"
              className="w-full bg-transparent text-body text-foreground outline-none placeholder:text-foreground-muted"
            />
          </div>
        ) : null}

        {/* Lab-head "Orders & approvals" lens (decision 4.2): the pending queue
            grouped order-by-order, reusing the existing approval machinery. */}
        {showApprovalLens ? (
          labPurchaseItemsQuery.isLoading || labTasksQuery.isLoading ? (
            <p className="py-12 text-center text-body text-foreground-muted">
              Loading the approval queue&hellip;
            </p>
          ) : (
            <OrdersApprovalsLens
              items={labPurchaseItems}
              tasks={labTasksQuery.data ?? []}
              actor={currentUser ?? ""}
              onChanged={() => {
                void labPurchaseItemsQuery.refetch();
              }}
            />
          )
        ) : showLabInventoryLens ? (
          labInventoryQuery.isLoading ? (
            <p className="py-12 text-center text-body text-foreground-muted">
              Loading lab inventory&hellip;
            </p>
          ) : (
            <LabInventoryLens items={labInventoryItems} query={query} />
          )
        ) : isLoading ? (
          <p className="py-12 text-center text-body text-foreground-muted">Loading supplies&hellip;</p>
        ) : visible.length === 0 ? (
          <p className="py-12 text-center text-body text-foreground-muted">
            {supplies.length === 0
              ? "No supplies yet. Add inventory or a purchase to get started."
              : "No supplies match this filter."}
          </p>
        ) : (
          <ul className="space-y-2">
            {visible.map((s) => {
              const showQuickReorder = isLowOrOut(s);
              const inCart = cart.has(s.key);
              return (
                <li
                  key={s.key}
                  className="relative"
                  data-beaker-target={`supply:${s.key}`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedKey(s.key)}
                    onContextMenu={(e) => openSupplyContextMenu(e, s)}
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3 text-left transition-colors hover:border-brand-action/40 hover:bg-surface-sunken/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body font-semibold text-foreground">
                        {s.identity.name}
                      </div>
                      {metaLine(s) ? (
                        <div className="truncate text-meta text-foreground-muted">{metaLine(s)}</div>
                      ) : null}
                    </div>
                    <div className="flex flex-none items-center gap-2">
                      {s.onHand ? <OnHandBadge supply={s} /> : null}
                      {s.ordering ? <OnOrderBadge supply={s} /> : null}
                      {!s.onHand && !s.ordering ? (
                        <span className="text-meta text-foreground-muted">no stock or orders</span>
                      ) : null}
                      {/* Spacer so the absolutely-positioned quick reorder does
                          not overlap the badges. */}
                      {showQuickReorder ? <span className="w-[5.5rem]" aria-hidden /> : null}
                    </div>
                  </button>
                  {showQuickReorder ? (
                    inCart ? (
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-lg border border-brand-action/40 bg-brand-action/10 px-2 py-1 text-meta font-medium text-brand-action">
                        <Icon name="check" className="h-3.5 w-3.5" />
                        In cart
                      </span>
                    ) : (
                      <Tooltip label="Add to the reorder cart">
                        <button
                          type="button"
                          onClick={() => addToCart(s)}
                          aria-label={`Reorder ${s.identity.name}`}
                          className="absolute right-4 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-lg border border-border bg-surface-raised px-2 py-1 text-meta font-medium text-foreground hover:bg-surface-sunken"
                        >
                          <Icon name="refresh" className="h-3.5 w-3.5" />
                          Reorder
                        </button>
                      </Tooltip>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {selectedKey != null
          ? (() => {
              const sel = supplies.find((s) => s.key === selectedKey);
              if (!sel) return null;
              return (
                <SupplyDetailPanel
                  supply={sel}
                  stocks={stocksQuery.data ?? []}
                  items={items}
                  nodes={nodesQuery.data ?? []}
                  currentUser={currentUser ?? null}
                  onClose={() => setSelectedKey(null)}
                />
              );
            })()
          : null}

        {cartOpen ? <ReorderCartReview onClose={() => setCartOpen(false)} /> : null}

        {/* Lab-head spending drawer (decision 4.5). SpendingDashboard is reused
            as-is inside a wide LivingPopup so the charts never spend permanent
            height on the member's main list. */}
        {isLabHead ? (
          <LivingPopup
            open={spendingOpen}
            onClose={() => setSpendingOpen(false)}
            label="Spending"
            widthClassName="max-w-4xl"
            card={false}
          >
            <SpendingDashboard
              purchaseItems={purchasesQuery.data ?? []}
              tasks={allTasksQuery.data ?? []}
              projects={projectsQuery.data ?? []}
              fundingAccounts={fundingAccountsQuery.data ?? []}
              selectedProjectIds={selectedProjectIds}
            />
          </LivingPopup>
        ) : null}

        {/* Manage Funding popup (decision 4.5): the funding-budget cards live
            here, not in the main scroll. Reuses the canonical editor. */}
        {isLabHead ? (
          <LivingPopup
            open={fundingOpen}
            onClose={() => setFundingOpen(false)}
            label="Funding accounts"
            widthClassName="max-w-2xl"
            card={false}
          >
            <FundingAccountsManager fundingAccounts={fundingAccountsQuery.data ?? []} />
          </LivingPopup>
        ) : null}

        {/* Add / edit item (chunk 6): reuses /inventory's ItemFormDialog so the
            "Add supply" palette command + the right-click "Edit item" land here
            without bouncing to /inventory. */}
        <LivingPopup
          open={itemFormOpen}
          onClose={closeItemForm}
          label={editItem ? "Edit item" : "Add item"}
          widthClassName="max-w-2xl"
          card
          closeOnScrimClick={false}
          fillHeight
        >
          {itemFormOpen && (
            <div className="overflow-y-auto">
              <ItemFormDialog
                item={editItem}
                vendorOptions={vendorOptions}
                initialBarcode={editItem ? null : addBarcode}
                onCancel={closeItemForm}
                onSubmit={submitItem}
              />
            </div>
          )}
        </LivingPopup>

        {/* Spreadsheet import (chunk 6), reusing /inventory's dialog. */}
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
                  refreshInventory();
                }}
              />
            </div>
          )}
        </LivingPopup>

        {/* Barcode scan (chunk 6), reusing /inventory's ScanFlow. */}
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
              stocks={stocksQuery.data ?? []}
              currentUser={currentUser}
              onRefresh={refreshInventory}
              onClose={() => setScanOpen(false)}
              onCreateItemWithCode={(code) => {
                setScanOpen(false);
                openAddItem(code);
              }}
            />
          )}
        </LivingPopup>

        {/* The right-click PI menu's Assign modal + read-only audit viewer live
            here so a supply row's context menu has a home (chunk 6). */}
        {piMenu.modals}
      </div>
    </AppShell>
  );
}

function OnHandBadge({ supply }: { supply: Supply }) {
  const oh = supply.onHand!;
  // Expiry takes the badge when it is the salient signal.
  if (oh.soonestExpiry != null) {
    const d = daysUntil(oh.soonestExpiry);
    if (d <= EXPIRING_WINDOW_DAYS) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-meta font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          <Icon name="alarmClock" className="h-3.5 w-3.5" />
          {d < 0 ? "expired" : d === 0 ? "expires today" : `expires ${d}d`}
        </span>
      );
    }
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-medium ${statusChipClass(oh.worstStatus)}`}>
      {oh.totalCount} on hand
    </span>
  );
}

function OnOrderBadge({ supply }: { supply: Supply }) {
  const o = supply.ordering!;
  const label = o.needsOrderingCount > 0 ? "needs ordering" : "ordered";
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-meta font-medium text-sky-700 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-300">
      <Icon name="box" className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
