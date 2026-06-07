// Identity model simplification, the unified login rebuild, the I/O layer.
//
// Reads and writes the per-user `_account.json` (the file that retires `_auth.json`)
// and wraps the local-identity crypto with the folder I/O the login UI calls. This
// module does NOT save the unlocked keypair into the device session, that is the
// caller's job (the login screen pairs a successful unlock with saveIdentity), so
// the store stays a thin, testable seam over fileService.
//
// Migration from `_auth.json` is deliberately NOT here yet, the existing-user case
// (a published sharing identity plus a legacy password) has a design question open
// with Grant. See docs/proposals/IDENTITY_MODEL_SIMPLIFICATION.md.

import { fileService } from "@/lib/file-system/file-service";
import { deleteEncryptedBackup } from "@/lib/telegram/encrypted-backup";
import { type KdfParams, PROD_KDF_PARAMS } from "@/lib/sharing/identity/backup";
import {
  type CreatedLocalAccount,
  type LocalAccountFile,
  type UnlockedKeys,
  changePassword,
  createLocalAccount,
  unlockWithPassword,
  unlockWithRecovery,
} from "./local-identity";

function accountPath(username: string): string {
  return `users/${username}/_account.json`;
}

/** Whether this user has a local account file (the new login model). */
export async function hasLocalAccount(username: string): Promise<boolean> {
  return fileService.fileExists(accountPath(username));
}

/** Reads the local account file, or null when absent. */
export async function readLocalAccount(
  username: string,
): Promise<LocalAccountFile | null> {
  return fileService.readJson<LocalAccountFile>(accountPath(username));
}

/** Writes (or replaces) the local account file. */
export async function writeLocalAccount(
  username: string,
  file: LocalAccountFile,
): Promise<void> {
  await fileService.writeJson(accountPath(username), file);
}

/**
 * Deletes the local account file, dropping the login. Only valid for a genuinely
 * solo folder, the caller enforces that (a shared folder requires a login).
 */
export async function deleteLocalAccount(username: string): Promise<void> {
  await fileService.deleteFile(accountPath(username));
}

/**
 * Creates a fresh local account for a user and persists it. Returns the created
 * result, which carries the one-time recovery code plus the unlocked keys so the
 * caller can start a session immediately without re-deriving.
 */
export async function createAndPersistAccount(
  username: string,
  password: string,
  params: KdfParams = PROD_KDF_PARAMS,
): Promise<CreatedLocalAccount> {
  const created = createLocalAccount(password, params);
  await writeLocalAccount(username, created.file);
  // A fresh account mints a fresh keypair, so any existing Telegram backup is
  // necessarily orphaned. The backup is now keyed off the X25519 secret (option
  // B), and a pre-cutover backup was keyed off the old password, so either way a
  // prior `_telegram-encrypted.json` can no longer be decrypted. Clear it so the
  // user re-pairs rather than leaving an unreadable blob behind. Best-effort.
  try {
    await deleteEncryptedBackup(username);
  } catch {
    /* no backup to clear, or the folder is read-only, either is fine */
  }
  return created;
}

/**
 * The login check. Reads the user's account file and unwraps it with the password.
 * Returns the keys on success, or null when there is no account or the password is
 * wrong. The caller persists the keys to the device session on success.
 */
export async function loginWithPassword(
  username: string,
  password: string,
): Promise<UnlockedKeys | null> {
  const file = await readLocalAccount(username);
  if (!file) return null;
  return unlockWithPassword(file, password);
}

/** The forgotten-password path, unwraps with the recovery code or the 12 words. */
export async function loginWithRecovery(
  username: string,
  codeOrWords: string,
): Promise<UnlockedKeys | null> {
  const file = await readLocalAccount(username);
  if (!file) return null;
  return unlockWithRecovery(file, codeOrWords);
}

/**
 * Changes the account password and persists the re-wrapped file. Returns false
 * when there is no account or the current password is wrong. The recovery code is
 * unchanged.
 */
export async function changeAccountPassword(
  username: string,
  currentPassword: string,
  newPassword: string,
  params: KdfParams = PROD_KDF_PARAMS,
): Promise<boolean> {
  const file = await readLocalAccount(username);
  if (!file) return false;
  const updated = changePassword(file, currentPassword, newPassword, params);
  if (!updated) return false;
  await writeLocalAccount(username, updated);
  return true;
}
