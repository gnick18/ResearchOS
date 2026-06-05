"use client";

// Operator-only LLC business tab (rendered at /admin/business).
//
// Grant-only. Fetches /api/admin/business, which is gated on ADMIN_EMAILS and
// SHARING_ENABLED, so a non-admin or a signed-out visitor just sees "not
// authorized", no data. Entity facts, a deadline strip, money in / money out,
// and the tax-reserve + safe-to-draw math. It is an organizer, NOT the legal
// registered agent and NOT a tax preparer, which the footer says plainly.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Inline SVG.

import { useCallback, useEffect, useState } from "react";

import Link from "next/link";
import AppFooter from "@/components/AppFooter";
import {
  computeSummary,
  formatUSD,
  upcomingDeadlines,
  type BusinessSummary,
  type Deadline,
  type EntityConfig,
  type LedgerDirection,
  type LedgerEntry,
} from "@/lib/business/calc";

interface BusinessData {
  entity: EntityConfig;
  ledger: LedgerEntry[];
  summary: BusinessSummary;
  deadlines: Deadline[];
}

type State =
  | { phase: "loading" }
  | { phase: "denied" }
  | { phase: "error" }
  | { phase: "ready"; data: BusinessData };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <span className="text-body font-semibold text-gray-700">
            ResearchOS business
          </span>
          <div className="flex items-center gap-4">
            <Link
              href="/admin"
              className="text-body font-medium text-sky-700 underline-offset-2 hover:underline"
            >
              Operator metrics
            </Link>
            <Link
              href="/"
              className="text-body font-medium text-sky-700 underline-offset-2 hover:underline"
            >
              Back to the app
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">{children}</main>
      <AppFooter />
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "reserve";
}) {
  const valueClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "reserve"
        ? "text-amber-700"
        : "text-gray-900";
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <p className="text-meta font-medium uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p className={`mt-1 text-display font-bold tracking-tight ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}

function deadlineTone(daysUntil: number): { box: string; text: string; chip: string } {
  if (daysUntil < 0) {
    return {
      box: "border-rose-200 bg-rose-50",
      text: "text-rose-700",
      chip: "overdue",
    };
  }
  if (daysUntil <= 14) {
    return {
      box: "border-amber-200 bg-amber-50",
      text: "text-amber-700",
      chip: `in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`,
    };
  }
  return {
    box: "border-gray-200 bg-white",
    text: "text-gray-500",
    chip: `in ${daysUntil} days`,
  };
}

function DeadlineStrip({ deadlines }: { deadlines: Deadline[] }) {
  if (!deadlines.length) {
    return (
      <p className="text-body text-gray-500">
        Add a formation date below to compute the Wisconsin annual-report deadline.
      </p>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {deadlines.map((d) => {
        const tone = deadlineTone(d.daysUntil);
        return (
          <div key={d.key} className={`rounded-xl border p-4 ${tone.box}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-body font-medium text-gray-800">{d.label}</span>
              <span className={`shrink-0 text-meta font-semibold ${tone.text}`}>
                {tone.chip}
              </span>
            </div>
            <p className="mt-1 text-meta text-gray-500">Due {d.dueDate}</p>
            {d.note ? <p className="mt-1 text-meta text-gray-400">{d.note}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

// --- editable entity card ---

function EntityCard({
  entity,
  onSave,
}: {
  entity: EntityConfig;
  onSave: (e: EntityConfig) => Promise<void>;
}) {
  const [form, setForm] = useState<EntityConfig>(entity);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm(entity);
  }, [entity]);

  const field = (label: string, node: React.ReactNode) => (
    <label className="block">
      <span className="text-meta font-medium text-gray-500">{label}</span>
      <div className="mt-1">{node}</div>
    </label>
  );
  const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-body";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {field(
          "LLC legal name",
          <input
            className={input}
            value={form.legalName}
            onChange={(e) => setForm({ ...form, legalName: e.target.value })}
          />,
        )}
        {field(
          "State",
          <input
            className={input}
            value={form.state}
            onChange={(e) => setForm({ ...form, state: e.target.value })}
          />,
        )}
        {field(
          "Formation date",
          <input
            type="date"
            className={input}
            value={form.formationDate ?? ""}
            onChange={(e) =>
              setForm({ ...form, formationDate: e.target.value || null })
            }
          />,
        )}
        {field(
          "EIN",
          <input
            className={input}
            placeholder="00-0000000"
            value={form.ein ?? ""}
            onChange={(e) => setForm({ ...form, ein: e.target.value || null })}
          />,
        )}
        {field(
          "Registered agent",
          <input
            className={input}
            value={form.registeredAgent ?? ""}
            onChange={(e) =>
              setForm({ ...form, registeredAgent: e.target.value || null })
            }
          />,
        )}
        {field(
          "Bank account label",
          <input
            className={input}
            placeholder="e.g. Mercury checking (not the number)"
            value={form.bankLabel ?? ""}
            onChange={(e) => setForm({ ...form, bankLabel: e.target.value || null })}
          />,
        )}
        {field(
          "Tax reserve %",
          <input
            type="number"
            min={0}
            max={100}
            className={input}
            value={form.reservePct}
            onChange={(e) =>
              setForm({ ...form, reservePct: Number(e.target.value) })
            }
          />,
        )}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setSaved(false);
            try {
              await onSave(form);
              setSaved(true);
            } finally {
              setSaving(false);
            }
          }}
          className="rounded-lg bg-sky-600 px-4 py-2 text-body font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save entity facts"}
        </button>
        {saved ? <span className="text-meta text-emerald-600">Saved.</span> : null}
        <span className="text-meta text-gray-400">
          The reserve % is a placeholder until your accountant sets it.
        </span>
      </div>
    </div>
  );
}

// --- add-entry form + ledger table ---

const EMPTY_ENTRY = {
  date: new Date().toISOString().slice(0, 10),
  direction: "out" as LedgerDirection,
  category: "",
  dollars: "",
  note: "",
};

function Ledger({
  ledger,
  onAdd,
  onDelete,
}: {
  ledger: LedgerEntry[];
  onAdd: (e: {
    date: string;
    direction: LedgerDirection;
    category: string;
    amountCents: number;
    note: string;
  }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [form, setForm] = useState(EMPTY_ENTRY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = "rounded-lg border border-gray-300 px-3 py-2 text-body";

  const submit = async () => {
    const amountCents = Math.round(parseFloat(form.dollars) * 100);
    if (!form.date) {
      setErr("Pick a date.");
      return;
    }
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setErr("Enter an amount greater than zero.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await onAdd({
        date: form.date,
        direction: form.direction,
        category: form.category.trim(),
        amountCents,
        note: form.note.trim(),
      });
      setForm({ ...EMPTY_ENTRY, date: form.date });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col">
          <span className="text-meta text-gray-500">Date</span>
          <input
            type="date"
            className={`mt-1 ${input}`}
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <span className="text-meta text-gray-500">Direction</span>
          <select
            className={`mt-1 ${input}`}
            value={form.direction}
            onChange={(e) =>
              setForm({ ...form, direction: e.target.value as LedgerDirection })
            }
          >
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-meta text-gray-500">Category</span>
          <input
            className={`mt-1 ${input}`}
            placeholder="Neon, Stripe, donation..."
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <span className="text-meta text-gray-500">Amount (USD)</span>
          <input
            inputMode="decimal"
            className={`mt-1 w-28 ${input}`}
            placeholder="0.00"
            value={form.dollars}
            onChange={(e) => setForm({ ...form, dollars: e.target.value })}
          />
        </label>
        <label className="flex flex-1 flex-col">
          <span className="text-meta text-gray-500">Note</span>
          <input
            className={`mt-1 ${input}`}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="rounded-lg bg-sky-600 px-4 py-2 text-body font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {busy ? "Adding..." : "Add"}
        </button>
      </div>
      {err ? <p className="mt-2 text-meta text-rose-600">{err}</p> : null}

      <div className="mt-5 overflow-x-auto">
        {ledger.length === 0 ? (
          <p className="text-body text-gray-500">
            No entries yet. Add your first income or expense above.
          </p>
        ) : (
          <table className="w-full text-left text-meta">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="px-2 py-2 font-semibold">Date</th>
                <th className="px-2 py-2 font-semibold">Category</th>
                <th className="px-2 py-2 font-semibold">Note</th>
                <th className="px-2 py-2 text-right font-semibold">Amount</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-2 py-2 text-gray-600">{e.date}</td>
                  <td className="px-2 py-2 text-gray-800">{e.category || "-"}</td>
                  <td className="px-2 py-2 text-gray-500">{e.note || "-"}</td>
                  <td
                    className={`px-2 py-2 text-right font-mono ${
                      e.direction === "in" ? "text-emerald-700" : "text-gray-700"
                    }`}
                  >
                    {e.direction === "in" ? "+" : "-"}
                    {formatUSD(e.amountCents)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onDelete(e.id)}
                      className="text-meta text-gray-400 hover:text-rose-600"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-3 mt-10 first:mt-0">
      <h2 className="text-title font-semibold text-gray-900">{children}</h2>
      {sub ? <p className="mt-1 text-meta text-gray-400 leading-relaxed">{sub}</p> : null}
    </div>
  );
}

export default function BusinessTracker() {
  const [state, setState] = useState<State>({ phase: "loading" });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/business");
      if (res.status === 404 || res.status === 401) {
        setState({ phase: "denied" });
        return;
      }
      if (!res.ok) {
        setState({ phase: "error" });
        return;
      }
      const data = (await res.json()) as BusinessData;
      setState({ phase: "ready", data });
    } catch {
      setState({ phase: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveEntity = async (entity: EntityConfig) => {
    await fetch("/api/admin/business", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "upsertEntity", entity }),
    });
    // Recompute deadlines/summary client-side for an instant update, then
    // reconcile with a refetch.
    setState((s) =>
      s.phase === "ready"
        ? {
            phase: "ready",
            data: {
              ...s.data,
              entity,
              summary: computeSummary(s.data.ledger, entity.reservePct),
              deadlines: upcomingDeadlines(entity, new Date()),
            },
          }
        : s,
    );
    await load();
  };

  const addEntry = async (entry: {
    date: string;
    direction: LedgerDirection;
    category: string;
    amountCents: number;
    note: string;
  }) => {
    await fetch("/api/admin/business", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "addEntry", entry }),
    });
    await load();
  };

  const deleteEntry = async (id: number) => {
    await fetch("/api/admin/business", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "deleteEntry", id }),
    });
    await load();
  };

  if (state.phase === "loading") {
    return (
      <Shell>
        <p className="text-body text-gray-500">Loading...</p>
      </Shell>
    );
  }
  if (state.phase === "denied") {
    return (
      <Shell>
        <p className="text-body text-gray-600 leading-relaxed">
          Not authorized. This page is for operator accounts on the ADMIN_EMAILS
          allow-list, and it is dark unless sharing is enabled on this deployment.
        </p>
      </Shell>
    );
  }
  if (state.phase === "error") {
    return (
      <Shell>
        <p className="text-body text-gray-600 leading-relaxed">
          Could not load the business data right now. Try again in a moment.
        </p>
      </Shell>
    );
  }

  const { entity, ledger, summary, deadlines } = state.data;

  return (
    <Shell>
      <h1 className="text-heading font-bold tracking-tight text-gray-900">
        LLC business
      </h1>
      <p className="mt-1 text-meta text-gray-400 leading-relaxed">
        Private operations and finances for the ResearchOS LLC. Aggregate,
        operator-only, never shown to any user.
      </p>

      <div className="mt-8">
        <SectionTitle sub="The next obligations, soonest first. Verify the exact dates and fees with the WI DFI and your accountant.">
          Deadlines
        </SectionTitle>
        <DeadlineStrip deadlines={deadlines} />
      </div>

      <SectionTitle sub="Money in minus money out, then the tax reserve held back, then what is safe to draw.">
        Where things stand
      </SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Money in" value={formatUSD(summary.moneyInCents)} />
        <StatCard label="Money out" value={formatUSD(summary.moneyOutCents)} />
        <StatCard label="Net" value={formatUSD(summary.netCents)} />
        <StatCard
          label={`Tax reserve (${entity.reservePct}%)`}
          value={formatUSD(summary.reserveCents)}
          tone="reserve"
        />
        <StatCard
          label="Safe to draw"
          value={formatUSD(summary.safeToDrawCents)}
          tone="good"
        />
      </div>

      <SectionTitle>Entity facts</SectionTitle>
      <EntityCard entity={entity} onSave={saveEntity} />

      <SectionTitle sub="Every income and expense. Infrastructure bills can be auto-estimated later; for now, enter them by hand.">
        Ledger
      </SectionTitle>
      <Ledger ledger={ledger} onAdd={addEntry} onDelete={deleteEntry} />

      <p className="mt-8 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-meta text-gray-500 leading-relaxed">
        This tracker is an organizer, not a legal or tax service. It is not the
        LLC&apos;s registered agent (Wisconsin requires a person with a physical
        in-state address for that), and it does not prepare or file taxes. Use it
        to stay on top of dates and cash, and have an accountant set the reserve
        percentage and handle the filings.
      </p>
    </Shell>
  );
}
