/**
 * §6.3 Notifications phase intro (Wave 2A speech wire-up, 2026-05-27).
 *
 * Sits immediately before `notifications-bell`. Pure narration that
 * frames the top-bar bell + inbox pair before BeakerBot fires a test
 * notification and prompts the user to click the bell.
 *
 * Voice classification per Grant's 2026-05-27 script: NARRATION
 * Spotlight: none (framing-only beat; no rect needed)
 * Completion: manual ("Got it, next")
 * ExpectedRoute: "/"
 *
 * v4 tour speech manager — A
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

export const notificationsIntroStep = buildWalkthroughStep({
  id: "notifications-intro",
  speech: (
    <>
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
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/",
});
