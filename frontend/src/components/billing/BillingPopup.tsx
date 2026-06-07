"use client";

// The consolidated Cloud storage & billing popup.
//
// One living popup owns EVERY billing surface so the user reaches all of it from
// a single place instead of scattered Settings cards:
//   - a plan summary (free / individual / covered-by-lab),
//   - their own usage against the limit,
//   - the storage-limit (cap) picker + payment, for individual payers,
//   - lab billing: a PI sponsoring their lab (roster, invites, aggregate), and a
//     member's pending invites (accept / decline + usage opt-in).
//
// Everything degrades gracefully when BILLING_ENABLED is off (usage only, no
// controls) and hides for local-only users.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";

import LivingPopup from "@/components/ui/LivingPopup";
import { useBillingModal } from "@/lib/billing/billing-modal-store";
import { GB_BYTES, humanBytes, usd } from "@/lib/billing/format";
import {
  type BillingStatus,
  type LabStatus,
  fetchBillingStatus,
  fetchLabStatus,
  inviteMember,
  removeMember,
  respondToInvite,
  setCap,
  setLabBilling,
  startCheckout,
} from "@/lib/billing/client";

// --- small shared pieces ----------------------------------------------------

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface-raised p-5 sm:p-6">
      <h3 className="text-title font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1 text-meta text-foreground-muted leading-relaxed">
          {description}
        </p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function usageTone(pct: number): { bar: string; ring: string; text: string } {
  if (pct >= 90)
    return {
      bar: "bg-red-500",
      ring: "ring-red-200 dark:ring-red-500/30",
      text: "text-red-700 dark:text-red-300",
    };
  if (pct >= 70)
    return {
      bar: "bg-amber-500",
      ring: "ring-amber-200 dark:ring-amber-500/30",
      text: "text-amber-700 dark:text-amber-300",
    };
  return {
    bar: "bg-sky-500",
    ring: "ring-sky-200 dark:ring-sky-500/30",
    text: "text-sky-700 dark:text-sky-300",
  };
}

function UsageBar({
  used,
  quota,
  freeBytes,
}: {
  used: number;
  quota: number;
  freeBytes: number;
}) {
  const safeQuota = Math.max(1, quota);
  const pct = Math.min(100, (Math.max(0, used) / safeQuota) * 100);
  const tone = usageTone(pct);
  const freeBoundaryPct =
    safeQuota > freeBytes ? Math.min(100, (freeBytes / safeQuota) * 100) : null;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <p className="text-heading font-bold tracking-tight text-foreground">
          {humanBytes(used)}{" "}
          <span className="text-body font-semibold text-foreground-muted">
            of {humanBytes(quota)}
          </span>
        </p>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-meta font-semibold ring-1 ring-inset ${tone.text} ${tone.ring}`}
        >
          {pct < 0.1 && used > 0 ? "<0.1" : pct.toFixed(pct < 10 ? 1 : 0)}%
        </span>
      </div>
      <div
        className="relative mt-2 h-3 w-full overflow-hidden rounded-full bg-surface-sunken ring-1 ring-inset ring-border"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div
          className={`h-full rounded-full ${tone.bar} transition-all`}
          style={{ width: `${Math.max(pct, used > 0 ? 1.5 : 0)}%` }}
        />
        {freeBoundaryPct != null ? (
          <div
            className="absolute top-0 h-full border-l border-dashed border-foreground-muted/60"
            style={{ left: `${freeBoundaryPct}%` }}
            title="End of the free tier"
          />
        ) : null}
      </div>
      {freeBoundaryPct != null ? (
        <p className="mt-1 text-meta text-foreground-muted">
          The dashed line marks the end of your {humanBytes(freeBytes)} free tier.
        </p>
      ) : null}
    </>
  );
}

// --- plan summary -----------------------------------------------------------

function PlanSummary({
  status,
  lab,
}: {
  status: BillingStatus;
  lab: LabStatus | null;
}) {
  const coveredByLab = !!lab?.sponsoredByLab;
  let tone = "text-foreground-muted";
  let ring = "ring-border";
  let heading = "Free plan";
  let detail = `You have ${humanBytes(status.freeBytes)} of shared-document storage included, always free.`;

  if (coveredByLab) {
    tone = "text-emerald-700 dark:text-emerald-300";
    ring = "ring-emerald-200 dark:ring-emerald-500/30";
    heading = "Covered by your lab";
    detail =
      "Your lab sponsors your storage on one shared invoice. You will not be billed individually.";
  } else if (status.active) {
    tone = "text-sky-700 dark:text-sky-300";
    ring = "ring-sky-200 dark:ring-sky-500/30";
    heading = "Individual plan";
    detail = `You pay only for your monthly average use above the ${humanBytes(status.freeBytes)} free tier.`;
  }

  return (
    <div
      className={`rounded-2xl border border-border bg-surface-raised p-5 ring-1 ring-inset ${ring}`}
    >
      <p className={`text-meta font-semibold uppercase tracking-wide ${tone}`}>
        {heading}
      </p>
      <p className="mt-1 text-body text-foreground leading-relaxed">{detail}</p>
    </div>
  );
}

// --- cap picker (individual payers) -----------------------------------------

function CapPicker({
  status,
  busy,
  onChoose,
}: {
  status: BillingStatus;
  busy: boolean;
  onChoose: (gb: number) => void;
}) {
  const freeGb = Math.round(status.freeBytes / GB_BYTES);
  const capGbNow = Math.round(Math.max(1, status.quotaBytes) / GB_BYTES);
  return (
    <Section
      title="Storage limit"
      description={`Pick a limit. You are billed only for your monthly average use above the ${humanBytes(status.freeBytes)} free tier, at ${usd(status.rateCents ?? 30)} per GB, one invoice a month, with a ${usd(status.minChargeCents ?? 200)} minimum (smaller months are free). The limit is your spend ceiling; the number on each option is the most it could ever cost.`}
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onChoose(freeGb)}
          className={`rounded-lg border px-3 py-2 text-left disabled:opacity-50 ${
            capGbNow <= freeGb
              ? "border-sky-500 bg-sky-50 dark:bg-sky-500/15"
              : "border-border bg-surface-raised hover:bg-surface-sunken"
          }`}
        >
          <span className="block text-body font-semibold text-foreground">
            {freeGb} GB
          </span>
          <span className="block text-meta text-foreground-muted">Free</span>
        </button>
        {(status.capOptions ?? []).map((opt) => {
          const selected = capGbNow === opt.gb;
          return (
            <button
              key={opt.gb}
              type="button"
              disabled={busy}
              onClick={() => onChoose(opt.gb)}
              className={`rounded-lg border px-3 py-2 text-left disabled:opacity-50 ${
                selected
                  ? "border-sky-500 bg-sky-50 dark:bg-sky-500/15"
                  : "border-border bg-surface-raised hover:bg-surface-sunken"
              }`}
            >
              <span className="block text-body font-semibold text-foreground">
                {opt.gb} GB
              </span>
              <span className="block text-meta text-foreground-muted">
                up to {usd(opt.maxCostCents)}/mo
              </span>
            </button>
          );
        })}
      </div>
      {!status.active ? (
        <p className="mt-2 text-meta text-foreground-muted">
          Choosing a paid limit adds a payment method first. Nothing is charged
          today. Any tax is added at checkout where it applies.
        </p>
      ) : null}
    </Section>
  );
}

// --- member side: pending lab invites ---------------------------------------

function MemberInvites({
  lab,
  busy,
  onRespond,
}: {
  lab: LabStatus;
  busy: boolean;
  onRespond: (
    labKey: string,
    action: "accept" | "decline",
    usageVisible: boolean,
  ) => void;
}) {
  const [showUsage, setShowUsage] = useState(false);
  if (lab.pendingInvites.length === 0) return null;
  return (
    <Section
      title="Lab billing invitation"
      description="A lab head invited you to have your storage paid for on their lab's invoice. If you accept, your own subscription (if any) ends and the lab covers your usage."
    >
      <label className="mb-3 flex items-center gap-2 text-meta text-foreground-muted">
        <input
          type="checkbox"
          checked={showUsage}
          onChange={(e) => setShowUsage(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        Also show my individual usage to the lab head (optional)
      </label>
      <div className="space-y-2">
        {lab.pendingInvites.map((inv) => (
          <div
            key={inv.labKey}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-sunken px-4 py-3"
          >
            <span className="text-meta text-foreground-muted">
              Invite from lab{" "}
              <span className="font-mono text-foreground">
                {inv.labKey.slice(0, 10)}…
              </span>
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onRespond(inv.labKey, "accept", showUsage)}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-meta font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRespond(inv.labKey, "decline", false)}
                className="rounded-lg border border-border px-3 py-1.5 text-meta font-semibold text-foreground hover:bg-surface-sunken disabled:opacity-50"
              >
                Decline
              </button>
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

// --- PI side: sponsor the lab -----------------------------------------------

function LabSponsorSection({
  lab,
  busy,
  onToggle,
  onInvite,
  onRemove,
}: {
  lab: LabStatus;
  busy: boolean;
  onToggle: (on: boolean) => void;
  onInvite: (email: string) => void;
  onRemove: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  // A sponsored member never sponsors their own lab.
  if (lab.sponsoredByLab) return null;

  const submitInvite = () => {
    const e = email.trim();
    if (e) {
      onInvite(e);
      setEmail("");
    }
  };

  return (
    <Section
      title="Sponsor your lab"
      description="Pay for your whole lab's storage on one invoice. Each member keeps their own free gigabyte (pooled), and you are billed only for the lab's combined use above that pool."
    >
      {!lab.canSponsor ? (
        <p className="rounded-lg border border-border bg-surface-sunken px-4 py-3 text-meta text-foreground-muted">
          Add a payment method first (raise your own storage limit) to start
          sponsoring your lab.
        </p>
      ) : (
        <>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={lab.labBilling}
              disabled={busy}
              onChange={(e) => onToggle(e.target.checked)}
              className="h-5 w-5 rounded border-border"
            />
            <span className="text-body font-medium text-foreground">
              {lab.labBilling
                ? "Lab billing is on, you sponsor the members below"
                : "Turn on lab billing"}
            </span>
          </label>

          {lab.labBilling ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatTile
                  label="Members"
                  value={String(lab.sponsoredOwners)}
                  hint="you + active members"
                />
                <StatTile
                  label="Pooled free"
                  value={humanBytes(lab.poolBytes)}
                  hint="1 GB each"
                />
                <StatTile
                  label="Est. this month"
                  value={usd(lab.estimatedChargeCents)}
                  hint={
                    lab.estimatedChargeCents === 0
                      ? "Under the minimum"
                      : "If usage holds"
                  }
                  strong
                />
              </div>

              <div className="mt-4">
                <UsageBar
                  used={lab.aggregateUsedBytes}
                  quota={Math.max(lab.poolBytes, lab.aggregateUsedBytes)}
                  freeBytes={lab.poolBytes}
                />
              </div>

              {/* Invite by email */}
              <div className="mt-5">
                <p className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
                  Invite a member
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    type="email"
                    value={email}
                    disabled={busy}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitInvite();
                    }}
                    placeholder="member@university.edu"
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <button
                    type="button"
                    disabled={busy || !email.trim()}
                    onClick={submitInvite}
                    className="rounded-lg bg-sky-600 px-4 py-2 text-meta font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                  >
                    Invite
                  </button>
                </div>
                <p className="mt-1 text-meta text-foreground-muted">
                  They must accept before the lab starts paying for them.
                </p>
              </div>

              {/* Roster */}
              {lab.roster.length > 0 ? (
                <ul className="mt-4 space-y-2">
                  {lab.roster.map((m) => (
                    <li
                      key={m.memberKey}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-sunken px-4 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-body text-foreground">
                          {m.label ?? `${m.memberKey.slice(0, 10)}…`}
                        </span>
                        <span className="text-meta text-foreground-muted">
                          {m.status === "active" ? "Active" : "Invited"}
                          {m.usedBytes != null
                            ? ` · ${humanBytes(m.usedBytes)}`
                            : m.status === "active"
                              ? " · usage private"
                              : ""}
                        </span>
                      </span>
                      <button
                        type="button"
                        disabled={busy || !m.label}
                        title={
                          m.label
                            ? "Remove from lab"
                            : "Cannot remove (no stored email)"
                        }
                        onClick={() => m.label && onRemove(m.label)}
                        className="rounded-lg border border-border px-3 py-1.5 text-meta font-semibold text-foreground hover:bg-surface-raised disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-meta text-foreground-muted">
                  No members yet. Invite someone above.
                </p>
              )}
            </>
          ) : null}
        </>
      )}
    </Section>
  );
}

function StatTile({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-sunken px-4 py-3">
      <p className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
        {label}
      </p>
      <p
        className={`mt-1 ${strong ? "text-title font-bold" : "text-body font-semibold"} tracking-tight text-foreground`}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-meta text-foreground-muted">{hint}</p> : null}
    </div>
  );
}

// --- the popup --------------------------------------------------------------

export default function BillingPopup() {
  const modal = useBillingModal();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [lab, setLab] = useState<LabStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, l] = await Promise.all([fetchBillingStatus(), fetchLabStatus()]);
    if (s?.signedIn) setStatus(s);
    // Lab status is only meaningful when billing is enabled (route 404s otherwise).
    setLab(l && l.enabled ? l : null);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch when the popup opens; setState fires only after the awaited fetch, no sync cascade.
    if (modal.isOpen) void load();
  }, [modal.isOpen, load]);

  const chooseCap = useCallback(
    async (gb: number) => {
      if (!status) return;
      const freeGb = Math.round(status.freeBytes / GB_BYTES);
      if (gb > freeGb && !status.active) {
        const url = await startCheckout();
        if (url) window.location.href = url;
        return;
      }
      setBusy(true);
      const res = await setCap(gb);
      if (res.needsCheckout) {
        const url = await startCheckout();
        if (url) {
          window.location.href = url;
          return;
        }
      }
      if (res.ok) await load();
      setBusy(false);
    },
    [status, load],
  );

  const toggleLab = useCallback(
    async (on: boolean) => {
      setBusy(true);
      const res = await setLabBilling(on);
      if (res.needsCheckout) {
        const url = await startCheckout();
        if (url) {
          window.location.href = url;
          return;
        }
      }
      await load();
      setBusy(false);
    },
    [load],
  );

  const doInvite = useCallback(
    async (email: string) => {
      setBusy(true);
      await inviteMember(email);
      await load();
      setBusy(false);
    },
    [load],
  );

  const doRemove = useCallback(
    async (email: string) => {
      setBusy(true);
      await removeMember(email);
      await load();
      setBusy(false);
    },
    [load],
  );

  const doRespond = useCallback(
    async (labKey: string, action: "accept" | "decline", usageVisible: boolean) => {
      setBusy(true);
      await respondToInvite(labKey, action, usageVisible);
      await load();
      setBusy(false);
    },
    [load],
  );

  const showCapPicker = !!status?.enabled && !lab?.sponsoredByLab;

  return (
    <LivingPopup
      open={modal.isOpen}
      origin={modal.origin}
      onClose={modal.close}
      label="Cloud storage and billing"
      widthClassName="max-w-2xl"
      card={false}
      fillHeight
    >
      <div className="pointer-events-auto flex max-h-[88vh] flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-black/5">
        <header className="border-b border-border px-6 py-4">
          <h2 className="text-heading font-semibold text-foreground">
            Cloud storage and billing
          </h2>
          <p className="mt-0.5 text-meta text-foreground-muted">
            Your shared-document storage. Your local app and local files are always
            free and unlimited.
          </p>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {!status ? (
            <p className="text-body text-foreground-muted">Loading your storage…</p>
          ) : (
            <>
              <PlanSummary status={status} lab={lab} />

              <Section
                title="Your usage"
                description="What counts: the live, server-synced copies of documents you share and co-edit. Notes are tiny, so this fills slowly. Your local data folder and files only on your computer never count."
              >
                <UsageBar
                  used={status.usedBytes}
                  quota={status.quotaBytes}
                  freeBytes={status.freeBytes}
                />
              </Section>

              {lab ? (
                <MemberInvites lab={lab} busy={busy} onRespond={doRespond} />
              ) : null}

              {showCapPicker ? (
                <CapPicker status={status} busy={busy} onChoose={chooseCap} />
              ) : null}

              {lab ? (
                <LabSponsorSection
                  lab={lab}
                  busy={busy}
                  onToggle={toggleLab}
                  onInvite={doInvite}
                  onRemove={doRemove}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </LivingPopup>
  );
}
