"use client";

// The owner-facing Badges surface (badges phase 2, owner-side foundation).
//
// Unlike the public network profile (server-rendered, no folder access, fed demo
// metrics), this route runs inside the connected-folder app, so it shows the
// lab's REAL earned badges from loadBadgeMetrics (experiment count + tenure
// today; the roster/cloud-derived criteria are documented gaps in metrics.ts).
// The owner is also signed in here, so pins persist to the account-scoped cloud
// blob via BadgeBin.
//
// Flag-gated on NEXT_PUBLIC_BADGES_ENABLED, so it ships DARK in prod (no nav link
// points here yet; final placement is Grant's call). When the flag is off it
// renders a one-line note, matching the dark-by-default contract.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

import { useEffect, useState } from "react";

import AppShell from "@/components/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import { Icon } from "@/components/icons";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import BadgeSection from "@/components/badges/BadgeSection";
import { loadBadgeMetrics } from "@/lib/badges/metrics";
import { BADGES_ENABLED } from "@/lib/badges/config";
import type { BadgeMetrics } from "@/lib/badges/earn";

export default function BadgesRoute() {
  const { currentUser } = useCurrentUser();
  const [metrics, setMetrics] = useState<BadgeMetrics | null>(null);

  // Compute real badge metrics from the connected folder once on mount. The
  // loader is resilient (returns a safe empty snapshot on any read hiccup), so
  // this never throws and the page always resolves.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const m = await loadBadgeMetrics();
      if (!cancelled) setMetrics(m);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell>
      <PageContainer width="wide" className="py-6">
        <div className="mb-5 space-y-1">
          <h1 className="flex items-center gap-2 text-title font-semibold text-foreground">
            <Icon name="medal" className="h-5 w-5" />
            Badges
          </h1>
          <p className="text-meta text-foreground-muted leading-relaxed">
            Earned from the real activity in your lab. Pin up to four to feature
            on your public profile. Pins follow your account across devices.
          </p>
        </div>

        {!BADGES_ENABLED ? (
          <p className="text-meta text-foreground-muted">
            Set NEXT_PUBLIC_BADGES_ENABLED=1 to render the badge surface.
          </p>
        ) : metrics === null ? (
          <p className="text-meta text-foreground-muted">Reading your lab activity...</p>
        ) : (
          <BadgeSection
            profileId={currentUser ?? "self"}
            metrics={metrics}
            showHeader={false}
          />
        )}
      </PageContainer>
    </AppShell>
  );
}
