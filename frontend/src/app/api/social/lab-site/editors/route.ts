// Per-companion-site editor grants management API (lab-site builder, section A).
//
//   GET    /api/social/lab-site/editors?path=<path>
//     Owner-only. Lists all active editor grants for the caller's site and the
//     given path. Returns { editors: SiteEditorRow[] }.
//
//   POST   /api/social/lab-site/editors
//     Owner-only. Grants a member editor access to the caller's site.
//     Body: { path: string, memberKey: string }.
//     Returns { ok: true } on success.
//
//   DELETE /api/social/lab-site/editors
//     Owner-only. Revokes a member's editor grant.
//     Body: { path: string, memberKey: string }.
//     Returns { ok: true } on success.
//
// AUTHZ: OWNER-ONLY for all three methods. A granted editor cannot add or
// remove other editors; only the lab owner (the PI) manages grants. Fail-closed
// sequence: flag -> session -> entitlement (owner check is implicit: the
// caller's key is used as lab_owner_key, so a non-owner simply has no site to
// operate on and gets a 409 "no site").
//
// Reads env: LAB_SITES_ENABLED, DATABASE_URL, plus the AUTH_* + pepper vars.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { isLabPublishEntitled } from "@/lib/billing/db";
import { json } from "@/lib/social/guard";
import { authorizeWrite } from "@/lib/social/lab-site-authoring";
import { getSiteByOwner } from "@/lib/social/lab-site-db";
import { resolveCallerOwnerKey } from "@/lib/social/lab-site-session";
import { isLabSitesEnabled } from "@/lib/social/config";
import {
  grantSiteEditor,
  revokeSiteEditor,
  listSiteEditors,
} from "@/lib/social/lab-site-editors-db";
import { listLabMembers } from "@/lib/billing/lab";

export const runtime = "nodejs";

/**
 * Owner-only gate. The caller must be signed in and entitled on the lab plan.
 * The "owns the site" invariant is enforced implicitly: we always write to
 * callerOwnerKey as lab_owner_key, so a non-owner cannot target another lab.
 * Returns the resolved owner key on success.
 */
async function authorizeOwnerOnly(): Promise<
  { ok: true; ownerKey: string } | { ok: false; response: Response }
> {
  if (!isLabSitesEnabled()) {
    return { ok: false, response: json(404, { error: "not found" }) };
  }
  const callerOwnerKey = await resolveCallerOwnerKey();
  const entitled = callerOwnerKey
    ? await isLabPublishEntitled(callerOwnerKey)
    : false;
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
// GET: list editor grants for a site path
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const gate = await authorizeOwnerOnly();
  if (!gate.ok) return gate.response;
  const { ownerKey } = gate;

  const { searchParams } = new URL(request.url);
  const path = searchParams.get("path") ?? "";

  // Confirm the caller has a site (no-site owners have nothing to manage).
  let site;
  try {
    site = await getSiteByOwner(ownerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!site) return json(409, { error: "no site" });

  let editors;
  try {
    editors = await listSiteEditors(ownerKey, path);
  } catch {
    return json(503, { error: "store unavailable" });
  }

  // Also return the active billing members so the UI can build the "Add editor"
  // picker without a second request. Only active members are included (invited
  // members have not accepted yet and cannot log in to edit the site).
  let labMembers: Array<{ memberKey: string; label: string | null }> = [];
  try {
    const rows = await listLabMembers(ownerKey);
    labMembers = rows
      .filter((m) => m.status === "active")
      .map((m) => ({ memberKey: m.memberOwnerKey, label: m.label }));
  } catch {
    // Non-fatal: the editor list still renders, just without the member picker.
    labMembers = [];
  }

  return json(200, { editors, members: labMembers });
}

// ---------------------------------------------------------------------------
// POST: grant a member editor access
// ---------------------------------------------------------------------------

interface GrantBody {
  path: string;
  memberKey: string;
}

function parseGrantBody(body: unknown): GrantBody | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.path !== "string") return null;
  if (typeof b.memberKey !== "string" || b.memberKey.trim().length === 0) return null;
  return { path: b.path, memberKey: b.memberKey.trim() };
}

export async function POST(request: Request): Promise<Response> {
  const gate = await authorizeOwnerOnly();
  if (!gate.ok) return gate.response;
  const { ownerKey } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = parseGrantBody(body);
  if (!parsed) return json(400, { error: "invalid request" });

  // Cannot grant a member who is the owner (a PI is always the owner).
  if (parsed.memberKey === ownerKey) {
    return json(400, { error: "cannot grant the site owner as an editor" });
  }

  let site;
  try {
    site = await getSiteByOwner(ownerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!site) return json(409, { error: "no site" });

  try {
    await grantSiteEditor(ownerKey, parsed.path, parsed.memberKey, ownerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  return json(200, { ok: true });
}

// ---------------------------------------------------------------------------
// DELETE: revoke an editor grant
// ---------------------------------------------------------------------------

export async function DELETE(request: Request): Promise<Response> {
  const gate = await authorizeOwnerOnly();
  if (!gate.ok) return gate.response;
  const { ownerKey } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = parseGrantBody(body);
  if (!parsed) return json(400, { error: "invalid request" });

  let site;
  try {
    site = await getSiteByOwner(ownerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!site) return json(409, { error: "no site" });

  try {
    await revokeSiteEditor(ownerKey, parsed.path, parsed.memberKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  return json(200, { ok: true });
}
