// Badge metrics, the PURE leaf (badges phase 2, owner-side foundation).
//
// Dependency-free decision logic so it can be unit tested without a DOM, a
// folder, or pulling in local-api. The I/O loader (loadBadgeMetrics) lives in
// metrics.ts and reuses these. Splitting the leaf out keeps the node-project
// test (metrics.test.ts) trustworthy in a symlinked worktree and avoids dragging
// the heavy local-api module into the test graph.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

import type { BadgeMetrics } from "./earn";

/** The raw counts/flags the loader assembles before normalization. */
export interface BadgeMetricCounts {
  /** Total experiments logged across the lab. */
  experiments: number;
  /** Days since the earliest member joined this folder. */
  tenureDays: number;
  /** True once work has been shared with an external collaborator. */
  hasExternalShare?: boolean;
  /** True when the lab/user is in the founding cohort. */
  isFounding?: boolean;
  /** True once a public companion site is live. */
  hasCompanionSite?: boolean;
}

/**
 * Normalize raw counts into a BadgeMetrics snapshot. PURE. Counts are clamped to
 * non-negative integers so a stray float or negative never reaches the engine,
 * and the three not-yet-wired flags default to false (the metrics.ts header
 * documents why each is a gap rather than a faked value).
 */
export function computeBadgeMetricsFromCounts(c: BadgeMetricCounts): BadgeMetrics {
  return {
    experiments: clampCount(c.experiments),
    tenureDays: clampCount(c.tenureDays),
    hasExternalShare: c.hasExternalShare ?? false,
    isFounding: c.isFounding ?? false,
    hasCompanionSite: c.hasCompanionSite ?? false,
  };
}

/** Clamp any number to a non-negative integer (NaN / negative / float safe). */
export function clampCount(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * Whole days between an ISO timestamp and `now` (ms). PURE. A missing or
 * unparseable timestamp yields 0 (no tenure rather than a wrong one), and a
 * future timestamp clamps to 0.
 */
export function tenureDaysSince(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  const days = Math.floor((now - t) / 86_400_000);
  return days > 0 ? days : 0;
}

/**
 * The earliest member join date in the folder (ISO), or null when none is known.
 * PURE so the tenure rule is testable. Tenure is a lab-level signal, so the lab's
 * age is the EARLIEST member's created_at, not the current user's.
 */
export function earliestCreatedAt(
  metadata: Record<string, { created_at?: string }>,
): string | null {
  let earliest: number | null = null;
  let earliestIso: string | null = null;
  for (const entry of Object.values(metadata)) {
    const iso = entry.created_at;
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) continue;
    if (earliest === null || t < earliest) {
      earliest = t;
      earliestIso = iso;
    }
  }
  return earliestIso;
}
