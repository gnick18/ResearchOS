// Social layer (Phase B), PUBLIC institution page route.
//
// GET /api/directory/institution?slug=<institution-slug>
//
// The login-free institution hub at /institution/[slug]. There is no curated
// institution entity in the directory; an institution is DERIVED from a verified
// email-domain cluster (the slug IS the verified domain, e.g. wisc.edu). Returns
// the LISTED researchers who proved that domain, plus the derived departments and
// member count. Each member carries ONLY public-card fields (display name,
// affiliation, verified domain, ORCID, fingerprint) - never email, never keys.
//
// Gated TWICE exactly like /api/directory/public-search: isSharingEnabled() AND
// the separate SOCIAL_LAYER_ENABLED server flag, so the public surface stays dark
// until deliberately enabled (the NEXT_PUBLIC_SOCIAL_LAYER client flag only hides
// the /institution UI, not this route). Harvest is blunted by the two IP limiters
// and the domain-shaped slug validation.
//
// Response: { found: false } when no listed member shares the domain (the page
// renders a "coming online" placeholder); { found: true, institution } otherwise.
// A 404 means the whole surface is dark (a gate is off).
//
// Reads env: SHARING_ENABLED, SOCIAL_LAYER_ENABLED, KV_REST_API_URL,
// KV_REST_API_TOKEN, DATABASE_URL.

import {
  ensureProfileSchema,
  ensureSchema,
  getInstitutionByDomain,
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
import { parseInstitutionSlug } from "@/lib/sharing/directory/validation";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  // BOTH gates: directory on AND the public social surface deliberately enabled.
  if (!isSharingEnabled() || !isSocialLayerEnabled()) {
    return json(404, { error: "not found" });
  }

  const ip = extractClientIp(request.headers);

  // Same two-limiter pattern as public-search; the caller is anonymous so IP is
  // the only handle.
  const [ipVerdict, searchVerdict] = await Promise.all([
    getIpLimiter().limit(ip),
    getSearchLimiter().limit(ip),
  ]);
  if (!ipVerdict.success || !searchVerdict.success) {
    return json(429, { error: "rate limited" });
  }

  const url = new URL(request.url);
  const slug = parseInstitutionSlug(url.searchParams.get("slug"));
  if (!slug) {
    return json(400, { error: "invalid slug" });
  }

  await ensureSchema();
  await ensureProfileSchema();

  let institution;
  try {
    institution = await getInstitutionByDomain(slug);
  } catch {
    return json(500, { error: "lookup failed" });
  }

  if (!institution) {
    // Valid request, but no listed member shares this domain yet.
    return json(200, { found: false });
  }

  return json(200, { found: true, institution });
}
