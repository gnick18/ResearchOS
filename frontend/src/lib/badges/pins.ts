"use client";

// Badge pin persistence (badges phase 2).
//
// Pins are a NETWORK-PAGE feature, so their durable home is the holder's
// server-readable profile record (the publish path, not yet built), NOT the
// E2E-encrypted account-settings blob (the public page is server-rendered and
// could never decrypt that). Until the publish path lands, pins live in a
// per-device localStorage cache keyed by profileId, exactly as badges v1 did.
//
// This module is the single seam the bin reads/writes through, so swapping the
// localStorage cache for the profile-record read/write later is a one-file change
// with no bin churn.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

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

/** Load the pinned badge ids for a profile. Resilient and non-throwing. */
export async function loadPinnedBadgeIds(profileId: string): Promise<string[]> {
  return readLocalPins(profileId);
}

/** Persist the pinned badge ids. Best-effort and non-throwing. */
export async function savePinnedBadgeIds(profileId: string, ids: string[]): Promise<void> {
  writeLocalPins(profileId, ids);
}
