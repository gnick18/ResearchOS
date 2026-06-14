// Cloud-accounts Phase 2, Chunk 2A: folderless cross-device key restore.
//
// A signed-in (OAuth) user on a NEW device or browser, with NO data folder,
// recovers their end-to-end keys from the Neon backup blob by entering their
// recovery words / code. No folder required. The flow:
//
//   1. GET /api/directory/my-backup (authed by the OAuth session ONLY) to fetch
//      this account's own encrypted key_backup_blob.
//   2. Parse the KeyBackupEnvelope and unwrap the mnemonic-wrapped private bundle
//      with the recovery input (Argon2id, heavy, so the caller runs this off the
//      paint path and shows a spinner).
//   3. setSessionIdentity (live for the session) + persistKeysAtRest (the 2C
//      vault) so a reload re-hydrates without another prompt.
//
// The blob is end-to-end encrypted; the server cannot read it. The unwrap happens
// entirely client-side, so the keys are never server-readable. This module owns
// the orchestration, not the crypto (that stays in device-key.ts / backup.ts).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { generateDeviceSalt } from "./backup";
import { unlockKeysFromRecoveryBlob } from "./device-key";
import { persistKeysAtRest } from "./device-vault";
import { parseKeyBackupField } from "./key-backup-envelope";
import { setSessionIdentity } from "./session-key";

/** A typed outcome so the UI can show the right message without parsing strings. */
export type CloudRestoreResult =
  | { ok: true }
  | { ok: false; reason: "no-blob" | "wrong-words" | "offline" | "unauthorized" };

/**
 * Fetches the caller's own backup blob and unwraps it with the recovery input,
 * then parks the keys in the session and the at-rest vault. Returns a typed
 * result; never throws on an expected failure (offline, no blob, bad words).
 *
 * recoveryInput is the recovery code OR the 12 words; normalization happens
 * inside unlockKeysFromRecoveryBlob.
 */
export async function recoverDeviceKeyFromCloud(
  recoveryInput: string,
): Promise<CloudRestoreResult> {
  let res: Response;
  try {
    res = await fetch("/api/directory/my-backup", {
      method: "GET",
      headers: { accept: "application/json" },
    });
  } catch {
    // Network failure / offline.
    return { ok: false, reason: "offline" };
  }

  if (res.status === 401) {
    return { ok: false, reason: "unauthorized" };
  }
  if (res.status === 404) {
    // No published key for this account, nothing to restore here.
    return { ok: false, reason: "no-blob" };
  }
  if (!res.ok) {
    // 429 or a 5xx, treat as a transient connectivity problem.
    return { ok: false, reason: "offline" };
  }

  let body: { keyBackupBlob?: string } | null;
  try {
    body = (await res.json()) as { keyBackupBlob?: string };
  } catch {
    return { ok: false, reason: "offline" };
  }

  const envelope = parseKeyBackupField(body?.keyBackupBlob);
  if (!envelope) {
    return { ok: false, reason: "no-blob" };
  }

  // Unwrap the mnemonic-wrapped private bundle. Argon2id is heavy here; callers
  // should already be off the paint path with a spinner shown.
  const keys = unlockKeysFromRecoveryBlob(envelope.mnemonic, recoveryInput);
  if (!keys) {
    return { ok: false, reason: "wrong-words" };
  }

  // Live for the session, and persisted at rest (encrypted) so a reload survives.
  setSessionIdentity({ keys, deviceSalt: generateDeviceSalt() });
  await persistKeysAtRest(keys);

  return { ok: true };
}

/**
 * Probes whether the signed-in account has a published key to restore on this
 * device. Used by the account home to decide whether to show the unlock card.
 * Returns true only on a 200 with a blob; any other status (401, 404, offline)
 * returns false so the card stays hidden when there is nothing to restore.
 */
export async function hasCloudBackup(): Promise<boolean> {
  try {
    const res = await fetch("/api/directory/my-backup", {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as {
      keyBackupBlob?: string;
    } | null;
    return Boolean(body?.keyBackupBlob);
  } catch {
    return false;
  }
}
