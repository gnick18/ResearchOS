"use client";

// Institution tier Phase 4c: the usage + cost dashboard, one tier up from
// DeptDashboard. Reads GET /api/institution/usage and renders: the plan BUILDER
// (derived rate preview, no charging yet), usage by department (expandable to
// per-lab), and the over-time trend from the monthly snapshots. The dept roster +
// invite live in the parent InstitutionAdminPanel.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useMemo, useState } from "react";
import {
  deriveInstitutionRate,
  centsToUsd,
  INSTITUTION_RATE,
} from "@/lib/institution/plan";
import { bankSavingCents, priceForMethod } from "@/lib/billing/processing-fee";
import PayMethodChoice, {
  payOptionRequest,
  requestToPayOption,
  type OrgPayOption,
} from "@/components/billing/PayMethodChoice";

interface LabUsage {
  labHeadKey: string;
  label: string | null;
  bytes: number;
  syncs: number;
}
interface DeptUsage {
  deptId: string;
  name: string | null;
  bytes: number;
  syncs: number;
  labs: LabUsage[];
}
interface UsageResponse {
  institution: { institutionId: string; name: string } | null;
  totalBytes: number;
  totalSyncs: number;
  deptCount: number;
  labCount: number;
  depts: DeptUsage[];
  history: Array<{ ym: string; storageBytes: number; syncCount: number }>;
}

function fmtBytes(b: number): string {
  if (b >= 1e12) return (b / 1e12).toFixed(2) + " TB";
  if (b >= 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  return (b / 1e3).toFixed(0) + " KB";
}
const GB = 1e9;

interface BillingResponse {
  billingEnabled?: boolean;
  status?: string;
  method?: "invoice" | "automatic";
  payClass?: "card" | "bank";
  monthlyCents?: number;
  /** Present when an automatic setup needs the admin to finish Stripe Checkout. */
  url?: string;
}

export default function InstitutionDashboard() {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Plan builder inputs (also the inputs the procurement invoice derives from).
  // Total active labs across all member departments drives the sustaining
  // contribution, so a bigger department (more labs) contributes more.
  const [labs, setLabs] = useState(1);
  const [storageGb, setStorageGb] = useState(50);
  const [seeded, setSeeded] = useState(false);
  // Billing state. payOpt = how the institution pays (invoice/bank, auto variants).
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [payOpt, setPayOpt] = useState<OrgPayOption>("invoice_bank");
  // Billed outside the US: raises the card list price (an international card costs
  // us more). The bank rate stays low, so bank payers are unaffected.
  const [international, setInternational] = useState(false);
  const [poNumber, setPoNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/institution/billing");
        if (!res.ok) return;
        const data = (await res.json()) as BillingResponse;
        if (cancelled) return;
        setBilling(data);
        if (data.method && data.payClass) {
          setPayOpt(requestToPayOption(data.method, data.payClass));
        }
      } catch {
        /* best effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function activatePlan() {
    setSaving(true);
    setSaveMsg(null);
    const { method, payClass } = payOptionRequest(payOpt);
    try {
      const res = await fetch("/api/institution/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          labs,
          storageGb,
          method,
          payClass,
          international,
          poNumber: method === "invoice" && poNumber ? poNumber : undefined,
        }),
      });
      const data = (await res.json()) as BillingResponse & { error?: string };
      if (!res.ok) {
        setSaveMsg(data.error ?? "Could not set up billing.");
      } else if (data.status === "pending_checkout" && data.url) {
        window.location.href = data.url;
        return;
      } else {
        setBilling({ billingEnabled: true, status: data.status, method, payClass, monthlyCents: data.monthlyCents });
        setSaveMsg(
          method === "invoice"
            ? "Plan active. Stripe will email the invoice."
            : "Plan active. The card or bank on file is charged each cycle.",
        );
      }
    } catch {
      setSaveMsg("Could not reach the billing service.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/institution/usage");
        if (!res.ok) return;
        const data = (await res.json()) as UsageResponse;
        if (cancelled) return;
        setUsage(data);
        if (!seeded) {
          // Seed from observed usage: total labs across the institution + current
          // pooled GB rounded up, so the preview starts from reality.
          setLabs(Math.max(1, data.labCount));
          setStorageGb(Math.max(1, Math.ceil(data.totalBytes / GB)));
          setSeeded(true);
        }
      } catch {
        /* best effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seeded]);

  const rate = useMemo(
    () =>
      deriveInstitutionRate({ activeLabs: labs, storageGB: storageGb, international }),
    [labs, storageGb, international],
  );

  // The card list price is rate.totalCents; a bank debit pays a discount.
  const chosen = payOptionRequest(payOpt);
  const bankSave = bankSavingCents(rate.totalCents, international);
  const chargeCents =
    chosen.payClass === "bank"
      ? priceForMethod(rate.totalCents, "bank", international)
      : rate.totalCents;

  if (!usage) {
    return <p className="text-meta text-foreground-muted">Loading usage&hellip;</p>;
  }

  const histMax = Math.max(1, ...usage.history.map((h) => h.storageBytes));

  return (
    <div className="space-y-5">
      {/* Plan builder (rate preview). */}
      <div className="rounded-xl border border-dashed border-brand-action/50 bg-brand-action/5 p-4">
        <p className="text-meta font-semibold uppercase tracking-wide text-brand-action">
          Build your plan
        </p>
        <p className="mt-1 text-meta text-foreground-muted">
          No fixed tiers. Set the total labs across your departments and pooled
          storage; the monthly rate derives (cost recovery plus a per-active-lab
          sustaining contribution), so it scales with how big each department
          actually is. Adjustable any month, no lock-in.
        </p>
        <div className="mt-3 flex flex-wrap gap-5">
          <Stepper label="Active labs (all depts)" value={labs} onChange={(d) => setLabs((v) => Math.max(0, v + d))} />
          <Stepper label="Pooled storage" value={storageGb} suffix=" GB" onChange={(d) => setStorageGb((v) => Math.max(0, v + d * 50))} />
        </div>
        <label className="mt-3 flex items-center gap-2 text-meta text-foreground-muted">
          <input
            type="checkbox"
            checked={international}
            onChange={(e) => setInternational(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Billed outside the US (passes the higher international processing cost through)
        </label>
        <div className="mt-3 rounded-lg bg-surface-sunken px-3 py-2 text-meta text-foreground-muted">
          Cost recovery (<b className="text-foreground">{storageGb} GB</b>){" "}
          {centsToUsd(rate.recoveryCents)} + Sustaining (
          {centsToUsd(INSTITUTION_RATE.perLabSustainCents)}/lab &times; {labs}){" "}
          {centsToUsd(rate.sustainCents)}
          {international && (
            <>
              {" "}
              + International processing {centsToUsd(rate.intlFeeCents)}
            </>
          )}
        </div>
        <p className="mt-2 text-heading font-bold text-foreground">
          {centsToUsd(chargeCents)}
          <span className="text-body font-medium text-foreground-muted">/mo</span>
          {chosen.payClass === "bank" && bankSave > 0 && (
            <span className="ml-2 text-meta font-medium text-foreground-muted">
              card list {centsToUsd(rate.totalCents)}, bank transfer saves{" "}
              {centsToUsd(bankSave)}
            </span>
          )}
        </p>

        {billing?.billingEnabled ? (
          <div className="mt-4 border-t border-brand-action/30 pt-3">
            {billing.status === "active" ? (
              <p className="text-meta text-foreground">
                Billing active at <b>{centsToUsd(billing.monthlyCents ?? 0)}/mo</b>
                {billing.method === "automatic"
                  ? billing.payClass === "card"
                    ? ", auto-charged to the card on file."
                    : ", auto-charged to the bank account on file."
                  : ", invoiced to your email on net 30 terms, paid by bank transfer."}{" "}
                Adjust the plan above and update any time.
              </p>
            ) : (
              <p className="text-meta text-foreground-muted">
                Choose how to pay, then activate. The first charge covers this cycle.
              </p>
            )}

            <PayMethodChoice
              value={payOpt}
              onChange={setPayOpt}
              bankSaving={bankSave > 0 ? centsToUsd(bankSave) : undefined}
            />

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {chosen.method === "invoice" && (
                <input
                  type="text"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                  placeholder="PO number (optional)"
                  className="h-8 rounded-lg border border-border bg-surface px-2 text-meta text-foreground"
                />
              )}
              <button
                type="button"
                onClick={activatePlan}
                disabled={saving}
                className="h-8 rounded-lg bg-brand-action px-3 text-meta font-semibold text-white disabled:opacity-60"
              >
                {saving
                  ? "Saving…"
                  : billing.status === "active"
                    ? "Update plan"
                    : chosen.method === "automatic"
                      ? chosen.payClass === "card"
                        ? "Add a card"
                        : "Add a bank account"
                      : "Activate billing"}
              </button>
              {saveMsg && <span className="text-meta text-foreground-muted">{saveMsg}</span>}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-meta text-foreground-muted">
            Billing is off during the beta; this is a live preview of your rate.
          </p>
        )}
      </div>

      {/* Usage by department. */}
      <div className="rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-body font-medium text-foreground">Usage by department</h2>
          <span className="text-meta text-foreground-muted">click a department for labs</span>
          <span className="ml-auto text-meta text-foreground-muted">
            Total {fmtBytes(usage.totalBytes)} &middot; {usage.totalSyncs} syncs
          </span>
        </div>
        {usage.depts.length === 0 ? (
          <p className="px-4 py-5 text-meta text-foreground-muted">
            No active departments yet. Invite a department admin below; their usage
            appears here once they join.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {usage.depts.map((d) => {
              const pct = usage.totalBytes
                ? Math.round((d.bytes / usage.totalBytes) * 100)
                : 0;
              const isOpen = open.has(d.deptId);
              return (
                <li key={d.deptId}>
                  <button
                    type="button"
                    onClick={() =>
                      setOpen((s) => {
                        const n = new Set(s);
                        n.has(d.deptId) ? n.delete(d.deptId) : n.add(d.deptId);
                        return n;
                      })
                    }
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-hover"
                  >
                    <span className="text-foreground-muted">{isOpen ? "▾" : "▸"}</span>
                    <span className="min-w-0 flex-1 truncate text-body text-foreground">
                      {d.name ?? `${d.deptId.slice(0, 10)}…`}
                    </span>
                    <span className="text-meta text-foreground-muted">{d.labs.length} labs</span>
                    <span className="w-20 text-right text-meta tabular-nums text-foreground">
                      {fmtBytes(d.bytes)}
                    </span>
                    <span className="w-12 text-right text-meta text-foreground-muted">{pct}%</span>
                  </button>
                  {isOpen && (
                    <ul className="bg-surface-sunken">
                      {d.labs.length === 0 ? (
                        <li className="px-4 py-1.5 pl-10 text-meta text-foreground-muted">
                          No active labs in this department yet.
                        </li>
                      ) : (
                        d.labs.map((l) => (
                          <li
                            key={l.labHeadKey}
                            className="flex items-center gap-3 px-4 py-1.5 pl-10 text-meta text-foreground-muted"
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {l.label ?? `${l.labHeadKey.slice(0, 10)}…`}
                            </span>
                            <span className="w-20 text-right tabular-nums">{fmtBytes(l.bytes)}</span>
                            <span className="w-16 text-right">{l.syncs} syncs</span>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Over time. */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-body font-medium text-foreground">Usage over time</h2>
        <p className="mt-0.5 text-meta text-foreground-muted">
          Pooled storage by month. Builds up as snapshots accrue each time you open
          this page.
        </p>
        {usage.history.length <= 1 ? (
          <p className="mt-3 text-meta text-foreground-muted">
            Not enough history yet. Check back next month to see the trend.
          </p>
        ) : (
          <div className="mt-3 flex items-end gap-2" style={{ height: 90 }}>
            {usage.history.map((h) => (
              <div key={h.ym} className="flex flex-1 flex-col items-center justify-end gap-1" style={{ height: "100%" }}>
                <span className="text-meta text-foreground-muted">{fmtBytes(h.storageBytes)}</span>
                <div
                  className="w-full max-w-[34px] rounded-t bg-brand-action"
                  style={{ height: Math.round((h.storageBytes / histMax) * 60) }}
                />
                <span className="text-meta text-foreground-muted">{h.ym.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  suffix?: string;
  onChange: (delta: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-meta font-medium text-foreground-muted">{label}</span>
      <div className="flex items-center overflow-hidden rounded-lg border border-border bg-surface">
        <button
          type="button"
          onClick={() => onChange(-1)}
          className="h-8 w-8 bg-surface-sunken text-body font-bold text-foreground"
        >
          &minus;
        </button>
        <span className="min-w-[70px] px-3 text-center text-meta font-semibold tabular-nums">
          {value}
          {suffix}
        </span>
        <button
          type="button"
          onClick={() => onChange(1)}
          className="h-8 w-8 bg-surface-sunken text-body font-bold text-foreground"
        >
          +
        </button>
      </div>
    </div>
  );
}
