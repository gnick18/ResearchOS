// Badge earn logic (badges v1 foundation). PURE, no side effects.
//
// computeEarnedBadges takes a flat metrics snapshot for one lab/user and
// returns the ids of every catalog badge whose criteria are met. The metrics
// adapter (whoever assembles BadgeMetrics from real lab/profile data) lives at
// the call site; this file only evaluates the rules. Keeping it pure makes it
// the validated core (see __tests__/earn.test.ts).
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

import { BADGE_CATALOG, type BadgeCriteria } from "./catalog";

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

/** Evaluate one criterion against the metrics. Pure. */
function meetsCriteria(criteria: BadgeCriteria, m: BadgeMetrics): boolean {
  switch (criteria.kind) {
    case "founding":
      return m.isFounding;
    case "count":
      // Only experiments are wired in v1; the metric is typed for future ones.
      return m.experiments >= criteria.threshold;
    case "event":
      if (criteria.event === "external_share") return m.hasExternalShare;
      if (criteria.event === "companion_site") return m.hasCompanionSite;
      return false;
    case "tenure":
      return m.tenureDays >= criteria.days;
    default:
      return false;
  }
}

/**
 * Return the ids of all catalog badges earned by these metrics, in catalog
 * order. Pure, deterministic, no side effects.
 */
export function computeEarnedBadges(metrics: BadgeMetrics): string[] {
  return BADGE_CATALOG.filter((badge) =>
    meetsCriteria(badge.criteria, metrics),
  ).map((badge) => badge.id);
}
