// Badges section (badges v1). The composed public surface, shelf over bin.
//
// Owns the pinned-set state shared between the read-only BadgeShelf (top, the
// public-profile presentation) and the interactive BadgeBin (below, tap-to-pin
// the full catalog). It computes earned ids from a BadgeMetrics snapshot, so
// the caller only has to hand it metrics and a stable profileId.
//
// METRICS ADAPTER: v1 ships with a representative demo-metrics helper
// (demoBadgeMetrics) because the public lab profile is server-rendered and the
// real activity counts are not yet plumbed to it. When real lab/profile
// metrics become available, pass them in directly; phase 2 plumbing is the
// hook-in point (see the comment in BadgeBin about a folder sidecar snapshot).
//
// This component renders ONLY when the caller has already checked the
// NEXT_PUBLIC_BADGES_ENABLED flag, so it stays dark by default.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

"use client";

import { useMemo, useState } from "react";

import BadgeShelf from "@/components/badges/BadgeShelf";
import BadgeBin from "@/components/badges/BadgeBin";
import { computeEarnedBadges, type BadgeMetrics } from "@/lib/badges/earn";

/**
 * Representative demo metrics for a showcase / a profile with no real counts
 * wired in yet. Earns the founding, 100-experiment, first-share, and
 * companion-site badges; leaves 1,000 experiments and one year LOCKED so the
 * bin shows both states.
 */
export function demoBadgeMetrics(): BadgeMetrics {
  return {
    experiments: 247,
    isFounding: true,
    tenureDays: 120,
    hasExternalShare: true,
    hasCompanionSite: true,
  };
}

export default function BadgeSection({
  profileId,
  metrics,
  showHeader = true,
}: {
  /** Stable id used as the localStorage pin key (e.g. the lab slug). */
  profileId: string;
  metrics: BadgeMetrics;
  /**
   * Render the section's own "Badges" heading + blurb. True on the public
   * profile (one section among many); pass false on a dedicated Badges page that
   * already supplies its own page title, to avoid a doubled heading.
   */
  showHeader?: boolean;
}) {
  const earnedIds = useMemo(() => computeEarnedBadges(metrics), [metrics]);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);

  return (
    <section className={showHeader ? "mt-12 border-t border-border pt-8" : ""}>
      {showHeader && (
        <>
          <h2 className="text-title font-semibold text-foreground">Badges</h2>
          <p className="mt-1 text-meta text-foreground-muted">
            Earned from real lab activity. Pin up to four to feature on the
            profile.
          </p>
        </>
      )}

      <div className="mt-6">
        <BadgeShelf pinnedIds={pinnedIds} earnedIds={earnedIds} />
      </div>

      <div className="mt-8">
        <BadgeBin
          profileId={profileId}
          earnedIds={earnedIds}
          onPinsChange={setPinnedIds}
        />
      </div>
    </section>
  );
}
