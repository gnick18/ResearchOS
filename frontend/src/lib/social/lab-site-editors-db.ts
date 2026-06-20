// Per-companion-site editor grants (lab-site builder, section A).
//
// A PI grants a specific lab member permanent FULL edit access (create, edit,
// and publish) to a specific companion site path. This is GRANULAR and per-
// site, distinct from the lab-wide Lab Manager role. The PI keeps revoke.
//
// Table: lab_site_editors
//   lab_owner_key text   - the PI's billing owner key (identifies the lab)
//   path          text   - the site path this grant covers (normally "" for
//                          the entire site; reserved for future per-page grants)
//   member_key    text   - the member's billing owner key
//   granted_by    text   - the owner key of whoever issued the grant (always
//                          the lab owner; recorded for the audit trail)
//   granted_at    timestamptz default now()
//
// PK/unique on (lab_owner_key, path, member_key) so grants are idempotent on
// re-grant and revoke is a targeted delete.
//
// A granted editor can create, edit, and publish pages on that site. The server
// write routes enforce this by calling isSiteEditor before any page write. Only
// the lab owner can grant or revoke; a granted editor cannot add more editors.
//
// This module follows the same lazy-Neon-singleton + idempotent-schema pattern
// as lab-site-db.ts. It imports NOTHING from the identity/sharing/billing write
// paths; it takes already-resolved primitives (owner keys as plain strings).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The lab-site-editors store cannot reach Neon.",
    );
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

/** A single editor-grant row as returned to callers. */
export interface SiteEditorRow {
  labOwnerKey: string;
  path: string;
  memberKey: string;
  grantedBy: string;
  grantedAt: string;
}

function rowToEditor(r: {
  lab_owner_key: string;
  path: string;
  member_key: string;
  granted_by: string;
  granted_at: string;
}): SiteEditorRow {
  return {
    labOwnerKey: r.lab_owner_key,
    path: r.path,
    memberKey: r.member_key,
    grantedBy: r.granted_by,
    grantedAt: r.granted_at,
  };
}

/**
 * Creates the lab_site_editors table if it does not already exist. Idempotent,
 * so every route can call it on entry without a separate migration step.
 */
export async function ensureEditorsSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS lab_site_editors (
      lab_owner_key text        not null,
      path          text        not null default '',
      member_key    text        not null,
      granted_by    text        not null,
      granted_at    timestamptz not null default now(),
      PRIMARY KEY (lab_owner_key, path, member_key)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_lab_site_editors_member
      ON lab_site_editors (member_key)
  `;
}

/**
 * Grants a member edit access to a site (or a site path). Idempotent on
 * (lab_owner_key, path, member_key): re-granting the same triple is a no-op
 * that updates granted_by and granted_at so the audit trail stays fresh.
 *
 * @param labOwnerKey  The PI's billing owner key (identifies the lab).
 * @param path         The site path this grant covers ("" = whole site).
 * @param memberKey    The member's billing owner key being granted access.
 * @param grantedBy    The owner key of the granting principal (PI only).
 */
export async function grantSiteEditor(
  labOwnerKey: string,
  path: string,
  memberKey: string,
  grantedBy: string,
): Promise<void> {
  if (!labOwnerKey || !memberKey || !grantedBy) return;
  await ensureEditorsSchema();
  const sql = getSql();
  await sql`
    INSERT INTO lab_site_editors (lab_owner_key, path, member_key, granted_by, granted_at)
    VALUES (${labOwnerKey}, ${path}, ${memberKey}, ${grantedBy}, now())
    ON CONFLICT (lab_owner_key, path, member_key) DO UPDATE
      SET granted_by = EXCLUDED.granted_by,
          granted_at = now()
  `;
}

/**
 * Revokes a member's editor grant for a specific site path. A no-op when no
 * matching grant exists. Only the lab owner should call this.
 */
export async function revokeSiteEditor(
  labOwnerKey: string,
  path: string,
  memberKey: string,
): Promise<void> {
  if (!labOwnerKey || !memberKey) return;
  await ensureEditorsSchema();
  const sql = getSql();
  await sql`
    DELETE FROM lab_site_editors
    WHERE lab_owner_key = ${labOwnerKey}
      AND path          = ${path}
      AND member_key    = ${memberKey}
  `;
}

/**
 * Lists all active editor grants for a lab site (by owner key and path).
 * Returns an empty array when there are no grants or on any DB error.
 */
export async function listSiteEditors(
  labOwnerKey: string,
  path: string,
): Promise<SiteEditorRow[]> {
  if (!labOwnerKey) return [];
  await ensureEditorsSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT lab_owner_key, path, member_key, granted_by, granted_at
    FROM lab_site_editors
    WHERE lab_owner_key = ${labOwnerKey}
      AND path          = ${path}
    ORDER BY granted_at
  `) as Array<{
    lab_owner_key: string;
    path: string;
    member_key: string;
    granted_by: string;
    granted_at: string;
  }>;
  return rows.map(rowToEditor);
}

/**
 * Returns true when memberKey holds an active editor grant for the given lab
 * site path. Used by the write routes to allow owner-OR-editor access.
 *
 * A grant on path "" is treated as a grant on the whole site regardless of
 * which page path the caller is editing. This is the current model (whole-site
 * grants only); per-page grants would require an additional path-match check.
 *
 * @param labOwnerKey  The lab owner key (identifies whose site is being written).
 * @param path         The site path being written (used for future per-page grants).
 * @param memberKey    The caller's billing owner key.
 */
export async function isSiteEditor(
  labOwnerKey: string,
  path: string,
  memberKey: string,
): Promise<boolean> {
  if (!labOwnerKey || !memberKey) return false;
  // A PI is never their own editor in this table (they are the owner).
  if (labOwnerKey === memberKey) return false;
  await ensureEditorsSchema();
  const sql = getSql();
  // A whole-site grant (path = "") covers any page; a path-specific grant covers
  // exactly that path. For the current whole-site-only model, path is always "".
  const rows = (await sql`
    SELECT 1
    FROM lab_site_editors
    WHERE lab_owner_key = ${labOwnerKey}
      AND member_key    = ${memberKey}
      AND (path = '' OR path = ${path})
    LIMIT 1
  `) as Array<Record<string, unknown>>;
  return rows.length > 0;
}
