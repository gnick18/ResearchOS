import { NextRequest } from "next/server";
import {
  GOOGLE_CONFIG,
  readClientCreds,
} from "@/lib/calendar/oauth-config";
import {
  callbackErrorHtml,
  callbackSuccessHtml,
  decodeIdTokenEmail,
  exchangeCode,
} from "@/lib/calendar/oauth-server";

/**
 * Receives the auth code from Google, validates state, swaps it for tokens
 * server-side (client secret never reaches the browser), then returns an
 * HTML page that postMessages the tokens back to the opener tab. The
 * opener writes them to the user's FSA folder via
 * `oauth-tokens-store.writeTokens`.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const url = req.nextUrl;
  const errorParam = url.searchParams.get("error");
  if (errorParam) {
    return htmlError(`Google reported: ${errorParam}`);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return htmlError("Missing `code` or `state` from Google's redirect.");
  }

  const cookieState = readCookie(req, "ros_oauth_s");
  const cookieVerifier = readCookie(req, "ros_oauth_v");
  if (!cookieState || !cookieVerifier) {
    return htmlError(
      "OAuth cookies were missing — the sign-in window may have been opened from a different domain than the one that started the flow.",
    );
  }
  if (cookieState !== state) {
    return htmlError("OAuth state mismatch — possible CSRF, refusing to continue.");
  }

  let clientId: string;
  let clientSecret: string;
  try {
    ({ clientId, clientSecret } = readClientCreds("google"));
  } catch (err) {
    return htmlError(err instanceof Error ? err.message : "OAuth not configured");
  }

  let tokens;
  try {
    tokens = await exchangeCode(
      GOOGLE_CONFIG,
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
    provider: "google" as const,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresIn: tokens.expires_in,
    scope: tokens.scope ?? GOOGLE_CONFIG.scopes.join(" "),
    accountEmail: decodeIdTokenEmail(tokens.id_token),
  };

  const html = callbackSuccessHtml(payload);
  const headers = clearOauthCookies(url.origin);
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(html, { status: 200, headers });
}

function readCookie(req: NextRequest, name: string): string | null {
  return req.cookies.get(name)?.value ?? null;
}

function clearOauthCookies(origin: string): Headers {
  const headers = new Headers();
  const secure = origin.startsWith("https://") ? "; Secure" : "";
  for (const name of ["ros_oauth_v", "ros_oauth_s"]) {
    headers.append(
      "Set-Cookie",
      `${name}=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
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
