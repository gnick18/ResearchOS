"use client";

import { manualAdvance } from "./lib/step-helpers";
import type { TourStep } from "../../step-types";

/**
 * §6.15 Calendar (conditional Q3 = yes).
 *
 * High-level explanation only per the proposal: no real ICS subscribe
 * (would require URLs the user doesn't have ready). BeakerBot points
 * at the Calendar tab and explains what it does. Manual-advance per
 * the Wave 1 universal-pacing rule (R2 chip C 2026-05-22 fix).
 *
 * **Speech copy (from §6.15, no em-dashes):**
 *
 *   "Calendar tab's optional. You can add events directly, or link
 *    external calendars (Outlook, Apple, Google iCloud) in read-only
 *    mode. ResearchOS shows your external events alongside your
 *    experiments and tasks. When you want, set it up in Settings."
 *
 * No artifact created. The cleanup grid skips this step entirely.
 *
 * **Navigation:** ideally the cursor primitive navigates to /calendar
 * to show the month view. The TourController doesn't expose the
 * Next.js router yet (deferred to P7-P11), so for now the step just
 * spotlights the Calendar tab marker via `targetSelector`. The
 * spotlight silently no-ops when the user is elsewhere; the speech
 * still fires either way.
 *
 * Classification (per Grant's design correction 2026-05-21):
 * BEAKERBOT NARRATION (no cursor action at all). The step is a pure
 * explainer with no cursorScript wired in: BeakerBot describes the
 * Calendar tab capability while the spotlight points to the nav. No
 * click/type/drag to strip. When future navigation wiring lands, the
 * cursor click on the Calendar tab would qualify as a navigation
 * beat per the rule (BeakerBot's speech narrates the move).
 *
 * R2 chip C 2026-05-22 pacing fix: dropped the inline
 * CalendarExplainerBody auto-advance (was 7.5s). The Wave 1 universal
 * manual-advance rule applies to every BeakerBot-led step in the
 * walkthrough; literal readers who needed more than 7.5s to read the
 * speech had no way to pace themselves. The other conditional
 * walkthrough steps (purchases, telegram, etc.) already use
 * manualAdvance per Wave 1.
 */

// ---------------------------------------------------------------------------
// Step body export
// ---------------------------------------------------------------------------

/**
 * §6.15 conditional walkthrough step. Pure explainer, no API calls,
 * no artifacts. Manual-advance per Wave 1 universal-pacing rule.
 *
 * Conditional gate (calendar === "yes") is enforced by
 * `step-machine.ts isStepGatedOut`. `conditionalOn` mirrors it for
 * self-description.
 */
export const calendarConditionalStep: TourStep = {
  id: "calendar",
  pose: "pointing",
  speech: (
    <div className="space-y-2" data-testid="calendar-explainer-body">
      <p>
        Calendar tab&apos;s optional. You can add events directly, or
        link external calendars (Outlook, Apple, Google iCloud) in
        read-only mode. ResearchOS shows your external events alongside
        your experiments and tasks. When you want, set it up in
        Settings.
      </p>
    </div>
  ),
  completion: manualAdvance("Got it, next"),
  // Calendar tab marker. Same data-tour-target shape as the other
  // sidebar steps so TourSpotlight resolves it via the standard
  // selector path.
  targetSelector: "[data-tour-target='calendar-tab']",
  conditionalOn: (picks) => picks?.calendar === "yes",
  // Auto-navigate to /calendar on refresh so the month view is visible.
  expectedRoute: "/calendar",
};
