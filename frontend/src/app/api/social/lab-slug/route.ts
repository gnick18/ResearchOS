// Lab companion-site slug availability (lab-domains Phase 1, social lane).
//
// GET /api/social/lab-slug?slug=<desired>[&inst=<shortName>][&domain=<domain>]
//
// A login-free check of whether a desired lab slug is claimable in the unified
// namespace, plus deterministic institution-aware alternatives when it is not.
// This is the ONLY user-facing surface in Phase 1 and it is gated behind the
// SERVER flag LAB_SITES_ENABLED, default OFF, so the route 404s (indistinguishable
// from a missing route) until the feature is deliberately turned on. With the
// flag off the app is byte-identical.
//
// It lives on its OWN path under /api/social, NOT under /api/directory, so it
// does not touch the directory route tree. It reads the registry (slug_registry)
// for the prefix-matched taken set and answers from the pure slug-registry lib;
// it performs NO writes (the actual claim happens in a later phase / via the
// reserveSlug contract documented in the handoff).
//
// Reads env: LAB_SITES_ENABLED, DATABASE_URL.

import { isLabSitesEnabled } from "@/lib/social/config";
import { loadTakenSlugsWithPrefix } from "@/lib/social/slug-registry-db";
import {
  RESERVED_SLUGS,
  isSlugAvailable,
  normalizeSlug,
  suggestSlugs,
  validateSlug,
} from "@/lib/social/slug-registry";

export const runtime = "nodejs";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(request: Request): Promise<Response> {
  // SERVER gate. Off => 404, the surface stays fully dark by default.
  if (!isLabSitesEnabled()) {
    return json(404, { error: "not found" });
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get("slug") ?? "";
  const slug = normalizeSlug(raw);

  const structural = validateSlug(slug);
  if (structural !== null) {
    return json(400, {
      slug,
      available: false,
      reason: "invalid",
      error: structural,
    });
  }

  const instShort = url.searchParams.get("inst") ?? undefined;
  const instDomain = url.searchParams.get("domain") ?? undefined;

  // Load only the prefix-matched taken set so the pure availability/suggestion
  // logic has an accurate view without scanning the whole table.
  let taken: ReadonlySet<string>;
  try {
    taken = await loadTakenSlugsWithPrefix(slug);
  } catch {
    // A DB outage must not crash the check; report it as a 503 the caller can
    // retry, never a misleading "available".
    return json(503, { slug, available: false, reason: "unavailable" });
  }

  const available = isSlugAvailable(slug, { reserved: RESERVED_SLUGS, taken });
  if (available) {
    return json(200, { slug, available: true });
  }

  const reserved = RESERVED_SLUGS.has(slug);
  const suggestions = suggestSlugs(slug, {
    institutionShortName: instShort,
    institutionDomain: instDomain,
    reserved: RESERVED_SLUGS,
    taken,
  });
  return json(200, {
    slug,
    available: false,
    reason: reserved ? "reserved" : "taken",
    suggestions,
  });
}
