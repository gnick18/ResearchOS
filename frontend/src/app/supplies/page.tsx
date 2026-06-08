"use client";

// /supplies (Supplies v2 unified page, SUPPLIES_V2_UNIFIED.md, chunk 2: the
// read list). One page where each row is a Supply, showing on-hand state (from
// Inventory) and on-order state (from Purchases) side by side, so identity
// lives once and the two daily questions (what do I have / what is on order)
// are answered in one list.
//
// Chunk 2 is READ-ONLY: the list, filters, and search. The two-section detail
// panel (chunk 3), reorder + cart (chunk 4), the lab-head lens + spending
// drawer (chunk 5), and palette/right-click parity (chunk 6) build on top. The
// whole route is gated behind INVENTORY_ENABLED; the old /inventory and
// /purchases pages keep working until chunk 7 redirects them here.
//
// House style: <Icon> only, brand + semantic dark-mode tokens, no emojis /
// em-dashes / mid-sentence colons.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import AppShell from "@/components/AppShell";
import { Icon } from "@/components/icons";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { INVENTORY_ENABLED } from "@/lib/inventory/config";
import {
  fetchAllInventoryItemsIncludingShared,
  fetchAllInventoryStocksIncludingShared,
  purchasesApi,
} from "@/lib/local-api";
import { CATEGORY_LABEL, statusChipClass } from "@/components/inventory/inventory-ui";
import { buildSupplies, type Supply } from "@/lib/supplies/supply-model";
import SupplyDetailPanel from "@/components/supplies/SupplyDetailPanel";

type SupplyFilter = "all" | "attention" | "onorder";

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

function categoryLabel(cat: string | null): string {
  if (!cat) return "";
  return (CATEGORY_LABEL as Record<string, string>)[cat] ?? cat;
}

function metaLine(s: Supply): string {
  const parts = [categoryLabel(s.identity.category), s.identity.vendor, s.identity.catalogNumber];
  return parts.filter((p) => p && String(p).trim()).join(" · ");
}

export default function SuppliesPage() {
  const { currentUser } = useCurrentUser();
  const [filter, setFilter] = useState<SupplyFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

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

  const supplies = useMemo(
    () =>
      buildSupplies({
        items: itemsQuery.data ?? [],
        stocks: stocksQuery.data ?? [],
        purchases: purchasesQuery.data ?? [],
      }),
    [itemsQuery.data, stocksQuery.data, purchasesQuery.data],
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

  const isLoading = itemsQuery.isLoading || stocksQuery.isLoading || purchasesQuery.isLoading;

  const chips: { key: SupplyFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "attention", label: "Needs attention", count: counts.attention },
    { key: "onorder", label: "On order", count: counts.onorder },
  ];

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        {/* Hub header */}
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-sunken text-foreground-muted">
            <Icon name="box" className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-title font-semibold text-foreground">Supplies</h1>
            <p className="text-meta text-foreground-muted">
              What you have and what you have on order, in one place.
            </p>
          </div>
        </div>

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

        {/* Search */}
        <div className="mb-4 flex max-w-md items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2">
          <Icon name="search" className="h-4 w-4 text-foreground-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search supplies by name, vendor, catalog, CAS"
            className="w-full bg-transparent text-body text-foreground outline-none placeholder:text-foreground-muted"
          />
        </div>

        {/* List */}
        {isLoading ? (
          <p className="py-12 text-center text-body text-foreground-muted">Loading supplies&hellip;</p>
        ) : visible.length === 0 ? (
          <p className="py-12 text-center text-body text-foreground-muted">
            {supplies.length === 0
              ? "No supplies yet. Add inventory or a purchase to get started."
              : "No supplies match this filter."}
          </p>
        ) : (
          <ul className="space-y-2">
            {visible.map((s) => (
              <li key={s.key}>
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
                </div>
              </button>
              </li>
            ))}
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
                  onClose={() => setSelectedKey(null)}
                />
              );
            })()
          : null}
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
