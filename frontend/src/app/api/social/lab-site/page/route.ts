// Lab companion-site authoring API, the page resource (lab-domains Phase 3a,
// social lane).
//
//   POST /api/social/lab-site/page  -> upsert a DRAFT page (create or edit body/
//                                      title). Body: { path, title, bodyMd }.
//                                      Editing a published page resets it to draft
//                                      (the DB layer enforces this) so edits are
//                                      not silently public until re-published.
//   PUT  /api/social/lab-site/page  -> publish a page. Body: { path }. The page
//                                      must already exist as a draft.
//
// AUTHZ (every write, fail closed) is identical to the site route:
//   1. flag        isLabSitesEnabled() true, else 404.
//   2. signed in   caller owner key from the SESSION, never the body. No key => 401.
//   3. owns lab    the page is written to the caller's OWN site. We resolve the
//                  caller's site by owner key and write only there, so a caller
//                  can never target another lab's page. authorizeWrite enforces
//                  targetOwnerKey === callerOwnerKey.
//   4. entitled    isLabPublishEntitled(callerOwnerKey) === true, else 403.
//
// A caller with no site yet (never claimed a slug) gets 409 "no site" so the UI
// routes them to the claim step first.
//
// Reads env: LAB_SITES_ENABLED, DATABASE_URL, plus the AUTH_* + pepper vars.

import { isLabPublishEntitled } from "@/lib/billing/db";
import { json } from "@/lib/social/guard";
import {
  authorizeWrite,
  parsePublishPageBody,
  parseUpsertPageBody,
} from "@/lib/social/lab-site-authoring";
import {
  getSiteByOwner,
  publishPage,
  upsertPage,
} from "@/lib/social/lab-site-db";
import { resolveCallerOwnerKey } from "@/lib/social/lab-site-session";
import { isLabSitesEnabled } from "@/lib/social/config";

export const runtime = "nodejs";

/**
 * Shared gate for both page writes: flag, session, ownership (the caller's own
 * site), and entitlement. Returns either a denial Response, or the resolved
 * owner key on success. Centralizes the fail-closed sequence so POST and PUT
 * cannot drift.
 */
async function authorizePageWrite(): Promise<
  { ok: true; ownerKey: string } | { ok: false; response: Response }
> {
  if (!isLabSitesEnabled()) {
    return { ok: false, response: json(404, { error: "not found" }) };
  }
  const callerOwnerKey = await resolveCallerOwnerKey();
  const entitled = callerOwnerKey
    ? await isLabPublishEntitled(callerOwnerKey)
    : false;
  // Page writes target the caller's own lab; targetOwnerKey === callerOwnerKey.
  const verdict = authorizeWrite({
    callerOwnerKey,
    targetOwnerKey: callerOwnerKey,
    entitled,
  });
  if (verdict.kind === "deny") {
    return { ok: false, response: json(verdict.status, { error: verdict.error }) };
  }
  return { ok: true, ownerKey: callerOwnerKey as string };
}

// ---------------------------------------------------------------------------
// POST — upsert a draft page
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const gate = await authorizePageWrite();
  if (!gate.ok) return gate.response;
  const { ownerKey } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = parseUpsertPageBody(body);
  if (!parsed) return json(400, { error: "invalid request" });

  // The lab must have a site (claimed slug) before any page can be written.
  let site;
  try {
    site = await getSiteByOwner(ownerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!site) return json(409, { error: "no site" });

  let page;
  try {
    page = await upsertPage({
      labOwnerKey: ownerKey,
      path: parsed.path,
      title: parsed.title,
      bodyMd: parsed.bodyMd,
    });
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!page) return json(503, { error: "store unavailable" });
  return json(200, {
    page: {
      path: page.path,
      title: page.title,
      status: page.status,
      version: page.version,
      updatedAt: page.updatedAt,
    },
  });
}

// ---------------------------------------------------------------------------
// PUT — publish a page
// ---------------------------------------------------------------------------

export async function PUT(request: Request): Promise<Response> {
  const gate = await authorizePageWrite();
  if (!gate.ok) return gate.response;
  const { ownerKey } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = parsePublishPageBody(body);
  if (!parsed) return json(400, { error: "invalid request" });

  let site;
  try {
    site = await getSiteByOwner(ownerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!site) return json(409, { error: "no site" });

  let page;
  try {
    page = await publishPage(ownerKey, parsed.path);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  // publishPage returns null when the page does not exist (publish only acts on
  // an existing draft).
  if (!page) return json(404, { error: "page not found" });
  return json(200, {
    page: {
      path: page.path,
      title: page.title,
      status: page.status,
      version: page.version,
      updatedAt: page.updatedAt,
    },
  });
}
