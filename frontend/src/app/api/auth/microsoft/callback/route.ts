import { NextRequest } from "next/server";
import {
  MICROSOFT_CONFIG,
  readClientCreds,
} from "@/lib/calendar/oauth-config";
import {
  callbackErrorHtml,
  callbackSuccessHtml,
  decodeIdTokenEmail,
  exchangeCode,
} from "@/lib/calendar/oauth-server";

/** Microsoft equivalent of /api/auth/google/callback. Trades the auth code
 *  for tokens server-side and posts them back to the opener tab. */
export async function GET(req: NextRequest): Promise<Response> {
  const url = req.nextUrl;
  const errorParam = url.searchParams.get("error");
  if (errorParam) {
    return htmlError(`Microsoft reported: ${errorParam}`);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return htmlError("Missing `code` or `state` from Microsoft's redirect.");
  }

  const cookieState = req.cookies.get("ros_oauth_s")?.value ?? null;
  const cookieVerifier = req.cookies.get("ros_oauth_v")?.value ?? null;
  if (!cookieState || !cookieVerifier) {
    return htmlError(
      "OAuth cookies were missing — the sign-in window may have been opened from a different domain.",
    );
  }
  if (cookieState !== state) {
    return htmlError("OAuth state mismatch — possible CSRF, refusing to continue.");
  }

  let clientId: string;
  let clientSecret: string;
  try {
    ({ clientId, clientSecret } = readClientCreds("outlook"));
  } catch (err) {
    return htmlError(err instanceof Error ? err.message : "OAuth not configured");
  }

  let tokens;
  try {
    tokens = await exchangeCode(
      MICROSOFT_CONFIG,
      url.origin,
      clientId,
      clientSecret,
      code,
      cookieVerifier,
    );
  } catch (err) {
    return htmlError(err instanceof Error ? err.message : "Token exchange failed");
  }

  const payload = {
    provider: "outlook" as const,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresIn: tokens.expires_in,
    scope: tokens.scope ?? MICROSOFT_CONFIG.scopes.join(" "),
    accountEmail: decodeIdTokenEmail(tokens.id_token),
  };

  const html = callbackSuccessHtml(payload);
  const headers = clearOauthCookies(url.origin);
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(html, { status: 200, headers });
}

function clearOauthCookies(origin: string): Headers {
  const headers = new Headers();
  const secure = origin.startsWith("https://") ? "; Secure" : "";
  for (const name of ["ros_oauth_v", "ros_oauth_s"]) {
    headers.append(
      "Set-Cookie",
      `${name}=; Path=/api/auth/microsoft; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    );
  }
  return headers;
}

function htmlError(message: string): Response {
  return new Response(callbackErrorHtml(message), {
    status: 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
