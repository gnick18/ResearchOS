/**
 * §6.3 Notifications phase intro (Wave 2A speech wire-up, 2026-05-27).
 *
 * Sits immediately before `notifications-bell`. Narration that frames the
 * top-bar bell + inbox pair before BeakerBot fires a test notification and
 * prompts the user to click the bell.
 *
 * Voice classification per Grant's 2026-05-27 script: NARRATION
 * Spotlight: the notification bell (TOUR_TARGETS.notificationsBell)
 * Completion: manual ("Got it, next")
 * ExpectedRoute: "/workbench"
 *
 * Tour-teardown audit (2026-06-03): expectedRoute was "/", but "/" is now
 * a pure role redirect that the tour-active guard suppresses (see
 * page-landing-redirect.ts), so it parked the user on a blank spinner. The
 * bell + inbox this beat narrates live in the top nav on /workbench, so
 * the route is realigned to /workbench.
 *
 * Tour-merge (2026-06-03): the preceding `project-overview-exit` step was
 * removed. It glided the cursor to this same bell with no click, then this
 * beat re-explained the bell with no cursor, a redundant pair. This step
 * now absorbs both jobs the exit step used to do:
 *   - it carries `expectedRoute: "/workbench"`, so it performs the route
 *     handoff off the project page that the exit step used to drive.
 *   - it opens with a one-line transition lead-in so the jump from the
 *     project page is not abrupt.
 *   - it spotlights the notification bell so the narration has a visible
 *     anchor (the next step, `notifications-bell`, owns the click).
 * No cursor glide is added: directing the eye via the spotlight replaces
 * the pointless cursor that the exit step performed.
 *
 * v4 tour speech manager — A
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const notificationsIntroStep = buildWalkthroughStep({
  id: "notifications-intro",
  speech: (
    <>
      <p className="mb-2">
        Let me show you how notifications keep you in the loop.
      </p>
      <p className="mb-2">
        Two things live in the top bar that you should know about.
      </p>
      <p className="mb-2">
        The <strong>bell</strong> collects everything that needs your
        attention: reminders for upcoming tasks and experiments on your
        Gantt, updates from labmates on anything they shared with you,
        and any mentions or comments on your work.
      </p>
      <p>
        The <strong>inbox</strong> next to it is where files land when
        something is sent to you from outside the app, like photos from
        Telegram or shared attachments.
      </p>
    </>
  ),
  pose: "pointing",
  // Tour-merge (2026-06-03): spotlight the notification bell the narration
  // describes. No bell+inbox pair target exists (the bell and the inbox
  // badge are separate anchors), so we frame the bell; the next step,
  // notifications-bell, spotlights it again for the actual click.
  targetSelector: targetSelector(TOUR_TARGETS.notificationsBell),
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/workbench",
});
