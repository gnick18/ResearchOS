// Lab companion-site blocks-page API (P2 companion builder, social lane).
//
// Two endpoints for the canvas editor to save and publish a BLOCKS page (a
// page whose body is blocks_json rather than body_md).
//
//   POST /api/social/lab-site/page/blocks
//     Save the current block array as a draft. The blocks_json column is
//     written via setPageBlocksJson; body_md is cleared so the old markdown
//     body never resurfaces. The page must already exist (upsertPage creates
//     it the first time a title is set); this endpoint only updates the block
//     array. Body: { path, title, blocksJson }.
//
//   PUT /api/social/lab-site/page/blocks
//     Publish the page with the frozen snapshot bundle (baked client-side).
//     Calls publishPage with the snapshotsJson that the canvas baked for each
//     data block's embed href via scanBlockEmbedHrefs + bakeOne. Body:
//     { path, snapshots? }.
//
// Auth: same three-check fail-closed sequence as the markdown page route
// (flag -> session -> owner -> entitlement).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { isLabPublishEntitled } from "@/lib/billing/db";
import { json } from "@/lib/social/guard";
import {
  authorizeWrite,
  parsePublishPageBody,
} from "@/lib/social/lab-site-authoring";
import {
  getSiteByOwner,
  publishPage,
  upsertPage,
  setPageBlocksJson,
  getPageBlocksJson,
} from "@/lib/social/lab-site-db";
import { resolveCallerOwnerKey } from "@/lib/social/lab-site-session";
import { isLabSitesEnabled } from "@/lib/social/config";
import {
  parseSnapshotBundle,
  serializeSnapshotBundle,
} from "@/lib/social/lab-site-snapshots";
import { MAX_BLOCKS_JSON_BYTES } from "@/lib/social/lab-site-blocks";

export const runtime = "nodejs";

/** Shared auth gate for both endpoints. */
async function authorizeBlocksWrite(): Promise<
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
// GET: fetch the current blocks_json for a page
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const gate = await authorizeBlocksWrite();
  if (!gate.ok) return gate.response;
  const { ownerKey } = gate;

  const { searchParams } = new URL(request.url);
  const path = searchParams.get("path") ?? "";

  let blocksJson: string | null;
  try {
    blocksJson = await getPageBlocksJson(ownerKey, path);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  return json(200, { blocksJson });
}

// ---------------------------------------------------------------------------
// Request-body validators (pure)
// ---------------------------------------------------------------------------

interface SaveBlocksBody {
  path: string;
  title: string;
  blocksJson: string;
}

function parseSaveBlocksBody(body: unknown): SaveBlocksBody | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.path !== "string") return null;
  if (typeof b.title !== "string") return null;
  if (typeof b.blocksJson !== "string") return null;
  if (b.blocksJson.length > MAX_BLOCKS_JSON_BYTES) return null;
  return { path: b.path, title: b.title.slice(0, 200), blocksJson: b.blocksJson };
}

// ---------------------------------------------------------------------------
// POST: save blocks draft
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const gate = await authorizeBlocksWrite();
  if (!gate.ok) return gate.response;
  const { ownerKey } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = parseSaveBlocksBody(body);
  if (!parsed) return json(400, { error: "invalid request" });

  let site;
  try {
    site = await getSiteByOwner(ownerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!site) return json(409, { error: "no site" });

  // Ensure the page row exists with the correct title. upsertPage creates or
  // updates the title; setting body_md to "" is fine because setPageBlocksJson
  // will clear it anyway. We call upsertPage first so the row exists before
  // setPageBlocksJson tries to UPDATE it.
  try {
    await upsertPage({
      labOwnerKey: ownerKey,
      path: parsed.path,
      title: parsed.title,
      bodyMd: "",
    });
  } catch {
    return json(503, { error: "store unavailable" });
  }

  // Write blocks_json (also clears body_md + resets to draft).
  let updated: boolean;
  try {
    updated = await setPageBlocksJson(ownerKey, parsed.path, parsed.blocksJson);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!updated) return json(404, { error: "page not found after upsert" });

  return json(200, { ok: true, path: parsed.path });
}

// ---------------------------------------------------------------------------
// PUT: publish blocks page with baked snapshots
// ---------------------------------------------------------------------------

export async function PUT(request: Request): Promise<Response> {
  const gate = await authorizeBlocksWrite();
  if (!gate.ok) return gate.response;
  const { ownerKey } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  // Re-use the shared publish body parser (path + optional snapshots).
  const parsed = parsePublishPageBody(body);
  if (!parsed) return json(400, { error: "invalid request" });

  let site;
  try {
    site = await getSiteByOwner(ownerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!site) return json(409, { error: "no site" });

  // Validate the snapshot bundle (same defensive boundary as the markdown route).
  const bundle = parseSnapshotBundle(parsed.snapshots);
  const snapshotsJson =
    Object.keys(bundle.snapshots).length > 0
      ? serializeSnapshotBundle(bundle)
      : null;

  let page;
  try {
    page = await publishPage(ownerKey, parsed.path, snapshotsJson, null);
  } catch {
    return json(503, { error: "store unavailable" });
  }
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
