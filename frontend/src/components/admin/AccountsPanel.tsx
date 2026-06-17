"use client";

// Operator Accounts panel (rendered in the /admin OperatorShell).
//
// Lists every registered solo user, lab, and department/institution, each with a
// guarded full-account-wipe. Clicking "Wipe account" opens a LivingPopup that
// FIRST runs the wipe-preview (a dry run) and shows the exact per-table row
// counts plus whether a saved Stripe card will be deleted, then requires a
// second confirm click to commit. On success it shows an inline result line and
// refetches the roster. The endpoints are gated on ADMIN_EMAILS, so a non
// operator simply never sees data here.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Icons via Icon.

import { useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/icons";
import LivingPopup from "@/components/ui/LivingPopup";
import { StatCard } from "@/components/admin/AdminMetrics";

interface SoloRow {
  ownerKey: string;
  label: string;
  plan: "solo" | "lab" | "free";
  createdAt: string | null;
  hasCard: boolean;
}
interface LabRow {
  ownerKey: string;
  label: string;
  memberCount: number;
  createdAt: string | null;
  hasCard: boolean;
}
interface OrgRow {
  kind: "dept" | "institution";
  id: string;
  label: string;
  memberCount: number;
  createdAt: string | null;
  hasCard: boolean;
}
interface Roster {
  solo: SoloRow[];
  labs: LabRow[];
  depts: OrgRow[];
}

interface TableRowCount {
  table: string;
  rows: number;
}
interface WipePreview {
  target: { kind: string; id: string };
  perTable: TableRowCount[];
  total: number;
  stripeCustomer: string | null;
}
interface WipeResult {
  ok: true;
  total: number;
  deleted: TableRowCount[];
  stripe: string;
  stripeError?: string;
}

/** The identity a wipe targets, one of an owner key or a dept/institution id. */
type WipeKey =
  | { kind: "owner"; ownerKey: string; label: string }
  | { kind: "dept"; deptId: string; label: string }
  | { kind: "institution"; institutionId: string; label: string };

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "unknown";
}

function wipeBody(key: WipeKey): Record<string, string> {
  if (key.kind === "owner") return { ownerKey: key.ownerKey };
  if (key.kind === "dept") return { deptId: key.deptId };
  return { institutionId: key.institutionId };
}

export default function AccountsPanel() {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [target, setTarget] = useState<WipeKey | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/accounts");
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const data = (await res.json()) as Roster;
      setLoadError(false);
      setRoster(data);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount
    void load();
  }, [load]);

  const onWiped = useCallback(() => {
    setTarget(null);
    void load();
  }, [load]);

  if (loadError) {
    return (
      <p className="text-body text-foreground-muted">
        Could not load the account roster. Try again in a moment.
      </p>
    );
  }
  if (roster === null) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-sky-500" />
      </div>
    );
  }

  const total = roster.solo.length + roster.labs.length + roster.depts.length;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Solo users" value={roster.solo.length} />
        <StatCard label="Labs" value={roster.labs.length} />
        <StatCard label="Depts and institutions" value={roster.depts.length} />
        <StatCard label="Total accounts" value={total} />
      </div>

      <RosterTable
        title="Solo users"
        icon="users"
        empty="No solo users registered yet."
        rows={roster.solo.map((r) => ({
          id: r.ownerKey,
          label: r.label,
          meta: `${r.plan === "free" ? "Free" : "Solo"} . created ${fmtDate(r.createdAt)}`,
          hasCard: r.hasCard,
          key: { kind: "owner", ownerKey: r.ownerKey, label: r.label } as WipeKey,
        }))}
        onWipe={setTarget}
      />

      <RosterTable
        title="Labs"
        icon="labTree"
        empty="No labs registered yet."
        rows={roster.labs.map((r) => ({
          id: r.ownerKey,
          label: r.label,
          meta: `${r.memberCount} member${r.memberCount === 1 ? "" : "s"} . created ${fmtDate(r.createdAt)}`,
          hasCard: r.hasCard,
          key: { kind: "owner", ownerKey: r.ownerKey, label: r.label } as WipeKey,
        }))}
        onWipe={setTarget}
      />

      <RosterTable
        title="Departments and institutions"
        icon="library"
        empty="No departments or institutions registered yet."
        rows={roster.depts.map((r) => ({
          id: r.id,
          label: r.label,
          meta: `${r.kind === "dept" ? "Department" : "Institution"} . ${r.memberCount} member${r.memberCount === 1 ? "" : "s"} . created ${fmtDate(r.createdAt)}`,
          hasCard: r.hasCard,
          key: (r.kind === "dept"
            ? { kind: "dept", deptId: r.id, label: r.label }
            : { kind: "institution", institutionId: r.id, label: r.label }) as WipeKey,
        }))}
        onWipe={setTarget}
      />

      <WipeConfirm target={target} onClose={() => setTarget(null)} onWiped={onWiped} />
    </div>
  );
}

// ── One roster table ─────────────────────────────────────────────────────────

interface DisplayRow {
  id: string;
  label: string;
  meta: string;
  hasCard: boolean;
  key: WipeKey;
}

function RosterTable({
  title,
  icon,
  empty,
  rows,
  onWipe,
}: {
  title: string;
  icon: "users" | "labTree" | "library";
  empty: string;
  rows: DisplayRow[];
  onWipe: (key: WipeKey) => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface-raised p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon name={icon} className="h-4 w-4 text-foreground-muted" />
        <h3 className="text-title font-semibold text-foreground">{title}</h3>
        <span className="text-meta text-foreground-muted">({rows.length})</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-meta text-foreground-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-body font-medium text-foreground">
                  {r.label}
                </p>
                <p className="truncate text-meta text-foreground-muted">
                  {r.meta}
                  {r.hasCard ? " . saved card on file" : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onWipe(r.key)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-meta font-semibold text-rose-700 transition-colors hover:bg-rose-100"
              >
                <Icon name="trash" className="h-3.5 w-3.5" />
                Wipe account
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── The guarded confirm popup ────────────────────────────────────────────────

type Phase =
  | { state: "preview-loading" }
  | { state: "preview-error" }
  | { state: "ready"; preview: WipePreview }
  | { state: "wiping"; preview: WipePreview }
  | { state: "done"; result: WipeResult }
  | { state: "wipe-error"; preview: WipePreview };

function WipeConfirm({
  target,
  onClose,
  onWiped,
}: {
  target: WipeKey | null;
  onClose: () => void;
  onWiped: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ state: "preview-loading" });

  // Load the dry-run preview whenever a new target opens the popup.
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset to the loading phase, then drive the async preview fetch off the new target
    setPhase({ state: "preview-loading" });
    void (async () => {
      try {
        const res = await fetch("/api/admin/accounts/wipe-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(wipeBody(target)),
        });
        if (cancelled) return;
        if (!res.ok) {
          setPhase({ state: "preview-error" });
          return;
        }
        const preview = (await res.json()) as WipePreview;
        if (!cancelled) setPhase({ state: "ready", preview });
      } catch {
        if (!cancelled) setPhase({ state: "preview-error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  const commit = useCallback(async () => {
    if (!target) return;
    const prev = phase.state === "ready" ? phase.preview : null;
    if (!prev) return;
    setPhase({ state: "wiping", preview: prev });
    try {
      const res = await fetch("/api/admin/accounts/wipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...wipeBody(target), confirm: true }),
      });
      if (!res.ok) {
        setPhase({ state: "wipe-error", preview: prev });
        return;
      }
      const result = (await res.json()) as WipeResult;
      setPhase({ state: "done", result });
    } catch {
      setPhase({ state: "wipe-error", preview: prev });
    }
  }, [target, phase]);

  const open = target !== null;
  const nonZero =
    phase.state === "ready"
      ? phase.preview.perTable.filter((t) => t.rows > 0)
      : [];

  return (
    <LivingPopup
      open={open}
      onClose={onClose}
      label="Wipe account"
      widthClassName="max-w-md"
      card
      padded
      blur
    >
      {target && (
        <div>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
              <Icon name="trash" className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-title font-semibold text-foreground">
                Wipe this account
              </h2>
              <p className="truncate text-meta text-foreground-muted">
                {target.label}
              </p>
            </div>
          </div>

          {phase.state === "preview-loading" && (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-rose-500" />
            </div>
          )}

          {phase.state === "preview-error" && (
            <p className="mt-4 text-body text-rose-700">
              Could not load the wipe preview. Close this and try again.
            </p>
          )}

          {(phase.state === "ready" ||
            phase.state === "wiping" ||
            phase.state === "wipe-error") && (
            <>
              <div className="mt-4 rounded-xl border border-border bg-surface-sunken p-3">
                <p className="mb-2 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
                  What will be deleted
                </p>
                {nonZero.length === 0 ? (
                  <p className="text-meta text-foreground-muted">
                    No cloud rows are on record for this account. Wiping is a
                    no-op, the account may already be gone.
                  </p>
                ) : (
                  <ul className="max-h-48 space-y-1 overflow-y-auto">
                    {nonZero.map((t) => (
                      <li
                        key={t.table}
                        className="flex items-center justify-between text-meta"
                      >
                        <span className="font-mono text-foreground">{t.table}</span>
                        <span className="tabular-nums text-foreground-muted">
                          {t.rows}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 border-t border-border pt-2 text-meta text-foreground-muted">
                  Stripe customer
                  {phase.state === "ready" && phase.preview.stripeCustomer
                    ? `: ${phase.preview.stripeCustomer} will be deleted`
                    : ": none on record"}
                </p>
              </div>

              <p className="mt-4 text-meta text-foreground-muted leading-relaxed">
                This permanently removes the cloud account, billing, and saved
                card. Local files on their computer are untouched. This cannot be
                undone.
              </p>

              {phase.state === "wipe-error" && (
                <p className="mt-3 text-meta text-rose-700">
                  The wipe failed. Close this and try again.
                </p>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={phase.state === "wiping"}
                  className="rounded-lg border border-border bg-surface-raised px-3.5 py-2 text-body font-medium text-foreground transition-colors hover:bg-surface-sunken disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={commit}
                  disabled={phase.state === "wiping"}
                  className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3.5 py-2 text-body font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-60"
                >
                  {phase.state === "wiping" ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Wiping...
                    </>
                  ) : (
                    "Permanently wipe"
                  )}
                </button>
              </div>
            </>
          )}

          {phase.state === "done" && (
            <>
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-body font-semibold text-emerald-800">
                  Account wiped
                </p>
                <p className="mt-1 text-meta text-emerald-700">
                  Deleted {phase.result.total} row
                  {phase.result.total === 1 ? "" : "s"} across{" "}
                  {phase.result.deleted.filter((d) => d.rows > 0).length} table
                  {phase.result.deleted.filter((d) => d.rows > 0).length === 1
                    ? ""
                    : "s"}
                  . {phase.result.stripe}
                </p>
                {phase.result.stripeError && (
                  <p className="mt-1 text-meta text-amber-700">
                    Stripe note: {phase.result.stripeError}
                  </p>
                )}
              </div>
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={onWiped}
                  className="rounded-lg bg-foreground px-3.5 py-2 text-body font-semibold text-surface-raised transition-colors hover:opacity-90"
                >
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </LivingPopup>
  );
}
