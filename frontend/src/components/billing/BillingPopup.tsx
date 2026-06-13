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
import { humanBytes, usd } from "@/lib/billing/format";
import { priceForMethod, bankSavingCents } from "@/lib/billing/processing-fee";
import {
  type BillingStatus,
  type LabStatus,
  choosePlan,
  fetchBillingStatus,
  fetchLabStatus,
  inviteMember,
  removeMember,
  respondToInvite,
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

/** Compact write-count label, e.g. "1.2M" or "500k". */
function formatWrites(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

// --- plan picker (the single bundle control) --------------------------------

function PlanPicker({
  status,
  busy,
  onChoose,
}: {
  status: BillingStatus;
  busy: boolean;
  onChoose: (planId: string, payClass: "card" | "bank") => void;
}) {
  const plans = status.plans ?? [];
  const current = status.planId ?? "free";
  // Pay class sets the price: card is the list, paying by bank transfer (ACH)
  // earns a discount that reflects the lower processing fee. Defaults to card.
  const [payClass, setPayClass] = useState<"card" | "bank">("card");
  if (plans.length === 0) return null;
  return (
    <Section
      title="Your plan"
      description="One plan covers your storage and your editing activity. Upgrading raises both at once, on one monthly invoice. Most people stay on Free."
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-meta text-foreground-muted">Pay by</span>
        {(["card", "bank"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setPayClass(c)}
            aria-pressed={payClass === c}
            className={`rounded-full border px-3 py-1 text-meta font-semibold ${
              payClass === c
                ? "border-sky-500 bg-sky-50 text-foreground dark:bg-sky-500/15"
                : "border-border bg-surface-raised text-foreground-muted hover:bg-surface-sunken"
            }`}
          >
            {c === "card" ? "Card" : "Bank transfer"}
          </button>
        ))}
        {payClass === "bank" && (
          <span className="text-meta text-emerald-700 dark:text-emerald-300">
            lower processing fee, so a lower price
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {plans.map((p) => {
          const selected = p.id === current;
          const priceCents =
            payClass === "bank" ? priceForMethod(p.priceCents, "bank", false) : p.priceCents;
          const save = payClass === "bank" ? bankSavingCents(p.priceCents, false) : 0;
          return (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => onChoose(p.id, payClass)}
              className={`flex-1 min-w-[8rem] rounded-xl border px-4 py-3 text-left disabled:opacity-50 ${
                selected
                  ? "border-sky-500 bg-sky-50 dark:bg-sky-500/15"
                  : "border-border bg-surface-raised hover:bg-surface-sunken"
              }`}
            >
              <span className="block text-body font-bold text-foreground">
                {p.name}
              </span>
              <span className="block text-meta text-foreground">
                {humanBytes(p.storageBytes)}
              </span>
              <span className="block text-meta text-foreground">
                {formatWrites(p.activityWritesPerMonth)} edits/mo
              </span>
              <span className="mt-1 block text-meta font-semibold text-foreground-muted">
                {p.priceCents === 0 ? "Free" : `up to ${usd(priceCents)}/mo`}
              </span>
              {save > 0 && (
                <span className="block text-meta font-semibold text-emerald-700 dark:text-emerald-300">
                  save {usd(save)}/mo
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* A-la-carte comparison anchor (not separately purchasable). */}
      <div className="mt-3 rounded-lg px-4 py-2.5 text-meta ring-1 ring-inset ring-emerald-200 dark:ring-emerald-500/30">
        <p className="text-foreground-muted line-through">
          Buying storage and activity separately would cost more.
        </p>
        <p className="font-semibold text-emerald-700 dark:text-emerald-300">
          A plan bundles both for about 10% more value. You save by bundling.
        </p>
      </div>
      {!status.active ? (
        <p className="mt-2 text-meta text-foreground-muted">
          A paid plan adds a payment method first. Nothing is charged today. Any
          tax is added at checkout where it applies.
        </p>
      ) : null}
    </Section>
  );
}

// --- activity (the throttle ceiling, shown as a bar) ------------------------

function ActivityCard({ status }: { status: BillingStatus }) {
  const used = status.activityWrites ?? 0;
  const allowance = status.activityAllowance ?? 0;
  if (allowance <= 0) return null;
  const pct = Math.min(100, (used / allowance) * 100);
  const over = used >= allowance;
  const near = !over && pct >= 80;
  const tone = over
    ? { bar: "bg-red-500", text: "text-red-700 dark:text-red-300" }
    : near
      ? { bar: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" }
      : { bar: "bg-sky-500", text: "text-sky-700 dark:text-sky-300" };
  const message = over
    ? "You have passed your plan's activity allowance, so cloud sync is slowed to keep costs fair. Editing still works. Upgrade your plan to restore instant sync."
    : near
      ? "You are a heavy user this month. Still real-time, but upgrading your plan raises this if you pass it."
      : "Plenty of headroom. Editing is included in your plan, never charged per edit.";
  return (
    <Section
      title="Activity this month"
      description="How much you edit through the cloud, separate from storage. Past your plan's allowance we slow sync rather than bill you, so there are no surprise charges."
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <p className="text-heading font-bold tracking-tight text-foreground">
          {formatWrites(used)}{" "}
          <span className="text-body font-semibold text-foreground-muted">
            of {formatWrites(allowance)} edit syncs
          </span>
        </p>
      </div>
      <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-surface-sunken ring-1 ring-inset ring-border">
        <div
          className={`h-full rounded-full ${tone.bar} transition-all`}
          style={{ width: `${Math.max(pct, used > 0 ? 1.5 : 0)}%` }}
        />
      </div>
      <p className={`mt-2 text-meta leading-relaxed ${tone.text}`}>{message}</p>
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
  onRespond: (labKey: string, action: "accept" | "decline") => void;
}) {
  if (lab.pendingInvites.length === 0) return null;
  return (
    <Section
      title="Lab billing invitation"
      description="A lab head invited you to have your storage paid for on their lab's invoice. If you accept, your own subscription (if any) ends, the lab covers your usage, and the lab head can see your storage and activity since they pay for it."
    >
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
                onClick={() => onRespond(inv.labKey, "accept")}
                className="rounded-lg bg-brand-action px-3 py-1.5 text-meta font-semibold text-white hover:bg-brand-action/90 disabled:opacity-50"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRespond(inv.labKey, "decline")}
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
  onChoosePlan,
  onInvite,
  onRemove,
}: {
  lab: LabStatus;
  busy: boolean;
  onChoosePlan: (planId: string) => void;
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
      description="One lab plan covers your whole lab's storage and editing activity, pooled across members, on a single monthly invoice. Members never pay separately."
    >
      <>
        {/* Lab plan picker, the single control. */}
        <div className="flex flex-wrap gap-2">
          {lab.labPlans.map((p) => {
            const selected = p.id === lab.labPlanId;
            return (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                onClick={() => onChoosePlan(p.id)}
                className={`flex-1 min-w-[8rem] rounded-xl border px-4 py-3 text-left disabled:opacity-50 ${
                  selected
                    ? "border-sky-500 bg-sky-50 dark:bg-sky-500/15"
                    : "border-border bg-surface-raised hover:bg-surface-sunken"
                }`}
              >
                <span className="block text-body font-bold text-foreground">
                  {p.name}
                </span>
                <span className="block text-meta text-foreground">
                  {humanBytes(p.storageBytes)} pooled
                </span>
                <span className="block text-meta text-foreground">
                  {formatWrites(p.activityWritesPerMonth)} edits/mo
                </span>
                <span className="mt-1 block text-meta font-semibold text-foreground-muted">
                  {p.priceCents === 0 ? "Free" : `${usd(p.priceCents)}/mo`}
                </span>
              </button>
            );
          })}
        </div>

        {lab.labBilling ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile
                label="Members"
                value={String(lab.sponsoredOwners)}
                hint="you + active members"
              />
              <StatTile
                label="Lab plan"
                value={lab.labPlanName}
                hint={`${humanBytes(lab.labCapBytes)} pooled`}
              />
              <StatTile
                label="This month"
                value={usd(lab.estimatedChargeCents)}
                hint="flat lab plan"
                strong
              />
            </div>

            <div className="mt-4">
              <p className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
                Lab storage, pooled
              </p>
              <UsageBar
                used={lab.aggregateUsedBytes}
                quota={lab.labCapBytes}
                freeBytes={lab.labCapBytes}
              />
            </div>

            <div className="mt-3">
              <p className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
                Lab activity this month
              </p>
              <div className="mt-1.5 flex items-end justify-between gap-3">
                <p className="text-body font-semibold text-foreground">
                  {formatWrites(lab.aggregateWrites)}{" "}
                  <span className="font-normal text-foreground-muted">
                    of {formatWrites(lab.labActivityAllowance)} edit syncs
                  </span>
                </p>
              </div>
              <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken ring-1 ring-inset ring-border">
                <div
                  className="h-full rounded-full bg-sky-500 transition-all"
                  style={{
                    width: `${Math.min(100, lab.labActivityAllowance > 0 ? (lab.aggregateWrites / lab.labActivityAllowance) * 100 : 0)}%`,
                  }}
                />
              </div>
            </div>

            {/* Sponsor an outside collaborator. Lab members get a pooled seat
                automatically when they join your folder (managed in Lab Mode),
                so this is only for paying for someone OUTSIDE your shared folder.
                Only billing-only rows (source 'invite') show here. */}
              <div className="mt-5">
                <p className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
                  Sponsor an outside collaborator
                </p>
                <p className="mt-1 text-meta text-foreground-muted">
                  Your lab members are covered automatically. Use this only to pay
                  for someone outside your shared folder.
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
                    placeholder="collaborator@another-lab.edu"
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <button
                    type="button"
                    disabled={busy || !email.trim()}
                    onClick={submitInvite}
                    className="rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white hover:bg-brand-action/90 disabled:opacity-50"
                  >
                    Sponsor
                  </button>
                </div>
                <p className="mt-1 text-meta text-foreground-muted">
                  They must accept before the lab starts paying for them.
                </p>
              </div>

              {/* Outside collaborators only (billing-only seats). Data-lab members
                  appear in the unified People roster, not here. */}
              {(() => {
                const collaborators = lab.roster.filter(
                  (m) => m.source !== "directory",
                );
                return collaborators.length > 0 ? (
                  <ul className="mt-4 space-y-2">
                    {collaborators.map((m) => (
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
                            {m.usedBytes != null ? ` · ${humanBytes(m.usedBytes)}` : ""}
                            {m.writes != null ? ` · ${formatWrites(m.writes)} edits` : ""}
                          </span>
                        </span>
                        <button
                          type="button"
                          disabled={busy || !m.label}
                          title={
                            m.label
                              ? "Stop sponsoring"
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
                    No outside collaborators sponsored. Your lab members are
                    covered automatically.
                  </p>
                );
              })()}
            </>
          ) : null}
      </>
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

  const pickPlan = useCallback(
    async (planId: string, payClass: "card" | "bank" = "card") => {
      setBusy(true);
      const res = await choosePlan(planId, payClass);
      // A paid plan returns a Stripe Checkout url to finish payment.
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      if (res.ok) await load();
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
    async (labKey: string, action: "accept" | "decline") => {
      setBusy(true);
      await respondToInvite(labKey, action);
      await load();
      setBusy(false);
    },
    [load],
  );

  // A member covered by a lab does not pick their own plan; the lab does.
  const showPlanPicker = !!status?.enabled && !lab?.sponsoredByLab;

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
      <div className="pointer-events-auto flex max-h-[88vh] flex-col overflow-hidden rounded-2xl bg-surface-overlay border border-border shadow-2xl ring-1 ring-black/5">
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

              {status.enabled ? <ActivityCard status={status} /> : null}

              {lab ? (
                <MemberInvites lab={lab} busy={busy} onRespond={doRespond} />
              ) : null}

              {showPlanPicker ? (
                <PlanPicker status={status} busy={busy} onChoose={pickPlan} />
              ) : null}

              {lab ? (
                <LabSponsorSection
                  lab={lab}
                  busy={busy}
                  onChoosePlan={pickPlan}
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
