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
 * Overwrites a mailbox row's stored size with the authoritative byte size the
 * relay read back from R2 after the upload (see headObjectSize). The send route
 * stores the sender's SIGNED size claim at reservation time, this corrects it to
 * the real object size at confirm so the per-recipient byte budget can never be
 * gamed by a false claim. Scoped to the bundle id only, the confirm route already
 * proved sender ownership via markInboxEntryReady before calling this.
 */
export async function updateInboxSize(
  bundleId: string,
  sizeBytes: number,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE relay_inbox
       SET size_bytes = ${sizeBytes}
     WHERE bundle_id = ${bundleId}
  `;
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
 * Sums the stored bytes of a recipient's non-expired bundles, of either status
 * (a reserved-but-pending row counts the same as a confirmed one, mirroring
 * countInboxByRecipient). The send route uses this to enforce the FREE_STORAGE_BYTES
 * budget, summing reservations means a burst of unconfirmed large sends cannot slip
 * past the byte budget before the grace-window sweep reclaims them. Rows with a null
 * size_bytes contribute zero (coalesced in SQL). Returns a number, the bigint sum is
 * coerced the same way mapRow coerces a single size.
 */
export async function sumPendingBytesByRecipient(
  recipientEmailHash: string,
): Promise<number> {
  const sql = getSql();
  const rows = (await sql`
    SELECT coalesce(sum(size_bytes), 0)::bigint AS total
    FROM relay_inbox
    WHERE recipient_email_hash = ${recipientEmailHash}
      AND expires_at > now()
  `) as Array<{ total: number | string | null }>;
  const total = rows[0]?.total;
  return total == null ? 0 : Number(total);
}

// ---------------------------------------------------------------------------
// PENDING INVITE rows (the invite-a-non-user growth loop).
//
// An invite parks a bundle for a person who has NO ResearchOS identity yet, so
// it cannot live in relay_inbox (which is addressed by a registered recipient
// key hash and picked up with that key). A pending-invite row instead is
// addressed by a server-generated invite_id, which doubles as the R2 object key
// and is the bearer capability the accept page presents to fetch the parked
// bytes. The row holds ONLY metadata, the peppered recipient and sender email
// hashes, the size, and the timing. It NEVER holds the one-time symmetric key
// (that travels only in the accept-link fragment, see encryption.ts) and never
// a plaintext email.
//
// CONFIRM-AFTER-UPLOAD, mirrored from relay_inbox. The send route inserts the
// row as "pending" (the invite id and presigned PUT are needed before the
// upload can happen), and only after the client has PUT the sealed bytes does a
// signed confirm flip it to "ready" and trigger the branded email. A fetch
// returns "ready" rows only, so an abandoned upload never produces a dead
// accept link. Pending invites carry the same 30-day TTL as a normal share.
// ---------------------------------------------------------------------------

/** A pending-invite row as stored. inviteId is the R2 object key + bearer id. */
export interface InviteEntry {
  inviteId: string;
  recipientEmailHash: string;
  senderEmailHash: string;
  sizeBytes: number | null;
  createdAt: string;
  expiresAt: string;
}

/** The fields needed to create a pending-invite row. createdAt defaults to now(). */
export interface NewInviteEntry {
  inviteId: string;
  recipientEmailHash: string;
  senderEmailHash: string;
  sizeBytes: number | null;
  expiresAt: string;
}

/**
 * Creates the pending-invite table if it does not already exist, plus an index
 * on sender_email_hash so the per-sender invite rate accounting is a cheap
 * indexed scan. Idempotent, so every invite route can call it on entry without a
 * migration step. Kept separate from relay_inbox because the addressing and the
 * pickup model differ (invite_id bearer vs registered recipient key).
 */
export async function ensureInviteSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS relay_invite (
      invite_id text primary key,
      recipient_email_hash text not null,
      sender_email_hash text not null,
      size_bytes bigint,
      status text not null default 'pending',
      created_at timestamptz default now(),
      expires_at timestamptz not null
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS relay_invite_sender_idx
      ON relay_invite (sender_email_hash)
  `;
}

/**
 * Inserts a new pending-invite row. invite_id is the primary key and a
 * server-generated UUID, so a collision is effectively impossible, but the
 * insert is plain (no upsert) so any reuse surfaces as an error rather than
 * clobbering an existing row. The row lands as "pending" and stays unfetchable
 * (and unemailed) until a confirm flips it to "ready".
 */
export async function insertInviteEntry(entry: NewInviteEntry): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO relay_invite
      (invite_id, recipient_email_hash, sender_email_hash, size_bytes, status,
       expires_at)
    VALUES
      (${entry.inviteId}, ${entry.recipientEmailHash}, ${entry.senderEmailHash},
       ${entry.sizeBytes}, 'pending', ${entry.expiresAt})
  `;
}

/**
 * Flips a pending invite to "ready" after the sender has uploaded the sealed
 * bytes, scoped to the sender that reserved it so one user cannot confirm
 * another's invite. The condition also requires status = 'pending', so the
 * update is a no-op on an already-ready row (a duplicate confirm) or a swept
 * one. Returns the flipped row's metadata (so the confirm route can build the
 * email) or null if no matching pending row was flipped.
 */
export async function markInviteReady(
  inviteId: string,
  senderEmailHash: string,
): Promise<InviteEntry | null> {
  const sql = getSql();
  const rows = (await sql`
    UPDATE relay_invite
       SET status = 'ready'
     WHERE invite_id = ${inviteId}
       AND sender_email_hash = ${senderEmailHash}
       AND status = 'pending'
    RETURNING invite_id, recipient_email_hash, sender_email_hash, size_bytes,
              created_at, expires_at
  `) as Array<{
    invite_id: string;
    recipient_email_hash: string;
    sender_email_hash: string;
    size_bytes: number | string | null;
    created_at: string;
    expires_at: string;
  }>;
  if (rows.length === 0) return null;
  return mapInviteRow(rows[0]);
}

/**
 * Fetches a single ready invite by id, or null if there is no such ready row. A
 * pending row reads as absent, so a fetch against an unconfirmed invite is
 * rejected exactly like a non-existent one. Returns the row regardless of expiry
 * so the fetch route can detect an expired invite, sweep it, and return a clean
 * 410 rather than a confusing 404. There is no ownership check here, the invite
 * id IS the bearer capability the accept page presents (the recipient has no key
 * yet), which is exactly the keyless-invite trust model.
 */
export async function getInviteEntry(
  inviteId: string,
): Promise<InviteEntry | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT invite_id, recipient_email_hash, sender_email_hash, size_bytes,
           created_at, expires_at
    FROM relay_invite
    WHERE invite_id = ${inviteId}
      AND status = 'ready'
    LIMIT 1
  `) as Array<{
    invite_id: string;
    recipient_email_hash: string;
    sender_email_hash: string;
    size_bytes: number | string | null;
    created_at: string;
    expires_at: string;
  }>;
  if (rows.length === 0) return null;
  return mapInviteRow(rows[0]);
}

/**
 * Overwrites a pending-invite row's stored size with the authoritative byte size
 * read back from R2 after the upload (see headObjectSize). Mirrors
 * updateInboxSize for the invite path so the stored figure reflects the real
 * object rather than the sender's signed claim. Scoped to the invite id only, the
 * confirm route already proved sender ownership via markInviteReady first.
 */
export async function updateInviteSize(
  inviteId: string,
  sizeBytes: number,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE relay_invite
       SET size_bytes = ${sizeBytes}
     WHERE invite_id = ${inviteId}
  `;
}

/**
 * Deletes a pending-invite row by id. Called on accept (delete-on-pickup, after
 * the recipient has filed the data locally) and when sweeping an expired or
 * abandoned invite. Idempotent at the SQL level, deleting a missing row is a
 * no-op.
 */
export async function deleteInviteEntry(inviteId: string): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM relay_invite WHERE invite_id = ${inviteId}`;
}

/**
 * Counts the non-expired invites a sender has outstanding (of either status, so
 * a reserved-but-pending invite counts the same as a confirmed one). The send
 * route uses this as a secondary per-sender ceiling alongside the Upstash rate
 * limit, so a sender cannot park an unbounded backlog of pending invites even
 * within the rate window. A swept or accepted invite stops counting.
 */
export async function countInvitesBySender(
  senderEmailHash: string,
): Promise<number> {
  const sql = getSql();
  const rows = (await sql`
    SELECT count(*)::int AS n
    FROM relay_invite
    WHERE sender_email_hash = ${senderEmailHash}
      AND expires_at > now()
  `) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/**
 * Sums the stored bytes of a RECIPIENT hash's non-expired invites (of either
 * status, so a reserved-but-pending invite counts the same as a confirmed one,
 * mirroring sumPendingBytesByRecipient on the inbox side). The invite send route
 * uses this to enforce the INVITE_FREE_STORAGE_BYTES budget. Summing reservations
 * means a burst of unconfirmed large invites cannot slip past the byte budget
 * before the grace-window sweep reclaims them. Keyed by recipient_email_hash (not
 * sender) so the ceiling bounds total sealed bytes parked FOR one address across
 * every sender that targets it, matching the send path's abuse model. Rows with a
 * null size_bytes contribute zero (coalesced in SQL). The bigint sum is coerced to
 * a number the same way mapInviteRow coerces a single size.
 */
export async function sumPendingInviteBytesByRecipient(
  recipientEmailHash: string,
): Promise<number> {
  const sql = getSql();
  const rows = (await sql`
    SELECT coalesce(sum(size_bytes), 0)::bigint AS total
    FROM relay_invite
    WHERE recipient_email_hash = ${recipientEmailHash}
      AND expires_at > now()
  `) as Array<{ total: number | string | null }>;
  const total = rows[0]?.total;
  return total == null ? 0 : Number(total);
}

/** Normalizes a raw pending-invite DB row into an InviteEntry. */
function mapInviteRow(r: {
  invite_id: string;
  recipient_email_hash: string;
  sender_email_hash: string;
  size_bytes: number | string | null;
  created_at: string;
  expires_at: string;
}): InviteEntry {
  return {
    inviteId: r.invite_id,
    recipientEmailHash: r.recipient_email_hash,
    senderEmailHash: r.sender_email_hash,
    sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  };
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

// ---------------------------------------------------------------------------
// Operator metrics (aggregate only; powers /admin)
// ---------------------------------------------------------------------------

export interface RelayMetrics {
  /** Live pending shares (uploaded, not yet picked up, not expired). */
  pendingShares: number;
  /** Total bytes held by those live pending shares. */
  pendingBytes: number;
  /** Every inbox row ever created (cumulative sends, incl. picked-up/expired). */
  totalEverSent: number;
}

/** Aggregate relay volume for the operator dashboard. No content, no metadata. */
export async function getRelayMetrics(): Promise<RelayMetrics> {
  const sql = getSql();
  const liveRows = (await sql`
    SELECT count(*)::int AS n, coalesce(sum(size_bytes), 0)::bigint AS bytes
    FROM relay_inbox
    WHERE status = 'ready' AND expires_at > now()
  `) as Array<{ n: number; bytes: string | number }>;
  const totalRows = (await sql`
    SELECT count(*)::int AS n FROM relay_inbox
  `) as Array<{ n: number }>;
  return {
    pendingShares: liveRows[0]?.n ?? 0,
    pendingBytes: Number(liveRows[0]?.bytes ?? 0),
    totalEverSent: totalRows[0]?.n ?? 0,
  };
}
