// Badge snapshot (badges phase 2, the network-page publish contract).
//
// A badge is a NETWORK-PAGE feature, so the public, server-rendered profile page
// renders from a small SERVER-READABLE snapshot the owner publishes, not from the
// local folder (which the public page cannot see) or the E2E account blob (which
// the server cannot decrypt). The snapshot is deliberately minimal: just the two
// id lists. The catalog (catalog.ts) supplies every label, glyph, ring color, and
// the static text, so the public page renders fully from ids alone, nothing
// recomputes server-side and no activity counts leak.
//
// Owner side: compute earned ids from real metrics (lib/badges/metrics + the earn
// engine), keep the user's chosen pins, build a snapshot, publish it to the
// holder's profile record (directory_profiles for a researcher, lab_sites for a
// lab). Public side: read the snapshot and render BadgePublicView.
//
// This module is PURE so the build + (de)serialize rules are unit tested.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

import { computeEarnedBadges, type BadgeMetrics } from "./earn";

/** The shared pin cap across the shelf, the bin, and a published snapshot. */
export const MAX_PINNED_BADGES = 4;

/**
 * The minimal published badge snapshot. `earnedBadgeIds` is the full earned set
 * (drives the locked-vs-earned bin and validates pins); `pinnedBadgeIds` is the
 * featured subset shown on the shelf, always a subset of earned and capped.
 */
export interface BadgeSnapshot {
  earnedBadgeIds: string[];
  pinnedBadgeIds: string[];
}

/** An empty snapshot, the safe default for a holder who has published nothing. */
export function emptyBadgeSnapshot(): BadgeSnapshot {
  return { earnedBadgeIds: [], pinnedBadgeIds: [] };
}

/**
 * Build a publishable snapshot from real metrics + the owner's chosen pins.
 * PURE. Earned ids come from the validated earn engine; pins are filtered to the
 * earned set, de-duped, and capped, so a stale or over-long pin list can never
 * publish a pin the holder has not actually earned.
 */
export function buildBadgeSnapshot(
  metrics: BadgeMetrics,
  pinnedBadgeIds: readonly string[],
  awardedBadgeIds: readonly string[] = [],
): BadgeSnapshot {
  const earnedBadgeIds = computeEarnedBadges(metrics, awardedBadgeIds);
  return {
    earnedBadgeIds,
    pinnedBadgeIds: normalizePins(pinnedBadgeIds, earnedBadgeIds),
  };
}

/**
 * Clamp a pin list to the publishable rule: only earned ids, de-duped, in the
 * caller's order, capped at MAX_PINNED_BADGES. PURE. Shared by the builder and by
 * the owner editor so the cap rule lives in exactly one place.
 */
export function normalizePins(
  pinnedBadgeIds: readonly string[],
  earnedBadgeIds: readonly string[],
): string[] {
  const earned = new Set(earnedBadgeIds);
  const out: string[] = [];
  for (const id of pinnedBadgeIds) {
    if (earned.has(id) && !out.includes(id) && out.length < MAX_PINNED_BADGES) {
      out.push(id);
    }
  }
  return out;
}

/** Sanitize an unknown into a string-id array (defensive boundary helper). */
function asStringIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string")
    : [];
}

/**
 * Parse an unknown (hand-editable JSON from the DB, a network payload) into a
 * safe BadgeSnapshot. PURE and defensive, so a malformed or partial value never
 * crashes a public render, it degrades to whatever ids are valid. Pins are
 * re-normalized against the parsed earned set.
 */
export function parseBadgeSnapshot(value: unknown): BadgeSnapshot {
  if (!value || typeof value !== "object") return emptyBadgeSnapshot();
  const v = value as Record<string, unknown>;
  const earnedBadgeIds = asStringIds(v.earnedBadgeIds);
  const pinnedBadgeIds = normalizePins(asStringIds(v.pinnedBadgeIds), earnedBadgeIds);
  return { earnedBadgeIds, pinnedBadgeIds };
}

/** Parse a JSON string column (e.g. lab_sites.badge_snapshot_json) defensively. */
export function parseBadgeSnapshotJson(raw: string | null | undefined): BadgeSnapshot {
  if (!raw) return emptyBadgeSnapshot();
  try {
    return parseBadgeSnapshot(JSON.parse(raw));
  } catch {
    return emptyBadgeSnapshot();
  }
}

/** Serialize a snapshot to a compact JSON string for a JSON column. */
export function serializeBadgeSnapshot(snapshot: BadgeSnapshot): string {
  return JSON.stringify({
    earnedBadgeIds: snapshot.earnedBadgeIds,
    pinnedBadgeIds: snapshot.pinnedBadgeIds,
  });
}

/** True when a snapshot has nothing to show (skip the section entirely). */
export function isBadgeSnapshotEmpty(snapshot: BadgeSnapshot): boolean {
  return snapshot.earnedBadgeIds.length === 0;
}
