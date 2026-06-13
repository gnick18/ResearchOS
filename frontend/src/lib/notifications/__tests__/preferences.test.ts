import { describe, it, expect } from "vitest";

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isQuietNow,
  normalizeNotificationPreferences,
  notificationCategory,
  pushChannelsForNotification,
  type NotificationPreferences,
} from "../preferences";

describe("notificationCategory", () => {
  it("maps the 14 discriminant types into 5 categories", () => {
    expect(notificationCategory("task_shared")).toBe("shared");
    expect(notificationCategory("lab_task_assignment")).toBe("shared");
    expect(notificationCategory("lab_flag_for_review")).toBe("shared");
    expect(notificationCategory("comment_mention")).toBe("comments");
    expect(notificationCategory("comment_lab_head_feed")).toBe("comments");
    expect(notificationCategory("lab_announcement")).toBe("lab");
    expect(notificationCategory("purchase_ordered")).toBe("purchases");
    expect(notificationCategory("lab_purchase_approval")).toBe("purchases");
    expect(notificationCategory("event_reminder")).toBe("reminders");
    expect(notificationCategory("shift_alert")).toBe("reminders");
  });
  it("falls back to shared for an unknown type so nothing is lost", () => {
    expect(notificationCategory("some_future_type")).toBe("shared");
  });
});

describe("isQuietNow", () => {
  const overnight = {
    enabled: true,
    start: "19:00",
    end: "08:00",
    weekendsQuiet: false,
  };
  const at = (h: number, m = 0, day = 3) => {
    const d = new Date(2026, 5, 10, h, m); // a Wednesday baseline
    // force a weekday/weekend by nudging the date's day-of-week
    while (d.getDay() !== day) d.setDate(d.getDate() + 1);
    return d;
  };
  it("wraps an overnight window past midnight", () => {
    expect(isQuietNow(overnight, at(22))).toBe(true); // 10pm
    expect(isQuietNow(overnight, at(3))).toBe(true); // 3am
    expect(isQuietNow(overnight, at(12))).toBe(false); // noon
    expect(isQuietNow(overnight, at(8))).toBe(false); // exactly the end
  });
  it("is never quiet when disabled", () => {
    expect(isQuietNow({ ...overnight, enabled: false }, at(3))).toBe(false);
  });
  it("silences weekends when weekendsQuiet is on", () => {
    const q = { enabled: true, start: "19:00", end: "08:00", weekendsQuiet: true };
    expect(isQuietNow(q, at(12, 0, 6))).toBe(true); // Saturday noon
    expect(isQuietNow(q, at(12, 0, 0))).toBe(true); // Sunday noon
    expect(isQuietNow(q, at(12, 0, 3))).toBe(false); // Wednesday noon
  });
});

describe("pushChannelsForNotification", () => {
  const prefs = DEFAULT_NOTIFICATION_PREFERENCES;
  const noon = new Date(2026, 5, 10, 12, 0);

  it("routes a shared task to laptop + phone for an account user", () => {
    const r = pushChannelsForNotification(prefs, "task_shared", noon, true);
    expect(r).toEqual({ laptop: true, phone: true, email: false });
  });
  it("strips phone + email for a solo user even if the pref says on", () => {
    const r = pushChannelsForNotification(prefs, "task_shared", noon, false);
    expect(r).toEqual({ laptop: true, phone: false, email: false });
  });
  it("routes a lab announcement to email only", () => {
    const r = pushChannelsForNotification(prefs, "lab_announcement", noon, true);
    expect(r).toEqual({ laptop: false, phone: false, email: true });
  });
  it("silences all push channels during quiet hours", () => {
    const quiet: NotificationPreferences = {
      ...prefs,
      quietHours: { enabled: true, start: "00:00", end: "23:59", weekendsQuiet: false },
    };
    const r = pushChannelsForNotification(quiet, "task_shared", noon, true);
    expect(r).toEqual({ laptop: false, phone: false, email: false });
  });
});

describe("normalizeNotificationPreferences", () => {
  it("fills missing categories + channels from defaults", () => {
    const partial = { channels: { shared: { laptop: false } } } as never;
    const n = normalizeNotificationPreferences(partial);
    expect(n.channels.shared.laptop).toBe(false);
    expect(n.channels.shared.inApp).toBe(true); // filled
    expect(n.channels.reminders.phone).toBe(true); // whole category filled
    expect(n.quietHours.enabled).toBe(false);
  });
});
