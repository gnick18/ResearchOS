import { NextRequest } from "next/server";
import { readLabArchivesCreds } from "@/lib/labarchives/config";
import { buildSignedParams } from "@/lib/labarchives/sign";

/**
 * `POST /api/auth/labarchives/refresh` — re-validate a stored UID.
 *
 * Mirrors the OAuth refresh route's contract from the caller's perspective:
 * a quick "is this connection still good?" check. LabArchives has no access
 * tokens that expire, so refresh is mostly a credential-still-valid probe —
 * we ping `users/user_info_via_id` with the stored UID. A 4xx means the UID
 * is no longer valid and the client should kick the user back to the
 * connect step.
 *
 * Body: `{ uid: string }`. Returns `{ ok: true }` on success, `{ error }` +
 * 4xx/5xx on failure.
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

  let body: { uid?: string };
  try {
    body = (await req.json()) as { uid?: string };
  } catch {
    return Response.json({ error: "Body must be JSON with { uid }." }, { status: 400 });
  }
  const uid = body.uid?.trim();
  if (!uid) {
    return Response.json({ error: "Missing uid." }, { status: 400 });
  }

  const apiMethod = "user_info_via_id";
  const signed = buildSignedParams(creds.accessKeyId, creds.accessPassword, apiMethod);
  const url = new URL(`${creds.baseUrl}/users/${apiMethod}`);
  url.searchParams.set("akid", signed.akid);
  url.searchParams.set("expires", signed.expires);
  url.searchParams.set("sig", signed.sig);
  url.searchParams.set("uid", uid);

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
    return Response.json(
      { error: `Stored UID no longer valid (HTTP ${res.status}).` },
      { status: 401 },
    );
  }
  return Response.json({ ok: true });
}
