// Cross-boundary sharing, directory persistence on Neon (Phase 1b-ii).
//
// The directory stores exactly one row per registered identity, keyed by the
// peppered email hash (never a plaintext email). A second append-only table
// keeps every key tuple ever bound, so a future transparency-log or rotation
// audit can replay the history. Section 6 of
// docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md.
//
// The Neon HTTP driver is created lazily from DATABASE_URL inside a singleton,
// so importing this module (during build or tsc) never requires the connection
// string to be present. Schema creation is idempotent and called at the start of
// each route, it is a couple of CREATE TABLE IF NOT EXISTS statements and cheap.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

/**
 * Lazily constructs the Neon query function from DATABASE_URL. Throws a clear
 * error if the connection string is missing so a misconfigured deployment fails
 * at request time rather than producing a confusing driver error.
 */
function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The directory cannot reach Neon without it.",
    );
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

/**
 * A directory identity row as stored. All key material is hex-encoded public
 * keys, never private. keyBackupBlob is an opaque client-encrypted blob the
 * server cannot read.
 */
export interface DirectoryBinding {
  emailHash: string;
  x25519PublicKey: string;
  ed25519PublicKey: string;
  fingerprint: string;
  keyBackupBlob: string | null;
}

/**
 * Creates the two directory tables if they do not already exist. Idempotent, so
 * every route can call it on entry without a migration step. directory_identities
 * holds the current binding per email hash, directory_key_history is append-only
 * so the full sequence of keys bound to a hash is recoverable.
 */
export async function ensureSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS directory_identities (
      email_hash text primary key,
      x25519_pub text,
      ed25519_pub text,
      fingerprint text,
      key_backup_blob text,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS directory_key_history (
      id bigserial primary key,
      email_hash text,
      x25519_pub text,
      ed25519_pub text,
      created_at timestamptz default now()
    )
  `;
}

/**
 * Inserts or updates the current binding for an email hash. On a re-registration
 * (same hash) the keys, fingerprint, backup blob, and updated_at are overwritten
 * with the new values, created_at is preserved. The history append is a separate
 * call so the caller controls ordering.
 */
export async function upsertBinding(binding: DirectoryBinding): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO directory_identities
      (email_hash, x25519_pub, ed25519_pub, fingerprint, key_backup_blob, updated_at)
    VALUES
      (${binding.emailHash}, ${binding.x25519PublicKey}, ${binding.ed25519PublicKey},
       ${binding.fingerprint}, ${binding.keyBackupBlob}, now())
    ON CONFLICT (email_hash) DO UPDATE SET
      x25519_pub = EXCLUDED.x25519_pub,
      ed25519_pub = EXCLUDED.ed25519_pub,
      fingerprint = EXCLUDED.fingerprint,
      key_backup_blob = EXCLUDED.key_backup_blob,
      updated_at = now()
  `;
}

/**
 * Fetches the current binding for an exact email hash, or null if none. Exact
 * primary-key match only, never a prefix or a LIKE, so the directory cannot be
 * enumerated. Returns the public keys and fingerprint the caller needs to seal
 * to and verify against. The backup blob is included for completeness but a
 * lookup route should not expose it.
 */
export async function getBindingByHash(
  emailHash: string,
): Promise<DirectoryBinding | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT email_hash, x25519_pub, ed25519_pub, fingerprint, key_backup_blob
    FROM directory_identities
    WHERE email_hash = ${emailHash}
    LIMIT 1
  `) as Array<{
    email_hash: string;
    x25519_pub: string;
    ed25519_pub: string;
    fingerprint: string;
    key_backup_blob: string | null;
  }>;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    emailHash: r.email_hash,
    x25519PublicKey: r.x25519_pub,
    ed25519PublicKey: r.ed25519_pub,
    fingerprint: r.fingerprint,
    keyBackupBlob: r.key_backup_blob,
  };
}

/**
 * Fetches just the encrypted key-backup blob for an email hash, or null if there
 * is no binding or the binding stored no blob. The recovery route needs only the
 * blob, not the key material, so this selects a single column and keeps the two
 * "no blob to return" cases (no row, null column) collapsed into one null result.
 * The blob is end-to-end encrypted, the server cannot read it, so returning it on
 * email-ownership proof is safe.
 */
export async function getBackupBlob(emailHash: string): Promise<string | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT key_backup_blob
    FROM directory_identities
    WHERE email_hash = ${emailHash}
    LIMIT 1
  `) as Array<{ key_backup_blob: string | null }>;
  if (rows.length === 0) return null;
  return rows[0].key_backup_blob;
}

/**
 * Appends a key tuple to the immutable history table. Called after every
 * successful binding so the chain of keys ever bound to an email hash is
 * preserved for a future transparency replay or rotation audit.
 */
export async function appendKeyHistory(
  emailHash: string,
  x25519PublicKey: string,
  ed25519PublicKey: string,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO directory_key_history (email_hash, x25519_pub, ed25519_pub)
    VALUES (${emailHash}, ${x25519PublicKey}, ${ed25519PublicKey})
  `;
}
