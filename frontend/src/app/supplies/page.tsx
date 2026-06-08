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

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import AppShell from "@/components/AppShell";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import LivingPopup from "@/components/ui/LivingPopup";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsLabHead } from "@/hooks/useIsLabHead";
import { useAppStore } from "@/lib/store";
import { INVENTORY_ENABLED } from "@/lib/inventory/config";
import {
  fetchAllInventoryItemsIncludingShared,
  fetchAllInventoryStocksIncludingShared,
  fetchAllStorageNodesIncludingShared,
  fetchAllProjectsIncludingShared,
  fetchAllTasksIncludingShared,
  labApi,
  purchasesApi,
} from "@/lib/local-api";
import type { InventoryItem } from "@/lib/types";
import { CATEGORY_LABEL, statusChipClass } from "@/components/inventory/inventory-ui";
import { buildSupplies, type Supply } from "@/lib/supplies/supply-model";
import { seedFromSupply } from "@/lib/supplies/reorder";
import SupplyDetailPanel from "@/components/supplies/SupplyDetailPanel";
import {
  ReorderCartProvider,
  useReorderCart,
} from "@/components/supplies/ReorderCartContext";
import ReorderCartReview from "@/components/supplies/ReorderCartReview";
import OrdersApprovalsLens, {
  isPendingApproval,
  type LabPurchaseItem,
} from "@/components/supplies/OrdersApprovalsLens";
import SpendingDashboard from "@/components/SpendingDashboard";
import FundingAccountsManager from "@/components/FundingAccountsManager";

// "awaiting_approval" is the lab-head-only "Orders & approvals" lens (decision
// 4.2): an order-grouped queue, NOT a per-supply view. Members never see it.
type SupplyFilter = "all" | "attention" | "onorder" | "awaiting_approval";

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

export default function SuppliesPage() {
  return (
    <ReorderCartProvider>
      <SuppliesPageInner />
    </ReorderCartProvider>
  );
}

function SuppliesPageInner() {
  const { currentUser } = useCurrentUser();
  const cart = useReorderCart();
  const isLabHead = useIsLabHead(currentUser ?? null) === true;
  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);
  const [filter, setFilter] = useState<SupplyFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
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

  const chips: { key: SupplyFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "attention", label: "Needs attention", count: counts.attention },
    { key: "onorder", label: "On order", count: counts.onorder },
    // Lab-head-only: the order-grouped approval queue. Members never see it.
    ...(isLabHead
      ? [
          {
            key: "awaiting_approval" as const,
            label: "Awaiting approval",
            count: pendingApprovalCount,
          },
        ]
      : []),
  ];

  // Defend against a stale filter if the role read flips to member after the
  // lens chip was selected (e.g. a user switch). Fall back to the per-supply
  // default so a member can never land in the lab-head lens.
  const activeFilter: SupplyFilter =
    filter === "awaiting_approval" && !isLabHead ? "all" : filter;
  const showApprovalLens = activeFilter === "awaiting_approval";

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
                <li key={s.key} className="relative">
                  <button
                    type="button"
                    onClick={() => setSelectedKey(s.key)}
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
