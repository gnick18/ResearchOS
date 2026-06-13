import { describe, it, expect, vi, beforeEach } from "vitest";

import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/notifications/preferences";
import { buildNotificationsSnapshot } from "@/lib/mobile-relay/notifications-snapshot";

const getNotifications = vi.fn();
vi.mock("@/lib/local-api", () => ({
  sharingApi: { getNotifications: (...a: unknown[]) => getNotifications(...a) },
}));

function notif(over: Record<string, unknown>) {
  return {
    id: "n1",
    type: "task_shared",
    from_user: "u",
    item_type: "task",
    item_id: 1,
    item_name: "Plasmid prep",
    permission: "view",
    created_at: "2026-06-12T10:00:00.000Z",
    read: false,
    ...over,
  };
}

describe("buildNotificationsSnapshot", () => {
  beforeEach(() => getNotifications.mockReset());

  it("keeps only categories the user routed to the phone", async () => {
    // Defaults: shared.phone=true, comments.phone=false.
    getNotifications.mockResolvedValue({
      notifications: [
        notif({ id: "a", type: "task_shared" }), // shared -> phone on
        notif({ id: "b", type: "comment_mention" }), // comments -> phone off
      ],
    });
    const snap = await buildNotificationsSnapshot(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(snap.notifications.map((n) => n.id)).toEqual(["a"]);
    expect(snap.kind).toBe("notifications");
  });

  it("sorts newest first and carries a display title + body", async () => {
    getNotifications.mockResolvedValue({
      notifications: [
        notif({ id: "old", created_at: "2026-06-10T00:00:00.000Z" }),
        notif({ id: "new", created_at: "2026-06-12T00:00:00.000Z" }),
      ],
    });
    const snap = await buildNotificationsSnapshot(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(snap.notifications.map((n) => n.id)).toEqual(["new", "old"]);
    expect(snap.notifications[0].title).toBe("Shared with you");
    expect(snap.notifications[0].body).toBe("Plasmid prep");
  });

  it("yields an empty, well-formed snapshot when there are no notifications", async () => {
    getNotifications.mockResolvedValue({ notifications: [] });
    const snap = await buildNotificationsSnapshot(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(snap.notifications).toEqual([]);
    expect(snap.kind).toBe("notifications");
    expect(snap.version).toBe(1);
  });

  it("tolerates a missing notifications array without throwing", async () => {
    getNotifications.mockResolvedValue({});
    const snap = await buildNotificationsSnapshot(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(snap.notifications).toEqual([]);
  });
});
