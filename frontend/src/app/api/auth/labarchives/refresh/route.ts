import { NextRequest } from "next/server";
import { readLabArchivesCredsFromRequest } from "@/lib/labarchives/config";
import { signedLabArchivesFetch } from "@/lib/labarchives/signed-fetch";
import { withRateLimit } from "@/lib/api/rate-limit";

/**
 * `POST /api/auth/labarchives/refresh` — re-validate a stored UID.
 *
 * Mirrors the OAuth refresh route's contract from the caller's perspective:
 * a quick "is this connection still good?" check. LabArchives has no access
 * tokens that expire, so refresh is mostly a credential-still-valid probe —
 * we ping `users/user_info_via_id` with the stored UID. A 401/403 means the
 * UID is no longer valid and the client should kick the user back to the
 * connect step; a 5xx is treated as a transient upstream failure (502
 * passthrough) so the UI can retry without nuking the stored connection.
 *
 * Body:
 *   {
 *     uid: string;
 *     // Optional — sidecar-mode deployer creds (Phase 2 of LabArchives
 *     // local-first config). When env vars set the integration, this
 *     // field is ignored.
 *     deployerCreds?: { accessKeyId: string; accessPassword: string; baseUrl?: string };
 *   }
 * Returns `{ ok: true }` on success, `{ error }` + 4xx/5xx on failure.
 * Client-facing messages are deliberately generic — detail is logged
 * server-side via `console.warn`.
 */
async function handlePost(req: NextRequest): Promise<Response> {
  let body: { uid?: string; deployerCreds?: unknown };
  try {
    body = (await req.json()) as { uid?: string; deployerCreds?: unknown };
  } catch {
    return Response.json({ error: "Body must be JSON with { uid }." }, { status: 400 });
  }

  let creds;
  try {
    creds = readLabArchivesCredsFromRequest(req, body);
  } catch (err) {
    console.warn(
      "[labarchives/refresh] no usable credentials",
      err instanceof Error ? err.message : String(err),
    );
    return Response.json(
      { error: "LabArchives integration is not configured on this deployment." },
      { status: 500 },
    );
  }

  const uid = body.uid?.trim();
  if (!uid) {
    return Response.json({ error: "Missing uid." }, { status: 400 });
  }

  const apiMethod = "user_info_via_id";
  const result = await signedLabArchivesFetch(
    creds,
    apiMethod,
    `/users/${apiMethod}`,
    { params: { uid } },
  );

  if (result.kind === "network-error") {
    console.warn(
      "[labarchives/refresh] upstream network error",
      result.aborted ? "(timeout)" : "",
      result.error.message,
    );
    return Response.json(
      { error: "Stored connection check failed — could not reach LabArchives." },
      { status: 502 },
    );
  }

  const { res } = result;
  if (!res.ok) {
    // 401/403 = the stored UID is genuinely invalid (institutional credential
    // rotation, deleted user, etc.) — surface as 401 so the client kicks
    // back to the connect step. Anything else (5xx upstream, unexpected 4xx)
    // is a transient/proxy condition: return 502 so the UI can retry without
    // discarding the stored connection.
    const upstreamStatus = res.status;
    // Drain so the connection releases — we don't surface body details to
    // the client, only log them.
    const detail = await res.text().catch(() => "");
    console.warn(
      "[labarchives/refresh] upstream refused stored UID",
      `status=${upstreamStatus}`,
      `detailLen=${detail.length}`,
    );
    if (upstreamStatus === 401 || upstreamStatus === 403) {
      return Response.json(
        { error: "Stored connection is no longer valid — please reconnect." },
        { status: 401 },
      );
    }
    return Response.json(
      { error: "Stored connection check failed — please try again." },
      { status: 502 },
    );
  }
  return Response.json({ ok: true });
}

// 20/min — refresh fires once per page load / reconnect probe, well below
// this ceiling for any honest caller.
export const POST = withRateLimit(handlePost, {
  limit: 20,
  windowMs: 60_000,
  name: "labarchives-refresh",
});
