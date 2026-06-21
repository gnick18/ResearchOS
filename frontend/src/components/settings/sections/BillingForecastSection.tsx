"use client";

// Billing forecast + history section of the unified Settings page.
//
// Shows the PI a projected month-end charge broken down by component (base +
// usage + storage + hosted), the monthly cap (with a plain-language reason),
// and a history table of past charges and credits with a running balance.
//
// Data comes from GET /api/billing/model-a/forecast. The route is gated by
// BILLING_ENABLED; when billing is off or the caller is not signed in the
// section shows a calm empty state rather than an error. Behind the existing
// isBillingEnabled flag posture, rendered only when the parent passes
// enabled=true (the same gate the status route uses).
//
// Money is always shown in dollars (cents / 100) so a non-accountant PI can
// read the numbers at a glance.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import Link from "next/link";

import { Icon } from "@/components/icons";

// ── Money formatting ──────────────────────────────────────────────────────────

/** Format cents as a dollar string: $3.00, $0.00, -$1.23. */
function usd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

// ── API types ──────────────────────────────────────────────────────────────────

interface ForecastBreakdown {
  baseCents: number;
  usageCents: number;
  storageCents: number;
  hostedCents: number;
}

interface Forecast {
  period: string;
  planId: string;
  breakdown: ForecastBreakdown;
  totalCents: number;
  capCents: number | null;
}

interface HistoryEntry {
  period: string | null;
  kind: string;
  cents: number;
  balanceCents: number;
  createdAt: string;
}

interface ForecastResponse {
  forecast: Forecast;
  history: HistoryEntry[];
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function fetchForecast(): Promise<ForecastResponse | null> {
  try {
    const res = await fetch("/api/billing/model-a/forecast");
    if (!res.ok) return null;
    return (await res.json()) as ForecastResponse;
  } catch {
    return null;
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BreakdownRow({ label, cents }: { label: string; cents: number }) {
  if (cents === 0) return null;
  return (
    <div className="flex items-center justify-between text-body py-1">
      <span className="text-foreground-muted">{label}</span>
      <span className="font-medium text-foreground tabular-nums">{usd(cents)}</span>
    </div>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const colorMap: Record<string, string> = {
    accrual: "bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300",
    charge: "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300",
    credit: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  };
  const cls = colorMap[kind] ?? "bg-surface-sunken text-foreground-muted";
  return (
    <span className={`inline-block rounded-md text-meta font-semibold px-2 py-0.5 ${cls}`}>
      {kind}
    </span>
  );
}

/** Format a date string for the history table without exposing the raw ISO. */
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BillingForecastSection() {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchForecast().then((d) => {
      if (cancelled) return;
      setData(d);
      setResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!resolved) return <LoadingState />;
  if (!data) return <EmptyState />;

  const { forecast, history } = data;
  const { breakdown, totalCents, capCents, period } = forecast;
  const anyBreakdown =
    breakdown.baseCents > 0 ||
    breakdown.usageCents > 0 ||
    breakdown.storageCents > 0 ||
    breakdown.hostedCents > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-6">
      {/* Projected charge card */}
      <section className="bg-surface-raised rounded-xl border border-border p-5">
        <h3 className="flex items-center gap-2 text-title font-semibold text-foreground">
          <Icon name="gauge" className="h-4 w-4 text-blue-600 dark:text-blue-300" />
          Projected charge for {period}
        </h3>
        <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
          Based on your current usage right now. The final amount is settled at
          the end of the month, once the period closes.
        </p>

        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-display font-bold text-foreground tracking-tight">
            {usd(totalCents)}
          </span>
          <span className="text-body font-semibold text-foreground-muted">
            projected this month
          </span>
        </div>

        {anyBreakdown && (
          <div className="mt-3 divide-y divide-border rounded-lg border border-border overflow-hidden">
            <div className="px-3 py-1">
              <BreakdownRow label="Base plan fee" cents={breakdown.baseCents} />
              <BreakdownRow label="Relay activity" cents={breakdown.usageCents} />
              <BreakdownRow label="Cloud storage" cents={breakdown.storageCents} />
              <BreakdownRow label="Hosted site assets" cents={breakdown.hostedCents} />
            </div>
          </div>
        )}

        {!anyBreakdown && (
          <p className="mt-3 text-meta text-foreground-muted leading-relaxed">
            No usage this period yet. Your charge will appear here once activity
            is recorded.
          </p>
        )}

        {/* Monthly cap: show with a plain-language why-line so it never looks
            like a hidden penalty. */}
        {capCents != null ? (
          <div className="mt-4 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/10 px-3 py-2">
            <p className="text-body font-semibold text-amber-800 dark:text-amber-300">
              Monthly cap: {usd(capCents)}
            </p>
            <p className="text-meta text-foreground-muted mt-0.5 leading-relaxed">
              You set this cap so cloud sync pauses automatically if your usage
              would exceed it, keeping your bill predictable. The local app
              keeps working either way.
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-border bg-surface-sunken px-3 py-2">
            <p className="text-meta text-foreground-muted leading-relaxed">
              No monthly cap set. You can add one in the billing settings to
              pause sync automatically if your projected charge climbs above a
              number you choose.
            </p>
          </div>
        )}

        <p className="text-meta text-foreground-muted leading-relaxed border-t border-dashed border-border pt-3 mt-4">
          <Link href="/pricing" className="text-blue-600 dark:text-blue-300 font-semibold hover:underline">
            See pricing details
          </Link>
        </p>
      </section>

      {/* History table */}
      <section className="bg-surface-raised rounded-xl border border-border p-5">
        <h3 className="flex items-center gap-2 text-title font-semibold text-foreground">
          <Icon name="history" className="h-4 w-4 text-blue-600 dark:text-blue-300" />
          Charge history
        </h3>
        <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
          Every accrual, card run, and credit on your account, newest first.
        </p>

        {history.length === 0 ? (
          <div className="mt-4 rounded-lg border border-border bg-surface-sunken px-3 py-4 text-center">
            <p className="text-body text-foreground-muted">
              No billing history yet.
            </p>
            <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
              Your first month-end accrual will appear here once the billing
              period closes.
            </p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {history.map((entry, i) => (
              <li key={i} className="py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <KindBadge kind={entry.kind} />
                    {entry.period && (
                      <span className="text-meta text-foreground-muted truncate">
                        {entry.period}
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-body font-semibold tabular-nums whitespace-nowrap ${
                      entry.cents < 0
                        ? "text-amber-700 dark:text-amber-300"
                        : "text-foreground"
                    }`}
                  >
                    {usd(entry.cents)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-meta text-foreground-muted mt-0.5">
                  <span>{formatDate(entry.createdAt)}</span>
                  <span>
                    balance after:{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {usd(entry.balanceCents)}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-6">
      <section className="bg-surface-raised rounded-xl border border-border p-5">
        <div className="h-4 w-48 rounded bg-surface-sunken animate-pulse" />
        <div className="h-10 w-32 rounded bg-surface-sunken animate-pulse mt-4" />
        <div className="h-24 rounded bg-surface-sunken animate-pulse mt-3" />
      </section>
      <section className="bg-surface-raised rounded-xl border border-border p-5">
        <div className="h-4 w-32 rounded bg-surface-sunken animate-pulse" />
        <div className="h-48 rounded bg-surface-sunken animate-pulse mt-4" />
      </section>
    </div>
  );
}

/** Calm empty state when billing is off or the session read returned nothing. */
function EmptyState() {
  return (
    <section className="bg-surface-raised rounded-xl border border-border p-6">
      <h3 className="flex items-center gap-2 text-title font-semibold text-foreground">
        <Icon name="gauge" className="h-4 w-4 text-blue-600 dark:text-blue-300" />
        Billing forecast not available
      </h3>
      <p className="text-body text-foreground-muted leading-relaxed mt-3 max-w-prose">
        The billing forecast is not available yet, either because billing is
        still in beta or your session could not be verified. Your local work is
        never affected. Once billing goes live you will see your projected
        month-end charge and full history here.
      </p>
      <Link
        href="/pricing"
        className="inline-block mt-4 px-3 py-2 text-body font-medium border border-border bg-surface-raised hover:bg-surface-sunken rounded-lg text-foreground"
      >
        See plans
      </Link>
    </section>
  );
}
