// Cross-boundary sharing, the directory key-backup envelope.
// Passkey identity unlock, chunk 1 (crypto core).
//
// Today the directory stores ONE opaque key_backup_blob, the mnemonic-wrapped
// BackupBlob. Passkey adds a second wrapped blob, so the field becomes a small
// versioned envelope carrying both. This module is the pure parse and serialize
// for that envelope, with backward compatibility. A legacy bare BackupBlob (the
// v1 shape, alg "argon2id") parses as an envelope with only the mnemonic blob,
// and we serialize the v2 envelope going forward (a lazy upgrade on the next
// write). No network here, the directory wiring is chunk 2.

import { type BackupBlob } from "./backup";
import { type PrfBackupBlob } from "./passkey";

/**
 * The parsed key-backup field. mnemonic is always present (the recovery-code or
 * Recovery-Words blob). passkeyPrf is present once the user has enrolled a
 * passkey.
 */
export interface KeyBackupEnvelope {
  v: 2;
  mnemonic: BackupBlob;
  passkeyPrf?: PrfBackupBlob;
}

/**
 * Parses the stored key_backup_blob string into an envelope. Accepts both the
 * new v2 envelope and a legacy bare BackupBlob (v1), so existing directory rows
 * keep working untouched. Returns null when the string is absent or unparseable.
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

  // v2 envelope.
  if (obj.v === 2 && obj.mnemonic && typeof obj.mnemonic === "object") {
    const env: KeyBackupEnvelope = {
      v: 2,
      mnemonic: obj.mnemonic as BackupBlob,
    };
    if (obj.passkeyPrf && typeof obj.passkeyPrf === "object") {
      env.passkeyPrf = obj.passkeyPrf as PrfBackupBlob;
    }
    return env;
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

/**
 * Builds an envelope from its parts. A convenience used by the enrollment and
 * setup flows in later chunks.
 */
export function buildKeyBackupEnvelope(
  mnemonic: BackupBlob,
  passkeyPrf?: PrfBackupBlob,
): KeyBackupEnvelope {
  return passkeyPrf ? { v: 2, mnemonic, passkeyPrf } : { v: 2, mnemonic };
}
