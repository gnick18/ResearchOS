// Cross-boundary sharing, relay mailbox persistence on Neon (Phase 2a-ii).
//
// The relay keeps one metadata row per pending bundle. The row holds only the
// peppered email hashes of the recipient and sender, the size, and the timing
// (created and expiry). It never holds the sealed bytes (those live in R2) and
// never a plaintext email. A recipient lists their inbox by their own hash, and
// a row is removed on pickup acknowledgement or once it has passed its 30-day
// expiry. This mirrors the directory db's lazy Neon-singleton pattern so a build
// or a tsc pass never needs the connection string.
//
// CONFIRM-AFTER-UPLOAD. A row carries a status, "pending" or "ready". The send
// route inserts the row as "pending" (the bundle id and presigned URL are needed
// before the upload can happen), and only after the client has PUT the sealed
// bytes to R2 does a signed confirm flip the row to "ready". A listing and a
// single-row fetch return "ready" rows only, so a failed or abandoned upload
// (CSP, CORS, a closed tab) never leaves a visible-but-unopenable mailbox row. A
// pending row that is never confirmed is swept after a short grace window.

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
 *
 * The status column gates the confirm-after-upload flow. The send route inserts
 * "pending" explicitly and a confirm flips it to "ready", so the column default
 * is load-bearing for one case only, backfilling rows that pre-date this column
 * on an existing deployment. Those legacy rows were written under the old model
 * where an inserted row already meant an uploaded bundle, so they backfill to
 * "ready" rather than being hidden or swept.
 */
export async function ensureRelaySchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS relay_inbox (
      bundle_id text primary key,
      recipient_email_hash text not null,
      sender_email_hash text,
      size_bytes bigint,
      status text not null default 'ready',
      created_at timestamptz default now(),
      expires_at timestamptz not null
    )
  `;
  await sql`
    ALTER TABLE relay_inbox
      ADD COLUMN IF NOT EXISTS status text not null default 'ready'
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
 * silently clobbering an existing row. The row lands as "pending" and stays
 * invisible to the recipient until a confirm flips it to "ready" after the
 * client has uploaded the sealed bytes.
 */
export async function insertInboxEntry(entry: NewInboxEntry): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO relay_inbox
      (bundle_id, recipient_email_hash, sender_email_hash, size_bytes, status,
       expires_at)
    VALUES
      (${entry.bundleId}, ${entry.recipientEmailHash}, ${entry.senderEmailHash},
       ${entry.sizeBytes}, 'pending', ${entry.expiresAt})
  `;
}

/**
 * Flips a pending row to "ready" after the sender has uploaded the sealed bytes,
 * scoped to the sender that reserved it so one user cannot confirm another's
 * bundle. The condition also requires status = 'pending', so the update is a
 * no-op on an already-ready row (a duplicate confirm) or a swept one. Returns
 * true only if a matching pending row was flipped, which the confirm route turns
 * into a generic failure when false.
 */
export async function markInboxEntryReady(
  bundleId: string,
  senderEmailHash: string,
): Promise<boolean> {
  const sql = getSql();
  const rows = (await sql`
    UPDATE relay_inbox
       SET status = 'ready'
     WHERE bundle_id = ${bundleId}
       AND sender_email_hash = ${senderEmailHash}
       AND status = 'pending'
    RETURNING bundle_id
  `) as Array<{ bundle_id: string }>;
  return rows.length > 0;
}

/**
 * Deletes pending rows for a recipient that were never confirmed within the
 * grace window (seconds), so an abandoned upload self-cleans rather than holding
 * a mailbox slot forever. The grace window is set well beyond the presigned-URL
 * lifetime by the caller, so an in-flight upload is never swept. Only the
 * metadata row is removed here, in the failed-upload case there is no R2 object,
 * and in the rare uploaded-but-never-confirmed case the orphaned object is
 * harmless (it was never visible to the recipient).
 */
export async function sweepStalePending(
  recipientEmailHash: string,
  graceSeconds: number,
): Promise<void> {
  const sql = getSql();
  await sql`
    DELETE FROM relay_inbox
     WHERE recipient_email_hash = ${recipientEmailHash}
       AND status = 'pending'
       AND created_at < now() - ${graceSeconds} * interval '1 second'
  `;
}

/**
 * Lists the non-expired, confirmed bundles for a recipient hash, newest first.
 * The status filter (status = 'ready') hides pending rows whose upload has not
 * been confirmed, and the expiry filter (expires_at > now()) hides a row past
 * its TTL even before the sweep deletes it. Metadata only, the sealed bytes are
 * never touched here.
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
      AND status = 'ready'
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
 * Fetches a single confirmed (ready) mailbox row by bundle id, or null if there
 * is no such row. A pending row reads as absent here, so a fetch or an ack
 * against an unconfirmed bundle is rejected exactly like a non-existent one.
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
      AND status = 'ready'
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
 * Counts the non-expired bundles addressed to a recipient hash, of either status
 * (a reserved-but-pending row counts the same as a confirmed one). The send route
 * uses this to enforce a per-recipient mailbox quota, counting reservations means
 * a burst of unconfirmed sends cannot slip past the quota before the grace-window
 * sweep reclaims them. Together with the per-IP rate limit this also bounds how
 * many replays of a captured send request could land within the 5-minute
 * signature window.
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
