// Lab companion-site authoring API, the page resource (lab-domains Phase 3a,
// social lane).
//
//   POST /api/social/lab-site/page  -> upsert a DRAFT page (create or edit body/
//                                      title). Body: { path, title, bodyMd,
//                                      siteOwnerKey? }. Editing a published page
//                                      resets it to draft (the DB layer enforces
//                                      this) so edits are not silently public until
//                                      re-published.
//   PUT  /api/social/lab-site/page  -> publish a page. Body: { path,
//                                      siteOwnerKey? }. The page must already exist
//                                      as a draft.
//
// AUTHZ (every write, fail closed):
//   1. flag        isLabSitesEnabled() true, else 404.
//   2. signed in   caller owner key from the SESSION, never the body. No key => 401.
//   3. owns lab OR holds an editor grant. Callers who are the lab owner write to
//                  their own site (targetOwnerKey === callerOwnerKey). Granted
//                  editors supply siteOwnerKey in the body to identify the site;
//                  isSiteEditor verifies the grant server-side. A non-owner with
//                  no grant or with a wrong siteOwnerKey gets a 403.
//   4. entitled    isLabPublishEntitled checked only for the lab owner. An editor
//                  inherits the PI's entitlement implicitly (the site exists, which
//                  means the PI is on a paid plan). Checking the PI's entitlement
//                  again on every editor write is correct but unnecessary; the site
//                  not-found 409 already acts as the implicit gate.
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
import {
  parseSnapshotBundle,
  serializeSnapshotBundle,
} from "@/lib/social/lab-site-snapshots";
import {
  parseHostedManifest,
  serializeHostedManifest,
} from "@/lib/social/lab-site-hosted";
import { isSiteEditor } from "@/lib/social/lab-site-editors-db";

export const runtime = "nodejs";

/**
 * Shared gate for both page writes: flag, session, then owner-OR-editor check.
 *
 * When the caller is the site owner, the existing authorizeWrite path runs
 * (owner check + entitlement). When the caller is NOT the site owner, we check
 * isSiteEditor against the siteOwnerKey from the request body. On success,
 * returns the resolved site owner key so both POST and PUT write to the correct
 * lab's rows.
 *
 * siteOwnerKey is extracted from the request body by the caller (POST or PUT)
 * because the body must be parsed once. We accept it here as an optional param.
 * A null/undefined siteOwnerKey means "try my own site first, then no fallback".
 */
async function authorizePageWrite(siteOwnerKeyFromBody?: string | null): Promise<
  { ok: true; ownerKey: string } | { ok: false; response: Response }
> {
  if (!isLabSitesEnabled()) {
    return { ok: false, response: json(404, { error: "not found" }) };
  }
  const callerOwnerKey = await resolveCallerOwnerKey();
  if (!callerOwnerKey) {
    return { ok: false, response: json(401, { error: "unauthorized" }) };
  }

  // Fast path: caller is the site owner (writes to their own lab).
  const targetOwnerKey = siteOwnerKeyFromBody ?? callerOwnerKey;
  if (targetOwnerKey === callerOwnerKey) {
    const entitled = await isLabPublishEntitled(callerOwnerKey);
    const verdict = authorizeWrite({ callerOwnerKey, targetOwnerKey: callerOwnerKey, entitled });
    if (verdict.kind === "deny") {
      return { ok: false, response: json(verdict.status, { error: verdict.error }) };
    }
    return { ok: true, ownerKey: callerOwnerKey };
  }

  // Editor path: caller is not the site owner; verify the editor grant.
  // The siteOwnerKey from the body identifies which lab's site is being edited.
  // isSiteEditor checks lab_site_editors for an active grant row.
  const granted = await isSiteEditor(targetOwnerKey, "", callerOwnerKey);
  if (!granted) {
    return { ok: false, response: json(403, { error: "forbidden" }) };
  }
  // Editor is authorized. Return the site owner key so the write targets the
  // correct lab's rows (not the editor's own rows).
  return { ok: true, ownerKey: targetOwnerKey };
}

// ---------------------------------------------------------------------------
// POST — upsert a draft page
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  // Parse the body FIRST so we can extract the optional siteOwnerKey for the
  // editor-grant path before the auth gate runs.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  // Extract siteOwnerKey defensively (a non-string value is treated as absent).
  const siteOwnerKeyFromBody =
    body && typeof body === "object" && !Array.isArray(body)
      ? ((body as Record<string, unknown>).siteOwnerKey as string | undefined)
      : undefined;

  const gate = await authorizePageWrite(
    typeof siteOwnerKeyFromBody === "string" ? siteOwnerKeyFromBody : null,
  );
  if (!gate.ok) return gate.response;
  const { ownerKey } = gate;

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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const siteOwnerKeyFromBody =
    body && typeof body === "object" && !Array.isArray(body)
      ? ((body as Record<string, unknown>).siteOwnerKey as string | undefined)
      : undefined;

  const gate = await authorizePageWrite(
    typeof siteOwnerKeyFromBody === "string" ? siteOwnerKeyFromBody : null,
  );
  if (!gate.ok) return gate.response;
  const { ownerKey } = gate;

  const parsed = parsePublishPageBody(body);
  if (!parsed) return json(400, { error: "invalid request" });

  let site;
  try {
    site = await getSiteByOwner(ownerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!site) return json(409, { error: "no site" });

  // Bake-on-publish (Phase 3b): the author baked every block embed CLIENT-SIDE
  // (svgToPngDataUrl needs a real canvas, so this can never run here) and sent
  // the frozen bundle. parseSnapshotBundle is the single defensive boundary for
  // the untrusted BakedEmbed shape, it drops anything malformed and caps the
  // count, so a buggy or malicious client can never store unbounded or unsafe
  // data. A bundle that serializes over the byte cap stores no snapshots (the
  // public page then shows the calm unavailable card per embed, never a crash).
  const bundle = parseSnapshotBundle(parsed.snapshots);
  const snapshotsJson =
    Object.keys(bundle.snapshots).length > 0
      ? serializeSnapshotBundle(bundle)
      : null;

  // Phase 4a: the hosted dataset-asset manifest. The author uploaded each
  // dataset's Parquet to R2 client-side (presign -> PUT -> register) and sent the
  // manifest. parseHostedManifest is the single defensive boundary for the
  // untrusted hosted shape: it drops anything malformed, rejects a bad assetId,
  // and caps the count. serializeHostedManifest returns null for an empty manifest,
  // so a page with no hosted datasets stores NULL and the public render falls back
  // to the baked snapshot per embed. The bytes were already reported to billing by
  // the register endpoint; this only stores the read pointers for the public page.
  const manifest = parseHostedManifest(parsed.hosted);
  const hostedJson = serializeHostedManifest(manifest);

  let page;
  try {
    page = await publishPage(ownerKey, parsed.path, snapshotsJson, hostedJson);
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
