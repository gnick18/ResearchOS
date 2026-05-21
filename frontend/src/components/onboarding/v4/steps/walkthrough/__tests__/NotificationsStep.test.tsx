/**
 * §6.3 NotificationsStep body tests.
 *
 * Verifies the v4 §6.3 fix: the step's `onEnter` fires a programmatic
 * test notification via `sharingApi.createEventReminder` so the bell
 * badge lights up the moment BeakerBot speaks. Without this hook, the
 * speech bubble's "I'm firing a test now" reads as a lie because the
 * step had no surface to actually trigger one.
 *
 * Mocks the local-api surface so the test exercises the step's payload
 * shape (title + body verbatim, source tag) without touching disk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createEventReminderMock } = vi.hoisted(() => ({
  createEventReminderMock: vi.fn(),
}));

vi.mock("@/lib/local-api", () => ({
  sharingApi: {
    createEventReminder: createEventReminderMock,
  },
}));

import {
  notificationsStep,
  NOTIFICATIONS_STEP_TEST_TITLE,
  NOTIFICATIONS_STEP_TEST_BODY,
  fireNotificationsStepTestNotification,
} from "../NotificationsStep";

describe("NotificationsStep §6.3 onEnter test-notification fire", () => {
  beforeEach(() => {
    createEventReminderMock.mockReset();
    createEventReminderMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    createEventReminderMock.mockReset();
  });

  it("declares an onEnter hook", () => {
    expect(typeof notificationsStep.onEnter).toBe("function");
  });

  it("the speech bubble text contains no em-dashes", () => {
    // Grant's standing rule: prose I write contains no em-dashes. The
    // speech is a string here, so a plain substring check is sufficient.
    const speech =
      typeof notificationsStep.speech === "string"
        ? notificationsStep.speech
        : "";
    expect(speech).not.toContain("—");
    expect(NOTIFICATIONS_STEP_TEST_TITLE).not.toContain("—");
    expect(NOTIFICATIONS_STEP_TEST_BODY).not.toContain("—");
  });

  it("onEnter calls sharingApi.createEventReminder exactly once", async () => {
    await notificationsStep.onEnter?.({ username: "alex" });
    expect(createEventReminderMock).toHaveBeenCalledTimes(1);
  });

  it("the created notification carries the expected title + body", async () => {
    await fireNotificationsStepTestNotification();
    expect(createEventReminderMock).toHaveBeenCalledTimes(1);
    const [payload] = createEventReminderMock.mock.calls[0];
    expect(payload).toMatchObject({
      event_title: NOTIFICATIONS_STEP_TEST_TITLE,
      // Body copy travels through `event_location` because the
      // EventReminderNotification union has no separate body field;
      // the inbox row + popup render `event_location` as the
      // secondary-line subtitle. Re-using this slot keeps the demo
      // notification looking identical to a real reminder.
      event_location: NOTIFICATIONS_STEP_TEST_BODY,
      event_kind: "native",
    });
    expect(typeof payload.event_id).toBe("string");
    // The source tag is encoded in the event_id prefix so Phase 4
    // cleanup (which scans notifications by id pattern) can identify
    // the demo notification later if needed.
    expect(payload.event_id.startsWith("onboarding-v4-test-")).toBe(true);
  });

  it("dispatches the ros-notifications-changed event so the bell badge refreshes", async () => {
    const dispatched: string[] = [];
    const originalDispatch = window.dispatchEvent.bind(window);
    window.dispatchEvent = (event: Event) => {
      dispatched.push(event.type);
      return originalDispatch(event);
    };
    try {
      await fireNotificationsStepTestNotification();
      expect(dispatched).toContain("ros-notifications-changed");
    } finally {
      window.dispatchEvent = originalDispatch;
    }
  });

  it("swallows a sharingApi failure so a buggy notification surface cannot wedge the tour", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createEventReminderMock.mockRejectedValueOnce(new Error("disk full"));
    try {
      await expect(
        fireNotificationsStepTestNotification(),
      ).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
