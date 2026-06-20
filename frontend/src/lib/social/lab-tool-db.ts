// Tool-repo connection store, Neon persistence (Phase A, social lane).
//
// When a lab connects a GitHub repo that classifyRepo() identifies as "tool" (a
// software tool rather than a static website), the repo metadata needed to render
// the software-companion header (name, description, language, license, repo URL,
// latest release, logo URL) is stored here as a single row per lab.
//
// This is a NEW TABLE (lab_tool_github) added by ensureLabToolSchema(). It is
// ADDITIVE and separate from the existing lab_byo_github table, which records
// the same owner/repo/ref for BYO static-site connections. The split is correct
// because a "tool" connection stores ingested metadata (no zipball, no R2 files),
// while a "site" connection stores a zipball ingest (no metadata header). The
// two paths share the same SSRF guards and charset validators but diverge after
// classification.
//
// FLAG (schema change): this module creates a new table `lab_tool_github` via
// ensureLabToolSchema(). It does NOT alter any existing table. The route calls
// ensureLabToolSchema() lazily (same pattern as ensureLabByoGithubSchema in
// lab-byo-db.ts), so a deployment without the env var set is safe (the table
// is never created if the DB connection is never opened).
//
// Conventions mirror lab-byo-db.ts exactly: lazily-constructed Neon singleton
// from DATABASE_URL, idempotent CREATE TABLE IF NOT EXISTS, parameterized queries.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import { isSafeOwner, isSafeRepo } from "./lab-byo-github";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The lab-tool store cannot reach Neon without it.",
    );
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

/**
 * A stored tool-repo connection for one lab. One row per lab, keyed by
 * lab_owner_key. The metadata fields mirror ToolRepoMeta from lab-tool-ingest.ts
 * but are stored here as flat columns for cheap reads (no JSON parse on the
 * render hot-path).
 */
export interface LabToolGithubRow {
  labOwnerKey: string;
  /** GitHub owner login (charset-validated). */
  owner: string;
  /** GitHub repo name (charset-validated). */
  repo: string;
  /** Human-readable repo name (may differ from repo slug). */
  repoName: string;
  /** Short description from GitHub, or null. */
  repoDescription: string | null;
  /** Primary language as reported by GitHub, or null. */
  primaryLanguage: string | null;
  /** SPDX license identifier, or null. */
  license: string | null;
  /** Canonical GitHub URL. */
  htmlUrl: string;
  /** Latest release tag name, or null. */
  latestRelease: string | null;
  /** URL to the latest release page, or null. */
  latestReleaseUrl: string | null;
  /** URL of a logo asset image, or null. */
  logoUrl: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Creates the lab_tool_github table if absent. Idempotent (callable per request
 * without a migration step). Keyed by lab_owner_key (one tool connection per lab).
 *
 * FLAG (schema change): this is a NEW TABLE. All columns are additive and no
 * existing table is altered. Existing deployments are unaffected until
 * ensureLabToolSchema() is called (which happens only when the tool ingest path
 * is triggered).
 */
export async function ensureLabToolSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS lab_tool_github (
      lab_owner_key    text primary key,
      owner            text not null,
      repo             text not null,
      repo_name        text not null default '',
      repo_description text,
      primary_language text,
      license          text,
      html_url         text not null default '',
      latest_release   text,
      latest_release_url text,
      logo_url         text,
      updated_at       timestamptz default now()
    )
  `;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

interface RawToolRow {
  lab_owner_key: string;
  owner: string;
  repo: string;
  repo_name: string;
  repo_description: string | null;
  primary_language: string | null;
  license: string | null;
  html_url: string;
  latest_release: string | null;
  latest_release_url: string | null;
  logo_url: string | null;
  updated_at: string;
}

function rowToTool(r: RawToolRow): LabToolGithubRow {
  return {
    labOwnerKey: r.lab_owner_key,
    owner: r.owner,
    repo: r.repo,
    repoName: r.repo_name || r.repo,
    repoDescription: r.repo_description ?? null,
    primaryLanguage: r.primary_language ?? null,
    license: r.license ?? null,
    htmlUrl: r.html_url,
    latestRelease: r.latest_release ?? null,
    latestReleaseUrl: r.latest_release_url ?? null,
    logoUrl: r.logo_url ?? null,
    updatedAt: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Fetches the tool connection for a lab owner-key, or null when none. */
export async function getToolByOwner(
  labOwnerKey: string,
): Promise<LabToolGithubRow | null> {
  if (!labOwnerKey) return null;
  await ensureLabToolSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT lab_owner_key, owner, repo, repo_name, repo_description,
           primary_language, license, html_url, latest_release,
           latest_release_url, logo_url, updated_at
    FROM lab_tool_github
    WHERE lab_owner_key = ${labOwnerKey}
    LIMIT 1
  `) as RawToolRow[];
  return rows[0] ? rowToTool(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Upsert a tool connection for a lab. The owner and repo values must already
 * be charset-validated (isSafeOwner / isSafeRepo) by the caller; this re-checks
 * as defense in depth. Returns the stored row or null on validation failure.
 *
 * Re-connecting (sync) replaces the row in place, which is the desired behavior:
 * the latest ingest result always wins.
 */
export async function upsertToolGithub(input: {
  labOwnerKey: string;
  owner: string;
  repo: string;
  repoName: string;
  repoDescription: string | null;
  primaryLanguage: string | null;
  license: string | null;
  htmlUrl: string;
  latestRelease: string | null;
  latestReleaseUrl: string | null;
  logoUrl: string | null;
}): Promise<LabToolGithubRow | null> {
  if (!input.labOwnerKey) return null;
  if (!isSafeOwner(input.owner) || !isSafeRepo(input.repo)) return null;
  await ensureLabToolSchema();
  const sql = getSql();
  await sql`
    INSERT INTO lab_tool_github (
      lab_owner_key, owner, repo, repo_name, repo_description,
      primary_language, license, html_url, latest_release,
      latest_release_url, logo_url, updated_at
    )
    VALUES (
      ${input.labOwnerKey},
      ${input.owner},
      ${input.repo},
      ${input.repoName},
      ${input.repoDescription},
      ${input.primaryLanguage},
      ${input.license},
      ${input.htmlUrl},
      ${input.latestRelease},
      ${input.latestReleaseUrl},
      ${input.logoUrl},
      now()
    )
    ON CONFLICT (lab_owner_key) DO UPDATE SET
      owner              = EXCLUDED.owner,
      repo               = EXCLUDED.repo,
      repo_name          = EXCLUDED.repo_name,
      repo_description   = EXCLUDED.repo_description,
      primary_language   = EXCLUDED.primary_language,
      license            = EXCLUDED.license,
      html_url           = EXCLUDED.html_url,
      latest_release     = EXCLUDED.latest_release,
      latest_release_url = EXCLUDED.latest_release_url,
      logo_url           = EXCLUDED.logo_url,
      updated_at         = now()
  `;
  return getToolByOwner(input.labOwnerKey);
}

/**
 * Deletes a lab's tool connection row (best-effort). Called when a lab removes
 * its tool repo connection or switches to a site connection.
 */
export async function deleteToolGithubRow(labOwnerKey: string): Promise<void> {
  if (!labOwnerKey) return;
  await ensureLabToolSchema();
  const sql = getSql();
  await sql`DELETE FROM lab_tool_github WHERE lab_owner_key = ${labOwnerKey}`;
}
