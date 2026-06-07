"use client";

// Monthly-spend breakdown visual for /admin/business. A stacked bar of the
// estimated monthly provider cost, colored by category (each tagged with its
// vendor), plus a legend with dollar amounts. Estimated from live usage, not
// billed; the business ledger holds recorded actuals. Operator-only, talks to
// the admin-gated /api/admin/breaker route.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";

interface Category {
  label: string;
  vendor: string;
  cents: number;
  fixed: boolean;
  color: string;
}
interface Spend {
  categories: Category[];
  totalCents: number;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function SpendByCategoryPanel() {
  const [spend, setSpend] = useState<Spend | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/breaker");
      if (!res.ok) return;
      const data = (await res.json()) as { spend?: Spend };
      if (data.spend) setSpend(data.spend);
    } catch {
      // gated route, stay hidden
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount; setState fires only after the awaited fetch.
    void load();
  }, [load]);

  if (!spend) return null;

  const total = Math.max(1, spend.totalCents);
  const fixedCents = spend.categories
    .filter((c) => c.fixed)
    .reduce((s, c) => s + c.cents, 0);
  const variableCents = spend.totalCents - fixedCents;

  return (
    <section className="rounded-xl border border-border bg-surface-raised p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-title font-semibold text-foreground">
            Monthly spend by category
          </h2>
          <p className="mt-0.5 text-meta text-foreground-muted leading-relaxed">
            Estimated provider cost this month from live usage. Fixed base
            (hosting + compute) plus variable storage and activity. Recorded
            actuals live in the ledger below.
          </p>
        </div>
        <p className="text-heading font-bold tracking-tight text-foreground">
          {usd(spend.totalCents)}
          <span className="ml-1 text-meta font-normal text-foreground-muted">
            / mo est.
          </span>
        </p>
      </div>

      {/* Stacked bar */}
      <div className="mt-4 flex h-5 w-full overflow-hidden rounded-full ring-1 ring-inset ring-border bg-surface-sunken">
        {spend.categories
          .filter((c) => c.cents > 0)
          .map((c) => (
            <div
              key={c.label}
              style={{ width: `${(c.cents / total) * 100}%`, background: c.color }}
              title={`${c.label} (${c.vendor}): ${usd(c.cents)}`}
            />
          ))}
      </div>

      {/* Fixed vs variable summary */}
      <p className="mt-2 text-meta text-foreground-muted">
        {usd(fixedCents)} fixed base + {usd(variableCents)} variable. The cost
        breaker budgets the variable part.
      </p>

      {/* Legend */}
      <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {spend.categories.map((c) => (
          <li key={c.label} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ background: c.color }}
              />
              <span className="truncate text-meta text-foreground">
                {c.label}{" "}
                <span className="text-foreground-muted">
                  · {c.vendor}
                  {c.fixed ? " · fixed" : ""}
                </span>
              </span>
            </span>
            <span className="shrink-0 text-meta font-semibold text-foreground">
              {usd(c.cents)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
