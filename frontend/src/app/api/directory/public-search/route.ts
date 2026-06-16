// Social layer (Phase A), PUBLIC researcher search route.
//
// GET /api/directory/public-search?q=<query>
//
// The login-free sibling of /api/directory/search, powering the public /network
// hub. Returns up to 20 LISTED profiles whose name or affiliation fuzzy-matches
// the query via pg_trgm trigram similarity. Each result carries ONLY public-card
// fields: display name, affiliation, verified institutional domain, ORCID, and
// fingerprint. It NEVER returns email and NEVER returns public key material, so
// the result set cannot be harvested into a sealing or contact corpus.
//
// UNLIKE /search, this requires NO session (the /network hub is browsable while
// logged out). To keep that safe it is gated TWICE:
//   - isSharingEnabled()    the directory must be on at all (404 otherwise), and
//   - isSocialLayerEnabled() a SEPARATE server flag (SOCIAL_LAYER_ENABLED), so a
//     public enumeration surface never goes live just because sharing is on. The
//     NEXT_PUBLIC_SOCIAL_LAYER client flag only hides the /network UI, not this
//     route, so this server gate is what actually keeps it dark.
// Harvest is further blunted by the two IP limiters (effective 20/min/IP), the
// min-2-char query, and the capped page size.
//
// Reads env: SHARING_ENABLED, SOCIAL_LAYER_ENABLED, KV_REST_API_URL,
// KV_REST_API_TOKEN, DATABASE_URL.

import {
  ensureProfileSchema,
  ensureSchema,
  searchPublicProfiles,
} from "@/lib/sharing/directory/db";
import {
  getIpLimiter,
  getSearchLimiter,
} from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  isSharingEnabled,
  isSocialLayerEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { parseSearchQuery } from "@/lib/sharing/directory/validation";

export const runtime = "nodejs";

/** Hard cap on the page size, regardless of any caller-supplied value. */
const MAX_RESULTS = 20;

export async function GET(request: Request): Promise<Response> {
  // BOTH gates: the directory must be on AND the public social surface must be
  // deliberately enabled. Either off => 404, indistinguishable from a route that
  // does not exist, so the surface stays fully dark by default.
  if (!isSharingEnabled() || !isSocialLayerEnabled()) {
    return json(404, { error: "not found" });
  }

  const ip = extractClientIp(request.headers);

  // Two-limiter pattern, same as the authed /search: the shared IP limiter blunts
  // generic abuse, the search-specific limiter caps directory enumeration. There
  // is no per-identity limiter here because the caller is anonymous, so IP is the
  // only handle we have.
  const [ipVerdict, searchVerdict] = await Promise.all([
    getIpLimiter().limit(ip),
    getSearchLimiter().limit(ip),
  ]);
  if (!ipVerdict.success || !searchVerdict.success) {
    return json(429, { error: "rate limited" });
  }

  const url = new URL(request.url);
  const q = parseSearchQuery(url.searchParams.get("q"));
  if (!q) {
    // Absent, too short (< 2 chars), or too long (> 100). The min length blunts
    // single-character corpus sweeps.
    return json(400, { error: "search failed" });
  }

  await ensureSchema();
  await ensureProfileSchema();

  let results;
  try {
    results = await searchPublicProfiles(q, MAX_RESULTS);
  } catch {
    return json(500, { error: "search failed" });
  }

  return json(200, { results });
}
