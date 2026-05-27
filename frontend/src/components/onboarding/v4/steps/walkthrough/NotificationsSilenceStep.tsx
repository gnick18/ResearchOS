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
    'To clear the notification badge without deleting the message, click either the row itself or the "Mark read" button. Try it now.',
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.notificationSilence),
  // No cursorScript: user-action step. The user clicks either the
  // primary spotlight (row Mark-read) OR the soft-pulsing secondary
  // (header Mark-all-read). Both buttons fire
  // `tour:notification-silenced` (see NotificationPopup.tsx) so the
  // step advances on whichever the user picks.
  completion: advanceOnEvent(watchNotificationSilenced),
  // R2 chip B Fix 2/3: Esc-on-popup recovery. When the user presses
  // Escape or clicks outside the NotificationPopup mid-step, the popup
  // closes and the row-level Mark-as-read button detaches from the
  // DOM. Wave 2 Fix 2's target-detach watcher fires and swaps the
  // speech bubble to "Looks like that closed. Click {buttonLabel} to
  // re-open and try again." Pointing the user at the bell icon
  // re-opens the popup; the watcher then auto-restores the original
  // speech once the row Mark-read button is back on screen.
  recoveryHint: {
    buttonLabel: "the bell icon",
  },
});
