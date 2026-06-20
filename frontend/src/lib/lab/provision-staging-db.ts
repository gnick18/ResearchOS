// Staged PI provisioning store, Neon persistence (staged-pi-provisioning lane).
//
// An operator stages a lab for a PI by their peppered email hash BEFORE the PI
// ever signs in. When the PI signs in once, their client auto-runs the real lab
// genesis ON THEIR DEVICE (the genesis is signed by the PI ed25519 key and the
// lab key is sealed to their x25519 key, the server never sees private keys),
// inheriting the staged branding and binding the reserved slug. This row holds
// only the PUBLIC metadata an operator typed (name, institution, slug, comp tier
// + months, cosmetic PI title/display). It never holds key material.
//
// A pure server-side "convert account to lab" is impossible because it would
// produce a listed-but-dead lab with no openable team key. So only the metadata
// is staged here; the genesis runs client-side and consumes this row.
//
// FLAG (schema change): this module creates a NEW table lab_provision_staging via
// ensureProvisionStagingSchema(). It does NOT alter any existing table. The
// routes call ensureProvisionStagingSchema() lazily (the additive-table pattern
// from lab-tool-db.ts / billing/grants.ts), so a deployment without DATABASE_URL
// set is safe (the table is never created if the connection is never opened).
//
// Conventions mirror lib/social/lab-tool-db.ts exactly: a lazily-constructed Neon
// singleton from DATABASE_URL, idempotent CREATE TABLE IF NOT EXISTS, and
// parameterized tagged-template queries.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The provision-staging store cannot reach Neon without it.",
    );
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

/** The three comped plan tiers, matching billing/grants.GiftTier. */
export type CompTier = "solo" | "lab" | "dept";

/** The lifecycle of a staging row. */
export type ProvisionStatus = "pending" | "consumed";

/**
 * A staged provisioning row, as stored. Keyed by the PI peppered email hash, so
 * one PI has at most one pending staging. All fields are PUBLIC metadata only.
 */
export interface ProvisionStagingRow {
  piEmailHash: string;
  labName: string;
  institution: string | null;
  slug: string;
  compTier: CompTier;
  compMonths: number;
  piTitle: string | null;
  piDisplay: string | null;
  status: ProvisionStatus;
  createdAt: string;
  consumedAt: string | null;
}

/**
 * Creates the lab_provision_staging table if absent. Idempotent (callable per
 * request without a migration step). pi_email_hash is the primary key, so a
 * second stage for the same PI replaces the first in place (upsert), which is the
 * desired behavior (the operator re-staging a PI corrects the earlier metadata).
 */
export async function ensureProvisionStagingSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS lab_provision_staging (
      pi_email_hash text primary key,
      lab_name      text not null,
      institution   text,
      slug          text not null,
      comp_tier     text not null,
      comp_months   int  not null default 0,
      pi_title      text,
      pi_display    text,
      status        text not null default 'pending',
      created_at    timestamptz default now(),
      consumed_at   timestamptz
    )
  `;
}

interface RawStagingRow {
  pi_email_hash: string;
  lab_name: string;
  institution: string | null;
  slug: string;
  comp_tier: string;
  comp_months: number | string;
  pi_title: string | null;
  pi_display: string | null;
  status: string;
  created_at: string;
  consumed_at: string | null;
}

function rowToStaging(r: RawStagingRow): ProvisionStagingRow {
  return {
    piEmailHash: r.pi_email_hash,
    labName: r.lab_name,
    institution: r.institution ?? null,
    slug: r.slug,
    compTier: r.comp_tier as CompTier,
    compMonths: Number(r.comp_months),
    piTitle: r.pi_title ?? null,
    piDisplay: r.pi_display ?? null,
    status: r.status as ProvisionStatus,
    createdAt: r.created_at,
    consumedAt: r.consumed_at ?? null,
  };
}

/**
 * Inserts or replaces the staging row for a PI email hash. On a re-stage (same
 * hash) every field is overwritten and the row is reset to status='pending' with
 * consumed_at cleared, so an operator can correct the staged metadata before the
 * PI signs in. Returns the stored row.
 */
export async function upsertProvisionStaging(input: {
  piEmailHash: string;
  labName: string;
  institution: string | null;
  slug: string;
  compTier: CompTier;
  compMonths: number;
  piTitle: string | null;
  piDisplay: string | null;
}): Promise<ProvisionStagingRow | null> {
  if (!input.piEmailHash) return null;
  await ensureProvisionStagingSchema();
  const sql = getSql();
  await sql`
    INSERT INTO lab_provision_staging
      (pi_email_hash, lab_name, institution, slug, comp_tier, comp_months,
       pi_title, pi_display, status, created_at, consumed_at)
    VALUES (
      ${input.piEmailHash},
      ${input.labName},
      ${input.institution},
      ${input.slug},
      ${input.compTier},
      ${Math.max(0, Math.floor(input.compMonths))},
      ${input.piTitle},
      ${input.piDisplay},
      'pending',
      now(),
      NULL
    )
    ON CONFLICT (pi_email_hash) DO UPDATE SET
      lab_name    = EXCLUDED.lab_name,
      institution = EXCLUDED.institution,
      slug        = EXCLUDED.slug,
      comp_tier   = EXCLUDED.comp_tier,
      comp_months = EXCLUDED.comp_months,
      pi_title    = EXCLUDED.pi_title,
      pi_display  = EXCLUDED.pi_display,
      status      = 'pending',
      created_at  = now(),
      consumed_at = NULL
  `;
  return getProvisionStaging(input.piEmailHash);
}

/**
 * Fetches the staging row for a PI email hash, or null when none. Exact
 * primary-key match only, never a prefix or LIKE, so the table cannot be
 * enumerated. Callers that should only act on a fresh staging must additionally
 * check status === 'pending'.
 */
export async function getProvisionStaging(
  piEmailHash: string,
): Promise<ProvisionStagingRow | null> {
  if (!piEmailHash) return null;
  await ensureProvisionStagingSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT pi_email_hash, lab_name, institution, slug, comp_tier, comp_months,
           pi_title, pi_display, status, created_at, consumed_at
    FROM lab_provision_staging
    WHERE pi_email_hash = ${piEmailHash}
    LIMIT 1
  `) as RawStagingRow[];
  return rows[0] ? rowToStaging(rows[0]) : null;
}

/**
 * Marks a staging row consumed (the PI signed in and ran the genesis). Idempotent
 * and scoped to the email hash. Sets status='consumed' and stamps consumed_at, so
 * a second sign-in does not re-provision (the pending lookup returns null once the
 * row is consumed).
 */
export async function markProvisionConsumed(piEmailHash: string): Promise<void> {
  if (!piEmailHash) return;
  await ensureProvisionStagingSchema();
  const sql = getSql();
  await sql`
    UPDATE lab_provision_staging
    SET status = 'consumed', consumed_at = now()
    WHERE pi_email_hash = ${piEmailHash}
  `;
}

/**
 * Deletes the staging row for a PI email hash. Callers MUST check status ===
 * 'pending' before calling this; the unstage route enforces the safety rule. This
 * function is intentionally naive (it always deletes if the row exists) because the
 * route owns the consumed-guard.
 */
export async function deleteProvisionStaging(piEmailHash: string): Promise<void> {
  if (!piEmailHash) return;
  await ensureProvisionStagingSchema();
  const sql = getSql();
  await sql`
    DELETE FROM lab_provision_staging
    WHERE pi_email_hash = ${piEmailHash}
  `;
}

/** A slim row for the operator pending-stagings list. */
export interface PendingStagingEntry {
  piEmailHash: string;
  labName: string;
  slug: string;
  compTier: CompTier;
  compMonths: number;
  createdAt: string;
}

/**
 * Returns all rows with status='pending', newest first, for the admin panel. Only
 * public metadata is returned (no PI private keys). The piEmailHash is a peppered
 * HMAC so it is safe to display as an opaque identifier to the operator.
 */
export async function listPendingStagings(): Promise<PendingStagingEntry[]> {
  await ensureProvisionStagingSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT pi_email_hash, lab_name, slug, comp_tier, comp_months, created_at
    FROM lab_provision_staging
    WHERE status = 'pending'
    ORDER BY created_at DESC
  `) as Array<{
    pi_email_hash: string;
    lab_name: string;
    slug: string;
    comp_tier: string;
    comp_months: number | string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    piEmailHash: r.pi_email_hash,
    labName: r.lab_name,
    slug: r.slug,
    compTier: r.comp_tier as CompTier,
    compMonths: Number(r.comp_months),
    createdAt: r.created_at,
  }));
}
