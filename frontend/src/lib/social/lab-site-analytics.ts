// Lab-site public page-view analytics -- Neon persistence (lab-domains Part 3).
//
// Counts public page views per (lab, site, day). Stores NO PII: no IP address,
// no user-agent, no visitor id, no cookie. The only dimensions are lab_owner_key
// (the billing owner-key hash that identifies the lab), site_key (which site or
// page was viewed), and the UTC date.
//
// site_key convention (matches Part 1 storage metering):
//   "home"          -- the lab home page (path "")
//   "<page-path>"   -- a companion page at that path (e.g. "people", "papers/2024")
//   "byo"           -- the BYO uploaded static site
//
// Conventions mirror lib/social/lab-site-db.ts: lazily-constructed Neon
// singleton, idempotent CREATE TABLE IF NOT EXISTS, parameterized tagged-template
// queries, and IO isolated at the edges so the pure logic is unit-testable.
//
// bumpLabSiteView is FIRE-AND-FORGET. It wraps its body in a try/catch and
// console.warn on any error, so the public render never throws or slows due to
// an analytics write failure. Callers do NOT await it in a way that blocks the
// response.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

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
      "DATABASE_URL is not set. The lab-site analytics store cannot reach Neon without it.",
    );
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

/**
 * Replaces the singleton with a test double. Only called from test files.
 * Passing null restores the lazy-construct behavior.
 */
export function _testSetSql(
  fake: NeonQueryFunction<false, false> | null,
): void {
  sqlSingleton = fake;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Creates the lab_site_views counter table if it does not already exist.
 * Idempotent: every route can call it on entry without a migration step.
 *
 * Schema: one row per (lab_owner_key, site_key, day). Views is a BIGINT
 * accumulator incremented by bumpLabSiteView via an UPSERT +1. No visitor
 * data, no IP, no user-agent -- counts only.
 */
export async function ensureLabSiteViewsSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS lab_site_views (
      lab_owner_key TEXT    NOT NULL,
      site_key      TEXT    NOT NULL,
      day           DATE    NOT NULL,
      views         BIGINT  NOT NULL DEFAULT 0,
      PRIMARY KEY (lab_owner_key, site_key, day)
    )
  `;
}

// ---------------------------------------------------------------------------
// Increment
// ---------------------------------------------------------------------------

/**
 * Records one public page view for a lab site. Fire-and-forget: any error
 * (schema missing, Neon down, network blip) is swallowed and logged with
 * console.warn so the public render never throws or slows due to an analytics
 * write. The UPSERT is idempotent in the sense that concurrent calls safely
 * accumulate (+1 per call) rather than losing counts.
 *
 * Callers should NOT await this in a way that blocks the HTTP response. The
 * recommended pattern at a Server Component call site is:
 *
 *   void bumpLabSiteView(ownerKey, siteKey);
 *
 * so the Promise is detached and any rejection is silently caught inside.
 */
export async function bumpLabSiteView(
  labOwnerKey: string,
  siteKey: string,
): Promise<void> {
  try {
    const sql = getSql();
    await sql`
      INSERT INTO lab_site_views (lab_owner_key, site_key, day, views)
      VALUES (${labOwnerKey}, ${siteKey}, CURRENT_DATE, 1)
      ON CONFLICT (lab_owner_key, site_key, day)
      DO UPDATE SET views = lab_site_views.views + 1
    `;
  } catch (err) {
    console.warn("[lab-site-analytics] bumpLabSiteView failed (swallowed)", err);
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** The shaped result returned by getLabSiteViews. */
export interface LabSiteViewsResult {
  /** Total page views across all site_keys in the window. */
  total: number;
  /** Per-site totals, descending by views. */
  bySite: Array<{ siteKey: string; views: number }>;
  /** Daily totals across ALL site_keys, ascending by day, for a sparkline. */
  daily: Array<{ day: string; views: number }>;
}

/**
 * Returns page-view totals for a lab, windowed to the last `sinceDays` calendar
 * days (default 30). Returns per-site totals (for a breakdown table) and a
 * daily series across all sites (for a sparkline). Rows are zero when no views
 * exist yet.
 *
 * sinceDays is clamped to [1, 365] to prevent runaway queries. The caller
 * (the PI dashboard route) passes a user-supplied window but must validate it
 * before calling this.
 */
export async function getLabSiteViews(
  labOwnerKey: string,
  sinceDays = 30,
): Promise<LabSiteViewsResult> {
  const sql = getSql();
  const days = Math.max(1, Math.min(365, Math.floor(sinceDays)));

  const [bySiteRows, dailyRows] = await Promise.all([
    sql`
      SELECT site_key, SUM(views)::bigint AS views
      FROM lab_site_views
      WHERE lab_owner_key = ${labOwnerKey}
        AND day >= CURRENT_DATE - (${days} || ' days')::interval
      GROUP BY site_key
      ORDER BY SUM(views) DESC
    ` as unknown as Promise<Array<{ site_key: string; views: string | number }>>,
    sql`
      SELECT day::text AS day, SUM(views)::bigint AS views
      FROM lab_site_views
      WHERE lab_owner_key = ${labOwnerKey}
        AND day >= CURRENT_DATE - (${days} || ' days')::interval
      GROUP BY day
      ORDER BY day ASC
    ` as unknown as Promise<Array<{ day: string; views: string | number }>>,
  ]);

  const bySite = bySiteRows.map((r) => ({
    siteKey: r.site_key,
    views: Number(r.views),
  }));

  const daily = dailyRows.map((r) => ({
    day: r.day,
    views: Number(r.views),
  }));

  const total = bySite.reduce((acc, r) => acc + r.views, 0);

  return { total, bySite, daily };
}
