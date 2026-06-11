"use client";

// Monthly money-flow visual for /admin and /admin/business. Two stacked bars:
// money OUT (estimated provider cost, by category/vendor) and money IN (recorded
// revenue this month, by source). Revenue is empty until we have it, and shows a
// placeholder; when it arrives it fills the second bar. Estimated cost is from
// live usage; recorded actuals live in the ledger. Operator-only, talks to the
// admin-gated /api/admin/spend route.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";

interface OutCategory {
  label: string;
  vendor: string;
  cents: number;
  fixed: boolean;
  color: string;
}
interface InCategory {
  label: string;
  cents: number;
  color: string;
}
interface MoneyFlow {
  out: { categories: OutCategory[]; totalCents: number };
  in: { categories: InCategory[]; totalCents: number };
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function StackedBar({
  segments,
}: {
  segments: { cents: number; color: string }[];
}) {
  const total = Math.max(
    1,
    segments.reduce((s, c) => s + c.cents, 0),
  );
  return (
    <div className="flex h-5 w-full overflow-hidden rounded-full bg-surface-sunken ring-1 ring-inset ring-border">
      {segments
        .filter((c) => c.cents > 0)
        .map((c, i) => (
          <div
            key={i}
            style={{ width: `${(c.cents / total) * 100}%`, background: c.color }}
          />
        ))}
    </div>
  );
}

export default function SpendByCategoryPanel() {
  const [flow, setFlow] = useState<MoneyFlow | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/spend");
      if (!res.ok) return;
      setFlow((await res.json()) as MoneyFlow);
    } catch {
      // gated route, stay hidden
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount; setState fires only after the awaited fetch.
    void load();
  }, [load]);

  if (!flow) return null;

  const out = flow.out;
  const inc = flow.in;
  const fixedCents = out.categories
    .filter((c) => c.fixed)
    .reduce((s, c) => s + c.cents, 0);
  const variableCents = out.totalCents - fixedCents;
  const net = inc.totalCents - out.totalCents;

  return (
    <section className="rounded-xl border border-border bg-surface-raised p-6">
      <h2 className="text-title font-semibold text-foreground">
        Monthly money flow
      </h2>
      <p className="mt-0.5 text-meta text-foreground-muted leading-relaxed">
        Estimated provider cost out (from live usage) and recorded revenue in
        (from the ledger) this month.
      </p>

      {/* Money OUT */}
      <div className="mt-5">
        <div className="flex items-end justify-between gap-3">
          <p className="text-meta font-semibold uppercase tracking-wide text-red-700">
            Money out, estimated cost
          </p>
          <p className="text-body font-bold tracking-tight text-foreground">
            {usd(out.totalCents)}
          </p>
        </div>
        <div className="mt-2">
          <StackedBar segments={out.categories} />
        </div>
        <p className="mt-1.5 text-meta text-foreground-muted">
          {usd(fixedCents)} fixed base + {usd(variableCents)} variable. The cost
          breaker budgets the variable part.
        </p>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {out.categories.map((c) => (
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
      </div>

      {/* Money IN */}
      <div className="mt-6">
        <div className="flex items-end justify-between gap-3">
          <p className="text-meta font-semibold uppercase tracking-wide text-emerald-700">
            Money in, revenue
          </p>
          <p className="text-body font-bold tracking-tight text-foreground">
            {usd(inc.totalCents)}
          </p>
        </div>
        {inc.totalCents > 0 ? (
          <>
            <div className="mt-2">
              <StackedBar segments={inc.categories} />
            </div>
            <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {inc.categories.map((c) => (
                <li
                  key={c.label}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ background: c.color }}
                    />
                    <span className="truncate text-meta text-foreground">
                      {c.label}
                    </span>
                  </span>
                  <span className="shrink-0 text-meta font-semibold text-foreground">
                    {usd(c.cents)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="mt-2 rounded-lg border border-dashed border-border bg-surface-sunken px-4 py-3 text-meta text-foreground-muted">
            No revenue yet. When storage plans or donations come in, they fill
            this bar by source.
          </div>
        )}
      </div>

      {/* Net */}
      <div className="mt-5 flex items-center justify-between border-t border-border pt-3">
        <span className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
          Net this month
        </span>
        <span
          className={`text-body font-bold ${
            net >= 0
              ? "text-emerald-700"
              : "text-red-700"
          }`}
        >
          {net >= 0 ? "+" : "-"}
          {usd(Math.abs(net))}
        </span>
      </div>
    </section>
  );
}
