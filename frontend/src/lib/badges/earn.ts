// Badge earn logic (badges v1 foundation). PURE, no side effects.
//
// computeEarnedBadges takes a flat metrics snapshot for one lab/user and
// returns the ids of every catalog badge whose criteria are met. The metrics
// adapter (whoever assembles BadgeMetrics from real lab/profile data) lives at
// the call site; this file only evaluates the rules. Keeping it pure makes it
// the validated core (see __tests__/earn.test.ts).
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

import { BADGE_CATALOG, type Badge } from "./catalog";

/** Flat, serializable activity snapshot for one lab or user. */
export interface BadgeMetrics {
  /** Total experiments logged. */
  experiments: number;
  /** True when the lab/user belongs to the founding cohort. */
  isFounding: boolean;
  /** Days since the lab/user joined. */
  tenureDays: number;
  /** True once any work has been shared with an external collaborator. */
  hasExternalShare: boolean;
  /** True once a public companion site has been published. */
  hasCompanionSite: boolean;
}

/** Evaluate one badge against the metrics + the awarded grants. Pure. */
function isEarned(badge: Badge, m: BadgeMetrics, awarded: Set<string>): boolean {
  const c = badge.criteria;
  switch (c.kind) {
    case "founding":
      return m.isFounding;
    case "count":
      // Only experiments are wired in v1; the metric is typed for future ones.
      return m.experiments >= c.threshold;
    case "event":
      if (c.event === "external_share") return m.hasExternalShare;
      if (c.event === "companion_site") return m.hasCompanionSite;
      return false;
    case "tenure":
      return m.tenureDays >= c.days;
    case "awarded":
      // Instructor-granted (class mode), not metric-computed. Earned only when
      // the badge id is in the awarded set (the grant records the holder has).
      return awarded.has(badge.id);
    default:
      return false;
  }
}

/**
 * Return the ids of all catalog badges earned by these metrics plus any
 * instructor-awarded grants, in catalog order. Pure, deterministic, no side
 * effects. `awardedBadgeIds` is the set of badge ids granted to this holder (for
 * class mode, assembled at the call site from the relay team-key grant records);
 * empty for solo and lab holders that earn only from metrics.
 */
export function computeEarnedBadges(
  metrics: BadgeMetrics,
  awardedBadgeIds: readonly string[] = [],
): string[] {
  const awarded = new Set(awardedBadgeIds);
  return BADGE_CATALOG.filter((badge) => isEarned(badge, metrics, awarded)).map(
    (badge) => badge.id,
  );
}
