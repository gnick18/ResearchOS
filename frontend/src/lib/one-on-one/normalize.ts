// Check-ins revamp Phase 1 (checkins-revamp bot, 2026-06-11). See
// docs/proposals/checkins-revamp.md.
//
// `normalizeOneOnOne` is the single back-compat shim for the generalized
// check-in space. The on-disk shape (`OneOnOne`) carries optional legacy fields
// (`labHead`/`member`) for records written before the revamp and the new
// member-array fields (`members`/`mentor`/`kind`) for records written after.
// Every READ path (get/list/aggregation) runs a record through this so the rest
// of the codebase only ever sees a populated `members`/`mentor`/`kind`.
//
// Pure (no I/O) so it is trivially unit-testable.

import type { OneOnOne, OneOnOneActionItem, WeeklyGoal } from "../types";

/** An `OneOnOne` after normalization: `members`/`mentor`/`kind` are guaranteed
 *  present, so callers never branch on the legacy binary again. */
export type NormalizedOneOnOne = OneOnOne & {
  members: string[];
  mentor: string | null;
  kind: "pair" | "group";
};

/**
 * Return a record whose `members` is always populated, with a derived `mentor`
 * and `kind`.
 *
 * - If `members` is missing (a pre-revamp record), derive
 *   `members = [labHead, member].filter(Boolean)`,
 *   `mentor = labHead ?? null`, `kind = "pair"`.
 * - If `members` is present, keep it, set `kind = members.length > 2
 *   ? "group" : "pair"`, and default `mentor = rec.mentor ?? null`.
 *
 * The legacy `labHead`/`member` fields are preserved as-is so a normalized
 * record still round-trips to disk without losing back-compat data.
 */
export function normalizeOneOnOne(rec: OneOnOne): NormalizedOneOnOne {
  if (rec.members && rec.members.length > 0) {
    const members = rec.members;
    return {
      ...rec,
      members,
      mentor: rec.mentor ?? null,
      kind: members.length > 2 ? "group" : "pair",
    };
  }

  const members = [rec.labHead, rec.member].filter(
    (m): m is string => typeof m === "string" && m.length > 0,
  );
  return {
    ...rec,
    members,
    mentor: rec.labHead ?? null,
    kind: "pair",
  };
}

/**
 * The counterpart of `viewer` in a PAIR space (the "other" member). Returns the
 * first member that is not the viewer, or `undefined` for a group space or a
 * degenerate single-member record. Used for the role-relative label.
 */
export function otherMember(
  normalized: NormalizedOneOnOne,
  viewer: string,
): string | undefined {
  return normalized.members.find((m) => m !== viewer);
}

/**
 * Check-ins revamp Phase 2 (checkins-phase2 bot, 2026-06-12). Back-compat shim
 * at the action-item read boundary, mirroring `normalizeOneOnOne` /
 * `normalizeTaskRecord`. The Phase 2 fields (`assignee`, `due_date`,
 * `synced_task_id`) are optional on disk; a record written before Phase 2 reads
 * with them absent. Default each to null so callers never branch on
 * `undefined`. Pure (no I/O), so it is run on every get/list/aggregation read.
 */
export type NormalizedActionItem = OneOnOneActionItem & {
  assignee: string | null;
  due_date: string | null;
  synced_task_id: number | null;
};

export function normalizeOneOnOneActionItem(
  rec: OneOnOneActionItem,
): NormalizedActionItem {
  return {
    ...rec,
    assignee: rec.assignee ?? null,
    due_date: rec.due_date ?? null,
    synced_task_id: rec.synced_task_id ?? null,
  };
}

/**
 * Check-ins revamp Phase 2: default the new optional `assignee` on a weekly
 * goal to null on read so the group goal board never sees `undefined`. Pure.
 */
export type NormalizedWeeklyGoal = WeeklyGoal & { assignee: string | null };

export function normalizeWeeklyGoal(rec: WeeklyGoal): NormalizedWeeklyGoal {
  return { ...rec, assignee: rec.assignee ?? null };
}
