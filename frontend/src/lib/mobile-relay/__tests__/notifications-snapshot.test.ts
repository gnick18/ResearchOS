import { describe, it, expect, vi, beforeEach } from "vitest";

import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/notifications/preferences";
import {
  buildNotificationsSnapshot,
  publishNotificationsToAllDevices,
} from "@/lib/mobile-relay/notifications-snapshot";

const getNotifications = vi.fn();
vi.mock("@/lib/local-api", () => ({
  sharingApi: { getNotifications: (...a: unknown[]) => getNotifications(...a) },
}));

// Relay client + crypto are mocked so the publish path is exercised without a
// network or real keys. listDevices returns the device fixtures each test sets;
// publishSnapshot is a no-op spy; sealing is the identity so no real X25519 runs.
const listDevices = vi.fn();
const publishSnapshot = vi.fn();
vi.mock("@/lib/mobile-relay/client", () => ({
  listDevices: (...a: unknown[]) => listDevices(...a),
  publishSnapshot: (...a: unknown[]) => publishSnapshot(...a),
}));
vi.mock("@/lib/sharing/encryption", () => ({
  sealToRecipient: () => new Uint8Array([1, 2, 3]),
}));
vi.mock("@/lib/sharing/identity/keys", () => ({
  decodePublicKey: (hex: string) => hex,
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

describe("publishNotificationsToAllDevices pushTokens (phone push P1)", () => {
  const keys = {} as never;

  beforeEach(() => {
    getNotifications.mockReset();
    listDevices.mockReset();
    publishSnapshot.mockReset();
    getNotifications.mockResolvedValue({ notifications: [] });
    publishSnapshot.mockResolvedValue(undefined);
  });

  it("returns push tokens only for devices it actually published to", async () => {
    listDevices.mockResolvedValue([
      // Published to (has seal key) AND has a token -> token included.
      { devicePubkey: "d1", x25519Pubkey: "x1", pushToken: "ExponentPushToken[a]" },
      // Has a token but NO seal key -> skipped from publish, so no buzz.
      { devicePubkey: "d2", x25519Pubkey: null, pushToken: "ExponentPushToken[b]" },
      // Published to but never registered a token -> nothing to buzz.
      { devicePubkey: "d3", x25519Pubkey: "x3", pushToken: null },
    ]);
    const res = await publishNotificationsToAllDevices(
      keys,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(res.published).toBe(2);
    expect(res.skipped).toBe(1);
    expect(res.pushTokens).toEqual(["ExponentPushToken[a]"]);
  });

  it("returns no tokens when no phone is paired", async () => {
    listDevices.mockResolvedValue([]);
    const res = await publishNotificationsToAllDevices(
      keys,
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
    expect(res).toEqual({ published: 0, skipped: 0, pushTokens: [] });
  });
});
