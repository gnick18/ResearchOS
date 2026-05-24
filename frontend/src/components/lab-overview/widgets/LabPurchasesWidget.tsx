"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { labApi, purchasesApi } from "@/lib/local-api";
import { useLabData } from "@/hooks/useLabData";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import UserAvatar from "@/components/UserAvatar";
import type {
  PurchaseItem,
  FundingAccount,
} from "@/lib/types";
import type { SnapshotTileProps } from "./types";

/**
 * Widget catalog cleanup (widget catalog cleanup manager, 2026-05-23):
 * canvas-surface, lab-head-only purchases overview. Replaces the
 * dedicated `/purchases` top-nav tab for lab heads (the route stays
 * alive for deep-links and members; AppShell hides the nav entry for
 * the lab_head account type).
 *
 * Three stacked sections:
 *   - Pending approvals: items where `approved` is false-y. Each row
 *     links to /purchases so the PI can open the editor (where the
 *     existing `PurchaseApprovalToggle` lives behind the edit-session
 *     gate). The widget doesn't inline-approve: the toggle in
 *     PurchaseEditor depends on `useEditSession()` which in turn
 *     requires the PI to unlock a session against a specific owner.
 *     Re-implementing that flow inside the widget would duplicate the
 *     session gate AND bypass the audit fan-out. Linking out keeps the
 *     existing PiActionResult plumbing intact.
 *   - Recent purchases: last 30 days, all members, sorted newest first
 *     using the parent task's start_date as the timestamp proxy (purchase
 *     items have no created_at on disk; same proxy the
 *     RecentActivityWidget + LabActivityWidget use).
 *   - Funding rollup: small per-account cards showing spent vs total
 *     budget. Disk-stored `spent` is stale (LabPurchasesPanel noted it
 *     was never recomputed), so we derive spent live from the same
 *     items list.
 *
 * Visibility: `memberVisible: false` in the registry. Defensive
 * accountType guard mirrors PiActionsWidget so a stale layout doesn't
 * render this for a demoted member.
 */
export default function LabPurchasesWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const { tasks, users } = useLabData();

  const { data: items = [], isLoading: itemsLoading } = useQuery<
    Array<PurchaseItem & { username: string }>
  >({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: accountType === "lab_head",
  });

  const { data: fundingAccounts = [] } = useQuery<FundingAccount[]>({
    queryKey: ["funding-accounts"],
    queryFn: purchasesApi.listFundingAccounts,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: accountType === "lab_head",
  });

  // Lookup parent task per item so we can derive an item timestamp
  // (purchase items have no created_at, so we use the parent task's
  // start_date). Keyed by `${username}:${task_id}` to disambiguate
  // namespaces.
  const taskByKey = useMemo(() => {
    const map = new Map<string, typeof tasks[number]>();
    for (const t of tasks) map.set(`${t.username}:${t.id}`, t);
    return map;
  }, [tasks]);

  const userColor = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users) map.set(u.username, u.color || "#6b7280");
    return map;
  }, [users]);

  const itemTimestamp = (it: PurchaseItem & { username: string }): string => {
    const parent = taskByKey.get(`${it.username}:${it.task_id}`);
    if (parent?.start_date) return `${parent.start_date}T00:00:00`;
    return "";
  };

  const pendingApprovals = useMemo(() => {
    return items
      .filter((it) => !it.approved)
      .sort((a, b) => itemTimestamp(b).localeCompare(itemTimestamp(a)));
    // taskByKey closure dependency satisfied via `tasks` reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, taskByKey]);

  const recentPurchases = useMemo(() => {
    const cutoff = isoDaysAgo(30);
    return items
      .map((it) => ({ it, ts: itemTimestamp(it) }))
      .filter(({ ts }) => ts && ts.slice(0, 10) >= cutoff)
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, 12)
      .map(({ it, ts }) => ({ it, ts }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, taskByKey]);

  // Derive live spend per funding account from items (disk-stored
  // `spent` is stale). The fallback "Uncategorized" bucket captures
  // items with no funding_string.
  const spentByAccountName = useMemo(() => {
    const totals = new Map<string, number>();
    for (const it of items) {
      const key = it.funding_string || "__uncategorized__";
      totals.set(key, (totals.get(key) ?? 0) + (it.total_price ?? 0));
    }
    return totals;
  }, [items]);

  if (accountType !== "lab_head") {
    return null;
  }

  const pendingTotal = pendingApprovals.reduce(
    (sum, it) => sum + (it.total_price ?? 0),
    0,
  );

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">
      {/* Pending approvals */}
      <section className="flex-shrink-0">
        <header className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-amber-600 flex-shrink-0" aria-hidden="true">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 9v2m0 4h.01" />
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              </svg>
            </span>
            <h3 className="text-sm font-semibold text-gray-900 truncate">
              Pending approvals
            </h3>
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 tabular-nums">
              {pendingApprovals.length}
            </span>
          </div>
          {pendingApprovals.length > 0 && (
            <span className="text-[11px] text-gray-500 tabular-nums flex-shrink-0">
              {formatCurrency(pendingTotal)}
            </span>
          )}
        </header>
        {itemsLoading ? (
          <div className="text-xs text-gray-500 italic px-1 py-2">
            Loading…
          </div>
        ) : pendingApprovals.length === 0 ? (
          <p className="text-xs text-gray-400 italic px-1 py-2">
            All caught up. No items awaiting approval.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden bg-white">
            {pendingApprovals.slice(0, 8).map((it) => (
              <li key={`${it.username}:${it.id}`}>
                <Link
                  href="/purchases"
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-amber-50/60 transition-colors min-w-0 group"
                  title="Open the purchases page to review + approve"
                >
                  <div className="flex-shrink-0">
                    <UserAvatar username={it.username} size="sm" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-900 truncate">
                      {it.item_name}
                    </p>
                    <p className="text-[10px] text-gray-500 truncate">
                      <span className="font-medium">{it.username}</span>
                      {it.funding_string && (
                        <>
                          <span className="text-gray-300 mx-1">·</span>
                          <span>{it.funding_string}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <span className="text-xs tabular-nums text-gray-700 flex-shrink-0">
                    {formatCurrency(it.total_price ?? 0)}
                  </span>
                  <span className="text-[10px] text-amber-700 font-medium flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    Approve in Purchases →
                  </span>
                </Link>
              </li>
            ))}
            {pendingApprovals.length > 8 && (
              <li className="text-center">
                <Link
                  href="/purchases"
                  className="block text-[11px] text-amber-700 hover:text-amber-900 py-1.5 font-medium"
                >
                  + {pendingApprovals.length - 8} more on /purchases →
                </Link>
              </li>
            )}
          </ul>
        )}
        <p className="text-[10px] text-gray-400 mt-1.5 italic px-1">
          Approve / reject from the purchase editor (requires unlocking an
          edit session against the owner).
        </p>
      </section>

      {/* Recent purchases */}
      <section className="flex-1 min-h-0 flex flex-col">
        <header className="flex items-center gap-2 mb-2 flex-shrink-0">
          <span className="text-blue-500 flex-shrink-0" aria-hidden="true">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
          </span>
          <h3 className="text-sm font-semibold text-gray-900 truncate">
            Recent purchases
          </h3>
          <span className="text-[10px] text-gray-500">last 30 days</span>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {recentPurchases.length === 0 ? (
            <p className="text-xs text-gray-400 italic px-1 py-2">
              No purchases logged in the last 30 days.
            </p>
          ) : (
            <ul className="space-y-1">
              {recentPurchases.map(({ it, ts }) => (
                <li key={`${it.username}:${it.id}`}>
                  <Link
                    href="/purchases"
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 min-w-0"
                  >
                    <span
                      className="w-1 h-7 rounded-sm flex-shrink-0"
                      style={{
                        backgroundColor: userColor.get(it.username) || "#6b7280",
                      }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-900 truncate">
                        <span className="font-medium">{it.item_name}</span>
                      </p>
                      <p className="text-[10px] text-gray-500 truncate">
                        <span className="font-medium">{it.username}</span>
                        <span className="text-gray-300 mx-1">·</span>
                        <span>{formatDay(ts)}</span>
                        {it.funding_string && (
                          <>
                            <span className="text-gray-300 mx-1">·</span>
                            <span>{it.funding_string}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <span className="text-[11px] tabular-nums text-gray-700 flex-shrink-0">
                      {formatCurrency(it.total_price ?? 0)}
                    </span>
                    {it.approved && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 flex-shrink-0"
                        title={
                          it.approved_by
                            ? `Approved by ${it.approved_by}`
                            : "Approved"
                        }
                      >
                        ok
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Funding rollup — mini cards only. Phase B Batch B1: the full
          per-member / per-category / per-account breakdown is the
          MetricsWidget's Funding tab; we link out rather than recompute
          to keep the two surfaces aligned. */}
      {fundingAccounts.length > 0 && (
        <section className="flex-shrink-0">
          <header className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-emerald-600 flex-shrink-0" aria-hidden="true">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </span>
              <h3 className="text-sm font-semibold text-gray-900 truncate">
                Funding
              </h3>
            </div>
            <span className="text-[10px] text-gray-500 italic flex-shrink-0">
              View full breakdown in Metrics widget
            </span>
          </header>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {fundingAccounts.map((acct) => {
              const spent = spentByAccountName.get(acct.name) ?? 0;
              const pct =
                acct.total_budget > 0
                  ? Math.min(100, Math.round((spent / acct.total_budget) * 100))
                  : 0;
              return (
                <div
                  key={acct.id}
                  className="border border-gray-200 rounded-lg p-2 bg-white min-w-0"
                >
                  <p className="text-[11px] font-medium text-gray-900 truncate">
                    {acct.name}
                  </p>
                  <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        pct >= 95
                          ? "bg-red-500"
                          : pct >= 80
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-500 tabular-nums mt-1 truncate">
                    {formatCurrency(spent)} / {formatCurrency(acct.total_budget)}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function formatCurrency(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  try {
    return n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: n >= 100 ? 0 : 2,
    });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatDay(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase B Batch B1 — unique SnapshotTile + SidebarTile (Phase B Batch
// B1 manager, 2026-05-23). The PI's most-urgent purchases signal is
// the pending-approval queue, so both tiles lead with that count. The
// snapshot tile uses the hero-number primitive (big amber count, value
// secondary); the sidebar tile is a single ultra-compact row.
// ─────────────────────────────────────────────────────────────────────
import HeroNumberTile from "./snapshot/HeroNumberTile";
import SidebarStatTile from "./snapshot/SidebarStatTile";
import type { SidebarTileProps } from "./types";

const PURCHASES_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

const PURCHASES_SIDEBAR_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

function formatCompactCurrencyPurchases(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (n >= 100_000) return `$${(n / 1000).toFixed(0)}k`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1_000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

export function SnapshotTile(_props: SnapshotTileProps) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const { data: items = [], isLoading } = useQuery<
    Array<PurchaseItem & { username: string }>
  >({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: accountType === "lab_head",
  });
  if (accountType !== "lab_head") return null;

  const pending = items.filter((it) => !it.approved);
  const pendingValue = pending.reduce((s, it) => s + (it.total_price ?? 0), 0);
  const hasPending = pending.length > 0;

  return (
    <HeroNumberTile
      icon={PURCHASES_ICON}
      label="Pending approvals"
      primary={isLoading ? "—" : pending.length}
      secondary={
        isLoading
          ? ""
          : hasPending
            ? (
              <span className="inline-flex items-center gap-1">
                <span className="tabular-nums">{formatCompactCurrencyPurchases(pendingValue)}</span>
                <span className="text-gray-400">awaiting review</span>
                <span aria-hidden="true" className="text-amber-600">→</span>
              </span>
            )
            : "All approved"
      }
      accent={hasPending ? "amber" : "calm"}
    />
  );
}

export const ExpandedView = LabPurchasesWidget;

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const { data: items = [], isLoading } = useQuery<
    Array<PurchaseItem & { username: string }>
  >({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: accountType === "lab_head",
  });
  if (accountType !== "lab_head") return null;

  const pending = items.filter((it) => !it.approved);
  const pendingValue = pending.reduce((s, it) => s + (it.total_price ?? 0), 0);
  const hasPending = pending.length > 0;

  // Brief: even more compact than the snapshot. Single row with a
  // clipboard-like icon + "Pending: N" + dollar amount in muted text
  // after. If N=0, render "No pending purchases" in gray.
  return (
    <SidebarStatTile
      icon={PURCHASES_SIDEBAR_ICON}
      iconClassName={hasPending ? "text-amber-600" : "text-gray-400"}
      label={hasPending ? "Pending" : "No pending purchases"}
      stat={
        isLoading
          ? "—"
          : hasPending
            ? (
              <span className="inline-flex items-baseline gap-1.5">
                <span>{pending.length}</span>
                <span className="text-[11px] text-gray-500 font-normal">
                  {formatCompactCurrencyPurchases(pendingValue)}
                </span>
              </span>
            )
            : ""
      }
      onClick={onClick}
    />
  );
}
