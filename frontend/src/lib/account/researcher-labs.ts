// Public lab memberships for a researcher profile page.
//
// Given a researcher's @handle, returns the labs they actively belong to that
// are PUBLICLY LISTED (directory_labs.listed = true). This is the data helper
// for the "Labs" section on /u/[handle]: a public .com page visible to anyone,
// so the privacy rule is strict: only listed labs, only membership facts, no
// emails, no private roster data.
//
// Query path:
//   account_profiles (handle -> owner_key)
//   billing_lab_members (member_owner_key = owner_key, status = 'active')
//     -> lab_owner_key per active membership
//   directory_labs (pi_email_hash = lab_owner_key, listed = true)
//     -> name, institution (only if listed)
//   lab_sites (lab_owner_key = lab_owner_key)
//     -> lab_slug for the public link <slug>.research-os.com
//
// A lab that is NOT listed is omitted entirely; a listed lab with no lab_sites
// row gets a null slug (caller shows name-only with no link).
//
// Also handles the PI case: if the researcher OWNS a listed lab (they are the
// PI, i.e. directory_labs.pi_email_hash = their owner_key), that lab is
// included with role "Principal investigator".
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Researcher-labs lookup cannot reach Neon.");
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

export interface ResearcherLabEntry {
  /** Display name of the lab. */
  name: string;
  /** Institution string, may be null. */
  institution: string | null;
  /** The lab's public slug (for <slug>.research-os.com). Null when the lab has
   *  no companion site yet; in that case no link is rendered. */
  slug: string | null;
  /** Whether this researcher is the lab head (PI). */
  isPi: boolean;
}

/**
 * Returns the publicly-listed labs a researcher actively belongs to (as member
 * or PI). Returns an empty array when the handle does not exist, the researcher
 * has no active memberships, or all their labs are unlisted.
 *
 * NOTE: the `owner_key` is resolved internally and is NEVER returned to the
 * caller, keeping the public-profile surface free of billing-key leakage.
 */
export async function getResearcherPublicLabs(
  handle: string,
): Promise<ResearcherLabEntry[]> {
  if (!handle) return [];
  const sql = getSql();
  const h = handle.trim().toLowerCase().replace(/^@/, "");
  if (!h) return [];

  // Step 1: resolve handle -> owner_key (internal only, never returned).
  const ownerRows = (await sql`
    SELECT owner_key FROM account_profiles WHERE handle = ${h} LIMIT 1
  `) as Array<{ owner_key: string }>;
  if (ownerRows.length === 0) return [];
  const ownerKey = ownerRows[0].owner_key;

  // Step 2: collect labs via two paths, then merge and deduplicate.
  //
  // Path A (member): billing_lab_members where member_owner_key = ownerKey AND
  //   status = 'active'. Each active row gives us a lab_owner_key; we then join
  //   directory_labs (pi_email_hash = lab_owner_key, listed = true) for the
  //   name and institution, and lab_sites (lab_owner_key) for the slug.
  //
  // Path B (PI): directory_labs where pi_email_hash = ownerKey AND listed = true.
  //   The PI is not in billing_lab_members for their own lab (they are the owner),
  //   so this path catches the PI's own lab.
  //
  // A single LEFT JOIN query covers both paths.
  const rows = (await sql`
    SELECT
      dl.name            AS name,
      dl.institution     AS institution,
      ls.lab_slug        AS slug,
      dl.pi_email_hash   AS pi_key,
      ${ownerKey}::text  AS researcher_key
    FROM directory_labs dl
    LEFT JOIN lab_sites ls ON ls.lab_owner_key = dl.pi_email_hash
    WHERE dl.listed = true
      AND (
        dl.pi_email_hash = ${ownerKey}
        OR dl.pi_email_hash IN (
          SELECT lab_owner_key
          FROM billing_lab_members
          WHERE member_owner_key = ${ownerKey} AND status = 'active'
        )
      )
    ORDER BY dl.name
  `) as Array<{
    name: string;
    institution: string | null;
    slug: string | null;
    pi_key: string;
    researcher_key: string;
  }>;

  return rows.map((r) => ({
    name: r.name,
    institution: r.institution,
    slug: r.slug ?? null,
    isPi: r.pi_key === ownerKey,
  }));
}
