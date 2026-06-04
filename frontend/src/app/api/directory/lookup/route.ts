// Cross-boundary sharing, directory lookup route (Phase 1b-ii).
//
// POST { email }. Returns the public keys and fingerprint a sender needs to seal
// a bundle to a recipient, or a uniform not-found. POST (not GET) keeps the
// plaintext email out of URLs and access logs. Exact-hash match only, never a
// prefix or a list, so the directory cannot be enumerated (section 6 of
// docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md). The backup blob is never
// returned here.
//
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL,
// KV_REST_API_URL, KV_REST_API_TOKEN.

import { canonicalizeEmail, hashEmail } from "@/lib/sharing/directory/email";
import { ensureSchema, getBindingByHash } from "@/lib/sharing/directory/db";
import { getIpLimiter } from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  getPepper,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import {
  parseEmailBody,
  shapeLookupResult,
} from "@/lib/sharing/directory/validation";

export const runtime = "nodejs";

// Uniform not-found, returned whether the email is malformed or simply not in
// the directory, so a caller cannot distinguish the two.
const NOT_FOUND = { found: false } as const;

export async function POST(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  const ip = extractClientIp(request.headers);
  const ipVerdict = await getIpLimiter().limit(ip);
  if (!ipVerdict.success) {
    return json(429, { error: "rate limited" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = parseEmailBody(body);
  if (!parsed) {
    // A malformed email collapses into the same not-found, not a 400, so the
    // response shape does not depend on the input.
    return json(200, NOT_FOUND);
  }

  const canonical = canonicalizeEmail(parsed.email);
  const emailHash = hashEmail(canonical, getPepper());

  await ensureSchema();

  const binding = await getBindingByHash(emailHash);
  if (!binding) {
    return json(200, NOT_FOUND);
  }

  return json(200, { found: true, ...shapeLookupResult(binding) });
}
