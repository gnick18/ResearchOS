import { NextRequest } from "next/server";
import {
  GOOGLE_CONFIG,
  readClientCreds,
} from "@/lib/calendar/oauth-config";
import { refreshAccessToken } from "@/lib/calendar/oauth-server";

/**
 * Exchange a stored refresh token for a fresh access token. The browser
 * sends the refresh token in the body (it's already client-side, having
 * been written into the user's FSA folder at connect time) and gets back
 * the new access token + new expiry. Going through this route — instead
 * of having the browser hit Google directly — keeps the client secret
 * server-side.
 *
 * Response shape mirrors the relevant subset of the provider's token
 * endpoint: { accessToken, refreshToken?, expiresIn, scope? }.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let clientId: string;
  let clientSecret: string;
  try {
    ({ clientId, clientSecret } = readClientCreds("google"));
  } catch (err) {
    return new Response(
      err instanceof Error ? err.message : "OAuth not configured",
      { status: 500 },
    );
  }

  let refreshToken: string | undefined;
  try {
    const body = (await req.json()) as { refreshToken?: string };
    refreshToken = body.refreshToken;
  } catch {
    return new Response("Body must be JSON with { refreshToken }", { status: 400 });
  }
  if (!refreshToken) {
    return new Response("Missing refreshToken", { status: 400 });
  }

  try {
    const tokens = await refreshAccessToken(
      GOOGLE_CONFIG,
      clientId,
      clientSecret,
      refreshToken,
    );
    return Response.json({
      accessToken: tokens.access_token,
      // Google's refresh response usually omits a new refresh token (it
      // keeps the existing one valid). Pass through whatever's present.
      refreshToken: tokens.refresh_token ?? null,
      expiresIn: tokens.expires_in,
      scope: tokens.scope ?? null,
    });
  } catch (err) {
    return new Response(
      err instanceof Error ? err.message : "Token refresh failed",
      { status: 502 },
    );
  }
}
