import { fileService } from "@/lib/file-system/file-service";

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

export async function readPairing(username: string): Promise<TelegramPairing | null> {
  return fileService.readJson<TelegramPairing>(pairingPath(username));
}

export async function writePairing(username: string, pairing: TelegramPairing): Promise<void> {
  await fileService.writeJson(pairingPath(username), pairing);
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
}
