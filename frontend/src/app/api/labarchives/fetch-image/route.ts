import { NextRequest } from "next/server";
import { readLabArchivesCreds } from "@/lib/labarchives/config";
import { buildSignedParams } from "@/lib/labarchives/sign";

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
 * Returns: image bytes on 200, JSON `{ error }` on 4xx/5xx.
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
  const signed = buildSignedParams(creds.accessKeyId, creds.accessPassword, apiMethod);
  const url = new URL(`${creds.baseUrl}/entries/${apiMethod}`);
  url.searchParams.set("akid", signed.akid);
  url.searchParams.set("expires", signed.expires);
  url.searchParams.set("sig", signed.sig);
  url.searchParams.set("uid", uid);
  url.searchParams.set("eid", eid);

  let res: Response;
  try {
    res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
  } catch (err) {
    return Response.json(
      {
        error: `LabArchives API unreachable: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const text = await res.text();
    const m = text.match(/<error[^>]*>([\s\S]*?)<\/error>/i);
    return Response.json(
      {
        error: m
          ? `LabArchives error: ${m[1].trim()}`
          : `LabArchives error (HTTP ${res.status}).`,
      },
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
