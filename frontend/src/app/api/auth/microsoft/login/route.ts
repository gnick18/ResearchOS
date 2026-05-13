import { NextRequest } from "next/server";
import {
  MICROSOFT_CONFIG,
  readClientCreds,
} from "@/lib/calendar/oauth-config";
import {
  loginRedirectUrl,
  makePkcePair,
  makeState,
} from "@/lib/calendar/oauth-server";

/**
 * Kicks off the Microsoft Graph (Outlook Calendar) OAuth dance. Mirrors
 * the Google variant — PKCE verifier + CSRF state get short-lived
 * HTTP-only cookies, then we 302 over to the Microsoft consent page.
 */
export async function GET(req: NextRequest): Promise<Response> {
  let clientId: string;
  try {
    ({ clientId } = readClientCreds("outlook"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OAuth not configured";
    return new Response(msg, { status: 500 });
  }

  const { verifier, challenge } = await makePkcePair();
  const state = makeState();
  const origin = req.nextUrl.origin;
  const url = loginRedirectUrl(MICROSOFT_CONFIG, origin, clientId, state, challenge);

  const cookieOpts =
    "Path=/api/auth/microsoft; HttpOnly; SameSite=Lax; Max-Age=600";
  const secure = origin.startsWith("https://") ? "; Secure" : "";

  const headers = new Headers({ Location: url });
  headers.append("Set-Cookie", `ros_oauth_v=${verifier}; ${cookieOpts}${secure}`);
  headers.append("Set-Cookie", `ros_oauth_s=${state}; ${cookieOpts}${secure}`);
  return new Response(null, { status: 302, headers });
}
