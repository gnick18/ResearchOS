"use client";

// Operator panel for gift pools (allowance grants), on /admin/business. Issue a
// beta tester a free storage + activity boost on top of their plan, with an
// optional expiry, and revoke it. Talks to the admin-gated /api/admin/grants
// route. A grant on a PI's email lifts the whole lab pool. Grants can be seeded
// now and take effect once BILLING_ENABLED is on.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";

interface Grant {
  id: number;
  ownerKey: string;
  bonusBytes: number;
  bonusWrites: number;
  label: string | null;
  note: string | null;
  expiresAt: string | null;
  createdAt: string;
}

const GB = 1024 ** 3;
const M = 1_000_000;
const fmtGb = (bytes: number) => `${(bytes / GB).toFixed(bytes % GB === 0 ? 0 : 1)} GB`;
const fmtWrites = (w: number) => `${(w / M).toFixed(w % M === 0 ? 0 : 1)}M writes/mo`;
const fmtDate = (iso: string | null) =>
  iso ? iso.slice(0, 10) : "never";

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
  const [expiresAt, setExpiresAt] = useState("");
  const [note, setNote] = useState("");
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
          expiresAt: expiresAt || undefined,
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
      setExpiresAt("");
      setNote("");
      await load();
    } finally {
      setBusy(false);
    }
  }, [email, gb, writesM, expiresAt, note, load]);

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

  const canIssue =
    email.trim().length > 0 &&
    (Number(gb || 0) > 0 || Number(writesM || 0) > 0) &&
    !busy;

  return (
    <section className="rounded-xl border border-border bg-surface-raised p-6">
      <h2 className="text-title font-semibold text-foreground">Gift pools</h2>
      <p className="mt-0.5 text-meta text-foreground-muted leading-relaxed">
        A free allowance boost (storage + monthly activity) on top of a user&apos;s
        plan, for beta testers and goodwill. Issued by email; on a lab head it
        lifts the whole lab pool. Takes effect once billing is on. Leave expiry
        blank for a permanent gift.
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
        <label className="text-meta text-foreground-muted">
          <span className="block font-medium uppercase tracking-wide">Expires (optional)</span>
          <input
            type="date"
            value={expiresAt}
            disabled={busy}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="mt-1 w-40 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </label>
        <button
          type="button"
          disabled={!canIssue}
          onClick={issue}
          className="rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white hover:bg-brand-action/90 disabled:opacity-50"
        >
          Issue gift
        </button>
      </div>
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
            {grants.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-body text-foreground">
                    {g.label ?? g.ownerKey.slice(0, 12)}
                    {expired(g.expiresAt) ? (
                      <span className="ml-2 text-meta text-foreground-muted">(expired)</span>
                    ) : null}
                  </p>
                  <p className="text-meta text-foreground-muted">
                    {fmtGb(g.bonusBytes)} + {fmtWrites(g.bonusWrites)} · expires{" "}
                    {fmtDate(g.expiresAt)}
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
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
