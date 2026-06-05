// ORCID publications proxy (section 18.1 of CROSS_BOUNDARY_SHARING_PROPOSAL.md).
//
// GET /api/orcid/works?orcid=<id>
//
// Validates the ORCID iD format, rate-limits by IP using the existing directory
// limiter, calls the ORCID Public API server-side (no CORS issues), and returns
// a JSON array of OrcidWork objects.
//
// If AUTH_ORCID_ID is not set, returns { works: [] } so the feature is
// simply inert in environments without ORCID credentials.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { fetchOrcidWorks } from "@/lib/orcid/works";
import { extractClientIp, json } from "@/lib/sharing/directory/guard";
import { getIpLimiter } from "@/lib/sharing/directory/ratelimit";

export const runtime = "nodejs";

const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

export async function GET(request: Request): Promise<Response> {
  // Feature inert when ORCID credentials are absent.
  if (!process.env.AUTH_ORCID_ID) {
    return json(200, { works: [] });
  }

  // Per-IP rate limit, reusing the shared directory limiter.
  const ip = extractClientIp(request.headers);
  const verdict = await getIpLimiter().limit(ip);
  if (!verdict.success) {
    return json(429, { error: "rate limited" });
  }

  const url = new URL(request.url);
  const orcid = (url.searchParams.get("orcid") ?? "").trim();
  if (!ORCID_RE.test(orcid)) {
    return json(400, { error: "invalid orcid" });
  }

  const works = await fetchOrcidWorks(orcid);

  const response = new Response(JSON.stringify({ works }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=3600",
    },
  });
  return response;
}
