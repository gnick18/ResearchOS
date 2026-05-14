import { NextRequest } from "next/server";
import { readLabArchivesCreds } from "@/lib/labarchives/config";
import { buildSignedParams } from "@/lib/labarchives/sign";

/**
 * `POST /api/auth/labarchives/login` — exchange the user's LabArchives email
 * + password for their UID via the `users/user_access_info` REST method.
 *
 * Mirrors the **shape** of the Google/Microsoft login routes (kicks off an
 * auth dance, returns enough state to persist) but the underlying mechanism
 * is different: LabArchives has no OAuth consent screen, just an HMAC-signed
 * REST endpoint that validates credentials and returns the UID. The
 * institutional `akid` + `access_password` live in env vars; the per-user
 * UID gets persisted client-side via the same path the Google/Microsoft
 * routes use.
 *
 * Body: `{ loginOrEmail: string; password: string }`.
 * Returns: `{ uid: string; fullname?: string; email?: string }` on success,
 *   a 4xx with `{ error }` on bad credentials, 5xx on misconfiguration.
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

  let body: { loginOrEmail?: string; password?: string };
  try {
    body = (await req.json()) as { loginOrEmail?: string; password?: string };
  } catch {
    return Response.json(
      { error: "Body must be JSON with { loginOrEmail, password }." },
      { status: 400 },
    );
  }
  const loginOrEmail = body.loginOrEmail?.trim();
  const password = body.password;
  if (!loginOrEmail || !password) {
    return Response.json(
      { error: "Missing loginOrEmail or password." },
      { status: 400 },
    );
  }

  const apiMethod = "user_access_info";
  const signed = buildSignedParams(creds.accessKeyId, creds.accessPassword, apiMethod);
  const url = new URL(`${creds.baseUrl}/users/${apiMethod}`);
  url.searchParams.set("akid", signed.akid);
  url.searchParams.set("expires", signed.expires);
  url.searchParams.set("sig", signed.sig);
  url.searchParams.set("login_or_email", loginOrEmail);
  url.searchParams.set("password", password);

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

  const xml = await res.text();
  if (!res.ok) {
    // LabArchives surfaces failures as 4xx with an XML error body. Try to
    // extract the human-readable message, fall back to a generic note.
    const m = xml.match(/<error[^>]*>([\s\S]*?)<\/error>/i);
    return Response.json(
      {
        error: m
          ? `LabArchives rejected the credentials: ${m[1].trim()}`
          : `LabArchives rejected the credentials (HTTP ${res.status}).`,
      },
      { status: 401 },
    );
  }

  // Successful XML payload looks roughly like:
  //   <users><id>123-456</id><fullname>...</fullname><email>...</email>...</users>
  const idMatch = xml.match(/<id[^>]*>([^<]+)<\/id>/);
  if (!idMatch) {
    return Response.json(
      { error: "LabArchives response did not include a UID — check the API base URL." },
      { status: 502 },
    );
  }
  const uid = idMatch[1].trim();
  const fullnameMatch = xml.match(/<fullname[^>]*>([^<]+)<\/fullname>/);
  const emailMatch = xml.match(/<email[^>]*>([^<]+)<\/email>/);

  return Response.json({
    uid,
    fullname: fullnameMatch?.[1].trim(),
    email: emailMatch?.[1].trim(),
  });
}
