"use client";

// Operator panel for the cost circuit breaker, on /admin/business.
//
// Shows the estimated total monthly provider cost against the budget, the
// breaker state, a budget editor, and manual trip / reset controls. Talks to the
// admin-gated /api/admin/breaker route. Tripping pauses cloud writes (collab +
// relay) so a viral spike on the free beta cannot run up an unbounded bill;
// reset is manual so spending never silently resumes.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";

interface BreakerState {
  tripped: boolean;
  reason: string | null;
  trippedAt: string | null;
  budgetCents: number;
}
interface CostEstimate {
  storageCents: number;
  activityCents: number;
  fixedBaseCents: number;
  amortizedAnnualCents: number;
  variableCents: number;
  totalCents: number;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function CostBreakerPanel() {
  const [state, setState] = useState<BreakerState | null>(null);
  const [cost, setCost] = useState<CostEstimate | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/breaker");
      if (!res.ok) return;
      const data = (await res.json()) as { state: BreakerState; cost: CostEstimate };
      setState(data.state);
      setCost(data.cost);
      setBudgetInput(
        data.state.budgetCents > 0 ? (data.state.budgetCents / 100).toFixed(2) : "",
      );
    } catch {
      // gated route, stay hidden
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount; setState fires only after the awaited fetch.
    void load();
  }, [load]);

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      try {
        await fetch("/api/admin/breaker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  if (!state || !cost) return null;

  const budget = state.budgetCents;
  // The budget guards VARIABLE cost (storage + activity), not the fixed base.
  const pct = budget > 0 ? Math.min(100, (cost.variableCents / budget) * 100) : 0;
  const near = budget > 0 && pct >= 80 && !state.tripped;
  const barColor = state.tripped
    ? "bg-red-500"
    : near
      ? "bg-amber-500"
      : "bg-emerald-500";

  return (
    <section className="rounded-xl border border-border bg-surface-raised p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-title font-semibold text-foreground">
            Cost circuit breaker
          </h2>
          <p className="mt-0.5 text-meta text-foreground-muted leading-relaxed">
            A global guard against a runaway provider bill. The budget caps
            VARIABLE cost (storage + activity) above our fixed monthly base; if it
            reaches the budget, cloud writes pause (the local-first app keeps
            working). Reset is manual.
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-meta font-semibold ring-1 ring-inset ${
            state.tripped
              ? "text-red-700 ring-red-300"
              : "text-emerald-700 ring-emerald-300"
          }`}
        >
          {state.tripped ? "TRIPPED, cloud writes paused" : "OK"}
        </span>
      </div>

      {/* Cost vs budget */}
      <div className="mt-4">
        <div className="flex items-end justify-between gap-3">
          <p className="text-body font-semibold text-foreground">
            {usd(cost.variableCents)}{" "}
            <span className="font-normal text-foreground-muted">
              variable this month{" "}
              {budget > 0 ? `of ${usd(budget)} budget` : "(no budget set)"}
            </span>
          </p>
          {budget > 0 ? (
            <span className="text-meta text-foreground-muted">{pct.toFixed(0)}%</span>
          ) : null}
        </div>
        {budget > 0 ? (
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken ring-1 ring-inset ring-border">
            <div
              className={`h-full rounded-full ${barColor} transition-all`}
              style={{ width: `${Math.max(pct, 1)}%` }}
            />
          </div>
        ) : null}
        <p className="mt-1 text-meta text-foreground-muted">
          Storage {usd(cost.storageCents)} + activity {usd(cost.activityCents)} ={" "}
          {usd(cost.variableCents)} variable. Plus {usd(cost.fixedBaseCents)} fixed
          base + {usd(cost.amortizedAnnualCents)} annual fees (monthly) ={" "}
          {usd(cost.totalCents)} total (fixed + annual not budgeted).
        </p>
      </div>

      {state.tripped && state.reason ? (
        <p className="mt-3 rounded-lg px-4 py-2.5 text-meta text-red-700 ring-1 ring-inset ring-red-300">
          Tripped: {state.reason}
          {state.trippedAt ? ` (${state.trippedAt.slice(0, 16).replace("T", " ")})` : ""}
        </p>
      ) : null}

      {/* Budget editor + controls */}
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="text-meta text-foreground-muted">
          <span className="block font-medium uppercase tracking-wide">
            Monthly budget (USD)
          </span>
          <input
            type="number"
            min="0"
            step="1"
            value={budgetInput}
            disabled={busy}
            onChange={(e) => setBudgetInput(e.target.value)}
            placeholder="e.g. 50"
            className="mt-1 w-28 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            act({ action: "setBudget", budgetCents: Math.round(Number(budgetInput || 0) * 100) })
          }
          className="ros-btn-raise rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white hover:bg-brand-action/90 disabled:opacity-50"
        >
          Save budget
        </button>
        {state.tripped ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => act({ action: "reset" })}
            className="rounded-lg border border-emerald-500 px-4 py-2 text-meta font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            Reset breaker
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => act({ action: "trip" })}
            className="rounded-lg border border-border px-4 py-2 text-meta font-semibold text-foreground hover:bg-surface-sunken disabled:opacity-50"
          >
            Trip now (test)
          </button>
        )}
      </div>
      <p className="mt-2 text-meta text-foreground-muted">
        Set a budget of 0 to disable auto-tripping. Provider hard caps (Vercel
        Spend Management, Neon limits) are the outer layer, set those on the
        provider dashboards.
      </p>
    </section>
  );
}
