// Lab companion-site deploy-history API (lab-domains Phase 5a, social lane).
//
//   GET  /api/social/lab-site/page/versions?path=<path>[&siteOwnerKey=<key>]
//        Returns the version list for one page (newest first). Each entry
//        carries version, title, publishedAt, and isLive. The caller is the
//        site owner OR a verified granted editor.
//
//   POST /api/social/lab-site/page/versions
//        Body: { path, version, siteOwnerKey? }
//        Restores the given historical version as a new live publish. The
//        restored-from version stays in history unchanged (never destructive).
//
// AUTHZ (every request, fail closed):
//   1. flag        isLabSitesEnabled() must be true, else 404.
//   2. signed in   caller owner key resolved from the SESSION. No key => 401.
//   3. owner OR editor grant, exactly matching the page route's
//      authorizePageWrite pattern. The siteOwnerKey query/body param is
//      threaded through for the granted-editor case.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { isLabPublishEntitled } from "@/lib/billing/db";
import { json } from "@/lib/social/guard";
import { authorizeWrite } from "@/lib/social/lab-site-authoring";
import {
  listPageVersions,
  restorePageVersion,
} from "@/lib/social/lab-site-db";
import { resolveCallerOwnerKey } from "@/lib/social/lab-site-session";
import { isLabSitesEnabled } from "@/lib/social/config";
import { isSiteEditor } from "@/lib/social/lab-site-editors-db";
import { normalizePagePath } from "@/lib/social/lab-site";

export const runtime = "nodejs";

/**
 * Shared authz gate for both handlers: flag, session, then owner-or-editor.
 * Mirrors authorizePageWrite in the page route exactly.
 */
async function gate(siteOwnerKeyFromCaller?: string | null): Promise<
  { ok: true; ownerKey: string } | { ok: false; response: Response }
> {
  if (!isLabSitesEnabled()) {
    return { ok: false, response: json(404, { error: "not found" }) };
  }
  const callerOwnerKey = await resolveCallerOwnerKey();
  if (!callerOwnerKey) {
    return { ok: false, response: json(401, { error: "unauthorized" }) };
  }

  const targetOwnerKey = siteOwnerKeyFromCaller ?? callerOwnerKey;

  if (targetOwnerKey === callerOwnerKey) {
    // Owner path: check entitlement.
    const entitled = await isLabPublishEntitled(callerOwnerKey);
    const verdict = authorizeWrite({
      callerOwnerKey,
      targetOwnerKey: callerOwnerKey,
      entitled,
    });
    if (verdict.kind === "deny") {
      return { ok: false, response: json(verdict.status, { error: verdict.error }) };
    }
    return { ok: true, ownerKey: callerOwnerKey };
  }

  // Editor path: caller is not the site owner; verify the grant.
  const granted = await isSiteEditor(targetOwnerKey, "", callerOwnerKey);
  if (!granted) {
    return { ok: false, response: json(403, { error: "forbidden" }) };
  }
  return { ok: true, ownerKey: targetOwnerKey };
}

// ---------------------------------------------------------------------------
// GET -- list versions for one page
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const siteOwnerKey = searchParams.get("siteOwnerKey");
  const pathParam = searchParams.get("path");

  const auth = await gate(siteOwnerKey);
  if (!auth.ok) return auth.response;
  const { ownerKey } = auth;

  if (pathParam === null) {
    return json(400, { error: "path is required" });
  }

  let versions;
  try {
    versions = await listPageVersions(ownerKey, pathParam);
  } catch {
    return json(503, { error: "store unavailable" });
  }

  return json(200, { versions });
}

// ---------------------------------------------------------------------------
// POST -- restore a historical version as a new publish
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
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

  const auth = await gate(
    typeof siteOwnerKeyFromBody === "string" ? siteOwnerKeyFromBody : null,
  );
  if (!auth.ok) return auth.response;
  const { ownerKey } = auth;

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return json(400, { error: "invalid request" });
  }

  const bodyObj = body as Record<string, unknown>;
  const pathParam = typeof bodyObj.path === "string" ? bodyObj.path : null;
  const versionParam =
    typeof bodyObj.version === "number"
      ? bodyObj.version
      : typeof bodyObj.version === "string"
        ? parseInt(bodyObj.version, 10)
        : null;

  if (pathParam === null || versionParam === null || isNaN(versionParam)) {
    return json(400, { error: "path and version are required" });
  }

  const normalizedPath = normalizePagePath(pathParam);

  let page;
  try {
    page = await restorePageVersion(ownerKey, normalizedPath, versionParam);
  } catch {
    return json(503, { error: "store unavailable" });
  }

  if (!page) {
    return json(404, { error: "version not found" });
  }

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
