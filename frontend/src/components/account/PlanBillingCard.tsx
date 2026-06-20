"use client";

// Account hub Card 2: compact read-only plan and billing summary.
//
// Reads ModelAStatus via the shared useModelAStatus hook (same fetch as
// Settings -> Plan & storage, so the numbers can never drift). Shows the tier,
// a single state pill, the price from catalog.ts, this-period accrual, and the
// card-on-file status. Heavy controls (cap, storage, lab roster) deep-link to
// Settings -> Plan & storage. The only inline write is "Add / Update card", which
// calls the existing card-setup endpoint -- reuse, not duplication.
//
// When billing is off (hook returns null) and status is loading, shows a skeleton.
// When billing is off (404) the card renders an informational beta message only.
//
// No emojis, no em-dashes, no mid-sentence colons.

import Link from "next/link";
import { useState } from "react";
import { PLAN_PRICES, usd } from "@/lib/billing/catalog";
import { useModelAStatus } from "@/hooks/useModelAStatus";
import type { ModelAStatus } from "@/components/billing/ModelABilling";

// ---------------------------------------------------------------------------
// State pill derivation
// ---------------------------------------------------------------------------

interface PillInfo {
  label: string;
  /** Tailwind classes for background + text color of the pill. */
  color: string;
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "soon";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function derivePill(status: ModelAStatus): PillInfo {
  if (status.sponsoringLab) {
    return {
      label: `Covered by ${status.sponsoringLab.name}`,
      color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
    };
  }
  if (status.isComped) {
    return {
      label: "Comped by ResearchOS",
      color: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
    };
  }
  if (status.trialPaused || status.trialPhase === "ended_no_card") {
    return {
      label: "Action needed",
      color: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    };
  }
  if (status.trialPhase === "trialing" && status.trialEndsAt) {
    const days = daysUntil(status.trialEndsAt);
    return {
      label: `Trial, ${days} ${days === 1 ? "day" : "days"} left`,
      color: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
    };
  }
  if (status.planId === "free") {
    return {
      label: "Free",
      color: "bg-surface-sunken text-foreground-muted border border-border",
    };
  }
  // Paid, card on file, no trial.
  if (status.hasCard) {
    return {
      label: "Active",
      color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
    };
  }
  return {
    label: "Active",
    color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  };
}

// ---------------------------------------------------------------------------
// Secondary / detail line
// ---------------------------------------------------------------------------

function SecondaryLine({ status }: { status: ModelAStatus }) {
  if (status.sponsoringLab) {
    return (
      <p className="text-meta text-foreground-muted">
        Your lab covers your cloud usage.
      </p>
    );
  }
  if (status.isComped) {
    return (
      <p className="text-meta text-foreground-muted">
        Your account is comped by ResearchOS at no charge.
      </p>
    );
  }
  if (status.trialPaused || status.trialPhase === "ended_no_card") {
    return (
      <p className="text-meta text-amber-700 dark:text-amber-400">
        Add a card to keep your paid features.
      </p>
    );
  }
  if (status.trialPhase === "trialing" && status.trialEndsAt) {
    return (
      <p className="text-meta text-foreground-muted">
        Trial ends {formatDate(status.trialEndsAt)}. Add a card before then to stay active.
      </p>
    );
  }
  if (status.planId === "free") {
    return (
      <p className="text-meta text-foreground-muted">
        Upgrade to unlock send, co-edit, and the companion app.
      </p>
    );
  }
  if (status.planId === "lab") {
    return (
      <p className="text-meta text-foreground-muted">
        {PLAN_PRICES.lab.base}{PLAN_PRICES.lab.baseSuffix} founding rate, usage at {PLAN_PRICES.lab.usageMarkup}x.
        {status.accruedCents > 0
          ? ` ${usd(status.accruedCents)} accrued this period.`
          : ""}
      </p>
    );
  }
  // Solo paid.
  return (
    <p className="text-meta text-foreground-muted">
      {PLAN_PRICES.solo.base}{PLAN_PRICES.solo.baseSuffix} plus usage.
      {status.accruedCents > 0
        ? ` ${usd(status.accruedCents)} accrued this period.`
        : ""}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Plan name + price label
// ---------------------------------------------------------------------------

function planLabel(status: ModelAStatus): string {
  if (status.sponsoringLab) return "Lab member";
  if (status.planId === "free") return "Free";
  if (status.planId === "lab") return PLAN_PRICES.lab.name;
  if (status.planId === "dept") return PLAN_PRICES.dept.name;
  return PLAN_PRICES.solo.name;
}

// ---------------------------------------------------------------------------
// Card component
// ---------------------------------------------------------------------------

async function startCardSetup(planId: string, setBusy: (b: boolean) => void) {
  setBusy(true);
  try {
    const res = await fetch("/api/billing/model-a/card-setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId }),
    });
    const data = (await res.json()) as { url?: string };
    if (data.url) window.location.href = data.url;
  } finally {
    setBusy(false);
  }
}

export default function PlanBillingCard() {
  const { status, loading, refresh } = useModelAStatus();
  const [cardBusy, setCardBusy] = useState(false);

  // While loading, show a minimal skeleton so the column layout does not jump.
  if (loading) {
    return (
      <div className="animate-pulse rounded-2xl border border-border bg-surface p-5">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-3 h-3 w-48 rounded bg-surface-sunken" />
      </div>
    );
  }

  // Billing is off (404) -- show a calm beta message and nothing more.
  if (!status) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-body font-bold text-foreground">Plan and billing</h2>
        <p className="mt-1 text-meta text-foreground-muted">
          Everything is free during the beta. Billing activates before we launch.
        </p>
      </div>
    );
  }

  const pill = derivePill(status);
  const label = planLabel(status);
  const showAddCard =
    !status.sponsoringLab &&
    !status.isComped &&
    status.planId !== "free" &&
    !status.hasCard;
  const showUpdateCard =
    !status.sponsoringLab &&
    !status.isComped &&
    status.planId !== "free" &&
    status.hasCard;
  const showUpgrade = status.planId === "free" && !status.isComped && !status.sponsoringLab;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-body font-bold text-foreground">{label}</h2>
          <span
            className={`rounded-full px-2.5 py-0.5 text-meta font-semibold ${pill.color}`}
          >
            {pill.label}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Add / Update card is the one inline write -- reuse the same
              card-setup endpoint ModelABilling uses. */}
          {(showAddCard || showUpdateCard) && (
            <button
              type="button"
              onClick={() => void startCardSetup(status.planId, setCardBusy).then(refresh)}
              disabled={cardBusy}
              className="ros-btn-raise rounded-lg bg-brand-action px-3 py-1.5 text-meta font-semibold text-white disabled:opacity-60"
            >
              {cardBusy ? "Opening..." : showAddCard ? "Add a card" : "Update card"}
            </button>
          )}
          {/* Upgrade: Free -> Solo card-setup; Solo -> the Run a lab card below. */}
          {showUpgrade && status.planId === "free" && (
            <button
              type="button"
              onClick={() => void startCardSetup("solo", setCardBusy).then(refresh)}
              disabled={cardBusy}
              className="rounded-lg border border-brand-action px-3 py-1.5 text-meta font-semibold text-brand-action hover:bg-brand-action/5 disabled:opacity-60"
            >
              {cardBusy ? "Opening..." : "Upgrade to Solo"}
            </button>
          )}
          {/* Manage billing always deep-links to Settings -> Plan & storage. */}
          <Link
            href="/settings?section=plan-storage"
            className="rounded-lg border border-border px-3 py-1.5 text-meta font-semibold text-foreground hover:border-brand-action"
          >
            Manage billing
          </Link>
        </div>
      </div>

      <SecondaryLine status={status} />

      {/* Lab coverage banner: called out when the lab covers this member. */}
      {status.sponsoringLab && (
        <p className="mt-2 text-meta text-emerald-700 dark:text-emerald-400">
          {status.sponsoringLab.name} covers your cloud usage and paid features.
          Your lab head is billed, not you.
        </p>
      )}

      {/* Card status line (only for active paid plans where it is meaningful). */}
      {status.planId !== "free" && !status.sponsoringLab && !status.isComped && (
        <p className="mt-2 text-meta text-foreground-muted">
          {status.hasCard ? "Card on file." : "No card on file yet."}
        </p>
      )}
    </div>
  );
}
