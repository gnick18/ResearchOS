// Cross-boundary sharing, the directory key-backup envelope.
//
// The directory stores ONE opaque key_backup_blob carrying the mnemonic-wrapped
// BackupBlob (the recovery-code / 12-words backup). This module is the pure
// parse + serialize for that small versioned envelope, with backward
// compatibility for a legacy bare BackupBlob (v1). No network here.
//
// Historical note: a v2 "passkeyPrf" door once rode in this envelope. The
// passkey was removed (IDENTITY_OAUTH_ONLY P3b), so a stray passkeyPrf on an
// older directory row is simply ignored on parse; the recovery code is the
// single at-rest unlock now.

import { type BackupBlob } from "./backup";

/** The parsed key-backup field. mnemonic is the recovery-code / 12-words blob. */
export interface KeyBackupEnvelope {
  v: 2;
  mnemonic: BackupBlob;
}

/**
 * Parses the stored key_backup_blob string into an envelope. Accepts both the
 * v2 envelope and a legacy bare BackupBlob (v1), so existing directory rows keep
 * working untouched. A legacy passkeyPrf field on a v2 row is ignored. Returns
 * null when the string is absent or unparseable.
 */
export function parseKeyBackupField(
  raw: string | null | undefined,
): KeyBackupEnvelope | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  // v2 envelope (a legacy passkeyPrf field, if present, is ignored).
  if (obj.v === 2 && obj.mnemonic && typeof obj.mnemonic === "object") {
    return { v: 2, mnemonic: obj.mnemonic as BackupBlob };
  }

  // Legacy bare BackupBlob (v1, alg argon2id). Treat it as the mnemonic blob.
  if (obj.v === 1 && obj.alg === "argon2id") {
    return { v: 2, mnemonic: obj as unknown as BackupBlob };
  }

  return null;
}

/** Serializes an envelope to the string stored in key_backup_blob. */
export function serializeKeyBackupEnvelope(env: KeyBackupEnvelope): string {
  return JSON.stringify(env);
}

/** Builds an envelope from the mnemonic backup blob. */
export function buildKeyBackupEnvelope(mnemonic: BackupBlob): KeyBackupEnvelope {
  return { v: 2, mnemonic };
}
