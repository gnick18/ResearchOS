"use client";

// Badge pin persistence (badges phase 2, owner-side foundation).
//
// Pins are stored in TWO places so they are both instantly readable AND durable
// across devices, mirroring lib/account/preferred-name.ts:
//   1. a per-device localStorage cache (keyed by profileId), so the bin can paint
//      the pinned ring synchronously on mount with no await, and so a signed-out
//      device still remembers its own pins, and
//   2. the account-scoped E2E blob (pinnedBadgeIds), so the pin set follows the
//      signed-in user to every device. This is the cloud home Grant chose over a
//      folder sidecar. Flag-guarded and best-effort, so it is a clean no-op when
//      account settings are off or no identity is unlocked.
//
// Read precedence: the cloud value WINS when present (it is the cross-device
// truth); otherwise the bin uses the localStorage cache. Writes go to both.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

import { isAccountSettingsEnabled } from "@/lib/account/account-settings-config";
import {
  fetchAccountSettings,
  scheduleAccountSettingsWrite,
} from "@/lib/account/account-settings";

const KEY_PREFIX = "ros.badges.pinned.";

function lsKey(profileId: string): string {
  return `${KEY_PREFIX}${profileId}`;
}

function sanitize(ids: unknown): string[] {
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

/** The per-device localStorage cache read (SSR-safe, best effort). */
export function readLocalPins(profileId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(lsKey(profileId));
    return raw ? sanitize(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** The per-device localStorage cache write (best effort). */
export function writeLocalPins(profileId: string, ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(lsKey(profileId), JSON.stringify(ids));
  } catch {
    // Private mode / quota: pins degrade to in-memory for this session.
  }
}

/**
 * Load the pinned badge ids for a profile. The account-scoped value wins when
 * present (cross-device truth); otherwise the per-device cache. Resilient and
 * non-throwing.
 */
export async function loadPinnedBadgeIds(profileId: string): Promise<string[]> {
  if (isAccountSettingsEnabled()) {
    try {
      const settings = await fetchAccountSettings();
      if (settings?.pinnedBadgeIds !== undefined) {
        return sanitize(settings.pinnedBadgeIds);
      }
    } catch {
      // Identity locked / network: fall through to the local cache.
    }
  }
  return readLocalPins(profileId);
}

/**
 * Persist the pinned badge ids. Writes the per-device cache immediately (so the
 * next mount paints without an await) and schedules the account-scoped write (so
 * the set follows the user). Best-effort and non-throwing.
 */
export async function savePinnedBadgeIds(profileId: string, ids: string[]): Promise<void> {
  writeLocalPins(profileId, ids);
  if (isAccountSettingsEnabled()) {
    try {
      const existing = await fetchAccountSettings();
      scheduleAccountSettingsWrite({ ...(existing ?? {}), pinnedBadgeIds: ids });
    } catch {
      // Account layer unavailable: the local cache still carries the pins.
    }
  }
}
