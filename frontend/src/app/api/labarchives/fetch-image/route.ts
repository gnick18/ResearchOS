import { NextRequest } from "next/server";
import { readLabArchivesCreds } from "@/lib/labarchives/config";
import { signedLabArchivesFetch } from "@/lib/labarchives/signed-fetch";

/**
 * `POST /api/labarchives/fetch-image` — server-side proxy to
 * LabArchives' `entries/entry_attachment` endpoint.
 *
 * The wizard can't HMAC-sign client-side without leaking the
 * institutional `access_password`, so this route does the signing
 * server-side and streams the bytes back. Returns the raw image bytes
 * with a `content-type` mirrored from LabArchives.
 *
 * Body:
 *   {
 *     uid: string,             // per-user UID from /login
 *     entryPartId: string,     // parsed from Form-B ep_id ("eid" param)
 *   }
 *
 * Returns: image bytes on 200, JSON `{ error }` on 4xx/5xx. Client-facing
 * error messages are generic — see the round-2 hardening note in
 * `lib/api/url-guards.ts`. Upstream status / parsed `<error>` body are
 * logged server-side via `console.warn`. Timeout + retry-on-401 logic
 * lives in `signedLabArchivesFetch`.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let creds;
  try {
    creds = readLabArchivesCreds();
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Integration not configured" },
      { status: 500 },
    );
  }

  let body: { uid?: string; entryPartId?: string };
  try {
    body = (await req.json()) as { uid?: string; entryPartId?: string };
  } catch {
    return Response.json(
      { error: "Body must be JSON with { uid, entryPartId }." },
      { status: 400 },
    );
  }
  const uid = body.uid?.trim();
  const eid = body.entryPartId?.trim();
  if (!uid || !eid) {
    return Response.json(
      { error: "Missing uid or entryPartId." },
      { status: 400 },
    );
  }

  const apiMethod = "entry_attachment";
  const result = await signedLabArchivesFetch(
    creds,
    apiMethod,
    `/entries/${apiMethod}`,
    { params: { uid, eid } },
  );

  if (result.kind === "network-error") {
    console.warn(
      "[labarchives/fetch-image] upstream network error",
      result.aborted ? "(timeout)" : "",
      result.error.message,
    );
    return Response.json(
      { error: "Image fetch failed — could not reach LabArchives." },
      { status: 502 },
    );
  }

  const { res } = result;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const m = text.match(/<error[^>]*>([\s\S]*?)<\/error>/i);
    console.warn(
      "[labarchives/fetch-image] upstream error",
      `status=${res.status}`,
      m ? `detail=${m[1].trim()}` : `(bodyLen=${text.length})`,
    );
    // Authentication failures bubble up as 401 so the wizard can prompt
    // a reconnect. Everything else collapses to 502.
    return Response.json(
      { error: "Image fetch failed." },
      { status: res.status === 401 || res.status === 403 ? 401 : 502 },
    );
  }

  const bytes = await res.arrayBuffer();
  // Pass through LabArchives' Content-Type so the browser knows the kind.
  // Fall back to a generic stream type if absent.
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  return new Response(bytes, {
    status: 200,
    headers: { "content-type": contentType },
  });
}
