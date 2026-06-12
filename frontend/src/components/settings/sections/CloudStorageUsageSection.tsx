"use client";

// "Cloud storage" section of the unified Settings page (settings-build bot,
// 2026-06-11). A used/cap bar for the optional synced copy, an inbox-shares
// used/cap bar, and the current plan, framed to match the /pricing voice.
// Numbers are illustrative fixtures today (see usage-fixtures.ts), they wire up
// to the real billing status endpoint when metered storage goes live.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import Link from "next/link";

import { Icon } from "@/components/icons";
import { STORAGE_USAGE_FIXTURE } from "@/lib/usage/usage-fixtures";

export default function CloudStorageUsageSection() {
  const { usedGb, capGb, inboxUsed, inboxCap, planLabel, freeDuringBeta } =
    STORAGE_USAGE_FIXTURE;
  const storagePct = Math.min(100, Math.round((usedGb / capGb) * 100));
  const inboxPct = Math.min(100, Math.round((inboxUsed / inboxCap) * 100));

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
            {usedGb}
          </span>
          <span className="text-body font-semibold text-foreground-muted">
            GB of {capGb} GB
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-surface-sunken overflow-hidden mt-2">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-sky-400 to-blue-600"
            style={{ width: `${storagePct}%` }}
          />
        </div>
        <div className="flex justify-between text-meta text-foreground-muted mt-1">
          <span>Your synced copy</span>
          <span>
            <span className="font-medium text-foreground">{storagePct}%</span> of
            your plan
          </span>
        </div>

        <h3 className="flex items-center gap-2 text-body font-semibold text-foreground mt-6">
          <Icon name="mail" className="h-4 w-4 text-foreground-muted" />
          Inbox shares
        </h3>
        <div className="h-2.5 rounded-full bg-surface-sunken overflow-hidden mt-2">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500"
            style={{ width: `${inboxPct}%` }}
          />
        </div>
        <div className="flex justify-between text-meta text-foreground-muted mt-1">
          <span>
            {inboxUsed} of {inboxCap} used
          </span>
          <span>shares others sent you</span>
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
            {planLabel}
          </span>
          {freeDuringBeta && (
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
