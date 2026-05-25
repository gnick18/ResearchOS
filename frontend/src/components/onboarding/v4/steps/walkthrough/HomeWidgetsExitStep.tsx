/**
 * §6.2b Home widgets walkthrough — STEP 5: exit beat.
 *
 * Fifth and final §6.2b sub-step. Wraps up the home canvas teaching
 * and telegraphs the next section (§6.3 notifications) by gliding the
 * cursor toward the notifications bell in the top nav. Manual advance
 * hands off to `notifications-bell` (§6.3a), which then fires the
 * test notification onEnter.
 *
 * Cursor + spotlight:
 *   - spotlight on the notifications bell (`notifications-bell` target,
 *     the same anchor §6.3a will spotlight). Pulling the spotlight
 *     toward the next surface gives the user a visual hint about
 *     what's coming without firing the notification yet (§6.3a's
 *     onEnter handles the spawn).
 *   - cursor glides from wherever it last sat (over the canvas reorder
 *     handle) up to the bell area, telegraphing §6.3.
 *
 * Classification: BEAKERBOT DEMO + transition beat. Speech says "I'll
 * move us over to the bell next", an explicit BeakerBot-led promise;
 * the cursor glides as advertised. No click — the bell click belongs
 * to §6.3a (the user clicks it themselves after the test notification
 * fires).
 *
 * No expectedRoute change: the user stays on `/`. §6.3 fires from the
 * same home surface; the next route push is much later in the tour.
 *
 * Voice match: §6.2 wrap-up cadence. The "up next, notifications"
 * cap echoes the §6.2-exit handoff style without promising specific
 * mechanics (the user finds out what notifications do in §6.3).
 */
import {
  compactScript,
  cursorScript,
  safeGlideToElementAction,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const homeWidgetsExitStep = buildWalkthroughStep({
  id: "home-widgets-exit",
  speech:
    "That's the canvas. You can come back any time, swap widgets in and out, and rearrange the order. Up next, notifications.",
  pose: "pointing",
  // Spotlight + cursor target both anchor on the bell so the user's eye
  // is drawn toward §6.3's surface before the bell click owns it.
  targetSelector: targetSelector(TOUR_TARGETS.notificationsBell),
  cursorScript: cursorScript(async () => {
    // Glide-only (no click): the bell click belongs to §6.3a after the
    // test notification fires. This beat is purely the visual handoff.
    const glide = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.notificationsBell),
      3000,
    );
    return compactScript([glide]);
  }),
  // Manual advance per universal pacing (Grant 2026-05-22). The user
  // reads the wrap-up sentence, then clicks Got it, next to hand off
  // to §6.3a (notifications-bell) which fires the test notification
  // via its onEnter hook.
  completion: manualAdvance("Got it, next"),
  expectedRoute: "/",
});
