import { NextRequest } from "next/server";
import { readLabArchivesCredsFromRequest } from "@/lib/labarchives/config";
import { signedLabArchivesFetch } from "@/lib/labarchives/signed-fetch";
import { withRateLimit } from "@/lib/api/rate-limit";

/**
 * `POST /api/auth/labarchives/login` — exchange the user's LabArchives email
 * + password for their UID via the `users/user_access_info` REST method.
 *
 * Mirrors the **shape** of the Google/Microsoft login routes (kicks off an
 * auth dance, returns enough state to persist) but the underlying mechanism
 * is different: LabArchives has no OAuth consent screen, just an HMAC-signed
 * REST endpoint that validates credentials and returns the UID. The
 * institutional `akid` + `access_password` come from env vars (multi-tenant
 * path) OR from `body.deployerCreds` (single-user sidecar path); the
 * per-user UID gets persisted client-side via the same path the
 * Google/Microsoft routes used.
 *
 * Body:
 *   {
 *     loginOrEmail: string;
 *     password: string;
 *     // Optional — only present when the client is in sidecar mode and
 *     // env vars are not set on this deployment.
 *     deployerCreds?: { accessKeyId: string; accessPassword: string; baseUrl?: string };
 *   }
 * Returns: `{ uid: string; fullname?: string; email?: string }` on success,
 *   a 4xx with `{ error }` on bad credentials, 5xx on misconfiguration.
 *
 * Client-facing error messages are deliberately generic — see the round-2
 * hardening note in `lib/api/url-guards.ts`. Internal detail (upstream
 * status code, parsed `<error>` body) is logged server-side via
 * `console.warn` for debugger access without fingerprinting the proxy.
 */
async function handlePost(req: NextRequest): Promise<Response> {
  let body: {
    loginOrEmail?: string;
    password?: string;
    deployerCreds?: unknown;
  };
  try {
    body = (await req.json()) as {
      loginOrEmail?: string;
      password?: string;
      deployerCreds?: unknown;
    };
  } catch {
    return Response.json(
      { error: "Body must be JSON with { loginOrEmail, password }." },
      { status: 400 },
    );
  }

  let creds;
  try {
    creds = readLabArchivesCredsFromRequest(req, body);
  } catch (err) {
    console.warn(
      "[labarchives/login] no usable credentials",
      err instanceof Error ? err.message : String(err),
    );
    return Response.json(
      { error: "LabArchives integration is not configured on this deployment." },
      { status: 500 },
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
  const result = await signedLabArchivesFetch(
    creds,
    apiMethod,
    `/users/${apiMethod}`,
    { params: { login_or_email: loginOrEmail, password } },
  );

  if (result.kind === "network-error") {
    console.warn(
      "[labarchives/login] upstream network error",
      result.aborted ? "(timeout)" : "",
      result.error.message,
    );
    return Response.json(
      { error: "Sign-in failed — could not reach LabArchives." },
      { status: 502 },
    );
  }

  const { res } = result;
  const xml = await res.text();
  if (!res.ok) {
    // LabArchives surfaces failures as 4xx with an XML error body. Log the
    // parsed detail server-side; surface a generic message to the client.
    const m = xml.match(/<error[^>]*>([\s\S]*?)<\/error>/i);
    console.warn(
      "[labarchives/login] upstream rejected credentials",
      `status=${res.status}`,
      m ? `detail=${m[1].trim()}` : "(no <error> in body)",
    );
    return Response.json(
      { error: "Sign-in failed — check your LabArchives email and password." },
      { status: 401 },
    );
  }

  // Successful XML payload looks roughly like:
  //   <users><id>123-456</id><fullname>...</fullname><email>...</email>...</users>
  const idMatch = xml.match(/<id[^>]*>([^<]+)<\/id>/);
  if (!idMatch) {
    console.warn(
      "[labarchives/login] success response missing <id> element",
      `len=${xml.length}`,
    );
    return Response.json(
      { error: "Sign-in failed — unexpected response from LabArchives." },
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

// Tight limit because login validates against an upstream credential check —
// the only legitimate caller is the connect popup, which fires once per
// connection attempt.
export const POST = withRateLimit(handlePost, {
  limit: 10,
  windowMs: 60_000,
  name: "labarchives-login",
});
