/**
 * §6.3 Notifications phase intro (Wave 1 skeleton, 2026-05-27).
 *
 * NEW step introduced by Grant's 2026-05-27 tour script rewrite. Sits
 * immediately before `notifications-bell`. Pure narration that frames
 * the top-bar bell + inbox pair before BeakerBot fires a test
 * notification and prompts the user to click the bell.
 *
 * Wave 1 ships the skeleton (correct id + voice + manual completion +
 * expectedRoute). Wave 2 will fill in the real speech.
 *
 * Voice classification per the new script: NARRATION
 * Spotlight: none (framing-only beat; no rect needed)
 * Completion: manual ("Got it, next")
 * ExpectedRoute: "/"
 *
 * v4 tour structural manager
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

export const notificationsIntroStep = buildWalkthroughStep({
  id: "notifications-intro",
  speech: "TODO(wave2): notifications-intro",
  pose: "pointing",
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/",
});
