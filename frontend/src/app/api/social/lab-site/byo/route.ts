// Lab BYO ("bring your own") static-site UPLOAD endpoint (lab-domains BYO Slice 1,
// social lane).
//
//   POST /api/social/lab-site/byo
//     Body: a ZIP of a static site (Content-Type application/zip or octet-stream),
//           sent as the raw request body.
//     -> { ok, fileCount, totalBytes, indexPath }
//
// The author uploads a ZIP of their OWN static website. Unlike the Phase 4a Parquet
// flow (which presigns a direct-to-R2 PUT), the BYO bytes DO transit this server,
// because the server must unzip + SANITIZE the archive before storing it (a
// zip-slip entry must never reach R2). Each validated file is stored to R2 under a
// per-lab key prefix with its Content-Type, the file-list manifest is recorded in
// lab_byo_sites, and the total bytes are reported to billing via setHostedAssetBytes.
//
// AUTHZ (fail closed, IDENTICAL to the Phase 3a writes, PLUS the BYO sub-flag):
//   1. flag(s)     isLabByoSitesEnabled() (== isLabSitesEnabled() AND LAB_BYO_SITES)
//                  else 404, so BYO is inert unless BOTH flags are on.
//   2. signed in   caller owner key from the SESSION, never the body. No key => 401.
//   3. owns lab    the BYO site is keyed to the caller's OWN lab, so authorizeWrite
//                  enforces targetOwnerKey === callerOwnerKey by construction.
//   4. entitled    isLabPublishEntitled(callerOwnerKey) === true, else 403.
//   + no site yet (the lab must have claimed a slug first) => 409 "no site".
//   + R2 not configured => 503 "hosting unavailable" (no silent stub).
//   + zip invalid / traversal / over caps => 422 "invalid site" with a reason.
//
// SECURITY: every zip entry path is sanitized (sanitizeZipEntryPath, zip-slip
// defense) BEFORE any byte touches R2; a single bad entry fails the WHOLE upload.
// Sizes + file count are capped. The served bytes never run on research-os.app (see
// the serve route + handoff).
//
// setHostedAssetBytes lives in @/lib/collab/server/db and is used READ-ONLY here.
// Reads env: LAB_SITES_ENABLED, LAB_BYO_SITES, R2_*, DATABASE_URL, AUTH_* + pepper.

import { unzipSync } from "fflate";

import { setHostedAssetBytes } from "@/lib/collab/server/db";
import { isLabPublishEntitled } from "@/lib/billing/db";
import { json } from "@/lib/social/guard";
import { authorizeWrite } from "@/lib/social/lab-site-authoring";
import {
  deleteByoSite,
  isAssetStoreConfigured,
  putByoFile,
} from "@/lib/social/lab-site-asset-store";
import { getSiteByOwner } from "@/lib/social/lab-site-db";
import { upsertByoSite } from "@/lib/social/lab-byo-db";
import {
  BYO_MAX_TOTAL_BYTES,
  byoAssetId,
  byoLabFragment,
  contentTypeForPath,
  serializeByoManifest,
  validateByoEntries,
} from "@/lib/social/lab-byo";
import { resolveCallerOwnerKey } from "@/lib/social/lab-site-session";
import { isLabByoSitesEnabled } from "@/lib/social/config";

export const runtime = "nodejs";

/** Body-size guard BEFORE buffering the whole request: a Content-Length over the
 *  cap (with slack for zip overhead) is rejected without reading the body. The
 *  unzipped-total cap is the real gate (validateByoEntries); this only stops an
 *  obviously oversized upload early. */
const MAX_ZIP_BYTES = BYO_MAX_TOTAL_BYTES;

export async function POST(request: Request): Promise<Response> {
  // 1. flag(s) (lab-sites AND the BYO sub-flag).
  if (!isLabByoSitesEnabled()) return json(404, { error: "not found" });

  // 2-4. session -> ownership -> entitlement (a BYO site always targets the
  // caller's own lab, so target === caller).
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
    return json(verdict.status, { error: verdict.error });
  }
  const ownerKey = callerOwnerKey as string;

  // The lab must have a claimed slug / site before it can host a BYO site (the
  // serve route resolves the lab from its slug).
  let site;
  try {
    site = await getSiteByOwner(ownerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!site) return json(409, { error: "no site" });

  if (!isAssetStoreConfigured()) {
    return json(503, { error: "hosting unavailable" });
  }

  // Early size guard via Content-Length (a string header from an untrusted client).
  const lenHeader = request.headers.get("content-length");
  if (lenHeader) {
    const len = Number(lenHeader);
    if (Number.isFinite(len) && len > MAX_ZIP_BYTES) {
      return json(422, { error: "invalid site", reason: "too-large" });
    }
  }

  // Buffer the raw zip bytes.
  let zipBytes: Uint8Array;
  try {
    const buf = await request.arrayBuffer();
    zipBytes = new Uint8Array(buf);
  } catch {
    return json(400, { error: "invalid request" });
  }
  if (zipBytes.byteLength === 0) {
    return json(422, { error: "invalid site", reason: "empty" });
  }
  if (zipBytes.byteLength > MAX_ZIP_BYTES) {
    return json(422, { error: "invalid site", reason: "too-large" });
  }

  // Unzip server-side. fflate's unzipSync throws on a corrupt archive.
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(zipBytes);
  } catch {
    return json(422, { error: "invalid site", reason: "bad-zip" });
  }

  // Validate every entry path (zip-slip) + caps in the pure core. A single bad
  // entry fails the whole upload, so nothing is partially stored.
  const entries = Object.entries(unzipped).map(([rawPath, bytes]) => ({
    rawPath,
    bytes,
  }));
  const result = validateByoEntries(entries);
  if (!result.ok) {
    return json(422, { error: "invalid site", reason: result.error });
  }

  const fragment = byoLabFragment(ownerKey);

  // Replace any previous BYO site for this lab first, so a re-upload never leaves
  // orphaned files from the old site reachable.
  try {
    await deleteByoSite(fragment);
  } catch {
    // Best effort: a failed cleanup is not fatal (the new files overwrite by key);
    // continue to store the fresh upload.
  }

  // Store each validated file to R2 with its per-extension Content-Type. The
  // relPath is already sanitized, so byoFileKey is a safe join.
  for (const file of result.files) {
    const contentType = contentTypeForPath(file.path);
    const ok = await putByoFile(fragment, file.path, file.bytes, contentType);
    if (!ok) {
      return json(503, { error: "hosting unavailable" });
    }
  }

  // Record the manifest (file list + index + total bytes).
  const manifestJson = serializeByoManifest(result.manifest);
  if (!manifestJson) {
    // Only happens for an empty manifest (already guarded) or an over-cap blob.
    return json(422, { error: "invalid site", reason: "too-large" });
  }
  try {
    await upsertByoSite({
      labOwnerKey: ownerKey,
      manifestJson,
      totalBytes: result.manifest.totalBytes,
    });
  } catch {
    return json(503, { error: "store unavailable" });
  }

  // Report total bytes to billing (one metered asset per BYO site). READ-ONLY use
  // of the billing primitive: we report the byte count, we never compute a price.
  try {
    await setHostedAssetBytes(
      byoAssetId(ownerKey),
      ownerKey,
      result.manifest.totalBytes,
    );
  } catch {
    // A billing-report failure must not lose the uploaded site; the GC/reconcile
    // path can re-sum later. Surface success for the upload itself.
  }

  return json(200, {
    ok: true,
    fileCount: result.manifest.files.length,
    totalBytes: result.manifest.totalBytes,
    indexPath: result.manifest.indexPath,
  });
}
