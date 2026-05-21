/**
 * §6.3 Notifications (universal UI moment) — universal walkthrough.
 *
 * Fires right after the Project Overview prose demo. Teaches the
 * notification bell as a universal element before drilling into
 * specific tabs.
 *
 * Cursor glides to the bell icon (top-nav area) and clicks it. A test
 * notification was emitted programmatically in `onEnter` so the badge
 * shows. The panel opens, the cursor points at the test notification
 * and the dismiss affordance.
 *
 * Per §6.3: completion is manual ("Got it" button, no specific user
 * action required). No artifact (test notification is transient).
 *
 * The actual notification spawn happens via `onEnter`. P5 keeps the
 * spawn minimal — a no-op when the notifications surface isn't wired
 * to the v4 tour controller yet (production users on this code path
 * may not see a synthetic notification, but the cursor demo still
 * makes the moment clear).
 */
import { cursorScript, safeClickAction, compactScript } from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const notificationsStep = buildWalkthroughStep({
  id: "notifications",
  speech:
    "Quick universal: notifications. I'm firing a test one now, see the bell badge?",
  pose: "pointing-up",
  targetSelector: targetSelector(TOUR_TARGETS.notificationsBell),
  cursorScript: cursorScript(async () => {
    const bellClick = await safeClickAction(
      targetSelector(TOUR_TARGETS.notificationsBell),
    );
    return compactScript([bellClick]);
  }),
  completion: manualAdvance("Got it"),
});
