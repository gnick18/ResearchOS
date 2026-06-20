"use client";

// Model A billing panel (engine step 4, UI).
//
// Shows the signed-in owner their Model-A billing: the plan, the running accrued
// balance for this period, the card on file, and the settable monthly $ cap. A
// free owner sees the upgrade options (prices from the canonical catalog). A paid
// owner sees their accrual + can save a card, raise/clear the cap.
//
// Reads GET /api/billing/model-a/status, writes via POST /cap and /card-setup. All
// dollar figures come from lib/billing/catalog (single source), never hardcoded.
// Accepts an optional `initialStatus` so the /dev preview can render every state
// without a live billing backend.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import React, { useEffect, useState } from "react";
import { PLAN_PRICES, usd, type PaidPlanId } from "@/lib/billing/catalog";
import { Icon } from "@/components/icons";

export type LabTrialPhase =
  | "none"
  | "trialing"
  | "ended_with_card"
  | "ended_no_card";

export interface ModelAStatus {
  planId: "free" | "solo" | "lab" | "dept";
  accruedCents: number;
  capCents: number | null;
  hasCard: boolean;
  /** ISO trial-end timestamp for a lab on a free trial, or null/undefined. */
  trialEndsAt?: string | null;
  /** The lab free-trial phase (Grant 2026-06-19), or "none" for non-trial owners. */
  trialPhase?: LabTrialPhase;
  /** True when an expired trial has no card, so the lab is paused. */
  trialPaused?: boolean;
  /**
   * The lab that covers this member, or null. Present only when a lab actively
   * sponsors the signed-in user (its PI is on a paid or comped plan), so the UI
   * can say "covered by X lab" rather than leaving a member to think their own
   * plan is all there is. A member keeps their own plan badge; coverage is in
   * addition, not a replacement.
   */
  sponsoringLab?: { name: string } | null;
}

type Load =
  | { state: "loading" }
  | { state: "off" } // billing not live (status 404)
  | { state: "ready"; status: ModelAStatus };

const card =
  "rounded-2xl border border-border bg-surface-raised p-5 shadow-sm";
const btn =
  "rounded-xl bg-[#1283c9] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0f6fa8] disabled:opacity-50";
const btnGhost =
  "rounded-xl border border-border bg-surface-raised px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-[#1283c9]";

export function ModelABilling({ initialStatus }: { initialStatus?: ModelAStatus }) {
  const [load, setLoad] = useState<Load>(
    initialStatus ? { state: "ready", status: initialStatus } : { state: "loading" },
  );

  useEffect(() => {
    if (initialStatus) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/billing/model-a/status");
        if (res.status === 404) {
          if (live) setLoad({ state: "off" });
          return;
        }
        const status = (await res.json()) as ModelAStatus;
        if (live) setLoad({ state: "ready", status });
      } catch {
        if (live) setLoad({ state: "off" });
      }
    })();
    return () => {
      live = false;
    };
  }, [initialStatus]);

  if (load.state === "off") return null;
  if (load.state === "loading") {
    return <div className={`${card} animate-pulse text-sm text-foreground-muted`}>Loading billing...</div>;
  }
  return <Ready status={load.status} onChange={(s) => setLoad({ state: "ready", status: s })} />;
}

function Ready({
  status,
  onChange,
}: {
  status: ModelAStatus;
  onChange: (s: ModelAStatus) => void;
}) {
  const panel =
    status.planId === "free" ? (
      <FreePanel onChange={onChange} />
    ) : (
      <PaidPanel status={status} onChange={onChange} />
    );
  // A member's own plan is independent of lab coverage, so the banner sits above
  // whichever panel they see (free, solo-comped, etc.). Coverage adds to their
  // plan, it does not replace it.
  return (
    <div className="space-y-4">
      {status.sponsoringLab && <CoverageBanner labName={status.sponsoringLab.name} />}
      {panel}
    </div>
  );
}

// ---- Member coverage banner ----
//
// A lab member is covered for the paid cloud features (sending, live co-editing,
// app pairing) by their lab's plan, even while their own plan reads free or solo.
// Without this line a member sees only their personal plan and reasonably thinks
// joining the lab did nothing, so we state plainly what the lab covers and that
// the PI is billed, not them.
function CoverageBanner({ labName }: { labName: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-green-200 bg-green-50 p-4 dark:border-green-500/30 dark:bg-green-500/15">
      <span className="mt-0.5 text-green-700 dark:text-green-300">
        <Icon name="shield" className="h-5 w-5" />
      </span>
      <div className="text-sm">
        <p className="font-semibold text-green-900 dark:text-green-200">
          Covered by {labName}
        </p>
        <p className="mt-1 leading-relaxed text-green-800 dark:text-green-300">
          Your lab covers cloud features like sending outside your folder and
          live co-editing, so you do not need a paid plan of your own. Your lab
          head is billed for the shared pool, never you.
        </p>
      </div>
    </div>
  );
}

// ---- Free owner: the upgrade pitch ----
//
// Solo path: card-setup -> Stripe Checkout (saves a card; charged at the $5 threshold).
// Lab path: start-trial -> 90-day no-card free trial, then reload into PaidPanel.
//   Per PRICING.md (Grant 2026-06-19): "Solo keeps the save-a-card-at-signup flow;
//   only the lab tier gets the no-card trial." Consistent with the onboarding path:
//   AccountTierChooser -> LabCreateResume -> start-trial (never card-setup for Lab).
//   After the trial starts we reload the status so the panel transitions to PaidPanel
//   showing the trial countdown. No Stripe redirect for Lab.
function FreePanel({ onChange }: { onChange: (s: ModelAStatus) => void }) {
  const [busy, setBusy] = useState<PaidPlanId | null>(null);

  async function startSolo() {
    setBusy("solo");
    try {
      const res = await fetch("/api/billing/model-a/card-setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: "solo" }),
      });
      const data = (await res.json()) as { url?: string };
      if (data.url) window.location.href = data.url;
    } finally {
      setBusy(null);
    }
  }

  async function startLabTrial() {
    setBusy("lab");
    try {
      await fetch("/api/billing/model-a/start-trial", { method: "POST" });
      // Reload the status so the panel transitions to PaidPanel with the trial
      // countdown. A network hiccup here is non-fatal; the user can reload.
      const res = await fetch("/api/billing/model-a/status");
      if (res.ok) {
        const status = (await res.json()) as ModelAStatus;
        onChange(status);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={card}>
      <h3 className="text-base font-bold text-foreground">You are on Free</h3>
      <p className="mt-1 text-sm text-foreground-muted">
        Free is the network tier. You can receive shared work and stay in the
        directory. Sending, live co-editing, and phone capture are on the paid
        plans, billed for what you actually use.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {/* Solo: save a card now, charged at the $5 threshold. */}
        <div className="rounded-xl border border-border p-4">
          <div className="font-bold text-foreground">{PLAN_PRICES.solo.name}</div>
          <div className="mt-0.5 text-sm text-foreground-muted">
            <span className="font-semibold text-foreground">{PLAN_PRICES.solo.base}</span>
            {PLAN_PRICES.solo.baseSuffix} plus your cloud usage
          </div>
          <button
            type="button"
            className={`${btn} mt-3 w-full`}
            onClick={startSolo}
            disabled={busy !== null}
          >
            {busy === "solo" ? "Starting..." : `Start ${PLAN_PRICES.solo.name}`}
          </button>
          <p className="mt-2 text-xs text-foreground-muted">
            We save a card now and only charge it once your usage passes $5.
          </p>
        </div>

        {/* Lab: 90-day free trial, no card at signup (per PRICING.md). */}
        <div className="rounded-xl border border-border p-4">
          <div className="font-bold text-foreground">{PLAN_PRICES.lab.name}</div>
          <div className="mt-0.5 text-sm text-foreground-muted">
            <span className="font-semibold text-foreground">{PLAN_PRICES.lab.base}</span>
            {PLAN_PRICES.lab.baseSuffix} plus your cloud usage
          </div>
          <button
            type="button"
            className={`${btn} mt-3 w-full`}
            onClick={startLabTrial}
            disabled={busy !== null}
          >
            {busy === "lab" ? "Starting..." : `Start ${PLAN_PRICES.lab.name}`}
          </button>
          <p className="mt-2 text-xs text-foreground-muted">
            90-day free trial, no card needed to start. Add a payment method
            before day 90 to keep your lab active.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---- Paid owner: accrual + card + cap ----
function PaidPanel({
  status,
  onChange,
}: {
  status: ModelAStatus;
  onChange: (s: ModelAStatus) => void;
}) {
  const plan = status.planId === "lab" ? PLAN_PRICES.lab : status.planId === "dept" ? PLAN_PRICES.dept : PLAN_PRICES.solo;
  const [busyCard, setBusyCard] = useState(false);

  async function addCard() {
    setBusyCard(true);
    try {
      const res = await fetch("/api/billing/model-a/card-setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: status.planId }),
      });
      const data = (await res.json()) as { url?: string };
      if (data.url) window.location.href = data.url;
    } finally {
      setBusyCard(false);
    }
  }

  return (
    <div className={`${card} space-y-4`}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-bold text-foreground">{plan.name} plan</h3>
        <span className="text-sm text-foreground-muted">
          {plan.base}
          {plan.baseSuffix} plus usage
        </span>
      </div>

      <TrialBanner status={status} onAddCard={addCard} busy={busyCard} />

      <div className="rounded-xl bg-surface-sunken p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          This billing period
        </div>
        <div className="mt-1 text-2xl font-bold text-foreground">{usd(status.accruedCents)}</div>
        <p className="mt-1 text-xs text-foreground-muted">
          Accrued so far. We run your card when this passes $5, or at cancellation.
          The local app never stops.
        </p>
      </div>

      <CardRow hasCard={status.hasCard} busy={busyCard} onAdd={addCard} />
      <CapRow status={status} onChange={onChange} />
      <DeflectionRow />
    </div>
  );
}

// Dispute deflection (Grant 2026-06-19). A calm line pointing a confused customer to
// us BEFORE they file a bank dispute. The WHY is stated plainly, reaching us directly
// is faster, because we can refund or explain a charge on the spot, where a card
// dispute takes weeks and freezes the account. Charges land as RESEARCHOS on the
// statement (set on the PaymentIntent) so they are recognizable; we ask the customer
// to quote the charge id from their statement or Stripe receipt so we can find it
// instantly.
function DeflectionRow() {
  return (
    <div className="border-t border-border pt-4">
      <div className="text-sm font-semibold text-foreground">Questions about a charge?</div>
      <p className="mt-1 text-xs text-foreground-muted">
        Email us at{" "}
        <a
          href="mailto:support@research-os.app"
          className="font-semibold text-[#1283c9] hover:underline"
        >
          support@research-os.app
        </a>{" "}
        and include the charge id from your card statement or Stripe receipt (charges
        show as RESEARCHOS). Reaching us directly is faster than a bank dispute, we can
        refund or look into it the same day, while a dispute takes weeks and pauses
        your account.
      </p>
    </div>
  );
}

/** Format an ISO trial-end timestamp as a readable date for the countdown line. */
function formatTrialEnd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "soon";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** Whole days from now until the trial ends (floored at 0). */
function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

// Lab free-trial banner (Grant 2026-06-19). While the trial is open it shows a
// countdown so the lab head knows the date and is nudged to add a card before it
// ends. Once the trial has ended with no card the lab is PAUSED (cloud accrual
// stops, the local app keeps working), so the banner becomes the add-a-card
// escape. A lab that already has a card, or any non-trial owner, sees nothing.
function TrialBanner({
  status,
  onAddCard,
  busy,
}: {
  status: ModelAStatus;
  onAddCard: () => void;
  busy: boolean;
}) {
  if (status.trialPaused) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
        <div className="text-sm font-bold text-amber-900">
          Your free trial has ended
        </div>
        <p className="mt-1 text-xs text-amber-800">
          Add a payment method to keep your lab active. Your local app keeps
          working and nothing is lost; cloud sync and sending resume the moment a
          card is on file.
        </p>
        <button type="button" className={`${btn} mt-3`} onClick={onAddCard} disabled={busy}>
          {busy ? "Opening..." : "Add a payment method"}
        </button>
      </div>
    );
  }
  if (status.trialPhase === "trialing" && status.trialEndsAt) {
    const days = daysUntil(status.trialEndsAt);
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-4">
        <div className="text-sm font-bold text-green-900">
          Free trial, {days} {days === 1 ? "day" : "days"} left
        </div>
        <p className="mt-1 text-xs text-green-800">
          Your free trial ends {formatTrialEnd(status.trialEndsAt)}. Add a payment
          method to keep your lab active when it does. You are not charged during
          the trial regardless of usage.
        </p>
        {!status.hasCard && (
          <button type="button" className={`${btnGhost} mt-3`} onClick={onAddCard} disabled={busy}>
            {busy ? "Opening..." : "Add a payment method"}
          </button>
        )}
      </div>
    );
  }
  return null;
}

function CardRow({ hasCard, busy, onAdd }: { hasCard: boolean; busy: boolean; onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between border-t border-border pt-4">
      <div>
        <div className="text-sm font-semibold text-foreground">Card on file</div>
        <div className="text-xs text-foreground-muted">
          {hasCard ? "Saved. Used only for the accrued balance." : "No card yet. Add one to keep your plan active."}
        </div>
      </div>
      <button type="button" className={btnGhost} onClick={onAdd} disabled={busy}>
        {busy ? "Opening..." : hasCard ? "Update card" : "Add a card"}
      </button>
    </div>
  );
}

function CapRow({ status, onChange }: { status: ModelAStatus; onChange: (s: ModelAStatus) => void }) {
  const [editing, setEditing] = useState(false);
  const [dollars, setDollars] = useState(status.capCents != null ? String(status.capCents / 100) : "");
  const [busy, setBusy] = useState(false);

  async function save(capCents: number | null) {
    setBusy(true);
    try {
      const res = await fetch("/api/billing/model-a/cap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capCents }),
      });
      if (res.ok) {
        onChange({ ...status, capCents });
        setEditing(false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between border-t border-border pt-4">
      <div>
        <div className="text-sm font-semibold text-foreground">Monthly cap</div>
        <div className="text-xs text-foreground-muted">
          {status.capCents != null
            ? `Cloud sync pauses past ${usd(status.capCents)} this month.`
            : "No cap. Set one to bound your monthly spend."}
        </div>
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground-muted">$</span>
          <input
            type="number"
            min={0}
            value={dollars}
            onChange={(e) => setDollars(e.target.value)}
            className="w-20 rounded-lg border border-border bg-surface-raised px-2 py-1 text-sm text-foreground"
          />
          <button
            type="button"
            className={btn}
            disabled={busy}
            onClick={() => {
              const n = Number(dollars);
              save(Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null);
            }}
          >
            Save
          </button>
          {status.capCents != null && (
            <button type="button" className={btnGhost} disabled={busy} onClick={() => save(null)}>
              Clear
            </button>
          )}
        </div>
      ) : (
        <button type="button" className={btnGhost} onClick={() => setEditing(true)}>
          {status.capCents != null ? "Change cap" : "Set a cap"}
        </button>
      )}
    </div>
  );
}

export default ModelABilling;
