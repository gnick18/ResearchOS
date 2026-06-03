/**
 * §6.3 Notifications bell-step body. 2026-06-03 (HR / tour-
 * simplification): the §6.3 cluster collapsed to intro + bell. The two
 * field-walk beats (silence mark-as-read, delete dismiss) were cut and
 * their awareness folded into the bell speech, so their bodies + tests
 * were removed. This file now covers the surviving bell beat:
 *
 *  - bell: onEnter still fires the test notification, completion is
 *    event-driven on the popup-opened DOM event (the user opening the
 *    inbox is the advance trigger; it never depended on the cut beats).
 *
 * Mocks the local-api surface so the test exercises the bell step's
 * payload shape (title + body verbatim, source tag) without touching
 * disk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createEventReminderMock,
  getNotificationsMock,
  markNotificationUnreadMock,
} = vi.hoisted(() => ({
  createEventReminderMock: vi.fn(),
  getNotificationsMock: vi.fn(),
  markNotificationUnreadMock: vi.fn(),
}));

vi.mock("@/lib/local-api", () => ({
  sharingApi: {
    createEventReminder: createEventReminderMock,
    getNotifications: getNotificationsMock,
    markNotificationUnread: markNotificationUnreadMock,
  },
}));

import {
  notificationsBellStep,
  NOTIFICATIONS_STEP_TEST_TITLE,
  NOTIFICATIONS_STEP_TEST_BODY,
  fireNotificationsStepTestNotification,
} from "../NotificationsBellStep";

describe("NotificationsBellStep §6.3a (bell click)", () => {
  beforeEach(() => {
    createEventReminderMock.mockReset();
    createEventReminderMock.mockResolvedValue(undefined);
    getNotificationsMock.mockReset();
    // Default: empty inbox so the spawn path runs (matches first-time
    // tour entry). Tests that want the idempotency branch override.
    getNotificationsMock.mockResolvedValue({
      notifications: [],
      unread_count: 0,
    });
    markNotificationUnreadMock.mockReset();
    markNotificationUnreadMock.mockResolvedValue({
      status: "ok",
      notification_id: "stub",
    });
  });

  afterEach(() => {
    createEventReminderMock.mockReset();
    getNotificationsMock.mockReset();
    markNotificationUnreadMock.mockReset();
  });

  it("declares the canonical id", () => {
    expect(notificationsBellStep.id).toBe("notifications-bell");
  });

  it("declares an onEnter hook", () => {
    expect(typeof notificationsBellStep.onEnter).toBe("function");
  });

  it("has no cursorScript (user-action step, Grant 2026-05-21)", () => {
    expect(notificationsBellStep.cursorScript).toBeUndefined();
  });

  it("the speech bubble text contains no em-dashes", () => {
    const speech =
      typeof notificationsBellStep.speech === "string"
        ? notificationsBellStep.speech
        : "";
    expect(speech).not.toContain("—");
    expect(NOTIFICATIONS_STEP_TEST_TITLE).not.toContain("—");
    expect(NOTIFICATIONS_STEP_TEST_BODY).not.toContain("—");
  });

  it("targets the notifications bell anchor", () => {
    expect(notificationsBellStep.targetSelector).toBe(
      "[data-tour-target=\"notifications-bell\"]",
    );
  });

  it("onEnter calls sharingApi.createEventReminder exactly once", async () => {
    await notificationsBellStep.onEnter?.({ username: "alex" });
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

  it("declares event-driven completion (popup-opened DOM event)", () => {
    expect(notificationsBellStep.completion.type).toBe("event");
  });

  it("advances when tour:notifications-popup-opened fires", async () => {
    if (notificationsBellStep.completion.type !== "event") {
      throw new Error("completion contract changed shape; update test");
    }
    let advanced = false;
    const stop = notificationsBellStep.completion.eventListener(() => {
      advanced = true;
    });
    try {
      window.dispatchEvent(new CustomEvent("tour:notifications-popup-opened"));
      await Promise.resolve();
      expect(advanced).toBe(true);
    } finally {
      stop();
    }
  });
});
