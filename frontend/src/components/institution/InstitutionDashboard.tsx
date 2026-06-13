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
const TB = 1e12;

interface BillingResponse {
  billingEnabled?: boolean;
  status?: string;
  monthlyCents?: number;
}

export default function InstitutionDashboard() {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Plan builder inputs (also the inputs the procurement invoice derives from).
  const [depts, setDepts] = useState(1);
  const [storageTb, setStorageTb] = useState(1);
  const [seeded, setSeeded] = useState(false);
  // Billing state (the send-invoice procurement subscription).
  const [billing, setBilling] = useState<BillingResponse | null>(null);
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
        if (!cancelled) setBilling(data);
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
    try {
      const res = await fetch("/api/institution/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ depts, storageTb, poNumber: poNumber || undefined }),
      });
      const data = (await res.json()) as BillingResponse & { error?: string };
      if (!res.ok) {
        setSaveMsg(data.error ?? "Could not set up billing.");
      } else {
        setBilling({ billingEnabled: true, status: data.status, monthlyCents: data.monthlyCents });
        setSaveMsg(
          data.status === "active"
            ? "Plan active. Stripe will email the invoice."
            : "Plan saved.",
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
          // Seed the builder from observed usage: depts = current count, storage
          // = next whole TB above current pooled use (min 1).
          setDepts(Math.max(1, data.deptCount));
          setStorageTb(Math.max(1, Math.ceil(data.totalBytes / TB)));
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
    () => deriveInstitutionRate({ depts, storageTb }),
    [depts, storageTb],
  );

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
          No fixed tiers. Set your departments and pooled storage; the monthly rate
          derives (cost recovery plus a per-active-department sustaining
          contribution). Adjustable any month, no lock-in.
        </p>
        <div className="mt-3 flex flex-wrap gap-5">
          <Stepper label="Active departments" value={depts} onChange={(d) => setDepts((v) => Math.max(0, v + d))} />
          <Stepper label="Pooled storage" value={storageTb} suffix=" TB" onChange={(d) => setStorageTb((v) => Math.max(1, v + d))} />
        </div>
        <div className="mt-3 rounded-lg bg-surface-sunken px-3 py-2 text-meta text-foreground-muted">
          Cost recovery (<b className="text-foreground">{storageTb} TB</b>){" "}
          {centsToUsd(rate.storageCents)} + Sustaining (
          {centsToUsd(INSTITUTION_RATE.perDeptSustainCents)}/dept &times; {depts}){" "}
          {centsToUsd(rate.sustainCents)}
        </div>
        <p className="mt-2 text-heading font-bold text-foreground">
          {centsToUsd(rate.totalCents)}
          <span className="text-body font-medium text-foreground-muted">/mo</span>
        </p>

        {billing?.billingEnabled ? (
          <div className="mt-4 border-t border-brand-action/30 pt-3">
            {billing.status === "active" ? (
              <p className="text-meta text-foreground">
                Billing active at{" "}
                <b>{centsToUsd(billing.monthlyCents ?? 0)}/mo</b>. Stripe emails the
                invoice with net 30 terms. Adjust the plan above and update any time.
              </p>
            ) : (
              <p className="text-meta text-foreground-muted">
                Activate the plan to start a monthly invoice (sent to your email,
                net 30, PO and ACH or card). The first invoice covers this cycle.
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                placeholder="PO number (optional)"
                className="h-8 rounded-lg border border-border bg-surface px-2 text-meta text-foreground"
              />
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
