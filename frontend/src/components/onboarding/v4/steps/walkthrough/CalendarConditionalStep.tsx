"use client";

import { useEffect, useRef } from "react";
import { useTourController } from "../../TourController";
import type { TourStep } from "../../step-types";

/**
 * §6.15 Calendar (conditional Q3 = yes).
 *
 * High-level explanation only per the proposal: no real ICS subscribe
 * (would require URLs the user doesn't have ready). BeakerBot points
 * at the Calendar tab and explains what it does. Auto-advances after
 * the speech has had time to land.
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
 */

const READ_DURATION_MS = 7500;

/**
 * Inner speech-bubble body. Schedules an auto-advance after the read
 * duration. The duration is generous (7.5s) because the speech is
 * long enough that reduced-motion users want time to actually read.
 */
function CalendarExplainerBody() {
  const { advance, noteEventFired } = useTourController();
  const startedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    timerRef.current = setTimeout(() => {
      noteEventFired();
      advance();
    }, READ_DURATION_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [advance, noteEventFired]);

  return (
    <div className="space-y-2" data-testid="calendar-explainer-body">
      <p>
        Calendar tab&apos;s optional. You can add events directly, or
        link external calendars (Outlook, Apple, Google iCloud) in
        read-only mode. ResearchOS shows your external events alongside
        your experiments and tasks. When you want, set it up in
        Settings.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step body export
// ---------------------------------------------------------------------------

/**
 * §6.15 conditional walkthrough step. Pure explainer, no API calls,
 * no artifacts. Auto-advances after the read duration so the spotlight
 * doesn't dwell on the Calendar tab past where the speech ends.
 *
 * Conditional gate (calendar === "yes") is enforced by
 * `step-machine.ts isStepGatedOut`. `conditionalOn` mirrors it for
 * self-description.
 */
export const calendarConditionalStep: TourStep = {
  id: "calendar",
  pose: "pointing",
  speech: () => <CalendarExplainerBody />,
  // Event-driven completion so the bubble doesn't render a "Got it,
  // next" button while the inner component is still narrating.
  completion: {
    type: "event",
    eventListener: () => () => {},
  },
  // Calendar tab marker. Same data-tour-target shape as the other
  // sidebar steps so TourSpotlight resolves it via the standard
  // selector path.
  targetSelector: "[data-tour-target='calendar-tab']",
  conditionalOn: (picks) => picks?.calendar === "yes",
  // Auto-navigate to /calendar on refresh so the month view is visible.
  expectedRoute: "/calendar",
};

// Export the read duration for tests + future tuning chips.
export { READ_DURATION_MS };
