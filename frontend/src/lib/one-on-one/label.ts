// Check-ins revamp Phase 1 (checkins-revamp bot, 2026-06-11). See
// docs/proposals/checkins-revamp.md (decisions D6 + naming).
//
// The tab is "Check-ins" for EVERYONE (the role-flipped "Mentoring" label is
// retired, D6). A space is labeled by its people, framed by who is looking. For
// a pair space we name the OTHER member; the relationship direction (you mentor
// them / they mentor you / peers) is available as a soft hint derived from the
// `mentor` edge, shown inside the space rather than baked into the tab name.
//
// These are PURE helpers (no I/O), generalized over the normalized member array
// so they never crash on a missing legacy `labHead`.

import type { OneOnOne } from "../types";
import { normalizeOneOnOne, otherMember } from "./normalize";

type ViewerAccountType = "solo" | "lab" | "lab_head";

/** A soft, role-relative relationship hint for a pair space. */
export type RelationshipHint =
  | "you-mentor-them"
  | "they-mentor-you"
  | "peer"
  | "group";

/**
 * The per-space entry label, derived from who is looking.
 * - Pair space: the OTHER member's name (or the space `title` if set).
 * - Group space: the `title` if set, else a "N people" summary.
 *
 * Generalized over `members`, so it never reads the legacy `labHead`/`member`
 * directly and never crashes when those are absent.
 */
export function oneOnOneLabel(viewer: string, oneOnOne: OneOnOne): string {
  const normalized = normalizeOneOnOne(oneOnOne);
  if (normalized.title) return normalized.title;

  if (normalized.kind === "group") {
    const others = normalized.members.filter((m) => m !== viewer);
    return others.length > 0
      ? `${others.slice(0, 2).join(", ")}${others.length > 2 ? ` +${others.length - 2}` : ""}`
      : "Group check-in";
  }

  return otherMember(normalized, viewer) ?? "Check-in";
}

/**
 * A soft, role-relative relationship hint for the open space, derived from the
 * `mentor` edge. Display-only ("you mentor Mira here" style cues).
 */
export function relationshipHint(
  viewer: string,
  oneOnOne: OneOnOne,
): RelationshipHint {
  const normalized = normalizeOneOnOne(oneOnOne);
  if (normalized.kind === "group") return "group";
  if (!normalized.mentor) return "peer";
  if (normalized.mentor === viewer) return "you-mentor-them";
  return "they-mentor-you";
}

/**
 * The Workbench tab label. "Check-ins" for EVERYONE (D6); the role-flipped
 * "Mentoring" label is retired. The account-type argument is kept so callers do
 * not have to change, but it no longer affects the result.
 */
export function oneOnOneTabLabel(_viewerAccountType: ViewerAccountType): string {
  return "Check-ins";
}
