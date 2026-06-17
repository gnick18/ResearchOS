// Account-scoped settings, the cloud store (Phase 1).
//
// One row per identity, keyed by the SAME peppered email hash the directory and
// billing use (ownerKeyForEmail). The row holds ONLY ciphertext, the E2E blob
// the client sealed to its identity key (account-settings-crypto.ts). The server
// never decrypts it and never holds a key, so this store is consistent with the
// local-first promise even though it lives in our cloud. See
// docs/proposals/2026-06-17-account-vs-folder-settings.md.
//
// The Neon HTTP driver is created lazily from DATABASE_URL inside a singleton, so
// importing this module (during build or tsc) never requires the connection
// string. Schema creation is idempotent and called at the start of each route, a
// single CREATE TABLE IF NOT EXISTS, cheap. Mirrors lib/sharing/directory/db.ts
// and lib/billing/lab.ts.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

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
      "DATABASE_URL is not set. Account settings cannot reach Neon without it.",
    );
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

/**
 * The stored account-settings row. ciphertext is the opaque, client-encrypted
 * transport blob (base64); the server cannot read it. blobVersion is the client
 * envelope version, surfaced so a future server-side migration audit can see the
 * format spread without decrypting.
 */
export interface AccountSettingsRow {
  ownerKey: string;
  ciphertext: string;
  blobVersion: number;
  updatedAt: string;
}

/**
 * Creates the account_settings table if it does not exist. Idempotent, so every
 * route can call it on entry without a migration step. The owner_key is the
 * peppered email hash (same key the directory + billing use). ciphertext is the
 * opaque E2E blob, never plaintext.
 */
export async function ensureAccountSettingsSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS account_settings (
      owner_key text primary key,
      ciphertext text,
      blob_version integer default 1,
      updated_at timestamptz default now()
    )
  `;
}

/**
 * Reads the stored ciphertext row for an identity, or null when none exists yet
 * (a user who has never written account settings). Never decrypts; the caller
 * (the client) holds the key.
 */
export async function getAccountSettings(
  ownerKey: string,
): Promise<AccountSettingsRow | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT owner_key, ciphertext, blob_version, updated_at
    FROM account_settings
    WHERE owner_key = ${ownerKey}
    LIMIT 1
  `) as Array<{
    owner_key: string;
    ciphertext: string | null;
    blob_version: number | null;
    updated_at: string;
  }>;
  const row = rows[0];
  if (!row || row.ciphertext == null) return null;
  return {
    ownerKey: row.owner_key,
    ciphertext: row.ciphertext,
    blobVersion: row.blob_version ?? 1,
    updatedAt: row.updated_at,
  };
}

/**
 * Stores (upserts) the client-sealed ciphertext for an identity. The server
 * stores the bytes verbatim and never decrypts them. updated_at is bumped so the
 * newest write wins. blobVersion records the client envelope version for audit.
 */
export async function putAccountSettings(
  ownerKey: string,
  ciphertext: string,
  blobVersion: number,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO account_settings (owner_key, ciphertext, blob_version, updated_at)
    VALUES (${ownerKey}, ${ciphertext}, ${blobVersion}, now())
    ON CONFLICT (owner_key) DO UPDATE SET
      ciphertext = EXCLUDED.ciphertext,
      blob_version = EXCLUDED.blob_version,
      updated_at = now()
  `;
}
