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
 * Re-inserts the canonical 4-char-group spacing into a compact (space-free)
 * fingerprint, matching how fingerprints are stored in directory_profiles /
 * directory_identities ("aaaa bbbb cccc"). Mirrors the /researcher route.
 */
function groupFingerprint(compact: string): string {
  const groups: string[] = [];
  for (let i = 0; i < compact.length; i += 4) {
    groups.push(compact.slice(i, i + 4));
  }
  return groups.join(" ");
}

/**
 * Fetches the DELIVERY binding for a published researcher by their fingerprint, or
 * null if the fingerprint has no published profile. The reverse of getBindingByHash
 * keyed by fingerprint, joined to directory_profiles so it only resolves someone
 * who has an account on the network (the join also disambiguates, profile PK is the
 * fingerprint). This powers the no-email fingerprint-routed sealed send: the relay
 * resolves a recipient to their mailbox hash (emailHash) WITHOUT the sender ever
 * knowing the recipient's email.
 *
 * DELIVERY does NOT filter unlisted (hide-only model, Grant 2026-06-15): unlisting
 * hides a profile from DISCOVERY (search, institution lists, public-search), but a
 * sender who already holds the exact fingerprint can still deliver. The unlisted
 * filter lives on the discovery queries (searchPublicProfiles, getInstitutionByDomain),
 * not on this delivery resolver. Lookup-by-fingerprint is exact-match only, so this
 * is not an enumeration surface.
 *
 * The input may be the compact (space-free) or already-grouped fingerprint; it is
 * normalized to the stored grouped form. Exact match only, never a prefix. The
 * keyBackupBlob is loaded for shape parity but callers must never expose it.
 */
export async function getBindingByFingerprint(
  fingerprint: string,
): Promise<DirectoryBinding | null> {
  const compact = fingerprint.replace(/\s+/g, "").toLowerCase();
  if (!/^[0-9a-f]{8,64}$/.test(compact)) return null;
  const grouped = groupFingerprint(compact);
  const sql = getSql();
  const rows = (await sql`
    SELECT i.email_hash, i.x25519_pub, i.ed25519_pub, i.fingerprint, i.key_backup_blob
    FROM directory_identities i
    JOIN directory_profiles p ON p.fingerprint = i.fingerprint
    WHERE i.fingerprint = ${grouped}
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
 * Fetches the current binding for an Ed25519 public key (hex), or null if none.
 * This is the reverse of getBindingByHash: the DO stores only the owner_pubkey
 * (the Ed25519 signing key), so the /api/collab/doc-size route uses this to
 * resolve a pubkey to the email_hash that the billing layer keys by. Exact
 * column match only, the table is not enumerable via a prefix query.
 */
export async function getBindingByPubkey(
  pubkeyHex: string,
): Promise<DirectoryBinding | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT email_hash, x25519_pub, ed25519_pub, fingerprint, key_backup_blob
    FROM directory_identities
    WHERE ed25519_pub = ${pubkeyHex}
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
 * index. Idempotent, safe to call on every request.
 *
 * NOTE: directory_profiles.fingerprint is NOT a FK to directory_identities.
 * `directory_identities.fingerprint` is a plain (non-unique) column, only
 * `email_hash` is its primary key, so a foreign key referencing it is invalid
 * and CREATE TABLE fails with Postgres 42830 ("no unique constraint matching
 * given keys"), which 500'd every /api/admin/* and directory call. The profile
 * is keyed by its own fingerprint PK and rows are deleted explicitly
 * (deleteProfile), so no cascade is needed.
 */
export async function ensureProfileSchema(): Promise<void> {
  const sql = getSql();
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  await sql`
    CREATE TABLE IF NOT EXISTS directory_profiles (
      fingerprint        text primary key,
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
  // unlisted: opt-OUT of the public researcher search (the /network hub). Default
  // false = listed-by-default, the locked social-layer decision, so existing rows
  // read as listed. The public-search route filters WHERE unlisted = false; the
  // authed searchProfiles ignores it (a signed user can find anyone, as before).
  await sql`ALTER TABLE directory_profiles ADD COLUMN IF NOT EXISTS unlisted boolean NOT NULL DEFAULT false`;
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

/** A single result row of the PUBLIC researcher search (the /network hub). */
export interface PublicProfileResult {
  fingerprint: string;
  displayName: string;
  affiliation: string | null;
  /** The verified institutional email domain (e.g. wisc.edu), or null. */
  verifiedDomain: string | null;
  orcid: string | null;
}

/**
 * A public institution page (the /institution/[slug] hub), DERIVED from verified
 * email-domain clusters. There is no curated institution entity in the directory;
 * an "institution" is simply the set of listed researchers who proved the same
 * affiliation_domain. So the slug, name, and domain are all the verified domain,
 * logoUrl is null (no curated branding yet), departments are the distinct
 * affiliations seen in the cluster, and members are the listed profiles.
 */
export interface InstitutionCluster {
  slug: string;
  name: string;
  domain: string;
  logoUrl: string | null;
  departments: string[];
  memberCount: number;
  members: PublicProfileResult[];
}

/**
 * PUBLIC, unauthenticated institution page, derived from a verified-domain
 * cluster. Returns the LISTED researchers (unlisted = false) whose verified
 * affiliation_domain equals `domain`, or null when no listed member shares it
 * (the route renders that as found:false). Never returns email or keys, same as
 * searchPublicProfiles. The route adds the public gate + IP rate limits.
 */
export async function getInstitutionByDomain(
  domain: string,
): Promise<InstitutionCluster | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT
      p.fingerprint,
      p.display_name,
      p.affiliation,
      p.affiliation_domain,
      p.orcid
    FROM directory_profiles p
    WHERE p.unlisted = false
      AND lower(p.affiliation_domain) = lower(${domain})
    ORDER BY lower(p.display_name)
  `) as Array<{
    fingerprint: string;
    display_name: string;
    affiliation: string | null;
    affiliation_domain: string | null;
    orcid: string | null;
  }>;

  if (rows.length === 0) return null;

  const members: PublicProfileResult[] = rows.map((r) => ({
    fingerprint: r.fingerprint,
    displayName: r.display_name,
    affiliation: r.affiliation,
    verifiedDomain: r.affiliation_domain,
    orcid: r.orcid,
  }));

  // Distinct, non-empty affiliations become the department list (stable order).
  const departments = Array.from(
    new Set(
      members
        .map((m) => (m.affiliation || "").trim())
        .filter((a) => a.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b));

  // The canonical domain is what members actually proved (preserves real case),
  // falling back to the queried value. slug = name = domain for the derived v1.
  const canonicalDomain = rows[0].affiliation_domain || domain;

  return {
    slug: canonicalDomain,
    name: canonicalDomain,
    domain: canonicalDomain,
    logoUrl: null,
    departments,
    memberCount: members.length,
    members,
  };
}

/**
 * PUBLIC, unauthenticated researcher search for the /network hub. Same trigram
 * match as searchProfiles, but with three deliberate differences from the authed
 * search:
 *   1. Filters WHERE unlisted = false, so an opted-out researcher never appears.
 *   2. Returns ONLY directory-safe fields, no public key material and no email,
 *      so it cannot be harvested into a sealing/contact corpus.
 *   3. No join to directory_identities (the keys live there), keeping the row
 *      strictly to what a public profile card shows.
 * The route layer adds the public gate (isSharingEnabled + isSocialLayerEnabled),
 * IP rate limits, and the min/max query-length check.
 */
export async function searchPublicProfiles(
  query: string,
  limit: number = 20,
): Promise<PublicProfileResult[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT
      p.fingerprint,
      p.display_name,
      p.affiliation,
      p.affiliation_domain,
      p.orcid
    FROM directory_profiles p
    WHERE p.unlisted = false
      AND (lower(p.display_name) || ' ' || lower(coalesce(p.affiliation, '')))
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
  }>;

  return rows.map((r) => ({
    fingerprint: r.fingerprint,
    displayName: r.display_name,
    affiliation: r.affiliation,
    verifiedDomain: r.affiliation_domain,
    orcid: r.orcid,
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
// Lab directory (lab-search-bot, 2026-06-09)
//
// Two new tables:
//   directory_labs         -- one row per lab, PI opts into listed=true
//   directory_lab_requests -- pending join requests from researchers
//
// Both tables are additive (CREATE TABLE IF NOT EXISTS). No ALTER on existing
// tables. All writes are best-effort at the call site (a failure here must
// not block lab creation or the join request UX).
// ---------------------------------------------------------------------------

/** A lab directory listing row, as stored. */
export interface LabListing {
  labId: string;
  name: string;
  institution: string | null;
  piEmailHash: string;
  piDisplayName: string;
  memberCount: number;
  listed: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The public shape returned to a browser searching the directory. */
export interface LabListingPublic {
  labId: string;
  name: string;
  institution: string | null;
  piName: string;
  memberCount: number;
}

/** A join request row, as stored. */
export interface LabJoinRequest {
  labId: string;
  requesterEmailHash: string;
  requesterPubkey: string;
  requesterName: string;
  status: "pending" | "approved" | "declined";
  createdAt: string;
}

/**
 * Creates the directory_labs and directory_lab_requests tables if they do
 * not already exist. Idempotent; every route handler calls this on entry.
 */
export async function ensureLabsSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS directory_labs (
      lab_id           text primary key,
      name             text not null,
      institution      text,
      pi_email_hash    text not null,
      pi_display_name  text not null,
      member_count     int  not null default 1,
      listed           bool not null default false,
      created_at       timestamptz default now(),
      updated_at       timestamptz default now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_labs_pi_email_hash
      ON directory_labs(pi_email_hash)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS directory_lab_requests (
      id                    bigserial primary key,
      lab_id                text not null,
      requester_email_hash  text not null,
      requester_pubkey      text not null,
      requester_name        text not null,
      status                text not null default 'pending',
      created_at            timestamptz default now(),
      UNIQUE (lab_id, requester_email_hash)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_lab_requests_lab_id
      ON directory_lab_requests(lab_id)
  `;
}

/**
 * Inserts or updates the directory row for a lab. Safe to call on lab
 * creation (listed=false by default) or on any metadata update. Does NOT
 * flip the listed flag; that is done by setLabListed.
 */
export async function upsertLabListing(params: {
  labId: string;
  name: string;
  institution: string | null;
  piEmailHash: string;
  piDisplayName: string;
  memberCount: number;
}): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO directory_labs
      (lab_id, name, institution, pi_email_hash, pi_display_name, member_count,
       listed, updated_at)
    VALUES
      (${params.labId}, ${params.name}, ${params.institution},
       ${params.piEmailHash}, ${params.piDisplayName}, ${params.memberCount},
       false, now())
    ON CONFLICT (lab_id) DO UPDATE SET
      name             = EXCLUDED.name,
      institution      = EXCLUDED.institution,
      pi_email_hash    = EXCLUDED.pi_email_hash,
      pi_display_name  = EXCLUDED.pi_display_name,
      member_count     = EXCLUDED.member_count,
      updated_at       = now()
  `;
}

/**
 * Sets the listed flag for a lab. The PI explicitly opts in (listed=true)
 * or out (listed=false); the default at creation time is false.
 */
export async function setLabListed(
  labId: string,
  listed: boolean,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE directory_labs
    SET listed = ${listed}, updated_at = now()
    WHERE lab_id = ${labId}
  `;
}

/**
 * Returns the directory row for a single lab, or null when none exists.
 */
export async function getLabListing(
  labId: string,
): Promise<LabListing | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT lab_id, name, institution, pi_email_hash, pi_display_name,
           member_count, listed, created_at, updated_at
    FROM directory_labs
    WHERE lab_id = ${labId}
    LIMIT 1
  `) as Array<{
    lab_id: string;
    name: string;
    institution: string | null;
    pi_email_hash: string;
    pi_display_name: string;
    member_count: number;
    listed: boolean;
    created_at: string;
    updated_at: string;
  }>;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    labId: r.lab_id,
    name: r.name,
    institution: r.institution,
    piEmailHash: r.pi_email_hash,
    piDisplayName: r.pi_display_name,
    memberCount: r.member_count,
    listed: r.listed,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Searches listed labs by name or institution. Query is a LIKE search over
 * both columns (case-insensitive). Returns at most limit results.
 * Only rows with listed=true are returned; unlisted labs are invisible.
 */
export async function searchListedLabs(
  query: string,
  limit: number = 20,
): Promise<LabListingPublic[]> {
  const sql = getSql();
  const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
  const rows = (await sql`
    SELECT lab_id, name, institution, pi_display_name, member_count
    FROM directory_labs
    WHERE listed = true
      AND (lower(name) LIKE lower(${pattern})
           OR lower(coalesce(institution, '')) LIKE lower(${pattern}))
    ORDER BY name ASC
    LIMIT ${limit}
  `) as Array<{
    lab_id: string;
    name: string;
    institution: string | null;
    pi_display_name: string;
    member_count: number;
  }>;
  return rows.map((r) => ({
    labId: r.lab_id,
    name: r.name,
    institution: r.institution,
    piName: r.pi_display_name,
    memberCount: r.member_count,
  }));
}

/**
 * Records a join request for a lab. Idempotent per (labId, requesterEmailHash):
 * a second request from the same requester resets status to 'pending' so a
 * declined researcher can re-apply.
 */
export async function upsertLabJoinRequest(params: {
  labId: string;
  requesterEmailHash: string;
  requesterPubkey: string;
  requesterName: string;
}): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO directory_lab_requests
      (lab_id, requester_email_hash, requester_pubkey, requester_name, status)
    VALUES
      (${params.labId}, ${params.requesterEmailHash},
       ${params.requesterPubkey}, ${params.requesterName}, 'pending')
    ON CONFLICT (lab_id, requester_email_hash) DO UPDATE SET
      requester_pubkey = EXCLUDED.requester_pubkey,
      requester_name   = EXCLUDED.requester_name,
      status           = 'pending'
  `;
}

/**
 * Returns all pending join requests for a given lab. The PI endpoint uses
 * this; only pending rows are returned (approved/declined are already done).
 */
export async function getPendingJoinRequests(
  labId: string,
): Promise<LabJoinRequest[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT lab_id, requester_email_hash, requester_pubkey, requester_name,
           status, created_at
    FROM directory_lab_requests
    WHERE lab_id = ${labId} AND status = 'pending'
    ORDER BY created_at ASC
  `) as Array<{
    lab_id: string;
    requester_email_hash: string;
    requester_pubkey: string;
    requester_name: string;
    status: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    labId: r.lab_id,
    requesterEmailHash: r.requester_email_hash,
    requesterPubkey: r.requester_pubkey,
    requesterName: r.requester_name,
    status: r.status as "pending",
    createdAt: r.created_at,
  }));
}

/**
 * Resolves a join request to approved or declined. Called by the PI after
 * reviewing. The caller is responsible for issuing an invite link when
 * action is 'approve'.
 */
export async function resolveLabJoinRequest(
  labId: string,
  requesterEmailHash: string,
  action: "approve" | "decline",
): Promise<void> {
  const sql = getSql();
  const newStatus = action === "approve" ? "approved" : "declined";
  await sql`
    UPDATE directory_lab_requests
    SET status = ${newStatus}
    WHERE lab_id = ${labId}
      AND requester_email_hash = ${requesterEmailHash}
  `;
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

// ---------------------------------------------------------------------------
// Beta-tester broadcast list (admin broadcast feature)
// ---------------------------------------------------------------------------

export async function ensureBetaTestersSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS beta_testers (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      added_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

export interface BetaTester {
  id: number;
  email: string;
  name: string | null;
  addedAt: string;
}

export async function listBetaTesters(): Promise<BetaTester[]> {
  const sql = getSql();
  await ensureBetaTestersSchema();
  const rows = (await sql`
    SELECT id, email, name, added_at
    FROM beta_testers
    ORDER BY added_at DESC
  `) as Array<{ id: number; email: string; name: string | null; added_at: string }>;
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    addedAt: r.added_at,
  }));
}

export async function addBetaTester(
  email: string,
  name?: string,
): Promise<BetaTester> {
  const sql = getSql();
  await ensureBetaTestersSchema();
  const rows = (await sql`
    INSERT INTO beta_testers (email, name)
    VALUES (${email.trim().toLowerCase()}, ${name?.trim() || null})
    ON CONFLICT (email) DO UPDATE SET name = COALESCE(EXCLUDED.name, beta_testers.name)
    RETURNING id, email, name, added_at
  `) as Array<{ id: number; email: string; name: string | null; added_at: string }>;
  return {
    id: rows[0].id,
    email: rows[0].email,
    name: rows[0].name,
    addedAt: rows[0].added_at,
  };
}

export async function removeBetaTester(id: number): Promise<void> {
  const sql = getSql();
  await ensureBetaTestersSchema();
  await sql`DELETE FROM beta_testers WHERE id = ${id}`;
}
