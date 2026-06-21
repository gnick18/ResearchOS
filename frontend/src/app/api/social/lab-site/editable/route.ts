// Lab companion-site editable-by-member listing API (lab-site builder, section A).
//
//   GET /api/social/lab-site/editable
//     Member-only. Returns all sites the signed-in caller has been granted
//     editor access to, resolved from lab_site_editors + lab_sites. The caller
//     identity is always derived from the SESSION (resolveCallerOwnerKey), never
//     from a client-supplied body or query param. The PI's identity is never
//     required from the client; only the site rows the caller is actually granted
//     are returned. Returns { sites: EditableSiteSummary[] }.
//
// AUTHZ: flag -> session. Any signed-in user may call this endpoint; it returns
// only sites they are genuinely granted. A caller with no grants gets []. An
// unauthenticated caller gets 401. The PI owner-key check is implicit: the DB
// join only includes lab_sites rows where the member holds a grant, so a caller
// who is the lab owner of their own site does NOT see it here (isSiteEditor
// returns false when labOwnerKey === memberKey), which is correct: this endpoint
// is for editors accessing OTHER PIs' sites, not the owner accessing their own.
//
// Reads env: LAB_SITES_ENABLED, DATABASE_URL, plus AUTH_* + pepper vars.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { json } from "@/lib/social/guard";
import { resolveCallerOwnerKey } from "@/lib/social/lab-site-session";
import { isLabSitesEnabled } from "@/lib/social/config";
import { listSitesEditableBy } from "@/lib/social/lab-site-editors-db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!isLabSitesEnabled()) return json(404, { error: "not found" });

  const callerOwnerKey = await resolveCallerOwnerKey();
  if (!callerOwnerKey) return json(401, { error: "unauthorized" });

  let sites;
  try {
    sites = await listSitesEditableBy(callerOwnerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }

  return json(200, { sites });
}
