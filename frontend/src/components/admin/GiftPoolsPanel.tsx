"use client";

// Operator panel for gift pools (allowance grants), on /admin. Issue a beta
// tester a free storage + activity boost and/or a comped plan tier on top of
// their plan, with an expiry, and revoke it. Talks to /api/admin/grants.
//
// A grant on a PI's email lifts the whole lab pool (the pool resolves to the
// PI key). A comped tier (Solo / Lab / Dept) gives that lab the feature set
// of that tier with no Stripe subscription and $0 charge. A comped tier always
// requires a month count so there are no permanent comps (decision 3,
// Grant 2026-06-19). Allowance-only grants keep the existing optional-expiry
// behavior. AI tokens are not comped here (decision 1).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";

type GiftTier = "solo" | "lab" | "dept";

interface Grant {
  id: number;
  ownerKey: string;
  bonusBytes: number;
  bonusWrites: number;
  label: string | null;
  note: string | null;
  expiresAt: string | null;
  giftTier: GiftTier | null;
  createdAt: string;
}

const GB = 1024 ** 3;
const M = 1_000_000;
const fmtGb = (bytes: number) =>
  bytes === 0 ? null : `${(bytes / GB).toFixed(bytes % GB === 0 ? 0 : 1)} GB`;
const fmtWrites = (w: number) =>
  w === 0 ? null : `${(w / M).toFixed(w % M === 0 ? 0 : 1)}M writes/mo`;
const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "never");

const TIER_LABELS: Record<GiftTier, string> = {
  solo: "Solo",
  lab: "Lab",
  dept: "Dept",
};

function expired(iso: string | null): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t <= Date.now();
}

export default function GiftPoolsPanel() {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [email, setEmail] = useState("");
  const [gb, setGb] = useState("");
  const [writesM, setWritesM] = useState("");
  const [months, setMonths] = useState("");
  const [note, setNote] = useState("");
  const [giftTier, setGiftTier] = useState<GiftTier | "">("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/grants");
      if (!res.ok) return;
      const data = (await res.json()) as { grants: Grant[] };
      setGrants(data.grants);
    } catch {
      // gated route, stay hidden
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount
    void load();
  }, [load]);

  const issue = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          bonusGb: Number(gb || 0),
          bonusWritesMillions: Number(writesM || 0),
          note: note || undefined,
          giftTier: giftTier || undefined,
          months: months ? Number(months) : undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? "issue failed");
        return;
      }
      setEmail("");
      setGb("");
      setWritesM("");
      setMonths("");
      setNote("");
      setGiftTier("");
      await load();
    } finally {
      setBusy(false);
    }
  }, [email, gb, writesM, months, note, giftTier, load]);

  const revoke = useCallback(
    async (id: number) => {
      setBusy(true);
      try {
        await fetch("/api/admin/grants", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  if (grants === null) return null;

  const hasAllowance = Number(gb || 0) > 0 || Number(writesM || 0) > 0;
  // A comped tier requires a month count (decision 3: no permanent comps).
  const tierRequiresMonths = giftTier !== "" && !months;
  const canIssue =
    email.trim().length > 0 &&
    (hasAllowance || giftTier !== "") &&
    !tierRequiresMonths &&
    !busy;

  return (
    <section className="rounded-xl border border-border bg-surface-raised p-6">
      <h2 className="text-title font-semibold text-foreground">Gift pools</h2>
      <p className="mt-0.5 text-meta text-foreground-muted leading-relaxed">
        Issue a lab a free allowance boost (storage + activity) and/or a comped
        plan tier. Issued by email; on a lab head it lifts the whole lab pool.
        A comped tier requires a month count (no permanent comps). AI tokens are
        a separate product and are not comped here.
      </p>

      {/* Issue form */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-meta text-foreground-muted">
          <span className="block font-medium uppercase tracking-wide">Email</span>
          <input
            type="email"
            value={email}
            disabled={busy}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tester@lab.edu"
            className="mt-1 w-56 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </label>

        <label className="text-meta text-foreground-muted">
          <span className="block font-medium uppercase tracking-wide">
            Comped tier
          </span>
          <select
            value={giftTier}
            disabled={busy}
            onChange={(e) => setGiftTier(e.target.value as GiftTier | "")}
            className="mt-1 w-28 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="">None</option>
            <option value="solo">Solo</option>
            <option value="lab">Lab</option>
            <option value="dept">Dept</option>
          </select>
        </label>

        {/* Months is required when a tier is chosen. */}
        <label className="text-meta text-foreground-muted">
          <span className="flex items-center gap-1 font-medium uppercase tracking-wide">
            Months
            {giftTier !== "" && (
              <span className="text-red-500" aria-hidden>
                *
              </span>
            )}
          </span>
          <input
            type="number"
            min="1"
            step="1"
            value={months}
            disabled={busy}
            onChange={(e) => setMonths(e.target.value)}
            placeholder={giftTier !== "" ? "e.g. 12" : "optional"}
className={`mt-1 w-28 rounded-lg border bg-surface-sunken px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500 ${
              tierRequiresMonths ? "border-red-400" : "border-border"
            }`}
          />
        </label>

        <label className="text-meta text-foreground-muted">
          <span className="block font-medium uppercase tracking-wide">Storage GB</span>
          <input
            type="number"
            min="0"
            step="1"
            value={gb}
            disabled={busy}
            onChange={(e) => setGb(e.target.value)}
            placeholder="50"
            className="mt-1 w-24 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </label>

        <label className="text-meta text-foreground-muted">
          <span className="block font-medium uppercase tracking-wide">Writes (M/mo)</span>
          <input
            type="number"
            min="0"
            step="1"
            value={writesM}
            disabled={busy}
            onChange={(e) => setWritesM(e.target.value)}
            placeholder="3"
            className="mt-1 w-24 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </label>

        <button
          type="button"
          disabled={!canIssue}
          onClick={issue}
          className="ros-btn-raise rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white hover:bg-brand-action/90 disabled:opacity-50"
        >
          Issue gift
        </button>
      </div>

      {tierRequiresMonths && (
        <p className="mt-1.5 text-meta text-red-600">
          A comped tier requires a month count. Permanent comped tiers are not
          allowed (Grant 2026-06-19, decision 3).
        </p>
      )}

      <div className="mt-2">
        <input
          type="text"
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional, e.g. 'beta cohort 1')"
          className="w-full max-w-md rounded-lg border border-border bg-surface-sunken px-3 py-2 text-meta text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
      </div>
      {err ? (
        <p className="mt-2 text-meta text-red-700">{err}</p>
      ) : null}

      {/* Existing grants */}
      <div className="mt-5">
        {grants.length === 0 ? (
          <p className="text-meta text-foreground-muted">No gift pools issued yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg ring-1 ring-inset ring-border">
            {grants.map((g) => {
              const isExpired = expired(g.expiresAt);
              const allowanceParts = [fmtGb(g.bonusBytes), fmtWrites(g.bonusWrites)].filter(
                Boolean,
              );
              return (
                <li
                  key={g.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-body text-foreground">
                      {g.label ?? g.ownerKey.slice(0, 12)}
                      {g.giftTier ? (
                        <span
                          className={`ml-2 rounded px-1.5 py-0.5 text-meta font-semibold ${
                            isExpired
                              ? "bg-surface-sunken text-foreground-muted"
                              : "bg-violet-100 text-violet-800"
                          }`}
                        >
                          {TIER_LABELS[g.giftTier]} tier
                        </span>
                      ) : null}
                      {isExpired ? (
                        <span className="ml-2 text-meta text-foreground-muted">
                          (expired)
                        </span>
                      ) : null}
                    </p>
                    <p className="text-meta text-foreground-muted">
                      {allowanceParts.length > 0
                        ? `${allowanceParts.join(" + ")} · `
                        : null}
                      expires {fmtDate(g.expiresAt)}
                      {g.note ? ` · ${g.note}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => revoke(g.id)}
                    className="rounded-lg border border-border px-3 py-1.5 text-meta font-semibold text-foreground hover:bg-surface-sunken disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
