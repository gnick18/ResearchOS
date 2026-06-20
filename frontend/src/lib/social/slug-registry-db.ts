// Unified slug registry, Neon persistence (lab-domains Phase 1).
//
// The single source of truth for the global slug namespace. One row per slug,
// across labs, @handles, institutions, and reserved system words, so a lab can
// never claim a slug that already routes somewhere or that a person/institution
// already uses. The pure rules (normalization, reserved set, suggestions) live
// in slug-registry.ts; this module is the thin DB layer that enforces global
// uniqueness via the slug primary key.
//
// Conventions mirror lib/sharing/directory/db.ts: a lazily-constructed Neon
// singleton from DATABASE_URL (so importing this during build or tsc never needs
// the connection string), idempotent CREATE TABLE IF NOT EXISTS schema creation
// callable on every route entry, and parameterized tagged-template queries.
//
// This module does NOT import lib/sharing/identity/**, lib/sharing/directory/**
// schema, or lib/billing/**. A lab is referenced only by its lab_owner_key
// (ownerKeyForEmail from lib/billing/owner.ts) passed in as a plain string; no
// new lab identity is minted here.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import {
  normalizeSlug,
  validateRelease,
  validateReserve,
  type ReserveSlugInput,
  type SlugKind,
} from "./slug-registry";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

/**
 * Lazily constructs the Neon query function from DATABASE_URL. Throws a clear
 * error if the connection string is missing so a misconfigured deployment fails
 * at request time rather than producing a confusing driver error. Never called
 * at module load, so tsc and the pure unit tests do not need a database.
 */
function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The slug registry cannot reach Neon without it.",
    );
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

/** A slug registry row as stored. */
export interface SlugRow {
  slug: string;
  kind: SlugKind;
  ownerKey: string | null;
  ref: string | null;
  createdAt: string;
  /**
   * When non-null, this slug is retired and requests for it should redirect to
   * the slug named here. The old slug is never deleted (citation safety: existing
   * links, papers, and external bookmarks must keep working), and it is never
   * freed for reuse (the redirect_to acts as a permanent alias). Absent on
   * rows returned by callers that have not been updated to include it (e.g.
   * pure-test mocks); treat undefined as null at runtime.
   */
  redirectTo?: string | null;
}

/**
 * Creates the slug_registry table if it does not already exist. Idempotent, so
 * every route can call it on entry without a migration step. The slug is the
 * primary key, which is what enforces global uniqueness across all kinds: an
 * INSERT of an already-claimed slug conflicts regardless of who or what kind
 * holds it. A secondary index on owner_key supports "what slugs does this owner
 * hold" lookups (release, lab dashboard).
 *
 * The redirect_to column (added Phase PI-slug-rename) holds the new slug when
 * an old slug is retired via rebindLabSlug. A non-null value means "permanent
 * alias, send traffic here." The old row is kept forever for citation safety.
 */
export async function ensureSlugRegistrySchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS slug_registry (
      slug       text primary key,
      kind       text not null,
      owner_key  text,
      ref        text,
      created_at timestamptz default now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_slug_registry_owner_key
      ON slug_registry(owner_key)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_slug_registry_kind
      ON slug_registry(kind)
  `;
  // Phase PI-slug-rename: the redirect_to column records permanent slug renames.
  // Added via IF NOT EXISTS so this schema-ensure remains idempotent on databases
  // that already have the table (no migration step, no data move, existing rows
  // keep redirect_to = NULL = "active slug, no redirect").
  await sql`
    ALTER TABLE slug_registry ADD COLUMN IF NOT EXISTS redirect_to text
  `;
}

function rowToSlug(r: {
  slug: string;
  kind: string;
  owner_key: string | null;
  ref: string | null;
  created_at: string;
  redirect_to?: string | null;
}): SlugRow {
  return {
    slug: r.slug,
    kind: r.kind as SlugKind,
    ownerKey: r.owner_key,
    ref: r.ref,
    createdAt: r.created_at,
    redirectTo: r.redirect_to ?? null,
  };
}

/** Fetches the registry row for an exact slug, or null if free. */
export async function getSlug(slug: string): Promise<SlugRow | null> {
  const s = normalizeSlug(slug);
  if (!s) return null;
  const sql = getSql();
  const rows = (await sql`
    SELECT slug, kind, owner_key, ref, created_at, redirect_to
    FROM slug_registry
    WHERE slug = ${s}
    LIMIT 1
  `) as Array<{
    slug: string;
    kind: string;
    owner_key: string | null;
    ref: string | null;
    created_at: string;
    redirect_to: string | null;
  }>;
  return rows[0] ? rowToSlug(rows[0]) : null;
}

/** Whether a slug is already in the registry (any kind). */
export async function isSlugTaken(slug: string): Promise<boolean> {
  return (await getSlug(slug)) !== null;
}

/**
 * Loads the set of slugs that share a prefix with `base` (base itself plus
 * base2, base-wisc, ...) so the pure suggestSlugs can be fed an accurate `taken`
 * set without a per-candidate round-trip. The pattern is escaped so a base with
 * a "%" or "_" cannot widen the match. Returned slugs are exactly as stored
 * (already normalized on insert).
 */
export async function loadTakenSlugsWithPrefix(
  base: string,
): Promise<Set<string>> {
  const s = normalizeSlug(base);
  if (!s) return new Set();
  const sql = getSql();
  const pattern = `${s.replace(/[%_\\]/g, "\\$&")}%`;
  const rows = (await sql`
    SELECT slug FROM slug_registry WHERE slug LIKE ${pattern}
  `) as Array<{ slug: string }>;
  return new Set(rows.map((r) => r.slug));
}

/**
 * The result of a reserve attempt. `taken` means the slug already belongs to
 * someone (the conflict is silent at the DB level via ON CONFLICT DO NOTHING, so
 * we report it explicitly). `invalid` carries the pure-validation reason.
 */
export type ReserveResult =
  | { ok: true; row: SlugRow }
  | { ok: false; reason: "invalid"; error: string }
  | { ok: false; reason: "taken" };

/**
 * Reserves a slug for an owner. This is the GLOBAL-UNIQUENESS gate that every
 * creation flow (lab companion-site claim, handle creation, institution claim)
 * must call: the slug primary key makes the INSERT atomic, so two concurrent
 * claims of the same slug cannot both win. Validates with the pure validateReserve
 * first (kind, length, reserved-word rules), then inserts ON CONFLICT DO NOTHING
 * and reports taken when no row was written.
 *
 * The DB layer never bypasses the reserved set for non-reserved kinds (that rule
 * lives in validateReserve), so a lab can never claim a system route segment.
 */
export async function reserveSlug(
  slug: string,
  kind: SlugKind,
  ownerKey: string | null = null,
  ref: string | null = null,
): Promise<ReserveResult> {
  const input: ReserveSlugInput = { slug, kind, ownerKey, ref };
  const validated = validateReserve(input);
  if (!validated.ok) return { ok: false, reason: "invalid", error: validated.error };
  const v = validated.value;

  await ensureSlugRegistrySchema();
  const sql = getSql();
  const rows = (await sql`
    INSERT INTO slug_registry (slug, kind, owner_key, ref)
    VALUES (${v.slug}, ${v.kind}, ${v.ownerKey ?? null}, ${v.ref ?? null})
    ON CONFLICT (slug) DO NOTHING
    RETURNING slug, kind, owner_key, ref, created_at
  `) as Array<{
    slug: string;
    kind: string;
    owner_key: string | null;
    ref: string | null;
    created_at: string;
  }>;
  if (rows.length === 0) return { ok: false, reason: "taken" };
  return { ok: true, row: rowToSlug(rows[0]) };
}

/**
 * Releases a slug an owner holds. Scoped to the owner key so a caller can only
 * free a slug it owns; a reserved/system slug (owner_key IS NULL) cannot be
 * released through this path. Returns true when a row was deleted, false when
 * nothing matched (wrong owner, or already free). Validates the slug shape first.
 */
export async function releaseSlug(
  slug: string,
  ownerKey: string,
): Promise<boolean> {
  const validated = validateRelease(slug);
  if (!validated.ok) return false;
  if (!ownerKey) return false;
  await ensureSlugRegistrySchema();
  const sql = getSql();
  const rows = (await sql`
    DELETE FROM slug_registry
    WHERE slug = ${validated.slug} AND owner_key = ${ownerKey}
    RETURNING slug
  `) as Array<{ slug: string }>;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Staged-provisioning release (unstage lane)
// ---------------------------------------------------------------------------

/**
 * The typed result of a releaseReservedSlug attempt.
 *
 * "bound"     - the slug has a lab_sites row; it belongs to a live lab and must
 *               never be freed through this path.
 * "not-owner" - the slug_registry row exists but ownerKey does not match, so the
 *               caller does not own it.
 * "not-found" - no slug_registry row exists for this slug at all.
 */
export type ReleaseReservedSlugResult =
  | { ok: true }
  | { ok: false; reason: "bound" | "not-owner" | "not-found" };

/**
 * Releases a slug_registry reservation created during staged PI provisioning.
 * This is the UNDO path for an operator mistake before the PI has ever signed in.
 *
 * Safety rules (all must pass for the DELETE to proceed):
 *   1. The slug_registry row exists.
 *   2. The ownerKey on the row matches the caller's piEmailHash.
 *   3. No lab_sites row references this slug (the PI never ran genesis).
 *   4. The redirect_to column is null (it is not a retired alias from a rename).
 *
 * If any rule fails the function returns { ok:false, reason } and deletes nothing.
 * Callers MUST check the result; a "bound" result means the staging row should be
 * treated as consumed and the unstage route must abort without touching anything.
 */
export async function releaseReservedSlug(
  slug: string,
  ownerKey: string,
): Promise<ReleaseReservedSlugResult> {
  if (!slug || !ownerKey) return { ok: false, reason: "not-found" };
  await ensureSlugRegistrySchema();
  const sql = getSql();

  // Load the slug_registry row first.
  const regRows = (await sql`
    SELECT owner_key, redirect_to
    FROM slug_registry
    WHERE slug = ${slug}
    LIMIT 1
  `) as Array<{ owner_key: string | null; redirect_to: string | null }>;

  if (regRows.length === 0) return { ok: false, reason: "not-found" };
  const reg = regRows[0];

  if (reg.owner_key !== ownerKey) return { ok: false, reason: "not-owner" };

  // A redirect_to means this slug was already renamed; treat it as bound for
  // safety (it would corrupt citation links if freed).
  if (reg.redirect_to != null) return { ok: false, reason: "bound" };

  // Check for a lab_sites binding (dynamic import to avoid a circular module
  // dep: lab-site-db imports slug-registry-db, so we import lab-site-db here
  // lazily rather than at module level).
  const { getSiteBySlug } = await import("./lab-site-db");
  const site = await getSiteBySlug(slug);
  if (site != null) return { ok: false, reason: "bound" };

  // All safety checks passed. Delete the reservation.
  await sql`
    DELETE FROM slug_registry
    WHERE slug = ${slug} AND owner_key = ${ownerKey}
  `;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Global-uniqueness seeding (Phase 1)
// ---------------------------------------------------------------------------
//
// To make the namespace globally unique from day one, existing @handles and
// institution slugs are mirrored into slug_registry as kind=handle /
// kind=institution, and the system route segments as kind=reserved. These reads
// are the ONLY cross-module touch and they are READ-ONLY against the source
// tables. The seeder is idempotent (ON CONFLICT DO NOTHING) so it can be run at
// deploy time or on a schedule without duplicating rows.
//
// The seeder DOES NOT import the account/identity/billing write paths; it reads
// account_profiles.handle directly with a thin query, and seeds institution
// slugs from the directory-derived domains. Handle/institution creation flows
// should ALSO call reserveSlug at creation time going forward (see the Popup
// reserve-on-create contract in the handoff doc); this seeder backfills what
// already exists.

/**
 * Seeds the reserved system route segments as kind=reserved. Pass the reserved
 * set (defaults to RESERVED_SLUGS via the caller) as a list. Idempotent.
 */
export async function seedReservedSlugs(slugs: Iterable<string>): Promise<number> {
  await ensureSlugRegistrySchema();
  let n = 0;
  for (const raw of slugs) {
    const r = await reserveSlug(raw, "reserved", null, null);
    if (r.ok) n += 1;
  }
  return n;
}

/**
 * Backfills every existing @handle into the registry as kind=handle, keyed by
 * the account's owner_key (its ref points back to the handle itself). Reads
 * account_profiles directly (read-only) and does not touch the account write
 * path. Idempotent. Returns the number of NEW rows written.
 *
 * If account_profiles does not exist yet (fresh DB), the read is wrapped so a
 * missing table is treated as zero handles rather than an error.
 */
export async function seedExistingHandles(): Promise<number> {
  await ensureSlugRegistrySchema();
  const sql = getSql();
  let rows: Array<{ owner_key: string; handle: string }> = [];
  try {
    rows = (await sql`
      SELECT owner_key, handle FROM account_profiles
    `) as Array<{ owner_key: string; handle: string }>;
  } catch {
    // account_profiles absent on a fresh database -> nothing to backfill.
    return 0;
  }
  let n = 0;
  for (const r of rows) {
    // A handle may normalize differently than its stored form (handles allow
    // "_", which collapses to "-" here). The registry stores the slug-namespace
    // form; the ref preserves the original handle for traceability.
    const res = await reserveSlug(r.handle, "handle", r.owner_key, r.handle);
    if (res.ok) n += 1;
  }
  return n;
}

/**
 * Backfills institution slugs into the registry as kind=institution. The
 * institution "slug" in this app is the verified email domain (see
 * directory.getInstitutionByDomain / social.institution-registry), so the
 * caller passes the list of domains to seed (e.g. derived from
 * directory_profiles.affiliation_domain). This keeps the seeder from importing
 * the directory schema directly. Idempotent. Returns new rows written.
 */
export async function seedInstitutionSlugs(
  domains: Iterable<string>,
): Promise<number> {
  await ensureSlugRegistrySchema();
  let n = 0;
  for (const domain of domains) {
    const res = await reserveSlug(domain, "institution", null, domain);
    if (res.ok) n += 1;
  }
  return n;
}

/**
 * Reads the distinct verified institution domains from the directory profiles
 * table (read-only) so seedInstitutionSlugs can be driven without the caller
 * needing the directory schema. Returns [] if the table is absent. This is a
 * read-only convenience; it does not modify directory_profiles.
 */
export async function readInstitutionDomains(): Promise<string[]> {
  const sql = getSql();
  try {
    const rows = (await sql`
      SELECT DISTINCT lower(affiliation_domain) AS domain
      FROM directory_profiles
      WHERE affiliation_domain IS NOT NULL AND affiliation_domain <> ''
    `) as Array<{ domain: string }>;
    return rows.map((r) => r.domain).filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Slug redirect resolution (Phase PI-slug-rename)
// ---------------------------------------------------------------------------

/**
 * Returns the redirect_to target for a slug if the row is a retired alias, or
 * null when the slug is either active (no redirect) or does not exist. Callers
 * use this to serve a 308 permanent redirect for any slug that a lab head has
 * renamed, ensuring existing links and citations continue to resolve.
 *
 * The old slug row is NEVER deleted (citation safety), so this is the only
 * branch needed: null = active, string = retired.
 */
export async function resolveSlugRedirect(slug: string): Promise<string | null> {
  const row = await getSlug(slug);
  // redirectTo may be undefined on rows from callers that pre-date this column;
  // treat undefined and null both as "no redirect."
  return row?.redirectTo ?? null;
}
