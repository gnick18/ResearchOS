// Check-ins Phase 3 (checkins-phase3 bot, 2026-06-12). The per-section sharing
// read gate for an IDP. See docs/proposals/checkins-revamp.md "Privacy and
// compliance".
//
// The privacy model real IDPs use:
//   - The TRAINEE (owner) sees everything, always.
//   - A viewer in `shared_with` (the mentor) sees ONLY the sections the trainee
//     has shared (`shared_sections[key] === true`). Any unshared section is
//     blanked to its empty shape so the mentor never reads withheld content.
//   - The values reflection is ALWAYS stripped to null for ANY non-owner. It is
//     trainee-private by design (the power-asymmetry reason the mood traffic
//     lights were cut).
//   - Anyone NOT the owner and NOT in `shared_with` fails `canRead` entirely and
//     gets null. (The lab head's compliance view uses a SEPARATE status-only
//     path, `idpsApi.getStatusForMember`, that never loads contents.)
//
// This is applied on EVERY non-owner read path so a withheld section can never
// leak. The function is pure (no I/O), so the gate is unit-testable in
// isolation.

import { canRead, type Viewer } from "../sharing/unified";
import type { IDP, IdpSectionKey } from "../types";

/** The empty value a blanked section is replaced with. Mirrors a fresh IDP's
 *  empty shape so a mentor reading an unshared section sees nothing, not stale
 *  content. */
const EMPTY_SECTION: {
  self_assessment: IDP["self_assessment"];
  career_exploration: IDP["career_exploration"];
  goals: IDP["goals"];
  action_plan: IDP["action_plan"];
} = {
  self_assessment: { ratings: {}, responsibilities: "" },
  career_exploration: { aspirations: "", target_path: "" },
  goals: [],
  action_plan: [],
};

/**
 * Normalize an IDP for a given viewer, enforcing per-section sharing and the
 * always-private values reflection.
 *
 *   - Owner -> the IDP unchanged.
 *   - A reader who passes `canRead` (in `shared_with`) -> a COPY where every
 *     unshared section is blanked AND `values_reflection` is null.
 *   - Anyone else -> null (cannot read it at all).
 *
 * Returns null rather than throwing so callers fold a denied read into a
 * "no IDP visible" result.
 */
export function normalizeIdpForViewer(idp: IDP, viewer: Viewer): IDP | null {
  // Owner sees everything. (Owner check first so an owner whose own record
  // somehow lacks a self-share still reads it.)
  if (idp.owner === viewer.username) {
    return idp;
  }

  // A non-owner must pass canRead (be in shared_with). NOTE: canRead grants a
  // lab head implicit view-all, but the IDP compliance rule says a PI sees only
  // a status line, never contents. So we DO NOT lean on the lab-head branch
  // here: a lab head who is not an explicit share-recipient is denied content.
  const isExplicitRecipient = idp.shared_with.some(
    (s) => s.username === viewer.username,
  );
  if (!isExplicitRecipient) {
    return null;
  }
  // Defense in depth: still run canRead so the owner / "*" semantics stay
  // consistent with the rest of the app.
  if (!canRead(idp, { ...viewer, account_type: "lab" })) {
    return null;
  }

  // Build a section-filtered copy. Any section not explicitly shared is blanked;
  // the values reflection is always stripped.
  const shared = idp.shared_sections;
  const sectionShared = (key: IdpSectionKey): boolean => shared[key] === true;

  return {
    ...idp,
    self_assessment: sectionShared("self_assessment")
      ? idp.self_assessment
      : EMPTY_SECTION.self_assessment,
    career_exploration: sectionShared("career_exploration")
      ? idp.career_exploration
      : EMPTY_SECTION.career_exploration,
    goals: sectionShared("goals") ? idp.goals : EMPTY_SECTION.goals,
    action_plan: sectionShared("action_plan")
      ? idp.action_plan
      : EMPTY_SECTION.action_plan,
    // ALWAYS trainee-private. Never returned to a non-owner.
    values_reflection: null,
  };
}
