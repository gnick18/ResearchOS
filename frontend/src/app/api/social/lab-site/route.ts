// Lab companion-site authoring API, the site resource (lab-domains Phase 3a,
// social lane).
//
//   GET  /api/social/lab-site  -> the caller's lab site + its pages (dashboard
//                                 load). 200 always when entitled; site is null
//                                 until the lab claims a slug.
//   POST /api/social/lab-site  -> claim a slug + create the lab's site. Body:
//                                 { slug, institutionShortName?, institutionDomain? }
//                                 409 with suggestions when the slug is taken.
//
// AUTHZ (every write, fail closed):
//   1. flag        isLabSitesEnabled() must be true, else 404 (route is inert).
//   2. signed in   the caller owner key is resolved from the SESSION
//                  (resolveCallerOwnerKey -> ownerKeyForEmail), never the body.
//                  No key => 401.
//   3. owns lab    create-site targets the caller's OWN lab by construction (a
//                  lab is keyed by its billing owner key), so targetOwnerKey ===
//                  callerOwnerKey. A mismatch is impossible here but the pure
//                  authorizeWrite still enforces it.
//   4. entitled    isLabPublishEntitled(callerOwnerKey) === true (active paid lab
//                  tier). Not entitled => 403.
//
// The slug claim is atomic via the Phase 1 registry: normalizeSlug ->
// isSlugAvailable (reserved + registry) -> reserveSlug(slug,"lab",ownerKey) ->
// createSite. reserveSlug is the global-uniqueness gate (slug PK), so a taken
// slug returns 409 with suggestSlugs alternatives. One site per lab: if the lab
// already has a site, POST returns it (200) rather than claiming a second slug.
//
// Reads env: LAB_SITES_ENABLED, DATABASE_URL, plus the AUTH_* + pepper vars used
// by the session/owner-key resolution.

import { isLabPublishEntitled } from "@/lib/billing/db";
import { json } from "@/lib/social/guard";
import {
  authorizeWrite,
  parseCreateSiteBody,
} from "@/lib/social/lab-site-authoring";
import {
  createSite,
  getSiteByOwner,
  listPages,
} from "@/lib/social/lab-site-db";
import { resolveCallerOwnerKey } from "@/lib/social/lab-site-session";
import { isLabSitesEnabled } from "@/lib/social/config";
import {
  isSlugAvailable,
  normalizeSlug,
  suggestSlugs,
  validateSlug,
} from "@/lib/social/slug-registry";
import {
  getSlug,
  loadTakenSlugsWithPrefix,
  reserveSlug,
} from "@/lib/social/slug-registry-db";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// GET — the caller's site + pages (dashboard load)
// ---------------------------------------------------------------------------

export async function GET(): Promise<Response> {
  if (!isLabSitesEnabled()) return json(404, { error: "not found" });

  const callerOwnerKey = await resolveCallerOwnerKey();
  // Read still requires the full write authz: only the entitled owner may see
  // their own draft pages. authorizeWrite with target === caller covers
  // signed-in + entitled in one fail-closed decision.
  const entitled = callerOwnerKey
    ? await isLabPublishEntitled(callerOwnerKey)
    : false;
  const verdict = authorizeWrite({
    callerOwnerKey,
    targetOwnerKey: callerOwnerKey,
    entitled,
  });
  if (verdict.kind === "deny") {
    return json(verdict.status, { error: verdict.error });
  }

  const ownerKey = callerOwnerKey as string;
  let site = null;
  let pages: Awaited<ReturnType<typeof listPages>> = [];
  try {
    site = await getSiteByOwner(ownerKey);
    pages = site ? await listPages(ownerKey) : [];
  } catch {
    return json(503, { error: "store unavailable" });
  }
  return json(200, {
    site: site ? { slug: site.labSlug, createdAt: site.createdAt } : null,
    pages: pages.map((p) => ({
      path: p.path,
      title: p.title,
      status: p.status,
      version: p.version,
      updatedAt: p.updatedAt,
    })),
  });
}

// ---------------------------------------------------------------------------
// POST — claim a slug + create the lab's site
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  if (!isLabSitesEnabled()) return json(404, { error: "not found" });

  const callerOwnerKey = await resolveCallerOwnerKey();
  const entitled = callerOwnerKey
    ? await isLabPublishEntitled(callerOwnerKey)
    : false;
  // create-site targets the caller's own lab by construction.
  const verdict = authorizeWrite({
    callerOwnerKey,
    targetOwnerKey: callerOwnerKey,
    entitled,
  });
  if (verdict.kind === "deny") {
    return json(verdict.status, { error: verdict.error });
  }
  const ownerKey = callerOwnerKey as string;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = parseCreateSiteBody(body);
  if (!parsed) return json(400, { error: "invalid request" });

  // One site per lab: if the lab already claimed a slug, return it rather than
  // claiming a second. This makes POST idempotent for an already-provisioned lab.
  try {
    const existing = await getSiteByOwner(ownerKey);
    if (existing) {
      return json(200, {
        site: { slug: existing.labSlug, createdAt: existing.createdAt },
        alreadyExisted: true,
      });
    }
  } catch {
    return json(503, { error: "store unavailable" });
  }

  const slug = normalizeSlug(parsed.slug);
  const structural = validateSlug(slug);
  if (structural !== null) {
    return json(400, { error: "invalid slug", message: structural });
  }

  // Availability against the registry (reserved words + already-taken slugs that
  // share the prefix). loadTakenSlugsWithPrefix feeds both the availability check
  // and the suggestion filter from one query.
  let taken: Set<string>;
  try {
    taken = await loadTakenSlugsWithPrefix(slug);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!isSlugAvailable(slug, { taken })) {
    const suggestions = suggestSlugs(slug, {
      institutionShortName: parsed.institutionShortName,
      institutionDomain: parsed.institutionDomain,
      taken,
    });
    return json(409, { error: "slug taken", slug, suggestions });
  }

  // Atomic claim. reserveSlug is the global-uniqueness gate (slug PK): a
  // concurrent claim of the same slug returns reason "taken" even if it slipped
  // past the availability read above.
  let reserved;
  try {
    reserved = await reserveSlug(slug, "lab", ownerKey, ownerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!reserved.ok) {
    if (reserved.reason === "taken") {
      // Re-read the taken set so suggestions reflect the race winner.
      let taken2: Set<string> = taken;
      try {
        taken2 = await loadTakenSlugsWithPrefix(slug);
      } catch {
        /* fall back to the earlier set */
      }
      const suggestions = suggestSlugs(slug, {
        institutionShortName: parsed.institutionShortName,
        institutionDomain: parsed.institutionDomain,
        taken: taken2,
      });
      return json(409, { error: "slug taken", slug, suggestions });
    }
    return json(400, { error: "invalid slug", message: reserved.error });
  }

  // Slug is ours; create the site row.
  let site;
  try {
    site = await createSite(ownerKey, slug);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!site) {
    return json(503, { error: "store unavailable" });
  }
  return json(201, {
    site: { slug: site.labSlug, createdAt: site.createdAt },
  });
}

// ---------------------------------------------------------------------------
// GET availability probe is intentionally NOT here; the POST returns 409 with
// suggestions, and a separate read-only availability endpoint can be added later
// if the UI wants live "as you type" checks. Phase 3a keeps the surface minimal.
// ---------------------------------------------------------------------------
