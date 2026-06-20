// Lab BYO ("bring your own") static-site GitHub-CONNECT + SYNC endpoint
// (lab-domains BYO GitHub-connect Slice A + Phase B, social lane).
//
//   POST /api/social/lab-site/byo/github
//     Body: { action: "connect", owner, repo, ref, subdir? }
//       -> DETECT repo type via classifyRepo (Phase B):
//            "tool" path: ingestToolRepo + upsertToolGithub, returns { kind:"tool", ... }.
//            "site" path: existing pullGithubZipball + validateByoEntries + R2, returns { kind:"site", ... }.
//     Body: { action: "sync" }
//       -> re-pull the lab's RECORDED connection and re-store (manual "sync now").
//     Body: { action: "disconnect" }
//       -> forget the connection (leaves any already-stored files in place).
//     -> { ok, kind, ... } on a pull, { ok } on disconnect.
//
// Phase B classification: at connect time, BEFORE pulling the zipball, the route
// fetches the repo's root file listing and Pages-enabled flag (via the SSRF-guarded
// fetchRepoRootListing + fetchPagesEnabled helpers in lab-byo-github.ts), then calls
// classifyRepo(). A "tool" repo skips the zipball/R2 path entirely and runs through
// ingestToolRepo + upsertToolGithub instead. A "site" repo follows the original path
// byte-for-byte. The response always includes a "kind" field so the dashboard can
// surface the detected type and the right public URL.
//
// AUTHZ (fail closed, IDENTICAL to the upload route, PLUS the BYO sub-flag):
//   1. flag(s)     isLabByoSitesEnabled() else 404 (inert unless BOTH flags on).
//   2. signed in   caller owner key from the SESSION, never the body. No key => 401.
//   3. owns lab    the connection/site is the caller's OWN lab (authorizeWrite
//                  enforces target === caller by construction).
//   4. entitled    isLabPublishEntitled(callerOwnerKey) === true, else 403.
//   + no site yet (the lab must have claimed a slug first) => 409 "no site".
//   + R2 not configured => 503 "hosting unavailable" (site path only).
//   + repo invalid / traversal / over caps / no index.html => 422 with a reason.
//   + sync with no recorded connection => 409 "not connected".
//
// SECURITY: owner/repo/ref are charset-validated (SSRF guard, only api.github.com /
// raw.githubusercontent.com / codeload.github.com are ever fetched) BEFORE recording
// or fetching; every pulled entry passes the SAME zip-slip sanitizer
// (validateByoEntries) before any byte touches R2; a single bad entry fails the WHOLE
// sync, so nothing is partially stored.
//
// setHostedAssetBytes lives in @/lib/collab/server/db and is used READ-ONLY here.
// Reads env: LAB_SITES_ENABLED, LAB_BYO_SITES, GITHUB_TOKEN (optional), R2_*,
// DATABASE_URL, AUTH_* + pepper.

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
import {
  deleteByoGithubRow,
  getByoGithubByOwner,
  recordByoGithubSync,
  upsertByoGithub,
  upsertByoSite,
} from "@/lib/social/lab-byo-db";
import {
  byoAssetId,
  byoLabFragment,
  contentTypeForPath,
  serializeByoManifest,
  validateByoEntries,
} from "@/lib/social/lab-byo";
import {
  fetchPagesEnabled,
  fetchRepoRootListing,
  parseGithubConnection,
  pullGithubZipball,
  type GithubConnection,
} from "@/lib/social/lab-byo-github";
import { resolveCallerOwnerKey } from "@/lib/social/lab-site-session";
import { isLabByoSitesEnabled } from "@/lib/social/config";
import { classifyRepo, detectReadmeFilename } from "@/lib/social/lab-repo-classify";
import { ingestToolRepo } from "@/lib/social/lab-tool-ingest";
import { getToolByOwner } from "@/lib/social/lab-tool-db";

export const runtime = "nodejs";

/** Map a github-pull error to a 422 reason string for the dashboard. */
function pullErrorReason(error: string): string {
  switch (error) {
    case "not-found":
      return "repo-not-found";
    case "rate-limited":
      return "rate-limited";
    case "too-large":
      return "too-large";
    case "bad-zip":
      return "bad-zip";
    case "bad-connection":
      return "bad-connection";
    default:
      return "fetch-failed";
  }
}

/**
 * Shared pull -> validate -> store -> manifest -> billing pipeline for a VALIDATED
 * connection and an already-authorized owner. Mirrors the upload route exactly,
 * differing only in the SOURCE of the entries (a GitHub zipball vs an uploaded
 * zip). Returns a Response (the route returns it directly). Always includes
 * kind:"site" in the success payload so the dashboard can show the right URL.
 */
async function pullAndStore(
  ownerKey: string,
  conn: GithubConnection,
): Promise<Response> {
  // Pull the zipball + strip the wrapper folder / subdir (the IO edge).
  const pulled = await pullGithubZipball(conn);
  if (!pulled.ok) {
    const status = pulled.error === "fetch-failed" ? 502 : 422;
    return json(status, { error: "sync failed", reason: pullErrorReason(pulled.error) });
  }

  // Validate every entry path (zip-slip) + caps + require root index.html in the
  // pure core. A single bad entry fails the WHOLE sync, so nothing is partially
  // stored. This is the SAME bar a manual upload is held to.
  const result = validateByoEntries(pulled.entries);
  if (!result.ok) {
    return json(422, { error: "invalid site", reason: result.error });
  }

  const fragment = byoLabFragment(ownerKey);

  // Replace any previous BYO site for this lab first, so a re-sync never leaves
  // orphaned files from the old pull reachable.
  try {
    await deleteByoSite(fragment);
  } catch {
    // Best effort: the new files overwrite by key; continue to store the pull.
  }

  // Store each validated file to R2 with its per-extension Content-Type. relPath is
  // already sanitized, so byoFileKey is a safe join.
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

  // Record the successful sync's resolved sha on the connection (best effort).
  try {
    await recordByoGithubSync({
      labOwnerKey: ownerKey,
      resolvedSha: pulled.resolvedRef,
    });
  } catch {
    // Non-fatal: the files + manifest are stored; the marker is cosmetic.
  }

  // Report total bytes to billing (one metered asset per BYO site). READ-ONLY use.
  try {
    await setHostedAssetBytes(
      byoAssetId(ownerKey),
      ownerKey,
      result.manifest.totalBytes,
    );
  } catch {
    // A billing-report failure must not lose the synced site; reconcile re-sums.
  }

  return json(200, {
    ok: true,
    kind: "site" as const,
    fileCount: result.manifest.files.length,
    totalBytes: result.manifest.totalBytes,
    indexPath: result.manifest.indexPath,
    resolvedRef: pulled.resolvedRef,
  });
}

/**
 * Tool-ingest path: classify said "tool", so run ingestToolRepo instead of the
 * zipball/R2 path. Returns a Response with kind:"tool" on success.
 *
 * The R2 asset store is NOT needed here. The function is only called from the
 * connect action (not sync) because the sync path re-uses the recorded connection
 * type from the BYO table, which does not exist for a tool (they are stored in
 * lab_tool_github). A tool "re-sync" triggers a fresh connect.
 */
async function ingestTool(
  ownerKey: string,
  conn: GithubConnection,
  rootFileNames: string[],
): Promise<Response> {
  const readmeFilename = detectReadmeFilename(rootFileNames) ?? "README.md";
  const result = await ingestToolRepo({
    labOwnerKey: ownerKey,
    owner: conn.owner,
    repo: conn.repo,
    readmeFilename,
  });
  if (!result) {
    // ingestToolRepo returns null when owner/repo validation fails or the repo
    // metadata cannot be fetched (does not exist or is private).
    return json(422, { error: "invalid site", reason: "repo-not-found" });
  }
  return json(200, {
    ok: true,
    kind: "tool" as const,
    repoName: result.meta.name,
    pageCount: result.publishedPaths.length,
    owner: conn.owner,
    repo: conn.repo,
  });
}

export async function POST(request: Request): Promise<Response> {
  // 1. flag(s).
  if (!isLabByoSitesEnabled()) return json(404, { error: "not found" });

  // 2-4. session -> ownership -> entitlement.
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

  // The lab must have a claimed slug / site (the serve route resolves by slug).
  let site;
  try {
    site = await getSiteByOwner(ownerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!site) return json(409, { error: "no site" });

  // Parse the action body.
  let body: { action?: unknown; owner?: unknown; repo?: unknown; ref?: unknown; subdir?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "invalid request" });
  }
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "disconnect") {
    try {
      await deleteByoGithubRow(ownerKey);
    } catch {
      return json(503, { error: "store unavailable" });
    }
    return json(200, { ok: true });
  }

  if (action === "connect") {
    const conn = parseGithubConnection(body);
    if (!conn) {
      return json(422, { error: "invalid site", reason: "bad-connection" });
    }

    // Phase B: classify the repo BEFORE pulling. Fetch the root file list and
    // GitHub Pages flag in parallel (both SSRF-guarded, api.github.com only),
    // then call the pure classifyRepo() to decide the path.
    const [rootFileNames, pagesEnabled] = await Promise.all([
      fetchRepoRootListing(conn.owner, conn.repo),
      fetchPagesEnabled(conn.owner, conn.repo),
    ]);
    const repoKind = classifyRepo({ rootFileNames, pagesEnabled });

    if (repoKind === "tool") {
      // Tool path: ingest README + wiki pages via ingestToolRepo.
      // No BYO record or R2 needed (tool connections are tracked in lab_tool_github).
      return ingestTool(ownerKey, conn, rootFileNames);
    }

    // Site path: the existing BYO flow, byte-identical to Slice A.
    // R2 is required for site hosting; check here rather than before the branch so
    // a tool connect does not fail with a spurious "hosting unavailable" error on
    // a server that has not configured R2.
    if (!isAssetStoreConfigured()) {
      return json(503, { error: "hosting unavailable" });
    }

    // Record the connection BEFORE the pull so a later "sync now" has it even if
    // the first pull fails (the lab can fix the repo and retry).
    try {
      await upsertByoGithub({
        labOwnerKey: ownerKey,
        owner: conn.owner,
        repo: conn.repo,
        ref: conn.ref,
        subdir: conn.subdir,
      });
    } catch {
      return json(503, { error: "store unavailable" });
    }
    return pullAndStore(ownerKey, conn);
  }

  if (action === "sync") {
    // Sync always follows the BYO (site) path: it re-pulls the RECORDED zipball
    // connection. A tool re-sync is performed by re-connecting (no BYO row exists
    // for tool connections). R2 is required.
    if (!isAssetStoreConfigured()) {
      return json(503, { error: "hosting unavailable" });
    }
    let recorded;
    try {
      recorded = await getByoGithubByOwner(ownerKey);
    } catch {
      return json(503, { error: "store unavailable" });
    }
    if (!recorded) return json(409, { error: "not connected" });
    // Re-validate the recorded values defensively before fetching.
    const conn = parseGithubConnection(recorded);
    if (!conn) {
      return json(422, { error: "invalid site", reason: "bad-connection" });
    }
    return pullAndStore(ownerKey, conn);
  }

  return json(400, { error: "invalid request" });
}

/** GET returns the lab's recorded connection (no secrets) so the dashboard can
 *  show the connected repo + last sync. Same fail-closed authz as POST. */
export async function GET(): Promise<Response> {
  if (!isLabByoSitesEnabled()) return json(404, { error: "not found" });

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

  // Check BYO (site) connection first, then fall back to tool connection.
  // The two are mutually exclusive per lab: a connect always goes through
  // classification and only writes ONE of the two tables.
  let recorded;
  try {
    recorded = await getByoGithubByOwner(ownerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }

  if (recorded) {
    return json(200, {
      connection: {
        kind: "site" as const,
        owner: recorded.owner,
        repo: recorded.repo,
        ref: recorded.ref,
        subdir: recorded.subdir,
        lastSyncedSha: recorded.lastSyncedSha,
        lastSyncedAt: recorded.lastSyncedAt,
      },
    });
  }

  // No BYO site row: check for a tool connection (Phase B).
  let toolRow;
  try {
    toolRow = await getToolByOwner(ownerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }

  if (toolRow) {
    return json(200, {
      connection: {
        kind: "tool" as const,
        owner: toolRow.owner,
        repo: toolRow.repo,
        repoName: toolRow.repoName,
        htmlUrl: toolRow.htmlUrl,
        updatedAt: toolRow.updatedAt,
      },
    });
  }

  return json(200, { connection: null });
}
