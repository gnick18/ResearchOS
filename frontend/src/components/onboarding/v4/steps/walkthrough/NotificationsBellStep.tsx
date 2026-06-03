/**
 * §6.3 Notifications: bell click.
 *
 * Fires a programmatic test notification on step entry so the badge lights
 * up, then asks the user to click the spotlighted bell to open their
 * inbox.
 *
 * 2026-06-03 (HR / tour-simplification): the two follow-up field-walk
 * beats (notifications-silence mark-as-read, notifications-delete dismiss)
 * were cut. Their awareness, that a row can be marked read to clear the
 * badge or dismissed with the X, folded into this beat's speech. The beat
 * still gates on the user actually opening the inbox (popup-opened DOM
 * event), so it stands on its own; it never depended on an artifact the
 * cut beats produced.
 *
 * Per Grant's 2026-05-21 cursor responsibility audit, this is a USER-
 * ACTION step: BeakerBot fires the notification, but opening the inbox
 * belongs to the user. The spotlight + speech direct the eye; no
 * cursor script.
 *
 * The single big-button "Got it" affordance from the original §6.3 step
 * is gone (Grant's 2026-05-21 design feedback). Completion is now
 * event-driven on the popup-opened DOM event so the next beat only
 * mounts after the user has actually opened the inbox.
 *
 * Why we re-use `sharingApi.createEventReminder` (vs minting a bespoke
 * "test" notification type): the existing notification union is closed
 * (event_reminder / task_shared / shift_alert) and the inbox renderer
 * + bell badge poll consume that exact shape. Re-using the event
 * reminder path lights up the same end-to-end pipeline DevTestNotificationButton
 * exercises, so the demo notification looks identical to a real one.
 * Phase 4 cleanup catches this artifact via the standard notifications
 * sweep (no new sidecar surface required).
 */
import { sharingApi } from "@/lib/local-api";
import { advanceOnEvent, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchNotificationsPopupOpened } from "./lib/tour-events";

/** Title shown in the inbox row for the §6.3 demo notification. */
export const NOTIFICATIONS_STEP_TEST_TITLE = "Welcome to ResearchOS";

/** Body copy shown in the inbox row + OS popup for the §6.3 demo notification. */
export const NOTIFICATIONS_STEP_TEST_BODY =
  "This is a test notification from BeakerBot. Click the bell icon to see your inbox.";

function toLocalDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Fire the §6.3 demo notification. Extracted so the step's `onEnter`
 * stays compact + the unit test can drive the same code path that the
 * controller invokes on step entry.
 *
 * Idempotent: if a notification with the §6.3 demo title is already in
 * the user's inbox (eg. they completed §6.3 once and re-entered the
 * tour via Settings re-run), this re-flips that row to unread instead
 * of spawning a duplicate. Grant's screenshot showed 4 stacked welcome
 * notifications after multiple tour entries; this collapses them to 1
 * row whose unread state re-lights on every re-entry.
 *
 * Best-effort: a notifications-storage failure (e.g., tests without a
 * mocked local-api) is logged + swallowed so the rest of the tour
 * keeps running. The user can still try the bell; only the badge-
 * pre-fill demo degrades.
 */
export async function fireNotificationsStepTestNotification(): Promise<void> {
  try {
    // Nuke + recreate (Grant 2026-05-22): the prior "find one and mark
    // unread" path only re-lit the first match, leaving leftover
    // duplicates from before this idempotency check shipped. Now we
    // dismiss EVERY existing "Welcome to ResearchOS" row first, then
    // mint a single fresh one. Guarantees exactly one such notification
    // exists in the inbox no matter how many tour re-entries the user
    // has done before this fix landed.
    const existing = await sharingApi.getNotifications();
    const duplicates = existing.notifications.filter(
      (n) =>
        n.type === "event_reminder" &&
        n.event_title === NOTIFICATIONS_STEP_TEST_TITLE,
    );
    for (const dup of duplicates) {
      await sharingApi.dismissNotification(dup.id);
    }
    const now = new Date();
    // Copy-alignment manager 2026-05-26: WelcomeStep promises "about ten
    // minutes" for the setup walk. The §6.3 demo notification used to
    // render "Welcome to ResearchOS in 15 min" because offset_minutes
    // was 15. Both surfaces now read ten, so the user doesn't see two
    // different time-to-completion numbers on day one.
    const eventStart = new Date(now.getTime() + 10 * 60 * 1000);
    await sharingApi.createEventReminder({
      event_id: `onboarding-v4-test-${Date.now()}`,
      event_kind: "native",
      event_title: NOTIFICATIONS_STEP_TEST_TITLE,
      event_start_iso: eventStart.toISOString(),
      event_date: toLocalDateString(eventStart),
      event_location: NOTIFICATIONS_STEP_TEST_BODY,
      offset_minutes: 10,
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ros-notifications-changed"));
    }
  } catch (err) {
    console.warn("[onboarding-v4] §6.3 test notification failed", err);
  }
}

export const notificationsBellStep = buildWalkthroughStep({
  id: "notifications-bell",
  speech:
    "I just fired a test notification so you can see how the bell works. Click it to open your inbox. Each row can be marked read to clear the badge, or dismissed with the X.",
  pose: "pointing-up",
  targetSelector: targetSelector(TOUR_TARGETS.notificationsBell),
  // No cursorScript: user-action step. The user clicks the spotlighted
  // bell themselves.
  completion: advanceOnEvent(watchNotificationsPopupOpened),
  onEnter: async () => {
    await fireNotificationsStepTestNotification();
  },
});
