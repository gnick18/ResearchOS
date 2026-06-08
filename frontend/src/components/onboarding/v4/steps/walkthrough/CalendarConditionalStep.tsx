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
 * BeakerBot explains what the Calendar tab does and how to link a feed.
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
 * walkthrough steps (purchases, links, etc.) already use
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
        The <strong>Calendar</strong> tab overlays your meetings, classes,
        and appointments alongside your lab work. Link as many feeds as you
        want from Outlook, Apple, or Google.
      </p>
      <p>
        Events show up on the Calendar page and in the quick-view bar on
        the left, kept separate from your experiments and tasks.
      </p>
      <p>
        To add one, click <strong>Linked Calendars</strong> up here and
        paste in a feed URL.
      </p>
    </div>
  ),
  completion: manualAdvance("Got it, next"),
  // Hand-walk edit 2026-05-27: spotlight now points at the Linked
  // Calendars button so the new third paragraph has a visual anchor.
  // The Calendar tab marker (`calendar-tab`) is already what brought
  // the user here via expectedRoute; pointing the spotlight at the
  // Linked Calendars button matches the speech's "click this button
  // later" instruction.
  targetSelector: "[data-tour-target='calendar-linked-feeds-button']",
  conditionalOn: (picks) => picks?.calendar === "yes",
  // Auto-navigate to /calendar on refresh so the month view is visible.
  expectedRoute: "/calendar",
};
