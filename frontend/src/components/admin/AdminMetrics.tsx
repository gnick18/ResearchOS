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
}

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
      <h1 className="mb-6 text-display font-bold tracking-tight text-gray-900">
        Operator metrics
      </h1>

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
