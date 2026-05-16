// SENSITIVE: bot tokens flow through this module (disk pairing sidecar +
// IDB recovery cache mirror). See SECURITY_AUDIT.md §1.3.

import { fileService } from "@/lib/file-system/file-service";
import { getStoredDirectoryMeta } from "@/lib/file-system/indexeddb-store";
import {
  clearTelegramTokenCacheEntry,
  readTelegramTokenCache,
  writeTelegramTokenCache,
  type CachedTelegramToken,
} from "./telegram-token-cache";

export interface TelegramPairing {
  botToken: string;
  botUsername: string;
  botFirstName?: string;
  /** The Telegram chat id of the user who sent `/start`. All messages we
   *  accept must come from this chat. */
  chatId: number;
  /** Largest `update_id` we've processed. The polling loop passes
   *  `lastUpdateId + 1` as the next `offset`. */
  lastUpdateId: number;
  pairedAt: string;
}

function pairingPath(username: string): string {
  return `users/${username}/_telegram.json`;
}

async function currentFolderName(): Promise<string | null> {
  const meta = await getStoredDirectoryMeta();
  return meta?.name ?? null;
}

function toCached(pairing: TelegramPairing): CachedTelegramToken {
  return {
    botToken: pairing.botToken,
    chatId: pairing.chatId,
    botUsername: pairing.botUsername,
  };
}

function cacheMatches(
  cached: CachedTelegramToken | null,
  want: CachedTelegramToken,
): boolean {
  return (
    cached !== null &&
    cached.botToken === want.botToken &&
    cached.chatId === want.chatId &&
    cached.botUsername === want.botUsername
  );
}

// SENSITIVE: lazy-refresh of the IDB token cache from a successful disk read.
// Per security manager constraint [4b]: writes when the cache is ABSENT too
// (not only on diff) so a wipe-then-repair sequence reseeds the cache.
async function refreshTokenCacheFromDisk(
  username: string,
  pairing: TelegramPairing,
): Promise<void> {
  const folder = await currentFolderName();
  if (!folder) return;
  const cached = await readTelegramTokenCache(folder, username);
  const want = toCached(pairing);
  if (cacheMatches(cached, want)) return;
  await writeTelegramTokenCache(folder, username, want);
}

export async function readPairing(username: string): Promise<TelegramPairing | null> {
  const onDisk = await fileService.readJson<TelegramPairing>(pairingPath(username));
  if (onDisk) {
    // Constraint [4]: every successful disk read seeds / refreshes the cache.
    await refreshTokenCacheFromDisk(username, onDisk);
  }
  return onDisk;
}

export async function writePairing(username: string, pairing: TelegramPairing): Promise<void> {
  await fileService.writeJson(pairingPath(username), pairing);
  // Constraint [4a]: pairing success seeds the recovery cache.
  const folder = await currentFolderName();
  if (folder) {
    await writeTelegramTokenCache(folder, username, toCached(pairing));
  }
}

export async function updateLastUpdateId(
  username: string,
  lastUpdateId: number
): Promise<void> {
  const existing = await readPairing(username);
  if (!existing) return;
  if (lastUpdateId <= existing.lastUpdateId) return;
  await writePairing(username, { ...existing, lastUpdateId });
}

export async function clearPairing(username: string): Promise<void> {
  await fileService.deleteFile(pairingPath(username));
  // Constraint [6]: explicit user-driven disconnect clears the matching IDB
  // entry. Without this, a "Disconnect" followed by a folder reload would
  // resurrect the bot via the recovery prompt — surprising and wrong.
  const folder = await currentFolderName();
  if (folder) {
    await clearTelegramTokenCacheEntry(folder, username);
  }
}
