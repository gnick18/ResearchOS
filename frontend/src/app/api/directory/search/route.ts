// Cross-boundary sharing, researcher profile search route (section 17).
//
// GET /api/directory/search?q=<query>
//
// Returns up to 20 profiles whose name or affiliation fuzzy-matches the query
// via pg_trgm trigram similarity. Each result includes the researcher's display
// name, affiliation, affiliation_domain badge, ORCID, fingerprint, and public
// keys. Email is NEVER returned.
//
// Requires an OAuth session (anonymous search is not allowed). Rate-limited by
// IP via the shared IP limiter AND a tighter search-specific limiter (30/min).
//
// Reads env: SHARING_ENABLED, KV_REST_API_URL, KV_REST_API_TOKEN, DATABASE_URL,
// plus the AUTH_* vars used by the session.

import { auth } from "@/lib/sharing/auth";
import {
  ensureProfileSchema,
  ensureSchema,
  searchProfiles,
} from "@/lib/sharing/directory/db";
import {
  getIpLimiter,
  getSearchLimiter,
} from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { parseSearchQuery } from "@/lib/sharing/directory/validation";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  // Require an authenticated session. Anonymous search is not allowed.
  // An ORCID-only session (no email) is also accepted, since ORCID proves
  // identity even without an email claim.
  const session = await auth();
  if (!session?.user?.email && !session?.orcidId) {
    return json(401, { error: "unauthorized" });
  }

  const ip = extractClientIp(request.headers);

  // Two-limiter pattern: the shared IP limiter blunts generic abuse, the
  // search-specific limiter caps directory enumeration attempts.
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
    return json(400, { error: "search failed" });
  }

  await ensureSchema();
  await ensureProfileSchema();

  let results;
  try {
    results = await searchProfiles(q, 20);
  } catch {
    return json(500, { error: "search failed" });
  }

  return json(200, { results });
}
