import { NextRequest } from "next/server";
import {
  GOOGLE_CONFIG,
  readClientCreds,
} from "@/lib/calendar/oauth-config";
import {
  loginRedirectUrl,
  makePkcePair,
  makeState,
} from "@/lib/calendar/oauth-server";

/**
 * Kicks off the Google Calendar OAuth dance. The browser opens this URL in
 * a popup; we generate a PKCE pair + CSRF state, drop them in short-lived
 * HTTP-only cookies, then 302 over to Google's consent screen. The
 * callback route reads the cookies back, verifies state, and exchanges
 * the code for tokens.
 */
export async function GET(req: NextRequest): Promise<Response> {
  let clientId: string;
  try {
    ({ clientId } = readClientCreds("google"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OAuth not configured";
    return new Response(msg, { status: 500 });
  }

  const { verifier, challenge } = await makePkcePair();
  const state = makeState();
  const origin = req.nextUrl.origin;
  const url = loginRedirectUrl(GOOGLE_CONFIG, origin, clientId, state, challenge);

  // 10-minute cookie window is plenty for a user to click through the
  // consent screen. HTTP-only + SameSite=Lax keeps it out of arbitrary JS
  // reach and survives the cross-site round trip back from Google.
  const cookieOpts =
    "Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600";
  const secure = origin.startsWith("https://") ? "; Secure" : "";

  const headers = new Headers({ Location: url });
  headers.append("Set-Cookie", `ros_oauth_v=${verifier}; ${cookieOpts}${secure}`);
  headers.append("Set-Cookie", `ros_oauth_s=${state}; ${cookieOpts}${secure}`);
  return new Response(null, { status: 302, headers });
}
