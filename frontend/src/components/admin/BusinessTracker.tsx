"use client";

// Operator-only LLC business tab (rendered at /business; moved from
// /admin/business 2026-06-10).
//
// Grant-only. Fetches /api/admin/business, which is gated on ADMIN_EMAILS and
// SHARING_ENABLED, so a non-admin or a signed-out visitor just sees "not
// authorized", no data. Entity facts, a deadline strip, money in / money out,
// and the tax-reserve + safe-to-draw math. It is an organizer, NOT the legal
// registered agent and NOT a tax preparer, which the footer says plainly.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Inline SVG.

import { useCallback, useEffect, useState } from "react";
import OperatorSignIn from "@/components/admin/OperatorSignIn";

import Link from "next/link";
import AppFooter from "@/components/AppFooter";
import CostBreakerPanel from "@/components/admin/CostBreakerPanel";
import GiftPoolsPanel from "@/components/admin/GiftPoolsPanel";
import SpendByCategoryPanel from "@/components/admin/SpendByCategoryPanel";
import PriceModelingModal from "@/components/admin/PriceModelingModal";
import { Icon } from "@/components/icons";
import {
  computeReimbursement,
  computeSummary,
  emailArchiveMarkdown,
  formatUSD,
  isReimbursementSettlement,
  monthlyBurnCents,
  subscriptionDeadlines,
  upcomingDeadlines,
  vercelOssApplicationDeadline,
  type BusinessEmail,
  type BusinessSummary,
  type BusinessTask,
  type Deadline,
  type EntityConfig,
  type LedgerDirection,
  type LedgerEntry,
  type PaymentMethod,
  type PaymentMethodKind,
  type Subscription,
  type SubscriptionCadence,
} from "@/lib/business/calc";
import { INFRA_TIERS, INFRA_TIERS_CHECKED, INFRA_TIERS_NOTE } from "@/lib/business/infra-tiers";
import {
  TAX_CATEGORIES,
  taxCategoryLabel,
  taxCategoryScheduleC,
} from "@/lib/business/tax-categories";
import type { InfraCostEstimate } from "@/lib/sharing/capacity-shared";

interface BusinessData {
  entity: EntityConfig;
  ledger: LedgerEntry[];
  tasks: BusinessTask[];
  emails: BusinessEmail[];
  paymentMethods: PaymentMethod[];
  subscriptions: Subscription[];
  summary: BusinessSummary;
  deadlines: Deadline[];
  infraEstimate: InfraCostEstimate;
}

type State =
  | { phase: "loading" }
  | { phase: "denied" }
  | { phase: "error" }
  | { phase: "ready"; data: BusinessData };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-sunken text-foreground">
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
          <span className="text-body font-semibold text-foreground">
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
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-6 py-10">{children}</main>
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
        : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5">
      <p className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
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
    box: "border-border bg-surface-raised",
    text: "text-foreground-muted",
    chip: `in ${daysUntil} days`,
  };
}

function DeadlineStrip({ deadlines }: { deadlines: Deadline[] }) {
  if (!deadlines.length) {
    return (
      <p className="text-body text-foreground-muted">
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
              <span className="text-body font-medium text-foreground">{d.label}</span>
              <span className={`shrink-0 text-meta font-semibold ${tone.text}`}>
                {tone.chip}
              </span>
            </div>
            <p className="mt-1 text-meta text-foreground-muted">Due {d.dueDate}</p>
            {d.note ? <p className="mt-1 text-meta text-foreground-muted">{d.note}</p> : null}
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

  // Re-sync the form when a fresh entity arrives (after a save/refetch), using
  // the adjust-state-during-render pattern rather than an effect.
  const [syncedFrom, setSyncedFrom] = useState(entity);
  if (syncedFrom !== entity) {
    setSyncedFrom(entity);
    setForm(entity);
  }

  const field = (label: string, node: React.ReactNode) => (
    <label className="block">
      <span className="text-meta font-medium text-foreground-muted">{label}</span>
      <div className="mt-1">{node}</div>
    </label>
  );
  const input = "w-full rounded-lg border border-border px-3 py-2 text-body";

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5">
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
          "Entity ID (state filing)",
          <input
            className={input}
            placeholder="R098462"
            value={form.entityId ?? ""}
            onChange={(e) => setForm({ ...form, entityId: e.target.value || null })}
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
          "D-U-N-S number",
          <>
            <input
              className={input}
              placeholder="9-digit Dun & Bradstreet ID"
              value={form.duns ?? ""}
              onChange={(e) => setForm({ ...form, duns: e.target.value || null })}
            />
            <p className="mt-1 text-meta text-foreground-muted">
              Required to enroll the Apple and Google Play accounts under the LLC
              as an organization.
            </p>
          </>,
        )}
        {field(
          "Business phone",
          <>
            <input
              className={input}
              placeholder="+1 (608) 895-6655"
              value={form.businessPhone ?? ""}
              onChange={(e) =>
                setForm({ ...form, businessPhone: e.target.value || null })
              }
            />
            <p className="mt-1 text-meta text-foreground-muted">
              The LLC public line (Tello prepaid eSIM), the verified contact for
              the Apple and Google Play developer accounts.
            </p>
          </>,
        )}
        {field(
          "Apple enrollment ID",
          <input
            className={input}
            placeholder="PTR262UUT9"
            value={form.appleEnrollmentId ?? ""}
            onChange={(e) =>
              setForm({ ...form, appleEnrollmentId: e.target.value || null })
            }
          />,
        )}
        {field(
          "Apple enrollment date (renews yearly)",
          <>
            <input
              type="date"
              className={input}
              value={form.appleEnrollmentDate ?? ""}
              onChange={(e) =>
                setForm({ ...form, appleEnrollmentDate: e.target.value || null })
              }
            />
            <p className="mt-1 text-meta text-foreground-muted">
              $99/year membership. Auto-logged to the ledger once a date is set.
            </p>
          </>,
        )}
        {field(
          "Google Play account",
          <>
            <input
              className={input}
              placeholder="gnick317@gmail.com / dev account ID"
              value={form.googlePlayAccount ?? ""}
              onChange={(e) =>
                setForm({ ...form, googlePlayAccount: e.target.value || null })
              }
            />
            <p className="mt-1 text-meta text-foreground-muted">
              $25 one-time registration fee. Auto-logged to the ledger once the
              account is filled in.
            </p>
          </>,
        )}
        {field(
          "Google Play registration date",
          <input
            type="date"
            className={input}
            value={form.googleEnrollmentDate ?? ""}
            onChange={(e) =>
              setForm({ ...form, googleEnrollmentDate: e.target.value || null })
            }
          />,
        )}
        {field(
          "Bank account label",
          <input
            className={input}
            placeholder="e.g. business checking (not the number)"
            value={form.bankLabel ?? ""}
            onChange={(e) => setForm({ ...form, bankLabel: e.target.value || null })}
          />,
        )}
        {field(
          "Documents folder",
          <input
            className={input}
            placeholder="ResearchOS_LLC/"
            value={form.docsFolder ?? ""}
            onChange={(e) => setForm({ ...form, docsFolder: e.target.value || null })}
          />,
        )}
        {field(
          "WI sales-tax status",
          <select
            className={input}
            value={form.salesTaxStatus}
            onChange={(e) =>
              setForm({
                ...form,
                salesTaxStatus: e.target.value as EntityConfig["salesTaxStatus"],
              })
            }
          >
            <option value="pending">Pending (awaiting WI DOR)</option>
            <option value="exempt">Exempt (not taxable)</option>
            <option value="taxable">Taxable (register first)</option>
          </select>,
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
      <label className="mt-4 block">
        <span className="text-meta font-medium text-foreground-muted">Sales-tax note</span>
        <input
          className={`${input} mt-1`}
          placeholder="DOR filing / reply details"
          value={form.salesTaxNote ?? ""}
          onChange={(e) => setForm({ ...form, salesTaxNote: e.target.value || null })}
        />
      </label>
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
          className="rounded-lg bg-brand-action px-4 py-2 text-body font-semibold text-white hover:bg-brand-action/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save entity facts"}
        </button>
        {saved ? <span className="text-meta text-emerald-600">Saved.</span> : null}
        <span className="text-meta text-foreground-muted">
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
  taxCategory: "",
  paidWith: "" as string,
};

function Ledger({
  ledger,
  methods,
  onAdd,
  onDelete,
  onUpdateTax,
  onSetPaidWith,
}: {
  ledger: LedgerEntry[];
  methods: PaymentMethod[];
  onAdd: (e: {
    date: string;
    direction: LedgerDirection;
    category: string;
    amountCents: number;
    note: string;
    taxCategory: string;
    paidWith: number | null;
  }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onUpdateTax: (id: number, taxCategory: string) => Promise<void>;
  onSetPaidWith: (id: number, paidWith: number | null) => Promise<void>;
}) {
  const [form, setForm] = useState(EMPTY_ENTRY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = "rounded-lg border border-border px-3 py-2 text-body";

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
        taxCategory: form.taxCategory,
        paidWith: form.paidWith ? Number(form.paidWith) : null,
      });
      setForm({ ...EMPTY_ENTRY, date: form.date });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col">
          <span className="text-meta text-foreground-muted">Date</span>
          <input
            type="date"
            className={`mt-1 ${input}`}
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <span className="text-meta text-foreground-muted">Direction</span>
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
          <span className="text-meta text-foreground-muted">Category</span>
          <input
            className={`mt-1 ${input}`}
            placeholder="Neon, Stripe, donation..."
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <span className="text-meta text-foreground-muted">Tax category</span>
          <select
            className={`mt-1 ${input}`}
            value={form.taxCategory}
            onChange={(e) => setForm({ ...form, taxCategory: e.target.value })}
          >
            <option value="">Uncategorized</option>
            {TAX_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-meta text-foreground-muted">Amount (USD)</span>
          <input
            inputMode="decimal"
            className={`mt-1 w-28 ${input}`}
            placeholder="0.00"
            value={form.dollars}
            onChange={(e) => setForm({ ...form, dollars: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <span className="text-meta text-foreground-muted">Paid with</span>
          <select
            className={`mt-1 ${input}`}
            value={form.paidWith}
            onChange={(e) => setForm({ ...form, paidWith: e.target.value })}
          >
            <option value="">Untagged</option>
            {methods.map((m) => (
              <option key={m.id} value={String(m.id)}>
                {paymentMethodLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col">
          <span className="text-meta text-foreground-muted">Note</span>
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
          className="rounded-lg bg-brand-action px-4 py-2 text-body font-semibold text-white hover:bg-brand-action/90 disabled:opacity-50"
        >
          {busy ? "Adding..." : "Add"}
        </button>
      </div>
      {err ? <p className="mt-2 text-meta text-rose-600">{err}</p> : null}

      <div className="mt-5 overflow-x-auto">
        {ledger.length === 0 ? (
          <p className="text-body text-foreground-muted">
            No entries yet. Add your first income or expense above.
          </p>
        ) : (
          <table className="w-full text-left text-meta">
            <thead>
              <tr className="border-b border-border text-foreground-muted">
                <th className="px-2 py-2 font-semibold">Date</th>
                <th className="px-2 py-2 font-semibold">Category</th>
                <th className="px-2 py-2 font-semibold">Tax category</th>
                <th className="px-2 py-2 font-semibold">Paid with</th>
                <th className="px-2 py-2 font-semibold">Note</th>
                <th className="px-2 py-2 text-right font-semibold">Amount</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-2 text-foreground-muted">{e.date}</td>
                  <td className="px-2 py-2 text-foreground">{e.category || "-"}</td>
                  <td className="px-2 py-2 text-foreground-muted">
                    {e.direction === "in" ? (
                      "-"
                    ) : (
                      <select
                        value={e.taxCategory}
                        onChange={(ev) => onUpdateTax(e.id, ev.target.value)}
                        className={`rounded-md border px-1.5 py-1 text-meta ${
                          e.taxCategory
                            ? "border-border bg-transparent text-foreground-muted"
                            : "border-amber-400 bg-amber-50 text-amber-800"
                        }`}
                        title="Set the Schedule C tax category for this expense"
                      >
                        <option value="">Uncategorized</option>
                        {TAX_CATEGORIES.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={e.paidWith == null ? "" : String(e.paidWith)}
                      onChange={(ev) =>
                        onSetPaidWith(e.id, ev.target.value ? Number(ev.target.value) : null)
                      }
                      className="rounded-md border border-border bg-transparent px-1.5 py-1 text-meta text-foreground-muted"
                    >
                      <option value="">Untagged</option>
                      {methods.map((m) => (
                        <option key={m.id} value={String(m.id)}>
                          {paymentMethodLabel(m)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2 text-foreground-muted">{e.note || "-"}</td>
                  <td
                    className={`px-2 py-2 text-right font-mono ${
                      e.direction === "in" ? "text-emerald-700" : "text-foreground"
                    }`}
                  >
                    {e.direction === "in" ? "+" : "-"}
                    {formatUSD(e.amountCents)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onDelete(e.id)}
                      className="text-meta text-foreground-muted hover:text-rose-600"
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

function Checklist({
  tasks,
  onAdd,
  onToggle,
  onDelete,
}: {
  tasks: BusinessTask[];
  onAdd: (label: string) => Promise<void>;
  onToggle: (id: number, done: boolean) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const doneCount = tasks.filter((t) => t.done).length;

  const submit = async () => {
    const v = label.trim();
    if (!v) return;
    setBusy(true);
    try {
      await onAdd(v);
      setLabel("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5">
      {tasks.length > 0 ? (
        <p className="mb-3 text-meta text-foreground-muted">
          {doneCount} of {tasks.length} done
        </p>
      ) : null}
      <ul className="space-y-2">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={t.done}
              onChange={() => onToggle(t.id, !t.done)}
              className="mt-1 h-4 w-4 shrink-0 rounded border-border"
            />
            <span
              className={`flex-1 text-body ${
                t.done ? "text-foreground-muted line-through" : "text-foreground"
              }`}
            >
              {t.label}
            </span>
            <button
              type="button"
              onClick={() => onDelete(t.id)}
              className="text-meta text-foreground-muted hover:text-rose-600"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-2">
        <input
          className="flex-1 rounded-lg border border-border px-3 py-2 text-body"
          placeholder="Add an action item..."
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="rounded-lg border border-border px-4 py-2 text-body font-semibold text-foreground hover:bg-surface-sunken disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function Correspondence({
  emails,
  entityName,
}: {
  emails: BusinessEmail[];
  entityName: string;
}) {
  const download = () => {
    const md = emailArchiveMarkdown(emails, entityName);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "researchos-llc-email-records.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-meta text-foreground-muted">
          {emails.length} archived {emails.length === 1 ? "email" : "emails"}.
          Business correspondence only, never OTP codes or share invites.
        </p>
        <button
          type="button"
          disabled={emails.length === 0}
          onClick={download}
          className="rounded-lg border border-border px-4 py-2 text-body font-semibold text-foreground hover:bg-surface-sunken disabled:opacity-40"
        >
          Download records
        </button>
      </div>

      {emails.length === 0 ? (
        <p className="mt-3 text-body text-foreground-muted">
          Nothing yet. Deadline reminders (and later, payment receipts) are
          archived here as they are sent.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-meta">
            <thead>
              <tr className="border-b border-border text-foreground-muted">
                <th className="px-2 py-2 font-semibold">Sent</th>
                <th className="px-2 py-2 font-semibold">Kind</th>
                <th className="px-2 py-2 font-semibold">To</th>
                <th className="px-2 py-2 font-semibold">Subject</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-2 text-foreground-muted">
                    {e.sentAt.slice(0, 10)}
                  </td>
                  <td className="px-2 py-2 text-foreground-muted">{e.kind}</td>
                  <td className="px-2 py-2 text-foreground-muted">{e.toEmail}</td>
                  <td className="px-2 py-2 text-foreground">{e.subject}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SalesTaxBanner({
  status,
  note,
}: {
  status: EntityConfig["salesTaxStatus"];
  note: string | null;
}) {
  if (status === "exempt") {
    return (
      <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="text-body font-semibold text-emerald-800">
          Wisconsin sales tax: exempt. Clear to charge.
        </p>
        {note ? <p className="mt-1 text-meta text-emerald-700">{note}</p> : null}
      </div>
    );
  }
  const taxable = status === "taxable";
  return (
    <div
      className={`mb-4 rounded-xl border px-4 py-3 ${
        taxable ? "border-amber-300 bg-amber-50" : "border-rose-300 bg-rose-50"
      }`}
    >
      <p
        className={`text-body font-semibold ${
          taxable ? "text-amber-800" : "text-rose-800"
        }`}
      >
        {taxable
          ? "Wisconsin taxable. Register with the WI DOR before charging a real customer."
          : "Hard gate: sales-tax determination pending. Do not bill a real customer until the WI DOR replies."}
      </p>
      {note ? (
        <p className={`mt-1 text-meta ${taxable ? "text-amber-700" : "text-rose-700"}`}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** Year-end tax summary: expenses grouped by Schedule C category, plus a CSV
 *  export of the year's ledger to hand to self-file tax software. */
function TaxSummaryPanel({ ledger }: { ledger: LedgerEntry[] }) {
  const years = Array.from(
    new Set(ledger.map((e) => e.date.slice(0, 4)).filter(Boolean)),
  ).sort((a, b) => b.localeCompare(a));
  const [year, setYear] = useState(years[0] ?? new Date().toISOString().slice(0, 4));

  const rows = ledger.filter((e) => e.date.startsWith(year));
  // Owner draws (reimbursements) are money-out but not deductible business
  // expenses, so they are kept out of the Schedule C expense grouping.
  const expenses = rows.filter(
    (e) => e.direction === "out" && !isReimbursementSettlement(e),
  );
  const income = rows.filter((e) => e.direction === "in");

  const byCat = new Map<string, number>();
  for (const e of expenses) {
    byCat.set(e.taxCategory, (byCat.get(e.taxCategory) ?? 0) + e.amountCents);
  }
  const catRows = Array.from(byCat.entries()).sort((a, b) => b[1] - a[1]);
  const totalExpense = expenses.reduce((s, e) => s + e.amountCents, 0);
  const totalIncome = income.reduce((s, e) => s + e.amountCents, 0);
  const uncategorized = expenses.filter((e) => !e.taxCategory).length;

  const downloadCsv = () => {
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const header = ["Date", "Type", "Category", "Tax category", "Schedule C line", "Amount (USD)", "Note"];
    const lines = [header.map(esc).join(",")];
    for (const e of rows) {
      const isIn = e.direction === "in";
      lines.push(
        [
          e.date,
          isIn ? "income" : "expense",
          e.category,
          isIn ? "" : taxCategoryLabel(e.taxCategory),
          isIn ? "" : taxCategoryScheduleC(e.taxCategory),
          (e.amountCents / 100).toFixed(2),
          e.note,
        ]
          .map(esc)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `researchos-llc-ledger-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-xl border border-border bg-surface-raised p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-title font-semibold text-foreground">Tax summary</h2>
          <p className="mt-0.5 text-meta text-foreground-muted leading-relaxed">
            Expenses grouped by IRS Schedule C line for self-filing. Export the CSV
            and hand the category totals to your tax software, no accountant needed
            if everything is categorized.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground"
          >
            {(years.length ? years : [year]).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={downloadCsv}
            className="rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white hover:bg-brand-action/90"
          >
            Download CSV
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-body">
        <span className="text-foreground">
          Income <b>{formatUSD(totalIncome)}</b>
        </span>
        <span className="text-foreground">
          Expenses <b>{formatUSD(totalExpense)}</b>
        </span>
        <span className="text-foreground">
          Net <b>{formatUSD(totalIncome - totalExpense)}</b>
        </span>
      </div>

      {catRows.length === 0 ? (
        <p className="mt-4 text-meta text-foreground-muted">No expenses recorded for {year}.</p>
      ) : (
        <table className="mt-4 w-full text-left text-meta">
          <thead>
            <tr className="border-b border-border text-foreground-muted">
              <th className="px-2 py-2 font-semibold">Tax category</th>
              <th className="px-2 py-2 font-semibold">Schedule C</th>
              <th className="px-2 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {catRows.map(([cat, cents]) => (
              <tr key={cat || "none"} className="border-b border-border last:border-0">
                <td className="px-2 py-2 text-foreground">{taxCategoryLabel(cat)}</td>
                <td className="px-2 py-2 text-foreground-muted">
                  {taxCategoryScheduleC(cat) || "-"}
                </td>
                <td className="px-2 py-2 text-right font-mono text-foreground">
                  {formatUSD(cents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {uncategorized > 0 ? (
        <p className="mt-3 text-meta text-amber-700">
          {uncategorized} expense{uncategorized === 1 ? "" : "s"} are uncategorized.
          Set a tax category on each so the Schedule C totals are complete.
        </p>
      ) : null}
    </section>
  );
}

// --- payment methods (block 1) ---

function KindChip({ kind }: { kind: PaymentMethodKind }) {
  return kind === "personal" ? (
    <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-meta font-semibold text-amber-700">
      Personal
    </span>
  ) : (
    <span className="rounded-full border border-sky-500 px-2 py-0.5 text-meta font-semibold text-sky-700">
      LLC
    </span>
  );
}

function paymentMethodLabel(m: PaymentMethod): string {
  return m.last4 ? `${m.label} ${"••"}${m.last4}` : m.label;
}

function PaymentMethodRow({
  method,
  onUpdate,
  onDelete,
}: {
  method: PaymentMethod;
  onUpdate: (id: number, m: NewMethod) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [last4, setLast4] = useState(method.last4);
  const [status, setStatus] = useState(method.status);
  const [kind, setKind] = useState<PaymentMethodKind>(method.kind);

  // Re-sync from props when a fresh list arrives, adjust-during-render style.
  const [synced, setSynced] = useState(method);
  if (synced !== method) {
    setSynced(method);
    setLast4(method.last4);
    setStatus(method.status);
    setKind(method.kind);
  }

  const save = (patch: Partial<NewMethod>) =>
    onUpdate(method.id, { label: method.label, last4, status, kind, ...patch });

  const input = "rounded-lg border border-border px-2 py-1 text-meta";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-raised px-3 py-2.5">
      <span
        className={`h-5 w-8 shrink-0 rounded ${
          kind === "personal"
            ? "bg-gradient-to-br from-slate-400 to-slate-600"
            : "bg-gradient-to-br from-sky-400 to-indigo-500"
        }`}
        aria-hidden
      />
      <div className="min-w-[8rem] flex-1">
        <p className="text-body font-medium text-foreground">{method.label}</p>
        <p className="text-meta text-foreground-muted">
          {last4 ? `${"••"}${last4}` : "last four not set"}
        </p>
      </div>
      <label className="flex flex-col">
        <span className="text-meta text-foreground-muted">Last four</span>
        <input
          inputMode="numeric"
          maxLength={4}
          className={`mt-0.5 w-16 ${input}`}
          placeholder="0000"
          value={last4}
          onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(-4))}
          onBlur={() => last4 !== method.last4 && void save({ last4 })}
        />
      </label>
      <label className="flex flex-col">
        <span className="text-meta text-foreground-muted">Owner</span>
        <select
          className={`mt-0.5 ${input}`}
          value={kind}
          onChange={(e) => {
            const next = e.target.value as PaymentMethodKind;
            setKind(next);
            void save({ kind: next });
          }}
        >
          <option value="llc">LLC</option>
          <option value="personal">Personal</option>
        </select>
      </label>
      <label className="flex flex-col">
        <span className="text-meta text-foreground-muted">Status</span>
        <input
          className={`mt-0.5 w-28 ${input}`}
          placeholder="Active"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          onBlur={() => status !== method.status && void save({ status })}
        />
      </label>
      <KindChip kind={kind} />
      <button
        type="button"
        onClick={() => onDelete(method.id)}
        className="text-meta text-foreground-muted hover:text-rose-600"
      >
        Delete
      </button>
    </div>
  );
}

interface NewMethod {
  label: string;
  last4: string;
  kind: PaymentMethodKind;
  status: string;
}

function PaymentMethods({
  methods,
  onAdd,
  onUpdate,
  onDelete,
}: {
  methods: PaymentMethod[];
  onAdd: (m: NewMethod) => Promise<void>;
  onUpdate: (id: number, m: NewMethod) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [form, setForm] = useState<NewMethod>({
    label: "",
    last4: "",
    kind: "llc",
    status: "",
  });
  const [busy, setBusy] = useState(false);
  const input = "rounded-lg border border-border px-3 py-2 text-body";

  const submit = async () => {
    const label = form.label.trim();
    if (!label) return;
    setBusy(true);
    try {
      await onAdd({
        label,
        last4: form.last4.replace(/\D/g, "").slice(-4),
        kind: form.kind,
        status: form.status.trim(),
      });
      setForm({ label: "", last4: "", kind: "llc", status: "" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5">
      <p className="mb-3 text-meta text-foreground-muted leading-relaxed">
        The LLC cards and accounts, plus any personal card you fronted a purchase
        on. Label and last four only, never the full number, expiry, or CVV.
      </p>
      <div className="space-y-2">
        {methods.length === 0 ? (
          <p className="text-body text-foreground-muted">
            No payment methods yet. Add your first card or account below.
          </p>
        ) : (
          methods.map((m) => (
            <PaymentMethodRow
              key={m.id}
              method={m}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col">
          <span className="text-meta text-foreground-muted">Label</span>
          <input
            className={`mt-1 ${input}`}
            placeholder="business Mastercard credit"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <span className="text-meta text-foreground-muted">Last four</span>
          <input
            inputMode="numeric"
            maxLength={4}
            className={`mt-1 w-20 ${input}`}
            placeholder="0000"
            value={form.last4}
            onChange={(e) =>
              setForm({ ...form, last4: e.target.value.replace(/\D/g, "").slice(-4) })
            }
          />
        </label>
        <label className="flex flex-col">
          <span className="text-meta text-foreground-muted">Owner</span>
          <select
            className={`mt-1 ${input}`}
            value={form.kind}
            onChange={(e) =>
              setForm({ ...form, kind: e.target.value as PaymentMethodKind })
            }
          >
            <option value="llc">LLC</option>
            <option value="personal">Personal</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-meta text-foreground-muted">Status</span>
          <input
            className={`mt-1 w-28 ${input}`}
            placeholder="Active"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="rounded-lg bg-brand-action px-4 py-2 text-body font-semibold text-white hover:bg-brand-action/90 disabled:opacity-50"
        >
          {busy ? "Adding..." : "Add card"}
        </button>
      </div>
    </div>
  );
}

// --- reimbursement / owner-fronted view (block 3) ---

function ReimbursementPanel({
  ledger,
  methods,
  onRecord,
}: {
  ledger: LedgerEntry[];
  methods: PaymentMethod[];
  onRecord: (mode: "capital" | "draw") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const { frontedCents, settledCents, outstandingCents, count } =
    computeReimbursement(ledger, methods);
  const hasPersonal = methods.some((m) => m.kind === "personal");

  const record = async (mode: "capital" | "draw") => {
    setBusy(true);
    try {
      await onRecord(mode);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5">
      <p className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
        Fronted on personal cards (owed to you)
      </p>
      <p className="mt-1 text-display font-bold tracking-tight text-amber-700">
        {formatUSD(outstandingCents)}
      </p>
      <p className="mt-1 text-meta text-foreground-muted">
        {formatUSD(frontedCents)} fronted across {count} entr
        {count === 1 ? "y" : "ies"} tagged personal
        {settledCents > 0 ? `, ${formatUSD(settledCents)} already settled` : ""}.
      </p>

      {!hasPersonal ? (
        <p className="mt-3 text-meta text-foreground-muted">
          Mark a card as Personal above and tag the expenses you fronted on it,
          then this totals what the LLC owes you back.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || outstandingCents <= 0}
              onClick={() => record("capital")}
              className="rounded-lg bg-brand-action px-4 py-2 text-body font-semibold text-white hover:bg-brand-action/90 disabled:opacity-40"
            >
              Record as capital contribution
            </button>
            <button
              type="button"
              disabled={busy || outstandingCents <= 0}
              onClick={() => record("draw")}
              className="rounded-lg border border-border px-4 py-2 text-body font-semibold text-foreground hover:bg-surface-sunken disabled:opacity-40"
            >
              Record business-account reimbursement
            </button>
          </div>
          <p className="mt-3 border-t border-border pt-3 text-meta text-foreground-muted leading-relaxed">
            Capital contribution (recommended, no money moves) adds one money-in
            entry for the total, so the expenses still deduct and the cash balance
            stays honest. The business-account reimbursement option instead logs
            a real business-to-personal transfer as an owner draw, which is not a second
            deductible expense. Either way the outstanding amount drops to zero.
          </p>
        </>
      )}
    </div>
  );
}

// --- recurring subscriptions (block 4) ---

interface NewSub {
  label: string;
  amountCents: number;
  cadence: SubscriptionCadence;
  paidWith: number | null;
  nextRenewal: string | null;
}

function SubscriptionRow({
  sub,
  methods,
  onUpdate,
  onDelete,
}: {
  sub: Subscription;
  methods: PaymentMethod[];
  onUpdate: (id: number, s: NewSub) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [dollars, setDollars] = useState((sub.amountCents / 100).toFixed(2));
  const [cadence, setCadence] = useState<SubscriptionCadence>(sub.cadence);
  const [paidWith, setPaidWith] = useState(sub.paidWith);
  const [nextRenewal, setNextRenewal] = useState(sub.nextRenewal ?? "");

  const [synced, setSynced] = useState(sub);
  if (synced !== sub) {
    setSynced(sub);
    setDollars((sub.amountCents / 100).toFixed(2));
    setCadence(sub.cadence);
    setPaidWith(sub.paidWith);
    setNextRenewal(sub.nextRenewal ?? "");
  }

  const save = (patch: Partial<NewSub>) =>
    onUpdate(sub.id, {
      label: sub.label,
      amountCents: Math.round(parseFloat(dollars) * 100) || 0,
      cadence,
      paidWith,
      nextRenewal: nextRenewal || null,
      ...patch,
    });

  const input = "rounded-lg border border-border px-2 py-1 text-meta";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-raised px-3 py-2.5">
      <span className="min-w-[8rem] flex-1 text-body font-medium text-foreground">
        {sub.label}
      </span>
      <label className="flex flex-col">
        <span className="text-meta text-foreground-muted">Amount</span>
        <input
          inputMode="decimal"
          className={`mt-0.5 w-20 ${input}`}
          value={dollars}
          onChange={(e) => setDollars(e.target.value)}
          onBlur={() => save({ amountCents: Math.round(parseFloat(dollars) * 100) || 0 })}
        />
      </label>
      <label className="flex flex-col">
        <span className="text-meta text-foreground-muted">Cadence</span>
        <select
          className={`mt-0.5 ${input}`}
          value={cadence}
          onChange={(e) => {
            const next = e.target.value as SubscriptionCadence;
            setCadence(next);
            void save({ cadence: next });
          }}
        >
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </label>
      <label className="flex flex-col">
        <span className="text-meta text-foreground-muted">Paid with</span>
        <select
          className={`mt-0.5 ${input}`}
          value={paidWith == null ? "" : String(paidWith)}
          onChange={(e) => {
            const next = e.target.value ? Number(e.target.value) : null;
            setPaidWith(next);
            void save({ paidWith: next });
          }}
        >
          <option value="">Untagged</option>
          {methods.map((m) => (
            <option key={m.id} value={String(m.id)}>
              {paymentMethodLabel(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col">
        <span className="text-meta text-foreground-muted">Next renewal</span>
        <input
          type="date"
          className={`mt-0.5 ${input}`}
          value={nextRenewal}
          onChange={(e) => setNextRenewal(e.target.value)}
          onBlur={() => save({ nextRenewal: nextRenewal || null })}
        />
      </label>
      <button
        type="button"
        onClick={() => onDelete(sub.id)}
        className="text-meta text-foreground-muted hover:text-rose-600"
      >
        Delete
      </button>
    </div>
  );
}

function RecurringSubscriptions({
  subscriptions,
  methods,
  onAdd,
  onUpdate,
  onDelete,
}: {
  subscriptions: Subscription[];
  methods: PaymentMethod[];
  onAdd: (s: NewSub) => Promise<void>;
  onUpdate: (id: number, s: NewSub) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [form, setForm] = useState({
    label: "",
    dollars: "",
    cadence: "monthly" as SubscriptionCadence,
    paidWith: "" as string,
    nextRenewal: "",
  });
  const [busy, setBusy] = useState(false);
  const input = "rounded-lg border border-border px-3 py-2 text-body";
  const burn = monthlyBurnCents(subscriptions);

  const submit = async () => {
    const label = form.label.trim();
    const amountCents = Math.round(parseFloat(form.dollars) * 100);
    if (!label || !Number.isFinite(amountCents) || amountCents < 0) return;
    setBusy(true);
    try {
      await onAdd({
        label,
        amountCents,
        cadence: form.cadence,
        paidWith: form.paidWith ? Number(form.paidWith) : null,
        nextRenewal: form.nextRenewal || null,
      });
      setForm({ label: "", dollars: "", cadence: "monthly", paidWith: "", nextRenewal: "" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-meta text-foreground-muted leading-relaxed">
          The recurring charges, so the monthly burn is one number and the
          renewals feed the deadline strip. Yearly subscriptions are amortized to
          a twelfth in the total.
        </p>
        <p className="text-body font-semibold text-rose-700">
          {formatUSD(burn)} / mo
        </p>
      </div>

      <div className="mt-3 space-y-2">
        {subscriptions.length === 0 ? (
          <p className="text-body text-foreground-muted">
            No subscriptions yet. Add the Claude Max seats, the Tello top-up, and
            anything else recurring below.
          </p>
        ) : (
          subscriptions.map((s) => (
            <SubscriptionRow
              key={s.id}
              sub={s}
              methods={methods}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col">
          <span className="text-meta text-foreground-muted">Label</span>
          <input
            className={`mt-1 ${input}`}
            placeholder="Claude Max (seat 1)"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <span className="text-meta text-foreground-muted">Amount</span>
          <input
            inputMode="decimal"
            className={`mt-1 w-24 ${input}`}
            placeholder="0.00"
            value={form.dollars}
            onChange={(e) => setForm({ ...form, dollars: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <span className="text-meta text-foreground-muted">Cadence</span>
          <select
            className={`mt-1 ${input}`}
            value={form.cadence}
            onChange={(e) =>
              setForm({ ...form, cadence: e.target.value as SubscriptionCadence })
            }
          >
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-meta text-foreground-muted">Paid with</span>
          <select
            className={`mt-1 ${input}`}
            value={form.paidWith}
            onChange={(e) => setForm({ ...form, paidWith: e.target.value })}
          >
            <option value="">Untagged</option>
            {methods.map((m) => (
              <option key={m.id} value={String(m.id)}>
                {paymentMethodLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-meta text-foreground-muted">Next renewal</span>
          <input
            type="date"
            className={`mt-1 ${input}`}
            value={form.nextRenewal}
            onChange={(e) => setForm({ ...form, nextRenewal: e.target.value })}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="rounded-lg bg-brand-action px-4 py-2 text-body font-semibold text-white hover:bg-brand-action/90 disabled:opacity-50"
        >
          {busy ? "Adding..." : "Add"}
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-3 mt-10 first:mt-0">
      <h2 className="text-title font-semibold text-foreground">{children}</h2>
      {sub ? <p className="mt-1 text-meta text-foreground-muted leading-relaxed">{sub}</p> : null}
    </div>
  );
}

/** DEV-ONLY convenience panel for the Accountant inbox bot. One click into the
 *  business Gmail, plus a self-test that proves the booking path really works.
 *  Renders nothing in production. */
function DevAccountantPanel() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    steps: { label: string; ok: boolean; detail?: string }[];
    message?: string;
    hint?: string;
  } | null>(null);

  if (process.env.NODE_ENV === "production") return null;

  const GMAIL_URL = "https://mail.google.com/mail/u/?authuser=researchos.llc@gmail.com";

  const runTest = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/dev/accountant-selftest", { method: "POST" });
      setResult(await res.json());
    } catch {
      setResult({ ok: false, steps: [], message: "Could not reach the self-test endpoint." });
    } finally {
      setBusy(false);
    }
  };

  const btn =
    "rounded-lg border border-border px-3 py-2 text-meta font-medium hover:bg-surface-sunken disabled:opacity-50";

  return (
    <div className="mt-10 rounded-2xl border border-dashed border-amber-400/60 bg-amber-50/40 p-4">
      <p className="text-meta font-semibold text-amber-800">
        Dev tools, Accountant bot (development only)
      </p>
      <p className="mt-1 text-meta text-foreground-muted leading-relaxed">
        The bot runs daily at 8:05 AM. It reads the business Gmail in Chrome and
        books receipts to this ledger. Use these to set up and check it without
        leaving the page.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a className={btn} href={GMAIL_URL} target="_blank" rel="noopener noreferrer">
          Open business Gmail
        </a>
        <button type="button" className={btn} onClick={runTest} disabled={busy}>
          {busy ? "Testing booking path..." : "Test booking path"}
        </button>
      </div>

      {result ? (
        <div className="mt-3 rounded-xl border border-border bg-surface p-3">
          <p
            className={`text-meta font-semibold ${
              result.ok ? "text-emerald-700" : "text-rose-600"
            }`}
          >
            {result.ok ? "Booking path healthy" : "Booking path needs attention"}
          </p>
          {result.steps.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {result.steps.map((s, i) => (
                <li key={i} className="flex items-center gap-2 text-meta text-foreground-muted">
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                      s.ok ? "bg-emerald-500" : "bg-rose-500"
                    }`}
                  />
                  <span className="text-foreground">{s.label}</span>
                  {s.detail ? <span className="text-foreground-muted">({s.detail})</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {result.message ? (
            <p className="mt-2 text-meta text-foreground-muted">{result.message}</p>
          ) : null}
          {result.hint ? (
            <p className="mt-1 text-meta text-amber-700">{result.hint}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Fetches the business data and maps it to a State, never calling setState. */
async function fetchBusiness(): Promise<State> {
  try {
    const res = await fetch("/api/admin/business");
    if (res.status === 404 || res.status === 401) return { phase: "denied" };
    if (!res.ok) return { phase: "error" };
    const data = (await res.json()) as BusinessData;
    return { phase: "ready", data };
  } catch {
    return { phase: "error" };
  }
}

export default function BusinessTracker() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [priceModelOpen, setPriceModelOpen] = useState(false);

  const load = useCallback(async () => {
    setState(await fetchBusiness());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await fetchBusiness();
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
    taxCategory: string;
    paidWith?: number | null;
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

  const updateEntryTax = async (id: number, taxCategory: string) => {
    await fetch("/api/admin/business", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "updateEntryTax", id, taxCategory }),
    });
    await load();
  };

  const recordInfra = async (cents: number) => {
    await addEntry({
      date: new Date().toISOString().slice(0, 10),
      direction: "out",
      category: "Infrastructure (estimate)",
      amountCents: cents,
      note: "Auto-estimated storage cost from current usage",
      taxCategory: "hosting",
    });
  };

  const postAction = async (payload: Record<string, unknown>) => {
    await fetch("/api/admin/business", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    await load();
  };

  const addTask = (label: string) => postAction({ action: "addTask", label });
  const toggleTask = (id: number, done: boolean) =>
    postAction({ action: "toggleTask", id, done });
  const deleteTask = (id: number) => postAction({ action: "deleteTask", id });

  const addPaymentMethod = (method: NewMethod) =>
    postAction({ action: "addPaymentMethod", method });
  const updatePaymentMethod = (id: number, method: NewMethod) =>
    postAction({ action: "updatePaymentMethod", id, method });
  const deletePaymentMethod = (id: number) =>
    postAction({ action: "deletePaymentMethod", id });
  const setEntryPaidWith = (id: number, paidWith: number | null) =>
    postAction({ action: "setEntryPaidWith", id, paidWith });
  const recordReimbursement = (mode: "capital" | "draw") =>
    postAction({ action: "recordReimbursement", mode });

  const addSubscription = (subscription: NewSub) =>
    postAction({ action: "addSubscription", subscription });
  const updateSubscription = (id: number, subscription: NewSub) =>
    postAction({ action: "updateSubscription", id, subscription });
  const deleteSubscription = (id: number) =>
    postAction({ action: "deleteSubscription", id });

  if (state.phase === "loading") {
    return (
      <Shell>
        <p className="text-body text-foreground-muted">Loading...</p>
      </Shell>
    );
  }
  if (state.phase === "denied") {
    return (
      <Shell>
        <p className="text-body text-foreground-muted leading-relaxed">
          Not authorized. This page is for operator accounts on the ADMIN_EMAILS
          allow-list, and it is dark unless sharing is enabled on this deployment.
        </p>
        <OperatorSignIn />
      </Shell>
    );
  }
  if (state.phase === "error") {
    return (
      <Shell>
        <p className="text-body text-foreground-muted leading-relaxed">
          Could not load the business data right now. If you are not signed in as
          an operator, sign in below, otherwise try again in a moment.
        </p>
        <OperatorSignIn />
      </Shell>
    );
  }

  const { entity, ledger, tasks, emails, paymentMethods, subscriptions, summary, deadlines, infraEstimate } =
    state.data;

  return (
    <Shell>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-heading font-bold tracking-tight text-foreground">
            LLC business
          </h1>
          <p className="mt-1 text-meta text-foreground-muted leading-relaxed">
            Private operations and finances for the ResearchOS LLC. Aggregate,
            operator-only, never shown to any user.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPriceModelOpen(true)}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border bg-surface-raised px-3.5 py-2 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
        >
          <Icon name="calculator" className="h-4 w-4" />
          Price modeling
        </button>
      </div>

      <div className="mt-6">
        <SalesTaxBanner status={entity.salesTaxStatus} note={entity.salesTaxNote} />
      </div>

      {/* Two columns on wide (xl) screens to cut scrolling; single column below.
          Each section is wrapped so its SectionTitle (first child) drops its
          mt-10 via first:mt-0 and the column's space-y controls the rhythm. */}
      <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-6 xl:grid-cols-2 xl:items-start">
        <div className="space-y-6">
          <CostBreakerPanel />

          <GiftPoolsPanel />

          <SpendByCategoryPanel />

          <div>
            <SectionTitle sub="The next obligations, soonest first. Verify the exact dates and fees with the WI DFI and your accountant.">
              Deadlines
            </SectionTitle>
            <DeadlineStrip
              deadlines={[
                ...deadlines,
                vercelOssApplicationDeadline(),
                ...subscriptionDeadlines(subscriptions),
              ]
                .filter((d): d is Deadline => d !== null)
                .sort((a, b) => a.dueDate.localeCompare(b.dueDate))}
            />
          </div>

          <div>
            <SectionTitle sub="The open setup and compliance steps, mirrored from the ResearchOS_LLC document folder. Check them off as you finish, the files go in the matching numbered subfolder.">
              Setup checklist
            </SectionTitle>
            <Checklist
              tasks={tasks}
              onAdd={addTask}
              onToggle={toggleTask}
              onDelete={deleteTask}
            />
          </div>

          <div>
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
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <SectionTitle sub="Estimated monthly infra cost at the current usage. The fixed base (Workers Paid + Vercel Pro) is what you pay at any user count; Durable Objects and R2 storage are charged only above their free tiers, so they read $0 until a real user base fills them. Storage + base only, no compute or bandwidth.">
              Infrastructure cost
            </SectionTitle>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface-raised p-5">
        <div>
          <p className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
            Estimated this month
          </p>
          <p className="mt-1 text-display font-bold tracking-tight text-foreground">
            {formatUSD(infraEstimate.totalCents)}
          </p>
          <p className="mt-1 text-meta text-foreground-muted">
            Fixed base {formatUSD(infraEstimate.fixedBaseCents)} (Workers $5 +
            Vercel Pro $20) + Durable Objects {formatUSD(infraEstimate.doCents)} +
            R2 {formatUSD(infraEstimate.r2Cents)}
          </p>
        </div>
        <button
          type="button"
          disabled={infraEstimate.totalCents <= 0}
          onClick={() => recordInfra(infraEstimate.totalCents)}
          className="rounded-lg border border-border px-4 py-2 text-body font-semibold text-foreground hover:bg-surface-sunken disabled:opacity-40"
        >
          Record to ledger
        </button>
      </div>
          </div>

          <div>
            <SectionTitle
              sub={`Free ceiling and the next paid step for each service, so scaling is planned not a surprise. Verify current pricing; checked ${INFRA_TIERS_CHECKED}.`}
            >
              Infrastructure tiers
            </SectionTitle>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface-raised">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-meta">
            <thead>
              <tr className="border-b border-border bg-surface-sunken text-foreground-muted">
                <th className="px-3 py-2 font-semibold">Service</th>
                <th className="px-3 py-2 font-semibold">Free tier</th>
                <th className="px-3 py-2 font-semibold">Paid upgrade</th>
                <th className="px-3 py-2 font-semibold">When to upgrade</th>
              </tr>
            </thead>
            <tbody>
              {INFRA_TIERS.map((t) => (
                <tr
                  key={t.service}
                  className={`border-b border-border align-top last:border-0 ${
                    t.actionNow ? "bg-amber-50" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{t.service}</div>
                    <div className="mt-0.5 text-foreground-muted">{t.role}</div>
                  </td>
                  <td className="px-3 py-2 text-foreground-muted">{t.free}</td>
                  <td className="px-3 py-2 text-foreground-muted">{t.paid}</td>
                  <td
                    className={`px-3 py-2 ${
                      t.actionNow ? "font-medium text-amber-700" : "text-foreground-muted"
                    }`}
                  >
                    {t.upgradeWhen}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-2 rounded-xl border border-border bg-surface-sunken px-4 py-3 text-meta text-foreground-muted leading-relaxed">
        {INFRA_TIERS_NOTE}
      </p>
          </div>

          <div>
            <SectionTitle>Entity facts</SectionTitle>
            <EntityCard entity={entity} onSave={saveEntity} />
          </div>

          <div>
            <SectionTitle sub="The LLC cards and accounts, plus any personal card you fronted a purchase on. Label and last four only, never the full number, expiry, or CVV.">
              Payment methods
            </SectionTitle>
            <PaymentMethods
              methods={paymentMethods}
              onAdd={addPaymentMethod}
              onUpdate={updatePaymentMethod}
              onDelete={deletePaymentMethod}
            />
          </div>

          <div>
            <SectionTitle sub="Every income and expense. Tag each with the card it was paid on so the reimbursement total below knows what you fronted. Infrastructure bills can be auto-estimated later; for now, enter them by hand.">
              Ledger
            </SectionTitle>
            <Ledger
              ledger={ledger}
              methods={paymentMethods}
              onAdd={addEntry}
              onDelete={deleteEntry}
              onUpdateTax={updateEntryTax}
              onSetPaidWith={setEntryPaidWith}
            />
            <div className="mt-6">
              <TaxSummaryPanel ledger={ledger} />
            </div>
            <DevAccountantPanel />
          </div>

          <div>
            <SectionTitle sub="What the LLC owes you back for purchases fronted on a personal card. Tag those expenses with a Personal card above, then settle the total here.">
              Owner reimbursement
            </SectionTitle>
            <ReimbursementPanel
              ledger={ledger}
              methods={paymentMethods}
              onRecord={recordReimbursement}
            />
          </div>

          <div>
            <SectionTitle sub="The recurring charges and the blended monthly burn. Renewal dates feed the deadline strip so a charge never surprises you.">
              Recurring subscriptions
            </SectionTitle>
            <RecurringSubscriptions
              subscriptions={subscriptions}
              methods={paymentMethods}
              onAdd={addSubscription}
              onUpdate={updateSubscription}
              onDelete={deleteSubscription}
            />
          </div>

          <div>
            <SectionTitle sub="Business emails the site sent (deadline reminders now, payment receipts later), kept as LLC records. Download them and drop the file in the document folder. OTP codes and share invites are never archived here.">
              Correspondence
            </SectionTitle>
            <Correspondence emails={emails} entityName={entity.legalName} />
          </div>
        </div>
      </div>

      <p className="mt-8 rounded-xl border border-border bg-surface-sunken px-4 py-3 text-meta text-foreground-muted leading-relaxed">
        This tracker is an organizer, not a legal or tax service. It is not the
        LLC&apos;s registered agent (Wisconsin requires a person with a physical
        in-state address for that), and it does not prepare or file taxes. Use it
        to stay on top of dates and cash, and have an accountant set the reserve
        percentage and handle the filings.
      </p>

      <PriceModelingModal
        open={priceModelOpen}
        onClose={() => setPriceModelOpen(false)}
      />
    </Shell>
  );
}
