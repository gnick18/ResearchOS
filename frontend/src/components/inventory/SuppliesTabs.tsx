"use client";

// The Supplies hub header (Supplies hub, 2026-06-07). Inventory and Purchases
// are two tabs under one "Supplies" nav item, with a thin loop strip above the
// tabs that surfaces the at-a-glance counts that tie the two surfaces together,
// expiring soon and low-or-empty (from the inventory signals) plus to order
// (from the Purchases needs-ordering line items).
//
// This whole component is gated on INVENTORY_ENABLED at the call sites: it is
// mounted at the top of BOTH /inventory and /purchases only when the flag is
// on. With the flag off (prod default) it is never rendered, so Purchases keeps
// its standalone page and the nav is unchanged. As a second guard the component
// itself returns null when the flag is off, so an accidental future mount can
// never leak the hub chrome into prod.
//
// House style: <Icon> only (no inline svg, no new registry icon), Tooltip on
// icon-only affordances, brand + semantic dark-mode tokens, semantic typography,
// no emojis / em-dashes / mid-sentence colons. The loop strip themes in dark
// mode via the same amber / rose / brand token families the inventory health
// strip uses.

import Link from "@/components/FixtureLink";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { INVENTORY_ENABLED } from "@/lib/inventory/config";
import {
  fetchAllInventoryItemsIncludingShared,
  fetchAllInventoryStocksIncludingShared,
  purchasesApi,
} from "@/lib/local-api";
import { normalizeOrderStatus } from "@/lib/types";
import { computeInventorySignals } from "@/components/inventory/inventory-ui";

interface SuppliesTab {
  href: string;
  label: string;
}

const TABS: SuppliesTab[] = [
  { href: "/inventory", label: "Inventory" },
  { href: "/purchases", label: "Purchases" },
];

interface LoopStat {
  label: string;
  count: number;
  icon: IconName;
  /** Color classes for the count + icon (semantic, dark-mode aware). */
  tone: string;
}

export default function SuppliesTabs() {
  const pathname = usePathname();
  const { currentUser } = useCurrentUser();

  // Inventory items + stocks feed the expiring / low signals. These share the
  // exact query keys + fetchers the /inventory page uses, so React Query
  // dedupes the fetch when the user is already on /inventory.
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

  // Purchase line items feed the to-order count. Shares the same query key +
  // fetcher the /purchases page uses (["purchases-all", currentUser]) so the
  // fetch is deduped when the user is already on /purchases.
  const purchasesQuery = useQuery({
    queryKey: ["purchases-all", currentUser],
    queryFn: () => purchasesApi.listAllIncludingShared(currentUser ?? ""),
    enabled: INVENTORY_ENABLED && !!currentUser,
  });

  const signals = useMemo(
    () =>
      computeInventorySignals(
        itemsQuery.data ?? [],
        stocksQuery.data ?? [],
        new Date(),
      ),
    [itemsQuery.data, stocksQuery.data],
  );

  // To order: purchase line items whose ordering stage is "needs ordering".
  // Mirrors the /purchases needs-ordering chip semantics (order_status field),
  // normalized through the same helper the page uses for legacy rows.
  const toOrderCount = useMemo(() => {
    const items = purchasesQuery.data ?? [];
    let n = 0;
    for (const p of items) {
      if (normalizeOrderStatus(p.order_status) === "needs_ordering") n += 1;
    }
    return n;
  }, [purchasesQuery.data]);

  const stats: LoopStat[] = useMemo(
    () => [
      {
        label: "expiring soon",
        count: signals.expiring.length,
        icon: "alarmClock",
        tone: "text-amber-700 dark:text-amber-300",
      },
      {
        label: "low or empty",
        count: signals.low.length,
        icon: "dropletLow",
        tone: "text-rose-700 dark:text-rose-300",
      },
      {
        label: "to order",
        count: toOrderCount,
        icon: "box",
        tone: "text-brand-action",
      },
    ],
    [signals.expiring.length, signals.low.length, toOrderCount],
  );

  // Second guard (see file header): never render the hub chrome when the flag
  // is off, even if a caller mounts this by mistake.
  if (!INVENTORY_ENABLED) return null;

  return (
    <div className="mb-6">
      {/* Hub title + loop strip */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-sunken text-foreground-muted">
            <Icon name="box" className="h-4 w-4" />
          </span>
          <h1 className="text-title font-semibold text-foreground">Supplies</h1>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {stats.map((stat) => (
            <span
              key={stat.label}
              className="inline-flex items-center gap-1.5 text-meta text-foreground-muted"
            >
              <Icon name={stat.icon} className={`h-3.5 w-3.5 ${stat.tone}`} />
              <span className={`font-semibold ${stat.tone}`}>{stat.count}</span>
              <span>{stat.label}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <nav
        className="inline-flex gap-1 rounded-xl border border-border bg-surface-sunken p-1"
        aria-label="Supplies sections"
      >
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-lg px-4 py-1.5 text-body font-medium transition-colors ${
                active
                  ? "bg-surface-raised text-foreground shadow-sm"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface-raised/60"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
