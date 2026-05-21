/**
 * §6.3 Notifications, beat 2 of 3: silence the row.
 *
 * Mounts after the user has opened the inbox (bell-popup-opened DOM
 * event). The spotlight lands on the row-level "Mark as read" button
 * (closest analog v4 has to "silence" — clicking it mutes the unread
 * bell badge counter without removing the row, so the user gets a clean
 * read on what muting does before the next beat dismisses the row
 * entirely). The user clicks; the popup's `handleMarkRead` dispatches
 * `tour:notification-silenced` and the tour advances.
 *
 * Per Grant's cursor responsibility rule, no cursor script: the user
 * exercises the affordance themselves.
 *
 * Affordance audit note: v4's notification UI does not have a
 * dedicated "silence source" / "mute" button. The "Mark as read" button
 * is the practical equivalent for the bell badge use case Grant
 * described (he said "silence the notification"; muting the unread
 * counter is what a user expects that phrase to do here). If a
 * dedicated mute affordance lands later, this step's spotlight target
 * + the `notification-silence` tour target swap to it without other
 * surgery.
 */
import { advanceOnEvent, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchNotificationSilenced } from "./lib/tour-events";

export const notificationsSilenceStep = buildWalkthroughStep({
  id: "notifications-silence",
  speech:
    "Nice. To silence the bell badge, click either the row or the Mark all button on top. This will make the bell stop bugging you.",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.notificationSilence),
  // No cursorScript: user-action step. The user clicks either the
  // primary spotlight (row Mark-read) OR the soft-pulsing secondary
  // (header Mark-all-read). Both buttons fire
  // `tour:notification-silenced` (see NotificationPopup.tsx) so the
  // step advances on whichever the user picks.
  completion: advanceOnEvent(watchNotificationSilenced),
});
