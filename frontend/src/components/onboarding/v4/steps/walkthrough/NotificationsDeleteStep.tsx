/**
 * §6.3 Notifications, beat 3 of 3: delete the row.
 *
 * Mounts after the silence sub-step. The spotlight lands on the row-
 * level "Dismiss" (X) button. The user clicks; the popup's
 * `handleDismiss` dispatches `tour:notification-deleted` and the tour
 * advances to §6.4 (methods-category).
 *
 * Per Grant's cursor responsibility rule, no cursor script: the user
 * exercises the affordance themselves.
 */
import { advanceOnEvent, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchNotificationDeleted } from "./lib/tour-events";

export const notificationsDeleteStep = buildWalkthroughStep({
  id: "notifications-delete",
  speech:
    "If you want to clear it from your inbox entirely, just click the X.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.notificationDelete),
  // No cursorScript: user-action step. The user clicks the spotlighted
  // dismiss affordance themselves.
  completion: advanceOnEvent(watchNotificationDeleted),
});
