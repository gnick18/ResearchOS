// Check-ins Phase 3b (checkins-phase3b bot, 2026-06-12). The seed rows for a new
// mentoring compact and the seed items for a new onboarding checklist. Drawn in
// intent from the proposal ("Part 3, the academic layer"), the AAMC mentoring
// compact topics, and the UW research-data onboarding checklist, matched to the
// approved mockup's example rows.
//
// Pure data. The api seeds these on `createForSpace` (each gets a fresh UUID at
// create time so ids stay globally unique).

/** The topics a fresh expectations compact starts with, each with an empty
 *  value the members fill in together. Mirrors the mockup's example rows
 *  (working hours, authorship, communication, vacation) and rounds it out with
 *  the meeting cadence and data-management practices from the proposal. */
export const COMPACT_SEED_LABELS: readonly string[] = [
  "Working hours and availability",
  "Authorship and credit norms",
  "Communication cadence and channels",
  "Vacation and time off",
  "Meeting cadence",
  "Data-management practices",
];

/** The items a fresh onboarding checklist starts with. Mirrors the mockup's
 *  checklist (access and keys, safety training, data-management, the lab norms
 *  doc, set the cadence). */
export const ONBOARDING_SEED_LABELS: readonly string[] = [
  "Access and keys (building, lab, shared drives)",
  "Required safety training booked",
  "Data-management practices walkthrough",
  "Read the lab norms / compact doc",
  "Set the check-in cadence",
];
