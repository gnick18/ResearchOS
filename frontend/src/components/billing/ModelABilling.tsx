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

export interface ModelAStatus {
  planId: "free" | "solo" | "lab" | "dept";
  accruedCents: number;
  capCents: number | null;
  hasCard: boolean;
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
  return status.planId === "free" ? (
    <FreePanel />
  ) : (
    <PaidPanel status={status} onChange={onChange} />
  );
}

// ---- Free owner: the upgrade pitch ----
function FreePanel() {
  const [busy, setBusy] = useState<PaidPlanId | null>(null);

  async function start(planId: PaidPlanId) {
    setBusy(planId);
    try {
      const res = await fetch("/api/billing/model-a/card-setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const data = (await res.json()) as { url?: string };
      if (data.url) window.location.href = data.url;
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
        {(["solo", "lab"] as PaidPlanId[]).map((id) => {
          const p = PLAN_PRICES[id];
          return (
            <div key={id} className="rounded-xl border border-border p-4">
              <div className="font-bold text-foreground">{p.name}</div>
              <div className="mt-0.5 text-sm text-foreground-muted">
                <span className="font-semibold text-foreground">{p.base}</span>
                {p.baseSuffix} plus your cloud usage
              </div>
              <button
                type="button"
                className={`${btn} mt-3 w-full`}
                onClick={() => start(id)}
                disabled={busy !== null}
              >
                {busy === id ? "Starting..." : `Start ${p.name}`}
              </button>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-foreground-muted">
        We save a card now and only charge it once your usage passes $5, or at
        cancellation. You set a monthly cap so there are never surprises.
      </p>
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
    </div>
  );
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
