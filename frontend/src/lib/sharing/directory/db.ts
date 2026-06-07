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

// ---------------------------------------------------------------------------
// ORCID link table (section 18.7, hybrid ORCID login)
// ---------------------------------------------------------------------------

/**
 * Creates the directory_orcid_links table and its index if they do not exist.
 * Idempotent; safe to call on every request. Must be called after ensureSchema
 * because the table is standalone (no FK), but call order is consistent with
 * the routes that use it.
 *
 * The ORCID iD is a public identifier stored as-is. The table never holds a
 * plaintext email, only the peppered email hash, so it is consistent with the
 * privacy posture of the rest of the directory.
 */
export async function ensureOrcidSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS directory_orcid_links (
      orcid_id   text primary key,
      email_hash text not null,
      created_at timestamptz default now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_orcid_links_email_hash
      ON directory_orcid_links(email_hash)
  `;
}

/**
 * Links an ORCID iD to an email hash. On conflict (same orcid_id) the email
 * hash is updated to the new value, so a user who changes their primary email
 * and re-verifies stays linked correctly.
 */
export async function linkOrcid(
  orcidId: string,
  emailHash: string,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO directory_orcid_links (orcid_id, email_hash)
    VALUES (${orcidId}, ${emailHash})
    ON CONFLICT (orcid_id) DO UPDATE SET email_hash = EXCLUDED.email_hash
  `;
}

/**
 * Resolves the email hash for a given ORCID iD, or null if no link exists.
 * Exact primary-key match only, never a prefix or LIKE.
 */
export async function getEmailHashByOrcid(
  orcidId: string,
): Promise<string | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT email_hash
    FROM directory_orcid_links
    WHERE orcid_id = ${orcidId}
    LIMIT 1
  `) as Array<{ email_hash: string }>;
  if (rows.length === 0) return null;
  return rows[0].email_hash;
}

// ---------------------------------------------------------------------------
// Profile table (section 17, opt-in public directory)
// ---------------------------------------------------------------------------

/**
 * A researcher profile row. Keyed by fingerprint (the public Ed25519 key
 * fingerprint), never by email. The affiliationDomain field carries the
 * verified institutional email domain (e.g. wisc.edu), or null when the OAuth
 * session email is a consumer provider.
 */
export interface DirectoryProfile {
  fingerprint: string;
  displayName: string;
  affiliation: string | null;
  affiliationDomain: string | null;
  orcid: string | null;
  pinnedWorks: string[];
  hiddenWorks: string[];
  /**
   * Whether the user wants an email nudge when invited to collaborate. Stored so
   * the notify-invite route can read the recipient's preference at send time
   * (the sender triggers the email, the recipient's preference decides whether
   * it goes out). Defaults to true; an old row predating the column reads as
   * true via the column default below.
   */
  notifyOnCollabInvite: boolean;
  updatedAt?: string;
}

/**
 * A profile search result extends the profile row with the public key material
 * the caller needs to seal a message to the researcher.
 */
export interface ProfileSearchResult extends DirectoryProfile {
  x25519PublicKey: string;
  ed25519PublicKey: string;
}

/** Splits a nullable comma-joined put-code string into an array, filtering empty. */
function splitCodes(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

/**
 * Creates the directory_profiles table and the pg_trgm-backed trigram search
 * index. Idempotent, safe to call on every request. Must be called AFTER
 * ensureSchema because directory_profiles has a FK to directory_identities.
 */
export async function ensureProfileSchema(): Promise<void> {
  const sql = getSql();
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  await sql`
    CREATE TABLE IF NOT EXISTS directory_profiles (
      fingerprint        text primary key references directory_identities(fingerprint) on delete cascade,
      display_name       text not null,
      affiliation        text,
      affiliation_domain text,
      orcid              text,
      updated_at         timestamptz default now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_profiles_search ON directory_profiles
      USING GIN ((lower(display_name) || ' ' || lower(coalesce(affiliation,''))) gin_trgm_ops)
  `;
  // Additive migrations for columns that may not exist on older tables.
  await sql`ALTER TABLE directory_profiles ADD COLUMN IF NOT EXISTS hidden_works text`;
  await sql`ALTER TABLE directory_profiles ADD COLUMN IF NOT EXISTS pinned_works text`;
  // notify_on_collab_invite defaults to true so any row that predates the column
  // reads as opted-in, which is the backward-safe default for the preference.
  await sql`ALTER TABLE directory_profiles ADD COLUMN IF NOT EXISTS notify_on_collab_invite boolean NOT NULL DEFAULT true`;
}

/**
 * Inserts or updates the profile row for a fingerprint. The affiliation_domain
 * is set by the server from the OAuth session email, the caller cannot inject
 * an arbitrary value.
 */
export async function upsertProfile(profile: DirectoryProfile): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO directory_profiles
      (fingerprint, display_name, affiliation, affiliation_domain, orcid,
       hidden_works, pinned_works, notify_on_collab_invite, updated_at)
    VALUES
      (${profile.fingerprint}, ${profile.displayName}, ${profile.affiliation},
       ${profile.affiliationDomain}, ${profile.orcid},
       ${profile.hiddenWorks.join(",")}, ${profile.pinnedWorks.join(",")},
       ${profile.notifyOnCollabInvite}, now())
    ON CONFLICT (fingerprint) DO UPDATE SET
      display_name            = EXCLUDED.display_name,
      affiliation             = EXCLUDED.affiliation,
      affiliation_domain      = EXCLUDED.affiliation_domain,
      orcid                   = EXCLUDED.orcid,
      hidden_works            = EXCLUDED.hidden_works,
      pinned_works            = EXCLUDED.pinned_works,
      notify_on_collab_invite = EXCLUDED.notify_on_collab_invite,
      updated_at              = now()
  `;
}

/**
 * Removes a profile row. The binding row in directory_identities is NOT
 * removed; the user keeps their registered identity but opts out of the public
 * directory.
 */
export async function deleteProfile(fp: string): Promise<void> {
  const sql = getSql();
  await sql`
    DELETE FROM directory_profiles WHERE fingerprint = ${fp}
  `;
}

/**
 * Trigram-similarity search over the lowered display_name + affiliation index.
 * Returns at most limit rows (default 20). Joins to directory_identities to
 * include the public key material without a second query. Email is never
 * returned.
 */
export async function searchProfiles(
  query: string,
  limit: number = 20,
): Promise<ProfileSearchResult[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT
      p.fingerprint,
      p.display_name,
      p.affiliation,
      p.affiliation_domain,
      p.orcid,
      p.hidden_works,
      p.pinned_works,
      p.notify_on_collab_invite,
      p.updated_at,
      i.x25519_pub,
      i.ed25519_pub
    FROM directory_profiles p
    JOIN directory_identities i USING (fingerprint)
    WHERE (lower(p.display_name) || ' ' || lower(coalesce(p.affiliation, '')))
          % lower(${query})
    ORDER BY
      similarity(
        lower(p.display_name) || ' ' || lower(coalesce(p.affiliation, '')),
        lower(${query})
      ) DESC
    LIMIT ${limit}
  `) as Array<{
    fingerprint: string;
    display_name: string;
    affiliation: string | null;
    affiliation_domain: string | null;
    orcid: string | null;
    hidden_works: string | null;
    pinned_works: string | null;
    notify_on_collab_invite: boolean | null;
    updated_at: string;
    x25519_pub: string;
    ed25519_pub: string;
  }>;

  return rows.map((r) => ({
    fingerprint: r.fingerprint,
    displayName: r.display_name,
    affiliation: r.affiliation,
    affiliationDomain: r.affiliation_domain,
    orcid: r.orcid,
    hiddenWorks: splitCodes(r.hidden_works),
    pinnedWorks: splitCodes(r.pinned_works),
    notifyOnCollabInvite: r.notify_on_collab_invite ?? true,
    updatedAt: r.updated_at,
    x25519PublicKey: r.x25519_pub,
    ed25519PublicKey: r.ed25519_pub,
  }));
}

/**
 * Fetches a single profile by fingerprint, or null if no profile exists.
 * Does not return public key material; this is typically used to GET the
 * session user's own profile.
 */
export async function getProfileByFingerprint(
  fp: string,
): Promise<DirectoryProfile | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT fingerprint, display_name, affiliation, affiliation_domain, orcid,
           hidden_works, pinned_works, notify_on_collab_invite, updated_at
    FROM directory_profiles
    WHERE fingerprint = ${fp}
    LIMIT 1
  `) as Array<{
    fingerprint: string;
    display_name: string;
    affiliation: string | null;
    affiliation_domain: string | null;
    orcid: string | null;
    hidden_works: string | null;
    pinned_works: string | null;
    notify_on_collab_invite: boolean | null;
    updated_at: string;
  }>;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    fingerprint: r.fingerprint,
    displayName: r.display_name,
    affiliation: r.affiliation,
    affiliationDomain: r.affiliation_domain,
    orcid: r.orcid,
    hiddenWorks: splitCodes(r.hidden_works),
    pinnedWorks: splitCodes(r.pinned_works),
    // A null (column absent on a very old row before the migration ran) reads as
    // the default true.
    notifyOnCollabInvite: r.notify_on_collab_invite ?? true,
    updatedAt: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Operator metrics (aggregate only, never per-user; powers /admin)
// ---------------------------------------------------------------------------

export interface DirectoryMetrics {
  totalIdentities: number;
  totalProfiles: number;
  orcidLinks: number;
  signupsByMonth: { month: string; count: number }[];
  profilesByDomain: { domain: string; count: number }[];
}

/**
 * Aggregate directory stats for the operator dashboard. Counts only, never any
 * email or per-user data (the directory only stores peppered hashes anyway).
 */
export async function getDirectoryMetrics(): Promise<DirectoryMetrics> {
  const sql = getSql();

  const idRows = (await sql`
    SELECT count(*)::int AS n FROM directory_identities
  `) as Array<{ n: number }>;
  const profRows = (await sql`
    SELECT count(*)::int AS n FROM directory_profiles
  `) as Array<{ n: number }>;
  const orcidRows = (await sql`
    SELECT count(*)::int AS n FROM directory_orcid_links
  `) as Array<{ n: number }>;

  const signupRows = (await sql`
    SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
           count(*)::int AS count
    FROM directory_identities
    GROUP BY 1
    ORDER BY 1
  `) as Array<{ month: string; count: number }>;

  const domainRows = (await sql`
    SELECT affiliation_domain AS domain, count(*)::int AS count
    FROM directory_profiles
    WHERE affiliation_domain IS NOT NULL
    GROUP BY 1
    ORDER BY count DESC, domain ASC
    LIMIT 25
  `) as Array<{ domain: string; count: number }>;

  return {
    totalIdentities: idRows[0]?.n ?? 0,
    totalProfiles: profRows[0]?.n ?? 0,
    orcidLinks: orcidRows[0]?.n ?? 0,
    signupsByMonth: signupRows.map((r) => ({ month: r.month, count: r.count })),
    profilesByDomain: domainRows.map((r) => ({
      domain: r.domain,
      count: r.count,
    })),
  };
}

// ---------------------------------------------------------------------------
// Capacity / cost planning (powers the /admin "Infrastructure" panel)
// ---------------------------------------------------------------------------

/**
 * Total on-disk size of the Neon database in bytes (directory + relay tables
 * share one DATABASE_URL, so this is the whole Neon usage). Used to show how
 * much of the Neon storage ceiling is left before an upgrade is needed.
 */
export async function getDatabaseSizeBytes(): Promise<number> {
  const sql = getSql();
  const rows = (await sql`
    SELECT pg_database_size(current_database()) AS bytes
  `) as Array<{ bytes: string | number }>;
  return Number(rows[0]?.bytes ?? 0);
}

/**
 * Append-only log of outbound emails, one row per successful send. We keep only
 * a coarse kind plus a timestamp, never the recipient, so we can report send
 * volume against the Resend free-tier limits (per-day and per-month) without
 * storing any address. Idempotent so every send site can call it on demand.
 */
export async function ensureEmailLogSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS directory_email_log (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

/**
 * Records one successful outbound email. Best-effort: a logging failure must
 * never break the actual send, so callers wrap this in a try/catch and ignore
 * errors. `kind` is a coarse bucket like "otp" or "share_invite".
 */
export async function recordEmailSent(kind: string): Promise<void> {
  const sql = getSql();
  await ensureEmailLogSchema();
  await sql`INSERT INTO directory_email_log (kind) VALUES (${kind})`;
}

export interface EmailMetrics {
  sentToday: number;
  sentLast30Days: number;
  byKind: { kind: string; count: number }[];
}

/**
 * Outbound email volume for the operator dashboard. "Today" is the trailing
 * 24h (what Resend's per-day cap applies to) and "last 30 days" approximates
 * the monthly cap. Counts only, never any recipient.
 */
export async function getEmailMetrics(): Promise<EmailMetrics> {
  const sql = getSql();
  await ensureEmailLogSchema();

  const todayRows = (await sql`
    SELECT count(*)::int AS n
    FROM directory_email_log
    WHERE sent_at >= now() - interval '24 hours'
  `) as Array<{ n: number }>;

  const monthRows = (await sql`
    SELECT count(*)::int AS n
    FROM directory_email_log
    WHERE sent_at >= now() - interval '30 days'
  `) as Array<{ n: number }>;

  const kindRows = (await sql`
    SELECT kind, count(*)::int AS count
    FROM directory_email_log
    WHERE sent_at >= now() - interval '30 days'
    GROUP BY kind
    ORDER BY count DESC, kind ASC
  `) as Array<{ kind: string; count: number }>;

  return {
    sentToday: todayRows[0]?.n ?? 0,
    sentLast30Days: monthRows[0]?.n ?? 0,
    byKind: kindRows.map((r) => ({ kind: r.kind, count: r.count })),
  };
}

// ---------------------------------------------------------------------------
// Anonymous feature-usage events (powers the /admin "Feature usage" panel)
// ---------------------------------------------------------------------------
//
// One row per anonymous usage event (share sent, profile published, ...). The
// name + props are pre-validated against event-contract.ts before they ever
// reach here, so props only ever holds allow-listed, low-cardinality enum /
// boolean values, never anything per-user. props is jsonb so a new event's
// dimensions need no migration.

export async function ensureEventLogSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS directory_event_log (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      props JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

/**
 * Records one anonymous usage event. `props` must already be sanitized by
 * sanitizeEvent (the route does this). Best-effort, the caller swallows errors
 * so a metrics write can never break the user action that triggered it.
 */
export async function recordAnalyticsEvent(
  name: string,
  props: Record<string, string | boolean>,
): Promise<void> {
  const sql = getSql();
  await ensureEventLogSchema();
  await sql`
    INSERT INTO directory_event_log (name, props)
    VALUES (${name}, ${JSON.stringify(props)}::jsonb)
  `;
}

export interface EventMetrics {
  windowDays: number;
  shareSent: {
    total: number;
    byKind: { kind: string; count: number }[];
    byDestination: { destination: string; count: number }[];
  };
  profilePublished: {
    total: number;
    withOrcid: number;
    withAffiliation: number;
  };
  identityCreated: number;
}

/**
 * Aggregates the last 30 days of usage events for the operator dashboard. Counts
 * and breakdowns only, never any per-user data (there is none in the table).
 */
export async function getEventMetrics(): Promise<EventMetrics> {
  const sql = getSql();
  await ensureEventLogSchema();

  const byKind = (await sql`
    SELECT props->>'kind' AS kind, count(*)::int AS count
    FROM directory_event_log
    WHERE name = 'share_sent' AND created_at >= now() - interval '30 days'
    GROUP BY 1
    ORDER BY count DESC, kind ASC
  `) as Array<{ kind: string | null; count: number }>;

  const byDestination = (await sql`
    SELECT props->>'destination' AS destination, count(*)::int AS count
    FROM directory_event_log
    WHERE name = 'share_sent' AND created_at >= now() - interval '30 days'
    GROUP BY 1
    ORDER BY count DESC, destination ASC
  `) as Array<{ destination: string | null; count: number }>;

  const profileRows = (await sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE props->>'has_orcid' = 'true')::int AS with_orcid,
      count(*) FILTER (WHERE props->>'has_affiliation' = 'true')::int AS with_affiliation
    FROM directory_event_log
    WHERE name = 'profile_published' AND created_at >= now() - interval '30 days'
  `) as Array<{ total: number; with_orcid: number; with_affiliation: number }>;

  const identityRows = (await sql`
    SELECT count(*)::int AS n
    FROM directory_event_log
    WHERE name = 'identity_created' AND created_at >= now() - interval '30 days'
  `) as Array<{ n: number }>;

  const shareTotal = byDestination.reduce((sum, r) => sum + r.count, 0);

  return {
    windowDays: 30,
    shareSent: {
      total: shareTotal,
      byKind: byKind.map((r) => ({ kind: r.kind ?? "unknown", count: r.count })),
      byDestination: byDestination.map((r) => ({
        destination: r.destination ?? "unknown",
        count: r.count,
      })),
    },
    profilePublished: {
      total: profileRows[0]?.total ?? 0,
      withOrcid: profileRows[0]?.with_orcid ?? 0,
      withAffiliation: profileRows[0]?.with_affiliation ?? 0,
    },
    identityCreated: identityRows[0]?.n ?? 0,
  };
}
