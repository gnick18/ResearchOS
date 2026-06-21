"use client";

// PI-facing storage and analytics dashboard panel (lab-domains Part 2).
//
// Fetches GET /api/social/lab-site/usage and renders:
//   - Storage and hosting: total hosted bytes + monthly cost, per-site table.
//   - Views: total views, per-site list, 30-day sparkline.
//
// All authorization is enforced server-side by the route. This component renders
// whatever the route returns (including calm empty states for a lab with no
// hosted assets or no views yet).
//
// The dollar figure is always what the server computes via hostedAssetMonthlyCost.
// We state the WHY next to it per house copy rules (feedback_copy_state_the_why).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";

// ---------------------------------------------------------------------------
// Types matching the route response shape
// ---------------------------------------------------------------------------

interface StorageSiteRow {
  siteKey: string | null;
  label: string;
  bytes: number;
  monthlyCostUsd: number;
}

interface ViewsSiteRow {
  siteKey: string;
  label: string;
  views: number;
}

interface DailyRow {
  day: string;
  views: number;
}

interface UsagePayload {
  storage: {
    totalBytes: number;
    totalMonthlyCostUsd: number;
    bySite: StorageSiteRow[];
  };
  views: {
    total: number;
    bySite: ViewsSiteRow[];
    daily: DailyRow[];
  };
}

// ---------------------------------------------------------------------------
// Byte formatter
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(3)} GB`;
}

// ---------------------------------------------------------------------------
// Inline sparkline (minimal SVG polyline, 30-day daily view series)
// ---------------------------------------------------------------------------

function ViewsSparkline({ daily }: { daily: DailyRow[] }) {
  if (daily.length < 2) return null;

  const W = 160;
  const H = 36;
  const PAD = 2;

  const values = daily.map((d) => d.views);
  const maxVal = Math.max(...values, 1);

  const points = daily
    .map((d, i) => {
      const x = PAD + ((W - PAD * 2) * i) / (daily.length - 1);
      const y = PAD + (H - PAD * 2) * (1 - d.views / maxVal);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    // This is a data-visualization SVG, not an icon, so an inline <svg> is correct here.
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      aria-hidden="true"
      className="block"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="text-brand-500"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

/**
 * Fetches and renders the PI's lab-site storage metering and page-view analytics.
 * Pass `siteOwnerKey` when the caller is a granted editor viewing a PI's site;
 * omit it for the owner's own dashboard.
 */
export default function LabSiteUsagePanel({
  siteOwnerKey,
}: {
  siteOwnerKey?: string;
}) {
  const [data, setData] = useState<UsagePayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const url = siteOwnerKey
        ? `/api/social/lab-site/usage?siteOwnerKey=${encodeURIComponent(siteOwnerKey)}`
        : "/api/social/lab-site/usage";
      const res = await fetch(url);
      if (!res.ok) {
        setState("error");
        return;
      }
      const payload = (await res.json()) as UsagePayload;
      setData(payload);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [siteOwnerKey]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === "loading") {
    return (
      <section className="mb-8 rounded-xl border border-border bg-surface-raised p-5">
        <p className="text-sm text-muted-foreground">Loading usage data.</p>
      </section>
    );
  }

  if (state === "error" || !data) {
    return (
      <section className="mb-8 rounded-xl border border-border bg-surface-raised p-5">
        <p className="text-sm text-muted-foreground">
          Could not load usage data right now. Refresh the page to try again.
        </p>
      </section>
    );
  }

  const { storage, views } = data;
  const hasStorage = storage.totalBytes > 0;
  const hasViews = views.total > 0;

  return (
    <section className="mb-8 rounded-xl border border-border bg-surface-raised p-5 space-y-6">
      {/* ------------------------------------------------------------------ */}
      {/* Storage and hosting                                                  */}
      {/* ------------------------------------------------------------------ */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Icon name="database" className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-medium text-foreground">
            Storage and hosting
          </h2>
        </div>

        {!hasStorage ? (
          <p className="text-sm text-muted-foreground">
            No files hosted yet. Publish a page or upload a site to see your
            storage usage here.
          </p>
        ) : (
          <>
            <div className="mb-4 flex items-baseline gap-4">
              <div>
                <p className="text-2xl font-semibold text-foreground tabular-nums">
                  {formatBytes(storage.totalBytes)}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Total hosted
                </p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground tabular-nums">
                  ${storage.totalMonthlyCostUsd.toFixed(4)}/mo
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Hosting is passed through at near our cost, about 1.15x R2
                  list price.
                </p>
              </div>
            </div>

            {storage.bySite.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="pb-1.5 text-left text-xs font-medium text-muted-foreground">
                      Site
                    </th>
                    <th className="pb-1.5 text-right text-xs font-medium text-muted-foreground">
                      Size
                    </th>
                    <th className="pb-1.5 text-right text-xs font-medium text-muted-foreground">
                      Cost/mo
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {storage.bySite.map((row, i) => (
                    <tr key={row.siteKey ?? `__null_${i}`}>
                      <td className="py-2 text-foreground">{row.label}</td>
                      <td className="py-2 text-right text-muted-foreground tabular-nums">
                        {formatBytes(row.bytes)}
                      </td>
                      <td className="py-2 text-right text-muted-foreground tabular-nums">
                        ${row.monthlyCostUsd.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Page views                                                           */}
      {/* ------------------------------------------------------------------ */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Icon name="chart" className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-medium text-foreground">
            Page views (last 30 days)
          </h2>
        </div>

        {!hasViews ? (
          <p className="text-sm text-muted-foreground">
            No page views recorded yet. Views appear here once visitors load
            your public lab site.
          </p>
        ) : (
          <>
            <div className="mb-4 flex items-baseline gap-6">
              <div>
                <p className="text-2xl font-semibold text-foreground tabular-nums">
                  {views.total.toLocaleString()}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Total views
                </p>
              </div>
              {views.daily.length >= 2 && (
                <div className="text-brand-500">
                  <ViewsSparkline daily={views.daily} />
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Daily trend
                  </p>
                </div>
              )}
            </div>

            {views.bySite.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {views.bySite.map((row) => (
                  <li
                    key={row.siteKey}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <span className="text-sm text-foreground">{row.label}</span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {row.views.toLocaleString()} views
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
