"use client";

// Operator metrics dashboard body (rendered at /admin).
//
// Grant-only. Fetches /api/admin/metrics, which is gated on ADMIN_EMAILS, so a
// non-admin (or a signed-out visitor) just sees "not authorized", no data. All
// figures are AGGREGATE, never per-user. Like /privacy and /open-source it
// renders without the AppShell or a connected folder, and is excluded from the
// wiki-coverage map.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Inline SVG.

import { useEffect, useState } from "react";

import Link from "next/link";
import AppFooter from "@/components/AppFooter";
import BeakerBotGreeting from "@/components/admin/BeakerBotGreeting";
import BroadcastPanel from "@/components/admin/BroadcastPanel";
import OperatorSignIn from "@/components/admin/OperatorSignIn";
import SpendByCategoryPanel from "@/components/admin/SpendByCategoryPanel";
import {
  capacityStatus,
  pctUsed,
  type CapacityStatus,
} from "@/lib/sharing/capacity-shared";

interface CapacityMetrics {
  neon: {
    usedBytes: number | null;
    limitBytes: number;
    collabBytes: number | null;
    collabBudgetBytes: number;
  };
  r2: {
    usedBytes: number | null;
    objectCount: number | null;
    limitBytes: number;
  };
  upstash: {
    keyCount: number | null;
    storageLimitBytes: number;
    commandsPerMonthLimit: number;
  };
  resend: {
    sentToday: number | null;
    sentLast30Days: number | null;
    byKind: { kind: string; count: number }[];
    perDayLimit: number;
    perMonthLimit: number;
  };
}

interface EventMetrics {
  windowDays: number;
  shareSent: {
    total: number;
    byKind: { kind: string; count: number }[];
    byDestination: { destination: string; count: number }[];
  };
  profilePublished: {
    total: number;
    withOrcid: number;
    withAffiliation: number;
  };
  identityCreated: number;
}

export interface Metrics {
  directory: {
    totalIdentities: number;
    totalProfiles: number;
    orcidLinks: number;
    signupsByMonth: { month: string; count: number }[];
    profilesByDomain: { domain: string; count: number }[];
  };
  relay: {
    pendingShares: number;
    pendingBytes: number;
    totalEverSent: number;
  };
  capacity?: CapacityMetrics;
  events?: EventMetrics;
}

export type MetricsState =
  | { phase: "loading" }
  | { phase: "denied" }
  | { phase: "error" }
  | { phase: "ready"; data: Metrics };

/** Shared loader for the operator metrics endpoint. Used by both the standalone
 *  AdminMetrics page and the unified OperatorShell. Aggregate only; the endpoint
 *  is gated on ADMIN_EMAILS so a non-operator just gets the "denied" phase. */
export function useAdminMetrics(): MetricsState {
  const [state, setState] = useState<MetricsState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/metrics")
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404 || res.status === 401) {
          setState({ phase: "denied" });
          return;
        }
        if (!res.ok) {
          setState({ phase: "error" });
          return;
        }
        const data = (await res.json()) as Metrics;
        setState({ phase: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export { humanBytes };

const SHARE_KIND_LABELS: Record<string, string> = {
  note: "Notes",
  experiment: "Experiments",
  method: "Methods",
  project: "Projects",
  sequence: "Sequences",
  other: "Other",
  unknown: "Unspecified",
};

const SHARE_DESTINATION_LABELS: Record<string, string> = {
  existing_user: "To existing users",
  email_invite: "Email invites to non-users",
  unknown: "Unspecified",
};

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-sunken text-foreground">
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
          <span className="text-body font-semibold text-foreground">
            ResearchOS operator metrics
          </span>
          <div className="flex items-center gap-4">
            <Link
              href="/business"
              className="text-body font-medium text-sky-700 underline-offset-2 hover:underline"
            >
              Business
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
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-6 py-10">
        {children}
      </main>
      <AppFooter />
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5">
      <p className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
        {label}
      </p>
      <p className="mt-1 text-display font-bold tracking-tight text-foreground">
        {value}
      </p>
    </div>
  );
}

function fmtInt(n: number): string {
  return n.toLocaleString();
}

const STATUS_BAR: Record<CapacityStatus, string> = {
  ok: "bg-emerald-500",
  watch: "bg-amber-500",
  critical: "bg-rose-500",
};

const STATUS_TEXT: Record<CapacityStatus, string> = {
  ok: "text-emerald-700",
  watch: "text-amber-700",
  critical: "text-rose-600",
};

/** A labelled used/limit progress bar, coloured by how close to the ceiling. */
function UsageBar({
  label,
  used,
  limit,
  usedLabel,
  limitLabel,
}: {
  label: string;
  used: number;
  limit: number;
  usedLabel: string;
  limitLabel: string;
}) {
  const pct = pctUsed(used, limit);
  const status = capacityStatus(pct);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-meta text-foreground-muted">{label}</span>
        <span className={`text-meta font-semibold ${STATUS_TEXT[status]}`}>
          {pct < 10 ? pct.toFixed(1) : Math.round(pct)}%
        </span>
      </div>
      <span className="mt-1 block h-2 overflow-hidden rounded-full bg-surface-sunken">
        <span
          className={`block h-full rounded-full ${STATUS_BAR[status]}`}
          style={{ width: `${Math.max(pct, 1.5)}%` }}
        />
      </span>
      <p className="mt-1 text-meta text-foreground-muted">
        {usedLabel} of {limitLabel}
      </p>
    </div>
  );
}

/** One service tile in the capacity grid. */
function ServiceCard({
  name,
  sub,
  children,
}: {
  name: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5">
      <div className="mb-3">
        <p className="text-body font-semibold text-foreground">{name}</p>
        <p className="text-meta text-foreground-muted">{sub}</p>
      </div>
      {children}
    </div>
  );
}

function Unavailable() {
  return (
    <p className="text-meta text-foreground-muted leading-relaxed">
      Measurement unavailable, the service is not configured or did not respond.
    </p>
  );
}

/**
 * The ceilings that can actually take cross-boundary sharing and collab down,
 * R2 storage (the sealed bundles in flight), Resend's monthly send budget, and
 * Neon storage via collab (shared-doc content). All three are rendered as
 * ordinary service cards below, sitting among services that self-clean (Upstash
 * keys) or are console-only and are NOT the binding constraint. This banner
 * pulls the binding ones to the top and shouts when any crosses a watch or
 * critical threshold, so the survival signal does not get lost in a grid of
 * equal-looking tiles.
 *
 * Neon is the most expensive tier to upgrade and its free 0.5 GB is the
 * smallest, so once collab persists real shared-doc content it becomes a
 * survival-critical signal alongside R2 and Resend. It reads near zero before
 * collab ships, which is the point, the budget exists before users arrive.
 */
function SurvivalRisk({ c }: { c: CapacityMetrics }) {
  const signals = [
    {
      key: "r2",
      name: "Cloudflare R2 storage",
      available: c.r2.usedBytes !== null,
      pct: pctUsed(c.r2.usedBytes ?? 0, c.r2.limitBytes),
      detail: `${humanBytes(c.r2.usedBytes ?? 0)} of ${humanBytes(c.r2.limitBytes)} of sealed bundles in flight`,
      meaning:
        "Per-inbox caps bound each user, but the global free tier is the real ceiling. About ten full 1 GB inboxes reach it.",
    },
    {
      key: "collab",
      name: "Neon collab storage",
      available: c.neon.collabBytes !== null,
      pct: pctUsed(c.neon.collabBytes ?? 0, c.neon.collabBudgetBytes),
      detail: `${humanBytes(c.neon.collabBytes ?? 0)} of ${humanBytes(c.neon.collabBudgetBytes)} of shared-doc content`,
      meaning:
        "Shared notes persist on Neon, the binding and most expensive tier. Per-doc and per-owner caps bound each user, about ten full owners reach this soft budget.",
    },
    {
      key: "resend",
      name: "Resend email",
      available: c.resend.sentLast30Days !== null,
      pct: pctUsed(c.resend.sentLast30Days ?? 0, c.resend.perMonthLimit),
      detail: `${fmtInt(c.resend.sentLast30Days ?? 0)} of ${fmtInt(c.resend.perMonthLimit)} sends in the last 30 days`,
      meaning:
        "Every OTP and share invite spends one. This is the only ceiling that is truly monthly and global.",
    },
  ];
  const worst: CapacityStatus = signals
    .filter((s) => s.available)
    .reduce<CapacityStatus>((acc, s) => {
      const st = capacityStatus(s.pct);
      if (acc === "critical" || st === "critical") return "critical";
      if (acc === "watch" || st === "watch") return "watch";
      return "ok";
    }, "ok");
  const anyUnavailable = signals.some((s) => !s.available);

  const BOX: Record<CapacityStatus, string> = {
    ok: "border-emerald-200 bg-emerald-50",
    watch: "border-amber-200 bg-amber-50",
    critical: "border-rose-200 bg-rose-50",
  };
  const headline =
    worst === "critical"
      ? "A survival-critical ceiling is close to its limit."
      : worst === "watch"
        ? "A survival-critical ceiling is worth watching."
        : anyUnavailable
          ? "One survival-critical ceiling could not be measured."
          : "All survival-critical ceilings are healthy.";

  return (
    <div className={`mb-4 rounded-2xl border p-4 ${BOX[worst]}`}>
      <p className={`text-body font-semibold ${STATUS_TEXT[worst]}`}>{headline}</p>
      <p className="mt-1 text-meta text-foreground-muted leading-relaxed">
        These ceilings are the ones that can take cross-boundary sharing and
        collab down. The other services below either self-clean (Upstash keys
        all TTL out, relay rows expire) or are only visible in the provider
        console, so they are not the binding constraint.
      </p>
      <ul className="mt-3 space-y-2">
        {signals.map((s) => {
          const st = capacityStatus(s.pct);
          return (
            <li key={s.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span
                className={`inline-block h-2 w-2 self-center rounded-full ${
                  s.available ? STATUS_BAR[st] : "bg-gray-300"
                }`}
              />
              <span className="text-meta font-semibold text-foreground">{s.name}</span>
              {s.available ? (
                <span className={`text-meta font-semibold ${STATUS_TEXT[st]}`}>
                  {s.pct < 10 ? s.pct.toFixed(1) : Math.round(s.pct)}%
                </span>
              ) : (
                <span className="text-meta text-foreground-muted">unavailable</span>
              )}
              <span className="text-meta text-foreground-muted">{s.detail}.</span>
              <span className="w-full text-meta text-foreground-muted leading-relaxed">{s.meaning}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ============================================================================
// Section pieces, reused by the standalone AdminMetrics page and OperatorShell.
// Each takes the loaded Metrics and renders one slice of the dashboard, with
// the exact markup the page has always used.
// ============================================================================

/** Headline counts (identities, profiles, ORCID, relay), the strip the metrics
 *  page leads with and the dashboard pulls into its "Users & sharing" block. */
export function MetricsHeadlineStats({ data }: { data: Metrics }) {
  const { directory: d, relay: r } = data;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <StatCard label="Registered identities" value={d.totalIdentities} />
      <StatCard label="Published profiles" value={d.totalProfiles} />
      <StatCard label="ORCID linked" value={d.orcidLinks} />
      <StatCard label="Pending shares" value={r.pendingShares} />
      <StatCard label="Pending storage" value={humanBytes(r.pendingBytes)} />
      <StatCard label="Shares ever sent" value={r.totalEverSent} />
    </div>
  );
}

export function SignupsSection({ data }: { data: Metrics }) {
  const d = data.directory;
  const maxMonth = Math.max(1, ...d.signupsByMonth.map((m) => m.count));
  return (
    <section className="rounded-2xl border border-border bg-surface-raised p-6">
      <h2 className="mb-4 text-title font-semibold text-foreground">
        Signups by month
      </h2>
      {d.signupsByMonth.length === 0 ? (
        <p className="text-body text-foreground-muted">No signups yet.</p>
      ) : (
        <ul className="space-y-2">
          {d.signupsByMonth.map((m) => (
            <li key={m.month} className="flex items-center gap-3">
              <span className="w-16 shrink-0 font-mono text-meta text-foreground-muted">
                {m.month}
              </span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                <span
                  className="block h-full rounded-full bg-sky-500"
                  style={{ width: `${(m.count / maxMonth) * 100}%` }}
                />
              </span>
              <span className="w-8 shrink-0 text-right text-meta tabular-nums text-foreground">
                {m.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function InstitutionsSection({ data }: { data: Metrics }) {
  const d = data.directory;
  return (
    <section className="rounded-2xl border border-border bg-surface-raised p-6">
      <h2 className="mb-4 text-title font-semibold text-foreground">
        Profiles by institution
      </h2>
      {d.profilesByDomain.length === 0 ? (
        <p className="text-body text-foreground-muted">
          No verified-institution profiles yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {d.profilesByDomain.map((row) => (
            <li
              key={row.domain}
              className="flex items-center justify-between text-body"
            >
              <span className="font-mono text-foreground">{row.domain}</span>
              <span className="tabular-nums text-foreground-muted">{row.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The infrastructure-capacity grid. Renders nothing when capacity is absent. */
export function CapacitySection({ data }: { data: Metrics }) {
  if (!data.capacity) return null;
  const c = data.capacity;
  return (
    <>
      <SurvivalRisk c={c} />
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Neon Postgres */}
        <ServiceCard
          name="Neon Postgres"
          sub="Accounts, profiles, relay metadata, collab docs"
        >
          {c.neon.usedBytes === null ? (
            <Unavailable />
          ) : (
            <div className="space-y-3">
              <UsageBar
                label="Database size"
                used={c.neon.usedBytes}
                limit={c.neon.limitBytes}
                usedLabel={humanBytes(c.neon.usedBytes)}
                limitLabel={humanBytes(c.neon.limitBytes)}
              />
              {c.neon.collabBytes !== null && (
                <UsageBar
                  label="Of which collab docs"
                  used={c.neon.collabBytes}
                  limit={c.neon.collabBudgetBytes}
                  usedLabel={humanBytes(c.neon.collabBytes)}
                  limitLabel={`${humanBytes(c.neon.collabBudgetBytes)} budget`}
                />
              )}
              <p className="text-meta text-foreground-muted leading-relaxed">
                Collab persists shared-doc content here, so it has its
                own soft budget inside the tier. Per-doc and per-owner
                caps keep any single user from filling it.
              </p>
            </div>
          )}
        </ServiceCard>

        {/* Cloudflare R2 */}
        <ServiceCard
          name="Cloudflare R2"
          sub="Encrypted share bundles in flight"
        >
          {c.r2.usedBytes === null ? (
            <Unavailable />
          ) : (
            <>
              <UsageBar
                label="Object storage"
                used={c.r2.usedBytes}
                limit={c.r2.limitBytes}
                usedLabel={humanBytes(c.r2.usedBytes)}
                limitLabel={humanBytes(c.r2.limitBytes)}
              />
              <p className="mt-2 text-meta text-foreground-muted">
                {fmtInt(c.r2.objectCount ?? 0)}{" "}
                {c.r2.objectCount === 1 ? "bundle" : "bundles"} parked.
                Bundles auto-expire, so this stays low.
              </p>
            </>
          )}
        </ServiceCard>

        {/* Upstash Redis */}
        <ServiceCard
          name="Upstash Redis"
          sub="Rate-limit windows + OTP codes"
        >
          {c.upstash.keyCount === null ? (
            <Unavailable />
          ) : (
            <>
              <p className="text-display font-bold tracking-tight text-foreground">
                {fmtInt(c.upstash.keyCount)}
              </p>
              <p className="text-meta text-foreground-muted">live keys</p>
              <p className="mt-2 text-meta text-foreground-muted leading-relaxed">
                All keys are short-lived and TTL&apos;d, so storage stays
                tiny. The free-tier limit that actually bites is{" "}
                {fmtInt(c.upstash.commandsPerMonthLimit)} commands/month,
                which is only visible in the Upstash console.
              </p>
            </>
          )}
        </ServiceCard>

        {/* Resend email */}
        <ServiceCard name="Resend email" sub="OTP codes + share invites">
          {c.resend.sentToday === null ? (
            <Unavailable />
          ) : (
            <div className="space-y-3">
              <UsageBar
                label="Today"
                used={c.resend.sentToday}
                limit={c.resend.perDayLimit}
                usedLabel={`${fmtInt(c.resend.sentToday)} sent`}
                limitLabel={`${fmtInt(c.resend.perDayLimit)}/day`}
              />
              <UsageBar
                label="Last 30 days"
                used={c.resend.sentLast30Days ?? 0}
                limit={c.resend.perMonthLimit}
                usedLabel={`${fmtInt(c.resend.sentLast30Days ?? 0)} sent`}
                limitLabel={`${fmtInt(c.resend.perMonthLimit)}/month`}
              />
            </div>
          )}
        </ServiceCard>
      </div>
    </>
  );
}

/** Feature-usage counts + the shares/profiles breakdown. Renders nothing when
 *  events are absent. The Broadcast panel moved to its own COMMS section in the
 *  unified shell, so it is NOT rendered here. */
export function FeatureUsageSection({ data }: { data: Metrics }) {
  if (!data.events) return null;
  const e = data.events;
  const hasShareDetail =
    e.shareSent.byKind.length > 0 || e.shareSent.byDestination.length > 0;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Shares sent" value={e.shareSent.total} />
        <StatCard label="Profiles published" value={e.profilePublished.total} />
        <StatCard label="Identities created" value={e.identityCreated} />
      </div>

      {(hasShareDetail || e.profilePublished.total > 0) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {/* Shares, by item type and destination */}
          <div className="rounded-2xl border border-border bg-surface-raised p-5">
            <p className="text-body font-semibold text-foreground">
              Shares by type
            </p>
            {e.shareSent.byKind.length === 0 ? (
              <p className="mt-2 text-meta text-foreground-muted">
                No shares in this window.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {e.shareSent.byKind.map((row) => (
                  <li
                    key={row.kind}
                    className="flex items-center justify-between text-body"
                  >
                    <span className="text-foreground">
                      {SHARE_KIND_LABELS[row.kind] ?? row.kind}
                    </span>
                    <span className="tabular-nums text-foreground-muted">
                      {fmtInt(row.count)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {e.shareSent.byDestination.length > 0 && (
              <>
                <p className="mt-4 text-meta font-medium uppercase tracking-wide text-foreground-muted">
                  By destination
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {e.shareSent.byDestination.map((row) => (
                    <li
                      key={row.destination}
                      className="flex items-center justify-between text-body"
                    >
                      <span className="text-foreground">
                        {SHARE_DESTINATION_LABELS[row.destination] ??
                          row.destination}
                      </span>
                      <span className="tabular-nums text-foreground-muted">
                        {fmtInt(row.count)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* Published-profile composition */}
          <div className="rounded-2xl border border-border bg-surface-raised p-5">
            <p className="text-body font-semibold text-foreground">
              Published profiles
            </p>
            {e.profilePublished.total === 0 ? (
              <p className="mt-2 text-meta text-foreground-muted">
                No profiles published in this window.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-body">
                <li className="flex items-center justify-between">
                  <span className="text-foreground">With an ORCID linked</span>
                  <span className="tabular-nums text-foreground-muted">
                    {fmtInt(e.profilePublished.withOrcid)} of{" "}
                    {fmtInt(e.profilePublished.total)}
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <span className="text-foreground">With an affiliation</span>
                  <span className="tabular-nums text-foreground-muted">
                    {fmtInt(e.profilePublished.withAffiliation)} of{" "}
                    {fmtInt(e.profilePublished.total)}
                  </span>
                </li>
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** The "Not authorized" and "Could not load" panels, reused so the shell shows
 *  the same operator gate as the standalone pages. */
export function OperatorDeniedPanel() {
  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-8 text-center">
      <h1 className="text-heading font-semibold text-foreground">
        Not authorized
      </h1>
      <p className="mt-2 text-body text-foreground-muted leading-relaxed">
        This page is for operators. Sign in with an admin account, or this
        account is not on the allow-list.
      </p>
      <div className="mx-auto mt-1 max-w-md text-left">
        <OperatorSignIn />
      </div>
    </div>
  );
}

export function OperatorErrorPanel() {
  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-8 text-center">
      <h1 className="text-heading font-semibold text-foreground">
        Could not load metrics
      </h1>
      <p className="mt-2 text-body text-foreground-muted">
        If you are not signed in as an operator, sign in below, otherwise try
        again in a moment.
      </p>
      <div className="mx-auto mt-1 max-w-md text-left">
        <OperatorSignIn />
      </div>
    </div>
  );
}

export default function AdminMetrics() {
  const state = useAdminMetrics();

  if (state.phase === "loading") {
    return (
      <Shell>
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-sky-500" />
        </div>
      </Shell>
    );
  }

  if (state.phase === "denied") {
    return (
      <Shell>
        <OperatorDeniedPanel />
      </Shell>
    );
  }

  if (state.phase === "error") {
    return (
      <Shell>
        <OperatorErrorPanel />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-display font-bold tracking-tight text-foreground">
          Operator metrics
        </h1>
        <div className="shrink-0 pt-1">
          <BeakerBotGreeting metrics={state.data} />
        </div>
      </div>

      {/* Headline counts */}
      <MetricsHeadlineStats data={state.data} />

      {/* Monthly money flow (cost out + revenue in). */}
      <div className="mt-8">
        <SpendByCategoryPanel />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <SignupsSection data={state.data} />
        <InstitutionsSection data={state.data} />
      </div>

      {/* Infrastructure capacity / cost planning */}
      {state.data.capacity && (
        <section className="mt-10">
          <h2 className="text-title font-semibold text-foreground">
            Infrastructure capacity
          </h2>
          <p className="mb-4 mt-1 text-meta text-foreground-muted leading-relaxed">
            How much of each service&apos;s free-tier ceiling is in use, so you
            can see what (if anything) needs a paid upgrade and when. Ceilings are
            the published free-tier limits as of 2026-06-05, verify against your
            actual plan since they change.
          </p>
          <CapacitySection data={state.data} />
        </section>
      )}

      {/* Feature usage (anonymous custom events) */}
      {state.data.events && (
        <section className="mt-10">
          <h2 className="text-title font-semibold text-foreground">
            Feature usage
          </h2>
          <p className="mb-4 mt-1 text-meta text-foreground-muted leading-relaxed">
            Anonymous counts of how often key features are used over the last{" "}
            {state.data.events.windowDays} days, totals only, never per-user.
            Captured from our own event log; the Vercel dashboard below has the
            same events plus page traffic.
          </p>
          <FeatureUsageSection data={state.data} />
        </section>
      )}

      {/* Broadcast email */}
      <div className="mt-10">
        <BroadcastPanel />
      </div>

      {/* Page-usage pointer */}
      <p className="mt-8 text-meta text-foreground-muted leading-relaxed">
        For page popularity and traffic, see the Vercel Web Analytics dashboard
        in your Vercel project. ResearchOS deliberately does not track per-user
        page views, the app is local-first and sends nothing per-user, so the
        only usage signal is Vercel&apos;s anonymous page-view pings.
      </p>
    </Shell>
  );
}
