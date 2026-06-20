"use client";

// Operator Accounts panel (rendered in the /admin OperatorShell).
//
// Lists every registered solo user, lab, and department/institution. Each row
// has two operator actions:
//
//   1. Wipe account: a small, muted trash icon that opens a LivingPopup with a
//      dry-run preview and a second confirm click before committing. The trigger
//      is intentionally compact so it reads as a last-resort tool, not a
//      primary action. The full confirm guard is unchanged.
//
//   2. Gift premium: a small gift icon that opens a compact picker scoped to
//      that row's ownerKey. Default tier matches the row kind (Solo/Lab/Dept)
//      but the operator can change it. Months is required when a tier is chosen
//      (no permanent comps, decision 3, Grant 2026-06-19). Posts directly by
//      ownerKey so there is no email lookup.
//
// The endpoints are gated on ADMIN_EMAILS, so a non-operator never sees data.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Icons via Icon.

import { useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import LivingPopup from "@/components/ui/LivingPopup";
import { StatCard } from "@/components/admin/AdminMetrics";

type GiftTier = "solo" | "lab" | "dept";

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

/** What the row-level gift picker needs. */
interface GiftTarget {
  ownerKey: string;
  label: string;
  defaultTier: GiftTier;
}

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
  const [wipeTarget, setWipeTarget] = useState<WipeKey | null>(null);
  const [giftTarget, setGiftTarget] = useState<GiftTarget | null>(null);

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
    setWipeTarget(null);
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

      <ClearSettingsControl />

      <RosterTable
        title="Solo users"
        icon="users"
        empty="No solo users registered yet."
        rows={roster.solo.map((r) => ({
          id: r.ownerKey,
          label: r.label,
          meta: `${r.plan === "free" ? "Free" : "Solo"} . created ${fmtDate(r.createdAt)}`,
          hasCard: r.hasCard,
          wipeKey: { kind: "owner", ownerKey: r.ownerKey, label: r.label } as WipeKey,
          giftTarget: { ownerKey: r.ownerKey, label: r.label, defaultTier: "solo" as GiftTier },
        }))}
        onWipe={setWipeTarget}
        onGift={setGiftTarget}
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
          wipeKey: { kind: "owner", ownerKey: r.ownerKey, label: r.label } as WipeKey,
          giftTarget: { ownerKey: r.ownerKey, label: r.label, defaultTier: "lab" as GiftTier },
        }))}
        onWipe={setWipeTarget}
        onGift={setGiftTarget}
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
          wipeKey: (r.kind === "dept"
            ? { kind: "dept", deptId: r.id, label: r.label }
            : { kind: "institution", institutionId: r.id, label: r.label }) as WipeKey,
          giftTarget: { ownerKey: r.id, label: r.label, defaultTier: "dept" as GiftTier },
        }))}
        onWipe={setWipeTarget}
        onGift={setGiftTarget}
      />

      <WipeConfirm
        target={wipeTarget}
        onClose={() => setWipeTarget(null)}
        onWiped={onWiped}
      />

      <RowGiftPopup
        target={giftTarget}
        onClose={() => setGiftTarget(null)}
      />
    </div>
  );
}

// ── One roster table ─────────────────────────────────────────────────────────

interface DisplayRow {
  id: string;
  label: string;
  meta: string;
  hasCard: boolean;
  wipeKey: WipeKey;
  giftTarget: GiftTarget;
}

function RosterTable({
  title,
  icon,
  empty,
  rows,
  onWipe,
  onGift,
}: {
  title: string;
  icon: "users" | "labTree" | "library";
  empty: string;
  rows: DisplayRow[];
  onWipe: (key: WipeKey) => void;
  onGift: (target: GiftTarget) => void;
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

              {/* Row-level operator actions: gift (primary) + wipe (muted). */}
              <div className="flex shrink-0 items-center gap-1">
                {/* Gift premium: opens the tier+months picker for this row. */}
                <Tooltip label="Gift premium" placement="top">
                  <button
                    type="button"
                    onClick={() => onGift(r.giftTarget)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-violet-50 hover:text-violet-700"
                  >
                    <Icon name="star" className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>

                {/* Wipe account: compact, muted by default so it reads as a
                    last-resort tool. Danger color appears only on hover. The
                    full LivingPopup typed-confirm guard is unchanged. */}
                <Tooltip label="Wipe account" placement="top">
                  <button
                    type="button"
                    onClick={() => onWipe(r.wipeKey)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              </div>
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

// ── Per-row gift picker ───────────────────────────────────────────────────────

const GIFT_TIER_OPTIONS: { value: GiftTier; label: string }[] = [
  { value: "solo", label: "Solo" },
  { value: "lab", label: "Lab" },
  { value: "dept", label: "Dept" },
];

type GiftPhase =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "done" }
  | { state: "error"; message: string };

function RowGiftPopup({
  target,
  onClose,
}: {
  target: GiftTarget | null;
  onClose: () => void;
}) {
  const [tier, setTier] = useState<GiftTier>("solo");
  const [months, setMonths] = useState("");
  const [gb, setGb] = useState("");
  const [writesM, setWritesM] = useState("");
  const [phase, setPhase] = useState<GiftPhase>({ state: "idle" });

  // Reset form fields whenever the target's ownerKey changes (a new row was
  // clicked). Keying on ownerKey means opening the same row twice is a no-op,
  // which avoids wiping in-progress edits on an accidental second click.
  const targetKey = target?.ownerKey ?? null;
  useEffect(() => {
    if (!target) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting form fields when a new roster row opens the picker; target is an operator-only popup, not a progressive page
    setTier(target.defaultTier);
    setMonths("");
    setGb("");
    setWritesM("");
    setPhase({ state: "idle" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on targetKey, not the full target object
  }, [targetKey]);

  // Months is always required because a tier is always selected (the picker
  // never has an empty-tier option). The tier value is always a GiftTier.
  const tierRequiresMonths = !months;
  const canIssue =
    target !== null &&
    !tierRequiresMonths &&
    phase.state !== "busy";

  const issue = useCallback(async () => {
    if (!target) return;
    setPhase({ state: "busy" });
    try {
      const res = await fetch("/api/admin/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerKey: target.ownerKey,
          giftTier: tier,
          months: months ? Number(months) : undefined,
          bonusGb: Number(gb || 0),
          bonusWritesMillions: Number(writesM || 0),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setPhase({ state: "error", message: j.error ?? "Gift failed." });
        return;
      }
      setPhase({ state: "done" });
    } catch {
      setPhase({ state: "error", message: "Gift failed. Try again." });
    }
  }, [target, tier, months, gb, writesM]);

  const open = target !== null;

  return (
    <LivingPopup
      open={open}
      onClose={onClose}
      label="Gift premium"
      widthClassName="max-w-sm"
      card
      padded
      blur
    >
      {target && (
        <div>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
              <Icon name="star" className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-title font-semibold text-foreground">
                Gift premium
              </h2>
              <p className="truncate text-meta text-foreground-muted">
                {target.label}
              </p>
            </div>
          </div>

          {phase.state === "done" ? (
            <>
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-body font-semibold text-emerald-800">
                  Gift issued
                </p>
                <p className="mt-1 text-meta text-emerald-700">
                  The {GIFT_TIER_OPTIONS.find((o) => o.value === tier)?.label} tier
                  comp for {months} month{Number(months) === 1 ? "" : "s"} is now
                  active for {target.label}.
                </p>
              </div>
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-foreground px-3.5 py-2 text-body font-semibold text-surface-raised transition-colors hover:opacity-90"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mt-4 space-y-3">
                {/* Comped tier */}
                <label className="block text-meta text-foreground-muted">
                  <span className="block font-medium uppercase tracking-wide">
                    Comped tier
                  </span>
                  <select
                    value={tier}
                    disabled={phase.state === "busy"}
                    onChange={(e) => setTier(e.target.value as GiftTier)}
                    className="mt-1 w-full rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    {GIFT_TIER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>

                {/* Months (always required for a tier comp). */}
                <label className="block text-meta text-foreground-muted">
                  <span className="flex items-center gap-1 font-medium uppercase tracking-wide">
                    Months
                    <span className="text-red-500" aria-hidden>
                      *
                    </span>
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={months}
                    disabled={phase.state === "busy"}
                    onChange={(e) => {
                      setMonths(e.target.value);
                      if (phase.state === "error") setPhase({ state: "idle" });
                    }}
                    placeholder="e.g. 12"
                    className={`mt-1 w-full rounded-lg border bg-surface-sunken px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                      tierRequiresMonths && months === ""
                        ? "border-red-400"
                        : "border-border"
                    }`}
                  />
                  {tierRequiresMonths && months === "" && (
                    <p className="mt-1 text-meta text-red-600">
                      A comped tier requires a month count. Permanent comps are
                      not allowed (decision 3).
                    </p>
                  )}
                </label>

                {/* Optional allowance fields. */}
                <div className="flex gap-3">
                  <label className="block flex-1 text-meta text-foreground-muted">
                    <span className="block font-medium uppercase tracking-wide">
                      Storage GB
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={gb}
                      disabled={phase.state === "busy"}
                      onChange={(e) => setGb(e.target.value)}
                      placeholder="0"
                      className="mt-1 w-full rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </label>
                  <label className="block flex-1 text-meta text-foreground-muted">
                    <span className="block font-medium uppercase tracking-wide">
                      Writes (M/mo)
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={writesM}
                      disabled={phase.state === "busy"}
                      onChange={(e) => setWritesM(e.target.value)}
                      placeholder="0"
                      className="mt-1 w-full rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </label>
                </div>
              </div>

              {phase.state === "error" && (
                <p className="mt-3 text-meta text-rose-700">{phase.message}</p>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={phase.state === "busy"}
                  className="rounded-lg border border-border bg-surface-raised px-3.5 py-2 text-body font-medium text-foreground transition-colors hover:bg-surface-sunken disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={issue}
                  disabled={!canIssue}
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2 text-body font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
                >
                  {phase.state === "busy" ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Issuing...
                    </>
                  ) : (
                    "Issue gift"
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </LivingPopup>
  );
}

// ── Clear cloud settings (un-stick a polluted account-settings blob) ──────────

type ClearPhase =
  | { state: "idle" }
  | { state: "clearing" }
  | { state: "done"; cleared: number }
  | { state: "error"; message: string };

/**
 * A targeted operator tool, separate from the full wipe, that deletes ONLY a
 * user's E2E account-settings blob by email. After this they fall back to
 * folder-local settings, which recovers an account whose cloud settings got
 * polluted (the lift misfire) without touching their account, billing, or data.
 */
function ClearSettingsControl() {
  const [email, setEmail] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState<ClearPhase>({ state: "idle" });

  const trimmed = email.trim();

  const submit = useCallback(async () => {
    if (!trimmed) return;
    setPhase({ state: "clearing" });
    try {
      const res = await fetch("/api/admin/accounts/clear-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, confirm: true }),
      });
      if (!res.ok) {
        setPhase({ state: "error", message: "Clear failed. Check the email and try again." });
        return;
      }
      const data = (await res.json()) as { cleared: number };
      setPhase({ state: "done", cleared: data.cleared });
    } catch {
      setPhase({ state: "error", message: "Clear failed. Check the email and try again." });
    }
  }, [trimmed]);

  return (
    <section className="rounded-2xl border border-border bg-surface-raised p-5">
      <div className="mb-2 flex items-center gap-2">
        <Icon name="cloud" className="h-4 w-4 text-foreground-muted" />
        <h3 className="text-title font-semibold text-foreground">
          Clear cloud settings
        </h3>
      </div>
      <p className="mb-3 text-meta text-foreground-muted leading-relaxed">
        Deletes only a user&apos;s cloud account-settings blob by email, so they
        fall back to their folder-local settings. Their account, billing, and data
        are untouched. Use this to un-stick an account whose cloud settings got
        into a bad state.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (phase.state !== "idle") setPhase({ state: "idle" });
          }}
          placeholder="user@example.edu"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground placeholder:text-foreground-muted"
        />
        <button
          type="button"
          disabled={!trimmed || phase.state === "clearing"}
          onClick={() => setConfirming(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-meta font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
        >
          <Icon name="cloud" className="h-3.5 w-3.5" />
          Clear cloud settings
        </button>
      </div>

      {phase.state === "done" && (
        <p className="mt-3 text-meta text-emerald-700">
          Cleared {phase.cleared} settings row{phase.cleared === 1 ? "" : "s"} for{" "}
          {trimmed}. They now use folder-local settings. Have them reconnect their
          real folder.
        </p>
      )}
      {phase.state === "error" && (
        <p className="mt-3 text-meta text-rose-700">{phase.message}</p>
      )}

      <LivingPopup
        open={confirming}
        onClose={() => setConfirming(false)}
        label="Clear cloud settings"
        widthClassName="max-w-md"
        card
        padded
        blur
      >
        <div>
          <h2 className="text-title font-semibold text-foreground">
            Clear cloud settings for this user?
          </h2>
          <p className="mt-1 truncate text-meta text-foreground-muted">{trimmed}</p>
          <p className="mt-4 text-meta text-foreground-muted leading-relaxed">
            This removes only their cloud account-settings blob. They fall back to
            the settings in their local folder. Account, billing, and data are not
            touched. This is safe and reversible (they can re-lift later).
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={phase.state === "clearing"}
              className="rounded-lg border border-border bg-surface-raised px-3.5 py-2 text-body font-medium text-foreground transition-colors hover:bg-surface-sunken disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={phase.state === "clearing"}
              onClick={async () => {
                await submit();
                setConfirming(false);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-body font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
            >
              {phase.state === "clearing" ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Clearing...
                </>
              ) : (
                "Clear settings"
              )}
            </button>
          </div>
        </div>
      </LivingPopup>
    </section>
  );
}
