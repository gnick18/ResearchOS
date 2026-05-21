/**
 * §6.3 Notifications sub-step bodies. The single-step §6.3 surface from
 * commit eac06e40 was split into three beats per Grant's 2026-05-21
 * design feedback ("be smarter than a Got it button" — instead, walk
 * the user through opening the inbox, silencing the row, and deleting
 * it). These tests cover:
 *
 *  - Beat 1 (bell): onEnter still fires the test notification,
 *    completion is event-driven on the popup-opened DOM event.
 *  - Beat 2 (silence): targets the mark-as-read affordance, completion
 *    is event-driven on `tour:notification-silenced`.
 *  - Beat 3 (delete): targets the dismiss affordance, completion is
 *    event-driven on `tour:notification-deleted`.
 *
 * Mocks the local-api surface so the test exercises the bell step's
 * payload shape (title + body verbatim, source tag) without touching
 * disk.
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
  notificationsBellStep,
  NOTIFICATIONS_STEP_TEST_TITLE,
  NOTIFICATIONS_STEP_TEST_BODY,
  fireNotificationsStepTestNotification,
} from "../NotificationsBellStep";
import { notificationsSilenceStep } from "../NotificationsSilenceStep";
import { notificationsDeleteStep } from "../NotificationsDeleteStep";

describe("NotificationsBellStep §6.3a (bell click)", () => {
  beforeEach(() => {
    createEventReminderMock.mockReset();
    createEventReminderMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    createEventReminderMock.mockReset();
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

describe("NotificationsSilenceStep §6.3b (mark-as-read / silence)", () => {
  it("declares the canonical id", () => {
    expect(notificationsSilenceStep.id).toBe("notifications-silence");
  });

  it("targets the notification-silence anchor (the mark-as-read button)", () => {
    expect(notificationsSilenceStep.targetSelector).toBe(
      "[data-tour-target=\"notification-silence\"]",
    );
  });

  it("has no cursorScript (user-action step, Grant 2026-05-21)", () => {
    expect(notificationsSilenceStep.cursorScript).toBeUndefined();
  });

  it("speech bubble contains no em-dashes", () => {
    const speech =
      typeof notificationsSilenceStep.speech === "string"
        ? notificationsSilenceStep.speech
        : "";
    expect(speech).not.toContain("—");
  });

  it("declares event-driven completion", () => {
    expect(notificationsSilenceStep.completion.type).toBe("event");
  });

  it("advances when tour:notification-silenced fires", async () => {
    if (notificationsSilenceStep.completion.type !== "event") {
      throw new Error("completion contract changed shape; update test");
    }
    let advanced = false;
    const stop = notificationsSilenceStep.completion.eventListener(() => {
      advanced = true;
    });
    try {
      window.dispatchEvent(new CustomEvent("tour:notification-silenced"));
      await Promise.resolve();
      expect(advanced).toBe(true);
    } finally {
      stop();
    }
  });

  it("the event listener unsubscribes cleanly (no double-fire after stop)", async () => {
    if (notificationsSilenceStep.completion.type !== "event") {
      throw new Error("completion contract changed shape; update test");
    }
    let fireCount = 0;
    const stop = notificationsSilenceStep.completion.eventListener(() => {
      fireCount++;
    });
    stop();
    window.dispatchEvent(new CustomEvent("tour:notification-silenced"));
    await Promise.resolve();
    expect(fireCount).toBe(0);
  });
});

describe("NotificationsDeleteStep §6.3c (dismiss / delete)", () => {
  it("declares the canonical id", () => {
    expect(notificationsDeleteStep.id).toBe("notifications-delete");
  });

  it("targets the notification-delete anchor (the dismiss X button)", () => {
    expect(notificationsDeleteStep.targetSelector).toBe(
      "[data-tour-target=\"notification-delete\"]",
    );
  });

  it("has no cursorScript (user-action step, Grant 2026-05-21)", () => {
    expect(notificationsDeleteStep.cursorScript).toBeUndefined();
  });

  it("speech bubble contains no em-dashes", () => {
    const speech =
      typeof notificationsDeleteStep.speech === "string"
        ? notificationsDeleteStep.speech
        : "";
    expect(speech).not.toContain("—");
  });

  it("declares event-driven completion", () => {
    expect(notificationsDeleteStep.completion.type).toBe("event");
  });

  it("advances when tour:notification-deleted fires", async () => {
    if (notificationsDeleteStep.completion.type !== "event") {
      throw new Error("completion contract changed shape; update test");
    }
    let advanced = false;
    const stop = notificationsDeleteStep.completion.eventListener(() => {
      advanced = true;
    });
    try {
      window.dispatchEvent(new CustomEvent("tour:notification-deleted"));
      await Promise.resolve();
      expect(advanced).toBe(true);
    } finally {
      stop();
    }
  });

  it("the event listener unsubscribes cleanly (no double-fire after stop)", async () => {
    if (notificationsDeleteStep.completion.type !== "event") {
      throw new Error("completion contract changed shape; update test");
    }
    let fireCount = 0;
    const stop = notificationsDeleteStep.completion.eventListener(() => {
      fireCount++;
    });
    stop();
    window.dispatchEvent(new CustomEvent("tour:notification-deleted"));
    await Promise.resolve();
    expect(fireCount).toBe(0);
  });
});
