"use client";

// PI-Mode Funding page (FU-1, FU-2, Grant approved 2026-06-13).
//
// Elevates the lab's funding accounts (grants) into a first-class PI surface:
// every grant's spend versus its budget, rolled up LAB-WIDE across all members'
// purchases. Funding accounts are lab-shared (one set for the whole lab,
// JsonStore("funding_accounts","lab")), and spend is DERIVED live from purchase
// line items via the pure helpers in lib/funding/spend (the on-disk spent/remaining
// fields are gone), so this is a read-only rollup with no new data shape.
//
// Reuses: purchasesApi.listFundingAccounts (the shared accounts), labApi
// .getAllPurchaseItems (lab-wide items), computeFundingSpendByAccount /
// computeUncategorizedSpend (the spend rollup), and FundingAccountsManager (the
// existing grant editor) for managing the accounts.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsLabHead } from "@/hooks/useIsLabHead";
import { purchasesApi, labApi } from "@/lib/local-api";
import {
  computeFundingSpendByAccount,
  computeUncategorizedSpend,
} from "@/lib/funding/spend";
import FundingAccountsManager from "@/components/FundingAccountsManager";
import { Icon } from "@/components/icons";

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function LabFundingPage() {
  const { currentUser } = useCurrentUser();
  const isLabHead = useIsLabHead(currentUser);

  const { data: accounts = [] } = useQuery({
    queryKey: ["funding-accounts-lab"],
    queryFn: purchasesApi.listFundingAccounts,
  });
  // Lab-wide purchase items (every member's). Shares the Approvals cache key.
  const { data: items = [] } = useQuery({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
  });

  const spendByAccount = useMemo(
    () => computeFundingSpendByAccount(accounts, items),
    [accounts, items],
  );
  const uncategorized = useMemo(
    () => computeUncategorizedSpend(accounts, items),
    [accounts, items],
  );

  const totalBudget = useMemo(
    () => accounts.reduce((s, a) => s + (a.total_budget ?? 0), 0),
    [accounts],
  );
  const totalSpent = useMemo(() => {
    let s = uncategorized;
    for (const v of spendByAccount.values()) s += v;
    return s;
  }, [spendByAccount, uncategorized]);

  if (isLabHead === false) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-meta text-foreground-muted">
          Funding is the lab head&apos;s view of the lab&apos;s grants. Sign in as
          the PI to see spend against budget.
        </p>
      </div>
    );
  }

  // Sorted: over-budget first, then by how full the budget is, so the grants that
  // need attention sit at the top.
  const sorted = [...accounts].sort((a, b) => {
    const sa = spendByAccount.get(a.id) ?? 0;
    const sb = spendByAccount.get(b.id) ?? 0;
    const fa = a.total_budget > 0 ? sa / a.total_budget : sa > 0 ? Infinity : 0;
    const fb = b.total_budget > 0 ? sb / b.total_budget : sb > 0 ? Infinity : 0;
    return fb - fa;
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-5 space-y-1">
        <h1 className="flex items-center gap-2 text-title font-semibold text-foreground">
          <Icon name="gauge" className="h-5 w-5" />
          Funding
        </h1>
        <p className="text-meta text-foreground-muted leading-relaxed">
          Every grant&apos;s spend against its budget, totalled across your whole
          lab. Spend is computed live from purchase line items, so it always
          matches what was actually ordered.
        </p>
      </div>

      {/* Lab totals strip. */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-meta uppercase tracking-wide text-foreground-muted">
            Total budget
          </p>
          <p className="text-body font-semibold text-foreground">
            {usd(totalBudget)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-meta uppercase tracking-wide text-foreground-muted">
            Spent
          </p>
          <p className="text-body font-semibold text-foreground">
            {usd(totalSpent)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-meta uppercase tracking-wide text-foreground-muted">
            Remaining
          </p>
          <p
            className={`text-body font-semibold ${
              totalBudget - totalSpent < 0
                ? "text-rose-600 dark:text-rose-400"
                : "text-foreground"
            }`}
          >
            {usd(totalBudget - totalSpent)}
          </p>
        </div>
      </div>

      {/* Per-grant spend-vs-budget (FU-2). */}
      {accounts.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-meta text-foreground-muted">
          No funding accounts yet. Add a grant below to track spend against its
          budget.
        </p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((acc) => {
            const spent = spendByAccount.get(acc.id) ?? 0;
            const pct =
              acc.total_budget > 0
                ? Math.min(100, (spent / acc.total_budget) * 100)
                : 0;
            const over = acc.total_budget > 0 && spent > acc.total_budget;
            const meta = [acc.funder_name, acc.award_number]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={acc.id}
                className="rounded-xl border border-border bg-surface px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-body font-medium text-foreground">
                    {acc.name}
                  </span>
                  <span className="text-meta text-foreground-muted">
                    {usd(spent)} / {usd(acc.total_budget)}
                    {over && (
                      <span className="ml-1 font-semibold text-rose-600 dark:text-rose-400">
                        over budget
                      </span>
                    )}
                  </span>
                </div>
                {meta && (
                  <p className="mt-0.5 text-meta text-foreground-muted">{meta}</p>
                )}
                <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken ring-1 ring-inset ring-border">
                  <div
                    className={`h-full rounded-full transition-all ${
                      over ? "bg-rose-500" : "bg-brand-action"
                    }`}
                    style={{ width: `${over ? 100 : pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {uncategorized > 0 && (
        <p className="mt-3 text-meta text-foreground-muted">
          {usd(uncategorized)} of lab spend is not linked to any grant. Set a
          funding account on those purchases to track it here.
        </p>
      )}

      {/* Manage grants (reuses the existing editor). */}
      <div className="mt-8 border-t border-border pt-6">
        <FundingAccountsManager fundingAccounts={accounts} />
      </div>
    </div>
  );
}
