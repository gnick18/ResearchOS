// Cross-boundary sharing, relay mailbox persistence on Neon (Phase 2a-ii).
//
// The relay keeps one metadata row per pending bundle. The row holds only the
// peppered email hashes of the recipient and sender, the size, and the timing
// (created and expiry). It never holds the sealed bytes (those live in R2) and
// never a plaintext email. A recipient lists their inbox by their own hash, and
// a row is removed on pickup acknowledgement or once it has passed its 30-day
// expiry. This mirrors the directory db's lazy Neon-singleton pattern so a build
// or a tsc pass never needs the connection string.

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
      "DATABASE_URL is not set. The relay cannot reach Neon without it.",
    );
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

/**
 * A relay mailbox row as stored. bundleId is the server-generated object key in
 * R2, the email hashes are peppered HMACs (never plaintext), sizeBytes is the
 * client-reported sealed size, and the two timestamps bound the row's life.
 */
export interface InboxEntry {
  bundleId: string;
  recipientEmailHash: string;
  senderEmailHash: string | null;
  sizeBytes: number | null;
  createdAt: string;
  expiresAt: string;
}

/**
 * The fields needed to create a mailbox row. createdAt defaults to now() in the
 * table, so the caller supplies only the identity, size, and expiry.
 */
export interface NewInboxEntry {
  bundleId: string;
  recipientEmailHash: string;
  senderEmailHash: string | null;
  sizeBytes: number | null;
  expiresAt: string;
}

/**
 * Creates the relay mailbox table if it does not already exist, plus an index on
 * recipient_email_hash so an inbox listing is a cheap indexed scan. Idempotent,
 * so every route can call it on entry without a migration step.
 */
export async function ensureRelaySchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS relay_inbox (
      bundle_id text primary key,
      recipient_email_hash text not null,
      sender_email_hash text,
      size_bytes bigint,
      created_at timestamptz default now(),
      expires_at timestamptz not null
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS relay_inbox_recipient_idx
      ON relay_inbox (recipient_email_hash)
  `;
}

/**
 * Inserts a new pending-bundle row. The bundle_id is the primary key and is a
 * server-generated UUID, so a collision is effectively impossible, but the
 * insert is plain (no upsert) so any reuse surfaces as an error rather than
 * silently clobbering an existing row.
 */
export async function insertInboxEntry(entry: NewInboxEntry): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO relay_inbox
      (bundle_id, recipient_email_hash, sender_email_hash, size_bytes, expires_at)
    VALUES
      (${entry.bundleId}, ${entry.recipientEmailHash}, ${entry.senderEmailHash},
       ${entry.sizeBytes}, ${entry.expiresAt})
  `;
}

/**
 * Lists the non-expired pending bundles for a recipient hash, newest first. The
 * expiry filter is applied in SQL (expires_at > now()) so a row past its TTL is
 * invisible to a listing even before the sweep deletes it. Metadata only, the
 * sealed bytes are never touched here.
 */
export async function listInboxByRecipient(
  recipientEmailHash: string,
): Promise<InboxEntry[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT bundle_id, recipient_email_hash, sender_email_hash, size_bytes,
           created_at, expires_at
    FROM relay_inbox
    WHERE recipient_email_hash = ${recipientEmailHash}
      AND expires_at > now()
    ORDER BY created_at DESC
  `) as Array<{
    bundle_id: string;
    recipient_email_hash: string;
    sender_email_hash: string | null;
    size_bytes: number | string | null;
    created_at: string;
    expires_at: string;
  }>;
  return rows.map(mapRow);
}

/**
 * Fetches a single mailbox row by bundle id, or null if there is no such row.
 * Returns the row regardless of expiry so the fetch route can detect an expired
 * entry, sweep it, and return a clean 410 rather than a confusing 404.
 */
export async function getInboxEntry(
  bundleId: string,
): Promise<InboxEntry | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT bundle_id, recipient_email_hash, sender_email_hash, size_bytes,
           created_at, expires_at
    FROM relay_inbox
    WHERE bundle_id = ${bundleId}
    LIMIT 1
  `) as Array<{
    bundle_id: string;
    recipient_email_hash: string;
    sender_email_hash: string | null;
    size_bytes: number | string | null;
    created_at: string;
    expires_at: string;
  }>;
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

/**
 * Deletes a mailbox row by bundle id. Called on pickup acknowledgement and when
 * sweeping an expired entry. Idempotent at the SQL level, deleting a missing row
 * is a no-op.
 */
export async function deleteInboxEntry(bundleId: string): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM relay_inbox WHERE bundle_id = ${bundleId}`;
}

/**
 * Counts the non-expired pending bundles addressed to a recipient hash. The send
 * route uses this to enforce a per-recipient mailbox quota, which (together with
 * the per-IP rate limit) also bounds how many replays of a captured send request
 * could land within the 5-minute signature window.
 */
export async function countInboxByRecipient(
  recipientEmailHash: string,
): Promise<number> {
  const sql = getSql();
  const rows = (await sql`
    SELECT count(*)::int AS n
    FROM relay_inbox
    WHERE recipient_email_hash = ${recipientEmailHash}
      AND expires_at > now()
  `) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/**
 * Normalizes a raw DB row into an InboxEntry. size_bytes is a bigint column, the
 * Neon driver may hand it back as a string, so we coerce to a number (or null).
 */
function mapRow(r: {
  bundle_id: string;
  recipient_email_hash: string;
  sender_email_hash: string | null;
  size_bytes: number | string | null;
  created_at: string;
  expires_at: string;
}): InboxEntry {
  return {
    bundleId: r.bundle_id,
    recipientEmailHash: r.recipient_email_hash,
    senderEmailHash: r.sender_email_hash,
    sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  };
}
