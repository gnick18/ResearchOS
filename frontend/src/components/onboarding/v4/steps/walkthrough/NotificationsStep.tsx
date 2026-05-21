/**
 * §6.3 Notifications (universal UI moment), universal walkthrough.
 *
 * Fires right after the Project Overview prose demo. Teaches the
 * notification bell as a universal element before drilling into
 * specific tabs.
 *
 * Cursor glides to the bell icon (top-nav area) and clicks it. A test
 * notification is emitted programmatically in `onEnter` so the badge
 * shows. The panel opens, the cursor points at the test notification
 * and the dismiss affordance.
 *
 * Per §6.3: completion is manual ("Got it" button, no specific user
 * action required). The "Got it" button is a passive advance affordance,
 * NOT the trigger for the notification fire. The notification fires the
 * moment the step becomes active so the badge update reads as a side
 * effect of arriving on this step, not a side effect of a button click.
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
import { cursorScript, safeClickAction, compactScript } from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

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
 * Best-effort: a notifications-storage failure (e.g., tests without a
 * mocked local-api) is logged + swallowed so the rest of the tour
 * keeps running. The cursor still demos the bell click; only the
 * badge-pre-fill demo degrades.
 */
export async function fireNotificationsStepTestNotification(): Promise<void> {
  try {
    const now = new Date();
    const eventStart = new Date(now.getTime() + 15 * 60 * 1000);
    await sharingApi.createEventReminder({
      event_id: `onboarding-v4-test-${Date.now()}`,
      event_kind: "native",
      event_title: NOTIFICATIONS_STEP_TEST_TITLE,
      event_start_iso: eventStart.toISOString(),
      event_date: toLocalDateString(eventStart),
      event_location: NOTIFICATIONS_STEP_TEST_BODY,
      offset_minutes: 15,
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ros-notifications-changed"));
    }
  } catch (err) {
    console.warn("[onboarding-v4] §6.3 test notification failed", err);
  }
}

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
  onEnter: async () => {
    await fireNotificationsStepTestNotification();
  },
});
