"use client";

// "Cloud storage" section of the unified Settings page (settings-build bot,
// 2026-06-11). A pooled used/cap bar for the lab's synced storage, a monthly
// activity used/allowance bar, the lab plan, and the member count, framed to
// match the /pricing voice.
//
// Live data comes from GET /api/billing/lab (lab-billing-display bot,
// 2026-06-12). When billing is disabled the route 404s and when the caller is
// not on a paid lab plan labBilling is false, both of which render a calm "not
// on a lab plan" message rather than an error or a forever-spinner. The
// STORAGE_USAGE_FIXTURE survives only for demo / wikiCapture mode so the wiki
// screenshots stay populated.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import Link from "next/link";

import { Icon } from "@/components/icons";
import { fetchLabStatus, type LabStatus } from "@/lib/billing/client";
import { GB_BYTES, humanBytes } from "@/lib/billing/format";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
import { STORAGE_USAGE_FIXTURE } from "@/lib/usage/usage-fixtures";

/** Compact write-count label, e.g. "1.2M" or "500k". */
function formatWrites(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** The values the panel renders, sourced either from the live lab status or
 *  from the demo fixture. */
interface UsageView {
  planLabel: string;
  freeDuringBeta: boolean;
  storageUsedBytes: number;
  storageCapBytes: number;
  activityWrites: number;
  activityAllowance: number;
  memberCount: number;
}

/** The demo / wikiCapture view, sourced from the illustrative fixture so the
 *  screenshots stay populated. The fixture is GB-based, so scale to bytes. */
function fixtureView(): UsageView {
  const f = STORAGE_USAGE_FIXTURE;
  return {
    planLabel: f.planLabel,
    freeDuringBeta: f.freeDuringBeta,
    storageUsedBytes: f.usedGb * GB_BYTES,
    storageCapBytes: f.capGb * GB_BYTES,
    // The fixture predates the activity bar, so show a plausible illustrative
    // pair that keeps the second bar populated in screenshots.
    activityWrites: 120_000,
    activityAllowance: 1_000_000,
    memberCount: 4,
  };
}

/** Map a live lab status into the panel's view. */
function liveView(lab: LabStatus): UsageView {
  return {
    planLabel: lab.labPlanName,
    // No charge during the beta keeps the badge honest while prices are
    // provisional (the route is already billing-gated by the time we render).
    freeDuringBeta: lab.estimatedChargeCents === 0,
    storageUsedBytes: lab.aggregateUsedBytes,
    storageCapBytes: lab.labCapBytes,
    activityWrites: lab.aggregateWrites,
    activityAllowance: lab.labActivityAllowance,
    memberCount: lab.sponsoredOwners,
  };
}

export default function CloudStorageUsageSection() {
  const [view, setView] = useState<UsageView | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Demo / wikiCapture mode keeps the illustrative fixture so screenshots
    // look populated without any real billing data.
    if (isDemoOrWikiCapture()) {
      setView(fixtureView());
      setResolved(true);
      return;
    }

    void (async () => {
      const lab = await fetchLabStatus();
      if (cancelled) return;
      // 404 (billing disabled) or no paid lab plan -> calm empty state.
      if (lab && lab.enabled && lab.labBilling) {
        setView(liveView(lab));
      } else {
        setView(null);
      }
      setResolved(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!resolved) return <LoadingState />;
  if (!view) return <NoLabPlanState />;

  const storagePct = Math.min(
    100,
    Math.round((view.storageUsedBytes / Math.max(1, view.storageCapBytes)) * 100),
  );
  const activityPct = Math.min(
    100,
    Math.round((view.activityWrites / Math.max(1, view.activityAllowance)) * 100),
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-6">
      {/* Used vs cap bars */}
      <section className="bg-surface-raised rounded-xl border border-border p-5">
        <h3 className="flex items-center gap-2 text-title font-semibold text-foreground">
          <Icon name="cloud" className="h-4 w-4 text-blue-600 dark:text-blue-300" />
          Storage used
        </h3>
        <div className="flex items-baseline gap-2 mt-4">
          <span className="text-display font-bold text-foreground tracking-tight">
            {humanBytes(view.storageUsedBytes)}
          </span>
          <span className="text-body font-semibold text-foreground-muted">
            of {humanBytes(view.storageCapBytes)} pooled
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-surface-sunken overflow-hidden mt-2">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-sky-400 to-blue-600"
            style={{ width: `${storagePct}%` }}
          />
        </div>
        <div className="flex justify-between text-meta text-foreground-muted mt-1">
          <span>Shared across {view.memberCount} in your lab</span>
          <span>
            <span className="font-medium text-foreground">{storagePct}%</span> of
            your plan
          </span>
        </div>

        <h3 className="flex items-center gap-2 text-body font-semibold text-foreground mt-6">
          <Icon name="refresh" className="h-4 w-4 text-foreground-muted" />
          Monthly activity
        </h3>
        <div className="h-2.5 rounded-full bg-surface-sunken overflow-hidden mt-2">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500"
            style={{ width: `${activityPct}%` }}
          />
        </div>
        <div className="flex justify-between text-meta text-foreground-muted mt-1">
          <span>
            {formatWrites(view.activityWrites)} of{" "}
            {formatWrites(view.activityAllowance)} writes
          </span>
          <span>this month, across the lab</span>
        </div>
      </section>

      {/* Current plan + manage */}
      <section className="bg-surface-raised rounded-xl border border-blue-200 dark:border-blue-500/30 p-5">
        <h3 className="flex items-center gap-2 text-title font-semibold text-foreground">
          <Icon name="check" className="h-4 w-4 text-blue-600 dark:text-blue-300" />
          Your plan
        </h3>
        <div className="flex items-center gap-2 mt-3">
          <span className="text-heading font-bold text-foreground">
            {view.planLabel}
          </span>
          {view.freeDuringBeta && (
            <span className="inline-block rounded-md bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 text-meta font-semibold px-2 py-0.5">
              Beta
            </span>
          )}
        </div>
        <p className="text-meta text-foreground-muted leading-relaxed mt-2">
          Everything is free during the beta. After the beta, cloud storage is
          metered at cost, your daily local work never leaves your disk so it
          stays cheap. You can use storage, AI, both, or neither, they are
          independent.
        </p>
        <Link
          href="/pricing"
          className="block text-center w-full mt-4 px-3 py-2 text-body font-medium border border-border bg-surface-raised hover:bg-surface-sunken rounded-lg text-foreground"
        >
          Manage billing
        </Link>
        <p className="text-meta text-foreground-muted leading-relaxed border-t border-dashed border-border pt-3 mt-4">
          <Link href="/pricing" className="text-blue-600 dark:text-blue-300 font-semibold hover:underline">
            Manage billing / see plans
          </Link>
        </p>
      </section>
    </div>
  );
}

/** Light skeleton while the lab status fetch is in flight. */
function LoadingState() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-6">
      <section className="bg-surface-raised rounded-xl border border-border p-5">
        <div className="h-4 w-28 rounded bg-surface-sunken animate-pulse" />
        <div className="h-8 w-40 rounded bg-surface-sunken animate-pulse mt-4" />
        <div className="h-2.5 rounded-full bg-surface-sunken animate-pulse mt-2" />
        <div className="h-4 w-28 rounded bg-surface-sunken animate-pulse mt-6" />
        <div className="h-2.5 rounded-full bg-surface-sunken animate-pulse mt-2" />
      </section>
      <section className="bg-surface-raised rounded-xl border border-blue-200 dark:border-blue-500/30 p-5">
        <div className="h-4 w-20 rounded bg-surface-sunken animate-pulse" />
        <div className="h-6 w-32 rounded bg-surface-sunken animate-pulse mt-3" />
        <div className="h-16 w-full rounded bg-surface-sunken animate-pulse mt-3" />
      </section>
    </div>
  );
}

/** Calm empty state for billing disabled or a non-lab account. No error tone. */
function NoLabPlanState() {
  return (
    <section className="bg-surface-raised rounded-xl border border-border p-6">
      <h3 className="flex items-center gap-2 text-title font-semibold text-foreground">
        <Icon name="cloud" className="h-4 w-4 text-blue-600 dark:text-blue-300" />
        You are not on a lab plan
      </h3>
      <p className="text-body text-foreground-muted leading-relaxed mt-3 max-w-prose">
        Your work lives on your own disk, so there is nothing to meter here. A
        lab plan pools cloud storage and sync activity across everyone in your
        lab for one flat price, useful when you want a backed-up shared copy.
        Everything stays free during the beta.
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
