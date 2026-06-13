// Mobile DOWNLOAD path, the laptop notifications publisher (phase 3, phone channel).
//
// Builds a small snapshot of the connected user's recent notifications, filtered
// to the categories the user routed to their phone, and seals it once per paired
// phone to that phone's X25519 key before publishing it to the capture relay
// under the "notifications" kind. The relay only ever holds the sealed bytes, so
// a phone with the matching device key is the only thing that can read its own
// snapshot. The companion app reads this snapshot to show the notifications the
// user asked to see at the bench.
//
// This mirrors inventory-snapshot.ts exactly; see that file + today-snapshot.ts +
// relay/scripts/smoke-snapshot.mjs for the full seal/openSealed round-trip
// contract.
//
// Delivery model: this is a synced LIST, not an OS push buzz (there is no
// service worker / web-push in the companion, the phone polls the relay). So the
// phone channel routes notifications into the companion app's list rather than
// vibrating the phone while the laptop is closed. Quiet hours are not applied to
// the list itself (they silence active pop-ups, of which the phone has none); the
// user controls the phone list purely by the per-category phone toggle.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { sharingApi } from "@/lib/local-api";
import { sealToRecipient } from "@/lib/sharing/encryption";
import { decodePublicKey } from "@/lib/sharing/identity/keys";
import {
  notificationCategory,
  type NotificationPreferences,
} from "@/lib/notifications/preferences";
import { notificationDisplayText } from "@/lib/notifications/display";
import type { Notification as RosNotification } from "@/lib/types";
import { listDevices, publishSnapshot, type UserCaptureKeys } from "./client";

/** One notification as it appears in the companion app's list. */
export interface SnapshotNotification {
  id: string;
  category: string;
  title: string;
  body: string;
  createdAt: string | null;
  read: boolean;
}

export interface NotificationsSnapshot {
  kind: "notifications";
  version: 1;
  /** Newest first, already filtered to phone-routed categories. Capped. */
  notifications: SnapshotNotification[];
}

/** Newest snapshots stay small so a phone never holds an unbounded backlog. */
const MAX_SNAPSHOT_NOTIFICATIONS = 50;

/**
 * Build the phone snapshot from the user's notifications, keeping only the ones
 * whose category the user routed to their phone. Pure of the relay, so it is
 * unit-testable and reusable.
 */
export async function buildNotificationsSnapshot(
  prefs: NotificationPreferences,
): Promise<NotificationsSnapshot> {
  let list: RosNotification[] = [];
  try {
    list = (await sharingApi.getNotifications()).notifications ?? [];
  } catch {
    list = [];
  }

  const phoneRouted = list.filter(
    (n) => prefs.channels[notificationCategory(n.type)]?.phone,
  );

  const items: SnapshotNotification[] = phoneRouted.map((n) => {
    const { title, body } = notificationDisplayText(n);
    return {
      id: n.id,
      category: notificationCategory(n.type),
      title,
      body,
      createdAt: typeof n.created_at === "string" ? n.created_at : null,
      read: !!n.read,
    };
  });

  // Newest first by created_at when present, then cap.
  items.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return {
    kind: "notifications",
    version: 1,
    notifications: items.slice(0, MAX_SNAPSHOT_NOTIFICATIONS),
  };
}

/**
 * Seal + publish the notifications snapshot to every paired phone. A no-op (0/0)
 * when no phone is paired. Mirrors publishInventoryToAllDevices exactly.
 */
export async function publishNotificationsToAllDevices(
  keys: UserCaptureKeys,
  prefs: NotificationPreferences,
): Promise<{ published: number; skipped: number }> {
  const devices = await listDevices(keys);
  if (devices.length === 0) return { published: 0, skipped: 0 };

  const snap = await buildNotificationsSnapshot(prefs);
  const plaintext = new TextEncoder().encode(JSON.stringify(snap));

  let published = 0;
  let skipped = 0;
  for (const device of devices) {
    if (!device.x25519Pubkey) {
      console.info(
        `[notifications-publisher] skip device ${device.devicePubkey.slice(0, 12)}... (no x25519 seal key)`,
      );
      skipped += 1;
      continue;
    }
    const sealed = sealToRecipient(plaintext, decodePublicKey(device.x25519Pubkey));
    await publishSnapshot(keys, "notifications", device.devicePubkey, sealed);
    published += 1;
  }
  return { published, skipped };
}
