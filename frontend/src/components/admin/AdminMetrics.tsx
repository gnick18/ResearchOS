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
import {
  capacityStatus,
  pctUsed,
  type CapacityStatus,
} from "@/lib/sharing/capacity-shared";

interface CapacityMetrics {
  neon: { usedBytes: number | null; limitBytes: number };
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

interface Metrics {
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
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <span className="text-body font-semibold text-gray-700">
            ResearchOS operator metrics
          </span>
          <Link
            href="/"
            className="text-body font-medium text-sky-700 underline-offset-2 hover:underline"
          >
            Back to the app
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        {children}
      </main>
      <AppFooter />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <p className="text-meta font-medium uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-display font-bold tracking-tight text-gray-900">
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
        <span className="text-meta text-gray-500">{label}</span>
        <span className={`text-meta font-semibold ${STATUS_TEXT[status]}`}>
          {pct < 10 ? pct.toFixed(1) : Math.round(pct)}%
        </span>
      </div>
      <span className="mt-1 block h-2 overflow-hidden rounded-full bg-gray-100">
        <span
          className={`block h-full rounded-full ${STATUS_BAR[status]}`}
          style={{ width: `${Math.max(pct, 1.5)}%` }}
        />
      </span>
      <p className="mt-1 text-meta text-gray-400">
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
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-3">
        <p className="text-body font-semibold text-gray-900">{name}</p>
        <p className="text-meta text-gray-400">{sub}</p>
      </div>
      {children}
    </div>
  );
}

function Unavailable() {
  return (
    <p className="text-meta text-gray-400 leading-relaxed">
      Measurement unavailable, the service is not configured or did not respond.
    </p>
  );
}

/**
 * The two ceilings that can actually take cross-boundary sharing down: R2
 * storage (the sealed bundles in flight) and Resend's monthly send budget.
 * Both are rendered as ordinary service cards below, sitting among services
 * that self-clean (Neon, Upstash keys) or are console-only and are NOT the
 * binding constraint. This banner pulls the two binding ones to the top and
 * shouts when either crosses a watch or critical threshold, so the survival
 * signal does not get lost in a grid of equal-looking tiles.
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
          : "Both survival-critical ceilings are healthy.";

  return (
    <div className={`mb-4 rounded-2xl border p-4 ${BOX[worst]}`}>
      <p className={`text-body font-semibold ${STATUS_TEXT[worst]}`}>{headline}</p>
      <p className="mt-1 text-meta text-gray-500 leading-relaxed">
        These two ceilings are the ones that can take cross-boundary sharing
        down. The other services below either self-clean (Neon rows, Upstash
        keys all TTL out) or are only visible in the provider console, so they
        are not the binding constraint.
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
              <span className="text-meta font-semibold text-gray-700">{s.name}</span>
              {s.available ? (
                <span className={`text-meta font-semibold ${STATUS_TEXT[st]}`}>
                  {s.pct < 10 ? s.pct.toFixed(1) : Math.round(s.pct)}%
                </span>
              ) : (
                <span className="text-meta text-gray-400">unavailable</span>
              )}
              <span className="text-meta text-gray-400">{s.detail}.</span>
              <span className="w-full text-meta text-gray-400 leading-relaxed">{s.meaning}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function AdminMetrics() {
  const [state, setState] = useState<
    | { phase: "loading" }
    | { phase: "denied" }
    | { phase: "error" }
    | { phase: "ready"; data: Metrics }
  >({ phase: "loading" });

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

  if (state.phase === "loading") {
    return (
      <Shell>
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-sky-500" />
        </div>
      </Shell>
    );
  }

  if (state.phase === "denied") {
    return (
      <Shell>
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <h1 className="text-heading font-semibold text-gray-900">
            Not authorized
          </h1>
          <p className="mt-2 text-body text-gray-600 leading-relaxed">
            This page is for operators. Sign in with an admin account, or this
            account is not on the allow-list.
          </p>
        </div>
      </Shell>
    );
  }

  if (state.phase === "error") {
    return (
      <Shell>
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <h1 className="text-heading font-semibold text-gray-900">
            Could not load metrics
          </h1>
          <p className="mt-2 text-body text-gray-600">Try again in a moment.</p>
        </div>
      </Shell>
    );
  }

  const { directory: d, relay: r } = state.data;
  const maxMonth = Math.max(1, ...d.signupsByMonth.map((m) => m.count));

  return (
    <Shell>
      <div className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-display font-bold tracking-tight text-gray-900">
          Operator metrics
        </h1>
        <div className="shrink-0 pt-1">
          <BeakerBotGreeting metrics={state.data} />
        </div>
      </div>

      {/* Headline counts */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Registered identities" value={d.totalIdentities} />
        <StatCard label="Published profiles" value={d.totalProfiles} />
        <StatCard label="ORCID linked" value={d.orcidLinks} />
        <StatCard label="Pending shares" value={r.pendingShares} />
        <StatCard label="Pending storage" value={humanBytes(r.pendingBytes)} />
        <StatCard label="Shares ever sent" value={r.totalEverSent} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Signups over time */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-title font-semibold text-gray-900">
            Signups by month
          </h2>
          {d.signupsByMonth.length === 0 ? (
            <p className="text-body text-gray-500">No signups yet.</p>
          ) : (
            <ul className="space-y-2">
              {d.signupsByMonth.map((m) => (
                <li key={m.month} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 font-mono text-meta text-gray-500">
                    {m.month}
                  </span>
                  <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <span
                      className="block h-full rounded-full bg-sky-500"
                      style={{ width: `${(m.count / maxMonth) * 100}%` }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right text-meta tabular-nums text-gray-700">
                    {m.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Profiles by institution */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-title font-semibold text-gray-900">
            Profiles by institution
          </h2>
          {d.profilesByDomain.length === 0 ? (
            <p className="text-body text-gray-500">
              No verified-institution profiles yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {d.profilesByDomain.map((row) => (
                <li
                  key={row.domain}
                  className="flex items-center justify-between text-body"
                >
                  <span className="font-mono text-gray-700">{row.domain}</span>
                  <span className="tabular-nums text-gray-500">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Infrastructure capacity / cost planning */}
      {state.data.capacity && (
        <section className="mt-10">
          <h2 className="text-title font-semibold text-gray-900">
            Infrastructure capacity
          </h2>
          <p className="mb-4 mt-1 text-meta text-gray-400 leading-relaxed">
            How much of each service&apos;s free-tier ceiling is in use, so you
            can see what (if anything) needs a paid upgrade and when. Ceilings are
            the published free-tier limits as of 2026-06-05, verify against your
            actual plan since they change.
          </p>
          {(() => {
            const c = state.data.capacity;
            return (
              <>
                <SurvivalRisk c={c} />
                <div className="grid gap-4 sm:grid-cols-2">
                {/* Neon Postgres */}
                <ServiceCard
                  name="Neon Postgres"
                  sub="Accounts, profiles, relay metadata"
                >
                  {c.neon.usedBytes === null ? (
                    <Unavailable />
                  ) : (
                    <UsageBar
                      label="Database size"
                      used={c.neon.usedBytes}
                      limit={c.neon.limitBytes}
                      usedLabel={humanBytes(c.neon.usedBytes)}
                      limitLabel={humanBytes(c.neon.limitBytes)}
                    />
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
                      <p className="mt-2 text-meta text-gray-400">
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
                      <p className="text-display font-bold tracking-tight text-gray-900">
                        {fmtInt(c.upstash.keyCount)}
                      </p>
                      <p className="text-meta text-gray-400">live keys</p>
                      <p className="mt-2 text-meta text-gray-400 leading-relaxed">
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
                        usedLabel={`${fmtInt(
                          c.resend.sentLast30Days ?? 0,
                        )} sent`}
                        limitLabel={`${fmtInt(c.resend.perMonthLimit)}/month`}
                      />
                    </div>
                  )}
                </ServiceCard>
                </div>
              </>
            );
          })()}
        </section>
      )}

      {/* Feature usage (anonymous custom events) */}
      {state.data.events && (
        <section className="mt-10">
          <h2 className="text-title font-semibold text-gray-900">
            Feature usage
          </h2>
          <p className="mb-4 mt-1 text-meta text-gray-400 leading-relaxed">
            Anonymous counts of how often key features are used over the last{" "}
            {state.data.events.windowDays} days, totals only, never per-user.
            Captured from our own event log; the Vercel dashboard below has the
            same events plus page traffic.
          </p>
          {(() => {
            const e = state.data.events;
            const hasShareDetail =
              e.shareSent.byKind.length > 0 ||
              e.shareSent.byDestination.length > 0;
            return (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <StatCard label="Shares sent" value={e.shareSent.total} />
                  <StatCard
                    label="Profiles published"
                    value={e.profilePublished.total}
                  />
                  <StatCard
                    label="Identities created"
                    value={e.identityCreated}
                  />
                </div>

                {(hasShareDetail || e.profilePublished.total > 0) && (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {/* Shares, by item type and destination */}
                    <div className="rounded-2xl border border-gray-200 bg-white p-5">
                      <p className="text-body font-semibold text-gray-900">
                        Shares by type
                      </p>
                      {e.shareSent.byKind.length === 0 ? (
                        <p className="mt-2 text-meta text-gray-400">
                          No shares in this window.
                        </p>
                      ) : (
                        <ul className="mt-2 space-y-1.5">
                          {e.shareSent.byKind.map((row) => (
                            <li
                              key={row.kind}
                              className="flex items-center justify-between text-body"
                            >
                              <span className="text-gray-700">
                                {SHARE_KIND_LABELS[row.kind] ?? row.kind}
                              </span>
                              <span className="tabular-nums text-gray-500">
                                {fmtInt(row.count)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {e.shareSent.byDestination.length > 0 && (
                        <>
                          <p className="mt-4 text-meta font-medium uppercase tracking-wide text-gray-400">
                            By destination
                          </p>
                          <ul className="mt-1.5 space-y-1.5">
                            {e.shareSent.byDestination.map((row) => (
                              <li
                                key={row.destination}
                                className="flex items-center justify-between text-body"
                              >
                                <span className="text-gray-700">
                                  {SHARE_DESTINATION_LABELS[row.destination] ??
                                    row.destination}
                                </span>
                                <span className="tabular-nums text-gray-500">
                                  {fmtInt(row.count)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>

                    {/* Published-profile composition */}
                    <div className="rounded-2xl border border-gray-200 bg-white p-5">
                      <p className="text-body font-semibold text-gray-900">
                        Published profiles
                      </p>
                      {e.profilePublished.total === 0 ? (
                        <p className="mt-2 text-meta text-gray-400">
                          No profiles published in this window.
                        </p>
                      ) : (
                        <ul className="mt-2 space-y-1.5 text-body">
                          <li className="flex items-center justify-between">
                            <span className="text-gray-700">
                              With an ORCID linked
                            </span>
                            <span className="tabular-nums text-gray-500">
                              {fmtInt(e.profilePublished.withOrcid)} of{" "}
                              {fmtInt(e.profilePublished.total)}
                            </span>
                          </li>
                          <li className="flex items-center justify-between">
                            <span className="text-gray-700">
                              With an affiliation
                            </span>
                            <span className="tabular-nums text-gray-500">
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
          })()}
        </section>
      )}

      {/* Page-usage pointer */}
      <p className="mt-8 text-meta text-gray-400 leading-relaxed">
        For page popularity and traffic, see the Vercel Web Analytics dashboard
        in your Vercel project. ResearchOS deliberately does not track per-user
        page views, the app is local-first and sends nothing per-user, so the
        only usage signal is Vercel&apos;s anonymous page-view pings.
      </p>
    </Shell>
  );
}
