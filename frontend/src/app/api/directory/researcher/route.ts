// Cross-boundary sharing, single researcher profile lookup (section 17).
//
// GET /api/directory/researcher?fp=<compact-fingerprint>
//
// Returns the published profile for an EXACT fingerprint, or { profile: null }
// if none is published. This powers the shareable profile page at
// /researchers/[fingerprint].
//
// PUBLIC (no OAuth session), deliberately. Unlike /search (which enumerates and
// is therefore session-gated), this is an exact-match lookup: the caller must
// already hold the full fingerprint, so it cannot be used to browse or harvest
// the directory. This mirrors /lookup, which is also public and exact-match.
// The profile contains NO email, only name, affiliation, the verified-domain
// badge, ORCID, and the fingerprint, so a public profile view exposes no
// contact address.
//
// Reads env: SHARING_ENABLED, KV_REST_API_URL, KV_REST_API_TOKEN, DATABASE_URL.

import {
  ensureProfileSchema,
  ensureSchema,
  getProfileByFingerprint,
} from "@/lib/sharing/directory/db";
import { getIpLimiter } from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  // Rate-limited per IP, the same blunt limiter the other directory routes use.
  const ip = extractClientIp(request.headers);
  const verdict = await getIpLimiter().limit(ip);
  if (!verdict.success) {
    return json(429, { error: "rate limited" });
  }

  // Normalize the compact fingerprint and re-insert the canonical 4-char
  // grouping for the exact-match lookup. Reject anything that is not 8 to 64
  // lowercase hex characters so a malformed value never reaches the query.
  const url = new URL(request.url);
  const compact = (url.searchParams.get("fp") ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
  if (!/^[0-9a-f]{8,64}$/.test(compact)) {
    return json(400, { error: "not found" });
  }
  const groups: string[] = [];
  for (let i = 0; i < compact.length; i += 4) {
    groups.push(compact.slice(i, i + 4));
  }
  const fingerprint = groups.join(" ");

  await ensureSchema();
  await ensureProfileSchema();

  let profile;
  try {
    profile = await getProfileByFingerprint(fingerprint);
  } catch {
    return json(500, { error: "lookup failed" });
  }

  return json(200, { profile: profile ?? null });
}
