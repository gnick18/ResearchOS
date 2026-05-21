// frontend/src/lib/streak/milestone-scheduler.ts
//
// Phase S6 of the Streak-and-Milestones arc (see
// STREAK_AND_MILESTONES_PROPOSAL.md §4.4 / §4.5 / §7.2). Pure
// evaluator + persistence helpers for milestone celebrations.
//
// What lives here:
//  - evaluatePendingCelebrations(username): reads the streak sidecar +
//    user metadata, returns the list of celebrations the user has
//    earned but never seen. Priority order is account anniversaries
//    first, then streak milestones.
//  - markCelebrationSeen(username, celebration): appends a single tag
//    to the right celebrations_seen list on the sidecar.
//
// What does NOT live here:
//  - The CelebrationManager React component (S6: components layer)
//  - The random scene pool (S6: components layer; pool composition
//    has React-specific shape, so it lives next to the component)
//  - The streak tick (S1) and milestone-event subscription
//    (streak-activity-tracker.onStreakMilestoneCrossed)
//
// Design notes:
//  - The streak sidecar is the single source of truth for which
//    celebrations have fired. Both account anniversaries and streak
//    milestones live under `celebrations_seen.*` so the read-side
//    evaluator and the write-side mark function only touch one file.
//  - Account anniversaries are date-anchored (computed from
//    user_metadata.created_at) and never reset; the seen set is
//    additive. The proposal §7.2 explicitly excludes them from the
//    "Reset celebrations seen" affordance for that reason.
//  - Streak milestones are action-anchored (current_count crossing a
//    threshold). The seen set is also additive, but S3 will expose a
//    "Reset celebrations seen" affordance that clears the
//    streak-milestones list (NOT the anniversaries list).
//  - No write to celebrations_seen happens here unless the caller
//    explicitly invokes markCelebrationSeen. The evaluator is pure
//    read.

import { getUserMetadata } from "@/lib/file-system/user-metadata";
import {
  ACCOUNT_ANNIVERSARY_THRESHOLDS,
  STREAK_MILESTONE_THRESHOLDS,
  computeReachedAnniversaries,
  patchStreak,
  readStreak,
} from "./streak-sidecar";

/**
 * A single pending celebration the CelebrationManager will render.
 * `kind` discriminates which seen-list the tag belongs to (used by
 * markCelebrationSeen) and which threshold table it came from. `tag`
 * is the canonical short id (e.g. "1w", "7d") that doubles as the
 * sidecar seen-set entry. `count` is populated for streak milestones
 * so consumers can show "7-day streak!" copy without re-resolving
 * the threshold table; absent for account anniversaries.
 */
export interface PendingCelebration {
  kind: "account_anniversary" | "streak_milestone";
  tag: string;
  count?: number;
}

/**
 * Evaluate which celebrations are pending for the user. Reads:
 *  - user_metadata.created_at  → account anniversaries reached
 *  - streak sidecar current_count → streak milestones reached
 *  - streak sidecar celebrations_seen.* → filter out already-fired tags
 *
 * Returns the pending list in priority order (account anniversaries
 * first, then streak milestones). Within each group, thresholds appear
 * in their natural ascending order (1w before 1mo, 3d before 7d). The
 * CelebrationManager only fires the first entry per session, so the
 * caller does not need to dedupe across kinds.
 *
 * Returns [] when:
 *  - the user has no streak sidecar AND no user metadata (brand new)
 *  - the user has crossed thresholds but every tag is already in the
 *    appropriate seen list
 *  - the user metadata is missing created_at (no anniversary anchor),
 *    AND current_count is zero (no streak crossings either)
 *
 * Failures (sidecar read error, metadata read error) propagate to the
 * caller so the CelebrationManager can decide whether to log + retry
 * vs swallow. We don't catch here because a silent [] would hide a
 * real I/O bug from a debugging session.
 */
export async function evaluatePendingCelebrations(
  username: string,
): Promise<PendingCelebration[]> {
  if (typeof username !== "string" || username.length === 0) return [];

  const sidecar = await readStreak(username);
  const seenAnniversaries = new Set(
    sidecar.celebrations_seen.account_anniversaries,
  );
  const seenStreakMilestones = new Set(
    sidecar.celebrations_seen.streak_milestones,
  );

  const pending: PendingCelebration[] = [];

  // Account anniversaries first (priority order per §4.4). The user is
  // more likely to remember "I've been here a year" than "I've shown
  // up for 7 days in a row", so we let the year anchor land first when
  // both happen to be eligible the same session.
  const meta = await getUserMetadata(username);
  const createdAt =
    meta && typeof meta.created_at === "string" ? meta.created_at : null;
  if (createdAt) {
    const reached = computeReachedAnniversaries(createdAt);
    for (const tag of reached) {
      if (!seenAnniversaries.has(tag)) {
        pending.push({ kind: "account_anniversary", tag });
      }
    }
  }

  // Streak milestones second. Walk the threshold table in ascending
  // order so a brand-new 7-day streaker sees the 3d crossing before
  // the 7d crossing if both happen to be unseen. In practice S1 fires
  // the lower threshold first via the per-tick milestone event; this
  // evaluator is the fallback for the next-app-load case where the
  // user crossed multiple thresholds offline.
  const currentCount = sidecar.current_count;
  for (const { tag, count } of STREAK_MILESTONE_THRESHOLDS) {
    if (currentCount >= count && !seenStreakMilestones.has(tag)) {
      pending.push({ kind: "streak_milestone", tag, count });
    }
  }

  return pending;
}

/**
 * Mark a celebration as seen by appending its tag to the correct
 * seen-list in celebrations_seen. Goes through patchStreak so the
 * write serializes with any concurrent streak tick (S1) or
 * initializeStreakForUser (S0) on the same user.
 *
 * Idempotent: if the tag is already in the list, the write is a no-op
 * (the patchStreak normalizer would store it twice otherwise; we
 * dedupe via Set construction here).
 *
 * Throws if patchStreak's underlying write fails. The caller (the
 * CelebrationManager onComplete handler) is expected to log + still
 * advance the queue so a transient write failure doesn't pin the user
 * on the same scene for the rest of the session.
 */
export async function markCelebrationSeen(
  username: string,
  celebration: PendingCelebration,
): Promise<void> {
  if (typeof username !== "string" || username.length === 0) return;
  if (
    !celebration ||
    typeof celebration.tag !== "string" ||
    celebration.tag.length === 0
  ) {
    return;
  }

  await patchStreak(username, (cur) => {
    if (celebration.kind === "account_anniversary") {
      const list = new Set(cur.celebrations_seen.account_anniversaries);
      list.add(celebration.tag);
      return {
        ...cur,
        celebrations_seen: {
          ...cur.celebrations_seen,
          account_anniversaries: Array.from(list).sort(),
        },
      };
    }
    // streak_milestone
    const list = new Set(cur.celebrations_seen.streak_milestones);
    list.add(celebration.tag);
    return {
      ...cur,
      celebrations_seen: {
        ...cur.celebrations_seen,
        streak_milestones: Array.from(list).sort(),
      },
    };
  });
}

// Re-export the threshold tables so consumers (mostly tests + the
// CelebrationManager debug surface) can resolve a tag back to its
// duration / count without re-importing from streak-sidecar.
export { ACCOUNT_ANNIVERSARY_THRESHOLDS, STREAK_MILESTONE_THRESHOLDS };
