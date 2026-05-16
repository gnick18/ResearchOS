// SENSITIVE: bot tokens live here. See SECURITY_AUDIT.md §1.3.
//
// Per-{folder, user} cache that lets the recovery prompt re-offer a previously
// paired Telegram bot when the on-disk `_telegram.json` sidecar goes missing
// (manual delete, OneDrive sync hiccup, accidental .gitignore-driven wipe).
//
// Cache key shape: `research-os-telegram-token-cache:{folder}:{username}`.
// Cache value: ONLY the minimal trio needed to reconstruct a pairing —
// `bot_token`, `chat_id`, `bot_username`. `pairedAt` and `lastUpdateId`
// re-derive on reconnect (the polling loop starts from update 0 anyway).
//
// Lifecycle (see SECURITY_AUDIT.md §1.3 for the threat model + constraints):
//   - written on pairing success + on lazy-refresh from a successful disk read
//   - cleared on explicit user disconnect + recovery-reject
//   - wiped folder-wide when the FSA handle changes (folder switch)

import { get, set, del, keys } from "idb-keyval";

export interface CachedTelegramToken {
  botToken: string;
  chatId: number;
  botUsername: string;
}

const KEY_PREFIX = "research-os-telegram-token-cache:";

function cacheKey(folder: string, username: string): string {
  return `${KEY_PREFIX}${folder}:${username}`;
}

// SENSITIVE: read/write helpers — bot tokens flow through these.
export async function readTelegramTokenCache(
  folder: string,
  username: string,
): Promise<CachedTelegramToken | null> {
  try {
    return (await get<CachedTelegramToken>(cacheKey(folder, username))) ?? null;
  } catch {
    return null;
  }
}

// SENSITIVE: writes the active bot token to IDB.
export async function writeTelegramTokenCache(
  folder: string,
  username: string,
  payload: CachedTelegramToken,
): Promise<void> {
  try {
    await set(cacheKey(folder, username), payload);
  } catch {
    /* IDB write failures are non-fatal — disk is still the source of truth. */
  }
}

export async function clearTelegramTokenCacheEntry(
  folder: string,
  username: string,
): Promise<void> {
  try {
    await del(cacheKey(folder, username));
  } catch {
    /* ignore */
  }
}

/**
 * Wipe ALL telegram-token cache entries scoped to `folder`. Used in two
 * places:
 *   1. `clearDirectoryHandle` (folder switch / disconnect) — keeps the cache
 *      scope aligned with disk scope: when the user leaves a folder, the
 *      tokens recoverable from that folder go with it.
 *   2. The Settings "Forget cached credentials" button (chip #2) — gives a
 *      user an explicit opt-out for the IDB-side recovery path.
 *
 * Function name is part of the security manager's approved API surface;
 * do not rename without re-review.
 */
export async function forgetAllTelegramTokenCache(folder: string): Promise<void> {
  const prefix = `${KEY_PREFIX}${folder}:`;
  try {
    const all = await keys();
    const ours = all.filter(
      (k): k is string => typeof k === "string" && k.startsWith(prefix),
    );
    await Promise.all(ours.map((k) => del(k)));
  } catch {
    /* ignore */
  }
}
